import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { ObsCamera, transformAround, MOVES } from '../src/obscam.js';
import { startApp } from '../src/server.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { for (let i = 0; i < ms / 10; i++) { if (fn()) return; await wait(10); } throw new Error('hết thời gian chờ'); };

/** OBS giả: nói đúng giao thức obs-websocket v5 và ghi lại mọi lệnh đổi transform. */
async function fakeObs({ items, canvas = { baseWidth: 1080, baseHeight: 1920 } } = {}) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.on('listening', r));
  const state = { transforms: [], calls: [], scene: 'Game', items, sockets: new Set() };
  wss.on('connection', (ws) => {
    state.sockets.add(ws);
    ws.send(JSON.stringify({ op: 0, d: { rpcVersion: 1 } }));
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.op === 1) { ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } })); return; }
      if (msg.op !== 6) return;
      const { requestType, requestId, requestData } = msg.d;
      const data = {
        GetCurrentProgramScene: { currentProgramSceneName: state.scene },
        GetVideoSettings: canvas,
        GetSceneItemList: { sceneItems: state.items },
        GetSceneList: { scenes: [{ sceneName: 'Kết thúc' }, { sceneName: 'Cận mặt' }, { sceneName: 'Game' }] },
        GetSceneItemId: { sceneItemId: 42 },
      }[requestType];
      if (requestType === 'SetSceneItemTransform') state.transforms.push(requestData);
      if (requestType === 'SetSceneItemEnabled') state.calls.push(['nguồn', requestData.sceneItemId, requestData.sceneItemEnabled]);
      if (requestType === 'SetCurrentProgramScene') {
        state.scene = requestData.sceneName;
        state.calls.push(['cảnh', requestData.sceneName]);
        setTimeout(() => ws.send(JSON.stringify({ op: 5, d: { eventType: 'CurrentProgramSceneChanged', eventData: { sceneName: state.scene } } })), 5);
      }
      ws.send(JSON.stringify({ op: 7, d: { requestType, requestId, requestStatus: { result: true, code: 100 }, responseData: data || {} } }));
    });
  });
  return { port: wss.address().port, state, close: () => new Promise((r) => { for (const s of state.sockets) s.terminate(); wss.close(r); }) };
}

// Camera phủ kín khung 1080x1920, căn theo góc trên trái (kiểu mặc định của OBS).
const BASE = { positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, rotation: 0, boundsType: 'OBS_BOUNDS_NONE' };
const ITEMS = [
  { sceneItemId: 1, sourceName: 'Live Effect', inputKind: 'browser_source', sceneItemTransform: BASE },
  { sceneItemId: 2, sourceName: 'Nền', inputKind: 'image_source', sceneItemTransform: BASE },
  { sceneItemId: 7, sourceName: 'Webcam', inputKind: 'dshow_input', sceneItemTransform: BASE },
];

test('phép biến đổi quanh tâm khung: zoom giữ nguyên tâm, xoay nửa vòng lật góc', () => {
  const canvas = { width: 1080, height: 1920 };
  const z = transformAround(BASE, canvas, { k: 1.5 });
  // Tâm của nguồn sau khi phóng to vẫn nằm đúng tâm khung hình.
  assert.equal(z.positionX + (1080 * z.scaleX) / 2, 540);
  assert.equal(z.positionY + (1920 * z.scaleY) / 2, 960);
  const r = transformAround(BASE, canvas, { deg: 180 });
  assert.ok(Math.abs(r.positionX - 1080) < 1e-6 && Math.abs(r.positionY - 1920) < 1e-6);
  assert.deepEqual(transformAround(BASE, canvas, {}), { positionX: 0, positionY: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  // Nguồn đặt theo khung bao: đổi kích thước khung bao thay vì tỉ lệ.
  const b = transformAround({ ...BASE, boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 1080, boundsHeight: 1920 }, canvas, { k: 2 });
  assert.equal(b.boundsWidth, 2160);
  assert.equal(b.scaleX, undefined);
  // Mọi kiểu chuyển động bắt đầu và kết thúc ở (gần) trạng thái gốc, không bao giờ thu nhỏ dưới khung.
  for (const [name, fn] of Object.entries(MOVES)) {
    for (let p = 0; p <= 1; p += 0.05) assert.ok(fn(p, 2, 1.5, 1).k >= 1, `${name} thu nhỏ dưới khung tại ${p}`);
  }
  assert.ok(Math.abs(MOVES.zoomin(1, 2, 1).k - 1) < 1e-9);
  assert.ok(Math.abs(MOVES.zoomout(1, 2, 1).k - 1) < 1e-9);
});

test('camera OBS: tự tìm webcam, zoom rồi trả về chỗ cũ, tắt thì khôi phục', async () => {
  const obs = await fakeObs({ items: ITEMS });
  const cfg = { camera: { enabled: true, source: '', beat: 'zoom', amount: 2 } };
  const statuses = [];
  const cam = new ObsCamera({ getConfig: () => cfg, port: obs.port, readConfig: () => null, onStatus: (s) => statuses.push(s.state) });
  try {
    await cam.sync();
    await until(() => cam.status.state === 'ready');
    assert.equal(cam.status.source, 'Webcam');
    assert.deepEqual(cam.status.sources, ['Nền', 'Webcam']); // không tự chọn chính overlay

    assert.equal(cam.move('zoomin', { duration: 0.5 }), true);
    await wait(750);
    const t = obs.state.transforms;
    assert.ok(t.length > 8, `mới gửi ${t.length} khung`);
    assert.ok(t.every((x) => x.sceneItemId === 7 && x.sceneName === 'Game'));
    const peak = Math.max(...t.map((x) => x.sceneItemTransform.scaleX));
    assert.ok(peak > 1.25 && peak <= 1.36, `đỉnh zoom ${peak}`);
    assert.deepEqual(t.at(-1).sceneItemTransform, { positionX: 0, positionY: 0, rotation: 0, scaleX: 1, scaleY: 1 });

    // Nhịp nhạc: cú giật nhỏ; nhưng không chen ngang chuyển động do nút bấm.
    obs.state.transforms.length = 0;
    assert.equal(cam.beat(1), true);
    await wait(300);
    const beatPeak = Math.max(...obs.state.transforms.map((x) => x.sceneItemTransform.scaleX));
    assert.ok(beatPeak > 1.02 && beatPeak < 1.07, `đỉnh giật ${beatPeak}`);
    cam.move('spin', { duration: 1 });
    assert.equal(cam.beat(1), false);

    // Tắt giữa chừng: camera về đúng trạng thái gốc.
    cfg.camera.enabled = false;
    await cam.sync();
    await wait(100);
    assert.deepEqual(obs.state.transforms.at(-1).sceneItemTransform, { positionX: 0, positionY: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    assert.equal(cam.status.state, 'off');
    assert.equal(cam.move('zoomin'), false);
  } finally { await cam.close(); await obs.close(); }
});

test('camera OBS: không đoán bừa khi cảnh không có webcam; OBS tắt thì báo rõ', async () => {
  const obs = await fakeObs({ items: ITEMS.slice(0, 2) });
  const cfg = { camera: { enabled: true, source: '', beat: 'off', amount: 2 } };
  const cam = new ObsCamera({ getConfig: () => cfg, port: obs.port, readConfig: () => null });
  try {
    await cam.sync();
    await until(() => cam.status.state === 'error');
    assert.match(cam.status.error, /chọn nguồn camera/);
    assert.equal(cam.move('zoomin'), false);
    // Người dùng chọn tay một nguồn: dùng được ngay.
    cfg.camera.source = 'Nền';
    await cam.sync();
    await until(() => cam.status.state === 'ready');
    assert.equal(cam.status.source, 'Nền');
    assert.equal(cam.beat(1), false); // chế độ theo nhịp đang tắt
  } finally { await cam.close(); await obs.close(); }

  const dead = new ObsCamera({ getConfig: () => cfg, port: 1, readConfig: () => null });
  await dead.sync();
  await until(() => dead.status.state === 'error');
  assert.match(dead.status.error, /Chưa nối được OBS/);
  await dead.close();
});

test('kịch bản kèm chuyển động camera, và phụ đề chỉ lên sóng khi bật', async () => {
  const obs = await fakeObs({ items: ITEMS });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'le-cam-'));
  const app = await startApp({ dataDir, port: 0, obsPort: obs.port });
  const base = `http://127.0.0.1:${app.port}`;
  const call = async (method, url, body) => (await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
  try {
    const { config } = await call('GET', '/api/state');
    config.camera.enabled = true;
    config.rules.find((r) => r.id === 'r-btn-party').action.camera = 'shake';
    await call('PUT', '/api/config', config);
    await until(() => app.config && obs.state.sockets.size > 0);
    for (let i = 0; i < 200; i++) { if ((await call('GET', '/api/state')).status.camera.state === 'ready') break; await wait(10); }
    await call('POST', '/api/test', { ruleId: 'r-btn-party' });
    await wait(200);
    assert.ok(obs.state.transforms.length > 2, 'kịch bản phải gửi chuyển động sang OBS');
    assert.ok(obs.state.transforms.some((x) => x.sceneItemTransform.scaleX === 1.05));

    // Điện thoại: thấy được camera đã sẵn sàng và bấm zoom được; tên chuyển động lạ bị từ chối.
    const cfgR = (await call('GET', '/api/state')).config;
    cfgR.remote.enabled = true;
    const on = await call('PUT', '/api/config', cfgR);
    const r = async (method, url, body) => (await fetch(`http://127.0.0.1:${on.remote.port}${url}`, { method, headers: { 'Content-Type': 'application/json', 'X-Key': on.config.remote.token }, body: body ? JSON.stringify(body) : undefined })).json();
    assert.equal((await r('GET', '/r/state')).camera, true);
    await wait(1600); // chờ cú rung của kịch bản ở trên chạy xong
    obs.state.transforms.length = 0;
    assert.deepEqual(await r('POST', '/r/fire', { camera: 'zoomin' }), { ok: true });
    await wait(250);
    assert.ok(obs.state.transforms.some((x) => x.sceneItemTransform.scaleX > 1.2), 'điện thoại phải zoom được camera');
    assert.deepEqual(await r('POST', '/r/fire', { camera: 'constructor' }), { ok: false });

    // Phụ đề: tắt thì không lên overlay; bật thì lên, tối đa 2 bản dịch, cắt bớt chữ quá dài.
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws?role=overlay`);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d)));
    await new Promise((r) => ws.on('open', r));
    assert.equal((await call('POST', '/api/caption', { text: 'xin chào', final: true })).enabled, false);
    const cfg2 = (await call('GET', '/api/state')).config;
    cfg2.captions.enabled = true;
    await call('PUT', '/api/config', cfg2);
    const out = await call('POST', '/api/caption', { text: '  Xin chào  ', final: true, lines: [{ lang: 'en', text: 'Hello' }, { lang: 'zh<x>', text: '你好' }, { lang: 'ko', text: '안녕' }, { text: '' }] });
    assert.equal(out.enabled, true);
    await until(() => msgs.some((m) => m.type === 'caption'));
    assert.deepEqual(msgs.filter((m) => m.type === 'caption'), [{ type: 'caption', text: 'Xin chào', final: true, lines: [{ lang: 'en', text: 'Hello' }, { lang: 'zhx', text: '你好' }] }]);
    assert.equal(msgs.find((m) => m.type === 'widgets' && m.captions?.enabled).captions.position, 'bottom');
    ws.close();
  } finally { await app.close(); await obs.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('hũ quà: quà rơi vào hũ, đủ xu thì đầy, vỡ và chạy kịch bản "Hũ quà đầy"', async () => {
  const { Jar } = await import('../src/jar.js');
  const cfg = { jar: { enabled: true, target: 100, title: 'Hũ quà' } };
  const jar = new Jar(() => cfg);
  assert.deepEqual(jar.add({ coins: 30, count: 30, image: 'javascript:x' }), { drop: { image: '', each: 1, n: 10 }, full: false });
  assert.equal(jar.add({ coins: 0 }), null);
  assert.equal(jar.state().coins, 30);
  const last = jar.add({ coins: 500, count: 1, image: 'https://cdn/lion.png' });
  assert.equal(last.full, true);
  assert.deepEqual(last.drop, { image: 'https://cdn/lion.png', each: 500, n: 1 });
  assert.deepEqual([jar.coins, jar.drops.length, jar.rounds], [0, 0, 1]);
  // Số món hiển thị có trần, để hũ không phình mãi.
  cfg.jar.target = 1e6;
  for (let i = 0; i < 40; i++) jar.add({ coins: 10, count: 10 });
  assert.ok(jar.drops.reduce((s, d) => s + d.n, 0) <= 130);
  cfg.jar.enabled = false;
  assert.equal(jar.add({ coins: 10 }), null);

  // Qua máy chủ: overlay nhận món rơi, lúc đầy nhận lệnh vỡ, và kịch bản "Hũ quà đầy" chạy.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'le-jar-'));
  const app = await startApp({ dataDir, port: 0 });
  const call = async (method, url, body) => (await fetch(`http://127.0.0.1:${app.port}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
  try {
    const { config } = await call('GET', '/api/state');
    config.jar = { ...config.jar, enabled: true, target: 20 };
    config.gifts.celebrate = false; // tắt chúc mừng: quà vẫn phải rơi vào hũ
    config.rules.push({ id: 'jarfull', name: 'Hũ đầy', trigger: { type: 'jar' }, action: { effect: 'stars', text: 'Hũ đã đầy, cảm ơn {user}!' } });
    await call('PUT', '/api/config', config);
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws?role=overlay`);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d)));
    await new Promise((r) => ws.on('open', r));
    await until(() => msgs.some((m) => m.type === 'jar'));
    assert.equal(msgs.find((m) => m.type === 'widgets').jar.target, 20);
    app.ingest({ type: 'gift', nickname: 'An', giftName: 'Rose', count: 5, coins: 5, giftImage: 'https://cdn/rose.png' });
    app.ingest({ type: 'gift', nickname: 'Bình', giftName: 'Hat', count: 1, coins: 99 });
    await until(() => msgs.some((m) => m.type === 'jarburst'));
    const drops = msgs.filter((m) => m.type === 'jardrop');
    assert.deepEqual(drops.map((m) => [m.drop.n, m.drop.each, m.coins]), [[5, 1, 5], [1, 99, 20]]);
    const fx = msgs.filter((m) => m.type === 'fx');
    assert.deepEqual(fx.map((m) => [m.effect, m.alert]), [['stars', 'Hũ đã đầy, cảm ơn Bình!']]);
    // Overlay mở sau khi hũ vỡ thấy hũ rỗng; đổ hũ thì về 0.
    app.ingest({ type: 'gift', nickname: 'An', giftName: 'Rose', count: 3, coins: 3 });
    const late = new WebSocket(`ws://127.0.0.1:${app.port}/ws?role=overlay`);
    const got = await new Promise((r) => late.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'jar') r(m); }));
    assert.deepEqual([got.coins, got.rounds, got.drops.length], [3, 1, 1]);
    await call('POST', '/api/jar/reset');
    await until(() => msgs.filter((m) => m.type === 'jar').at(-1)?.rounds === 0);
    ws.close(); late.close();
  } finally { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('hàng đợi: video phát lần lượt theo ưu tiên, hiệu ứng nhẹ chạy ngay, tạm dừng thì giữ lại', async () => {
  const { EffectQueue } = await import('../src/queue.js');
  const sent = [];
  const q = new EffectQueue({ dispatch: (m) => sent.push(m), videoTimeoutMs: 60 });
  const names = () => sent.map((m) => m.label);
  q.push({ label: 'pháo', effect: 'confetti' });
  q.push({ label: 'quà nhỏ', media: 'a.webm', priority: 4 });
  q.push({ label: 'quà lớn', media: 'b.webm', priority: 2 });
  q.push({ label: 'tim', effect: 'hearts' });
  q.push({ label: 'khách VIP', media: 'c.webm', priority: 1 });
  q.push({ label: 'quà lớn 2', media: 'd.webm', priority: 2 });
  // Hiệu ứng nhẹ không chờ; video đầu tiên phát ngay vì lúc đó hàng đang trống.
  assert.deepEqual(names(), ['pháo', 'quà nhỏ', 'tim']);
  assert.deepEqual(q.state().waiting.map((w) => w.label), ['khách VIP', 'quà lớn', 'quà lớn 2']);
  assert.equal(q.done('sai-ma'), false);
  q.done(sent[1].id);
  q.done(sent.at(-1).id);
  assert.deepEqual(names().slice(3), ['khách VIP', 'quà lớn']);

  // Tạm dừng: mọi thứ mới đến đều chờ, cái đang phát vẫn phát nốt.
  q.setPaused(true);
  q.push({ label: 'tim 2', effect: 'hearts' });
  q.done(sent.at(-1).id);
  assert.deepEqual(names().length, 5);
  assert.deepEqual(q.state().waiting.map((w) => w.label), ['quà lớn 2', 'tim 2']);
  q.setPaused(false);
  assert.deepEqual(names().slice(5), ['tim 2', 'quà lớn 2']);
  // Overlay không báo xong (ví dụ OBS đang tắt): hết thời gian chờ thì tự sang món kế.
  q.push({ label: 'cuối', media: 'e.webm' });
  await wait(120);
  assert.equal(names().at(-1), 'cuối');
  q.clear();
  assert.deepEqual(q.state(), { paused: false, current: null, waiting: [] });
});

test('sổ fan và chào khách theo bậc', async () => {
  const { FanBook } = await import('../src/fans.js');
  const { Greeter } = await import('../src/greet.js');
  const { defaultConfig, sanitizeConfig } = await import('../src/defaults.js');
  const { normalizeUser } = await import('../src/tiktok.js');
  const file = path.join(os.tmpdir(), `fans-${process.pid}-${Date.now()}.json`);
  let now = Date.UTC(2026, 0, 1, 12);
  const DAY = 86400000;
  const fans = new FanBook(file, () => now);

  // Mỗi ngày chỉ tính một lần ghé; vắng lâu thì biết số ngày vắng.
  assert.deepEqual(fans.seen('@An', 'An'), { visits: 1, daysAway: 0, firstTime: true });
  assert.deepEqual(fans.seen('an', 'An'), { visits: 1, daysAway: 0, firstTime: false });
  now += DAY;
  assert.equal(fans.seen('AN', 'An').visits, 2);
  fans.addCoins('binh', 'Bình', 500);
  fans.addCoins('an', 'An', 100);
  fans.addCoins('cuong', 'Cường', 50);
  assert.deepEqual([fans.rank('binh'), fans.rank('@An'), fans.rank('cuong'), fans.rank('la')], [1, 2, 3, 0]);
  fans.save();
  assert.equal(new FanBook(file).rank('an'), 2);

  const cfg = sanitizeConfig({ ...defaultConfig(), greet: { enabled: true, once: true, tiers: {
    special: { enabled: true, users: '@VipA, vipb', videos: ['a.webm', 'b.webm', '../x.mp3', 'c.webm'], key: 'black', text: 'Chào {user} ({tier})' },
    level: { enabled: true, min: 38 }, back: { enabled: true, min: 30 }, regular: { enabled: true, min: 3 },
  } } });
  assert.deepEqual(cfg.greet.tiers.special.videos, ['a.webm', 'b.webm', 'c.webm']); // tệp âm thanh và đường dẫn lạ bị loại
  const sent = [];
  const g = new Greeter({ getConfig: () => cfg, fans, fire: (m) => sent.push(m) });

  // Mỗi người vào một bậc, bậc đứng trước được ưu tiên: vipa vừa là khách đặc biệt vừa cấp cao.
  assert.equal(g.handleJoin({ user: 'VipA', nickname: 'Vip A', level: 50 }), 'Khách đặc biệt');
  assert.equal(sent[0].alert, 'Chào Vip A (Khách đặc biệt)');
  assert.deepEqual([sent[0].priority, sent[0].mediaKey, sent[0].mediaFit], [1, 'black', 'cover']);
  assert.equal(g.handleJoin({ user: 'vipa', nickname: 'Vip A' }), null); // một lần mỗi buổi
  assert.equal(g.handleJoin({ user: 'binh', nickname: 'Bình' }), 'Top 1 tặng quà');
  assert.equal(g.handleJoin({ user: 'an', nickname: 'An' }), 'Top 2–3 tặng quà');
  assert.equal(g.handleJoin({ user: 'daigia', nickname: 'Đại gia', level: 40 }), 'Đại gia TikTok');
  assert.equal(g.handleJoin({ user: 'thuong', nickname: 'Thường', level: 5 }), null);
  // Khách quen: ghé đủ số ngày. Lâu rồi mới gặp: vắng đủ số ngày.
  for (let i = 0; i < 3; i++) { now += DAY; fans.seen('quen', 'Quen'); }
  g.resetSession();
  assert.equal(g.handleJoin({ user: 'quen', nickname: 'Quen' }), 'Khách quen');
  now += 40 * DAY;
  g.resetSession();
  assert.equal(g.handleJoin({ user: 'thuong', nickname: 'Thường' }), 'Lâu rồi mới gặp');
  // Nhiều video: không phát lặp cùng một video hai lần liền.
  const tier = { id: 'special', name: 'Khách đặc biệt' };
  const picks = [];
  for (let i = 0; i < 30; i++) { g.greet(tier, { user: 'x' }); picks.push(sent.at(-1).media); }
  assert.ok(picks.every((v, i) => i === 0 || v !== picks[i - 1]));
  assert.equal(new Set(picks).size, 3);
  cfg.greet.enabled = false;
  assert.equal(g.handleJoin({ user: 'vipb' }), null);
  // Cấp người xem và cấp đội fan được đọc từ dữ liệu TikTok.
  assert.deepEqual([normalizeUser({ uniqueId: 'a', payGrade: { level: 42 }, fansClub: { data: { level: 17 } } })].map((u) => [u.level, u.fanLevel]), [[42, 17]]);
});

test('đồng hồ đếm giờ: quà cộng giờ, tạm dừng, hết giờ thì báo; top thả tim và quà to nhất', async () => {
  const { LiveExtras } = await import('../src/extras.js');
  let now = 1_000_000;
  const cfg = { extras: { timer: { enabled: true, title: 'Giờ live', minutes: 2, perCoin: 2 }, topLikes: { title: 'Top tim', max: 2 }, bestGift: { title: 'Quà to' } } };
  const out = [];
  let up = 0;
  const x = new LiveExtras({ getConfig: () => cfg, emit: (m) => out.push(m), onTimeUp: () => { up += 1; }, now: () => now });
  try {
    assert.equal(x.remaining(), 120);
    x.onEvent({ type: 'gift', coins: 10 }); // chưa chạy thì quà không cộng giờ
    assert.equal(x.remaining(), 120);
    x.start();
    now += 20_000;
    assert.equal(x.remaining(), 100);
    x.onEvent({ type: 'gift', nickname: 'An', giftName: 'Rose', coins: 10, count: 10 });
    assert.equal(x.remaining(), 120); // 10 xu × 2 giây
    assert.equal(out.at(-1).added, 20);
    x.onEvent({ type: 'gift', coins: 1e6 }); // một lượt quà cộng tối đa 1 giờ
    assert.equal(x.remaining(), 3720);
    x.pause();
    now += 500_000;
    assert.equal(x.remaining(), 3720); // dừng thì không trôi
    x.add(-3700);
    assert.equal(x.remaining(), 20);
    x.reset();
    assert.deepEqual([x.remaining(), x.timerState().running], [120, false]);

    // Quà to nhất: chỉ thay khi có quà giá trị hơn.
    assert.equal(x.bestState().best.coins, 1e6);
    x.resetSession();
    x.onEvent({ type: 'gift', nickname: 'An', giftName: 'Rose', coins: 5, count: 5 });
    x.onEvent({ type: 'gift', nickname: 'Bình', giftName: 'Lion', coins: 29999, giftImage: 'https://cdn/l.png' });
    x.onEvent({ type: 'gift', nickname: 'Cường', giftName: 'Hat', coins: 99 });
    assert.deepEqual(x.bestState().best, { name: 'Bình', gift: 'Lion', count: 1, coins: 29999, image: 'https://cdn/l.png' });
    // Top thả tim: cộng dồn theo người, cắt theo số dòng đã đặt.
    x.onEvent({ type: 'like', user: 'a', nickname: 'A', likeCount: 30 });
    x.onEvent({ type: 'like', user: 'b', nickname: 'B', likeCount: 50 });
    x.onEvent({ type: 'like', user: 'a', nickname: 'A', likeCount: 40 });
    x.onEvent({ type: 'like', user: 'c', nickname: 'C', likeCount: 5 });
    assert.deepEqual(x.likesState().rows.map((r) => [r.name, r.coins]), [['A', 70], ['B', 50]]);
  } finally { x.close(); }

  // Hết giờ thật (đồng hồ thật, 1 giây): báo đúng một lần và dừng ở 0.
  const cfg2 = { extras: { timer: { enabled: true, title: '', minutes: 1 / 60, perCoin: 0 }, topLikes: { max: 3 }, bestGift: {} } };
  const y = new LiveExtras({ getConfig: () => cfg2, emit: () => {}, onTimeUp: () => { up += 1; } });
  y.start();
  await wait(1250);
  assert.deepEqual([up, y.remaining(), y.timerState().running], [1, 0, false]);
  y.close();
});

test('OBS: đổi cảnh rồi tự quay về, hiện nguồn một lúc rồi ẩn', async () => {
  const obs = await fakeObs({ items: ITEMS });
  const cfg = { camera: { enabled: true, source: '', beat: 'off', amount: 2 } };
  const cam = new ObsCamera({ getConfig: () => cfg, port: obs.port, readConfig: () => null });
  try {
    await cam.sync();
    await until(() => cam.status.state === 'ready');
    assert.deepEqual(cam.status.scenes, ['Game', 'Cận mặt', 'Kết thúc']);
    assert.equal(cam.status.scene, 'Game');
    assert.equal(await cam.scene('Không có'), false); // tên cảnh lạ: không gửi gì sang OBS
    assert.equal(await cam.scene('Cận mặt', 0.25), true);
    await until(() => cam.status.scene === 'Cận mặt');
    // Đổi tiếp sang cảnh khác trong lúc đang tạm đổi: vẫn quay về cảnh gốc ban đầu.
    assert.equal(await cam.scene('Kết thúc', 0.25), true);
    await wait(450);
    assert.deepEqual(obs.state.calls.filter((c) => c[0] === 'cảnh').map((c) => c[1]), ['Cận mặt', 'Kết thúc', 'Game']);
    await until(() => cam.status.scene === 'Game' && cam.status.state === 'ready');

    obs.state.calls.length = 0;
    assert.equal(await cam.source('Khung quà', 'flash', 0.5), true);
    await wait(700);
    assert.deepEqual(obs.state.calls, [['nguồn', 42, true], ['nguồn', 42, false]]);
    assert.equal(await cam.source('Khung quà', 'hide'), true);
    assert.deepEqual(obs.state.calls.at(-1), ['nguồn', 42, false]);
  } finally { await cam.close(); await obs.close(); }
  assert.equal(await cam.scene('Game'), false); // đã ngắt thì không làm gì
});

test('trò chơi Hộp bí ẩn: gõ số để mở, trúng bẫy thì thua, không lộ bẫy khi đang chơi', async () => {
  const { BoxGame } = await import('../src/game.js');
  const cfg = { game: { enabled: true, title: 'Hộp bí ẩn', boxes: 6, restart: 60 } };
  const out = [];
  const lost = [];
  let now = 10_000;
  let trapAt = 3; // hộp bẫy là số 4
  const g = new BoxGame({ getConfig: () => cfg, emit: (m) => out.push(m), onLose: (e) => lost.push(e), random: () => trapAt, now: () => now });
  try {
    assert.equal(g.state().trap, 0); // chưa ai thua thì không gửi vị trí bẫy ra ngoài
    assert.equal(g.handleChat({ user: 'a', nickname: 'An', text: 'chào cả nhà' }), null);
    assert.equal(g.handleChat({ user: 'a', nickname: 'An', text: ' 2 ' }), 'safe');
    assert.equal(g.handleChat({ user: 'a', nickname: 'An', text: '5' }), null); // cùng người, mở quá nhanh
    now += 3000;
    assert.equal(g.handleChat({ user: 'a', nickname: 'An', text: 'mở 5' }), 'safe');
    assert.equal(g.handleChat({ user: 'b', nickname: 'Bình', text: '2' }), null); // hộp đã mở
    assert.equal(g.handleChat({ user: 'b', nickname: 'Bình', text: '9' }), null); // ngoài phạm vi
    assert.equal(g.handleChat({ user: 'b', nickname: 'Bình', text: 'tôi chọn 4 nhé' }), null); // phải là một con số đứng riêng
    assert.equal(g.handleChat({ user: 'b', nickname: 'Bình', text: '#4' }), 'trap');
    assert.deepEqual(lost, [{ type: 'game', user: 'b', nickname: 'Bình', avatar: '', text: '4' }]);
    assert.deepEqual([g.state().trap, g.state().loser.name, g.state().opened.length], [4, 'Bình', 3]);
    assert.equal(g.pick(1, { user: 'c' }), null); // ván đã kết thúc
    // Ván mới: bẫy đổi chỗ, hộp đóng lại. Chủ phòng bấm thì không bị chặn nhịp.
    trapAt = 0;
    g.reset();
    assert.deepEqual([g.state().round, g.state().opened.length, g.state().loser], [2, 0, null]);
    assert.equal(g.pick(2, { nickname: 'Chủ phòng', host: true }), 'safe');
    assert.equal(g.pick(3, { nickname: 'Chủ phòng', host: true }), 'safe');
    cfg.game.enabled = false;
    assert.equal(g.handleChat({ user: 'd', text: '1' }), null);
    // Thống kê nhanh: bẫy rải đều, không dồn vào một hộp.
    const real = new BoxGame({ getConfig: () => ({ game: { enabled: true, boxes: 6, restart: 60 } }), emit: () => {}, onLose: () => {} });
    const seen = new Set();
    for (let i = 0; i < 200; i++) { seen.add(real.trap); real.reset(); }
    assert.equal(seen.size, 6);
    real.close();
  } finally { g.close(); }
});

test('webhook gửi ra ngoài: đúng sự kiện, đúng dữ liệu, không gửi sự kiện giả lập', async () => {
  const { Webhook, validHookUrl } = await import('../src/webhook.js');
  assert.deepEqual(['https://a.b/x', 'http://127.0.0.1:5678/hook', 'ftp://a.b', 'javascript:alert(1)', 'abc', ''].map(validHookUrl), [true, true, false, false, false, false]);
  const cfg = { webhook: { enabled: true, url: 'https://hook.example/in', events: ['gift', 'follow'] } };
  const calls = [];
  let fail = false;
  const fetchImpl = async (url, opts) => { calls.push([url, opts.method, JSON.parse(opts.body), opts.redirect]); if (fail) throw new Error('mạng'); return { ok: true, status: 200 }; };
  const hook = new Webhook({ getConfig: () => cfg, fetchImpl });
  assert.equal(hook.send({ type: 'gift', user: 'an', nickname: 'An', giftName: 'Rose', count: 3, coins: 3, avatar: 'https://cdn/a.jpg', fired: ['r-gift'], at: 1_700_000_000_000 }), true);
  assert.equal(hook.send({ type: 'chat', text: 'chào' }), false); // loại sự kiện chưa chọn
  assert.equal(hook.send({ type: 'gift', coins: 5, simulated: true }), false);
  await wait(20);
  assert.deepEqual(calls, [['https://hook.example/in', 'POST', { source: 'live-effect', at: '2023-11-14T22:13:20.000Z', event: { type: 'gift', user: 'an', nickname: 'An', giftName: 'Rose', count: 3, coins: 3 } }, 'error']]);
  assert.deepEqual(hook.status, { sent: 1, failed: 0, lastError: '' });
  fail = true;
  hook.send({ type: 'follow', user: 'b' });
  await wait(20);
  assert.equal(hook.status.failed, 1);
  assert.match(hook.status.lastError, /Không gửi được/);
  cfg.webhook.url = 'javascript:alert(1)';
  assert.equal(hook.send({ type: 'follow', user: 'c' }), false);
  cfg.webhook = { enabled: false, url: 'https://hook.example/in', events: ['follow'] };
  assert.equal(hook.send({ type: 'follow', user: 'c' }), false);
});

test('đấu giá: tổng xu là giá trả, quà giây cuối kéo dài giờ, hết giờ công bố người thắng', async () => {
  const { Auction } = await import('../src/auction.js');
  let now = 5_000_000;
  const cfg = { auction: { item: 'Một bài hát', seconds: 60, extend: true } };
  const wins = [];
  const out = [];
  const a = new Auction({ getConfig: () => cfg, emit: (m) => out.push(m), onWin: (e) => wins.push(e), now: () => now });
  try {
    a.onGift({ user: 'x', coins: 100 }); // chưa bắt đầu thì không tính
    a.start({});
    assert.deepEqual([a.state().item, a.remaining(), a.state().rows.length], ['Một bài hát', 60, 0]);
    a.onGift({ user: 'an', nickname: 'An', coins: 50 });
    now += 1000;
    a.onGift({ user: 'binh', nickname: 'Bình', coins: 80 });
    now += 1000;
    a.onGift({ user: 'an', nickname: 'An', coins: 30 }); // An lên 80, bằng Bình nhưng đạt sau
    assert.deepEqual(a.rows().map((r) => [r.name, r.coins]), [['Bình', 80], ['An', 80]]);
    // Còn 5 giây mà có quà: kéo dài lên 10 giây.
    now += 53_000;
    assert.equal(a.remaining(), 5);
    a.onGift({ user: 'an', nickname: 'An', coins: 1 });
    assert.equal(a.remaining(), 10);
    cfg.auction.extend = false;
    now += 8000;
    a.onGift({ user: 'binh', nickname: 'Bình', coins: 5 });
    assert.equal(a.remaining(), 2); // tắt kéo dài thì giữ nguyên giờ
    a.finish();
    assert.deepEqual(wins, [{ type: 'auction', nickname: 'Bình', avatar: '', coins: 85, giftName: 'Một bài hát' }]);
    assert.deepEqual([a.state().running, a.state().winner.name], [false, 'Bình']);
    a.onGift({ user: 'an', coins: 999 }); // sau khi chốt thì không tính nữa
    assert.equal(a.state().winner.coins, 85);
    // Không ai trả giá: kết thúc mà không có người thắng.
    a.start({ item: 'Món khác', seconds: 5 });
    assert.equal(a.remaining(), 10); // thời gian tối thiểu 10 giây
    a.finish();
    assert.equal(wins.length, 1);
    assert.equal(a.state().winner.name, '');
    a.start({});
    a.cancel();
    assert.deepEqual([a.state().running, a.state().winner, a.state().bidders], [false, null, 0]);
  } finally { a.close(); }
});

test('dịch bình luận: gửi sang trang phụ đề, nhận bản dịch về nhật ký và giọng đọc; không có trang thì đọc câu gốc', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'le-tr-'));
  const app = await startApp({ dataDir, port: 0 });
  const base = `http://127.0.0.1:${app.port}`;
  const call = async (method, url, body) => (await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
  const { default: WebSocket } = await import('ws');
  const open = async (role) => { const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws?role=${role}`); const msgs = []; ws.on('message', (d) => msgs.push(JSON.parse(d))); await new Promise((r) => ws.on('open', r)); return { ws, msgs }; };
  try {
    const { config } = await call('GET', '/api/state');
    config.captions.translateChat = true;
    config.tts = { ...config.tts, enabled: true, chat: true };
    await call('PUT', '/api/config', config);
    const panel = await open('panel');
    // Chưa mở trang phụ đề: đọc ngay câu gốc, không chờ.
    app.ingest({ type: 'chat', user: 'tom', nickname: 'Tom', text: 'hello everyone' });
    await until(() => panel.msgs.some((m) => m.type === 'tts'));
    assert.equal(panel.msgs.find((m) => m.type === 'tts').text, 'Tom nói hello everyone');

    const cap = await open('caption');
    assert.equal((await call('GET', '/api/state')).status.overlays, 0); // trang phụ đề không bị tính là overlay
    panel.msgs.length = 0;
    app.ingest({ type: 'chat', user: 'tom', nickname: 'Tom', text: 'you sing so well' });
    await until(() => cap.msgs.some((m) => m.type === 'chat'));
    const asked = cap.msgs.find((m) => m.type === 'chat');
    assert.equal(asked.text, 'you sing so well');
    assert.equal(panel.msgs.filter((m) => m.type === 'tts').length, 0); // đang chờ bản dịch
    assert.deepEqual(await call('POST', '/api/caption/chat', { id: asked.id, text: '  bạn hát hay quá  ' }), { ok: true });
    await until(() => panel.msgs.some((m) => m.type === 'tts'));
    assert.deepEqual(panel.msgs.find((m) => m.type === 'chatTranslated'), { type: 'chatTranslated', id: asked.id, text: 'bạn hát hay quá' });
    assert.equal(panel.msgs.find((m) => m.type === 'tts').text, 'Tom nói bạn hát hay quá');
    assert.deepEqual(await call('POST', '/api/caption/chat', { id: asked.id, text: 'gửi lần hai' }), { ok: false }); // mỗi bình luận chỉ nhận một bản dịch
    assert.equal((await call('GET', '/api/state')).log.at(-1).translated, 'bạn hát hay quá');
    // Trang phụ đề báo không cần dịch (cùng tiếng): đọc câu gốc.
    panel.msgs.length = 0;
    app.ingest({ type: 'chat', user: 'an', nickname: 'An', text: 'chào chị' });
    await until(() => cap.msgs.filter((m) => m.type === 'chat').length === 2);
    await call('POST', '/api/caption/chat', { id: cap.msgs.filter((m) => m.type === 'chat')[1].id, text: '' });
    await until(() => panel.msgs.some((m) => m.type === 'tts'));
    assert.equal(panel.msgs.find((m) => m.type === 'tts').text, 'An nói chào chị');
    assert.equal(panel.msgs.some((m) => m.type === 'chatTranslated'), false);
    panel.ws.close(); cap.ws.close();
  } finally { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('sân khấu: mốc rơi đúng thứ tự và thời điểm, đổi góc máy theo mốc và theo nhịp', async () => {
  const { Stage } = await import('../src/stage.js');
  const { sanitizeConfig, defaultConfig } = await import('../src/defaults.js');
  const cfg = sanitizeConfig({ ...defaultConfig(), stage: { cam1: 'Cận', cam2: 'Toàn', beatSwitch: 4, shows: [{ id: 'a', name: 'Bão', track: '../x.exe', cues: [
    { t: 0.15, effect: 'fireworks', cam: 2 }, { t: 0.05, effect: 'hack', media: 'bao.webm', mediaKey: 'black', camera: 'zoomin' }, { t: 0.25, cam: 1, camera: 'bay' },
  ] }] } });
  assert.equal(cfg.stage.shows[0].track, ''); // tệp lạ bị loại
  assert.deepEqual(cfg.stage.shows[0].cues.map((c) => [c.t, c.effect, c.media, c.camera, c.cam]), [[0.1, 'none', 'bao.webm', 'zoomin', 0], [0.2, 'fireworks', '', 'none', 2], [0.3, 'none', '', 'none', 1]]);
  const out = []; const fired = []; const cams = [];
  const st = new Stage({ getConfig: () => cfg, emit: (m) => out.push(m), fireCue: (c) => fired.push(c.t), switchCam: (i) => cams.push(i) });
  try {
    assert.equal(st.start('khong-co'), false);
    assert.equal(st.start('a'), true);
    assert.deepEqual(out[0], { type: 'show', cmd: 'start', track: '' });
    assert.equal(st.state().running.name, 'Bão');
    await wait(160);
    assert.deepEqual(fired, [0.1]);
    await wait(220);
    assert.deepEqual([fired, cams], [[0.1, 0.2, 0.3], [2, 1]]);
    st.stop();
    assert.equal(st.state().running, null);
    // Dừng giữa chừng thì các mốc còn lại không chạy nữa.
    st.start('a'); st.stop();
    await wait(350);
    assert.equal(fired.length, 3);
    // Theo nhịp: cứ 4 nhịp đổi góc máy một lần.
    cams.length = 0;
    for (let i = 0; i < 9; i++) st.onBeat();
    assert.deepEqual(cams, [2, 1]);
    cfg.stage.cam2 = '';
    assert.equal(st.setCam(2), false); // chưa khai báo camera 2
  } finally { st.close(); }
});
