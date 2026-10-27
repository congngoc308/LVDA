-- 1 dòng / người bán.
SELECT
  s.seller_id,
  s.zip_code_prefix,
  s.city,
  s.state
FROM mart.stg_sellers AS s
