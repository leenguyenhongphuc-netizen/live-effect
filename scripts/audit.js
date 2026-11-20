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
// Micro giả phát một tệp trống 120 nhịp/phút, để kiểm tra phần bắt nhịp bằng âm thanh thật.
const kick = path.join(dataDir, 'kick-120.wav');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='0.9*sin(2*PI*55*t)*exp(-18*mod(t\,0.5))':s=48000:d=20", kick]);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${kick}`] });

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

const VIEWS = ['Bắt đầu', 'Bảng hiệu ứng', 'Kịch bản', 'Quà tặng', 'Chào khách', 'Sân khấu', 'Trò chơi', 'Nhạc và nhịp', 'Phụ đề', 'Điện thoại', 'Hiển thị', 'Nhật ký'];

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
  for (const name of ['Pháo giấy', 'Pháo hoa', 'Trái tim bay', 'Sao rơi', 'Mưa xu', 'Tuyết rơi', 'Mưa quà', 'Bóng bay quà']) {
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
  const rulesBefore = await desk.locator('.rule').count();
  await desk.click('text=Thêm kịch bản');
  await desk.waitForFunction((n) => document.querySelectorAll('.rule').length === n + 1, rulesBefore);
  const before = await desk.locator('.rule').count();
  await desk.locator('.rule-edit select').first().selectOption('join');
  await desk.locator('.rule-edit input[placeholder^="Bỏ trống = tất cả"]').fill('anhca0811');
  await sleep(600);
  note((await desk.locator('.rule').last().locator('.rule-text span').textContent()) !== '', 'Kịch bản mới: có câu mô tả');
  await desk.click('text=Xong');
  note((await desk.locator('.rule').last().textContent()).includes('@anhca0811 vào phòng'), 'Kịch bản riêng cho một user hiện đúng mô tả');
  note(before === rulesBefore + 1, `Thêm kịch bản: danh sách tăng từ ${rulesBefore} lên ${before} kịch bản`);

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

  // Quà tặng: danh mục, thử một quà, gán hiệu ứng riêng, công tắc tổng.
  app.ingest({ type: 'gift', user: 'a', nickname: 'An', giftId: '5655', giftName: 'Rose', count: 1, coins: 1 });
  app.ingest({ type: 'gift', user: 'b', nickname: 'Bình', giftId: '6369', giftName: 'Lion', count: 1, coins: 29999 });
  await desk.click('#clear-all');
  await desk.click('#nav >> text=Quà tặng');
  await desk.waitForSelector('.gift-row');
  note(await desk.locator('.gift-row').count() === 2, 'Quà tặng: quà vừa nhận tự vào danh sách');
  await desk.fill('input[type=search]', 'lio');
  note(await desk.locator('.gift-row').count() === 1, 'Quà tặng: tìm theo tên lọc đúng');
  await desk.click('.gift-row >> [title="Thử quà này"]');
  await sleep(600);
  note((await frame().locator('.alert').textContent()).includes('Lion'), 'Quà tặng: thử một quà hiện đúng tên quà đó');
  await desk.screenshot({ path: path.join(shots, '16-qua-tang.png') });
  await checkLayout(desk, 'Quà tặng');
  await desk.click('#clear-all');
  await desk.click('.card-head .switch');
  await sleep(600);
  await desk.click('.gift-row >> [title="Thử quà này"]');
  await sleep(500);
  note((await particles()) === 0 && await frame().locator('.alert').count() === 0, 'Quà tặng: tắt công tắc tổng thì quà không hiện gì');
  await desk.click('.card-head .switch');
  await sleep(600);
  await desk.click('.gift-row >> text=Hiệu ứng riêng');
  await desk.waitForSelector('.rule-edit');
  note((await desk.locator('.rule:has(.rule-edit) .rule-text span').textContent()).includes('tặng Lion'), 'Quà tặng: "Hiệu ứng riêng" tạo kịch bản cho đúng quà và mở ra sửa');

  // Nhạc và nhịp: nghe micro giả (trống 120 nhịp/phút), overlay phải phản ứng.
  await desk.click('#clear-all');
  await desk.click('#nav >> text=Nhạc và nhịp');
  await desk.evaluate(async () => { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); });
  await desk.click('#nav >> text=Nhạc và nhịp');
  await desk.click('.card-head .switch');
  await desk.waitForSelector('text=Dừng nghe', { timeout: 8000 }).catch(() => {});
  const devOpt = await desk.locator('.view select >> nth=0').locator('option').nth(1).getAttribute('value').catch(() => null);
  if (devOpt) await desk.locator('.view select >> nth=0').selectOption(devOpt);
  await sleep(6000);
  const bpmText = await desk.locator('.meter .small').textContent();
  const bpm = parseInt(bpmText, 10);
  note(bpm >= 114 && bpm <= 126, `Nhạc và nhịp: bắt đúng nhịp của tệp trống 120 nhịp/phút (đo được "${bpmText}")`);
  const rx = await frame().evaluate(() => { const r = window.__overlay.react; return { bolts: r.beats, embers: r.embers.length, bass: r.running }; });
  note(rx.bolts > 5 && rx.embers > 3 && rx.bass, `Nhạc và nhịp: overlay phản ứng (${rx.bolts} nhịp, ${rx.embers} tàn lửa)`);
  await desk.screenshot({ path: path.join(shots, '17-nhac-va-nhip.png') });
  await checkLayout(desk, 'Nhạc và nhịp');
  await desk.click('.card-head .switch');
  // Chờ tối đa 4 giây thay vì một khoảng cố định: máy chậm thì khung hình cuối đến muộn hơn.
  const musicOff = await frame().waitForFunction(() => !window.__overlay.react.running && window.__overlay.react.embers.length === 0, null, { timeout: 4000 }).then(() => true, () => false);
  note(musicOff, 'Nhạc và nhịp: tắt công tắc thì lớp hiệu ứng nhạc tắt hẳn');

  // Hũ quà: bật, thả quà, các món phải nằm yên trong lòng hũ; đủ xu thì vỡ.
  await desk.click('#clear-all');
  await desk.click('#nav >> text=Quà tặng');
  await desk.locator('.card:has-text("Hũ quà") .switch').first().click();
  await desk.waitForSelector('text=Thả thử một quà');
  await desk.locator('.card:has-text("Hũ quà") input[type=number]').fill('40');
  await sleep(700);
  for (let i = 0; i < 4; i++) { await desk.click('text=Thả thử một quà'); await sleep(250); }
  // Chờ các món nằm yên (máy chậm thì lâu hơn), tối đa 9 giây.
  await sleep(2500);
  for (let i = 0; i < 26 && await frame().evaluate(() => window.__overlay.jar.running); i++) await sleep(250);
  const jarState = await frame().evaluate(() => {
    const j = window.__overlay.jar;
    const b = j.box;
    return { n: j.bodies.length, coins: j.state.coins, running: j.running,
      inside: j.bodies.every((o) => o.x >= b.left - 1 && o.x <= b.right + 1 && o.y <= b.floor + 1 && o.y >= b.y - o.r) };
  });
  note(jarState.n === 20 && jarState.coins === 20, `Hũ quà: 4 lượt quà thành ${jarState.n} món, ${jarState.coins} xu`);
  note(jarState.inside, 'Hũ quà: mọi món nằm trong lòng hũ, không lọt ra ngoài');
  note(!jarState.running, 'Hũ quà: xếp xong thì ngừng vẽ, không tốn máy');
  await desk.screenshot({ path: path.join(shots, '21-hu-qua.png') });
  await checkLayout(desk, 'Quà tặng (có hũ)');
  for (let i = 0; i < 4; i++) { await desk.click('text=Thả thử một quà'); await sleep(150); }
  await sleep(600);
  note((await particles()) > 20, 'Hũ quà: đủ xu thì vỡ và bắn pháo giấy');
  await sleep(2400);
  note(await frame().evaluate(() => window.__overlay.jar.bodies.length === 0 && window.__overlay.jar.state.coins === 0), 'Hũ quà: sau khi vỡ thì rỗng và đếm lại từ 0');
  await desk.click('#clear-all');
  await desk.locator('.card:has-text("Hũ quà") .switch').first().click();
  await sleep(500);

  // Chào khách: bật, gán video cho khách đặc biệt, người đó vào phòng thì được chào đúng bậc.
  await desk.click('#clear-all');
  await desk.click('#nav >> text=Chào khách');
  await desk.click('.card-head .switch');
  await sleep(500);
  await desk.click('[data-tier="special"] >> text=Sửa');
  await desk.fill('[data-tier="special"] input[placeholder^="anhca0811"]', 'anhca0811');
  await desk.locator('[data-tier="special"] .check input').first().check();
  await sleep(700);
  await desk.screenshot({ path: path.join(shots, '22-chao-khach.png') });
  await checkLayout(desk, 'Chào khách');
  app.ingest({ type: 'join', user: 'nguoi_la', nickname: 'Người lạ' });
  app.ingest({ type: 'join', user: 'AnhCa0811', nickname: 'Anh Cả' });
  await sleep(900);
  note((await frame().locator('.alert').textContent()).includes('Anh Cả'), 'Chào khách: khách đặc biệt vào phòng thì hiện lời chào có tên');
  note(await frame().locator('#media > *').count() === 1, 'Chào khách: phát video vào phòng của bậc đó');
  app.ingest({ type: 'join', user: 'anhca0811', nickname: 'Anh Cả' });
  await sleep(300);
  note(app.config.greet.enabled && (await desk.evaluate(() => fetch('/api/state').then((r) => r.json()).then((s) => s.queue.waiting.length))) === 0, 'Chào khách: vào lại trong cùng buổi thì không chào lặp');
  await desk.click('#clear-all');
  await desk.click('.card-head .switch');
  await sleep(500);

  // Đồng hồ đếm giờ, top thả tim, quà to nhất.
  await desk.click('#nav >> text=Hiển thị');
  for (const name of ['Đồng hồ đếm giờ live', 'Top thả tim', 'Quà to nhất']) await desk.locator(`.card:has(h2:text-is("${name}")) .switch`).first().click();
  await sleep(700);
  await desk.click('text=Bắt đầu đếm');
  await desk.waitForSelector('text=Tạm dừng');
  app.ingest({ type: 'like', user: 'a', nickname: 'An', likeCount: 120 });
  app.ingest({ type: 'like', user: 'b', nickname: 'Bình', likeCount: 300 });
  app.ingest({ type: 'gift', user: 'b', nickname: 'Bình', giftId: '9999', giftName: 'Universe', count: 1, coins: 44999 });
  await sleep(1600);
  const xs = await frame().evaluate(() => ({
    time: document.querySelector('#xtimer .time')?.textContent, likes: [...document.querySelectorAll('#xlikes .who')].map((n) => n.textContent),
    best: document.querySelector('#xbest .who b')?.textContent, shown: ['xtimer', 'xlikes', 'xbest'].every((id) => !document.getElementById(id).hidden),
  }));
  note(xs.shown && /^1:\d\d:\d\d$/.test(xs.time), `Đồng hồ: đang đếm, quà lớn đã cộng thêm giờ (hiện ${xs.time})`);
  note(xs.likes.join(',') === 'Bình,An', `Top thả tim: xếp đúng thứ tự (${xs.likes.join(', ')})`);
  note(xs.best === 'Bình', 'Quà to nhất: hiện đúng người tặng');
  await desk.locator('.card:has(h2:text-is("Đồng hồ đếm giờ live"))').scrollIntoViewIfNeeded();
  await desk.screenshot({ path: path.join(shots, '23-dong-ho.png') });
  await checkLayout(desk, 'Hiển thị (đồng hồ, top tim, quà to)');
  await desk.click('text=Đặt lại');
  for (const name of ['Đồng hồ đếm giờ live', 'Top thả tim', 'Quà to nhất']) await desk.locator(`.card:has(h2:text-is("${name}")) .switch`).first().click();
  await sleep(500);
  await desk.click('#clear-all');

  // Sân khấu: tạo bài diễn, thêm một mốc pháo hoa ở giây 0, bấm Diễn thì mốc chạy.
  await desk.click('#clear-all');
  await desk.click('#nav >> text=Sân khấu');
  await desk.click('text=Thêm bài diễn');
  await desk.click('text=Thêm mốc');
  await desk.locator('.cue select').first().selectOption('fireworks');
  await sleep(700);
  await desk.screenshot({ path: path.join(shots, '27-san-khau.png') });
  await checkLayout(desk, 'Sân khấu');
  await desk.click('.rule-actions >> text=Diễn');
  await sleep(900);
  note((await particles()) > 20, 'Sân khấu: bấm Diễn thì mốc đầu tiên chạy đúng lúc');
  note((await desk.locator('.rule-text span').first().textContent()).includes('đang diễn'), 'Sân khấu: bảng điều khiển báo bài đang diễn');
  await desk.click('.rule-actions >> text=Dừng');
  await desk.click('#clear-all');

  // Danh sách diễn: không khí theo bài (tông màu, sương khói), đẩy cao trào, bài kế, đèn.
  {
    await desk.locator('.rule-edit .field:has-text("Tông màu") select').selectOption('#ff2d55');
    await desk.locator('.rule-edit .field:has-text("Sương khói") .switch').click();
    await desk.click('.rule-actions >> text=Xong');
    await desk.click('text=Thêm bài diễn');
    await desk.click('.rule-actions >> text=Xong');
    await desk.locator('#lights-card .switch').first().click();
    await desk.locator('#lights-card input[type=text]').fill('127.0.0.1:9');
    await sleep(700);
    await desk.click('#stage-next');
    await sleep(1300);
    const look = () => frame().evaluate(() => ({ tint: getComputedStyle(document.getElementById('tint')).opacity, fog: document.getElementById('fog').className, level: document.getElementById('fog').dataset.level }));
    const l1 = await look();
    note(Number(l1.tint) > 0.1 && l1.fog.includes('on'), `Danh sách diễn: bài 1 phủ tông màu và sương khói (độ đậm ${l1.tint})`);
    note(!(await desk.locator('#side-status').textContent()).includes('null'), 'Thanh trạng thái bên trái không hiện chữ “null”');
    note((await desk.locator('#live-status').textContent()).includes('Bài 1/2'), 'Danh sách diễn: bảng báo đang ở bài 1/2 và bài kế tiếp');
    await desk.click('#stage-boost');
    await sleep(1200);
    const l2 = await look();
    note(l2.level === 'peak' && Number(l2.tint) > Number(l1.tint) && (await desk.locator('#live-status').textContent()).includes('cao trào'), 'Đẩy cao trào: hình đậm lên và bảng báo “cao trào”');
    await desk.screenshot({ path: path.join(shots, '29-danh-sach-dien.png') });
    await checkLayout(desk, 'Sân khấu (đang diễn)');
    await desk.click('#stage-next');
    await sleep(1300);
    const l3 = await look();
    note((await desk.locator('#live-status').textContent()).includes('Bài 2/2') && Number(l3.tint) === 0 && !l3.fog.includes('on'), 'Bài kế: sang bài 2, không khí của bài 1 tắt');
    await desk.click('#light-test');
    await sleep(900);
    note(await desk.locator('#lights-card .note.err').count() === 1, 'Đèn: không gọi được đèn thì báo lỗi rõ ràng');
    await desk.click('#stage-talk');
    await sleep(500);
    note((await desk.locator('#live-status').textContent()).includes('trò chuyện'), 'Dừng: về chế độ trò chuyện');
    await desk.locator('#lights-card .switch').first().click();
    await sleep(800); // chờ bảng điều khiển lưu xong, kẻo ghi đè cấu hình của bước sau
  }

  // Vùng ánh xạ: clip đặt lên "trần" chỉ chiếm đúng vùng trần, có mép mờ; đổi góc máy thì vùng dời theo.
  {
    const cfgZ = JSON.parse(JSON.stringify(app.config));
    cfgZ.stage.cam1 = 'Cận'; cfgZ.stage.cam2 = 'Toàn';
    cfgZ.stage.zones.ceiling[2] = { x: 20, y: 10, w: 60, h: 20 };
    cfgZ.stage.shows = [{ id: 'zshow', name: 'Thử vùng', track: '', cues: [{ t: 0, media: 'rong lua.webm', mediaKey: 'black', zone: 'ceiling', hold: true }, { t: 30, effect: 'snow' }] }];
    await fetch(`http://127.0.0.1:${app.port}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfgZ) });
    const post = (body) => fetch(`http://127.0.0.1:${app.port}/api/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await post({ action: 'start', id: 'zshow' });
    await sleep(900);
    const zr = () => frame().evaluate(() => { const z = document.querySelector('#zones .zone'); if (!z) return null; const r = z.getBoundingClientRect(); return { top: r.top / innerHeight, h: r.height / innerHeight, w: r.width / innerWidth, mask: getComputedStyle(z).maskImage.includes('gradient'), canvas: Boolean(z.querySelector('canvas')), full: document.querySelectorAll('#media > *').length }; });
    const z1 = await zr();
    note(z1 && Math.abs(z1.top) < 0.01 && Math.abs(z1.h - 0.3) < 0.01 && Math.abs(z1.w - 1) < 0.01 && z1.full === 0, `Vùng ánh xạ: clip chỉ chiếm vùng trần (cao ${Math.round((z1?.h || 0) * 100)}% khung), không phủ kín màn hình`);
    note(z1 && z1.mask && z1.canvas, 'Vùng ánh xạ: mép vùng được làm mờ và nền đen của clip được xoá');
    await post({ action: 'cam', cam: 2 });
    await sleep(800);
    const z2 = await zr();
    note(z2 && Math.abs(z2.top - 0.1) < 0.01 && Math.abs(z2.w - 0.6) < 0.01, 'Vùng ánh xạ: đổi sang camera 2 thì clip dời tới vùng trần của camera 2');
    await desk.screenshot({ path: path.join(shots, '28-vung-anh-xa.png') });
    await post({ action: 'stop' });
    await sleep(800);
    note((await frame().locator('#zones .zone').count()) === 0, 'Vùng ánh xạ: dừng bài diễn thì clip trên vùng tắt');
    await post({ action: 'cam', cam: 1 });
  }

  // Trò chơi: bật, khán giả gõ số để mở hộp, chủ phòng bấm mở cho tới khi trúng bẫy.
  await desk.click('#nav >> text=Trò chơi');
  await desk.click('.card-head .switch');
  await desk.waitForSelector('.board');
  await sleep(800); // chờ cài đặt được lưu xuống máy chủ
  app.ingest({ type: 'chat', user: 'an', nickname: 'An', text: '3' });
  await sleep(500);
  const opened = await frame().evaluate(() => [...document.querySelectorAll('#game .box.open, #game .box.trap')].map((b) => b.textContent));
  note(opened.length === 1 && opened[0].includes('An'), `Trò chơi: bình luận "3" mở hộp 3 và ghi tên người mở (${opened.join('|')})`);
  await desk.screenshot({ path: path.join(shots, '24-tro-choi.png') });
  await checkLayout(desk, 'Trò chơi');
  for (let n = 1; n <= 12; n++) {
    const cell = desk.locator('.board .cell').nth(n - 1);
    if (await cell.isDisabled()) continue;
    await cell.click();
    await sleep(120);
    if (await desk.locator('.board .cell.trap').count()) break;
  }
  await sleep(400);
  note(await frame().locator('#game.over .box.trap').count() === 1, 'Trò chơi: mở trúng bẫy thì bàn chơi báo người thua');
  note((await desk.locator('.card:has(.board) .card-head h2').textContent()).includes('đã mở trúng hộp'), 'Trò chơi: bảng điều khiển báo kết quả ván');
  await desk.click('button:has-text("Ván mới")');
  await sleep(400);
  note(await frame().locator('#game .box.open, #game .box.trap').count() === 0, 'Trò chơi: ván mới thì mọi hộp đóng lại');
  // Đấu giá: bắt đầu, hai người trả giá bằng quà, chốt thì công bố người thắng.
  await desk.fill('input[placeholder^="Ví dụ: 1 bài hát"]', 'Một bài hát');
  await sleep(600);
  await desk.click('text=Bắt đầu đấu giá');
  await desk.waitForSelector('text=Chốt ngay');
  app.ingest({ type: 'gift', user: 'an', nickname: 'An', giftId: '5655', giftName: 'Rose', count: 30, coins: 30 });
  app.ingest({ type: 'gift', user: 'binh', nickname: 'Bình', giftId: '5655', giftName: 'Rose', count: 80, coins: 80 });
  await sleep(700);
  const au = await frame().evaluate(() => ({ title: document.querySelector('#xauction .xt')?.textContent, rows: [...document.querySelectorAll('#xauction .who')].map((n) => n.textContent) }));
  note(au.title === 'Đấu giá: Một bài hát' && au.rows.join(',') === 'Bình,An', `Đấu giá: bảng trên sóng xếp đúng người trả giá (${au.rows.join(', ')})`);
  await desk.screenshot({ path: path.join(shots, '26-dau-gia.png') });
  await checkLayout(desk, 'Trò chơi (đấu giá)');
  await desk.click('text=Chốt ngay');
  await sleep(600);
  note((await frame().locator('#xauction .win').textContent()).includes('Bình thắng với 80 xu'), 'Đấu giá: chốt thì công bố đúng người thắng');
  await desk.click('.card-head .switch');
  await sleep(500);
  await desk.click('#clear-all');

  // Phụ đề: bật, gửi câu mẫu, rồi đi qua trang phụ đề bằng ô "Gõ thử".
  await desk.click('#nav >> text=Phụ đề');
  await desk.click('.card-head .switch');
  await sleep(600);
  await desk.click('text=Hiện một câu mẫu');
  await sleep(400);
  note((await frame().locator('#caption .tr').first().textContent()).includes('Hi everyone'), 'Phụ đề: câu mẫu hiện bản dịch trên overlay');
  note((await frame().locator('#caption .src').textContent()).includes('Chào mọi người'), 'Phụ đề: hiện kèm câu gốc');
  await desk.screenshot({ path: path.join(shots, '18-phu-de.png') });
  await checkLayout(desk, 'Phụ đề');
  const cap = await browser.newPage({ viewport: { width: 900, height: 800 } });
  watch(cap, 'trang phụ đề');
  await cap.goto(app.url.replace('/panel/', '/caption/'));
  await cap.fill('#text', 'Hôm nay mình live tới mười giờ nha');
  await cap.click('#manual button');
  await sleep(700);
  note((await frame().locator('#caption').textContent()).includes('Hôm nay mình live'), 'Trang phụ đề: câu gõ thử lên được overlay');
  note((await cap.locator('#status').textContent()).length > 10, `Trang phụ đề: báo rõ tình trạng dịch (“${(await cap.locator('#status').textContent()).slice(0, 70)}…”)`);
  await checkLayout(cap, 'Trang phụ đề');
  await cap.screenshot({ path: path.join(shots, '19-trang-phu-de.png') });
  await cap.close();

  // Camera OBS: không có OBS thì phải báo rõ, không treo.
  await desk.click('#nav >> text=Nhạc và nhịp');
  await desk.locator('.card:has-text("Nối OBS") .switch').click();
  await desk.waitForSelector('.card:has-text("Nối OBS") .note.err', { timeout: 8000 }).catch(() => {});
  note((await desk.locator('.card:has-text("Nối OBS") .note').textContent()).includes('Chưa nối được OBS'), 'Camera: không có OBS thì báo rõ cách bật');
  await desk.locator('.card:has-text("Nối OBS")').scrollIntoViewIfNeeded();
  await desk.screenshot({ path: path.join(shots, '20-camera.png') });
  await checkLayout(desk, 'Camera chuyển động');
  await desk.locator('.card:has-text("Nối OBS") .switch').click();
  await sleep(400);

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
  const mineNames = await phone.locator('.key.mine').allTextContents();
  note(['Ăn mừng', 'Cảm ơn cả nhà', 'rong lua'].every((n) => mineNames.some((x) => x.includes(n))) && await phone.locator('#celebrate').count() === 1,
    `Điện thoại: thấy các nút riêng (${mineNames.join(' | ')}) và công tắc chúc mừng quà`);
  await checkLayout(phone, 'Điện thoại (390px)');
  await phone.screenshot({ path: path.join(shots, '10-phone.png') });
  // Nút diễn tay trên điện thoại: bắt đầu diễn, rồi về trò chuyện.
  await phone.tap('#stage .key >> text=Bắt đầu diễn');
  await phone.waitForSelector('#stage .key >> text=Trò chuyện');
  note((await phone.locator('#stage-line').textContent()).includes('Đang diễn') && await phone.locator('#stage .key').count() === 3, 'Điện thoại: bấm Bắt đầu diễn thì hiện Bài kế, Đẩy cao trào, Trò chuyện');
  await phone.screenshot({ path: path.join(shots, '30-phone-san-khau.png') });
  await phone.tap('#stage .key >> text=Trò chuyện');
  await phone.waitForSelector('#stage .key >> text=Bắt đầu diễn');
  await phone.tap('.key.mine >> text=Ăn mừng');
  await sleep(700);
  note((await particles()) > 20, `Bấm nút trên điện thoại: overlay có ${await particles()} hạt hiệu ứng`);
  note(!(await phone.locator('#app').textContent()).includes('null') && await phone.locator('section:has-text("Camera")').count() === 0, 'Điện thoại: chưa nối OBS thì không hiện hàng nút Camera');
  // Tạm dừng từ điện thoại: bấm nút hiệu ứng thì xếp hàng chứ chưa chạy; bật lại mới chạy.
  await phone.tap('#stop');
  await sleep(500);
  await phone.tap('#pause');
  await sleep(500);
  await phone.tap('.key.mine >> text=Ăn mừng');
  await sleep(600);
  note((await particles()) === 0, 'Điện thoại: đang tạm dừng thì hiệu ứng xếp hàng, chưa lên sóng');
  await phone.tap('#pause');
  await sleep(800);
  note((await particles()) > 20, 'Điện thoại: bật lại thì hiệu ứng đang chờ được phát');
  await phone.tap('#stop');
  await sleep(400);
  await phone.tap('#celebrate');
  await sleep(500);
  note(app.config.gifts.celebrate === false && (await phone.locator('#celebrate').getAttribute('aria-pressed')) === 'false', 'Điện thoại: tắt được chúc mừng quà tặng');
  await phone.tap('#celebrate');
  await sleep(500);
  note(app.config.gifts.celebrate === true, 'Điện thoại: bật lại chúc mừng quà tặng');
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

  // ----- Nhạc nền và cảnh vật: thử trên một overlay thật (không phải khung xem thử, vốn tắt tiếng) -----
  for (const [name, hz] of [['bai mot.wav', 330], ['bai hai.wav', 550]]) {
    const f = path.join(dataDir, name);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=20`, f]);
    await fetch(`http://127.0.0.1:${app.port}/api/media?name=${encodeURIComponent(name)}`, { method: 'POST', body: fs.readFileSync(f) });
  }
  const putCfg = (patch) => fetch(`http://127.0.0.1:${app.port}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...app.config, ...patch }) });
  await putCfg({
    bgm: { ...app.config.bgm, enabled: true, tracks: ['bai mot.wav', 'bai hai.wav'], volume: 0.4, duck: 'lower' },
    scenery: { enabled: true, media: 'rong lua.webm', key: 'black', opacity: 0.8 },
  });
  const live = await browser.newPage({ viewport: { width: 540, height: 960 } });
  watch(live, 'overlay thật');
  await live.goto(app.overlayUrl);
  await live.waitForFunction(() => window.__overlay && !window.__overlay.bgm.audio.paused, null, { timeout: 8000 }).catch(() => {});
  const b1 = await live.evaluate(() => { const b = window.__overlay.bgm; return { playing: !b.audio.paused, src: decodeURIComponent(b.audio.src), vol: b.audio.volume, card: document.querySelector('#xbgm b')?.textContent, scenery: document.querySelector('#scenery canvas') !== null, op: document.getElementById('scenery').style.opacity }; });
  note(b1.playing && b1.src.endsWith('bai mot.wav') && Math.abs(b1.vol - 0.4) < 0.01, `Nhạc nền: tự phát bài đầu ở đúng âm lượng (${b1.vol})`);
  note(b1.card === 'bai mot', `Nhạc nền: thẻ đang phát hiện tên bài (“${b1.card}”)`);
  note(b1.scenery && b1.op === '0.8', 'Cảnh vật: video lặp được xoá nền và đặt đúng độ rõ');
  const videoRule = app.config.rules.find((r) => r.action.media === 'rong lua.webm');
  await fetch(`http://127.0.0.1:${app.port}/api/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ruleId: videoRule.id }) });
  await sleep(900);
  const ducked = await live.evaluate(() => window.__overlay.bgm.audio.volume);
  note(Math.abs(ducked - 0.1) < 0.01, `Nhạc nền: nhỏ tiếng lại khi video hiệu ứng đang phát (${ducked})`);
  await live.waitForFunction(() => Math.abs(window.__overlay.bgm.audio.volume - 0.4) < 0.01, null, { timeout: 8000 }).catch(() => {});
  note(Math.abs((await live.evaluate(() => window.__overlay.bgm.audio.volume)) - 0.4) < 0.01, 'Nhạc nền: video xong thì âm lượng trở lại');
  app.ingest({ type: 'chat', user: 'an', nickname: 'An', text: '!nhac 2' });
  await sleep(600);
  note((await live.evaluate(() => decodeURIComponent(window.__overlay.bgm.audio.src))).endsWith('bai hai.wav'), 'Nhạc nền: khán giả gõ “!nhac 2” thì chuyển sang bài 2');
  await fetch(`http://127.0.0.1:${app.port}/api/bgm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'pause' }) });
  await sleep(400);
  note(await live.evaluate(() => window.__overlay.bgm.audio.paused), 'Nhạc nền: nút tạm dừng nhạc có tác dụng');
  await live.screenshot({ path: path.join(shots, '25-nhac-nen.png') });
  await putCfg({ bgm: { ...app.config.bgm, enabled: false }, scenery: { ...app.config.scenery, enabled: false } });
  await sleep(500);
  note(await live.evaluate(() => window.__overlay.bgm.audio.paused && document.getElementById('scenery').children.length === 0 && document.getElementById('xbgm').hidden), 'Tắt nhạc nền và cảnh vật thì cả hai dừng hẳn');
  await live.close();

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
