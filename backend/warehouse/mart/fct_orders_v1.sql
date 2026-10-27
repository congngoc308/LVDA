-- Đã ngừng dùng: bản cũ của fct_orders, không có customer_unique_id. Giữ lại để kiểm luật V11.
SELECT
  o.order_id,
  o.customer_id,
  o.order_status,
  o.order_purchase_timestamp AS purchased_at
FROM raw.orders AS o
