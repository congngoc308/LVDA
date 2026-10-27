FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8020
# Dựng schema + dữ liệu giả lập nếu chưa có, rồi chạy API.
CMD ["sh", "-c", "python -m lvda.seed.bootstrap && uvicorn lvda.main:app --host 0.0.0.0 --port 8020"]
