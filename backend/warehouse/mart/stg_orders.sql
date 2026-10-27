-- Staging: đổi tên cột của raw.orders, không biến đổi logic.
SELECT
  o.order_id,
  o.customer_id,
  o.order_status,
  o.order_purchase_timestamp AS purchased_at,
  o.order_approved_at AS approved_at,
  o.order_delivered_carrier_date AS carrier_at,
  o.order_delivered_customer_date AS delivered_at,
  o.order_estimated_delivery_date AS estimated_at
FROM raw.orders AS o
