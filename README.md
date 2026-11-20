# Live Effect

Ứng dụng Windows tạo hiệu ứng cho livestream TikTok và stream game. Chạy song song với
OBS Studio, TikTok LIVE Studio, Streamlabs, vMix… qua **một link overlay duy nhất**.

- **Tự động theo sự kiện TikTok LIVE**: quà, follow, tim, chia sẻ, bình luận có từ khoá, người vào phòng.
- **Video hiệu ứng toàn màn hình**: WebM trong suốt, hoặc MP4 nền đen / nền xanh được **xoá nền ngay lúc phát**.
- **Hiệu ứng riêng cho từng người**: phát video chào khi một ID TikTok cụ thể vào phòng hoặc tặng quà.
- **Menu quà tặng**: danh sách quà thật của TikTok, gán hiệu ứng riêng cho từng món, và một công tắc tổng
  *Chúc mừng quà tặng* bật tắt được ngay trên điện thoại.
- **Phụ đề dịch**: bạn nói tiếng Việt, phụ đề tiếng Anh, Trung, Hàn… hiện ngay trên live. Miễn phí, chạy qua một trang
  mở trong Chrome (nhận giọng nói và bộ dịch có sẵn của trình duyệt), không cần khoá API.
- **Camera chuyển động (OBS)**: zoom vào, kéo ra, rung, nghiêng, xoay theo nút bấm, theo quà hoặc giật theo nhịp nhạc;
  xong mỗi lần camera trở về đúng chỗ cũ.
- **Hàng đợi hiệu ứng**: video toàn màn hình phát lần lượt theo ưu tiên; có nút *Tạm dừng hiệu ứng* (quà mới vẫn xếp hàng).
- **Chào khách theo bậc** và **sổ fan**: khách đặc biệt, top tặng quà, cấp người xem, đội fan, khách quen, khách lâu ngày quay lại.
- **Đồng hồ đếm giờ live** (quà cộng giờ), **top thả tim**, **quà to nhất**, **bảng hàng đợi trên sóng**.
- **Điều khiển OBS theo kịch bản**: đổi cảnh rồi tự quay về, ẩn hiện nguồn.
- **Trò chơi Hộp bí ẩn**: khán giả gõ số để mở hộp, ai mở trúng bẫy thì thua.
- **Webhook gửi ra ngoài**: đẩy sự kiện sang Discord, n8n, Make…
- **Hũ quà**: quà rơi vào một chiếc hũ trên màn hình, xếp chồng lên nhau; đủ số xu thì hũ vỡ ra ăn mừng rồi bắt đầu lại.
- **Nhạc và nhịp**: nghe bài nhạc đang phát, bắt nhịp, rồi cho sét, chớp màu, tàn lửa, viền sáng và sóng nhạc chạy theo.
- **Điều khiển bằng điện thoại / máy tính bảng**: quét mã QR là có bảng nút bấm, không cần Stream Deck, không cần cài app.
  Chọn một video trong thư viện ảnh của điện thoại là có ngay nút mới kèm ảnh thu nhỏ.
- **Ủng hộ bằng chuyển khoản → hiệu ứng**: mã VietQR hiện trên sóng, tiền vào thẳng tài khoản của bạn, ứng dụng nhận biết qua SePay
  rồi chạy hiệu ứng, hiện lời nhắn, đọc lời nhắn. Không tài khoản Live Effect, không phí, không qua máy chủ trung gian.
- **Quà từ bất kỳ nguồn nào**: một link nhận sự kiện trên máy để Streamer.bot, Stream Deck, công cụ donate khác gọi vào.
- **Stream game**: đọc chat Twitch không cần đăng nhập (từ khoá, Bits, Sub), phím tắt toàn hệ thống cho mọi nền tảng.
- **Tự thêm vào OBS** bằng một lần bấm (qua WebSocket có sẵn của OBS 28+).
- 8 hiệu ứng có sẵn (pháo giấy, pháo hoa, tim, sao, xu, tuyết, mưa quà, viền sáng), 6 âm thanh, thông báo, khung bình luận,
  thanh mục tiêu, bảng top tặng quà, giọng đọc.

## Cài đặt

Tải bản dựng mới nhất ở tab **Actions** của kho mã này (mục *Build Windows app* → *Artifacts* → `LiveEffect-windows`).
Trong đó có bản cài đặt và bản chạy thẳng (`LiveEffect-portable-*.exe`).

> Bản dựng chưa ký số nên lần đầu Windows SmartScreen sẽ cảnh báo: chọn **More info → Run anyway**.

## Dùng trong 3 bước

1. **Đưa overlay vào phần mềm live**. Với OBS: bấm *Tự thêm vào OBS giúp tôi* (OBS đang mở, đã bật
   *Tools → WebSocket Server Settings → Enable WebSocket server*). Hoặc dán link overlay (mặc định `http://127.0.0.1:3939/overlay`) bằng tay:
   - OBS: *Sources → + → Browser*, kích thước 1080×1920 (dọc) hoặc 1920×1080 (ngang), kéo lên trên cùng.
   - TikTok LIVE Studio: *Thêm nguồn → Liên kết*, kéo cho phủ kín khung hình.
2. **Nhập ID TikTok** của kênh rồi bấm *Kết nối*. Không cần mật khẩu. Nếu kênh chưa lên sóng, ứng dụng tự chờ
   và tự kết nối khi bạn bấm *Phát LIVE*.
3. **Bấm thử** các nút giả lập. Hiệu ứng hiện ở khung xem thử và trong phần mềm live.

### Điều khiển bằng điện thoại

Mục *Điện thoại* → bật công tắc → quét mã QR bằng camera (điện thoại và máy tính chung Wi-Fi).
Mỗi kịch bản có sự kiện **Nút bấm tay** là một nút trên điện thoại. Trong *Hiển thị → Thư viện*, bấm **Tạo nút**
cạnh một video để có ngay nút phát video đó toàn màn hình.

Tính năng này tắt mặc định. Khi bật, ứng dụng mở một cổng trong mạng nội bộ chỉ phục vụ trang điều khiển;
mọi lệnh phải kèm mã ghép nối ngẫu nhiên nằm trong mã QR. *Đổi mã ghép nối* để thu hồi các thiết bị cũ.

### Ủng hộ bằng chuyển khoản

Mục *Ủng hộ*: chọn ngân hàng, nhập số tài khoản → mã VietQR hiện trên khung hình (mã được tạo ngay trên máy).
Để hiệu ứng tự chạy khi có tiền vào, tạo tài khoản [SePay](https://sepay.vn), thêm tài khoản ngân hàng đó vào SePay,
tạo API Token (*Cấu hình công ty → API Access*) rồi dán vào ứng dụng. Ứng dụng hỏi SePay 6 giây một lần; giao dịch có
trước lúc bật không phát hiệu ứng. Nội dung chuyển khoản là lời nhắn hiện trên sóng, đã lọc bỏ số tài khoản và mã giao dịch.

### Link nhận sự kiện (nguồn khác)

Mục *Ủng hộ → Nguồn khác*: bật công tắc để có link dạng `http://127.0.0.1:3939/hook/<khoá>`. Gọi bằng GET hoặc POST JSON:

```
.../hook/<khoá>?type=donate&name=An&amount=50000&text=Co%20len
.../hook/<khoá>?type=gift&name=An&gift=Rose&coins=10&count=10
.../hook/<khoá>?button=Ăn mừng
```

`type` nhận `donate, gift, follow, share, chat, like, join`. Link chỉ nghe trên chính máy này.

## Giới hạn cần biết

- Kết nối TikTok dùng thư viện không chính thức [`tiktok-live-connector`](https://github.com/zerodytrash/TikTok-Live-Connector),
  ký kết nối qua dịch vụ Euler Stream (miễn phí có giới hạn lượt; có thể nhập khoá riêng ở *Bắt đầu → Nâng cao*).
  TikTok đổi giao thức thì cần cập nhật thư viện.
- Giọng đọc tiếng Việt cần cài giọng `vi-VN` trong Windows.
- *Nhạc và nhịp* cần bấm **Bắt đầu nghe** mỗi lần mở ứng dụng. Phần lắc / xoay camera theo nhịp cần nối với OBS và chưa có.
- Nhận chuyển khoản cần tài khoản SePay (bên thứ ba, có gói miễn phí giới hạn số giao dịch). Tên người chuyển không có sẵn
  trong dữ liệu ngân hàng nên thông báo ghi “Một bạn” kèm nội dung chuyển khoản.
- TikTok có thể hạn chế việc hiện mã nhận tiền trên live; tự cân nhắc theo quy định nền tảng.
- Video quay bằng iPhone (`.mov`) phát được khi là H.264; video HEVC cần đổi sang MP4 trước.
- Phụ đề dịch cần Chrome 138 trở lên để có bản dịch; trình duyệt cũ hơn chỉ hiện câu gốc. Camera chuyển động chỉ dùng
  với OBS (cần bật WebSocket Server), không dùng được với TikTok LIVE Studio.
- Chưa có: dịch bình luận của khán giả, chat YouTube / Facebook, đổi cảnh OBS, hiệu ứng bám theo người (tách nền),
  bấm hiệu ứng bằng dàn pad MIDI, hũ quà, mini-game, bảng PK.

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
