# Hao phí sản xuất — Web app báo cáo hao phí theo công nhân, theo ngày (Odoo MRP)

Đây là một web app chạy trên **1 máy trong mạng LAN**. Các máy khác trong công ty chỉ cần mở trình duyệt vào `http://<IP máy chủ>:3100`, không phải cài gì.

App gồm các phần sau:
- **Báo cáo**: chọn nhanh khoảng ngày (Hôm nay / Hôm qua / 7 ngày / Tháng này / Tháng trước) hoặc tự chọn. Hiển thị:
  - Thẻ tổng: giờ chạy máy, giờ dừng máy, sản lượng, tỷ lệ phế so với định mức, số lượt vượt
  - Biểu đồ phế thực tế so với cho phép theo từng công nhân
  - Biểu đồ nguyên nhân phế và lý do dừng máy
  - Biểu đồ xu hướng tỷ lệ phế theo ngày
  - Bảng chi tiết: lọc, sắp xếp, gộp theo người. Bấm vào một dòng để mở ngăn kéo chi tiết theo từng công đoạn, kèm lỗi chất lượng
  - Nút xuất Excel (CSV)
- **Cài đặt**: kết nối Odoo (có nút kiểm tra), giờ chốt ngày cho ca đêm, định mức theo máy và theo sản phẩm, định mức NVL. Mọi thứ chỉnh trên giao diện, không cần sửa file.

Không cần `npm install` để chạy, vì app không phụ thuộc thư viện nào. Chỉ cần **Node.js ≥ 22.6**. Các lệnh `npm run ...` và `start.bat` đã kèm sẵn cờ `--experimental-strip-types`. Cờ này giúp Node 22.6–22.17 chạy thẳng file `.ts`; từ Node 22.18 tính năng đã bật sẵn.

## Chạy thử ngay (không cần Odoo)

```bash
npm run demo        # mở http://localhost:3100 — dữ liệu giả 8 công nhân, 4 máy, 14 ngày
```

## Cài lên máy chủ trong công ty (Windows)

1. Cài Node.js 22 LTS (≥ 22.6) hoặc mới hơn (https://nodejs.org) lên máy sẽ làm máy chủ. Nên chọn máy luôn bật và đặt IP tĩnh.
2. Chép thư mục này vào máy, ví dụ `D:\hao-phi`.
3. Mở `start.bat`, **đổi `APP_PASSWORD`**, rồi chạy file. Cửa sổ sẽ in ra địa chỉ LAN, ví dụ `http://192.168.1.20:3100`.
4. Mở địa chỉ đó trong trình duyệt → đăng nhập `admin` / mật khẩu vừa đặt → vào **Cài đặt** → điền Odoo → bấm **Kiểm tra kết nối** → **Lưu**.
5. Mở cổng trên Windows Firewall (chạy CMD bằng quyền Administrator):
   `netsh advfirewall firewall add rule name="Hao phi" dir=in action=allow protocol=TCP localport=3100`
6. Để app tự chạy khi bật máy, có hai cách. Cách 1: dùng Task Scheduler, tạo task *At startup* chạy `start.bat`. Cách 2: dùng NSSM để cài thành Windows Service (`nssm install HaoPhi "C:\Program Files\nodejs\node.exe" --experimental-strip-types D:\hao-phi\src\server.ts`, đặt *AppDirectory* là `D:\hao-phi`, rồi thêm biến môi trường `APP_PASSWORD`).

Cài đặt được lưu ở `data/settings.json`. Nên sao lưu file này. Trình duyệt không bao giờ nhận được API key thật, chỉ thấy chuỗi `••••••••`.

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | 3100 | Cổng web |
| `APP_PASSWORD` | (trống) | Mật khẩu đăng nhập. Để trống thì ai trong LAN cũng vào được, **không nên** |
| `APP_USER` | admin | Tên đăng nhập |
| `CACHE_TTL_SEC` | 300 | Thời gian giữ kết quả báo cáo trong cache (giây). Nút **Tải lại** sẽ bỏ qua cache |

Dòng lệnh vẫn dùng được, và dùng chung cài đặt với web: `npm run discover`, `npm run report -- --from 2026-11-01 --to 2026-11-02`.

---

## Cách tính (đọc kỹ trước khi dùng số liệu để đánh giá người)

### 1. Thời gian chạy máy
Nguồn là `mrp.workcenter.productivity`. Mỗi lần công nhân bấm Start/Pause/Block trên màn hình Work Order, Odoo sinh ra 1 log.

| loss_type | Ý nghĩa | Tính vào |
|---|---|---|
| `productive` | chạy trong thời gian chuẩn | **chạy máy** |
| `performance` | Odoo tự tách phần chạy **chậm hơn** thời gian chuẩn (Reduced Speed) | **chạy máy** (máy vẫn chạy) |
| `availability`, `quality` | dừng máy, có chọn lý do khi bấm Block | **dừng máy** + lý do |

Ngày được tính theo giờ VN, không theo UTC. Đặt `DAY_CUTOFF_HOUR=6` thì ca đêm 22h–6h được tính trọn cho ngày bắt đầu ca. Log đang mở (máy chạy, chưa bấm dừng) được tính tới thời điểm chạy báo cáo.

### 2. Phân bổ sản lượng & phế cho từng người
Odoo **không** ghi phế phẩm theo người mà theo **work order (WO)**. Tool phân bổ theo tỷ lệ thời gian chạy:

```
tỷ lệ = phút chạy của người X ngày D trên WO / tổng phút chạy của WO (mọi ngày, mọi người)
SL đạt của X  = qty_produced(WO) × tỷ lệ
SL phế của X  = Σ scrap gắn WO × tỷ lệ
```

Tổng phút của WO được lấy **trên mọi ngày**, kể cả ngày nằm ngoài khoảng báo cáo. Nếu chỉ lấy trong khoảng, WO chạy 3 ngày sẽ bị chia sai: người làm ngày đầu sẽ "gánh" 100%.
Phế không gắn WO (chỉ gắn MO) được phân bổ theo tỷ lệ thời gian trên toàn MO.

**Trade-off:** phân bổ theo thời gian là cách công bằng nhất mà dữ liệu chuẩn cho phép, nhưng nó **giả định phế xảy ra đều theo thời gian**. Nếu muốn quy trách nhiệm chính xác, cần cấu hình để mỗi lần ghi phế (Scrap trên tablet) gắn được với người đang đứng máy. Tool sẽ tự dùng thông tin đó khi có.

### 3. Định mức
`SL phế cho phép (WO) = setupQty × tỷ lệ + pct% × SL đạt`. Trong đó `setupQty` là hao phí lên máy (căn màu, căn bế) và `pct` là % trên sản lượng đạt.
Định mức được tra theo thứ tự ưu tiên: field Odoo `odooProductNormField` (nếu công ty đã tạo bằng Studio) → `byProduct[mã SP]` → `byWorkcenter[tên máy]` → `default`.

### 4. NVL
Chỉ tính các MO đã **done**. Kế hoạch = `product_uom_qty` của stock.move NVL, quy đổi theo SL thực làm. Thực tế = `quantity` (Odoo 17+) hoặc `quantity_done` (≤16), cộng thêm phần phế NVL.
Chỉ cộng NVL có đơn vị nằm trong `material.uomNames`, để không cộng lẫn mét giấy với kg mực.

## Điều kiện để số liệu đúng
1. **Công nhân phải đăng nhập theo từng người** trên tablet. Odoo 17+ Enterprise có tính năng *Employees* trên work center, khi đó log sẽ có `employee_id`.
   Nếu cả xưởng dùng chung 1 user tablet, báo cáo "theo người" sẽ dồn hết vào user đó. Script `discover` sẽ cho biết bao nhiêu log có `employee_id`.
2. Khi bấm **Block** phải chọn đúng lý do dừng, và khi **Scrap** phải chọn reason tag (Odoo 17+). Nếu không, cột nguyên nhân sẽ là "(không ghi lý do)".
3. Phải bấm Start/Stop đúng thực tế. Log bị bỏ quên không tắt sẽ thổi phồng giờ chạy máy.

## Kiến trúc

- `src/server.ts`: HTTP server viết bằng `node:http`. Có API `/api/report`, `/api/export`, `/api/settings`, `/api/test-connection`, `/api/workcenters`. Cache lưu luôn *promise* đang chạy, nên khi 10 người cùng mở trang thì Odoo chỉ nhận 1 request. Khi lưu cài đặt, cache bị xoá.
- `src/report.ts`: toàn bộ logic tính toán, dùng chung cho cả web và dòng lệnh.
- `public/`: giao diện viết bằng HTML/CSS/JS thuần, không cần bước build, chạy được cả khi không có internet. Tự chuyển giao diện sáng/tối theo hệ điều hành.

## Kiểm thử
`npm test` dựng một Odoo giả lập (`test/mock-odoo.ts`), chạy báo cáo và so với số đã tính tay. Kịch bản test gồm WO kéo dài qua 2 ngày, ca đêm qua 0h, chạy chậm (performance), phế NVL và quality alert.
Có thể chạy `node test/mock-odoo.ts` để có Odoo giả ở cổng 8069 và thử CLI mà không cần Odoo thật.
