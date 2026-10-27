-- 1 dòng / đơn hàng. customer_id là mã theo đơn; khách thật là customer_unique_id.
-- Các cột tiền đã được gộp trước theo đơn nên không nhân dòng.
WITH items AS (
  SELECT
    i.order_id,
    SUM(i.price) AS items_amount,
    SUM(i.freight_value) AS freight_amount,
    COUNT(*) AS item_count
  FROM mart.stg_order_items AS i
  GROUP BY i.order_id
), pay AS (
  SELECT p.order_id, SUM(p.payment_value) AS payment_amount
  FROM mart.stg_payments AS p
  GROUP BY p.order_id
)
SELECT
  o.order_id,
  o.customer_id,
  c.customer_unique_id,
  c.city AS customer_city,
  c.state AS customer_state,
  o.order_status,
  o.purchased_at,
  o.approved_at,
  o.delivered_at,
  o.estimated_at,
  it.items_amount,
  it.freight_amount,
  it.items_amount + it.freight_amount AS gmv,
  it.item_count,
  pa.payment_amount
FROM mart.stg_orders AS o
JOIN mart.stg_customers AS c ON c.customer_id = o.customer_id
LEFT JOIN items AS it ON it.order_id = o.order_id
LEFT JOIN pay AS pa ON pa.order_id = o.order_id
