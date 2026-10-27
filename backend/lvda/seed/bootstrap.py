"""Dựng toàn bộ database: python -m lvda.seed.bootstrap [--reset] [--no-enterprise]

1. schema raw + dữ liệu giả lập Olist
2. schema mart (view từ warehouse/mart/*.sql)
3. role lvda_reader chỉ đọc
4. schema app (metadata) + tài khoản mẫu + chỉ số từ metrics.yml
5. warehouse "bán lẻ đa kênh" 500 bảng (ent_raw / ent_stg / ent_mart) để thử danh mục ở quy mô lớn
"""

from __future__ import annotations

import sys
from pathlib import Path

import bcrypt
import psycopg
import yaml

from lvda import config
from lvda.seed.generate import RAW_DDL, generate

APP_DDL = """
CREATE SCHEMA IF NOT EXISTS app;
CREATE TABLE IF NOT EXISTS app.users (
  id serial PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL,
  password_hash text NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS app.databases (
  id serial PRIMARY KEY, name text NOT NULL, description text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS app.share_links (
  id serial PRIMARY KEY, database_id int REFERENCES app.databases(id), role text NOT NULL CHECK (role IN ('viewer','engineer')),
  token_hash text UNIQUE NOT NULL, created_by int REFERENCES app.users(id), expires_at timestamptz NOT NULL,
  revoked_at timestamptz, max_uses int, uses int NOT NULL DEFAULT 0, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS app.database_members (
  database_id int REFERENCES app.databases(id), user_id int REFERENCES app.users(id),
  role text NOT NULL CHECK (role IN ('viewer','engineer')), can_certify boolean NOT NULL DEFAULT false,
  granted_via text NOT NULL DEFAULT 'direct' CHECK (granted_via IN ('direct','link')),
  granted_by int REFERENCES app.users(id), share_link_id int REFERENCES app.share_links(id),
  expires_at timestamptz, created_at timestamptz DEFAULT now(), PRIMARY KEY (database_id, user_id));
CREATE TABLE IF NOT EXISTS app.audit_events (
  id bigserial PRIMARY KEY, database_id int, actor_id int, action text NOT NULL, target text,
  detail jsonb, request_id text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS app.metrics (
  database_id int REFERENCES app.databases(id), id text, name_vi text NOT NULL, status text NOT NULL,
  owner text, current_version int NOT NULL, certified_by int REFERENCES app.users(id), certified_at timestamptz,
  updated_at timestamptz DEFAULT now(), PRIMARY KEY (database_id, id));
CREATE TABLE IF NOT EXISTS app.metric_versions (
  database_id int, metric_id text, version int, spec jsonb NOT NULL, yaml text NOT NULL,
  created_by int, created_at timestamptz DEFAULT now(), PRIMARY KEY (database_id, metric_id, version));
CREATE TABLE IF NOT EXISTS app.qa_runs (
  id text PRIMARY KEY, database_id int, user_id int, input_kind text NOT NULL, question text NOT NULL,
  intent text, metric_id text, metric_version int, interpretation jsonb, final_verdict text, final_sql text,
  answer jsonb, result jsonb, usage jsonb, status text NOT NULL, review_status text NOT NULL DEFAULT 'none',
  feedback jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS app.qa_attempts (
  run_id text REFERENCES app.qa_runs(id) ON DELETE CASCADE, attempt_no int, sql text, source text,
  verdict text, verification jsonb, notes jsonb, latency_ms numeric, PRIMARY KEY (run_id, attempt_no));
CREATE TABLE IF NOT EXISTS app.qa_reviews (
  id serial PRIMARY KEY, run_id text REFERENCES app.qa_runs(id) ON DELETE CASCADE, reviewer_id int,
  decision text NOT NULL, edited_sql text, reason text, decided_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS app.verified_queries (
  id serial PRIMARY KEY, database_id int, question text NOT NULL, question_norm text NOT NULL, sql text NOT NULL,
  metric_id text, approved_by int, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS app.eval_runs (
  id serial PRIMARY KEY, database_id int, kind text NOT NULL, summary jsonb, items jsonb,
  created_by int, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS app.column_descriptions (
  database_id int, column_name text, description text NOT NULL, status text NOT NULL DEFAULT 'draft',
  source text NOT NULL DEFAULT 'llm', updated_by int, updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (database_id, column_name));
CREATE TABLE IF NOT EXISTS app.agent_logs (
  id bigserial PRIMARY KEY, database_id int, run_id text, model text, question text, sql text NOT NULL,
  injected jsonb, verdict text, created_at timestamptz DEFAULT now());
ALTER TABLE app.qa_runs ADD COLUMN IF NOT EXISTS request_id text;
ALTER TABLE app.databases ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE app.metrics ADD COLUMN IF NOT EXISTS fingerprint_hash text;
ALTER TABLE app.metrics ADD COLUMN IF NOT EXISTS stale_reason text;
ALTER TABLE app.verified_queries ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE app.verified_queries ADD COLUMN IF NOT EXISTS inactive_reason text;
CREATE TABLE IF NOT EXISTS app.dashboards (
  database_id int REFERENCES app.databases(id) ON DELETE CASCADE, key text NOT NULL, layout jsonb NOT NULL,
  cards jsonb NOT NULL DEFAULT '[]'::jsonb, tray jsonb NOT NULL DEFAULT '[]'::jsonb, updated_by int,
  updated_at timestamptz DEFAULT now(), PRIMARY KEY (database_id, key));
CREATE TABLE IF NOT EXISTS app.catalog_snapshots (
  database_id int PRIMARY KEY REFERENCES app.databases(id) ON DELETE CASCADE, data jsonb NOT NULL,
  built_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS app.sources (
  database_id int PRIMARY KEY REFERENCES app.databases(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('postgres','mysql')), dsn_enc text NOT NULL, dsn_masked text NOT NULL,
  source_schema text NOT NULL, target_schema text NOT NULL, schedule_minutes int NOT NULL DEFAULT 0,
  lookback_minutes int NOT NULL DEFAULT 5, last_run_at timestamptz, created_by int REFERENCES app.users(id),
  created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS app.source_tables (
  database_id int REFERENCES app.sources(database_id) ON DELETE CASCADE, name text NOT NULL,
  keys text[] NOT NULL DEFAULT '{}', cursor_column text, enabled boolean NOT NULL DEFAULT true, watermark jsonb,
  source_rows bigint, target_rows bigint, last_synced_at timestamptz, last_status text, last_error text,
  PRIMARY KEY (database_id, name));
CREATE TABLE IF NOT EXISTS app.sync_runs (
  id bigserial PRIMARY KEY, database_id int REFERENCES app.databases(id) ON DELETE CASCADE, trigger text NOT NULL,
  full_refresh boolean NOT NULL DEFAULT false, status text NOT NULL, current_table text,
  tables jsonb NOT NULL DEFAULT '[]'::jsonb, error text, started_by int REFERENCES app.users(id),
  started_at timestamptz DEFAULT now(), finished_at timestamptz, ms int);
ALTER TABLE app.sources ADD COLUMN IF NOT EXISTS paused boolean NOT NULL DEFAULT false;
ALTER TABLE app.sources ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'prod'
  CHECK (environment IN ('prod','staging','dev'));
ALTER TABLE app.sync_runs ADD COLUMN IF NOT EXISTS plan jsonb;
"""

USERS = [
    ("engineer@lvda.dev", "Minh (Data Engineer)", "engineer", True),
    ("analyst@lvda.dev", "Lan (Data Analyst)", "viewer", False),
    ("guest@lvda.dev", "Khách (chưa có quyền)", None, False),
]
PASSWORD = "lvda1234"


def _load_raw(conn: psycopg.Connection) -> None:
    data = generate()
    order = ["customers", "geolocation", "sellers", "product_category_name_translation", "products",
             "orders", "order_items", "order_payments", "order_reviews"]
    for table in order:
        with conn.cursor() as cur, cur.copy(f"COPY raw.{table} FROM STDIN") as copy:
            for row in data[table]:
                copy.write_row(row)
        print(f"  raw.{table}: {len(data[table]):,} dòng")


OLIST_FILES = {
    "customers": "olist_customers_dataset.csv", "geolocation": "olist_geolocation_dataset.csv",
    "sellers": "olist_sellers_dataset.csv", "product_category_name_translation": "product_category_name_translation.csv",
    "products": "olist_products_dataset.csv", "orders": "olist_orders_dataset.csv",
    "order_items": "olist_order_items_dataset.csv", "order_payments": "olist_order_payments_dataset.csv",
    "order_reviews": "olist_order_reviews_dataset.csv",
}


def load_olist_csv(conn: psycopg.Connection, folder: Path) -> dict[str, int]:
    """DATA-01: nạp 9 file CSV Olist (Kaggle) vào raw. Idempotent: xóa sạch rồi nạp lại trong một giao dịch."""
    missing = [f for f in OLIST_FILES.values() if not (folder / f).exists()]
    if missing:
        raise SystemExit(f"Thiếu file trong {folder}: {', '.join(missing)}")
    counts: dict[str, int] = {}
    with conn.transaction():
        conn.execute("TRUNCATE " + ", ".join(f"raw.{t}" for t in OLIST_FILES))
        for table, fname in OLIST_FILES.items():
            with conn.cursor() as cur, cur.copy(f"COPY raw.{table} FROM STDIN WITH (FORMAT csv, HEADER true)") as copy, \
                    open(folder / fname, "rb") as fh:
                while chunk := fh.read(1 << 20):
                    copy.write(chunk)
            counts[table] = conn.execute(f"SELECT count(*) FROM raw.{table}").fetchone()[0]
            print(f"  raw.{table}: {counts[table]:,} dòng")
    if counts.get("orders") and counts["orders"] != 99_441:
        print(f"  Cảnh báo: raw.orders có {counts['orders']:,} dòng, bộ Kaggle chuẩn có 99.441.")
    return counts


def _create_mart(conn: psycopg.Connection) -> None:
    conn.execute("DROP SCHEMA IF EXISTS mart CASCADE; CREATE SCHEMA mart;")
    for path in config.mart_files():
        conn.execute(f"CREATE VIEW mart.{path.stem} AS\n{path.read_text(encoding='utf-8')}")
        print(f"  mart.{path.stem}")


def _reader_role(conn: psycopg.Connection) -> None:
    exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname = 'lvda_reader'").fetchone()
    if not exists:
        conn.execute("CREATE ROLE lvda_reader LOGIN PASSWORD 'lvda_reader'")
    conn.execute("""
        REVOKE ALL ON SCHEMA public FROM PUBLIC;
        REVOKE ALL ON SCHEMA app FROM PUBLIC;
        GRANT USAGE ON SCHEMA raw, mart TO lvda_reader;
        GRANT SELECT ON ALL TABLES IN SCHEMA raw TO lvda_reader;
        GRANT SELECT ON ALL TABLES IN SCHEMA mart TO lvda_reader;
        ALTER ROLE lvda_reader SET statement_timeout = '10s';
        ALTER ROLE lvda_reader SET default_transaction_read_only = on;
    """)


def _seed_descriptions(conn: psycopg.Connection) -> None:
    """DATA-04: mô tả tiếng Việt cho bảng và cột mart. Trong MVP là bản "LLM viết" sẵn, chờ engineer duyệt."""
    if conn.execute("SELECT count(*) FROM app.column_descriptions").fetchone()[0]:
        return
    meta = yaml.safe_load(config.SCHEMA_YML.read_text(encoding="utf-8"))
    db_id = conn.execute("SELECT min(id) FROM app.databases").fetchone()[0]
    n = 0
    for table, cols in (meta.get("descriptions") or {}).items():
        for col, text in cols.items():
            name = table if col == "_table" else f"{table}.{col}"
            conn.execute("INSERT INTO app.column_descriptions (database_id, column_name, description) VALUES (%s,%s,%s)",
                         (db_id, name, text))
            n += 1
    print(f"  app: {n} mô tả bảng/cột (trạng thái nháp)")


def _seed_app(conn: psycopg.Connection) -> None:
    conn.execute(APP_DDL)
    if conn.execute("SELECT count(*) AS n FROM app.users").fetchone()[0]:
        print("  app: đã có dữ liệu, bỏ qua seed")
        return
    pw = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt()).decode()
    db_id = conn.execute(
        "INSERT INTO app.databases (name, description) VALUES (%s, %s) RETURNING id",
        ("Olist · Thương mại điện tử", "Dữ liệu giả lập theo schema Olist (Brazil, 10/2016 – 08/2018)"),
    ).fetchone()[0]
    ids = {}
    for email, name, role, certify in USERS:
        uid = conn.execute("INSERT INTO app.users (email, name, password_hash) VALUES (%s,%s,%s) RETURNING id",
                           (email, name, pw)).fetchone()[0]
        ids[email] = uid
        if role:
            conn.execute("INSERT INTO app.database_members (database_id, user_id, role, can_certify) VALUES (%s,%s,%s,%s)",
                         (db_id, uid, role, certify))
    metrics = yaml.safe_load(config.METRICS_YML.read_text(encoding="utf-8"))
    eng = ids["engineer@lvda.dev"]
    for m in metrics:
        status = m.get("status", "draft")
        conn.execute(
            "INSERT INTO app.metrics (database_id, id, name_vi, status, owner, current_version, certified_by, certified_at) "
            "VALUES (%s,%s,%s,%s,%s,1,%s, CASE WHEN %s THEN now() END)",
            (db_id, m["id"], m["name_vi"], status, m.get("owner"), eng if status == "certified" else None, status == "certified"))
        conn.execute(
            "INSERT INTO app.metric_versions (database_id, metric_id, version, spec, yaml, created_by) VALUES (%s,%s,1,%s,%s,%s)",
            (db_id, m["id"], psycopg.types.json.Jsonb(m), yaml.safe_dump(m, allow_unicode=True, sort_keys=False), eng))
    print(f"  app: {len(USERS)} tài khoản, {len(metrics)} chỉ số")


def main(reset: bool = False, olist_dir: Path | None = None, enterprise: bool = True) -> None:
    with psycopg.connect(config.OWNER_DSN, autocommit=True) as conn:
        if reset:
            for (s,) in conn.execute("SELECT nspname FROM pg_namespace WHERE nspname ~ '^src_[0-9]+$'").fetchall():
                conn.execute(f"DROP SCHEMA {s} CASCADE")  # bản sao của các nguồn đồng bộ
            conn.execute("DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS mart CASCADE; DROP SCHEMA IF EXISTS raw CASCADE;"
                         "DROP SCHEMA IF EXISTS ent_mart CASCADE; DROP SCHEMA IF EXISTS ent_stg CASCADE; DROP SCHEMA IF EXISTS ent_raw CASCADE;")
        has_raw = conn.execute("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'raw'").fetchone()
        if not has_raw:
            conn.execute("CREATE SCHEMA raw;")
            conn.execute(RAW_DDL)
            if olist_dir is None:
                print("Nạp dữ liệu giả lập vào raw…")
                _load_raw(conn)
        if olist_dir is not None:
            print(f"Nạp CSV Olist từ {olist_dir}…")
            conn.execute("DROP SCHEMA IF EXISTS mart CASCADE")
            load_olist_csv(conn, olist_dir)
        print("Tạo lớp mart…")
        _create_mart(conn)
        print("Tạo metadata app…")
        _seed_app(conn)
        _seed_descriptions(conn)
        _reader_role(conn)
        if enterprise:
            from lvda.seed.enterprise import ensure_enterprise
            ensure_enterprise(conn)
    # Ghi dấu vân tay của chỉ số đã chứng nhận để phát hiện thay đổi lineage về sau (MET-06).
    from lvda.warehouse import stamp_metric_hashes
    print(f"  app: ghi dấu vân tay cho {stamp_metric_hashes()} chỉ số")
    if enterprise:
        from lvda.seed.enterprise import ensure_snapshot
        ensure_snapshot()
    print("Xong.")


if __name__ == "__main__":
    folder = None
    if "--olist-dir" in sys.argv:
        folder = Path(sys.argv[sys.argv.index("--olist-dir") + 1])
    main(reset="--reset" in sys.argv, olist_dir=folder, enterprise="--no-enterprise" not in sys.argv)
