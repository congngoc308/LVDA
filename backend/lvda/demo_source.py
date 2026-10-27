"""Giả lập hoạt động trên nguồn mẫu "shop" để thấy đồng bộ tăng dần chạy: đơn mới, đơn đổi trạng thái, giá đổi,
sự kiện web mới, và một đơn bị xóa (để thấy phần "lệch số dòng" khi nguồn có xóa).

    python -m lvda.demo_source                 # Postgres mẫu
    python -m lvda.demo_source --kind mysql    # MySQL mẫu (docker compose --profile mysql up -d)

Dùng tài khoản chủ của nguồn mẫu (shop/shop), không phải role chỉ đọc mà LVDA dùng.
"""

from __future__ import annotations

import argparse
import os
import random
from typing import Any

ADMIN = {
    "postgres": os.getenv("LVDA_DEMO_ADMIN_PG", "postgresql://shop:shop@localhost:5461/shop"),
    "mysql": os.getenv("LVDA_DEMO_ADMIN_MYSQL", "mysql://shop:shop@localhost:3307/shop"),
}
NEXT = {"processing": "shipped", "shipped": "delivered"}


def _connect(kind: str) -> Any:
    if kind == "postgres":
        import psycopg

        return psycopg.connect(ADMIN[kind], autocommit=False)
    import pymysql

    from lvda.sources import parse_dsn

    p = parse_dsn("mysql", ADMIN[kind])
    return pymysql.connect(host=p["host"], port=p["port"], user=p["user"], password=p["password"], database=p["database"],
                           charset="utf8mb4", autocommit=False)


def tick(kind: str = "postgres", new_orders: int = 25, moves: int = 40, seed: int | None = None) -> dict[str, int]:
    rnd = random.Random(seed)
    now = "now()" if kind == "postgres" else "NOW()"
    conn = _connect(kind)
    cur = conn.cursor()
    cur.execute("SELECT coalesce(max(id), 0) FROM orders")
    top = int(cur.fetchone()[0])
    cur.execute("SELECT id, price FROM products WHERE active")
    products = cur.fetchall()
    for i in range(1, new_orders + 1):
        oid = top + i
        lines = [(n, *rnd.choice(products), rnd.randint(1, 3)) for n in range(1, rnd.randint(1, 4) + 1)]
        total = sum(float(price) * qty for _, _, price, qty in lines)
        cur.execute(f"INSERT INTO orders (id, customer_id, status, total, created_at, updated_at) VALUES (%s, %s, 'processing', %s, {now}, {now})",
                    (oid, rnd.randint(1, 3000), total))
        for n, pid, price, qty in lines:
            cur.execute(f"INSERT INTO order_items (order_id, line_no, product_id, qty, unit_price, updated_at) VALUES (%s,%s,%s,%s,%s,{now})",
                        (oid, n, pid, qty, price))
    cur.execute("SELECT id, status FROM orders WHERE status IN ('processing', 'shipped') ORDER BY id DESC LIMIT %s", (moves * 3,))
    open_orders = list(cur.fetchall())
    moved = rnd.sample(open_orders, k=min(moves, len(open_orders)))
    for oid, status in moved:
        # MySQL tự đẩy updated_at nhờ ON UPDATE; Postgres nhờ trigger
        cur.execute("UPDATE orders SET status = %s WHERE id = %s", (NEXT[status], oid))
    pid = rnd.choice(products)[0]
    cur.execute("UPDATE products SET price = round(price * 1.05, 2) WHERE id = %s", (pid,))
    for _ in range(60):
        cur.execute(f"INSERT INTO page_events (customer_id, event, created_at) VALUES (%s, %s, {now})",
                    (rnd.randint(1, 3000), rnd.choice(["view", "search", "add_to_cart", "checkout"])))
    cur.execute("SELECT id FROM orders WHERE status = 'canceled' ORDER BY id LIMIT 1")
    row = cur.fetchone()
    if row:
        cur.execute("DELETE FROM order_items WHERE order_id = %s", (row[0],))
        cur.execute("DELETE FROM orders WHERE id = %s", (row[0],))
    conn.commit()
    conn.close()
    return {"new_orders": new_orders, "status_changes": len(moved), "price_changes": 1, "events": 60, "deleted_orders": 1 if row else 0}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--kind", choices=["postgres", "mysql"], default="postgres")
    ap.add_argument("--orders", type=int, default=25)
    args = ap.parse_args()
    print(tick(args.kind, args.orders))
