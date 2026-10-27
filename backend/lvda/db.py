"""Kết nối Postgres: owner cho metadata (schema app), reader chỉ đọc cho warehouse."""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from lvda import config

Row = dict[str, Any]


@contextmanager
def app_conn() -> Iterator[psycopg.Connection[Row]]:
    with psycopg.connect(config.OWNER_DSN, row_factory=dict_row, autocommit=False) as conn:
        yield conn


def fetch_all(sql: str, params: Any = None) -> list[Row]:
    with app_conn() as conn:
        return list(conn.execute(sql, params).fetchall())


def fetch_one(sql: str, params: Any = None) -> Row | None:
    with app_conn() as conn:
        return conn.execute(sql, params).fetchone()


def execute(sql: str, params: Any = None) -> Row | None:
    """Chạy một câu ghi; trả dòng RETURNING nếu có."""
    with app_conn() as conn:
        cur = conn.execute(sql, params)
        row = cur.fetchone() if cur.description else None
        conn.commit()
        return row


def jsonb(value: Any) -> Jsonb:
    return Jsonb(value)


def run_readonly(sql: str, max_rows: int = config.MAX_ROWS) -> Row:
    """Chạy SQL bằng role chỉ đọc, có timeout và giới hạn dòng."""
    with psycopg.connect(config.READER_DSN, autocommit=False) as conn:
        conn.execute(f"SET LOCAL statement_timeout = {config.STATEMENT_TIMEOUT_MS}")
        conn.execute("SET LOCAL default_transaction_read_only = on")
        cur = conn.execute(sql)  # SQL động đã qua guard + role chỉ đọc
        columns = [d.name for d in cur.description] if cur.description else []
        rows = cur.fetchmany(max_rows + 1)
        conn.rollback()
    truncated = len(rows) > max_rows
    return {
        "columns": columns,
        "rows": [[_jsonable(v) for v in r] for r in rows[:max_rows]],
        "truncated": truncated,
    }


def _jsonable(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v
