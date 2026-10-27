"""Catalog của warehouse: cột và kiểu (từ Postgres), metadata (schema.yml), lineage mart → raw.

Database Olist dùng catalog mặc định (file mart/*.sql + schema.yml). Database khác có thể khai báo
`settings.warehouse` (schema nguồn, metadata): khi đó catalog được dựng bằng cách đọc định nghĩa view
thẳng từ Postgres, giống một crawler, và lưu snapshot vào app.catalog_snapshots để khỏi parse lại.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any, cast

import sqlglot
import yaml
from sqlglot import exp
from sqlglot.optimizer.qualify import qualify
from sqlglot.optimizer.scope import build_scope
from sqlglot.schema import MappingSchema

from lvda import config
from lvda.sqlscope import resolve_expr

TIME_TYPES = ("timestamp", "date", "time")


@dataclass
class Catalog:
    columns: dict[str, dict[str, str]]  # "mart.fct_orders" -> {col: type}
    meta: dict[str, Any]
    mart_lineage: dict[str, list[str]] = field(default_factory=dict)  # mart col -> raw cols
    view_sql: dict[str, str] = field(default_factory=dict)
    direct_lineage: dict[str, list[str]] = field(default_factory=dict)  # cột view -> cột nguồn trực tiếp (một bước)

    # ---- tra cứu ----
    def has_table(self, full: str) -> bool:
        return full in self.columns

    def tables_named(self, name: str) -> list[str]:
        return [t for t in self.columns if t.split(".", 1)[1] == name]

    def col_type(self, full_col: str) -> str:
        table, _, col = full_col.rpartition(".")
        return self.columns.get(table, {}).get(col, "")

    def is_time(self, full_col: str) -> bool:
        return any(t in self.col_type(full_col).lower() for t in TIME_TYPES)

    def sqlglot_schema(self) -> dict[str, dict[str, dict[str, str]]]:
        out: dict[str, dict[str, dict[str, str]]] = {}
        for full, cols in self.columns.items():
            db, table = full.split(".", 1)
            out.setdefault(db, {})[table] = {c: t.upper() for c, t in cols.items()}
        return out

    # ---- metadata ----
    @property
    def relationships(self) -> list[dict[str, Any]]:
        return cast(list[dict[str, Any]], self.meta.get("relationships", []))

    def child_of(self, child: str, parent: str) -> bool:
        return any(r["child"] == child and r["parent"] == parent for r in self.relationships)

    def siblings(self, a: str, b: str) -> bool:
        if a == b:
            return False
        parents_a = {r["parent"] for r in self.relationships if r["child"] == a}
        parents_b = {r["parent"] for r in self.relationships if r["child"] == b}
        return bool(parents_a & parents_b)

    def unique_when(self, child: str) -> dict[str, Any] | None:
        for r in self.relationships:
            if r["child"] == child and r.get("unique_when"):
                return cast(dict[str, Any], r["unique_when"])
        return None

    def fk_map(self) -> dict[str, str]:
        """Cột khóa ngoại của bảng con → cột khóa của bảng cha."""
        return {r["keys"][0]: r["keys"][1] for r in self.relationships}

    def join_allowed(self, a: str, b: str) -> bool:
        fk = self.fk_map()
        if a == b:
            return True
        if fk.get(a) == b or fk.get(b) == a:
            return True
        return a in fk and fk.get(a) == fk.get(b)

    def grain_owner(self, cols: set[str]) -> str | None:
        """Bảng có grain đúng bằng tập cột (sau khi quy khóa ngoại về khóa cha)."""
        fk = self.fk_map()
        mapped = {fk.get(c, c) for c in cols}
        for table, grain in self.meta.get("grains", {}).items():
            if {f"{table}.{g}" for g in grain} == mapped:
                return str(table)
        return None

    @property
    def pii(self) -> set[str]:
        return set(self.meta.get("pii", []))

    @property
    def deprecated(self) -> set[str]:
        return set(self.meta.get("deprecated", []))

    @property
    def misleading_keys(self) -> dict[str, str]:
        return cast(dict[str, str], self.meta.get("misleading_keys", {}))

    @property
    def allowed_schemas(self) -> set[str]:
        return set(self.meta.get("allowed_schemas", ["mart", "raw"]))

    def to_raw(self, cols: set[str] | list[str]) -> list[str]:
        out: set[str] = set()
        for c in cols:
            out |= set(self.mart_lineage.get(c, [c]))
        return sorted(out)


_lock = threading.Lock()
_cached: Catalog | None = None


def _load_columns(schemas: Iterable[str] = ("raw", "mart")) -> dict[str, dict[str, str]]:
    from lvda.db import fetch_all

    rows = fetch_all(
        """SELECT table_schema, table_name, column_name, data_type
           FROM information_schema.columns
           WHERE table_schema = ANY(%s)
           ORDER BY table_schema, table_name, ordinal_position""", (list(schemas),))
    cols: dict[str, dict[str, str]] = {}
    for r in rows:
        cols.setdefault(f"{r['table_schema']}.{r['table_name']}", {})[r["column_name"]] = r["data_type"]
    return cols


def view_lineage(cat: Catalog, views: dict[str, str], is_source: Callable[[str], bool]) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """Lineage của các view: (cột → cột nguồn trực tiếp, cột → cột ở lớp nguồn). View đọc view khác nên truy bắc cầu."""
    direct: dict[str, list[str]] = {}
    # dựng schema một lần: truyền dict thì qualify chuẩn hoá lại cả schema cho mỗi view (500 bảng: chậm ~100 lần)
    schema = MappingSchema(cat.sqlglot_schema(), dialect="postgres")
    for name, sql in views.items():
        try:
            tree = qualify(sqlglot.parse_one(sql, read="postgres"), schema=schema, dialect="postgres",
                           quote_identifiers=False, identify=False)
            root = build_scope(tree)
        except Exception:
            continue
        if root is None or not isinstance(tree, exp.Select):
            continue
        for proj in tree.selects:
            direct[f"{name}.{proj.alias_or_name}"] = sorted(resolve_expr(root, proj))

    memo: dict[str, set[str]] = {}

    def to_source(col: str, seen: frozenset[str] = frozenset()) -> set[str]:
        if is_source(col):
            return {col}
        if col in memo:
            return memo[col]
        if col in seen or col not in direct:
            return set()
        out: set[str] = set()
        for src in direct[col]:
            out |= to_source(src, seen | {col})
        memo[col] = out
        return out

    return direct, {col: sorted(to_source(col)) for col in direct}


def _mart_lineage(cat: Catalog) -> tuple[dict[str, list[str]], dict[str, str], dict[str, list[str]]]:
    """Lineage cột mart → cột raw cho catalog Olist (view đọc từ file mart/*.sql)."""
    views = {f"mart.{path.stem}": path.read_text(encoding="utf-8") for path in config.mart_files()}
    direct, to_raw = view_lineage(cat, views, lambda c: c.startswith("raw."))
    return to_raw, views, direct


def load_catalog() -> Catalog:
    meta = yaml.safe_load(config.SCHEMA_YML.read_text(encoding="utf-8"))
    cat = Catalog(columns=_load_columns(), meta=meta)
    cat.mart_lineage, cat.view_sql, cat.direct_lineage = _mart_lineage(cat)
    return cat


def get_catalog() -> Catalog:
    global _cached
    with _lock:
        if _cached is None:
            _cached = load_catalog()
        return _cached


def refresh_catalog() -> Catalog:
    global _cached
    with _lock:
        _cached = load_catalog()
        return _cached


# ---------------------------------------------------------------- catalog theo từng database
_by_db: dict[int, Catalog] = {}
_specs: dict[int, dict[str, Any] | None] = {}


def warehouse_spec(database_id: int) -> dict[str, Any] | None:
    """`settings.warehouse` của database; None nghĩa là dùng catalog Olist mặc định. Chỉ đổi khi bootstrap nên cache."""
    from lvda.db import fetch_one

    if database_id in _specs:
        return _specs[database_id]
    row = fetch_one("SELECT settings->'warehouse' AS w FROM app.databases WHERE id = %s", (database_id,))
    spec = cast(dict[str, Any], row["w"]) if row and row["w"] else None
    if row is not None:  # database chưa tồn tại thì đừng cache, có thể vừa được tạo
        _specs[database_id] = spec
    return spec


def build_snapshot(spec: dict[str, Any]) -> dict[str, Any]:
    """Crawl warehouse theo spec: cột từ information_schema, định nghĩa view từ pg_views, rồi tính lineage."""
    from lvda.db import fetch_all

    schemas: list[str] = spec["schemas"]
    sources: list[str] = spec["source_schemas"]
    cat = Catalog(columns=_load_columns(schemas), meta=spec.get("meta", {}))
    rows = fetch_all("SELECT schemaname, viewname, definition FROM pg_views WHERE schemaname = ANY(%s)", (schemas,))
    views = {f"{r['schemaname']}.{r['viewname']}": str(r["definition"]).rstrip().rstrip(";") for r in rows}
    direct, to_src = view_lineage(cat, views, lambda c: c.split(".", 1)[0] in sources)
    return {"columns": cat.columns, "view_sql": views, "direct": direct, "to_source": to_src}


def _from_snapshot(spec: dict[str, Any], snap: dict[str, Any]) -> Catalog:
    cat = Catalog(columns=snap["columns"], meta=spec.get("meta", {}))
    cat.view_sql, cat.direct_lineage, cat.mart_lineage = snap["view_sql"], snap["direct"], snap["to_source"]
    return cat


def rebuild_catalog(database_id: int) -> Catalog:
    """Crawl lại warehouse của database và lưu snapshot (dùng cho nút "Nạp lại")."""
    from lvda import db

    _specs.pop(database_id, None)
    spec = warehouse_spec(database_id)
    if spec is None:
        return refresh_catalog()
    snap = build_snapshot(spec)
    db.execute("""INSERT INTO app.catalog_snapshots (database_id, data, built_at) VALUES (%s, %s, now())
                  ON CONFLICT (database_id) DO UPDATE SET data = EXCLUDED.data, built_at = now()""",
               (database_id, db.jsonb(snap)))
    with _lock:
        _by_db[database_id] = _from_snapshot(spec, snap)
        return _by_db[database_id]


def catalog_for(database_id: int) -> Catalog:
    """Catalog của một database: Olist dùng catalog mặc định, database khai báo warehouse dùng snapshot."""
    from lvda.db import fetch_one

    with _lock:
        if database_id in _by_db:
            return _by_db[database_id]
    spec = warehouse_spec(database_id)
    if spec is None:
        return get_catalog()
    row = fetch_one("SELECT data FROM app.catalog_snapshots WHERE database_id = %s", (database_id,))
    if row is None:
        return rebuild_catalog(database_id)
    with _lock:
        _by_db[database_id] = _from_snapshot(spec, cast(dict[str, Any], row["data"]))
        return _by_db[database_id]


def is_catalog_only(database_id: int) -> bool:
    """Database chỉ để duyệt danh mục (chưa có chỉ số chuẩn, agent chưa hỏi được)."""
    spec = warehouse_spec(database_id)
    return bool(spec and spec.get("catalog_only", True))
