"""Danh mục dữ liệu cho tab Dữ liệu: trang chủ theo miền, tìm kiếm có xếp hạng, lineage vùng lân cận,
chi tiết bảng/cột kèm khối tin cậy (agent đã dùng và kiểm bảng này tới đâu) và tác động khi thay đổi.

Thiết kế cho warehouse lớn (vài trăm bảng): trình duyệt không bao giờ tải cả catalog, chỉ nhận đúng phần cần xem.
Mức dùng lấy từ chính lịch sử hỏi của agent (app.qa_runs), không cần log truy vấn của warehouse.
"""

from __future__ import annotations

import math
import re
import threading
import time
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

import psycopg

from lvda import config, db, warehouse
from lvda.catalog import Catalog, catalog_for

CAP = 14  # số bảng lân cận tối đa quanh một bảng trung tâm; vượt thì gom thành "+N"
USAGE_TTL = 30.0
OTHER = "other"
_TABLE_RE = re.compile(r"\b([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\b")
_PREFIXES = ("stg_", "fct_", "dim_", "agg_")


def fold(s: str | None) -> str:
    s = (s or "").replace("đ", "d").replace("Đ", "D")
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower()).strip()


def table_of(col: str) -> str:
    return col.rsplit(".", 1)[0]


# ---------------------------------------------------------------- chỉ mục cấu trúc (theo catalog)
@dataclass
class Index:
    cat: Catalog
    layer: dict[str, int]
    domain: dict[str, str]
    domains: dict[str, str]
    parents: dict[str, set[str]]
    children: dict[str, set[str]]
    col_children: dict[str, set[str]]


_idx: dict[int, tuple[int, Index]] = {}
_lock = threading.Lock()


def _build_index(cat: Catalog) -> Index:
    parents: dict[str, set[str]] = {t: set() for t in cat.columns}
    children: dict[str, set[str]] = {t: set() for t in cat.columns}
    col_children: dict[str, set[str]] = {}
    for col, srcs in cat.direct_lineage.items():
        t = table_of(col)
        for s in srcs:
            st = table_of(s)
            if st == t or st not in cat.columns:
                continue
            parents.setdefault(t, set()).add(st)
            children.setdefault(st, set()).add(t)
            col_children.setdefault(s, set()).add(col)

    layer: dict[str, int] = {}

    def depth(t: str, seen: frozenset[str] = frozenset()) -> int:
        if t in layer:
            return layer[t]
        ps = [p for p in parents.get(t, ()) if p not in seen]
        d = 0 if t not in cat.view_sql else 1 + max((depth(p, seen | {t}) for p in ps), default=0)
        layer[t] = d
        return d

    for t in cat.columns:
        depth(t)

    declared: dict[str, Any] = cat.meta.get("domains") or {}
    domains = {k: str(v.get("label", k)) for k, v in declared.items()}
    explicit = {t: k for k, v in declared.items() for t in v.get("tables", [])}
    domain: dict[str, str] = {}
    for t in cat.columns:
        if t in explicit:
            domain[t] = explicit[t]
            continue
        short = t.split(".", 1)[1]
        for p in _PREFIXES:
            if short.startswith(p):
                short = short[len(p):]
                break
        head = short.split("_", 1)[0]
        domain[t] = head if head in domains else OTHER
    if OTHER in domain.values():
        domains[OTHER] = "Khác"
    return Index(cat, layer, domain, domains, parents, children, col_children)


def index(database_id: int) -> Index:
    cat = catalog_for(database_id)
    with _lock:
        hit = _idx.get(database_id)
        if hit and hit[0] == id(cat):
            return hit[1]
    idx = _build_index(cat)
    with _lock:
        _idx[database_id] = (id(cat), idx)
    return idx


# ---------------------------------------------------------------- mức dùng (từ lịch sử hỏi của agent)
@dataclass
class Run:
    id: str
    kind: str
    status: str
    verdict: str | None
    sql: str
    tables: set[str]


@dataclass
class Usage:
    at: float
    runs: list[Run] = field(default_factory=list)
    by_table: Counter[str] = field(default_factory=Counter)
    caught: list[tuple[set[str], str, list[str]]] = field(default_factory=list)  # (bảng, sql lần đầu, luật bắt được)


_usage: dict[int, Usage] = {}


def usage(database_id: int, idx: Index) -> Usage:
    hit = _usage.get(database_id)
    if hit and time.monotonic() - hit.at < USAGE_TTL:
        return hit
    known = idx.cat.columns
    u = Usage(at=time.monotonic())
    for r in db.fetch_all("""SELECT id, input_kind, status, final_verdict, final_sql FROM app.qa_runs
                             WHERE database_id = %s AND final_sql IS NOT NULL ORDER BY created_at DESC LIMIT 5000""", (database_id,)):
        sql = str(r["final_sql"]).lower()
        tables = {m for m in _TABLE_RE.findall(sql) if m in known}
        u.runs.append(Run(r["id"], r["input_kind"], r["status"], r["final_verdict"], sql, tables))
        u.by_table.update(tables)
    for r in db.fetch_all("""SELECT a.sql, a.verification->'findings' AS findings FROM app.qa_runs q
                             JOIN app.qa_attempts a ON a.run_id = q.id AND a.attempt_no = 0
                             WHERE q.database_id = %s AND a.verdict = 'red' ORDER BY q.created_at DESC LIMIT 5000""", (database_id,)):
        sql = str(r["sql"] or "").lower()
        rules = [f["rule"] for f in (r["findings"] or []) if f.get("severity") in ("high", "medium")]
        u.caught.append(({m for m in _TABLE_RE.findall(sql) if m in known}, sql, rules))
    _usage[database_id] = u
    return u


def _load_metric_cols(database_id: int) -> dict[str, list[dict[str, Any]]]:
    """Cột → chỉ số dùng nó. Database chỉ để duyệt danh mục chưa có chỉ số."""
    from lvda.catalog import is_catalog_only

    return {} if is_catalog_only(database_id) else warehouse.metric_usage(database_id)


@dataclass
class Corpus:
    """Mô tả, chữ đã bỏ dấu để tìm kiếm, và cột → chỉ số. Dựng một lần cho mỗi database, hết hạn sau USAGE_TTL."""
    at: float
    cat_id: int
    desc: dict[str, dict[str, Any]]
    tables: dict[str, tuple[str, str, str]]  # bảng -> (tên ngắn, tên đầy đủ, mô tả), đã bỏ dấu
    cols: dict[str, list[tuple[str, str, str, str]]]  # bảng -> [(cột, tên cột, tên đầy đủ, mô tả)], đã bỏ dấu
    metric_cols: dict[str, list[dict[str, Any]]]


_corpus: dict[int, Corpus] = {}


def corpus(database_id: int, idx: Index) -> Corpus:
    hit = _corpus.get(database_id)
    if hit and hit.cat_id == id(idx.cat) and time.monotonic() - hit.at < USAGE_TTL:
        return hit
    desc = warehouse.descriptions(database_id)
    tables: dict[str, tuple[str, str, str]] = {}
    cols: dict[str, list[tuple[str, str, str, str]]] = {}
    for t, cs in idx.cat.columns.items():
        tables[t] = (fold(t.split(".", 1)[1]), fold(t), fold((desc.get(t) or {}).get("description")))
        cols[t] = [(c, fold(c), fold(f"{t}.{c}"), fold((desc.get(f"{t}.{c}") or {}).get("description"))) for c in cs]
    cp = Corpus(time.monotonic(), id(idx.cat), desc, tables, cols, _load_metric_cols(database_id))
    _corpus[database_id] = cp
    return cp


def invalidate(database_id: int) -> None:
    """Gọi khi mô tả, chỉ số hoặc warehouse đổi để lần xem sau thấy ngay."""
    _corpus.pop(database_id, None)
    _usage.pop(database_id, None)


# ---------------------------------------------------------------- tóm tắt bảng
def _brief(idx: Index, desc: dict[str, dict[str, Any]], u: Usage, name: str) -> dict[str, Any]:
    cols = idx.cat.columns[name]
    d = desc.get(name)
    drafts = sum(1 for c in cols if (desc.get(f"{name}.{c}") or {}).get("status") == "draft") + int(bool(d and d["status"] == "draft"))
    return {
        "name": name, "schema": name.split(".", 1)[0], "layer": idx.layer[name], "object": "view" if name in idx.cat.view_sql else "table",
        "domain": idx.domain[name], "domain_label": idx.domains.get(idx.domain[name], "Khác"),
        "description": d["description"] if d else None, "description_status": d["status"] if d else None,
        "drafts": drafts, "pii": sum(1 for c in cols if f"{name}.{c}" in idx.cat.pii),
        "deprecated": name in idx.cat.deprecated, "columns": len(cols), "uses": u.by_table.get(name, 0),
    }


def home(database_id: int) -> dict[str, Any]:
    idx = index(database_id)
    cp = corpus(database_id, idx)
    desc, metric_cols = cp.desc, cp.metric_cols
    u = usage(database_id, idx)
    briefs = {t: _brief(idx, desc, u, t) for t in idx.cat.columns}
    domains = []
    for key, label in idx.domains.items():
        ts = [b for b in briefs.values() if b["domain"] == key]
        if not ts:
            continue
        layers = Counter(b["layer"] for b in ts)
        domains.append({"key": key, "label": label, "tables": len(ts), "layers": {str(k): v for k, v in sorted(layers.items())},
                        "pii": sum(1 for b in ts if b["pii"]), "drafts": sum(b["drafts"] for b in ts),
                        "deprecated": sum(1 for b in ts if b["deprecated"]), "uses": sum(b["uses"] for b in ts)})
    in_metrics: Counter[str] = Counter()
    for col, ms in metric_cols.items():
        for m in ms:
            if m["status"] == "certified":
                in_metrics[table_of(col)] += 1
    popular = sorted((b for b in briefs.values() if b["uses"]), key=lambda b: (-b["uses"], b["name"]))[:6]
    certified = [{**briefs[t], "metrics": n} for t, n in in_metrics.most_common(8) if t in briefs]
    return {"tables": len(briefs), "columns": sum(len(c) for c in idx.cat.columns.values()),
            "views": len(idx.cat.view_sql), "max_layer": max(idx.layer.values(), default=0),
            "domains": domains, "popular": popular, "certified": certified}


# ---------------------------------------------------------------- tìm kiếm có xếp hạng
def _text_score(q: str, name: str, full: str, text: str, exact: int, prefix: int, contains: int, desc: int) -> int:
    if not q:
        return 0
    if name == q:
        return exact
    if name.startswith(q):
        return prefix
    if q in name or q.replace(" ", "_") in name:
        return contains
    if q in full:
        return contains - 10
    tokens = q.split()
    if q in text or (tokens and all(t in f"{name} {text}" for t in tokens)):
        return desc
    return 0


def search(database_id: int, q: str = "", domain: str | None = None, layer: int | None = None,
           tags: tuple[str, ...] = (), limit: int = 20, offset: int = 0) -> dict[str, Any]:
    idx = index(database_id)
    cp = corpus(database_id, idx)
    desc = cp.desc
    u = usage(database_id, idx)
    metric_tables = {table_of(c) for c in cp.metric_cols}
    fq = fold(q)
    items: list[dict[str, Any]] = []
    for t, cols in idx.cat.columns.items():
        if domain and idx.domain[t] != domain:
            continue
        if layer is not None and idx.layer[t] != layer:
            continue
        b = _brief(idx, desc, u, t)
        if "pii" in tags and not b["pii"] or "draft" in tags and not b["drafts"] or "deprecated" in tags and not b["deprecated"]:
            continue
        boost = 8 * math.log1p(b["uses"]) + (10 if t in metric_tables else 0) + (4 if b["layer"] > 0 else 0) - (25 if b["deprecated"] else 0)
        if not fq:
            items.append({"kind": "table", **b, "score": round(boost, 2)})
            continue
        s = _text_score(fq, *cp.tables[t], 100, 70, 50, 20)
        if s:
            items.append({"kind": "table", **b, "score": round(s + boost, 2)})
        for c, f_col, f_full, f_desc in cp.cols[t]:
            full = f"{t}.{c}"
            cd = desc.get(full)
            typ = cols[c]
            cs = _text_score(fq, f_col, f_full, f_desc, 80, 55, 40, 18)
            if cs:
                items.append({"kind": "column", "name": t, "column": c, "type": typ, "layer": b["layer"],
                              "domain_label": b["domain_label"], "pii": full in idx.cat.pii, "deprecated": b["deprecated"],
                              "description": cd["description"] if cd else None, "uses": b["uses"],
                              "score": round(cs + boost * 0.5, 2)})
    items.sort(key=lambda i: (-i["score"], i["name"], i.get("column", "")))
    return {"total": len(items), "items": items[offset:offset + limit]}


# ---------------------------------------------------------------- lineage vùng lân cận
def column_chain(idx: Index, column: str) -> set[str]:
    """Mọi cột tổ tiên và hậu duệ của một cột (đường đi trọn vẹn từ nguồn tới mart)."""
    seen: set[str] = set()
    for step in (lambda c: idx.cat.direct_lineage.get(c, []), lambda c: idx.col_children.get(c, ())):
        frontier = [column]
        while frontier:
            c = frontier.pop()
            for n in step(c):
                if n not in seen:
                    seen.add(n)
                    frontier.append(n)
    return seen


def lineage(database_id: int, centers: list[str], full: set[str] | None = None, trace: str | None = None) -> dict[str, Any]:
    """Vùng lân cận quanh các bảng trung tâm (có trần CAP). `trace` = một cột: thêm trọn chuỗi bảng nằm trên đường đi của nó."""
    idx = index(database_id)
    u = usage(database_id, idx)
    metric_cols = corpus(database_id, idx).metric_cols
    full = full or set()
    view: set[str] = set()
    more: dict[str, int] = {}
    if trace and table_of(trace) in idx.cat.columns:
        view |= {table_of(c) for c in column_chain(idx, trace) if table_of(c) in idx.cat.columns}
    for c in centers:
        if c not in idx.cat.columns:
            continue
        view.add(c)
        nbrs = sorted(idx.parents[c] | idx.children[c], key=lambda n: (-u.by_table.get(n, 0), abs(idx.layer[n] - idx.layer[c]), n))
        if c not in full and len(nbrs) > CAP:
            more[c] = len(nbrs) - CAP
            nbrs = nbrs[:CAP]
        view |= set(nbrs)

    tables = []
    for t in sorted(view):
        cols = []
        for c in idx.cat.columns[t]:
            fc = f"{t}.{c}"
            parents = idx.cat.direct_lineage.get(fc, [])
            linked = any(table_of(p) in view for p in parents) or any(table_of(k) in view for k in idx.col_children.get(fc, ()))
            if t in centers or linked:
                cols.append({"name": c, "pii": fc in idx.cat.pii, "parents": parents,
                             "metrics": metric_cols.get(fc, []) if t in centers else []})
        tables.append({"name": t, "schema": t.split(".", 1)[0], "layer": idx.layer[t], "deprecated": t in idx.cat.deprecated,
                       "center": t in centers, "columns": cols,
                       "neighbors": sorted(idx.parents[t] | idx.children[t])})
    return {"tables": tables, "more": more, "max_layer": max(idx.layer.values(), default=0)}


# ---------------------------------------------------------------- khối tin cậy và tác động
def _uses_col(sql: str, column: str) -> bool:
    return re.search(rf"\b{re.escape(column.lower())}\b", sql) is not None


def trust(database_id: int, name: str, column: str | None = None) -> dict[str, Any]:
    idx = index(database_id)
    u = usage(database_id, idx)
    runs = [r for r in u.runs if name in r.tables and (column is None or _uses_col(r.sql, column))]
    questions = [r for r in runs if r.kind == "question"]
    caught = [rules for tables, sql, rules in u.caught if name in tables and (column is None or _uses_col(sql, column))]
    rule_counts = Counter(rule for rules in caught for rule in rules)
    metric_cols = corpus(database_id, idx).metric_cols
    certified: dict[str, dict[str, Any]] = {}
    for col, ms in metric_cols.items():
        if table_of(col) != name or (column and col != f"{name}.{column}"):
            continue
        for m in ms:
            certified.setdefault(m["id"], {"id": m["id"], "name_vi": m["name_vi"], "status": m["status"]})
    if certified:
        for row in db.fetch_all("""SELECT m.id, m.certified_at, u.name AS certified_by FROM app.metrics m
                                   LEFT JOIN app.users u ON u.id = m.certified_by WHERE m.database_id = %s AND m.id = ANY(%s)""",
                                (database_id, list(certified))):
            certified[row["id"]].update(certified_at=row["certified_at"], certified_by=row["certified_by"])
    from lvda.catalog import is_catalog_only

    return {
        "catalog_only": is_catalog_only(database_id),
        "questions": len(questions), "sql_checks": len(runs) - len(questions),
        "green": sum(1 for r in questions if r.status == "answered" and r.verdict == "green"),
        "yellow": sum(1 for r in questions if r.status == "answered" and r.verdict == "yellow"),
        "held": sum(1 for r in questions if r.status == "held"),
        "caught": len(caught), "caught_rules": [{"rule": k, "count": v} for k, v in rule_counts.most_common(3)],
        "metrics": sorted(certified.values(), key=lambda m: (m["status"] != "certified", m["name_vi"])),
    }


def impact(database_id: int, name: str, column: str | None = None) -> dict[str, Any]:
    """Đổi bảng/cột này thì cái gì ở hạ nguồn bị ảnh hưởng: bảng, cột, chỉ số, truy vấn mẫu, câu hỏi đã hỏi."""
    idx = index(database_id)
    u = usage(database_id, idx)
    down_cols: set[str] = set()
    if column:
        frontier = [f"{name}.{column}"]
        while frontier:
            c = frontier.pop()
            for k in idx.col_children.get(c, ()):
                if k not in down_cols:
                    down_cols.add(k)
                    frontier.append(k)
        down_tables = {table_of(c) for c in down_cols}
    else:
        down_tables = set()
        frontier = [name]
        while frontier:
            t = frontier.pop()
            for k in idx.children.get(t, ()):
                if k not in down_tables:
                    down_tables.add(k)
                    frontier.append(k)
    touched = {name} | down_tables
    metric_cols = corpus(database_id, idx).metric_cols
    metrics: dict[str, dict[str, Any]] = {}
    for col, ms in metric_cols.items():
        hit = (col == f"{name}.{column}" or col in down_cols) if column else table_of(col) in touched
        if hit:
            for m in ms:
                metrics.setdefault(m["id"], {"id": m["id"], "name_vi": m["name_vi"], "status": m["status"]})
    names_re = [re.compile(rf"\b{re.escape(t)}\b") for t in touched]
    verified = [{"id": q["id"], "question": q["question"]}
                for q in db.fetch_all("SELECT id, question, sql FROM app.verified_queries WHERE database_id = %s AND active", (database_id,))
                if any(r.search(str(q["sql"]).lower()) for r in names_re)]
    questions = sum(1 for r in u.runs if r.kind == "question" and r.tables & touched)
    by_layer = Counter(idx.layer[t] for t in down_tables)
    listing = sorted(down_tables, key=lambda t: (idx.layer[t], t))
    return {
        "tables": [{"name": t, "layer": idx.layer[t], "domain_label": idx.domains.get(idx.domain[t], "Khác")} for t in listing[:50]],
        "tables_total": len(down_tables), "by_layer": {str(k): v for k, v in sorted(by_layer.items())},
        "columns": len(down_cols) if column else sum(len(idx.cat.columns[t]) for t in down_tables),
        "metrics": sorted(metrics.values(), key=lambda m: m["name_vi"]), "verified_queries": verified, "questions": questions,
    }


# ---------------------------------------------------------------- chi tiết bảng / cột
def _key_check(cat: Catalog, name: str) -> dict[str, Any] | None:
    grain = cat.meta.get("grains", {}).get(name)
    if not grain:
        return None
    try:
        with psycopg.connect(config.READER_DSN) as conn:
            conn.execute("SET statement_timeout = '5s'")
            row = conn.execute(f"SELECT count(*), count(DISTINCT ({', '.join(grain)})) FROM {name}").fetchone()
    except psycopg.Error:
        return None
    if row is None:
        return None
    return {"keys": grain, "rows": row[0], "distinct": row[1], "unique": row[0] == row[1]}


def table_detail(database_id: int, name: str) -> dict[str, Any] | None:
    idx = index(database_id)
    if name not in idx.cat.columns:
        return None
    cp = corpus(database_id, idx)
    desc, metric_cols = cp.desc, cp.metric_cols
    u = usage(database_id, idx)
    cat = idx.cat
    columns = [{"name": c, "type": typ, "pii": f"{name}.{c}" in cat.pii, "description": desc.get(f"{name}.{c}"),
                "parents": cat.direct_lineage.get(f"{name}.{c}", []), "sources": cat.mart_lineage.get(f"{name}.{c}", []),
                "metrics": metric_cols.get(f"{name}.{c}", [])} for c, typ in cat.columns[name].items()]
    return {
        **_brief(idx, desc, u, name), "description_obj": desc.get(name), "grain": cat.meta.get("grains", {}).get(name, []),
        "columns_detail": columns, "sql": cat.view_sql.get(name),
        "relationships": [r for r in cat.relationships if r["child"] == name or r["parent"] == name],
        "upstream": sorted(idx.parents[name]), "downstream": sorted(idx.children[name]),
        "key": _key_check(cat, name), "trust": trust(database_id, name), "impact": impact(database_id, name),
    }


def column_detail(database_id: int, name: str, column: str) -> dict[str, Any] | None:
    idx = index(database_id)
    cat = idx.cat
    if column not in cat.columns.get(name, {}):
        return None
    cp = corpus(database_id, idx)
    desc = cp.desc
    fc = f"{name}.{column}"
    return {
        "table": _brief(idx, desc, usage(database_id, idx), name), "column": column, "type": cat.columns[name][column],
        "pii": fc in cat.pii, "description": desc.get(fc), "parents": cat.direct_lineage.get(fc, []),
        "sources": cat.mart_lineage.get(fc, []), "children": sorted(idx.col_children.get(fc, ())),
        "metrics": cp.metric_cols.get(fc, []),
        "trust": trust(database_id, name, column), "impact": impact(database_id, name, column),
    }
