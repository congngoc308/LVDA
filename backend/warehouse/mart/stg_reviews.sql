-- Staging: đánh giá.
SELECT
  r.review_id,
  r.order_id,
  r.review_score,
  r.review_comment_message AS comment,
  r.review_creation_date AS created_at
FROM raw.order_reviews AS r
