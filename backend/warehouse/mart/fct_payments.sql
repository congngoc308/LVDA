-- 1 dòng / lần thanh toán. Một đơn có thể trả nhiều lần (voucher + thẻ).
SELECT
  p.order_id,
  p.payment_sequential,
  p.payment_type,
  p.payment_installments,
  p.payment_value
FROM mart.stg_payments AS p
