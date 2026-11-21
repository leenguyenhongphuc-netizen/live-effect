// Quay video ngắn ứng dụng đang chạy (dữ liệu tạm, sự kiện giả lập), để xem được kết quả mà
// không cần mở máy tính. Dùng: node scripts/demo-video.js [thư_mục_ra]
// Ra hai tệp: 1-bang-dieu-khien.mp4 (bảng điều khiển + khung xem thử) và
// 2-dien-thoai.mp4 (điện thoại bên trái, thứ khán giả thấy bên phải).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { startApp } from '../src/server.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'live-effect-demo'));
const raw = path.join(out, 'raw');
fs.mkdirSync(raw, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-effect-demo-data-'));
const app = await startApp({ dataDir, port: 0 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = `http://127.0.0.1:${app.port}`;
const api = async (method, url, body) => (await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();

// Dòng chú thích ở mép dưới video.
const cap = (page, text, bottom = 18) => page.evaluate(([t, bottom]) => {
  let el = document.getElementById('demo-cap');
  if (!el) {
    el = document.createElement('div');
    el.id = 'demo-cap';
    el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);z-index:99999;max-width:86%;padding:10px 18px;border-radius:12px;background:rgba(0,0,0,.82);color:#fff;font:600 17px/1.35 system-ui,sans-serif;text-align:center;pointer-events:none';
    document.body.append(el);
  }
  el.style.bottom = `${bottom}px`;
  el.textContent = t;
}, [text, bottom]);

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const toMp4 = (src, dst, extra = []) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...src.flatMap((s) => ['-i', s]), ...extra, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-movflags', '+faststart', '-an', dst]);

try {
  // ----- Video 1: bảng điều khiển ------------------------------------------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: raw, size: { width: 1280, height: 720 } } });
  const desk = await ctx.newPage();
  await desk.goto(app.url);
  await desk.waitForSelector('.view');
  await cap(desk, '1. Mở ứng dụng: bên phải là khung xem thử, đúng thứ khán giả sẽ thấy');
  await sleep(2500);
  await cap(desk, '2. Giả lập một món quà lớn: pháo hoa và thông báo tên người tặng');
  await desk.click('text=Quà lớn');
  await sleep(4500);
  await desk.click('#clear-all');

  await cap(desk, '3. Bảng hiệu ứng: bấm ô nào chạy ô đó');
  await desk.click('#nav >> text=Bảng hiệu ứng');
  for (const name of ['Trái tim bay', 'Mưa xu', 'Bóng bay quà']) { await desk.click(`.tile:has-text("${name}")`); await sleep(2200); }
  await desk.click('#clear-all');

  await cap(desk, '4. Hũ quà: quà rơi vào hũ và xếp chồng lên nhau');
  await desk.click('#nav >> text=Quà tặng');
  await desk.locator('.card:has-text("Hũ quà") .switch').first().click();
  await desk.waitForSelector('text=Thả thử một quà');
  for (let i = 0; i < 6; i++) { await desk.click('text=Thả thử một quà'); await sleep(450); }
  await sleep(3000);
  await desk.locator('.card:has-text("Hũ quà") .switch').first().click();
  await sleep(600);

  await cap(desk, '5. Sân khấu: danh sách diễn, mỗi bài một tông màu và sương khói');
  const { config } = await api('GET', '/api/state');
  config.stage.shows = [
    { id: 'mo-man', name: 'Mở màn', track: '', look: { tint: '#ff2d55', fog: true }, cues: [{ t: 1, effect: 'fireworks' }, { t: 5, effect: 'hearts' }] },
    { id: 'ballad', name: 'Ballad', track: '', look: { tint: '#3b82f6', fog: true }, cues: [{ t: 1, effect: 'snow' }] },
    { id: 'ket', name: 'Kết', track: '', look: { tint: '#ffd23f', fog: false }, cues: [{ t: 1, effect: 'confetti' }] },
  ];
  await api('PUT', '/api/config', config);
  await desk.click('#nav >> text=Sân khấu');
  await desk.waitForSelector('#stage-next:not([disabled])');
  await sleep(1800);
  await cap(desk, '6. Bấm “Bắt đầu danh sách”: bài 1 lên hình (tông đỏ hồng, khói dưới sàn)');
  await desk.click('#stage-next');
  await sleep(4500);
  await cap(desk, '7. “Đẩy cao trào”: hình đậm lên trong 10 giây');
  await desk.click('#stage-boost');
  await sleep(3500);
  await cap(desk, '8. “Bài kế”: sang bài 2, không khí đổi sang xanh dương');
  await desk.click('#stage-next');
  await sleep(4500);
  await cap(desk, '9. “Dừng, về trò chuyện”: mọi thứ tắt, quay lại nói chuyện với khán giả');
  await desk.click('#stage-talk');
  await sleep(2500);
  const v1 = await desk.video().path();
  await ctx.close();
  toMp4([v1], path.join(out, '1-bang-dieu-khien.mp4'));

  // ----- Video 2: điện thoại điều khiển, khán giả thấy gì ---------------------
  const cfg2 = (await api('GET', '/api/state')).config;
  cfg2.remote.enabled = true;
  const saved = await api('PUT', '/api/config', cfg2);
  const info = await app.remote.info();
  const size = { width: 390, height: 720 };
  const pCtx = await browser.newContext({ viewport: size, hasTouch: true, isMobile: true, recordVideo: { dir: raw, size } });
  const oCtx = await browser.newContext({ viewport: size, recordVideo: { dir: raw, size } });
  const live = await oCtx.newPage();
  await live.goto(app.overlayUrl);
  // Overlay vốn trong suốt; thêm nền giả làm "hình camera" cho dễ nhìn.
  await live.addStyleTag({ content: 'html{background:linear-gradient(160deg,#2b2f4a,#141622 60%,#3a2a3f)!important}' });
  const phone = await pCtx.newPage();
  await phone.goto(`http://127.0.0.1:${info.port}/?k=${saved.config.remote.token}`);
  await phone.waitForSelector('.key');
  await cap(live, 'Màn hình live (khán giả thấy)');
  await cap(phone, 'Điện thoại: quét mã QR là có bảng nút', 96);
  await sleep(2500);
  await cap(phone, 'Bấm “Ăn mừng”', 96);
  await phone.tap('.key.mine >> text=Ăn mừng');
  await sleep(4000);
  await cap(phone, 'Bấm “Bắt đầu diễn”', 96);
  await phone.tap('#stage .key >> text=Bắt đầu diễn');
  await phone.waitForSelector('#stage .key >> text=Trò chuyện');
  await sleep(4000);
  await cap(phone, 'Bấm “Đẩy cao trào”', 96);
  await phone.tap('#stage .key >> text=Đẩy cao trào');
  await sleep(3500);
  await cap(phone, 'Bấm “Bài kế”', 96);
  await phone.tap('#stage .key >> text=Bài kế');
  await sleep(4000);
  await cap(phone, 'Bấm “Dừng mọi hiệu ứng”', 96);
  await phone.tap('#stage .key >> text=Trò chuyện');
  await phone.tap('#stop');
  await sleep(2000);
  const [vp, vo] = [await phone.video().path(), await live.video().path()];
  await pCtx.close(); await oCtx.close();
  toMp4([vp, vo], path.join(out, '2-dien-thoai.mp4'), ['-filter_complex', '[0:v]pad=400:720:0:0:black[a];[a][1:v]hstack=inputs=2']);
  console.log(`Xong: ${out}`);
} finally {
  await browser.close();
  await app.close();
  fs.rmSync(raw, { recursive: true, force: true });
}
