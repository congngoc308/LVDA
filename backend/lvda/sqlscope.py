"""Truy cột trong một câu SQL đã qualify về cột gốc (schema.table.column) qua CTE và subquery."""

from __future__ import annotations

from collections.abc import Iterator
from typing import TypeVar

from sqlglot import exp
from sqlglot.optimizer.scope import Scope

_CHILD_SCOPE_NODES = (exp.Select, exp.Subquery, exp.With, exp.CTE, exp.Union)
E = TypeVar("E", bound=exp.Expression)


def own_nodes(scope: Scope, node_type: type[E]) -> Iterator[E]:
    """Các node thuộc riêng scope này (không đi vào CTE/subquery con)."""
    root = scope.expression
    for node in root.walk(prune=lambda n: n is not root and isinstance(n, _CHILD_SCOPE_NODES)):
        if isinstance(node, node_type):
            yield node


def nodes_in(node: exp.Expression, node_type: type[E]) -> Iterator[E]:
    """Các node trong một biểu thức, không đi vào subquery lồng."""
    for n in node.walk(prune=lambda x: x is not node and isinstance(x, _CHILD_SCOPE_NODES)):
        if isinstance(n, node_type):
            yield n


def table_name(table: exp.Table) -> str:
    return f"{table.db}.{table.name}" if table.db else str(table.name)


def resolve_column(scope: Scope, col: exp.Column, _depth: int = 0) -> set[str]:
    if _depth > 12:
        return set()
    src = scope.sources.get(col.table)
    if isinstance(src, exp.Table):
        return {f"{table_name(src)}.{col.name}"}
    if isinstance(src, Scope):
        return resolve_projection(src, col.name, _depth + 1)
    return set()


def resolve_projection(scope: Scope, name: str, _depth: int = 0) -> set[str]:
    expr = scope.expression
    if isinstance(expr, exp.Union) or scope.union_scopes:
        out: set[str] = set()
        for s in scope.union_scopes:
            out |= resolve_projection(s, name, _depth + 1)
        return out
    if not isinstance(expr, exp.Select):
        return set()
    for proj in expr.selects:
        if proj.alias_or_name == name:
            return resolve_expr(scope, proj, _depth)
    return set()


def resolve_expr(scope: Scope, node: exp.Expression, _depth: int = 0) -> set[str]:
    out: set[str] = set()
    for col in nodes_in(node, exp.Column):
        out |= resolve_column(scope, col, _depth)
    return out
