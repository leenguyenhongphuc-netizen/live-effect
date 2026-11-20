// Kiểm tra toàn bộ luồng dùng thật bằng trình duyệt tự động: bảng điều khiển trên máy
// tính, trang điều khiển trên điện thoại, và overlay. Chạy trên thư mục dữ liệu tạm,
// không đụng tới cấu hình thật. Dùng: npm run audit [-- thư_mục_ảnh]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { startApp } from '../src/server.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const shots = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'live-effect-audit'));
fs.mkdirSync(shots, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-effect-audit-data-'));
const app = await startApp({ dataDir, port: 0 });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

const problems = [];
const note = (ok, text) => { console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${text}`); if (!ok) problems.push(text); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function watch(page, name) {
  page.on('pageerror', (e) => note(false, `${name}: lỗi JS: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') note(false, `${name}: console: ${m.text()}`); });
}

// Tràn ngang và vùng bấm nhỏ hơn 44px (bỏ qua phần tử ẩn và ô chọn ẩn bên trong công tắc).
const layoutCheck = () => {
  const small = [];
  for (const el of document.querySelectorAll('button, a, select, input:not([type=file]):not([type=checkbox]), summary, label.switch')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (el.closest('.seg')) { if (r.height < 36) small.push(`${el.textContent.trim().slice(0, 20)} ${Math.round(r.height)}px`); continue; }
    if (el.tagName === 'SUMMARY') { if (r.height < 30) small.push(`summary ${Math.round(r.height)}px`); continue; }
    if (r.height < 43.5 || r.width < 43.5) small.push(`${el.tagName} "${(el.textContent || el.value || '').trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, small };
};

async function checkLayout(page, name) {
  const r = await page.evaluate(layoutCheck);
  note(r.overflow <= 0, `${name}: không tràn ngang (${r.overflow}px)`);
  note(r.small.length === 0, `${name}: vùng bấm đủ lớn${r.small.length ? ` → ${r.small.join(' | ')}` : ''}`);
}

const VIEWS = ['Bắt đầu', 'Bảng hiệu ứng', 'Kịch bản', 'Điện thoại', 'Hiển thị', 'Nhật ký'];

try {
  // ----- Máy tính ---------------------------------------------------------
  const desk = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  watch(desk, 'máy tính');
  await desk.goto(app.url);
  await desk.waitForSelector('.view');
  const frame = () => desk.frames().find((f) => f.url().includes('/overlay'));
  const particles = () => frame().evaluate(() => window.__overlay.fx.particles.length);

  await desk.screenshot({ path: path.join(shots, '01-bat-dau.png') });
  const stage = await desk.locator('#stage').boundingBox();
  note(stage && stage.width > 200 && stage.height > 350, `Khung xem thử hiển thị (${Math.round(stage?.width)}x${Math.round(stage?.height)})`);
  await checkLayout(desk, 'Bắt đầu');
  const copyY = await desk.locator('text=Sao chép link').evaluate((el) => el.getBoundingClientRect().bottom);
  note(copyY < 820, `Bắt đầu: nút "Sao chép link" nằm trong màn hình đầu (y=${Math.round(copyY)})`);

  await desk.click('text=Quà lớn');
  await sleep(700);
  note((await particles()) > 20, `Giả lập quà lớn: overlay có ${await particles()} hạt hiệu ứng`);
  note((await frame().locator('.alert').textContent()).includes('Đại gia'), 'Giả lập quà lớn: hiện thông báo có tên người tặng');
  await desk.screenshot({ path: path.join(shots, '02-qua-lon.png') });
  note((await desk.locator('#side-status').textContent()).includes('chưa mở ở đâu'), 'Khung xem thử không bị tính là nguồn overlay thật');

  await desk.click('#clear-all');
  await sleep(300);
  note((await particles()) === 0, 'Nút dừng mọi hiệu ứng xoá sạch overlay');

  // Bảng hiệu ứng: bấm từng ô.
  await desk.click('#nav >> text=Bảng hiệu ứng');
  for (const name of ['Pháo giấy', 'Pháo hoa', 'Trái tim bay', 'Sao rơi', 'Mưa xu', 'Tuyết rơi', 'Mưa quà']) {
    await desk.click('#clear-all');
    await desk.click(`.tile:has-text("${name}")`);
    await sleep(500);
    note((await particles()) > 0, `Bảng hiệu ứng: "${name}" chạy`);
  }
  await desk.click('.tile:has-text("Viền sáng")');
  await sleep(200);
  note(await frame().locator('#border.on').count() === 1, 'Bảng hiệu ứng: "Viền sáng" chạy');
  await desk.screenshot({ path: path.join(shots, '03-bang-hieu-ung.png') });
  await checkLayout(desk, 'Bảng hiệu ứng');
  await desk.click('#clear-all');

  // Kịch bản: mở sửa, thêm mới, đổi sự kiện.
  await desk.click('#nav >> text=Kịch bản');
  await desk.click('.rule >> nth=1 >> text=Sửa');
  await desk.screenshot({ path: path.join(shots, '04-kich-ban.png') });
  await checkLayout(desk, 'Kịch bản (đang sửa)');
  await desk.click('text=Thêm kịch bản');
  await desk.waitForFunction(() => document.querySelectorAll('.rule').length === 8);
  const before = await desk.locator('.rule').count();
  await desk.locator('.rule-edit select').first().selectOption('join');
  await desk.locator('.rule-edit input[placeholder^="Bỏ trống = tất cả"]').fill('anhca0811');
  await sleep(600);
  note((await desk.locator('.rule').last().locator('.rule-text span').textContent()) !== '', 'Kịch bản mới: có câu mô tả');
  await desk.click('text=Xong');
  note((await desk.locator('.rule').last().textContent()).includes('@anhca0811 vào phòng'), 'Kịch bản riêng cho một user hiện đúng mô tả');
  note(before === 8, `Thêm kịch bản: danh sách có ${before} kịch bản`);

  // Hiển thị: thêm video nền đen, tạo nút một lần bấm.
  const clip = path.join(dataDir, 'rong lua.webm');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=black:s=270x480:d=3,drawbox=x=85:y=190:w=100:h=100:color=red:t=fill', '-c:v', 'libvpx', '-an', clip]);
  await desk.click('#nav >> text=Hiển thị');
  await desk.setInputFiles('input[type=file]', clip);
  await desk.waitForSelector('.media-item');
  await desk.click('.media-item >> text=Tạo nút');
  await sleep(700);
  await desk.screenshot({ path: path.join(shots, '05-hien-thi.png'), fullPage: false });
  await checkLayout(desk, 'Hiển thị');

  // Bật xoá nền đen cho nút vừa tạo rồi chạy thử.
  await desk.click('#nav >> text=Kịch bản');
  await desk.click('.rule:has-text("rong lua") >> text=Sửa');
  await desk.locator('.rule-edit select').filter({ hasText: 'Xoá nền đen' }).selectOption('black');
  await sleep(600);
  await desk.click('.rule:has-text("rong lua") >> [title="Chạy thử"]');
  await sleep(1200);
  const keyed = await frame().evaluate(() => {
    const c = document.querySelector('#media canvas');
    if (!c) return null;
    const probe = document.createElement('canvas');
    probe.width = c.width; probe.height = c.height;
    const g = probe.getContext('2d');
    g.drawImage(c, 0, 0);
    const corner = g.getImageData(5, 5, 1, 1).data;
    const mid = g.getImageData(c.width / 2, c.height / 2, 1, 1).data;
    return { cls: c.className, corner: corner[3], mid: [...mid] };
  });
  note(keyed && keyed.cls.includes('cover'), 'Video hiệu ứng phát phủ kín màn hình');
  note(keyed && keyed.corner < 20 && keyed.mid[3] > 200 && keyed.mid[0] > 150, `Xoá nền đen: nền trong suốt (alpha ${keyed?.corner}), hình giữ nguyên (alpha ${keyed?.mid?.[3]})`);
  await desk.screenshot({ path: path.join(shots, '06-video-xoa-nen.png') });
  await desk.click('#clear-all');
  await sleep(400);
  note(await frame().locator('#media > *').count() === 0, 'Dừng mọi hiệu ứng tắt cả video đang phát');

  // Điện thoại: bật, lấy địa chỉ từ mã QR.
  await desk.click('#nav >> text=Điện thoại');
  await desk.screenshot({ path: path.join(shots, '07-dien-thoai-tat.png') });
  await desk.click('.card-head .switch');
  await desk.waitForSelector('.qr svg', { timeout: 5000 }).catch(() => {});
  const hasQr = await desk.locator('.qr svg').count();
  note(hasQr === 1, 'Điện thoại: bật lên là hiện mã QR');
  await desk.screenshot({ path: path.join(shots, '08-dien-thoai-bat.png') });
  await checkLayout(desk, 'Điện thoại');
  await desk.click('#nav >> text=Nhật ký');
  await desk.screenshot({ path: path.join(shots, '09-nhat-ky.png') });
  await checkLayout(desk, 'Nhật ký');

  // ----- Điện thoại -------------------------------------------------------
  const info = await app.remote.info();
  const remoteUrl = `http://127.0.0.1:${info.port}/?k=${app.config.remote.token}`;
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const phone = await phoneCtx.newPage();
  watch(phone, 'điện thoại');
  await phone.goto(remoteUrl);
  await phone.waitForSelector('.key');
  note(!phone.url().includes('k='), 'Điện thoại: mã ghép nối được xoá khỏi thanh địa chỉ');
  note(await phone.locator('.key.mine').count() === 3, `Điện thoại: thấy ${await phone.locator('.key.mine').count()} nút riêng (2 mặc định + nút video vừa tạo)`);
  await checkLayout(phone, 'Điện thoại (390px)');
  await phone.screenshot({ path: path.join(shots, '10-phone.png') });
  await phone.tap('.key.mine >> text=Ăn mừng');
  await sleep(700);
  note((await particles()) > 20, `Bấm nút trên điện thoại: overlay có ${await particles()} hạt hiệu ứng`);
  await phone.tap('#stop');
  await sleep(400);
  note((await particles()) === 0, 'Nút dừng trên điện thoại hoạt động');

  const stranger = await phoneCtx.browser().newContext({ viewport: { width: 390, height: 844 } });
  const sp = await stranger.newPage();
  await sp.goto(`http://127.0.0.1:${info.port}/`);
  await sp.waitForSelector('.msg');
  note((await sp.locator('.msg').textContent()).includes('quét lại mã QR'), 'Thiết bị chưa quét mã không điều khiển được');
  await sp.screenshot({ path: path.join(shots, '11-phone-chua-ghep.png') });

  // Máy tính bảng: lưới nhiều cột.
  const tablet = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await tablet.goto(remoteUrl);
  await tablet.waitForSelector('.key');
  await tablet.screenshot({ path: path.join(shots, '12-tablet.png') });
  await checkLayout(tablet, 'Máy tính bảng');

  // ----- Bảng điều khiển ở cửa sổ hẹp --------------------------------------
  const narrow = await browser.newPage({ viewport: { width: 390, height: 844 } });
  watch(narrow, 'cửa sổ hẹp');
  await narrow.goto(app.url);
  await narrow.waitForSelector('.view');
  for (const v of VIEWS) {
    await narrow.click(`#nav button:nth-child(${VIEWS.indexOf(v) + 1})`);
    const r = await narrow.evaluate(layoutCheck);
    note(r.overflow <= 0, `Cửa sổ hẹp · ${v}: không tràn ngang (${r.overflow}px)`);
  }
  await narrow.screenshot({ path: path.join(shots, '13-hep.png') });

  // ----- Overlay ở kích thước phát sóng thật --------------------------------
  for (const [w, hgt, name] of [[1080, 1920, 'doc'], [1920, 1080, 'ngang']]) {
    const ov = await browser.newPage({ viewport: { width: w, height: hgt } });
    watch(ov, `overlay ${name}`);
    await ov.goto(`${app.overlayUrl}`);
    await ov.addStyleTag({ content: 'html{background:#4b5563 !important}' });
    await sleep(400);
    const cfg = app.config;
    await fetch(`http://127.0.0.1:${app.port}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cfg, widgets: { ...cfg.widgets, chat: { ...cfg.widgets.chat, enabled: true }, goal: { ...cfg.widgets.goal, enabled: true, target: 500 } } }) });
    app.ingest({ type: 'chat', nickname: 'Khán giả', text: 'Chào cả nhà nha!' });
    app.ingest({ type: 'chat', nickname: 'Minh Anh', text: 'Idol ơi nhảy bài mới đi' });
    app.ingest({ type: 'like', likeCount: 320, totalLikes: 320 });
    app.ingest({ type: 'gift', nickname: 'Fan cứng', giftName: 'Hoa hồng', count: 5, coins: 5 });
    app.ingest({ type: 'share', nickname: 'Bạn thân' });
    await sleep(1500);
    const box = await ov.locator('.alert').boundingBox();
    note(box && box.x >= 0 && box.x + box.width <= w, `Overlay ${name}: thông báo nằm trọn trong khung`);
    await ov.screenshot({ path: path.join(shots, `14-overlay-${name}.png`) });
    await ov.close();
  }
} catch (err) {
  note(false, `Kịch bản kiểm tra dừng giữa chừng: ${err.message}`);
} finally {
  await browser.close();
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\nẢnh chụp: ${shots}`);
console.log(problems.length ? `\n${problems.length} vấn đề cần sửa.` : '\nTất cả đều đạt.');
process.exit(problems.length ? 1 : 0);
