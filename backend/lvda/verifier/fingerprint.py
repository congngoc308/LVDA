"""Trích dấu vân tay lineage của một câu SQL: cột đo, bộ lọc, join, group by, cột thời gian, đầu ra."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from sqlglot import exp
from sqlglot.errors import OptimizeError
from sqlglot.optimizer.qualify import qualify
from sqlglot.optimizer.scope import Scope, build_scope, traverse_scope

from lvda.catalog import Catalog
from lvda.sqlscope import nodes_in, own_nodes, resolve_column, resolve_expr, table_name

JSON = dict[str, Any]
NOLIT = object()
_CMP = {exp.EQ: "=", exp.NEQ: "<>", exp.GT: ">", exp.GTE: ">=", exp.LT: "<", exp.LTE: "<="}
_FLIP = {">": "<", ">=": "<=", "<": ">", "<=": ">=", "=": "=", "<>": "<>"}
_NEG = {"=": "<>", "<>": "=", "in": "not in", "not in": "in", "is null": "is not null", "is not null": "is null"}


@dataclass
class ScopeInfo:
    sources: dict[str, str | None]  # alias -> bảng (hoặc bảng "ảo" theo grain) / None nếu không xác định
    join_sql: dict[str, str]
    from_alias: str | None
    measure_aliases: set[str] = field(default_factory=set)
    agg_sql: str = ""


@dataclass
class Analysis:
    tree: exp.Expression | None = None
    unknown: list[JSON] = field(default_factory=list)  # V01
    tables: list[str] = field(default_factory=list)
    measures: list[JSON] = field(default_factory=list)
    filters: list[JSON] = field(default_factory=list)
    joins: list[JSON] = field(default_factory=list)
    group_by: list[JSON] = field(default_factory=list)
    time_columns: list[str] = field(default_factory=list)
    outputs: list[JSON] = field(default_factory=list)
    scopes: list[ScopeInfo] = field(default_factory=list)
    qualified_sql: str = ""
    limit: int | None = None

    @property
    def ok(self) -> bool:
        return self.tree is not None and not self.unknown

    def measure_columns(self) -> set[str]:
        out: set[str] = set()
        for m in self.measures:
            out |= set(m["columns"])
        return out

    def agg_signatures(self) -> set[tuple[str, bool]]:
        return {(m["agg"], m["distinct"]) for m in self.measures}

    def to_dict(self, catalog: Catalog) -> JSON:
        measure_cols = sorted(self.measure_columns())
        cols: set[str] = set(measure_cols)
        cols |= {f["column"] for f in self.filters}
        cols |= {c for g in self.group_by for c in g["columns"]}
        cols |= {c for j in self.joins for c in (j["left"], j["right"])}
        cols |= {c for o in self.outputs for c in o["columns"]}
        return {
            "column_raw": {c: catalog.to_raw([c]) for c in sorted(cols)},
            "tables": self.tables,
            "measures": self.measures,
            "filters": self.filters,
            "joins": self.joins,
            "group_by": self.group_by,
            "time_columns": self.time_columns,
            "outputs": self.outputs,
            "measure_columns": measure_cols,
            "limit": self.limit,
            "raw_sources": catalog.to_raw(measure_cols),
        }


def literal(node: exp.Expression | None) -> Any:
    if node is None:
        return NOLIT
    if isinstance(node, (exp.Cast, exp.Paren)):
        return literal(node.this)
    if isinstance(node, exp.Literal):
        if node.is_string:
            return node.this
        try:
            num = float(node.this)
            return int(num) if num.is_integer() else num
        except ValueError:
            return node.this
    if isinstance(node, exp.Boolean):
        return bool(node.this)
    if isinstance(node, exp.Neg):
        v = literal(node.this)
        return -v if isinstance(v, (int, float)) else NOLIT
    if isinstance(node, exp.Null):
        return None
    return NOLIT


def split_and(node: exp.Expression | None) -> list[exp.Expression]:
    if node is None:
        return []
    if isinstance(node, (exp.Where, exp.Having)):
        node = node.this
    if isinstance(node, exp.Paren) and isinstance(node.this, exp.And):
        return split_and(node.this)
    if isinstance(node, exp.And):
        return split_and(node.left) + split_and(node.right)
    return [node] if node is not None else []


def _has_columns(node: exp.Expression) -> bool:
    return any(True for _ in nodes_in(node, exp.Column))


def _filters_from_pred(scope: Scope, pred: exp.Expression, clause: str) -> tuple[list[JSON], list[tuple[exp.Column, exp.Column, str]]]:
    """Trả (bộ lọc, cặp join col=col)."""
    sql = pred.sql(dialect="postgres")
    neg = False
    p = pred
    if isinstance(p, exp.Not):
        neg, p = True, p.this
        if isinstance(p, exp.Paren):
            p = p.this

    def make(col_node: exp.Expression, op: str, value: Any) -> list[JSON]:
        cols = resolve_expr(scope, col_node)
        on_fn = not isinstance(col_node, exp.Column)
        if neg:
            op = _NEG.get(op, f"not {op}")
        return [{"column": c, "op": op, "value": value, "sql": sql, "clause": clause, "on_fn": on_fn,
                 "alias": col_node.table if isinstance(col_node, exp.Column) else None} for c in sorted(cols)]

    if isinstance(p, exp.Column):
        return make(p, "=", True), []
    if isinstance(p, exp.Binary) and type(p) in _CMP:
        op = _CMP[type(p)]
        lv, rv = literal(p.left), literal(p.right)
        if rv is not NOLIT and _has_columns(p.left):
            return make(p.left, op, rv), []
        if lv is not NOLIT and _has_columns(p.right):
            return make(p.right, _FLIP[op], lv), []
        if op == "=" and isinstance(p.left, exp.Column) and isinstance(p.right, exp.Column) and not neg:
            return [], [(p.left, p.right, sql)]
        return [], []
    if isinstance(p, exp.In):
        values = [literal(e) for e in p.expressions]
        if values and all(v is not NOLIT for v in values):
            return make(p.this, "in", values), []
    if isinstance(p, exp.Between):
        lo, hi = literal(p.args.get("low")), literal(p.args.get("high"))
        if lo is not NOLIT and hi is not NOLIT:
            return make(p.this, "between", [lo, hi]), []
    if isinstance(p, exp.Is):
        return make(p.this, "is null", None), []
    if isinstance(p, (exp.Like, exp.ILike)):
        return make(p.this, "like", literal(p.expression)), []
    if _has_columns(p):
        cols = resolve_expr(scope, p)
        return [{"column": c, "op": "expr", "value": None, "sql": sql, "clause": clause, "on_fn": True,
                 "alias": None} for c in sorted(cols)], []
    return [], []


def _derived_table(src: Scope, catalog: Catalog) -> str | None:
    """Bảng "ảo" của một CTE/subquery: theo grain của GROUP BY, hoặc bảng duy nhất nếu chỉ chuyển tiếp."""
    expr = src.expression
    if not isinstance(expr, exp.Select):
        return None
    group = expr.args.get("group")
    if group:
        cols: set[str] = set()
        for g in group.expressions:
            cols |= resolve_expr(src, g)
        return catalog.grain_owner(cols)
    if any(True for _ in own_nodes(src, exp.AggFunc)):
        return None  # tổng hợp thành 1 dòng
    tables = [table_name(s) for s in src.sources.values() if isinstance(s, exp.Table)]
    return tables[0] if len(tables) == 1 and len(src.sources) == 1 else None


def _fix_unqualified_tables(tree: exp.Expression, catalog: Catalog) -> list[JSON]:
    unknown: list[JSON] = []
    cte_names = {c.alias_or_name for c in tree.find_all(exp.CTE)}
    for t in tree.find_all(exp.Table):
        if not t.db and t.name in cte_names:
            continue
        if t.db:
            if not catalog.has_table(f"{t.db}.{t.name}"):
                unknown.append({"kind": "table", "name": f"{t.db}.{t.name}", "sql": t.sql(dialect="postgres")})
            continue
        candidates = catalog.tables_named(t.name)
        if len(candidates) == 1:
            t.set("db", exp.to_identifier(candidates[0].split(".")[0]))
        elif len(candidates) > 1:
            mart = [c for c in candidates if c.startswith("mart.")]
            t.set("db", exp.to_identifier((mart or candidates)[0].split(".")[0]))
        else:
            unknown.append({"kind": "table", "name": t.name, "sql": t.sql(dialect="postgres")})
    return unknown


def analyze(tree: exp.Expression, catalog: Catalog) -> Analysis:
    an = Analysis()
    tree = tree.copy()
    an.unknown = _fix_unqualified_tables(tree, catalog)
    if an.unknown:
        return an
    try:
        q = qualify(tree, schema=catalog.sqlglot_schema(), dialect="postgres", quote_identifiers=False,
                    identify=False, validate_qualify_columns=True)
    except OptimizeError as e:
        msg = str(e)
        m = re.search(r"Column '([^']+)'", msg)
        an.unknown.append({"kind": "column", "name": m.group(1) if m else msg[:120], "sql": m.group(1) if m else ""})
        return an
    root = build_scope(q)
    if root is None:
        an.unknown.append({"kind": "query", "name": "không dựng được scope", "sql": ""})
        return an
    an.tree = q
    an.qualified_sql = q.sql(dialect="postgres", pretty=True)

    tables: set[str] = set()
    time_cols: set[str] = set()
    for scope in traverse_scope(q):
        expr = scope.expression
        for s in scope.sources.values():
            if isinstance(s, exp.Table):
                tables.add(table_name(s))
        if not isinstance(expr, exp.Select):
            continue

        sources: dict[str, str | None] = {}
        for alias, s in scope.sources.items():
            sources[alias] = table_name(s) if isinstance(s, exp.Table) else (
                _derived_table(s, catalog) if isinstance(s, Scope) else None)
        from_node = expr.args.get("from")
        from_alias = from_node.this.alias_or_name if from_node is not None else None
        info = ScopeInfo(sources=sources, join_sql={}, from_alias=from_alias)

        # Hàm tổng hợp
        for agg in own_nodes(scope, exp.AggFunc):
            distinct = isinstance(agg.this, exp.Distinct)
            star = isinstance(agg.this, exp.Star)
            cols = sorted(resolve_expr(scope, agg))
            name = agg.key.upper() if not isinstance(agg, exp.Anonymous) else agg.name.upper()
            an.measures.append({"agg": name, "distinct": distinct, "star": star, "columns": cols,
                                "sql": agg.sql(dialect="postgres")})
            if name in ("SUM", "AVG", "COUNT") and not distinct:
                aliases = {c.table for c in nodes_in(agg, exp.Column)}
                if star and from_alias:
                    aliases.add(from_alias)
                info.measure_aliases |= aliases
                info.agg_sql = info.agg_sql or agg.sql(dialect="postgres")

        # Bộ lọc và join
        preds: list[tuple[exp.Expression, str]] = [(p, "where") for p in split_and(expr.args.get("where"))]
        preds += [(p, "having") for p in split_and(expr.args.get("having"))]
        for join in expr.args.get("joins") or []:
            alias = join.this.alias_or_name
            info.join_sql[alias] = join.sql(dialect="postgres")
            preds += [(p, "on") for p in split_and(join.args.get("on"))]
        for pred, clause in preds:
            filters, pairs = _filters_from_pred(scope, pred, clause)
            an.filters.extend(filters)
            for l_col, r_col, sql in pairs:
                left, right = resolve_column(scope, l_col), resolve_column(scope, r_col)
                if len(left) == 1 and len(right) == 1:
                    an.joins.append({"left": next(iter(left)), "right": next(iter(right)), "sql": sql})
            for f in filters:
                if catalog.is_time(f["column"]) and f["op"] != "expr":
                    time_cols.add(f["column"])

        group = expr.args.get("group")
        if group:
            for g in group.expressions:
                cols = sorted(resolve_expr(scope, g))
                an.group_by.append({"columns": cols, "sql": g.sql(dialect="postgres")})
                time_cols |= {c for c in cols if catalog.is_time(c)}

        an.scopes.append(info)

    root_expr = root.expression
    lim = root_expr.args.get("limit")
    if lim is not None:
        val = literal(lim.expression)
        an.limit = int(val) if isinstance(val, (int, float)) else None
    if isinstance(root_expr, exp.Select):
        for proj in root_expr.selects:
            an.outputs.append({
                "name": proj.alias_or_name,
                "aggregated": any(True for _ in nodes_in(proj, exp.AggFunc)) or _is_derived_agg(root, proj),
                "columns": sorted(resolve_expr(root, proj)),
            })
    an.tables = sorted(tables)
    an.time_columns = sorted(time_cols)
    return an


def _is_derived_agg(root: Scope, proj: exp.Expression) -> bool:
    """Cột đầu ra lấy từ một cột đã tổng hợp trong CTE/subquery."""
    for col in nodes_in(proj, exp.Column):
        src = root.sources.get(col.table)
        if isinstance(src, Scope) and isinstance(src.expression, exp.Select):
            for p in src.expression.selects:
                if p.alias_or_name == col.name and any(True for _ in nodes_in(p, exp.AggFunc)):
                    return True
    return False
