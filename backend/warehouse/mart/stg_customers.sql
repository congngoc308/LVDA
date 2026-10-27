-- Staging: khách theo từng đơn (customer_id) và khách thật (customer_unique_id).
SELECT
  c.customer_id,
  c.customer_unique_id,
  c.customer_zip_code_prefix AS zip_code_prefix,
  c.customer_city AS city,
  c.customer_state AS state
FROM raw.customers AS c
