-- NHIỀU dòng / mã vùng: zip_code_prefix không duy nhất, join theo cột này sẽ nhân dòng.
SELECT
  g.zip_code_prefix,
  g.lat,
  g.lng,
  g.city,
  g.state
FROM mart.stg_geolocation AS g
