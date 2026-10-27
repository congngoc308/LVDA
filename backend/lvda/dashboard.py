"""Dashboard trang Đánh giá: card hệ thống (khóa: chỉ di chuyển, đổi cỡ, thu gọn) + card do agent sinh (sửa, xóa được).

Card của người dùng không bao giờ chứa SQL tự do: chỉ là tham số của một chỉ số đã chứng nhận
(chiều chia, khoảng thời gian, kiểu biểu đồ). Mỗi lần hiển thị, SQL được dựng lại từ định nghĩa chuẩn
và đi qua bộ kiểm định, nên mọi con số trên dashboard đều có phán quyết và thời điểm kiểm.

Agent sinh dashboard (draft_stream) hỏi trước vài câu, rồi phát từng bước qua NDJSON để giao diện hiện
được nó đang làm gì. Phần "lập kế hoạch card" gọi LLM qua lvda.llm (MVP: mock, xem mock_plan).
"""

from __future__ import annotations

import json
import secrets
import time
import unicodedata
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any, Literal

import sqlglot
from pydantic import BaseModel, Field, model_validator
from sqlglot import exp

from lvda import config, db
from lvda.agent import mock_llm
from lvda.agent.nlu import DIMENSIONS
from lvda.catalog import catalog_for
from lvda.llm import LLM
from lvda.metrics import list_metrics
from lvda.settings import get_settings
from lvda.verifier import verify

KEY = "eval"
Size = Literal["s", "m", "l", "xl"]
Chart = Literal["number", "gauge", "line", "area", "column", "cumulative", "heat", "bar", "donut", "stacked", "table"]
Color = Literal["blue", "violet", "teal", "amber", "rose"]
Period = Literal["all", "2017", "2018"]
DimKey = Literal["month", "customer_state", "seller_state", "category", "payment_type"]

SYSTEM_CARDS: list[dict[str, str]] = [
    {"id": "sys:attention", "title": "Cần bạn xử lý", "size": "l"},
    {"id": "sys:mix", "title": "Phán quyết 30 ngày", "size": "s"},
    {"id": "sys:kpis", "title": "Chỉ số vận hành", "size": "xl"},
    {"id": "sys:trend", "title": "Xu hướng theo ngày", "size": "l"},
    {"id": "sys:funnel", "title": "Từ câu hỏi tới con số", "size": "s"},
    {"id": "sys:rules", "title": "Lỗi agent hay mắc", "size": "m"},
    {"id": "sys:heatmap", "title": "Chỉ số × phán quyết", "size": "m"},
    {"id": "sys:verifier", "title": "Độ tin cậy của bộ kiểm định", "size": "xl"},
]
SYSTEM_IDS = {c["id"] for c in SYSTEM_CARDS}
# id card hệ thống của bản trước → card thay thế, để dashboard đã lưu vẫn mở và lưu lại được
LEGACY_SYSTEM = {"sys:queue": "sys:attention", "sys:per_day": "sys:trend", "sys:top_rules": "sys:rules", "sys:by_metric": "sys:heatmap"}
PERIODS: dict[str, dict[str, str] | None] = {
    "all": None,
    "2017": {"start": "2017-01-01", "end": "2018-01-01", "label": "năm 2017"},
    "2018": {"start": "2018-01-01", "end": "2019-01-01", "label": "năm 2018"},
}
PERIOD_LABEL = {"all": "Toàn bộ dữ liệu", "2017": "Năm 2017", "2018": "Năm 2018"}
CHART_LABEL = {"number": "Số lớn", "gauge": "Đồng hồ", "line": "Đường", "area": "Vùng", "column": "Cột dọc", "cumulative": "Lũy kế",
               "heat": "Dải nhiệt", "bar": "Cột ngang", "donut": "Vòng tỉ trọng", "stacked": "Thanh tỉ trọng", "table": "Bảng"}
MAX_CARDS = 30


class CardSpec(BaseModel):
    id: str = Field(..., pattern=r"^c_[a-z0-9]{4,24}$")
    kind: Literal["metric"] = "metric"
    title: str = Field(..., min_length=1, max_length=80)
    metric_id: str = Field(..., max_length=60)
    dimension: DimKey | None = None
    period: Period = "all"
    chart: Chart = "number"
    top: int | None = Field(None, ge=1, le=30)
    why: str | None = Field(None, max_length=300)
    color: Color = "blue"
    sort: Literal["desc", "asc"] = "desc"
    compare: bool = False  # so với cùng kỳ năm trước; chỉ có tác dụng với năm 2018, số lớn hoặc theo tháng


class LayoutItem(BaseModel):
    id: str = Field(..., max_length=40)
    size: Size = "m"
    collapsed: bool = False


class Board(BaseModel):
    layout: list[LayoutItem]
    cards: list[CardSpec] = Field(default_factory=list, max_length=MAX_CARDS)
    tray: list[CardSpec] = Field(default_factory=list, max_length=MAX_CARDS)

    @model_validator(mode="after")
    def _consistent(self) -> Board:
        ids = [i.id for i in self.layout]
        if len(ids) != len(set(ids)):
            raise ValueError("Bố cục có card trùng.")
        missing = SYSTEM_IDS - set(ids)
        if missing:
            raise ValueError(f"Card hệ thống không xóa được: {', '.join(sorted(missing))}.")
        card_ids = [c.id for c in self.cards]
        all_ids = card_ids + [c.id for c in self.tray]
        if len(all_ids) != len(set(all_ids)):
            raise ValueError("Có card trùng id giữa dashboard và vùng phụ.")
        user_in_layout = {i for i in ids if i not in SYSTEM_IDS}
        if user_in_layout != set(card_ids):
            raise ValueError("Bố cục và danh sách card không khớp.")
        return self


def new_card_id() -> str:
    return "c_" + secrets.token_hex(5)


def is_additive(metric: dict[str, Any]) -> bool:
    """Chỉ số cộng dồn được (SUM/COUNT) mới có lũy kế và tỉ trọng; trung bình hay tỉ lệ thì cộng lại vô nghĩa."""
    try:
        sel = sqlglot.parse_one(metric["canonical_sql"], read="postgres").selects[0]
    except (sqlglot.errors.ParseError, IndexError):
        return False
    return isinstance(sel.unalias(), (exp.Sum, exp.Count))


def chart_problem(dimension: str | None, chart: str, metric: dict[str, Any] | None = None) -> str | None:
    """Kiểu biểu đồ phải hợp với dạng dữ liệu: một số → số lớn (tỉ lệ, điểm thêm đồng hồ); theo tháng → đường, vùng,
    cột dọc, lũy kế, dải nhiệt, bảng; theo nhóm → cột, vòng và thanh tỉ trọng, bảng. Lũy kế và tỉ trọng chỉ dùng
    cho chỉ số cộng dồn được."""
    if dimension is None:
        if chart == "gauge":
            ratio = metric is None or metric.get("format") in ("percent", "score")
            return None if ratio else "Đồng hồ chỉ dùng cho tỉ lệ hoặc điểm (có thang cố định)."
        return None if chart == "number" else "Không chia theo chiều nào thì chỉ hiển thị được dạng số lớn."
    if chart in ("number", "gauge"):
        return "Đã chia theo chiều thì cần biểu đồ hoặc bảng, không dùng số lớn."
    if chart in ("line", "area", "cumulative", "heat") and dimension != "month":
        return f"Biểu đồ {CHART_LABEL[chart].lower()} chỉ dùng cho chiều thời gian (theo tháng)."
    if chart in ("bar", "donut", "stacked") and dimension == "month":
        return f"Biểu đồ {CHART_LABEL[chart].lower()} dùng khi chia theo nhóm, không dùng cho chiều tháng."
    if chart in ("cumulative", "stacked") and metric is not None and not is_additive(metric):
        return f"“{metric['name_vi']}” không cộng dồn được nên không vẽ {CHART_LABEL[chart].lower()}."
    return None


def check_card(card: CardSpec, metrics: dict[str, dict[str, Any]]) -> str | None:
    """None nếu card hợp lệ, ngược lại là lý do (tiếng Việt)."""
    m = metrics.get(card.metric_id)
    if m is None:
        return f"Không có chỉ số {card.metric_id}."
    if m["status"] != "certified":
        state = {"stale": "cần chứng nhận lại", "draft": "nháp", "deprecated": "ngừng dùng"}.get(m["status"], m["status"])
        return f"Chỉ số “{m['name_vi']}” đang ở trạng thái {state}, chưa dùng được cho dashboard."
    if card.dimension and not mock_llm.supports(m, card.dimension):
        return f"Chưa hỗ trợ chia “{m['name_vi']}” theo {DIMENSIONS[card.dimension]['label'].lower()}."
    return chart_problem(card.dimension, card.chart, m)


# ---------------------------------------------------------------- lưu trữ
def default_layout() -> list[dict[str, Any]]:
    return [{"id": c["id"], "size": c["size"], "collapsed": False} for c in SYSTEM_CARDS]


def load(database_id: int) -> dict[str, Any]:
    row = db.fetch_one("""SELECT d.layout, d.cards, d.tray, d.updated_at, u.name AS updated_by_name FROM app.dashboards d
                          LEFT JOIN app.users u ON u.id = d.updated_by WHERE d.database_id = %s AND d.key = %s""", (database_id, KEY))
    if row is None:
        return {"layout": default_layout(), "cards": [], "tray": [], "updated_at": None, "updated_by_name": None,
                "system": SYSTEM_CARDS}
    layout: list[dict[str, Any]] = []
    for item in row["layout"]:
        sid = LEGACY_SYSTEM.get(item["id"], item["id"])
        if (sid.startswith("sys:") and sid not in SYSTEM_IDS) or any(i["id"] == sid for i in layout):
            continue
        layout.append({**item, "id": sid})
    present = {i["id"] for i in layout}
    # card hệ thống mới thêm ở phiên bản sau: chèn vào cuối để không biến mất khỏi dashboard cũ
    layout += [{"id": c["id"], "size": c["size"], "collapsed": False} for c in SYSTEM_CARDS if c["id"] not in present]
    return {"layout": layout, "cards": row["cards"], "tray": row["tray"], "updated_at": row["updated_at"],
            "updated_by_name": row["updated_by_name"], "system": SYSTEM_CARDS}


def save(database_id: int, user_id: int, board: Board) -> dict[str, Any]:
    metrics = {m["id"]: m for m in list_metrics(database_id)}
    for card in board.cards:
        problem = check_card(card, metrics)
        if problem:
            raise ValueError(f"Card “{card.title}”: {problem}")
    db.execute("""INSERT INTO app.dashboards (database_id, key, layout, cards, tray, updated_by, updated_at)
                  VALUES (%s, %s, %s, %s, %s, %s, now())
                  ON CONFLICT (database_id, key) DO UPDATE SET layout = EXCLUDED.layout, cards = EXCLUDED.cards,
                    tray = EXCLUDED.tray, updated_by = EXCLUDED.updated_by, updated_at = now()""",
               (database_id, KEY, db.jsonb([i.model_dump() for i in board.layout]), db.jsonb([c.model_dump() for c in board.cards]),
                db.jsonb([c.model_dump() for c in board.tray]), user_id))
    return load(database_id)


# ---------------------------------------------------------------- tùy chọn cho trình sửa card
def options(database_id: int) -> dict[str, Any]:
    out = []
    for m in list_metrics(database_id):
        if m["status"] != "certified":
            continue
        dims = [d for d in DIMENSIONS if mock_llm.supports(m, d)]
        out.append({"id": m["id"], "name_vi": m["name_vi"], "format": m.get("format"), "unit": m.get("unit"), "dimensions": dims,
                    "additive": is_additive(m)})
    return {"metrics": out, "dimensions": {k: v["label"] for k, v in DIMENSIONS.items()},
            "periods": PERIOD_LABEL, "charts": CHART_LABEL}


# ---------------------------------------------------------------- hiển thị một card
def _interp(card: CardSpec, dimension: str | None, time: dict[str, str] | None) -> dict[str, Any]:
    top = {"n": card.top or 10, "order": card.sort} if dimension and dimension != "month" else None
    return {"dimension": dimension, "time": time, "top": top}


def _checked(database_id: int, m: dict[str, Any], interp: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    sql = mock_llm.reference_sql(m, interp)
    return sql, verify(sql, catalog_for(database_id), m, get_settings(database_id))


def _blocked(v: dict[str, Any]) -> bool:
    return v["verdict"] in ("red", "blocked") or not v["executable"]


def _previous(database_id: int, card: CardSpec, m: dict[str, Any]) -> dict[str, Any] | None:
    """Cùng kỳ năm 2017 cho card năm 2018. Dữ liệu 2018 chỉ có tới một tháng nào đó, nên số lớn so với đúng
    các tháng đó của 2017 chứ không so cả năm. SQL kỳ trước cũng qua bộ kiểm định; bị chặn thì bỏ phần so sánh."""
    if card.dimension == "month":
        sql, v = _checked(database_id, m, _interp(card, "month", PERIODS["2017"]))
        return None if _blocked(v) else {"label": "Cùng kỳ 2017", "rows": db.run_readonly(sql, max_rows=200)["rows"]}
    sql, v = _checked(database_id, m, _interp(card, "month", PERIODS["2018"]))
    if _blocked(v):
        return None
    months = [str(r[0])[:7] for r in db.run_readonly(sql, max_rows=200)["rows"] if r[0] is not None]
    if not months:
        return None
    last = int(max(months)[5:7])
    end = f"2017-{last + 1:02d}-01" if last < 12 else "2018-01-01"
    sql, v = _checked(database_id, m, _interp(card, None, {"start": "2017-01-01", "end": end, "label": "cùng kỳ 2017"}))
    return None if _blocked(v) else {"label": f"cùng kỳ 2017 (T1–T{last})", "rows": db.run_readonly(sql, max_rows=1)["rows"]}


def render(database_id: int, card: CardSpec) -> dict[str, Any]:
    metrics = {m["id"]: m for m in list_metrics(database_id)}
    m = metrics.get(card.metric_id)
    base: dict[str, Any] = {"checked_at": datetime.now(UTC).isoformat(), "period_label": PERIOD_LABEL[card.period]}
    if m is None:
        return {**base, "status": "error", "message": f"Không có chỉ số {card.metric_id}."}
    base["metric"] = {"id": m["id"], "name_vi": m["name_vi"], "format": m.get("format"), "unit": m.get("unit"), "version": m["version"],
                      "additive": is_additive(m)}
    problem = check_card(card, metrics)
    if problem:
        return {**base, "status": "stale" if m["status"] == "stale" else "invalid", "message": problem}
    sql, v = _checked(database_id, m, _interp(card, card.dimension, PERIODS[card.period]))
    rules = [f["rule"] for f in v["findings"] if f["severity"] != "info"]
    base.update(verdict=v["verdict"], rules=rules, sql=sql)
    if _blocked(v):
        return {**base, "status": "held", "message": "Bộ kiểm định chặn câu SQL của card này, không hiển thị số."}
    try:
        res = db.run_readonly(sql, max_rows=200)
        compare = card.compare and card.period == "2018" and card.dimension in (None, "month")
        previous = _previous(database_id, card, m) if compare else None
    except Exception as e:  # noqa: BLE001 - lỗi chạy SQL chỉ làm hỏng một card, không làm hỏng cả trang
        return {**base, "status": "error", "message": f"Lỗi khi chạy truy vấn: {str(e).splitlines()[0][:200]}"}
    return {**base, "status": "ok", "columns": res["columns"], "rows": res["rows"], "previous": previous}


# ---------------------------------------------------------------- agent sinh dashboard
class PlannedCard(BaseModel):
    metric_id: str
    dimension: str | None = None
    period: str = "all"
    chart: str = "number"
    title: str
    why: str = ""


class DashboardPlan(BaseModel):
    cards: list[PlannedCard] = Field(..., min_length=1, max_length=12)
    assumptions: list[str] = Field(default_factory=list)


GOALS = {"theo_doi": "Theo dõi KPI", "so_sanh": "So sánh giữa các nhóm", "bat_thuong": "Tìm điểm bất thường"}
AUDIENCES = {"lanh_dao": "Lãnh đạo", "phan_tich": "Nhóm phân tích", "van_hanh": "Vận hành"}
CADENCES = {"ngay": "Hằng ngày / hằng tuần", "thang": "Hằng tháng", "quy": "Hằng quý / năm"}


class Answers(BaseModel):
    goal: Literal["theo_doi", "so_sanh", "bat_thuong"] = "theo_doi"
    audience: Literal["lanh_dao", "phan_tich", "van_hanh"] = "phan_tich"
    cadence: Literal["ngay", "thang", "quy"] = "thang"
    focus: str = Field("", max_length=200)


def _fold(s: str) -> str:
    s = s.replace("đ", "d").replace("Đ", "D")
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


def mock_plan(payload: dict[str, Any]) -> str:
    """Bản mock của bước LLM lập kế hoạch card (task plan_dashboard). Tất định theo câu trả lời.

    Giống mock viết SQL, mock này có một "lỗi" điển hình: khi so sánh nhóm nó đề xuất cả chỉ số còn ở dạng nháp,
    để bước kiểm phía sau có việc làm thật (loại card và ghi lý do).
    """
    a, avail = payload["answers"], {m["id"]: m for m in payload["metrics"]}
    period = {"ngay": "2018", "thang": "2018", "quy": "all"}[a["cadence"]]
    picks: list[dict[str, Any]] = []

    def add(mid: str, dim: str | None, chart: str, why: str) -> None:
        if mid in avail and not any(p["metric_id"] == mid and p["dimension"] == dim for p in picks):
            name = avail[mid]["name_vi"]
            title = name if dim is None else f"{name} theo {payload['dimensions'][dim].lower()}"
            picks.append({"metric_id": mid, "dimension": dim, "period": period, "chart": chart, "title": title, "why": why})

    focus = _fold(a.get("focus") or "")
    for m in payload["metrics"]:  # chỉ số người dùng nhắc tới được ưu tiên lên đầu
        names = [_fold(m["name_vi"]), *(_fold(s) for s in m.get("synonyms", []))]
        if focus and any(n and n in focus for n in names):
            add(m["id"], None, "number", "Bạn nhắc tới chỉ số này")
            add(m["id"], "month", "line", "Xu hướng theo tháng của chỉ số bạn quan tâm")
    if a["goal"] == "theo_doi":
        for mid in ("gmv", "order_count", "aov", "late_delivery_rate"):
            add(mid, None, "number", "KPI cốt lõi để theo dõi")
        add("gmv", "month", "line", "Doanh thu theo thời gian, trục ngang là tháng")
    elif a["goal"] == "so_sanh":
        add("gmv", "customer_state", "bar", "So sánh doanh thu giữa các bang")
        add("aov", "payment_type", "bar", "So sánh giá trị đơn theo cách thanh toán")
        add("freight_ratio", "customer_state", "bar", "So sánh tỉ lệ phí vận chuyển giữa các bang")
        add("late_delivery_rate", "customer_state", "bar", "Bang nào giao trễ nhiều")
    else:
        for mid in ("late_delivery_rate", "cancel_rate", "avg_review_score"):
            add(mid, "month", "line", "Theo dõi theo tháng để thấy tháng bất thường")
    if a["audience"] == "van_hanh":
        add("avg_delivery_days", None, "number", "Chỉ số vận hành: thời gian giao")
        add("cancel_rate", None, "number", "Chỉ số vận hành: tỉ lệ hủy")
    elif a["audience"] == "phan_tich":
        add("customer_count", "month", "table", "Bảng số khách theo tháng để phân tích sâu")
    limit = {"lanh_dao": 4, "phan_tich": 7, "van_hanh": 6}[a["audience"]]
    assumptions = [f"Khoảng thời gian: {PERIOD_LABEL[period].lower()} (theo chu kỳ {CADENCES[a['cadence']].lower()})",
                   "Dữ liệu chỉ có đến 08/2018"]
    return json.dumps({"cards": picks[:limit], "assumptions": assumptions}, ensure_ascii=False)


def _event(**kw: Any) -> str:
    return json.dumps(kw, ensure_ascii=False, default=str) + "\n"


def draft_stream(database_id: int, answers: Answers, request_id: str) -> Iterator[str]:
    """Chạy agent sinh dashboard, phát từng bước (NDJSON). Card hợp lệ đi vào vùng phụ, không tự vào dashboard."""
    t0 = time.perf_counter()

    def step(sid: str, label: str, status: str, detail: str, started: float, **extra: Any) -> str:
        return _event(type="step", id=sid, label=label, status=status, detail=detail,
                      ms=round((time.perf_counter() - started) * 1000), **extra)

    a = answers.model_dump()
    t = time.perf_counter()
    yield _event(type="start", request_id=request_id)
    yield step("read", "Đọc yêu cầu", "ok",
               f"Mục tiêu: {GOALS[a['goal']]} · Người xem: {AUDIENCES[a['audience']]} · Chu kỳ: {CADENCES[a['cadence']]}"
               + (f" · Ưu tiên: “{a['focus']}”" if a["focus"] else ""), t)

    t = time.perf_counter()
    yield _event(type="running", id="plan", label="Lập kế hoạch card")
    metrics = list_metrics(database_id)
    by_id = {m["id"]: m for m in metrics}
    payload = {"answers": a, "dimensions": {k: v["label"] for k, v in DIMENSIONS.items()},
               "metrics": [{"id": m["id"], "name_vi": m["name_vi"], "status": m["status"], "synonyms": m.get("synonyms", [])}
                           for m in metrics if m["status"] != "deprecated"]}
    llm = LLM(get_settings(database_id).get("llm_model") or config.LLM_MODEL)
    try:
        res = llm.structured("plan_dashboard", payload, DashboardPlan)
    except ValueError as e:
        yield step("plan", "Lập kế hoạch card", "fail", str(e), t)
        yield _event(type="error", message="Agent không lập được kế hoạch card. Thử lại hoặc đổi câu trả lời.")
        return
    plan: DashboardPlan = res.data
    yield step("plan", "Lập kế hoạch card", "ok",
               f"Đề xuất {len(plan.cards)} card · model {llm.model}{' (cache)' if res.cache_hit else ''} · "
               f"{res.tokens_in + res.tokens_out} token" + (f" · thử lại lược đồ {res.retries} lần" if res.retries else ""),
               t, assumptions=plan.assumptions)

    accepted: list[dict[str, Any]] = []
    dropped = 0
    for i, p in enumerate(plan.cards):
        t = time.perf_counter()
        sid, label = f"card{i}", f"Kiểm card: {p.title}"
        yield _event(type="running", id=sid, label=label)
        try:
            card = CardSpec(id=new_card_id(), title=p.title[:80], metric_id=p.metric_id, dimension=p.dimension,  # type: ignore[arg-type]
                            period=p.period, chart=p.chart, top=10 if p.dimension and p.dimension != "month" else None,  # type: ignore[arg-type]
                            why=p.why[:300] or None)
        except ValueError as e:
            dropped += 1
            yield step(sid, label, "fail", f"Loại: tham số không hợp lệ ({str(e).splitlines()[0][:120]}).", t)
            continue
        problem = check_card(card, by_id)
        if problem:
            dropped += 1
            yield step(sid, label, "fail", f"Loại: {problem}", t)
            continue
        out = render(database_id, card)
        m = by_id[card.metric_id]
        where = f"chia theo {DIMENSIONS[card.dimension]['label'].lower()}" if card.dimension else "không chia"
        head = f"{m['name_vi']} v{m['version']}, đã chứng nhận · {where} · {PERIOD_LABEL[card.period].lower()}"
        if out["status"] != "ok":
            dropped += 1
            yield step(sid, label, "fail", f"{head} · Loại: {out.get('message')}", t)
            continue
        verdict = {"green": "Xanh", "yellow": "Vàng"}.get(out["verdict"], out["verdict"])
        status = "ok" if out["verdict"] == "green" else "warn"
        extra = f" · luật {', '.join(out['rules'])}" if out["rules"] else ""
        accepted.append(card.model_dump())
        yield step(sid, label, status, f"{head} · kiểm định {verdict}{extra} · {len(out['rows'])} dòng", t)

    t = time.perf_counter()
    if not accepted:
        yield step("tray", "Đưa vào vùng phụ", "fail", "Không còn card hợp lệ nào.", t)
        yield _event(type="error", message="Không có card nào qua được bước kiểm.")
        return
    yield step("tray", "Đưa vào vùng phụ", "ok" if not dropped else "warn",
               f"{len(accepted)} card sẵn sàng" + (f", {dropped} card bị loại" if dropped else ""), t)
    yield _event(type="done", cards=accepted, request_id=request_id, ms=round((time.perf_counter() - t0) * 1000))
