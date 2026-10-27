"""FastAPI app. Chạy: uvicorn lvda.main:app --port 8020"""

import json
import logging
import time
import uuid

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from lvda import config, sources
from lvda.api import access, auth, dashboard_api, data_api, eval_api, explore_api, metrics_api, reviews, sources_api, workspace

# OBS-02: log JSON, mỗi dòng một sự kiện, có request_id.
logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("lvda.http")


@asynccontextmanager
async def lifespan(_: FastAPI):
    stop = sources.start_scheduler()  # đồng bộ theo lịch của từng nguồn
    yield
    if stop:
        stop.set()


app = FastAPI(title="LVDA — Lineage-Verified Data Agent", version="0.2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[config.WEB_ORIGIN], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request.state.request_id = uuid.uuid4().hex[:12]
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-Id"] = request.state.request_id
    if request.url.path.startswith("/api/"):
        log.info(json.dumps({"request_id": request.state.request_id, "method": request.method, "path": request.url.path,
                             "status": response.status_code, "ms": round((time.perf_counter() - t0) * 1000, 1)}))
    return response


for r in (auth.router, workspace.router, data_api.router, explore_api.router, dashboard_api.router, metrics_api.router, reviews.router, access.router,
          eval_api.router, sources_api.router):
    app.include_router(r)


@app.get("/api/health")
def health():
    return {"ok": True, "llm": config.LLM_PROVIDER}
