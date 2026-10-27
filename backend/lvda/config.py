"""Cấu hình đọc từ biến môi trường, có giá trị mặc định cho máy dev."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

OWNER_DSN = os.getenv("LVDA_OWNER_DSN", "postgresql://lvda:lvda@localhost:5460/lvda")
READER_DSN = os.getenv("LVDA_READER_DSN", "postgresql://lvda_reader:lvda_reader@localhost:5460/lvda")
JWT_SECRET = os.getenv("LVDA_JWT_SECRET", "dev-only-change-me")
JWT_TTL_HOURS = int(os.getenv("LVDA_JWT_TTL_HOURS", "72"))
WEB_ORIGIN = os.getenv("LVDA_WEB_ORIGIN", "http://localhost:5179")
# Khóa Fernet mã hóa chuỗi kết nối nguồn; để trống thì suy ra từ JWT_SECRET (chỉ hợp cho máy dev).
SECRET_KEY = os.getenv("LVDA_SECRET_KEY", "")
# Nguồn mẫu cho nút "Dùng nguồn mẫu": "nhãn|kind|dsn" cách nhau bởi ";". Role lvda_ro chỉ có SELECT.
DEMO_SOURCES = os.getenv("LVDA_DEMO_SOURCES",
                         "Postgres mẫu · shop|postgres|postgresql://lvda_ro:lvda_ro@localhost:5461/shop;"
                         "MySQL mẫu · shop|mysql|mysql://lvda_ro:lvda_ro@localhost:3307/shop")

# US-12 / NFR-06: chọn LLM bằng cấu hình. MVP chỉ chạy được "mock"; openrouter/ollama là bước tiếp theo.
LLM_PROVIDER = os.getenv("LVDA_LLM_PROVIDER", "mock")
LLM_MODEL = os.getenv("LVDA_LLM_MODEL", "mock-small")
LLM_BASE_URL = os.getenv("LVDA_LLM_BASE_URL", "")
LLM_API_KEY = os.getenv("LVDA_LLM_API_KEY", "")
MAX_AGENT_STEPS = 8
MAX_TOKENS_PER_QUESTION = 12_000

STATEMENT_TIMEOUT_MS = 10_000
MAX_ROWS = 1_000
MAX_FIX_ROUNDS = 2

WAREHOUSE_DIR = BASE_DIR / "warehouse"
MART_DIR = WAREHOUSE_DIR / "mart"
SCHEMA_YML = WAREHOUSE_DIR / "schema.yml"
METRICS_YML = BASE_DIR / "metrics" / "metrics.yml"
EVAL_DIR = BASE_DIR / "eval"


def mart_files() -> list[Path]:
    """File .sql của lớp mart theo thứ tự tạo: staging (stg_*) trước, rồi fct/dim."""
    return sorted(MART_DIR.glob("*.sql"), key=lambda p: (not p.stem.startswith("stg_"), p.stem))
