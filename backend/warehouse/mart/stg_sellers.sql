-- Staging: người bán.
SELECT
  s.seller_id,
  s.seller_zip_code_prefix AS zip_code_prefix,
  s.seller_city AS city,
  s.seller_state AS state
FROM raw.sellers AS s
