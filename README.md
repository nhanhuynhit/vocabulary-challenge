# Vocabulary Challenge

Web học 2000 từ tiếng Anh cốt lõi cho người đi làm. Hiện đã có 400 từ (8 tuần, 40 bài).

Các phần chính:
- **Đăng nhập:** email và mật khẩu, kèm đăng nhập bằng Google (tùy chọn)
- **Bài học:** đám mây từ, phiên âm, V1–V2–V3, gia đình từ, từ liên quan, 3 câu ví dụ A1/A2/B1 và bài tập nhanh
- **Recall:** ôn bằng thẻ lật theo lịch lặp lại ngắt quãng (1, 3, 7, 14, 30, 60 ngày)
- **Lộ trình** và **Bảng xếp hạng** (cập nhật theo thời gian thực)
- **Lưu tiến độ:** theo từng tài khoản trên máy chủ, nên dùng được trên mọi thiết bị

Trang web là HTML/CSS/JS thuần, **không cần build**. Phần đăng nhập và cơ sở dữ liệu dùng **Supabase** (gói miễn phí). Bạn có thể host trên **Netlify**, **Vercel**, **Cloudflare Pages** hoặc bất kỳ host tĩnh nào.

```
index.html            Ứng dụng chính (bắt buộc đăng nhập)
login.html            Đăng nhập · Đăng ký · Quên mật khẩu · Đặt mật khẩu mới
css/                  Giao diện
js/config.js          ← Điền thông tin Supabase vào đây
js/app.js             Logic ứng dụng
js/login.js           Logic đăng nhập
js/vendor/            Thư viện supabase-js 2.45.4 (MIT), đã kèm sẵn
data/lessons.json     Toàn bộ nội dung bài học
img/                  Linh vật, hình minh họa
supabase/schema.sql   Cấu trúc cơ sở dữ liệu và quy tắc bảo mật
```

---

## Bước 1. Tạo dự án Supabase (khoảng 5 phút)

1. Vào https://supabase.com, đăng ký, rồi bấm **New project**.
   - Đặt tên, tạo mật khẩu database (hãy lưu lại).
   - Region: chọn **Southeast Asia (Singapore)** cho nhanh ở Việt Nam.
2. Khi dự án đã tạo xong, vào **SQL Editor → New query**.
   - Dán toàn bộ nội dung tệp `supabase/schema.sql` rồi bấm **Run**. Kết quả phải là *Success*.
   - Lệnh này tạo 3 bảng `profiles`, `progress`, `board` cùng quy tắc bảo mật: mỗi người chỉ đọc và ghi được tiến độ của mình, còn bảng xếp hạng thì ai đăng nhập cũng xem được.
3. Vào **Project Settings → API** và sao chép 2 giá trị:
   - **Project URL**, dạng `https://abcd1234.supabase.co`
   - **anon public** key
4. Mở `js/config.js` và điền vào:
   ```js
   window.VC_CONFIG = {
     SUPABASE_URL: "https://abcd1234.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGciOi...",
     GOOGLE_LOGIN: false
   };
   ```
   > Khóa **anon** được phép công khai trên web, vì dữ liệu đã được bảo vệ bởi Row Level Security.
   > **Tuyệt đối không** dán khóa `service_role` vào bất kỳ tệp nào của trang web.

## Bước 2. Chạy thử trên máy

Mở terminal trong thư mục dự án và chạy một trong hai lệnh:

```bash
npx serve .
```

```bash
python3 -m http.server 8000
```

Mở trình duyệt tại địa chỉ terminal hiển thị (ví dụ http://localhost:8000). Trang sẽ tự chuyển sang `login.html`. Hãy đăng ký thử một tài khoản.

> Không mở trực tiếp tệp `index.html` bằng cách nhấp đúp, vì trình duyệt sẽ chặn tải `data/lessons.json`.

## Bước 3. Đưa lên host

**Cách nhanh nhất: Netlify Drop**
1. Vào https://app.netlify.com/drop.
2. Kéo thả **cả thư mục** `vocabulary-challenge` vào trang.
3. Bạn nhận được địa chỉ dạng `https://ten-ngau-nhien.netlify.app`. Có thể đổi tên trong **Site settings**.

**Hoặc Vercel / Netlify qua GitHub** (tự cập nhật mỗi khi bạn sửa code)
1. Đưa thư mục này lên một repository GitHub.
2. Trên Vercel: **Add New → Project → Import** repository đó.
   - Framework Preset: **Other**, không cần Build Command.
   - Bấm **Deploy**.

**Gắn tên miền riêng:** vào **Domains** trên Vercel hoặc Netlify, thêm tên miền của bạn rồi làm theo hướng dẫn trỏ DNS.

## Bước 4. Khai báo địa chỉ web cho Supabase (bắt buộc)

Vào **Authentication → URL Configuration**:
- **Site URL:** địa chỉ web chính thức, ví dụ `https://vocab.congty.vn`
- **Redirect URLs:** thêm các dòng sau (đổi thành tên miền của bạn):
  ```
  https://vocab.congty.vn/index.html
  https://vocab.congty.vn/login.html
  http://localhost:8000/index.html
  http://localhost:8000/login.html
  ```

Nếu thiếu bước này, link xác nhận email và link đặt lại mật khẩu sẽ dẫn về sai trang.

## Bước 5. Email (quan trọng khi có nhiều người dùng)

Mặc định Supabase tự gửi email xác nhận và đặt lại mật khẩu, nhưng **giới hạn chỉ vài email mỗi giờ**. Con số này chỉ đủ để thử nghiệm.

Trước khi mời nhiều người, hãy cấu hình gửi email riêng: **Authentication → Emails → SMTP Settings**. Bạn có thể dùng dịch vụ gửi email như Resend, Brevo, SendGrid hoặc Amazon SES (đều có gói miễn phí hoặc rẻ).

Các thiết lập khác:
- **Bỏ bước xác nhận email** (đăng ký xong vào học ngay): **Authentication → Providers → Email**, tắt **Confirm email**. Đổi lại, người dùng có thể đăng ký bằng email không có thật.
- **Đổi nội dung email sang tiếng Việt:** **Authentication → Emails → Templates**.

## Bước 6 (tùy chọn). Đăng nhập bằng Google

1. Vào Google Cloud Console, mục **APIs & Services → Credentials**, tạo **OAuth client ID** loại *Web application*.
   - **Authorized redirect URI:** dùng địa chỉ callback mà Supabase hiển thị ở **Authentication → Providers → Google** (dạng `https://abcd1234.supabase.co/auth/v1/callback`).
2. Dán **Client ID** và **Client secret** vào Supabase ở mục **Providers → Google**, rồi bật provider.
3. Trong `js/config.js`, đặt `GOOGLE_LOGIN: true`.

---

## Thêm bài học mới

Toàn bộ nội dung nằm trong `data/lessons.json`. Mỗi bài có dạng:

```json
{"id":"w9d1","week":9,"day":1,"title":"Tên bài","en":"English title","words":[ ... 10 từ ... ]}
```

Thêm tuần mới vào mảng `weeks` và bài mới vào mảng `lessons`, rồi đưa tệp lên host lại. Tiến độ của người học không bị ảnh hưởng.

## Quản lý người dùng

- **Xem danh sách tài khoản:** **Authentication → Users**. Xóa một tài khoản ở đây sẽ tự xóa luôn tiến độ và dòng xếp hạng của người đó.
- **Xem và sửa dữ liệu:** **Table Editor**, chọn bảng `progress`, `board` hoặc `profiles`.
- **Lưu ý về bảng xếp hạng:** mỗi người tự ghi số liệu của mình. Một người rành kỹ thuật có thể sửa số của chính họ, nhưng không sửa được số của người khác. Nếu cần chống gian lận chặt hơn, phải chuyển phần tính điểm lên máy chủ (Supabase Edge Functions).

## Sức chứa

Gói miễn phí của Supabase có 50.000 người dùng hoạt động mỗi tháng và 500 MB cơ sở dữ liệu. Mỗi người học chỉ chiếm vài KB, nên đủ cho hàng chục nghìn người. Khi vượt mức, nâng lên gói Pro.
