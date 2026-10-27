-- Staging: tọa độ theo mã bưu chính (không duy nhất).
SELECT
  g.geolocation_zip_code_prefix AS zip_code_prefix,
  g.geolocation_lat AS lat,
  g.geolocation_lng AS lng,
  g.geolocation_city AS city,
  g.geolocation_state AS state
FROM raw.geolocation AS g
