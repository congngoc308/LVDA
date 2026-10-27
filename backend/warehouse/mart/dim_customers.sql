-- 1 dòng / khách thật (customer_unique_id).
SELECT DISTINCT ON (c.customer_unique_id)
  c.customer_unique_id,
  c.zip_code_prefix,
  c.city,
  c.state
FROM mart.stg_customers AS c
ORDER BY c.customer_unique_id, c.customer_id
