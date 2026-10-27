-- Staging: sản phẩm, kèm tên danh mục tiếng Anh.
SELECT
  p.product_id,
  p.product_category_name AS category_pt,
  t.product_category_name_english AS category,
  p.product_weight_g AS weight_g
FROM raw.products AS p
LEFT JOIN raw.product_category_name_translation AS t ON t.product_category_name = p.product_category_name
