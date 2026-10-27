-- 1 dòng / đánh giá. Một đơn có thể có nhiều đánh giá; is_latest đánh dấu bản mới nhất.
SELECT
  r.review_id,
  r.order_id,
  r.review_score,
  r.comment,
  r.created_at,
  ROW_NUMBER() OVER (PARTITION BY r.order_id ORDER BY r.created_at DESC) = 1 AS is_latest
FROM mart.stg_reviews AS r
