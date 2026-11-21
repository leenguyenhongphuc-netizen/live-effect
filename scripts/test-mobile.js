// Kiểm thử khói cho bản web trên điện thoại: dựng trang, mở bằng trình duyệt tự động với
// camera giả, rồi kiểm tra camera lên hình, clip xoá nền phát được ở cả hai lớp, phần
// tách người chạy, và không có lỗi. Dùng: npm run test:mobile [-- thư_mục_ảnh]
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
execFileSync(process.execPath, [path.join(root, 'scripts/build-mobile.js')]);
const dist = path.join(root, 'dist-mobile');
const shots = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'live-effect-mobile'));
fs.mkdirSync(shots, { recursive: true });
const { chromium } = createRequire(import.meta.url)('playwright');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(dist, p);
  if (!file.startsWith(dist) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  const data = fs.readFileSync(file);
  const head = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const a = Number(range[1]); const b = range[2] ? Number(range[2]) : data.length - 1;
    res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${b}/${data.length}`, 'Content-Length': b - a + 1 });
    res.end(data.subarray(a, b + 1));
    return;
  }
  res.writeHead(200, { ...head, 'Content-Length': data.length });
  res.end(data);
}).listen(0, '127.0.0.1');
await new Promise((r) => srv.on('listening', r));

const problems = [];
const note = (ok, text) => { console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${text}`); if (!ok) problems.push(text); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Đặt CAM=tệp.y4m để dùng một đoạn phim có người thật làm camera giả.
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  ...(process.env.CAM ? [`--use-file-for-fake-video-capture=${process.env.CAM}`] : [])] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, permissions: ['camera'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => note(false, `lỗi JS: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') note(false, `console: ${m.text()}`); });
  page.on('requestfailed', (r) => note(false, `không tải được: ${r.url()}`));
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  const small = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height < 44).length);
  note(small === 0 && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Màn hình cài đặt: nút đủ lớn, không tràn ngang');
  await page.screenshot({ path: path.join(shots, 'm1-cai-dat.png') });
  await page.tap('#go');
  await page.waitForFunction(() => window.__stage.started, null, { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('cam').videoWidth > 0);
  note(await page.evaluate(() => document.getElementById('setup').hidden && !document.querySelector('#stage button')), 'Sau khi bắt đầu: camera lên hình, màn hình live không còn nút nào');

  const lit = () => page.evaluate(() => {
    const c = document.querySelector('#front canvas, #behind canvas');
    if (!c || !c.width) return null;
    const t = document.createElement('canvas'); t.width = 54; t.height = 96;
    const x = t.getContext('2d'); x.drawImage(c, 0, 0, 54, 96);
    const d = x.getImageData(0, 0, 54, 96).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n += 1;
    return { layer: c.parentElement.id, share: n / (54 * 96) };
  });
  await page.evaluate(() => { window.__play('rong', 'front'); });
  await sleep(2600);
  const f = await lit();
  note(f?.layer === 'front' && f.share > 0.1 && f.share < 0.9, `Rồng phía trước: clip phát, nền đen đã xoá (hình chiếm ${Math.round((f?.share || 0) * 100)}% khung)`);
  await page.screenshot({ path: path.join(shots, 'm2-rong-truoc.png') });
  await page.waitForFunction(() => window.__stage.playing === 0, null, { timeout: 12000 });
  note(await page.evaluate(() => document.querySelectorAll('#front *').length) === 0, 'Hết clip: lớp hiệu ứng được dọn sạch');

  await page.waitForFunction(() => window.__stage.segmenter !== 'đang tải', null, { timeout: 30000 });
  note(await page.evaluate(() => window.__stage.segmenter) === 'sẵn sàng', 'Bộ tách người tải xong');
  await page.evaluate(() => { window.__play('rong', 'behind'); });
  // Máy không có card đồ hoạ thì tách người rất chậm: chờ tới khi clip thật sự lên hình.
  await page.waitForFunction(() => document.querySelector('#behind canvas')?.width > 0 && window.__stage.segFrames > 2, null, { timeout: 15000 }).catch(() => {});
  await sleep(1200);
  const b = await lit();
  const seg = await page.evaluate(() => window.__stage.segFrames);
  note(b?.layer === 'behind' && b.share > 0.1, 'Rồng sau lưng: clip phát ở lớp phía sau người');
  note(seg > 0, `Tách người đang chạy trong lúc có hiệu ứng sau lưng (${seg} khung)`);
  await page.screenshot({ path: path.join(shots, 'm3-rong-sau.png') });
  await page.waitForFunction(() => window.__stage.playing === 0, null, { timeout: 12000 });
  const idle = await page.evaluate(() => window.__stage.segFrames);
  await sleep(700);
  note(await page.evaluate(() => window.__stage.segFrames) === idle, 'Hết hiệu ứng sau lưng: ngừng tách người để máy đỡ nóng');
  note(await page.evaluate(() => window.__stage.lastError) === '', 'Không có lỗi phát clip hay tách người');
} catch (err) {
  note(false, `Kịch bản kiểm tra dừng giữa chừng: ${err.message}`);
} finally {
  await browser.close();
  srv.close();
}
console.log(problems.length ? `\n${problems.length} vấn đề cần sửa.` : '\nTất cả đều đạt.');
process.exitCode = problems.length ? 1 : 0;
