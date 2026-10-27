-- Staging: món trong đơn.
SELECT
  oi.order_id,
  oi.order_item_id,
  oi.product_id,
  oi.seller_id,
  oi.shipping_limit_date AS shipping_limit_at,
  oi.price,
  oi.freight_value
FROM raw.order_items AS oi
