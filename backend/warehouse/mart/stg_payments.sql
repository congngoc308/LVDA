-- Staging: lần thanh toán.
SELECT
  p.order_id,
  p.payment_sequential,
  p.payment_type,
  p.payment_installments,
  p.payment_value
FROM raw.order_payments AS p
