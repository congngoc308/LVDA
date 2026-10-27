# LVDA — Lineage-Verified Data Agent (MVP)

Agent dữ liệu trả lời câu hỏi về warehouse bằng tiếng Việt và **kiểm từng con số theo lineage cột trước khi trả lời**.

![Demo LVDA](docs/media/demo.gif)

Video đầy đủ (2 phút 30 giây, kịch bản KB-1 đến KB-5): [docs/media/demo.mp4](docs/media/demo.mp4). Gồm:
- câu trả lời Xanh;
- cột đo sai được tự sửa;
- join nhân dòng bị bắt;
- câu hỏi chưa có chỉ số chuẩn được trả lời ở mức Vàng;
- SQL được kiểm qua MCP.

## Vấn đề và cách LVDA giải

Text-to-SQL thường sai theo kiểu **vẫn chạy được**: chọn nhầm cột đo, thiếu bộ lọc nghiệp vụ, join làm nhân dòng, đếm theo
sai khóa. Người hỏi nhận một con số trông hợp lý mà không biết nó sai.

LVDA đọc câu SQL model vừa viết và rút ra **dấu vân tay lineage**: cột đo, bộ lọc, join, cột thời gian, độ chi tiết. Sau đó
so với định nghĩa chỉ số đã chứng nhận và đưa ra phán quyết **Xanh / Vàng / Đỏ** kèm bằng chứng.

- **Đỏ:** agent tự sửa tối đa hai vòng. Vẫn Đỏ thì con số bị giữ lại và chuyển vào hàng đợi duyệt.
- **Xanh:** câu trả lời còn được đối chiếu với SQL chuẩn của chỉ số trước khi hiển thị.
- **Câu hỏi không chỉ số nào diễn đạt được** (ví dụ "người bán ở SP có trên 10 đơn"): agent viết SQL riêng, chỉ kiểm bằng
  luật chung, tối đa ở mức Vàng và gửi data engineer duyệt.

> **Trạng thái MVP.** Dữ liệu là bộ tổng hợp theo lược đồ Olist (có sẵn bộ nạp CSV cho dữ liệu Kaggle thật). Mọi phần cần
> LLM chạy bằng **model mô phỏng** có cài sẵn lỗi, qua cùng giao diện mà một model tương thích OpenAI sẽ dùng: viết SQL,
> sửa SQL, viết câu trả lời và baseline LLM-as-judge. Những phần còn lại là thật: bộ kiểm định, vòng tự sửa, đối chiếu,
> phân quyền và bộ đánh giá.

## Kết quả

| | Kết quả |
|---|---|
| Bắt câu SQL lỗi | **142/142** (60 lỗi gài vào SQL chuẩn + 82 bản nháp đầu của agent) |
| Báo nhầm | **0/60** câu SQL đúng |
| Thời gian kiểm | p50 ≈ 12 ms, p95 ≈ 17 ms, không gọi LLM |
| So với LLM-as-judge (mô phỏng) | judge bắt 60–65%, báo nhầm 8–24%, 3 lần chạy cho cùng kết quả chỉ 48–75% số câu |
| Agent, mock-small | 31% đúng khi không kiểm → **91%** khi có bộ kiểm + tự sửa; câu sai lọt qua từ 80 xuống 1 |

Tập lỗi do chính dự án sinh ra. Vì vậy các con số đo được **những loại lỗi đã biết**, chưa phải các kiểu sai chưa biết của
một model thật.
- Phương pháp, bảng đầy đủ và giới hạn: [EVAL.md](EVAL.md).
- Kiến trúc: [ARCHITECTURE.md](ARCHITECTURE.md).

## Chạy thử

**Cách 1: toàn bộ trong Docker** (cần Docker Desktop):

```powershell
docker compose up -d --build           # db :5460, api :8020, web :5179 (lần đầu tự seed dữ liệu), nguồn mẫu :5461
docker compose --profile mysql up -d   # tùy chọn: nguồn MySQL mẫu ở :3307
```

**Cách 2: chạy dev** (Python 3.11, Node 20 trở lên):

```powershell
docker compose up -d --wait db
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[mcp,dev]"
.\.venv\Scripts\python -m lvda.seed.bootstrap            # --reset làm lại từ đầu, --olist-dir <đường dẫn> dùng CSV thật, --no-enterprise bỏ warehouse 500 bảng
.\.venv\Scripts\python -m uvicorn lvda.main:app --port 8020
cd ..\frontend; npm install; npm run dev
```

Sau lần cài đầu, `.\scripts\dev.ps1` bật cả ba. Nếu có `make`: `make up`, `make seed`, `make api`, `make web`. Trên Windows,
nếu bootstrap báo `UnicodeEncodeError` thì đặt `PYTHONUTF8=1` trước khi chạy.

Mở http://localhost:5179. Mật khẩu của các tài khoản mẫu là `lvda1234`:

| Email | Vai trò |
|---|---|
| `engineer@lvda.dev` | engineer: định nghĩa và chứng nhận chỉ số, duyệt, quản lý thành viên, link chia sẻ, cấu hình |
| `analyst@lvda.dev` | viewer: hỏi, kiểm SQL, xem chỉ số và dữ liệu (cột dữ liệu cá nhân bị che) |
| `guest@lvda.dev` | chưa có quyền gì: dùng để thử link chia sẻ |

Trang đăng nhập có nút đăng ký. Tài khoản mới chưa có quyền vào database nào cho tới khi được mời hoặc mở link chia sẻ.

Trang giới thiệu sản phẩm (14 trang, không cần đăng nhập) ở http://localhost:5179/gioi-thieu.

Cấu hình qua biến môi trường, xem [.env.example](.env.example).

## Các màn hình

Thanh trên cùng có bốn tab và hai nút: database đang mở, **Chỉ số & cấu hình**. Viewer thấy Hỏi & kiểm và Dữ liệu; engineer
thấy cả bốn tab.

### Hỏi & kiểm

Một ô nhập cho cả câu hỏi và SQL: gõ `SELECT`/`WITH` thì ô tự chuyển sang chế độ kiểm SQL.
- **Trước khi gửi:** ô nhập cho thấy câu hỏi được hiểu thế nào, và đưa ra các chỉ số khác nếu câu hỏi mơ hồ.
- **Trang đầu:** câu hỏi mẫu, câu SQL mẫu có lỗi thường gặp và lịch sử hỏi.
- **Câu trả lời:** con số, phán quyết, kết quả đối chiếu với SQL chuẩn, các giả định.
- **Phiếu kiểm** (gập lại với câu Xanh) có chuỗi các lần thử (Lần 0 · LLM viết · Đỏ → Lần 1 · Tự sửa · Xanh) và bốn tab:
  - **Lineage:** đồ thị nguồn → mart → phép tính → kết quả; nút sai tô đỏ, bộ lọc thiếu vẽ nét đứt.
  - **Phát hiện:** lỗi theo từng luật, kèm cách sửa.
  - **SQL:** so sánh giữa các vòng sửa.
  - **Trace:** các bước, token, chi phí, ms, request_id.
- **Cuối câu trả lời:** hỏi tiếp, tải CSV, đánh dấu số đúng hoặc sai (sai thì gửi duyệt).

**Chỉ số & cấu hình** mở một panel đè lên phiên hỏi:
- **Chỉ số:** định nghĩa YAML, đồ thị lineage, chứng nhận hoặc ngừng dùng, so sánh phiên bản, nhắc "cần chứng nhận lại",
  xuất YAML, nhập từ MetricFlow, form thêm chỉ số mới. Viewer chỉ xem được.
- **Luật, model & truy vấn mẫu** (chỉ engineer): bật/tắt và đổi mức của từng luật, chọn model, đặt giới hạn.

### Đánh giá (engineer)

Dashboard với 8 **card hệ thống**: Cần bạn xử lý, Phán quyết 30 ngày, Chỉ số vận hành, Xu hướng theo ngày, Từ câu hỏi tới con
số, Lỗi agent hay mắc, Chỉ số × phán quyết, Độ tin cậy của bộ kiểm định.
- **Card hệ thống:** chỉ được di chuyển, đổi cỡ hoặc gập lại, không sửa hay xóa được.
- **Cần bạn xử lý:** mở hàng đợi duyệt. Duyệt một câu trả lời thì nó thành truy vấn mẫu cho agent.

**Sửa dashboard** để thêm card riêng:
- Một agent hỏi tối đa ba câu (mục tiêu, người xem, tần suất), cho thấy từng bước nó làm, rồi thả card vào **khay**.
- Kéo thả để sắp xếp, có xem trước khi thả. Có 11 kiểu biểu đồ; mỗi card chọn được màu, thứ tự và so với cùng kỳ năm trước.
- Ctrl+Z để hoàn tác. Chỉ khi bấm Lưu thì thay đổi mới được ghi.
- Card riêng **không chứa SQL**. Nó chỉ lưu tham số của một chỉ số đã chứng nhận (chiều phân tích, kỳ, biểu đồ, top N).
  Mỗi lần hiển thị, server dựng lại SQL chuẩn và cho chạy qua bộ kiểm.
- Chỉ số nháp, cũ hoặc đã ngừng dùng bị từ chối.

**Báo cáo chi tiết** giữ các kết quả kỹ thuật:
- bộ kiểm theo từng luật và nguồn lỗi;
- so sánh với LLM-as-judge;
- agent theo model và cấu hình A–D.

### Dữ liệu

Catalog thiết kế cho hàng trăm bảng.
- **Trang đầu:** không liệt kê mọi bảng. Thay vào đó là bảng vừa xem, bảng agent dùng nhiều nhất, bảng đứng sau chỉ số đã
  chứng nhận, và các miền nghiệp vụ.
- **Tìm kiếm:** xếp hạng bảng và cột theo tên, mô tả (gõ không dấu cũng được) và mức agent đã dùng.
- **Canvas lineage (React Flow):** mỗi bảng mở ra một canvas, mỗi lớp một làn (nguồn → staging → mart → chỉ số). Bấm vào một
  cột thì cả đường đi của nó hiện ra, kèm panel:
  - **độ tin cậy:** câu hỏi đã dùng cột, tỉ lệ Xanh, lỗi bộ kiểm từng bắt, chỉ số đã chứng nhận;
  - **ảnh hưởng:** bảng, cột, chỉ số và truy vấn mẫu phía sau.
- **Mô tả:** engineer sửa và duyệt mô tả do AI viết nháp.
- **Nạp lại warehouse:** crawl lại các view và đánh dấu chỉ số có lineage thay đổi.

### Chia sẻ & nhật ký (engineer)

Ba tab:
- **Thành viên:** vai trò theo từng database.
- **Link chia sẻ:** có hạn dùng, giới hạn số lần dùng, thu hồi được. Link không bao giờ cấp quyền chứng nhận.
- **Nhật ký:** chỉ ghi thêm, không sửa được; lọc theo truy cập, chỉ số, duyệt, cấu hình và dữ liệu.

### Đường dẫn cũ

Các đường dẫn cũ vẫn mở được:
- `/reviews` → hàng đợi duyệt;
- `/members`, `/audit` → Chia sẻ & nhật ký;
- `/metrics`, `/settings` → panel cấu hình.

## Hai database: Olist và một warehouse 500 bảng

Bootstrap dựng thêm **"Bán lẻ đa kênh · 500 bảng"**, một warehouse bán lẻ tổng hợp để thử catalog ở quy mô doanh nghiệp:
- 10 miền × (20 bảng nguồn + 16 view staging + 14 view mart);
- 237 join được khai báo, 225 cột dữ liệu cá nhân, một khóa cố tình bị trùng, 20 bảng đã ngừng dùng, và join giữa các miền.

Lineage của warehouse này không được ghi sẵn ở đâu. Catalog đọc định nghĩa view từ Postgres (`pg_views`), phân tích bằng
sqlglot và lưu snapshot, giống một metadata crawler.

| Phép đo (500 bảng, 4.081 cột, Docker trên máy) | Kết quả |
|---|---|
| Crawl và phân tích mọi view thành lineage cột | 1,4 s (63 s trước khi dùng lại một `MappingSchema` của sqlglot) |
| Số view phân tích được lineage | 300 / 300 |
| Tìm trên mọi bảng và cột | ~100 ms, vài KB mỗi trang |
| Lân cận lineage; chi tiết bảng kèm độ tin cậy và ảnh hưởng | ~60 ms và ~140 ms, dưới 20 KB |

Database này chỉ có catalog. Nó không có chỉ số đã chứng nhận, nên agent không trả lời câu hỏi trên nó và tab Hỏi & kiểm có
báo rõ điều đó. Bộ kiểm và agent vẫn chạy trên Olist.

## Kết nối database của bạn (đồng bộ tăng dần)

Bấm vào database đang mở trên thanh trên cùng để mở cửa sổ **Chọn database**:
- **Của bạn:** các database bạn quản lý, kèm trạng thái đồng bộ.
- **Được chia sẻ:** kèm người chia sẻ và ngày hết hạn.
- **Quản lý nguồn** mở trang `/sources`:
  - nguồn được nhóm theo môi trường (prod / staging / dev);
  - lọc theo lỗi, đang sao chép, dữ liệu cũ (lần đồng bộ thành công cuối cách đây quá hai lần lịch chạy);
  - chi tiết mỗi nguồn có ba tab: Bảng, Lịch sử, Cài đặt.

**Kết nối database** là một trang bốn bước:
1. **Nguồn.** Dán chuỗi kết nối (`postgresql://`, `mysql://` hoặc JDBC), LVDA tách sẵn thành host / port / database /
   user / password, giữ các tham số phụ như `sslmode`.
2. **Kiểm tra.** Bốn bước theo thứ tự: mạng, xác thực, role chỉ đọc, đọc được schema. Hỏng ở bước nào thì dừng ở đó và chỉ
   rõ ô cần sửa.
3. **Chọn bảng.** Tên, môi trường (đoán từ host), lịch chạy và danh sách bảng. Mặc định chọn mọi bảng đọc được, cursor
   được gợi ý sẵn, chạy mỗi giờ.
4. **Sao chép lần đầu.** Số bảng xong, số dòng đã chép, thời gian còn lại ước theo tốc độ đo được. Việc chép chạy nền nên
   có thể đóng trang.

Phía sau form:

1. **Chỉ nhận role chỉ đọc.**
   - **PostgreSQL:** role không được là superuser, replication, CREATEROLE hay CREATEDB. Role cũng không được có CREATE trên
     database hay schema, và không có INSERT/UPDATE/DELETE/TRUNCATE trên bảng nào.
   - **MySQL:** `SHOW GRANTS` chỉ được có SELECT / SHOW VIEW.

   Role có quyền ghi bị từ chối, kèm câu SQL để tạo role chỉ đọc. Phiên kết nối cũng chạy ở chế độ chỉ đọc. Chuỗi kết nối
   được mã hóa bằng Fernet (`LVDA_SECRET_KEY`) và API không bao giờ trả nó ra.
2. **Mỗi bảng có khóa chính và một cột cursor.** `updated_at` được gợi ý tự động. Id tăng dần cũng dùng được, kèm cảnh báo
   rằng nó chỉ đúng với bảng chỉ thêm dòng.
3. **Chép vào schema `src_<id>` trong Postgres của LVDA.**
   - Lần đầu và mỗi lần làm mới toàn bộ dùng `COPY`: 158 nghìn dòng trong khoảng 8 s.
   - Các lần sau chỉ đọc dòng có `cursor >= watermark trước − lookback` (mặc định 5 phút, để không sót giao dịch commit
     muộn), phân trang theo `(cursor, khóa)` và upsert theo khóa.
   - Bảng không có cursor được làm mới toàn bộ mỗi lần chạy. Bảng không có khóa bị giới hạn 200.000 dòng.
4. **Crawl lại catalog sau mỗi lần chạy.** Độ chi tiết lấy từ khóa chính, join lấy từ khóa ngoại, mô tả lấy từ comment ở
   nguồn.

Lịch chạy có các mức: tắt, 15 phút, mỗi giờ, mỗi ngày. Một luồng nền trong API chạy lịch này (`LVDA_SCHEDULER=0` để tắt).
Nếu cột hoặc khóa ở nguồn thay đổi, bản sao được dựng lại.

**Giới hạn:**
- **Dòng bị xóa ở nguồn:** đồng bộ tăng dần không thấy. LVDA so số dòng sau mỗi lần chạy và đánh dấu bảng nào có bản sao
  nhiều dòng hơn nguồn; **Làm mới toàn bộ** sẽ sửa.
- **Dòng có cursor NULL:** chỉ về khi làm mới toàn bộ.

Đọc thay đổi từ WAL/binlog (CDC) sẽ bỏ được cả hai giới hạn. Nhưng CDC cần quyền replication và hạ tầng thêm
(Debezium/Kafka), nên nằm ngoài phạm vi MVP. Database đồng bộ về chỉ có catalog cho tới khi có chỉ số được chứng nhận.

**Thử trên máy.** `docker compose up` bật kèm một shop mẫu trên Postgres (`demo-pg`, :5461). Thêm `--profile mysql` để có
cùng shop đó trên MySQL 8.4 (:3307). Cả hai có user chỉ đọc `lvda_ro`, và màn kết nối có nút điền sẵn cho chúng. Để tạo thay
đổi ở nguồn (đơn mới, đổi trạng thái, đổi giá, sự kiện mới và một đơn bị xóa):

```powershell
docker compose exec api python -m lvda.demo_source            # --kind mysql cho nguồn MySQL
```

## CLI và MCP

```powershell
lvda verify --sql "SELECT COUNT(o.order_id) FROM mart.fct_orders o" --metric order_count   # thoát với mã 1 nếu Đỏ hoặc bị chặn

# MCP: verify_sql, explain_sql_lineage, list_metrics, get_metric_definition, run_certified_metric
claude mcp add lvda -- D:\CODE\LVDA\backend\.venv\Scripts\python D:\CODE\LVDA\backend\mcp_server.py   # stdio
python backend\mcp_server.py --http                                                                  # http://127.0.0.1:8021/mcp
```

## Kiểm thử và đánh giá

```powershell
make check     # ruff + mypy (strict cho bộ kiểm) + 285 test, coverage bộ kiểm phải từ 80%
make eval      # chạy lại mọi con số trong EVAL.md; báo cáo ở backend/eval/results/*.md|json
.\scripts\eval.ps1          # giống make eval, cho Windows không có make
```

Test dùng chung database với app (mặc định :5460). Nếu dữ liệu dev đã bị đổi tay, ví dụ gỡ `analyst@lvda.dev` khỏi
database 1, vài test phân quyền sẽ lỗi. Khi đó chạy trên một Postgres sạch sau `lvda.seed.bootstrap`, giống CI.

CI (`.github/workflows/ci.yml`) chạy lần lượt:
1. quét secret bằng gitleaks;
2. ruff, rồi mypy;
3. bootstrap;
4. pytest kèm coverage;
5. đánh giá (báo cáo được tải lên làm artifact);
6. build frontend.

## Cắm LLM thật

`lvda/llm.py` đã có client tương thích OpenAI (OpenRouter, Ollama, vLLM). Bật bằng các biến:
- `LVDA_LLM_PROVIDER=openai`
- `LVDA_LLM_BASE_URL`
- `LVDA_LLM_API_KEY`
- `LVDA_LLM_MODEL`

Structured output (thử lại một lần khi sai lược đồ), cache và tính chi phí vẫn dùng chung.

Client này **chưa được thử với endpoint thật**. Để chạy tốt với một model thật vẫn cần thêm việc:
- viết prompt riêng cho từng việc (`generate_sql`, `fix_sql`, `generate_adhoc_sql`, `compose_answer`, `judge`);
- tách vài chỗ trong `agent/pipeline.py` đang gọi thẳng vào `mock_llm`;
- thêm thử lại và timeout cho lời gọi API, và lấy số token thật từ API thay cho ước lượng.

Ý tưởng bộ phân tích SQL và đồ thị lineage bắt nguồn từ dự án nhóm P-116 Lineage AI (VinUni AI20K); LVDA viết lại từ đầu.
