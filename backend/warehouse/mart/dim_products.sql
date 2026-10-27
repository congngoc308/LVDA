-- 1 dòng / sản phẩm.
SELECT
  p.product_id,
  p.category_pt,
  p.category,
  p.weight_g
FROM mart.stg_products AS p
