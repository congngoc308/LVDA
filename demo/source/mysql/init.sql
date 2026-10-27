-- Nguồn mẫu "shop" (MySQL 8) cùng cấu trúc với bản Postgres. updated_at tự cập nhật bằng ON UPDATE CURRENT_TIMESTAMP.
-- User lvda_ro chỉ có SELECT, SHOW VIEW trên shop.*.
USE shop;
SET SESSION cte_max_recursion_depth = 100000;

CREATE TABLE regions (
  code varchar(8) PRIMARY KEY,
  name varchar(80) NOT NULL
) COMMENT = 'Vùng bán hàng';

CREATE TABLE customers (
  id bigint PRIMARY KEY,
  full_name varchar(120) NOT NULL,
  email varchar(160),
  region_code varchar(8) COMMENT 'Vùng của địa chỉ giao hàng mặc định',
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Lần sửa gần nhất',
  FOREIGN KEY (region_code) REFERENCES regions(code)
) COMMENT = 'Khách hàng đã đăng ký';

CREATE TABLE products (
  id int PRIMARY KEY,
  name varchar(120) NOT NULL,
  category varchar(40) NOT NULL,
  price decimal(12,2) NOT NULL COMMENT 'Giá bán hiện tại, VND',
  active tinyint(1) NOT NULL DEFAULT 1,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT = 'Danh mục sản phẩm';

CREATE TABLE orders (
  id bigint PRIMARY KEY,
  customer_id bigint NOT NULL,
  status varchar(16) NOT NULL COMMENT 'processing → shipped → delivered, hoặc canceled',
  total decimal(14,2) NOT NULL DEFAULT 0 COMMENT 'Tổng tiền đơn, VND',
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
) COMMENT = 'Đơn hàng, một dòng mỗi đơn';

CREATE TABLE order_items (
  order_id bigint NOT NULL,
  line_no int NOT NULL,
  product_id int NOT NULL,
  qty int NOT NULL,
  unit_price decimal(12,2) NOT NULL,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id, line_no),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
) COMMENT = 'Dòng hàng trong đơn';

CREATE TABLE page_events (
  id bigint AUTO_INCREMENT PRIMARY KEY,
  customer_id bigint,
  event varchar(20) NOT NULL,
  payload json,
  created_at datetime NOT NULL
) COMMENT = 'Sự kiện web, chỉ thêm không sửa';

INSERT INTO regions VALUES ('HN', 'Hà Nội'), ('HCM', 'TP. Hồ Chí Minh'), ('DN', 'Đà Nẵng'), ('HP', 'Hải Phòng'),
  ('CT', 'Cần Thơ'), ('NT', 'Nha Trang'), ('HUE', 'Huế'), ('QN', 'Quảng Ninh');

INSERT INTO customers (id, full_name, email, region_code, created_at, updated_at)
WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 3000)
SELECT n, CONCAT('Khách hàng ', n), CONCAT('kh', n, '@example.vn'), ELT(1 + n % 8, 'HN','HCM','DN','HP','CT','NT','HUE','QN'),
       NOW() - INTERVAL FLOOR(20 + RAND(n) * 380) DAY, NOW() - INTERVAL FLOOR(1 + RAND(n + 7) * 19) DAY
FROM seq;

INSERT INTO products (id, name, category, price, active, updated_at)
WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 200)
SELECT n, CONCAT('Sản phẩm ', n), ELT(1 + n % 6, 'Điện tử','Gia dụng','Thời trang','Sách','Mỹ phẩm','Thể thao'),
       ROUND(50000 + RAND(n) * 4950000, -3), n % 17 <> 0, NOW() - INTERVAL FLOOR(RAND(n + 3) * 90) DAY
FROM seq;

INSERT INTO orders (id, customer_id, status, created_at, updated_at)
WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 30000)
SELECT n, 1 + FLOOR(RAND(n) * 3000),
       CASE WHEN RAND(n + 1) < 0.78 THEN 'delivered' WHEN RAND(n + 1) < 0.86 THEN 'shipped' WHEN RAND(n + 1) < 0.93 THEN 'processing' ELSE 'canceled' END,
       NOW() - INTERVAL FLOOR(1 + RAND(n + 2) * 179) DAY, NOW() - INTERVAL FLOOR(1 + RAND(n + 2) * 170) DAY
FROM seq;
UPDATE orders SET updated_at = created_at + INTERVAL FLOOR(RAND(id) * 5) DAY WHERE updated_at < created_at;

INSERT INTO order_items (order_id, line_no, product_id, qty, unit_price, updated_at)
WITH RECURSIVE l (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM l WHERE n < 4)
SELECT o.id, l.n, 1 + FLOOR(RAND(o.id * 4 + l.n) * 200), 1 + FLOOR(RAND(o.id + l.n) * 3), 0, o.updated_at
FROM orders o JOIN l ON l.n <= 1 + (o.id % 4);
UPDATE order_items i JOIN products p ON p.id = i.product_id SET i.unit_price = p.price, i.updated_at = i.updated_at;
UPDATE orders o JOIN (SELECT order_id, SUM(qty * unit_price) AS total FROM order_items GROUP BY order_id) s ON s.order_id = o.id
  SET o.total = s.total, o.updated_at = o.updated_at;

INSERT INTO page_events (customer_id, event, payload, created_at)
WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 50000)
SELECT 1 + FLOOR(RAND(n) * 3000), ELT(1 + FLOOR(RAND(n + 9) * 4), 'view','search','add_to_cart','checkout'),
       JSON_OBJECT('product_id', 1 + FLOOR(RAND(n + 5) * 200)), NOW() - INTERVAL FLOOR(RAND(n + 1) * 43200) MINUTE
FROM seq;

CREATE USER 'lvda_ro'@'%' IDENTIFIED BY 'lvda_ro';
GRANT SELECT, SHOW VIEW ON shop.* TO 'lvda_ro'@'%';
