"""MCP server của LVDA. Chỉ đọc: kiểm SQL và tra chỉ số, không chạy SQL tự do.

stdio (Claude Code):  claude mcp add lvda -- D:\\CODE\\LVDA\\backend\\.venv\\Scripts\\python D:\\CODE\\LVDA\\backend\\mcp_server.py
HTTP:                 python mcp_server.py --http   →  http://127.0.0.1:8021/mcp
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mcp.server.fastmcp import FastMCP  # noqa: E402

from lvda.catalog import get_catalog  # noqa: E402
from lvda.metrics import get_metric, list_metrics as _list_metrics  # noqa: E402
from lvda.verifier import verify  # noqa: E402

DATABASE_ID = int(os.getenv("LVDA_DATABASE_ID", "1"))
mcp = FastMCP("lvda")


@mcp.tool()
def verify_sql(sql: str, metric_id: str | None = None) -> dict:
    """Kiểm một câu SQL (Postgres) trên warehouse Olist bằng lineage.

    Trả verdict (green/yellow/red/blocked) và danh sách phát hiện có mã luật V01–V12, bằng chứng và gợi ý sửa.
    Truyền metric_id (ví dụ gmv, order_count) để so với định nghĩa chỉ số chuẩn.
    """
    metric = get_metric(DATABASE_ID, metric_id) if metric_id else None
    res = verify(sql, get_catalog(), metric)
    return {k: res[k] for k in ("verdict", "blocked_reason", "metric_id", "findings", "elapsed_ms")}


@mcp.tool()
def explain_sql_lineage(sql: str) -> dict:
    """Dấu vân tay lineage của câu SQL: cột đo (kèm cột raw gốc), bộ lọc, join, group by, cột thời gian."""
    return verify(sql, get_catalog(), None).get("fingerprint") or {"error": "Không phân tích được câu SQL."}


@mcp.tool()
def list_metrics(status: str | None = None) -> list[dict]:
    """Danh sách chỉ số: id, tên, mô tả, trạng thái (certified/draft)."""
    return [{"id": m["id"], "name_vi": m["name_vi"], "description": m["description"], "status": m["status"]}
            for m in _list_metrics(DATABASE_ID) if not status or m["status"] == status]


@mcp.tool()
def get_metric_definition(metric_id: str) -> dict:
    """Định nghĩa đầy đủ của một chỉ số: SQL chuẩn, bộ lọc bắt buộc, cột thời gian, giả định."""
    m = get_metric(DATABASE_ID, metric_id)
    if not m:
        return {"error": f"Không có chỉ số {metric_id}"}
    return {k: m.get(k) for k in ("id", "name_vi", "description", "status", "version", "canonical_sql",
                                  "required_filters", "time_column", "assumptions")}


@mcp.tool()
def run_certified_metric(metric_id: str, start: str | None = None, end: str | None = None,
                         dimension: str | None = None, top: int | None = None) -> dict:
    """Chạy SQL chuẩn của một chỉ số đã chứng nhận. Chỉ nhận tham số đã kiểm, không nhận SQL tự do.

    start/end: YYYY-MM-DD (end không gồm). dimension: customer_state | category | payment_type | month | seller_state.
    """
    from lvda.metrics import run_certified

    try:
        return run_certified(DATABASE_ID, metric_id, start, end, dimension, top)
    except ValueError as e:
        return {"error": str(e)}


if __name__ == "__main__":
    if "--http" in sys.argv:
        mcp.settings.host = os.getenv("LVDA_MCP_HOST", "127.0.0.1")
        mcp.settings.port = int(os.getenv("LVDA_MCP_PORT", "8021"))
        mcp.run(transport="streamable-http")
    else:
        mcp.run()
