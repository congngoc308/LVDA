"""Warehouse giả lập "Bán lẻ đa kênh" khoảng 500 bảng, để thử danh mục và lineage ở quy mô doanh nghiệp.

- ent_raw: 200 bảng nguồn (10 miền × 7 thực thể × 3 hệ thống ERP/POS/WEB, bớt một mỗi miền), 40 dòng mẫu mỗi bảng.
- ent_stg: 160 view làm sạch, mỗi view đọc một bảng raw.
- ent_mart: 140 view: fct_* ghép thực thể với thực thể cha (có khi khác miền) và agg_*_daily tổng hợp theo ngày.

Lineage không ghi sẵn ở đâu cả: catalog đọc định nghĩa view từ Postgres rồi tự parse (lvda.catalog.build_snapshot).
Chạy riêng: python -m lvda.seed.enterprise (bootstrap cũng gọi, bỏ qua nếu đã có).
"""

from __future__ import annotations

import random
import time
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from lvda import config

DB_NAME = "Bán lẻ đa kênh · 500 bảng"
SCHEMAS = ["ent_raw", "ent_stg", "ent_mart"]
SOURCES = ["erp", "pos", "web"]
ROWS = 40

DOMAINS: dict[str, tuple[str, list[str]]] = {
    "sales": ("Bán hàng", ["orders", "order_lines", "invoices", "invoice_lines", "returns", "quotes", "discounts"]),
    "customer": ("Khách hàng", ["accounts", "contacts", "addresses", "segments", "loyalty_points", "consents", "feedback"]),
    "product": ("Sản phẩm", ["items", "categories", "brands", "prices", "bundles", "attributes", "reviews"]),
    "inventory": ("Kho", ["stock_levels", "warehouses", "movements", "adjustments", "transfers", "counts", "reservations"]),
    "finance": ("Tài chính", ["payments", "refunds", "ledger_entries", "payables", "receivables", "taxes", "fx_rates"]),
    "marketing": ("Marketing", ["campaigns", "ad_spend", "impressions", "clicks", "coupons", "emails", "leads"]),
    "logistics": ("Vận chuyển", ["shipments", "shipment_events", "carriers", "routes", "deliveries", "packages", "rates"]),
    "hr": ("Nhân sự", ["employees", "departments", "shifts", "payroll", "attendance", "positions", "trainings"]),
    "support": ("Chăm sóc khách hàng", ["tickets", "ticket_events", "agents", "sla_policies", "csat_surveys", "chats", "macros"]),
    "web": ("Website & app", ["sessions", "page_views", "events", "carts", "searches", "devices", "app_installs"]),
}
# Thực thể chính của một số miền trỏ sang miền khác (đơn hàng → tài khoản khách, thanh toán → đơn hàng, …)
CROSS = {"sales": ("customer", "accounts"), "finance": ("sales", "orders"), "logistics": ("sales", "orders"),
         "support": ("customer", "accounts"), "web": ("customer", "accounts"), "marketing": ("customer", "accounts"),
         "inventory": ("product", "items")}
ATTRS = {
    "sales": ["amount", "quantity", "unit_price", "currency", "channel", "note"],
    "customer": ["name", "email", "phone", "address_line", "city", "country", "score"],
    "product": ["name", "sku", "category", "unit_price", "score", "note"],
    "inventory": ["sku", "quantity", "city", "note", "category"],
    "finance": ["amount", "currency", "channel", "note", "country"],
    "marketing": ["amount", "channel", "name", "score", "email"],
    "logistics": ["amount", "city", "country", "quantity", "note"],
    "hr": ["name", "email", "phone", "address_line", "amount", "city"],
    "support": ["channel", "score", "email", "note", "name"],
    "web": ["channel", "city", "country", "score", "note"],
}
TYPES = {"amount": "numeric(12,2)", "unit_price": "numeric(12,2)", "quantity": "integer", "score": "integer"}
PII = {"email", "phone", "address_line"}
NUMERIC = ("amount", "unit_price", "quantity", "score", "line_total")
DUPLICATE_KEY_TABLE = "ent_raw.inventory_counts_pos"  # cố ý để khóa trùng, cho danh mục có "khóa lỗi" thật

COL_VI = {
    "id": "Khóa của dòng trong hệ thống nguồn", "created_at": "Thời điểm tạo bản ghi", "created_date": "Ngày tạo",
    "updated_at": "Thời điểm cập nhật gần nhất", "status": "Trạng thái", "amount": "Số tiền (VND)",
    "unit_price": "Đơn giá (VND)", "quantity": "Số lượng", "score": "Điểm", "currency": "Loại tiền", "channel": "Kênh",
    "name": "Tên", "email": "Email, dữ liệu cá nhân", "phone": "Số điện thoại, dữ liệu cá nhân",
    "address_line": "Địa chỉ, dữ liệu cá nhân", "city": "Thành phố", "country": "Quốc gia", "sku": "Mã hàng",
    "category": "Nhóm", "note": "Ghi chú tự do", "line_total": "Thành tiền = số lượng × đơn giá",
    "row_count": "Số dòng trong ngày", "total_amount": "Tổng số tiền trong ngày",
}


def singular(word: str) -> str:
    if word.endswith("ies"):
        return word[:-3] + "y"
    if word.endswith("es") and word[:-2].endswith(("ss", "x", "ch", "sh")):
        return word[:-2]
    return word[:-1] if word.endswith("s") else word


def plan() -> dict[str, Any]:
    """Toàn bộ bảng, view và metadata, tính thuần (không chạm DB) để test được."""
    raw: dict[str, list[tuple[str, str]]] = {}
    views: dict[str, str] = {}
    meta: dict[str, Any] = {"grains": {}, "relationships": [], "pii": [], "deprecated": [], "domains": {},
                            "allowed_schemas": SCHEMAS}
    descriptions: dict[str, str] = {}
    stg_cols: dict[str, list[str]] = {}
    for d, (label, ents) in DOMAINS.items():
        meta["domains"][d] = {"label": label}
        parent = ents[0]
        parent_fk = f"{singular(parent)}_id"
        combos = [(e, s) for s in SOURCES for e in ents][:20]
        stg_combos = combos[:16]  # đủ ERP và POS cho cả 7 thực thể, cộng 2 bảng WEB
        for e, s in combos:
            name = f"ent_raw.{d}_{e}_{s}"
            cols = [("id", "bigint"), ("created_at", "timestamp"), ("updated_at", "timestamp"), ("status", "text")]
            if e != parent:
                cols.append((parent_fk, "bigint"))
            elif d in CROSS:
                cols.append((f"{singular(CROSS[d][1])}_id", "bigint"))
            rng = random.Random(name)
            pool = ATTRS[d]
            picked = sorted(rng.sample(range(len(pool)), rng.randint(3, min(6, len(pool)))))
            cols += [(pool[i], TYPES.get(pool[i], "text")) for i in picked]
            raw[name] = cols
            meta["grains"][name] = ["id"]
            meta["pii"] += [f"{name}.{c}" for c, _ in cols if c in PII]
            if e != parent and (parent, s) in combos:
                meta["relationships"].append({"child": name, "parent": f"ent_raw.{d}_{parent}_{s}",
                                              "keys": [f"{name}.{parent_fk}", f"ent_raw.{d}_{parent}_{s}.id"]})
            descriptions[name] = f"Bảng gốc {e.replace('_', ' ')} của miền {label}, nạp nguyên trạng từ hệ thống {s.upper()}."
            for c, _ in cols:
                descriptions[f"{name}.{c}"] = COL_VI.get(c) or f"Mã {c[:-3].replace('_', ' ')}"

        stg_of: dict[str, str] = {}
        for e, s in stg_combos:
            src, name = f"ent_raw.{d}_{e}_{s}", f"ent_stg.stg_{d}_{e}_{s}"
            key = f"{singular(e)}_id"
            names = [c for c, _ in raw[src]]
            select = [f"r.id AS {key}", "r.created_at::date AS created_date", "r.updated_at", "lower(r.status) AS status"]
            select += [f"r.{c}" for c in names[4:]]
            if "quantity" in names and "unit_price" in names:
                select.append("r.quantity * r.unit_price AS line_total")
            views[name] = "SELECT " + ",\n       ".join(select) + f"\nFROM {src} AS r\nWHERE r.status <> 'deleted'"
            out = [key, "created_date", "updated_at", "status", *names[4:]] + (["line_total"] if "line_total" in views[name] else [])
            stg_cols[name] = out
            stg_of.setdefault(e, name)
            meta["grains"][name] = [key]
            meta["pii"] += [f"{name}.{c}" for c in out if c in PII]
            descriptions[name] = f"Bản làm sạch của {src.split('.')[1]}: đổi tên khóa, bỏ dòng đã xóa, chuẩn hoá trạng thái."
            for c in out:
                descriptions[f"{name}.{c}"] = COL_VI.get(c) or f"Mã {c[:-3].replace('_', ' ')}"
        meta["_stg_of"] = {**meta.get("_stg_of", {}), **{f"{d}.{e}": v for e, v in stg_of.items()}}

    # mart: cần stg của mọi miền (khóa khác miền), nên dựng sau cùng
    stg_of_all: dict[str, str] = meta.pop("_stg_of")
    for d, (label, ents) in DOMAINS.items():
        parent = ents[0]
        for e in ents:
            s_name = stg_of_all[f"{d}.{e}"]
            key = f"{singular(e)}_id"
            cols = stg_cols[s_name]
            if e != parent:
                p_name, fk, p_label = stg_of_all[f"{d}.{parent}"], f"{singular(parent)}_id", singular(parent)
            elif d in CROSS:
                p_name, fk, p_label = stg_of_all[f"{CROSS[d][0]}.{CROSS[d][1]}"], f"{singular(CROSS[d][1])}_id", singular(CROSS[d][1])
            else:
                p_name = fk = p_label = ""
            select = [f"s.{key}", "s.created_date", "s.status"] + [f"s.{c}" for c in cols if c in NUMERIC]
            if p_name and fk in cols:
                p_cols = stg_cols[p_name]
                select += [f"p.created_date AS {p_label}_created_date", f"p.status AS {p_label}_status"]
                select += [f"p.{c} AS {p_label}_{c}" for c in p_cols if c in ("channel", "city", "name", "category")][:1]
                join = f"\nLEFT JOIN {p_name} AS p ON p.{fk} = s.{fk}"
                meta["relationships"].append({"child": s_name, "parent": p_name, "keys": [f"{s_name}.{fk}", f"{p_name}.{fk}"]})
            else:
                join = ""
            fct = f"ent_mart.fct_{d}_{e}"
            views[fct] = "SELECT " + ",\n       ".join(select) + f"\nFROM {s_name} AS s{join}"
            meta["grains"][fct] = [key]
            descriptions[fct] = f"Bảng sự kiện {e.replace('_', ' ')} của miền {label}" + (f", ghép thông tin {p_label}." if join else ".")
            for expr in select:
                alias = expr.rsplit(" AS ", 1)[-1].split(".")[-1]
                base = alias.removeprefix(f"{p_label}_") if p_label and alias.startswith(f"{p_label}_") and alias != fk else alias
                text = COL_VI.get(base) or f"Mã {base[:-3].replace('_', ' ')}"
                descriptions[f"{fct}.{alias}"] = f"{text} (của {p_label})" if base != alias else text

            agg = f"ent_mart.agg_{d}_{e}_daily"
            measures = ["count(*) AS row_count"] + (["sum(s.amount) AS total_amount"] if "amount" in cols else [])
            views[agg] = ("SELECT s.created_date, s.status, " + ", ".join(measures) +
                          f"\nFROM {s_name} AS s\nGROUP BY s.created_date, s.status")
            meta["grains"][agg] = ["created_date", "status"]
            descriptions[agg] = f"Tổng hợp {e.replace('_', ' ')} theo ngày và trạng thái."
            for c in ("created_date", "status", "row_count", *(["total_amount"] if "amount" in cols else [])):
                descriptions[f"{agg}.{c}"] = COL_VI[c]
        meta["deprecated"] += [f"ent_raw.{d}_{ents[-1]}_pos", f"ent_mart.agg_{d}_{ents[-1]}_daily"]
    return {"raw": raw, "views": views, "meta": meta, "descriptions": descriptions}


def _value(col: str, typ: str, duplicate: bool) -> str:
    if col == "id":
        return "1 + g % 30" if duplicate else "g"
    if col in ("created_at", "updated_at"):
        return f"timestamp '2025-01-0{1 if col == 'created_at' else 2}' + g * interval '13 hours'"
    if col == "status":
        return "(ARRAY['active','pending','closed','deleted'])[1 + g % 4]"
    if col.endswith("_id"):
        return f"1 + g % {ROWS}"
    if typ.startswith("numeric"):
        return "round(((g * 37) % 500 + 9.99)::numeric, 2)"
    if typ == "integer":
        return "1 + g % 9"
    special = {"email": "'user' || g || '@example.vn'", "phone": "'+84 90 ' || lpad(g::text, 7, '0')",
               "address_line": "g || ' Nguyễn Trãi'", "city": "(ARRAY['Hà Nội','TP.HCM','Đà Nẵng'])[1 + g % 3]",
               "country": "'VN'", "currency": "'VND'", "channel": "(ARRAY['online','cửa hàng','app'])[1 + g % 3]"}
    return special.get(col, f"'{col}_' || g")


def _build_warehouse(conn: psycopg.Connection[Any], p: dict[str, Any]) -> None:
    conn.execute("; ".join(f"DROP SCHEMA IF EXISTS {s} CASCADE" for s in reversed(SCHEMAS)))
    conn.execute("; ".join(f"CREATE SCHEMA {s}" for s in SCHEMAS))
    for name, cols in p["raw"].items():
        conn.execute(f"CREATE TABLE {name} (" + ", ".join(f"{c} {t}" for c, t in cols) + ")")
        exprs = ", ".join(_value(c, t, name == DUPLICATE_KEY_TABLE) for c, t in cols)
        conn.execute(f"INSERT INTO {name} ({', '.join(c for c, _ in cols)}) SELECT {exprs} FROM generate_series(1, {ROWS}) AS g")
    for name, sql in p["views"].items():  # stg trước mart nhờ thứ tự chèn
        conn.execute(f"CREATE VIEW {name} AS\n{sql}")


def _grant(conn: psycopg.Connection[Any]) -> None:
    conn.execute(f"GRANT USAGE ON SCHEMA {', '.join(SCHEMAS)} TO lvda_reader")
    for s in SCHEMAS:
        conn.execute(f"GRANT SELECT ON ALL TABLES IN SCHEMA {s} TO lvda_reader")


def _register(conn: psycopg.Connection[Any], p: dict[str, Any]) -> int:
    spec = {"schemas": SCHEMAS, "source_schemas": ["ent_raw"], "catalog_only": True, "meta": p["meta"]}
    db_id: int = conn.execute(
        "INSERT INTO app.databases (name, description, settings) VALUES (%s, %s, %s) RETURNING id",
        (DB_NAME, "Warehouse giả lập 10 miền nghiệp vụ để thử danh mục ở quy mô lớn. Chỉ duyệt danh mục và lineage; agent chưa hỏi được.",
         Jsonb({"warehouse": spec}))).fetchone()[0]
    for email, role, certify in (("engineer@lvda.dev", "engineer", True), ("analyst@lvda.dev", "viewer", False)):
        conn.execute("""INSERT INTO app.database_members (database_id, user_id, role, can_certify)
                        SELECT %s, id, %s, %s FROM app.users WHERE email = %s""", (db_id, role, certify, email))
    # mô tả: lớp mart đã duyệt, lớp stg/raw còn là bản nháp AI viết
    rows = [(db_id, k, v, "approved" if k.startswith("ent_mart.") else "draft") for k, v in p["descriptions"].items()]
    with conn.cursor() as cur:
        cur.executemany("INSERT INTO app.column_descriptions (database_id, column_name, description, status) VALUES (%s,%s,%s,%s)", rows)
    return db_id


def _backfill_descriptions(conn: psycopg.Connection[Any]) -> None:
    """Bộ sinh có thêm mô tả mới thì bổ sung vào database đã dựng (không ghi đè mô tả người đã sửa)."""
    p = plan()
    row = conn.execute("""SELECT d.id, count(c.column_name) FROM app.databases d
                          LEFT JOIN app.column_descriptions c ON c.database_id = d.id
                          WHERE d.settings ? 'warehouse' GROUP BY d.id""").fetchone()
    if row is None or row[1] >= len(p["descriptions"]):
        return
    rows = [(row[0], k, v, "approved" if k.startswith("ent_mart.") else "draft") for k, v in p["descriptions"].items()]
    with conn.cursor() as cur:
        cur.executemany("""INSERT INTO app.column_descriptions (database_id, column_name, description, status) VALUES (%s,%s,%s,%s)
                           ON CONFLICT (database_id, column_name) DO NOTHING""", rows)
    print(f"  enterprise: bổ sung mô tả ({len(p['descriptions']) - row[1]} mục)")


def ensure_enterprise(conn: psycopg.Connection[Any]) -> None:
    """Idempotent: dựng warehouse nếu chưa có, đăng ký database trong app nếu chưa có."""
    has_schema = conn.execute("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'ent_mart'").fetchone()
    has_db = conn.execute("SELECT 1 FROM app.databases WHERE settings ? 'warehouse'").fetchone()
    if has_schema and has_db:
        _grant(conn)
        _backfill_descriptions(conn)
        print("  enterprise: đã có, bỏ qua")
        return
    t0 = time.perf_counter()
    p = plan()
    if not has_schema:
        _build_warehouse(conn, p)
    _grant(conn)
    if not has_db:
        _register(conn, p)
    print(f"  enterprise: {len(p['raw'])} bảng raw + {len(p['views'])} view ({time.perf_counter() - t0:.1f}s)")


def ensure_snapshot() -> None:
    """Crawl warehouse lần đầu để có snapshot lineage (lần sau đọc snapshot, không parse lại)."""
    from lvda import db
    from lvda.catalog import rebuild_catalog

    for row in db.fetch_all("""SELECT d.id FROM app.databases d LEFT JOIN app.catalog_snapshots s ON s.database_id = d.id
                               WHERE d.settings ? 'warehouse' AND s.database_id IS NULL"""):
        t0 = time.perf_counter()
        cat = rebuild_catalog(row["id"])
        print(f"  enterprise: snapshot {len(cat.columns)} bảng, lineage {len(cat.direct_lineage)} cột ({time.perf_counter() - t0:.1f}s)")


if __name__ == "__main__":
    with psycopg.connect(config.OWNER_DSN, autocommit=True) as c:
        ensure_enterprise(c)
    ensure_snapshot()
