# Live Effect

Ứng dụng Windows tạo hiệu ứng cho livestream TikTok và stream game. Chạy song song với
OBS Studio, TikTok LIVE Studio, Streamlabs, vMix… qua **một link overlay duy nhất**.

- **Tự động theo sự kiện TikTok LIVE**: quà, follow, tim, chia sẻ, bình luận có từ khoá, người vào phòng.
- **Video hiệu ứng toàn màn hình**: WebM trong suốt, hoặc MP4 nền đen / nền xanh được **xoá nền ngay lúc phát**.
- **Hiệu ứng riêng cho từng người**: phát video chào khi một ID TikTok cụ thể vào phòng hoặc tặng quà.
- **Điều khiển bằng điện thoại / máy tính bảng**: quét mã QR là có bảng nút bấm, không cần Stream Deck, không cần cài app.
- 8 hiệu ứng có sẵn (pháo giấy, pháo hoa, tim, sao, xu, tuyết, mưa quà, viền sáng), 6 âm thanh, thông báo, khung bình luận, thanh mục tiêu, giọng đọc.
- Phím tắt toàn hệ thống cho stream game (YouTube, Facebook, Twitch qua OBS).

## Cài đặt

Tải bản dựng mới nhất ở tab **Actions** của kho mã này (mục *Build Windows app* → *Artifacts* → `LiveEffect-windows`).
Trong đó có bản cài đặt và bản chạy thẳng (`LiveEffect-portable-*.exe`).

> Bản dựng chưa ký số nên lần đầu Windows SmartScreen sẽ cảnh báo: chọn **More info → Run anyway**.

## Dùng trong 3 bước

1. **Dán link overlay** (mặc định `http://127.0.0.1:3939/overlay`) vào phần mềm live:
   - OBS: *Sources → + → Browser*, kích thước 1080×1920 (dọc) hoặc 1920×1080 (ngang), kéo lên trên cùng.
   - TikTok LIVE Studio: *Thêm nguồn → Liên kết*, kéo cho phủ kín khung hình.
2. **Nhập ID TikTok** của kênh đang live rồi bấm *Kết nối*. Không cần mật khẩu.
3. **Bấm thử** các nút giả lập. Hiệu ứng hiện ở khung xem thử và trong phần mềm live.

### Điều khiển bằng điện thoại

Mục *Điện thoại* → bật công tắc → quét mã QR bằng camera (điện thoại và máy tính chung Wi-Fi).
Mỗi kịch bản có sự kiện **Nút bấm tay** là một nút trên điện thoại. Trong *Hiển thị → Thư viện*, bấm **Tạo nút**
cạnh một video để có ngay nút phát video đó toàn màn hình.

Tính năng này tắt mặc định. Khi bật, ứng dụng mở một cổng trong mạng nội bộ chỉ phục vụ trang điều khiển;
mọi lệnh phải kèm mã ghép nối ngẫu nhiên nằm trong mã QR. *Đổi mã ghép nối* để thu hồi các thiết bị cũ.

## Giới hạn cần biết

- Kết nối TikTok dùng thư viện không chính thức [`tiktok-live-connector`](https://github.com/zerodytrash/TikTok-Live-Connector),
  ký kết nối qua dịch vụ Euler Stream (miễn phí có giới hạn lượt; có thể nhập khoá riêng ở *Bắt đầu → Nâng cao*).
  TikTok đổi giao thức thì cần cập nhật thư viện.
- Giọng đọc tiếng Việt cần cài giọng `vi-VN` trong Windows.
- Chưa có: nhận chuyển khoản ngân hàng → hiệu ứng, điều khiển OBS (đổi cảnh), ảnh thu nhỏ cho nút video, kết nối chat YouTube.

## Phát triển

```bash
npm install
npm start          # mở ứng dụng Electron
npm run serve      # chỉ chạy lõi, mở http://127.0.0.1:3939/panel/ trong trình duyệt
npm test           # kiểm thử bộ máy kịch bản, máy chủ, điều khiển từ điện thoại
npm run audit      # duyệt toàn bộ giao diện bằng trình duyệt tự động (cần Playwright + ffmpeg)
npm run dist       # đóng gói Windows (chạy trên Windows)
```

| Thư mục | Nội dung |
| --- | --- |
| `electron/` | Vỏ Windows: cửa sổ, phím tắt toàn hệ thống |
| `src/` | Lõi: máy chủ cục bộ, bộ máy kịch bản, kết nối TikTok, máy chủ cho điện thoại |
| `public/overlay/` | Trang overlay: hệ hạt, âm thanh, xoá nền video, thông báo, widget |
| `public/panel/` | Bảng điều khiển |
| `public/remote/` | Trang điều khiển trên điện thoại |
