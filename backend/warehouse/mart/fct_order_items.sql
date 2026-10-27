-- 1 dòng / món trong đơn. Một đơn có thể có nhiều món.
SELECT
  i.order_id,
  i.order_item_id,
  i.product_id,
  i.seller_id,
  i.price,
  i.freight_value,
  i.shipping_limit_at,
  p.category_pt,
  p.category
FROM mart.stg_order_items AS i
LEFT JOIN mart.stg_products AS p ON p.product_id = i.product_id
