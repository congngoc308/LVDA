"""Lớp chặn tầng parser: chỉ cho phép đúng một câu đọc trên schema được phép."""

from __future__ import annotations

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

BANNED_FUNCS = {
    "pg_sleep", "dblink", "dblink_exec", "pg_read_file", "pg_read_binary_file", "pg_ls_dir",
    "lo_import", "lo_export", "pg_terminate_backend", "pg_cancel_backend", "set_config",
    "pg_reload_conf", "pg_stat_file", "query_to_xml",
}
_WRITE_NODES = tuple(t for t in (
    exp.Insert, exp.Update, exp.Delete, exp.Create, exp.Drop, exp.Command, exp.Into, exp.Lock,
    getattr(exp, "Alter", None), getattr(exp, "AlterTable", None), getattr(exp, "Merge", None),
    getattr(exp, "TruncateTable", None), getattr(exp, "Copy", None),
) if t is not None)


class GuardResult:
    def __init__(self, tree: exp.Expression | None = None, blocked: str | None = None, parse_error: str | None = None):
        self.tree = tree
        self.blocked = blocked
        self.parse_error = parse_error


def check(sql: str, allowed_schemas: set[str]) -> GuardResult:
    try:
        statements = [s for s in sqlglot.parse(sql, read="postgres") if s is not None]
    except ParseError as e:
        return GuardResult(parse_error=str(e).splitlines()[0][:300])
    if len(statements) != 1:
        return GuardResult(blocked="Chỉ cho phép đúng một câu lệnh.")
    tree = statements[0]
    if not isinstance(tree, exp.Query):
        return GuardResult(blocked=f"Chỉ cho phép câu đọc dữ liệu (SELECT/WITH), không cho phép {tree.key.upper()}.")
    cte_names = {c.alias_or_name for c in tree.find_all(exp.CTE)}
    for node in tree.walk():
        if isinstance(node, _WRITE_NODES):
            return GuardResult(blocked=f"Câu lệnh chứa thao tác không được phép ({node.key.upper()}).")
        if isinstance(node, exp.Func):
            name = str(node.name if isinstance(node, exp.Anonymous) else node.key).lower()
            if name in BANNED_FUNCS:
                return GuardResult(blocked=f"Hàm {name}() bị chặn.")
        if isinstance(node, exp.Table):
            if node.db and node.db.lower() not in allowed_schemas:
                return GuardResult(blocked=f"Không được đọc schema “{node.db}”.")
            if not node.db and node.name.lower().startswith("pg_") and node.name not in cte_names:
                return GuardResult(blocked=f"Không được đọc bảng hệ thống “{node.name}”.")
    return GuardResult(tree=tree)
