-- Nguồn mẫu "shop" (Postgres) cho tính năng kết nối + đồng bộ tăng dần.
-- Bảng có updated_at (trigger tự cập nhật), một bảng chỉ thêm (page_events, mốc là id), một bảng không có cột mốc
-- (regions: làm mới toàn bộ), một bảng không có khóa (audit_trail). Role lvda_ro chỉ có SELECT.

CREATE TABLE regions (
  code text PRIMARY KEY,
  name text NOT NULL
);
COMMENT ON TABLE regions IS 'Vùng bán hàng';

CREATE TABLE customers (
  id bigint PRIMARY KEY,
  full_name text NOT NULL,
  email text,
  region_code text REFERENCES regions(code),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
COMMENT ON TABLE customers IS 'Khách hàng đã đăng ký';
COMMENT ON COLUMN customers.region_code IS 'Vùng của địa chỉ giao hàng mặc định';
COMMENT ON COLUMN customers.updated_at IS 'Lần sửa gần nhất (trigger tự cập nhật)';

CREATE TABLE products (
  id int PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  price numeric(12,2) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL
);
COMMENT ON TABLE products IS 'Danh mục sản phẩm';
COMMENT ON COLUMN products.price IS 'Giá bán hiện tại, VND';

CREATE TABLE orders (
  id bigint PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers(id),
  status text NOT NULL,
  total numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
COMMENT ON TABLE orders IS 'Đơn hàng, một dòng mỗi đơn';
COMMENT ON COLUMN orders.status IS 'processing → shipped → delivered, hoặc canceled';
COMMENT ON COLUMN orders.total IS 'Tổng tiền đơn, VND';

CREATE TABLE order_items (
  order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  product_id int NOT NULL REFERENCES products(id),
  qty int NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (order_id, line_no)
);
COMMENT ON TABLE order_items IS 'Dòng hàng trong đơn';

CREATE TABLE page_events (
  id bigserial PRIMARY KEY,
  customer_id bigint,
  event text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL
);
COMMENT ON TABLE page_events IS 'Sự kiện web, chỉ thêm không sửa';

CREATE TABLE audit_trail (
  at timestamptz NOT NULL,
  message text NOT NULL
);

SELECT setseed(0.42);

INSERT INTO regions VALUES ('HN', 'Hà Nội'), ('HCM', 'TP. Hồ Chí Minh'), ('DN', 'Đà Nẵng'), ('HP', 'Hải Phòng'),
  ('CT', 'Cần Thơ'), ('NT', 'Nha Trang'), ('HUE', 'Huế'), ('QN', 'Quảng Ninh');

INSERT INTO customers
SELECT g, 'Khách hàng ' || g, 'kh' || g || '@example.vn',
       (ARRAY['HN','HCM','DN','HP','CT','NT','HUE','QN'])[1 + (g % 8)], ts, least(now() - interval '1 day', ts + random() * interval '60 days')
FROM (SELECT g, now() - interval '400 days' + random() * interval '380 days' AS ts FROM generate_series(1, 3000) g) s;

INSERT INTO products
SELECT g, 'Sản phẩm ' || g, (ARRAY['Điện tử','Gia dụng','Thời trang','Sách','Mỹ phẩm','Thể thao'])[1 + (g % 6)],
       round((50000 + random() * 4950000)::numeric, -3), g % 17 <> 0, now() - random() * interval '90 days'
FROM generate_series(1, 200) g;

INSERT INTO orders (id, customer_id, status, created_at, updated_at)
SELECT g, 1 + floor(random() * 3000)::int,
       CASE WHEN r < 0.78 THEN 'delivered' WHEN r < 0.86 THEN 'shipped' WHEN r < 0.93 THEN 'processing' ELSE 'canceled' END,
       ts, least(now() - interval '1 hour', ts + random() * interval '6 days')
FROM (SELECT g, random() AS r, now() - interval '180 days' + random() * interval '179 days' AS ts FROM generate_series(1, 30000) g) s;

INSERT INTO order_items
SELECT o.id, l, 1 + floor(random() * 200)::int, 1 + floor(random() * 3)::int, 0, o.updated_at
FROM orders o CROSS JOIN generate_series(1, 4) l WHERE l <= 1 + (o.id % 4);
UPDATE order_items i SET unit_price = p.price FROM products p WHERE p.id = i.product_id;
UPDATE orders o SET total = s.total FROM (SELECT order_id, sum(qty * unit_price) AS total FROM order_items GROUP BY 1) s WHERE s.order_id = o.id;

INSERT INTO page_events (customer_id, event, payload, created_at)
SELECT 1 + floor(random() * 3000)::int, (ARRAY['view','search','add_to_cart','checkout'])[1 + floor(random() * 4)::int],
       jsonb_build_object('product_id', 1 + floor(random() * 200)::int), now() - random() * interval '30 days'
FROM generate_series(1, 50000);

INSERT INTO audit_trail SELECT now() - g * interval '1 day', 'Sao lưu hằng ngày thành công' FROM generate_series(1, 30) g;

-- từ giờ mọi lần sửa đều đẩy updated_at lên, đúng như một hệ thống thật
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER customers_touch BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER products_touch BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER orders_touch BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER order_items_touch BEFORE UPDATE ON order_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE ROLE lvda_ro LOGIN PASSWORD 'lvda_ro';
GRANT CONNECT ON DATABASE shop TO lvda_ro;
GRANT USAGE ON SCHEMA public TO lvda_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lvda_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO lvda_ro;
ANALYZE;
