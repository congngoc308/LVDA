"""Nguồn dữ liệu ngoài (Postgres / MySQL) và đồng bộ tăng dần.

LVDA đọc nguồn bằng một role không có quyền ghi (kiểm khi kết nối, phiên mở ở chế độ read-only) rồi chép từng bảng
vào schema riêng `src_<id>` trong Postgres của LVDA. Bảng có khóa chính và cột mốc (updated_at, hoặc id tăng dần với
bảng chỉ thêm) được đồng bộ tăng dần: mỗi lần chỉ đọc dòng có mốc >= mốc lần trước trừ `lookback` phút (để không sót
giao dịch commit muộn), phân trang theo (mốc, khóa), ghi đè theo khóa. Bảng không có cột mốc thì làm mới toàn bộ.
Dòng bị xóa ở nguồn không đi theo đường tăng dần: so số dòng hai bên để phát hiện, "làm mới toàn bộ" để sửa.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import socket
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal
from urllib.parse import quote, unquote, urlparse, urlunparse

import psycopg
from psycopg import sql as pgsql
from cryptography.fernet import Fernet, InvalidToken

from lvda import config, db

log = logging.getLogger("lvda.sync")

Kind = Literal["postgres", "mysql"]
BATCH = 5_000
MAX_NOKEY_ROWS = 200_000  # bảng không có khóa chỉ làm mới toàn bộ, và chỉ khi đủ nhỏ
SCHEDULES = (0, 15, 60, 1440)
TIME_TYPES = ("timestamp", "datetime", "date")
NUM_TYPES = ("smallint", "integer", "bigint", "int", "mediumint", "tinyint", "serial")
CURSOR_HINTS = ("updated_at", "modified_at", "last_modified", "updated", "last_update", "changed_at", "update_time")


class SourceError(Exception):
    """Lỗi người dùng cần thấy (kết nối hỏng, role có quyền ghi, bảng không còn...).
    `field`: ô nhập gây lỗi (host, port, database, user, password, schema) để giao diện tô đúng chỗ."""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.field = field


class Busy(Exception):
    pass


# ---------------------------------------------------------------- chuỗi kết nối: mã hóa khi lưu, không bao giờ trả ra
def _fernet() -> Fernet:
    key = config.SECRET_KEY or base64.urlsafe_b64encode(hashlib.sha256(("lvda-dsn:" + config.JWT_SECRET).encode()).digest()).decode()
    return Fernet(key)


def encrypt(dsn: str) -> str:
    return _fernet().encrypt(dsn.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as e:
        raise SourceError("Không giải mã được chuỗi kết nối (khóa LVDA_SECRET_KEY đã đổi?). Hãy kết nối lại nguồn.") from e


def parse_dsn(kind: Kind, dsn: str) -> dict[str, Any]:
    u = urlparse(dsn.strip())
    schemes = {"postgres": ("postgresql", "postgres"), "mysql": ("mysql",)}[kind]
    if u.scheme not in schemes:
        example = "postgresql://user:mật_khẩu@host:5432/tên_db" if kind == "postgres" else "mysql://user:mật_khẩu@host:3306/tên_db"
        raise SourceError(f"Chuỗi kết nối chưa đúng dạng. Ví dụ: {example}")
    try:
        port = u.port
    except ValueError as e:
        raise SourceError("Cổng phải là một số từ 1 đến 65535.", "port") from e
    if not u.hostname:
        raise SourceError("Thiếu host.", "host")
    if not u.username:
        raise SourceError("Thiếu user.", "user")
    database = unquote(u.path.lstrip("/"))
    if not database:
        raise SourceError("Thiếu tên database.", "database")
    return {"host": u.hostname, "port": port or (5432 if kind == "postgres" else 3306), "user": unquote(u.username),
            "password": unquote(u.password or ""), "database": database}


def with_credentials(kind: Kind, dsn: str, user: str | None, password: str) -> str:
    """Thay user/mật khẩu trong chuỗi kết nối đã lưu (giữ host, cổng, database, tham số như sslmode)."""
    p = parse_dsn(kind, dsn)
    u = urlparse(dsn.strip())
    netloc = f"{quote(user or p['user'], safe='')}:{quote(password, safe='')}@{u.hostname}" + (f":{u.port}" if u.port else "")
    return urlunparse(u._replace(netloc=netloc))


def mask(kind: Kind, dsn: str) -> str:
    p = parse_dsn(kind, dsn)
    return f"{p['user']}@{p['host']}:{p['port']}/{p['database']}"


# ---------------------------------------------------------------- mô tả bảng nguồn
@dataclass
class Column:
    name: str
    type: str  # kiểu ở nguồn
    target: str  # kiểu khi chép vào Postgres của LVDA
    comment: str | None = None

    @property
    def cursor_kind(self) -> str | None:
        t = self.type.lower()
        if any(x in t for x in TIME_TYPES) and "[]" not in t:
            return "time"
        if t.split("(")[0].replace(" unsigned", "").strip() in NUM_TYPES:
            return "num"
        return None


@dataclass
class TableInfo:
    name: str
    columns: list[Column]
    primary_key: list[str] = field(default_factory=list)
    rows_estimate: int | None = None
    readable: bool = True
    comment: str | None = None

    def col(self, name: str) -> Column | None:
        return next((c for c in self.columns if c.name == name), None)

    @property
    def cursor_candidates(self) -> list[str]:
        return [c.name for c in self.columns if c.cursor_kind]

    @property
    def suggested_cursor(self) -> str | None:
        times = [c.name for c in self.columns if c.cursor_kind == "time"]
        for hint in CURSOR_HINTS:
            if hint in times:
                return hint
        return None

    def public(self) -> dict[str, Any]:
        return {"name": self.name, "columns": [{"name": c.name, "type": c.type} for c in self.columns],
                "primary_key": self.primary_key, "rows_estimate": self.rows_estimate, "readable": self.readable,
                "cursor_candidates": self.cursor_candidates, "suggested_cursor": self.suggested_cursor}


@dataclass
class ForeignKey:
    child: str
    child_col: str
    parent: str
    parent_col: str


_PG_KEEP = ("smallint", "integer", "bigint", "numeric", "real", "double precision", "boolean", "text", "character varying",
            "character", "date", "timestamp without time zone", "timestamp with time zone", "time without time zone",
            "time with time zone", "interval", "json", "jsonb", "uuid", "bytea", "inet")


def pg_target(t: str) -> str:
    base = re.sub(r"\(.*?\)", "", t).replace("[]", "").strip()
    if base in ("json", "jsonb"):
        return "jsonb"
    if base in _PG_KEEP:
        return t
    return "text"  # enum, kiểu tự định nghĩa, money...


def mysql_target(data_type: str, column_type: str) -> str:
    dt, ct = data_type.lower(), column_type.lower()
    if dt in ("tinyint", "smallint", "mediumint", "year"):
        return "integer"
    if dt in ("int", "integer"):
        return "bigint"
    if dt == "bigint":
        return "numeric(20)" if "unsigned" in ct else "bigint"
    if dt in ("decimal", "numeric"):
        m = re.search(r"\((\d+),(\d+)\)", ct)
        return f"numeric({m.group(1)},{m.group(2)})" if m else "numeric"
    if dt == "float":
        return "real"
    if dt == "double":
        return "double precision"
    if dt == "date":
        return "date"
    if dt in ("datetime", "timestamp"):
        return "timestamp"
    if dt == "json":
        return "jsonb"
    if dt in ("binary", "varbinary", "blob", "tinyblob", "mediumblob", "longblob"):
        return "bytea"
    return "text"  # char/varchar/text/enum/set/time/bit...


# ---------------------------------------------------------------- bộ đọc nguồn
class Source:
    kind: Kind
    schema: str
    conn: Any

    def q(self, name: str) -> str:
        raise NotImplementedError

    def fq(self, table: str) -> str:
        return f"{self.q(self.schema)}.{self.q(table)}"

    def tables(self) -> list[TableInfo]:
        raise NotImplementedError

    def foreign_keys(self) -> list[ForeignKey]:
        raise NotImplementedError

    def write_privileges(self) -> list[str]:
        """Những quyền ghi role đang có. Rỗng nghĩa là role chỉ đọc."""
        raise NotImplementedError

    def server(self) -> str:
        raise NotImplementedError

    def _rows(self, sql: str, params: list[Any]) -> list[tuple[Any, ...]]:
        cur = self.conn.cursor()
        cur.execute(sql, params)
        return list(cur.fetchall())

    def count(self, table: str) -> int:
        return int(self._rows(f"SELECT count(*) FROM {self.fq(table)}", [])[0][0])

    def batches(self, table: str, cols: list[str], keys: list[str], cursor: str | None, low: Any,
                size: int = BATCH) -> Iterator[list[tuple[Any, ...]]]:
        """Đọc theo trang: ORDER BY (mốc, khóa) và lấy tiếp sau dòng cuối của trang trước (keyset, không OFFSET)."""
        sel = ", ".join(self.q(c) for c in cols)
        if not keys:
            rows = self._rows(f"SELECT {sel} FROM {self.fq(table)} LIMIT {MAX_NOKEY_ROWS + 1}", [])
            if len(rows) > MAX_NOKEY_ROWS:
                raise SourceError(f"Bảng {table} không có khóa chính và có hơn {MAX_NOKEY_ROWS:,} dòng: chưa chép được.")
            yield rows
            return
        order = ([cursor] if cursor else []) + keys
        pos = [cols.index(c) for c in order]
        after: list[Any] | None = None
        while True:
            where, params = [], []
            if cursor:
                where.append(f"{self.q(cursor)} IS NOT NULL")
                if low is not None:
                    where.append(f"{self.q(cursor)} >= %s")
                    params.append(low)
            if after is not None:
                where.append(f"({', '.join(self.q(c) for c in order)}) > ({', '.join(['%s'] * len(order))})")
                params += after
            sql = (f"SELECT {sel} FROM {self.fq(table)}" + (f" WHERE {' AND '.join(where)}" if where else "")
                   + f" ORDER BY {', '.join(self.q(c) for c in order)} LIMIT {size}")
            rows = self._rows(sql, params)
            if not rows:
                return
            yield rows
            if len(rows) < size:
                return
            after = [rows[-1][i] for i in pos]

    def close(self) -> None:
        try:
            self.conn.close()
        except Exception:
            pass


class PgSource(Source):
    kind: Kind = "postgres"

    def __init__(self, dsn: str, schema: str | None):
        self.schema = schema or "public"
        try:
            # phiên read-only ở phía server: kể cả role lỡ có quyền ghi thì câu ghi cũng bị từ chối
            self.conn = psycopg.connect(dsn, connect_timeout=5, autocommit=True,
                                        options="-c default_transaction_read_only=on -c statement_timeout=120000")
        except psycopg.Error as e:
            raise _conn_error(e, dsn) from e
        if not self._rows("SELECT 1 FROM pg_namespace WHERE nspname = %s", [self.schema]):
            self.close()
            raise SourceError(f"Database nguồn không có schema “{self.schema}”.", "schema")

    def q(self, name: str) -> str:
        return '"' + name.replace('"', '""') + '"'

    def server(self) -> str:
        v = self.conn.info.server_version
        return f"PostgreSQL {v // 10000}.{v % 10000}"

    def tables(self) -> list[TableInfo]:
        rows = self._rows(
            """SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod), col_description(c.oid, a.attnum),
                      has_table_privilege(c.oid, 'SELECT'), c.reltuples::bigint, obj_description(c.oid, 'pg_class')
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
               WHERE n.nspname = %s AND c.relkind IN ('r', 'p') ORDER BY c.relname, a.attnum""", [self.schema])
        out: dict[str, TableInfo] = {}
        for t, col, typ, comment, readable, est, tcomment in rows:
            info = out.setdefault(t, TableInfo(t, [], rows_estimate=max(int(est), 0) if est is not None and est >= 0 else None,
                                               readable=bool(readable), comment=tcomment))
            info.columns.append(Column(col, typ, pg_target(typ), comment))
        for t, col in self._rows(
                """SELECT c.relname, a.attname FROM pg_constraint x
                   JOIN pg_class c ON c.oid = x.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                   CROSS JOIN LATERAL unnest(x.conkey) WITH ORDINALITY AS k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
                   WHERE x.contype = 'p' AND n.nspname = %s ORDER BY c.relname, k.ord""", [self.schema]):
            if t in out:
                out[t].primary_key.append(col)
        return list(out.values())

    def foreign_keys(self) -> list[ForeignKey]:
        return [ForeignKey(*r) for r in self._rows(
            """SELECT c.relname, a.attname, p.relname, pa.attname FROM pg_constraint x
               JOIN pg_class c ON c.oid = x.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN pg_class p ON p.oid = x.confrelid
               JOIN pg_attribute a ON a.attrelid = x.conrelid AND a.attnum = x.conkey[1]
               JOIN pg_attribute pa ON pa.attrelid = x.confrelid AND pa.attnum = x.confkey[1]
               WHERE x.contype = 'f' AND n.nspname = %s AND array_length(x.conkey, 1) = 1""", [self.schema])]

    def write_privileges(self) -> list[str]:
        out = []
        sup, repl, createrole, createdb = self._rows(
            "SELECT rolsuper, rolreplication, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user", [])[0]
        for flag, label in ((sup, "SUPERUSER"), (repl, "REPLICATION"), (createrole, "CREATEROLE"), (createdb, "CREATEDB")):
            if flag:
                out.append(f"role có thuộc tính {label}")
        if self._rows("SELECT has_database_privilege(current_database(), 'CREATE')", [])[0][0]:
            out.append("CREATE trên database (tạo được schema)")
        if self._rows("SELECT has_schema_privilege(%s, 'CREATE')", [self.schema])[0][0]:
            out.append(f"CREATE trên schema {self.schema}")
        writable = [r[0] for r in self._rows(
            """SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = %s AND c.relkind IN ('r', 'p')
                 AND (has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE')
                      OR has_table_privilege(c.oid, 'DELETE') OR has_table_privilege(c.oid, 'TRUNCATE'))
               ORDER BY c.relname LIMIT 6""", [self.schema])]
        if writable:
            out.append("INSERT/UPDATE/DELETE trên bảng " + ", ".join(writable[:5]) + (" …" if len(writable) > 5 else ""))
        return out


_MYSQL_READ = {"SELECT", "SHOW VIEW", "USAGE", "SHOW DATABASES", "PROCESS", "REPLICATION CLIENT"}


class MySqlSource(Source):
    kind: Kind = "mysql"

    def __init__(self, dsn: str, schema: str | None):
        import pymysql

        p = parse_dsn("mysql", dsn)
        self.schema = schema or p["database"]
        try:
            self.conn = pymysql.connect(host=p["host"], port=p["port"], user=p["user"], password=p["password"],
                                        database=p["database"], connect_timeout=5, read_timeout=180, charset="utf8mb4",
                                        autocommit=True)
            cur = self.conn.cursor()
            cur.execute("SET SESSION TRANSACTION READ ONLY")
            cur.execute("SET SESSION MAX_EXECUTION_TIME = 120000")
        except pymysql.MySQLError as e:
            raise _conn_error(e, dsn) from e

    def q(self, name: str) -> str:
        return "`" + name.replace("`", "``") + "`"

    def server(self) -> str:
        return "MySQL " + str(self._rows("SELECT VERSION()", [])[0][0])

    def tables(self) -> list[TableInfo]:
        rows = self._rows(
            """SELECT c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, c.COLUMN_TYPE, c.COLUMN_COMMENT, t.TABLE_ROWS, t.TABLE_COMMENT
               FROM information_schema.COLUMNS c JOIN information_schema.TABLES t
                 ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
               WHERE c.TABLE_SCHEMA = %s AND t.TABLE_TYPE = 'BASE TABLE'
               ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION""", [self.schema])
        out: dict[str, TableInfo] = {}
        for t, col, dt, ct, comment, est, tcomment in rows:
            info = out.setdefault(t, TableInfo(t, [], rows_estimate=int(est) if est is not None else None, comment=tcomment or None))
            info.columns.append(Column(col, str(ct), mysql_target(str(dt), str(ct)), comment or None))
        for t, col in self._rows(
                """SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
                   WHERE TABLE_SCHEMA = %s AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY TABLE_NAME, ORDINAL_POSITION""", [self.schema]):
            if t in out:
                out[t].primary_key.append(col)
        return list(out.values())

    def foreign_keys(self) -> list[ForeignKey]:
        rows = self._rows(
            """SELECT k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME
               FROM information_schema.KEY_COLUMN_USAGE k
               WHERE k.TABLE_SCHEMA = %s AND k.REFERENCED_TABLE_NAME IS NOT NULL
                 AND (SELECT count(*) FROM information_schema.KEY_COLUMN_USAGE k2
                      WHERE k2.TABLE_SCHEMA = k.TABLE_SCHEMA AND k2.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND k2.TABLE_NAME = k.TABLE_NAME) = 1""",
            [self.schema])
        return [ForeignKey(*r) for r in rows]

    def write_privileges(self) -> list[str]:
        out = []
        for (line,) in self._rows("SHOW GRANTS FOR CURRENT_USER()", []):
            m = re.match(r"GRANT (.+?) ON (\S+) TO", str(line))
            if not m:  # GRANT `role` TO user: không đọc được quyền của role nên coi như chưa chắc chỉ đọc
                out.append(f"được gán role ({line}); hãy dùng user chỉ có SELECT")
                continue
            privs = {p.strip().upper() for p in m.group(1).split(",")}
            extra = sorted(privs - _MYSQL_READ)
            if extra:
                out.append(f"{', '.join(extra)} trên {m.group(2)}")
        return out


_CONN_ERRORS: list[tuple[tuple[str, ...], str, str]] = [
    # (dấu hiệu trong thông báo của driver, ô nhập, lời giải thích)
    (("password authentication failed", "access denied", "(1045"), "password", "Sai user hoặc mật khẩu."),
    (("role \"",), "user", "Server không có user này."),
    (("unknown database", "(1049"), "database", "Server không có database này."),
    (("could not translate host name", "name or service not known", "nodename nor servname", "getaddrinfo",
      "temporary failure in name resolution", "(2005"), "host", "Không tìm thấy host này."),
    (("connection refused", "timeout expired", "timed out", "(2003", "no route to host", "network is unreachable"), "host",
     "Không mở được kết nối tới host và cổng này: server đang tắt, sai cổng, hoặc tường lửa chặn."),
]


def _conn_error(e: Exception, dsn: str) -> SourceError:
    msg = str(e).strip().splitlines()[0] if str(e).strip() else type(e).__name__
    p = urlparse(dsn.strip())
    if p.password:
        msg = msg.replace(unquote(p.password), "***")
    low = msg.lower()
    hint = ""
    if p.hostname in ("localhost", "127.0.0.1") and os.getenv("LVDA_IN_DOCKER"):
        hint = " LVDA đang chạy trong Docker nên “localhost” là chính nó: dùng host.docker.internal hoặc tên service."
    if "database \"" in low and "does not exist" in low:
        return SourceError("Server không có database này.", "database")
    for signs, field_name, text in _CONN_ERRORS:
        if any(s in low for s in signs) and (field_name != "user" or "does not exist" in low):
            return SourceError(text + (hint if field_name == "host" else ""), field_name)
    return SourceError(f"Không kết nối được tới nguồn: {msg}.{hint}")


def open_source(kind: Kind, dsn: str, schema: str | None) -> Source:
    parse_dsn(kind, dsn)
    return PgSource(dsn, schema) if kind == "postgres" else MySqlSource(dsn, schema)


def inspect(kind: Kind, dsn: str, schema: str | None) -> dict[str, Any]:
    """Bước "Kiểm tra kết nối": phiên bản, role có chỉ đọc không, danh sách bảng với khóa và cột mốc gợi ý."""
    src = open_source(kind, dsn, schema)
    try:
        problems = src.write_privileges()
        tables = src.tables()
        return {"server": src.server(), "schema": src.schema, "read_only": not problems, "problems": problems,
                "tables": [t.public() for t in tables], "masked": mask(kind, dsn)}
    finally:
        src.close()


CHECKS = (("network", "Mạng"), ("auth", "Xác thực"), ("readonly", "Role chỉ đọc"), ("schema", "Đọc schema"))


def check(kind: Kind, dsn: str, schema: str | None) -> dict[str, Any]:
    """Kiểm tra theo 4 bước để biết hỏng ở đâu: mạng (mở được cổng) → xác thực (đăng nhập, có database)
    → role chỉ đọc → đọc được schema. Bước hỏng dừng các bước sau (đánh dấu "skip")."""
    steps = {k: {"id": k, "label": label, "status": "skip", "detail": None} for k, label in CHECKS}
    out: dict[str, Any] = {"checks": list(steps.values()), "ok": False, "error": None}

    def fail(step: str, e: SourceError) -> dict[str, Any]:
        steps[step].update(status="fail", detail=str(e))
        out["error"] = {"message": str(e), "field": e.field}
        return out

    try:
        p = parse_dsn(kind, dsn)
    except SourceError as e:
        return fail("network", e)
    t0 = time.perf_counter()
    try:
        socket.create_connection((p["host"], p["port"]), timeout=4).close()
    except socket.gaierror:
        return fail("network", SourceError("Không tìm thấy host này." + _docker_hint(p["host"]), "host"))
    except OSError:
        return fail("network", SourceError(f"Không mở được cổng {p['port']}: server đang tắt, sai cổng, hoặc tường lửa chặn."
                                           + _docker_hint(p["host"]), "port"))
    steps["network"].update(status="ok", detail=f"{p['host']}:{p['port']} trả lời sau {int((time.perf_counter() - t0) * 1000)} ms")
    try:
        src = open_source(kind, dsn, schema)
    except SourceError as e:
        if e.field == "schema":  # đã đăng nhập được, chỉ thiếu schema
            steps["auth"].update(status="ok", detail=f"đăng nhập bằng {p['user']}")
            return fail("schema", e)
        return fail("auth", e)
    try:
        steps["auth"].update(status="ok", detail=f"{src.server()} · user {p['user']} · database {p['database']}")
        problems = src.write_privileges()
        tables = src.tables()
        out.update(server=src.server(), schema=src.schema, read_only=not problems, problems=problems,
                   tables=[t.public() for t in tables], masked=mask(kind, dsn))
        if problems:
            steps["readonly"].update(status="fail", detail="có quyền ghi: " + "; ".join(problems))
            out["error"] = {"message": "Role này có quyền ghi nên LVDA không dùng.", "field": "user"}
            return out
        steps["readonly"].update(status="ok", detail="chỉ có quyền đọc")
        readable = [t for t in tables if t.readable]
        if not readable:
            return fail("schema", SourceError(f"Schema {src.schema} không có bảng nào role đọc được.", "schema"))
        rows = sum(t.rows_estimate or 0 for t in readable)
        steps["schema"].update(status="ok", detail=f"{len(readable)} bảng trong {src.schema} · khoảng {rows:,} dòng".replace(",", "."))
        out["ok"] = True
        return out
    finally:
        src.close()


def _docker_hint(host: str) -> str:
    if host in ("localhost", "127.0.0.1") and os.getenv("LVDA_IN_DOCKER"):
        return " LVDA đang chạy trong Docker nên “localhost” là chính nó: dùng host.docker.internal hoặc tên service."
    return ""


# ---------------------------------------------------------------- mốc đồng bộ
def wm_dump(v: Any) -> dict[str, str] | None:
    if v is None:
        return None
    if isinstance(v, (datetime, date)):
        return {"t": "time", "v": v.isoformat()}
    return {"t": "num", "v": str(v)}


def wm_load(w: dict[str, str] | None) -> Any:
    if not w:
        return None
    if w["t"] == "time":
        return date.fromisoformat(w["v"]) if len(w["v"]) == 10 else datetime.fromisoformat(w["v"])
    return Decimal(w["v"]) if "." in w["v"] else int(w["v"])


def low_mark(w: dict[str, str] | None, lookback_minutes: int) -> Any:
    v = wm_load(w)
    if isinstance(v, datetime):
        return v - timedelta(minutes=lookback_minutes)
    if isinstance(v, date) and lookback_minutes:
        return v - timedelta(days=1)
    return v


def wm_label(w: dict[str, str] | None) -> str | None:
    return None if not w else w["v"]  # ISO đầy đủ (kèm múi giờ nếu có): giao diện đổi sang giờ địa phương


# ---------------------------------------------------------------- ghi vào Postgres của LVDA
def _qi(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _value(v: Any, target: str) -> Any:
    if isinstance(v, (dict, list)) and target == "jsonb":
        return json.dumps(v, ensure_ascii=False, default=str)
    if isinstance(v, (bytes, bytearray, memoryview)) and target != "bytea":
        return bytes(v).hex()
    if isinstance(v, timedelta):
        return str(v)
    return v


def ensure_table(conn: psycopg.Connection[Any], schema: str, t: TableInfo, cols: list[Column], keys: list[str]) -> bool:
    """Tạo bảng đích nếu chưa có. Cột hoặc khóa đổi ở nguồn thì dựng lại (trả True: cần chép lại từ đầu)."""
    want = [(c.name, c.target) for c in cols]
    have = conn.execute(
        """SELECT a.attname, format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = %s AND c.relname = %s AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum""",
        (schema, t.name)).fetchall()
    have_keys = [r[0] for r in conn.execute(
        """SELECT a.attname FROM pg_constraint x JOIN pg_class c ON c.oid = x.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
           CROSS JOIN LATERAL unnest(x.conkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
           WHERE x.contype = 'p' AND n.nspname = %s AND c.relname = %s ORDER BY k.ord""", (schema, t.name)).fetchall()]
    same = have and [h[0] for h in have] == [w[0] for w in want] and have_keys == keys
    if same:
        return False
    full = f"{_qi(schema)}.{_qi(t.name)}"
    conn.execute(f"DROP TABLE IF EXISTS {full}")
    body = ", ".join(f"{_qi(n)} {typ}" for n, typ in want) + (f", PRIMARY KEY ({', '.join(_qi(k) for k in keys)})" if keys else "")
    conn.execute(f"CREATE TABLE {full} ({body})")
    if t.comment:
        conn.execute(pgsql.SQL("COMMENT ON TABLE {} IS {}").format(pgsql.SQL(full), pgsql.Literal(t.comment)))
    conn.execute(f"GRANT SELECT ON {full} TO lvda_reader")
    return True


def write_batch(conn: psycopg.Connection[Any], schema: str, table: str, cols: list[Column], keys: list[str],
                rows: list[tuple[Any, ...]], fresh: bool = False) -> tuple[int, int]:
    """Chép một trang bằng COPY vào bảng tạm rồi upsert theo khóa. Trả (thêm mới, cập nhật).
    fresh=True (bảng đích vừa được làm trống): COPY thẳng vào bảng đích, không cần upsert."""
    full = f"{_qi(schema)}.{_qi(table)}"
    names = ", ".join(_qi(c.name) for c in cols)
    targets = [c.target for c in cols]
    if fresh:
        with conn.transaction(), conn.cursor().copy(f"COPY {full} ({names}) FROM STDIN") as cp:
            for r in rows:
                cp.write_row([_value(v, targets[i]) for i, v in enumerate(r)])
        return len(rows), 0
    with conn.transaction():
        conn.execute(f"CREATE TEMP TABLE IF NOT EXISTS _lvda_batch (LIKE {full}) ON COMMIT DROP")
        conn.execute("TRUNCATE _lvda_batch")
        with conn.cursor().copy(f"COPY _lvda_batch ({names}) FROM STDIN") as cp:
            for r in rows:
                cp.write_row([_value(v, targets[i]) for i, v in enumerate(r)])
        if not keys:
            conn.execute(f"INSERT INTO {full} ({names}) SELECT {names} FROM _lvda_batch")
            return len(rows), 0
        conflict = ", ".join(_qi(k) for k in keys)
        rest = [c.name for c in cols if c.name not in keys]
        # dòng đọc lại (do lùi mốc) mà không đổi thì không ghi, không đếm là "cập nhật"
        action = ("DO UPDATE SET " + ", ".join(f"{_qi(c)} = EXCLUDED.{_qi(c)}" for c in rest)
                  + f" WHERE ({', '.join(f't.{_qi(c)}' for c in rest)}) IS DISTINCT FROM ({', '.join(f'EXCLUDED.{_qi(c)}' for c in rest)})"
                  if rest else "DO NOTHING")
        # xmax = 0 nghĩa là dòng vừa được thêm, khác 0 là dòng cũ bị ghi đè
        res = conn.execute(f"INSERT INTO {full} AS t ({names}) SELECT {names} FROM _lvda_batch ON CONFLICT ({conflict}) {action} "
                           "RETURNING (xmax = 0)").fetchall()
        inserted = sum(1 for (x,) in res if x)
        return inserted, len(res) - inserted


# ---------------------------------------------------------------- đăng ký nguồn
def target_schema(database_id: int) -> str:
    return f"src_{database_id}"


def _validate_picks(tables: dict[str, TableInfo], picks: list[dict[str, Any]]) -> list[tuple[str, list[str], str | None]]:
    """Bảng chọn phải có ở nguồn và đọc được; khóa phải là cột có thật; cột mốc cần khóa và là cột thời gian/số."""
    if not picks:
        raise SourceError("Chọn ít nhất một bảng để đồng bộ.")
    rows = []
    for p in picks:
        t = tables.get(p["name"])
        if t is None:
            raise SourceError(f"Nguồn không có bảng {p['name']}.")
        if not t.readable:
            raise SourceError(f"Role không có quyền SELECT trên bảng {t.name}.")
        keys = list(p.get("keys") or t.primary_key)
        if any(t.col(k) is None for k in keys):
            raise SourceError(f"Khóa của bảng {t.name} có cột không tồn tại.")
        cursor = p.get("cursor")
        if cursor and (not keys or cursor not in t.cursor_candidates):
            raise SourceError(f"Cột mốc {cursor} của bảng {t.name} không dùng được (cần khóa và cột thời gian hoặc số tăng dần).")
        rows.append((t.name, keys, cursor))
    return rows


def create(user_id: int, name: str, kind: Kind, dsn: str, schema: str | None, picks: list[dict[str, Any]],
           schedule_minutes: int, lookback_minutes: int, environment: str = "prod") -> int:
    """Kiểm lại nguồn (role chỉ đọc, bảng/khóa/mốc hợp lệ), tạo database mới trong LVDA, người tạo là engineer."""
    src = open_source(kind, dsn, schema)
    try:
        problems = src.write_privileges()
        if problems:
            raise SourceError("Role của chuỗi kết nối có quyền ghi: " + "; ".join(problems) + ". LVDA chỉ nhận role chỉ đọc.")
        tables = {t.name: t for t in src.tables()}
        src_schema = src.schema
    finally:
        src.close()
    rows = _validate_picks(tables, picks)
    with db.app_conn() as conn:
        db_id = conn.execute("INSERT INTO app.databases (name, description) VALUES (%s, %s) RETURNING id",
                             (name.strip(), f"Đồng bộ từ {'PostgreSQL' if kind == 'postgres' else 'MySQL'} {mask(kind, dsn)}")).fetchone()["id"]
        sch = target_schema(db_id)
        spec = {"schemas": [sch], "source_schemas": [sch], "catalog_only": True, "meta": {"allowed_schemas": [sch]}}
        conn.execute("UPDATE app.databases SET settings = jsonb_build_object('warehouse', %s::jsonb) WHERE id = %s",
                     (json.dumps(spec), db_id))
        conn.execute("""INSERT INTO app.database_members (database_id, user_id, role, can_certify, granted_by)
                        VALUES (%s, %s, 'engineer', true, %s)""", (db_id, user_id, user_id))
        conn.execute("""INSERT INTO app.sources (database_id, kind, dsn_enc, dsn_masked, source_schema, target_schema,
                          schedule_minutes, lookback_minutes, environment, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                     (db_id, kind, encrypt(dsn), mask(kind, dsn), src_schema, sch, schedule_minutes, lookback_minutes, environment, user_id))
        for t_name, keys, cursor in rows:
            conn.execute("INSERT INTO app.source_tables (database_id, name, keys, cursor_column) VALUES (%s,%s,%s,%s)",
                         (db_id, t_name, keys, cursor))
        conn.commit()
    return int(db_id)


def describe(database_id: int) -> dict[str, Any] | None:
    s = db.fetch_one("""SELECT s.kind, s.dsn_masked, s.source_schema, s.target_schema, s.schedule_minutes, s.lookback_minutes,
                               s.paused, s.environment, s.last_run_at, s.created_at, d.name
                        FROM app.sources s JOIN app.databases d ON d.id = s.database_id WHERE s.database_id = %s""", (database_id,))
    if not s:
        return None
    tables = db.fetch_all("""SELECT name, keys, cursor_column, enabled, watermark, source_rows, target_rows, last_synced_at,
                                    last_status, last_error FROM app.source_tables WHERE database_id = %s ORDER BY name""", (database_id,))
    for t in tables:
        t["mode"] = "incremental" if t["cursor_column"] and t["keys"] else "full"
        t["watermark_label"] = wm_label(t.pop("watermark"))
        t["drift"] = (t["target_rows"] - t["source_rows"]) if t["target_rows"] is not None and t["source_rows"] is not None else None
    runs = db.fetch_all("""SELECT r.id, r.trigger, r.full_refresh, r.status, r.current_table, r.tables, r.plan, r.error, r.started_at,
                                  r.finished_at, r.ms, u.name AS started_by_name
                           FROM app.sync_runs r LEFT JOIN app.users u ON u.id = r.started_by
                           WHERE r.database_id = %s ORDER BY r.id DESC LIMIT 15""", (database_id,))
    next_at = None
    if s["schedule_minutes"] and s["last_run_at"] and not s["paused"]:
        next_at = s["last_run_at"] + timedelta(minutes=s["schedule_minutes"])
    return {**s, "tables": tables, "runs": runs, "running": next((r for r in runs if r["status"] == "running"), None),
            "next_run_at": next_at}


def update_schedule(database_id: int, schedule_minutes: int, lookback_minutes: int,
                    environment: str | None = None, name: str | None = None) -> None:
    db.execute("""UPDATE app.sources SET schedule_minutes = %s, lookback_minutes = %s, environment = coalesce(%s, environment)
                  WHERE database_id = %s""", (schedule_minutes, lookback_minutes, environment, database_id))
    if name and name.strip():
        db.execute("UPDATE app.databases SET name = %s WHERE id = %s", (name.strip(), database_id))


ENVIRONMENTS = ("prod", "staging", "dev")


def status_of(src: dict[str, Any] | None, last: dict[str, Any] | None, last_ok_at: datetime | None) -> str:
    """Một trạng thái cho danh sách nguồn: running / error / stale / paused / ok / never.
    "stale" (dữ liệu cũ): lần đồng bộ thành công gần nhất đã quá 2 lần chu kỳ lịch."""
    if src is None:
        return "builtin"
    if last and last["status"] == "running":
        return "running"
    if last and last["status"] in ("failed", "partial"):
        return "error"
    if src["paused"]:
        return "paused"
    if last_ok_at is None:
        return "never"
    if src["schedule_minutes"] and last_ok_at < datetime.now(last_ok_at.tzinfo) - timedelta(minutes=2 * src["schedule_minutes"]):
        return "stale"
    return "ok"


def list_for(user_id: int) -> list[dict[str, Any]]:
    """Mọi database người dùng là engineer: nguồn đồng bộ kèm trạng thái tổng hợp, database có sẵn ở nhóm riêng."""
    from lvda.catalog import catalog_for

    rows = db.fetch_all(
        """SELECT d.id, d.name, s.database_id AS src_id, s.kind, s.environment, s.dsn_masked, s.schedule_minutes, s.paused,
                  (SELECT count(*) FROM app.source_tables t WHERE t.database_id = d.id) AS tables,
                  (SELECT sum(target_rows) FROM app.source_tables t WHERE t.database_id = d.id) AS rows,
                  (SELECT max(finished_at) FROM app.sync_runs r WHERE r.database_id = d.id AND r.status = 'ok') AS last_ok_at,
                  lr.status AS last_status, lr.started_at AS last_started_at, lr.finished_at AS last_finished_at, lr.error AS last_error,
                  lr.tables AS last_tables, lr.plan AS last_plan, lr.trigger AS last_trigger
           FROM app.database_members m JOIN app.databases d ON d.id = m.database_id
           LEFT JOIN app.sources s ON s.database_id = d.id
           LEFT JOIN LATERAL (SELECT * FROM app.sync_runs r WHERE r.database_id = d.id ORDER BY r.id DESC LIMIT 1) lr ON true
           WHERE m.user_id = %s AND m.role = 'engineer' AND (m.expires_at IS NULL OR m.expires_at > now())
           ORDER BY d.name""", (user_id,))
    out = []
    for r in rows:
        last = {"status": r["last_status"]} if r["last_status"] else None
        src = {"paused": r["paused"], "schedule_minutes": r["schedule_minutes"]} if r["src_id"] else None
        item: dict[str, Any] = {
            "id": r["id"], "name": r["name"], "kind": r["kind"] or "postgres", "environment": r["environment"] if src else "builtin",
            "status": status_of(src, last, r["last_ok_at"]), "last_ok_at": r["last_ok_at"], "schedule_minutes": r["schedule_minutes"],
            "error": r["last_error"] or next((t.get("error") for t in (r["last_tables"] or []) if t.get("status") == "failed"), None),
            "last_at": r["last_finished_at"] or r["last_started_at"],
        }
        if src:
            masked = r["dsn_masked"]
            item.update(host=masked.split("@", 1)[1].split(":", 1)[0], database=masked.rsplit("/", 1)[1], tables=r["tables"],
                        rows=int(r["rows"]) if r["rows"] is not None else None)
            if item["status"] == "running":
                done = [t for t in (r["last_tables"] or []) if t.get("status") != "running"]
                item["progress"] = {"done": len(done), "total": len(r["last_plan"] or []) or r["tables"], "trigger": r["last_trigger"]}
        else:  # Olist, warehouse 500 bảng: có sẵn trong kho LVDA, không đồng bộ
            item.update(host="kho LVDA", database=None, tables=len(catalog_for(r["id"]).columns), rows=None)
        out.append(item)
    return out


# ---------------------------------------------------------------- quản lý sau khi kết nối
def _saved(database_id: int) -> dict[str, Any]:
    s = db.fetch_one("SELECT kind, dsn_enc, source_schema, target_schema FROM app.sources WHERE database_id = %s", (database_id,))
    if not s:
        raise SourceError("Database này không đồng bộ từ nguồn ngoài.")
    return s


def _not_running(database_id: int) -> None:
    if db.fetch_one("SELECT 1 FROM app.sync_runs WHERE database_id = %s AND status = 'running'", (database_id,)):
        raise Busy("Đang có một lần đồng bộ chạy. Đợi xong rồi thử lại.")


def inspect_saved(database_id: int) -> dict[str, Any]:
    """Đọc lại danh sách bảng ở nguồn bằng kết nối đã lưu (để thêm/bớt bảng), đánh dấu bảng đang đồng bộ."""
    s = _saved(database_id)
    out = inspect(s["kind"], decrypt(s["dsn_enc"]), s["source_schema"])
    synced = {r["name"]: r for r in db.fetch_all("SELECT name, cursor_column FROM app.source_tables WHERE database_id = %s", (database_id,))}
    for t in out["tables"]:
        t["synced"] = t["name"] in synced
        t["cursor"] = synced[t["name"]]["cursor_column"] if t["name"] in synced else None
    return out


def update_tables(database_id: int, picks: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Thay danh sách bảng: bảng mới được chép từ đầu ở lần chạy sau, bảng bỏ chọn bị xóa khỏi bản sao,
    bảng đổi cột mốc thì chép lại từ đầu (mốc cũ không còn nghĩa)."""
    _not_running(database_id)
    s = _saved(database_id)
    src = open_source(s["kind"], decrypt(s["dsn_enc"]), s["source_schema"])
    try:
        tables = {t.name: t for t in src.tables()}
    finally:
        src.close()
    rows = _validate_picks(tables, picks)
    current = {r["name"]: r for r in db.fetch_all("SELECT name, keys, cursor_column FROM app.source_tables WHERE database_id = %s",
                                                  (database_id,))}
    wanted = {name for name, _, _ in rows}
    added, removed, changed = [], sorted(set(current) - wanted), []
    with db.app_conn() as conn:
        for name in removed:
            conn.execute("DELETE FROM app.source_tables WHERE database_id = %s AND name = %s", (database_id, name))
            conn.execute(f"DROP TABLE IF EXISTS {_qi(s['target_schema'])}.{_qi(name)}")
            conn.execute("DELETE FROM app.column_descriptions WHERE database_id = %s AND (column_name = %s OR column_name LIKE %s)",
                         (database_id, f"{s['target_schema']}.{name}", f"{s['target_schema']}.{name}.%"))
        for name, keys, cursor in rows:
            old = current.get(name)
            if old is None:
                conn.execute("INSERT INTO app.source_tables (database_id, name, keys, cursor_column) VALUES (%s,%s,%s,%s)",
                             (database_id, name, keys, cursor))
                added.append(name)
            elif old["cursor_column"] != cursor or list(old["keys"]) != keys:
                conn.execute("""UPDATE app.source_tables SET keys = %s, cursor_column = %s, watermark = NULL
                                WHERE database_id = %s AND name = %s""", (keys, cursor, database_id, name))
                changed.append(name)
        conn.commit()
    if removed:  # bảng đã xóa phải biến mất khỏi catalog ngay, không đợi lần đồng bộ sau
        _refresh_catalog(database_id, s["target_schema"], sorted(wanted), {}, [])
    return {"added": added, "removed": removed, "changed": changed}


def update_credentials(database_id: int, user: str | None, password: str) -> str:
    """Đổi user/mật khẩu (nguồn đổi mật khẩu định kỳ). Kiểm lại kết nối và quyền chỉ đọc trước khi lưu."""
    s = _saved(database_id)
    dsn = with_credentials(s["kind"], decrypt(s["dsn_enc"]), user, password)
    src = open_source(s["kind"], dsn, s["source_schema"])
    try:
        problems = src.write_privileges()
    finally:
        src.close()
    if problems:
        raise SourceError("Role mới có quyền ghi: " + "; ".join(problems) + ". LVDA chỉ nhận role chỉ đọc.", "user")
    masked = mask(s["kind"], dsn)
    db.execute("UPDATE app.sources SET dsn_enc = %s, dsn_masked = %s WHERE database_id = %s", (encrypt(dsn), masked, database_id))
    return masked


def set_paused(database_id: int, paused: bool) -> None:
    db.execute("UPDATE app.sources SET paused = %s WHERE database_id = %s", (paused, database_id))


def disconnect(database_id: int) -> None:
    """Ngắt kết nối: xóa database đồng bộ khỏi LVDA cùng bản sao dữ liệu. Nguồn không bị đụng tới."""
    from lvda import catalog, explorer

    _not_running(database_id)
    s = _saved(database_id)
    with db.app_conn() as conn:
        for table in ("database_members", "share_links", "column_descriptions", "metric_versions", "metrics"):
            conn.execute(f"DELETE FROM app.{table} WHERE database_id = %s", (database_id,))
        conn.execute("DELETE FROM app.databases WHERE id = %s", (database_id,))  # nguồn, lần chạy, snapshot, dashboard: CASCADE
        conn.execute(f"DROP SCHEMA IF EXISTS {_qi(s['target_schema'])} CASCADE")
        conn.commit()
    catalog._by_db.pop(database_id, None)
    catalog._specs.pop(database_id, None)
    explorer.invalidate(database_id)


# ---------------------------------------------------------------- một lần đồng bộ
def start(database_id: int, trigger: str, full: bool = False, user_id: int | None = None, wait: bool = False) -> int:
    """Tạo bản ghi lần chạy rồi chạy ở luồng nền (wait=True: chạy ngay trong luồng gọi, dùng cho test)."""
    with db.app_conn() as conn:
        # khóa dòng nguồn để hai yêu cầu cùng lúc không tạo hai lần chạy
        src = conn.execute("SELECT database_id FROM app.sources WHERE database_id = %s FOR UPDATE", (database_id,)).fetchone()
        if not src:
            raise SourceError("Database này không có nguồn đồng bộ.")
        if conn.execute("SELECT 1 FROM app.sync_runs WHERE database_id = %s AND status = 'running'", (database_id,)).fetchone():
            raise Busy("Đang có một lần đồng bộ chạy.")
        # kế hoạch sơ bộ ngay từ đầu (chưa có ước tính số dòng) để giao diện vẽ đủ danh sách bảng trước khi đọc nguồn
        plan = [{"table": r["name"], "estimate": None} for r in conn.execute(
            "SELECT name FROM app.source_tables WHERE database_id = %s AND enabled ORDER BY name", (database_id,)).fetchall()]
        run_id = conn.execute("""INSERT INTO app.sync_runs (database_id, trigger, full_refresh, status, started_by, plan)
                                 VALUES (%s, %s, %s, 'running', %s, %s) RETURNING id""",
                              (database_id, trigger, full, user_id, db.jsonb(plan))).fetchone()["id"]
        conn.execute("UPDATE app.sources SET last_run_at = now() WHERE database_id = %s", (database_id,))
        conn.commit()
    if wait:
        _run(run_id, database_id, full)
    else:
        threading.Thread(target=_run, args=(run_id, database_id, full), daemon=True, name=f"sync-{database_id}").start()
    return int(run_id)


def _run(run_id: int, database_id: int, full: bool) -> None:
    t0 = time.perf_counter()
    results: list[dict[str, Any]] = []
    error = None
    try:
        s = db.fetch_one("SELECT kind, dsn_enc, source_schema, target_schema, lookback_minutes FROM app.sources WHERE database_id = %s",
                         (database_id,))
        assert s is not None
        picks = db.fetch_all("""SELECT name, keys, cursor_column, watermark FROM app.source_tables
                                WHERE database_id = %s AND enabled ORDER BY name""", (database_id,))
        src = open_source(s["kind"], decrypt(s["dsn_enc"]), s["source_schema"])
        try:
            infos = {t.name: t for t in src.tables()}
            fks = src.foreign_keys()
            with psycopg.connect(config.OWNER_DSN, autocommit=False) as conn:
                conn.execute(f"CREATE SCHEMA IF NOT EXISTS {_qi(s['target_schema'])}")
                conn.execute(f"GRANT USAGE ON SCHEMA {_qi(s['target_schema'])} TO lvda_reader")
                conn.commit()
                names = [p["name"] for p in picks]
                # kế hoạch chép: giao diện vẽ tiến độ từng bảng (số dòng ở nguồn là ước tính của database, chưa đếm)
                plan = [{"table": n, "estimate": infos[n].rows_estimate if n in infos else None} for n in names]
                db.execute("UPDATE app.sync_runs SET plan = %s WHERE id = %s", (db.jsonb(plan), run_id))
                last_refresh = 0.0
                for i, p in enumerate(picks):
                    db.execute("UPDATE app.sync_runs SET current_table = %s, tables = %s WHERE id = %s",
                               (p["name"], db.jsonb(results), run_id))
                    results.append(_sync_table(conn, src, s, p, infos.get(p["name"]), full, run_id, results, database_id))
                    # bảng chép xong là xem được ngay ở tab Dữ liệu: crawl lại catalog sau bảng đầu, rồi tối đa 5 giây một lần
                    if i < len(picks) - 1 and time.perf_counter() - last_refresh >= 5:
                        _refresh_catalog(database_id, s["target_schema"], names, infos, fks)
                        last_refresh = time.perf_counter()
            _refresh_catalog(database_id, s["target_schema"], names, infos, fks)
        finally:
            src.close()
    except Exception as e:  # lỗi kết nối, giải mã... ghi vào lần chạy, không làm sập luồng nền
        log.exception("sync %s failed", run_id)
        error = str(e) if isinstance(e, SourceError) else f"{type(e).__name__}: {e}"
    failed = [r for r in results if r["status"] == "failed"]
    status = "failed" if error or (results and len(failed) == len(results)) else "partial" if failed else "ok"
    db.execute("""UPDATE app.sync_runs SET status = %s, tables = %s, error = %s, current_table = NULL, finished_at = now(), ms = %s
                  WHERE id = %s""", (status, db.jsonb(results), error, int((time.perf_counter() - t0) * 1000), run_id))
    log.info(json.dumps({"event": "sync", "run": run_id, "database_id": database_id, "status": status,
                         "read": sum(r.get("read", 0) for r in results)}))


def _sync_table(conn: psycopg.Connection[Any], src: Source, s: dict[str, Any], p: dict[str, Any], info: TableInfo | None,
                full: bool, run_id: int, done: list[dict[str, Any]], database_id: int) -> dict[str, Any]:
    t0 = time.perf_counter()
    name, keys, cursor = p["name"], list(p["keys"] or []), p["cursor_column"]
    res: dict[str, Any] = {"table": name, "mode": "incremental" if cursor and keys else "full", "read": 0, "inserted": 0,
                           "updated": 0, "from": wm_label(p["watermark"]), "to": None, "status": "ok"}
    try:
        if info is None:
            raise SourceError("Bảng không còn ở nguồn (đã đổi tên hoặc bị xóa).")
        if any(info.col(k) is None for k in keys) or (cursor and info.col(cursor) is None):
            raise SourceError("Khóa hoặc cột mốc không còn ở nguồn.")
        cols = info.columns
        rebuilt = ensure_table(conn, s["target_schema"], info, cols, keys)
        conn.commit()
        incremental = res["mode"] == "incremental" and not full and not rebuilt and p["watermark"] is not None
        if not incremental:
            res["mode"] = "full" if not (cursor and keys) else "initial" if p["watermark"] is None else "refresh"
        low = low_mark(p["watermark"], s["lookback_minutes"]) if incremental else None
        names = [c.name for c in cols]
        wm = wm_load(p["watermark"]) if incremental else None
        ci = names.index(cursor) if cursor else None
        with conn.transaction():
            if not incremental:  # làm mới toàn bộ trong một giao dịch: người đọc chờ tới lúc xong, không bao giờ thấy bảng trống
                conn.execute(f"TRUNCATE {_qi(s['target_schema'])}.{_qi(name)}")
            for rows in src.batches(name, names, keys, cursor if incremental else None, low, BATCH if incremental else BATCH * 4):
                ins, upd = write_batch(conn, s["target_schema"], name, cols, keys, rows, fresh=not incremental)
                res["read"] += len(rows)
                res["inserted"] += ins
                res["updated"] += upd
                if ci is not None:
                    top = max((r[ci] for r in rows if r[ci] is not None), default=None)
                    if top is not None and (wm is None or top > wm):
                        wm = top
                db.execute("UPDATE app.sync_runs SET tables = %s WHERE id = %s",
                           (db.jsonb([*done, {**res, "status": "running"}]), run_id))
        conn.commit()
        res["to"] = wm_label(wm_dump(wm))
        source_rows = src.count(name)
        target_rows = conn.execute(f"SELECT count(*) FROM {_qi(s['target_schema'])}.{_qi(name)}").fetchone()[0]
        conn.commit()
        res.update(source_rows=source_rows, target_rows=target_rows, drift=target_rows - source_rows)
        db.execute("""UPDATE app.source_tables SET watermark = %s, source_rows = %s, target_rows = %s, last_synced_at = now(),
                        last_status = 'ok', last_error = NULL WHERE database_id = %s AND name = %s""",
                   (db.jsonb(wm_dump(wm)) if wm is not None else None, source_rows, target_rows, database_id, name))
    except Exception as e:
        conn.rollback()
        res.update(status="failed", error=str(e) if isinstance(e, SourceError) else f"{type(e).__name__}: {str(e).splitlines()[0] if str(e) else ''}")
        db.execute("UPDATE app.source_tables SET last_status = 'failed', last_error = %s WHERE database_id = %s AND name = %s",
                   (res["error"], database_id, name))
    res["ms"] = int((time.perf_counter() - t0) * 1000)
    return res


def _refresh_catalog(database_id: int, schema: str, names: list[str], infos: dict[str, TableInfo], fks: list[ForeignKey]) -> None:
    """Cập nhật metadata (khóa, quan hệ, mô tả từ comment ở nguồn) rồi crawl lại catalog để tab Dữ liệu thấy ngay."""
    from lvda import explorer
    from lvda.catalog import rebuild_catalog

    keys = {r["name"]: r["keys"] for r in db.fetch_all("SELECT name, keys FROM app.source_tables WHERE database_id = %s", (database_id,))}
    synced = set(names)
    meta = {
        "allowed_schemas": [schema],
        "grains": {f"{schema}.{t}": k for t, k in keys.items() if k and t in synced},
        "relationships": [{"child": f"{schema}.{f.child}", "parent": f"{schema}.{f.parent}",
                           "keys": [f"{schema}.{f.child}.{f.child_col}", f"{schema}.{f.parent}.{f.parent_col}"]}
                          for f in fks if f.child in synced and f.parent in synced],
        "domains": {"src": {"label": "Bảng đồng bộ", "tables": [f"{schema}.{t}" for t in sorted(synced)]}},
    }
    spec = {"schemas": [schema], "source_schemas": [schema], "catalog_only": True, "meta": meta}
    db.execute("UPDATE app.databases SET settings = jsonb_set(settings, '{warehouse}', %s) WHERE id = %s", (db.jsonb(spec), database_id))
    rows = []
    for t in names:
        info = infos.get(t)
        if info is None:
            continue
        if info.comment:
            rows.append((database_id, f"{schema}.{t}", info.comment))
        rows += [(database_id, f"{schema}.{t}.{c.name}", c.comment) for c in info.columns if c.comment]
    if rows:
        with db.app_conn() as conn:
            with conn.cursor() as cur:
                cur.executemany("""INSERT INTO app.column_descriptions (database_id, column_name, description, status, source)
                                   VALUES (%s, %s, %s, 'approved', 'source') ON CONFLICT (database_id, column_name) DO NOTHING""", rows)
            conn.commit()
    rebuild_catalog(database_id)
    explorer.invalidate(database_id)


# ---------------------------------------------------------------- lịch tự động
def due() -> list[int]:
    return [r["database_id"] for r in db.fetch_all(
        """SELECT s.database_id FROM app.sources s
           WHERE s.schedule_minutes > 0 AND NOT s.paused AND (s.last_run_at IS NULL OR s.last_run_at + make_interval(mins => s.schedule_minutes) <= now())
             AND NOT EXISTS (SELECT 1 FROM app.sync_runs r WHERE r.database_id = s.database_id AND r.status = 'running')""")]


def start_scheduler() -> threading.Event | None:
    """Luồng nền kiểm mỗi 20 giây xem nguồn nào tới lịch. Tắt bằng LVDA_SCHEDULER=0 (test, nhiều worker)."""
    if os.getenv("LVDA_SCHEDULER", "1") == "0":
        return None
    try:  # lần chạy bị cắt ngang khi API khởi động lại thì không bao giờ xong: đánh dấu thất bại
        db.execute("""UPDATE app.sync_runs SET status = 'failed', error = 'API khởi động lại khi đang đồng bộ.', finished_at = now()
                      WHERE status = 'running'""")
    except psycopg.Error:
        return None
    stop = threading.Event()

    def loop() -> None:
        while not stop.wait(20):
            try:
                for database_id in due():
                    try:
                        start(database_id, "schedule")
                    except (Busy, SourceError):
                        pass
            except Exception:
                log.exception("scheduler tick failed")

    threading.Thread(target=loop, daemon=True, name="sync-scheduler").start()
    return stop
