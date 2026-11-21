import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import WebSocket from 'ws';
import { startApp } from '../src/server.js';

class FakeSource extends EventEmitter {
  status = { state: 'idle', username: '', error: '', viewers: 0 };
  async connect(username) { this.status = { ...this.status, state: 'connected', username }; this.emit('status', this.status); }
  async disconnect() { this.status = { ...this.status, state: 'idle' }; this.emit('status', this.status); }
}

async function boot() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-effect-test-'));
  const source = new FakeSource();
  const app = await startApp({ dataDir, port: 0, source });
  const base = `http://127.0.0.1:${app.port}`;
  const json = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const overlay = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws?role=overlay`);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d)));
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
    return { ws, msgs, wait: async (pred) => { for (let i = 0; i < 100; i++) { const m = msgs.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 10)); } throw new Error('không nhận được tin'); } };
  };
  return { app, base, json, overlay, source, dataDir, stop: async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

test('sự kiện TikTok đi tới overlay và trang lạ bị chặn', async () => {
  const t = await boot();
  try {
    const ov = await t.overlay();
    await ov.wait((m) => m.type === 'widgets');
    t.source.emit('event', { type: 'gift', user: 'an', nickname: 'An', giftName: 'Rose', count: 3, coins: 3 });
    const fx = await ov.wait((m) => m.type === 'fx');
    assert.equal(fx.effect, 'giftrain');
    assert.equal(fx.alert, 'An tặng 3 Rose');

    // Danh mục quà đến từ TikTok và từ chính quà vừa nhận; thử đúng một món quà theo mã.
    t.source.emit('gifts', [{ id: '6369', name: 'Lion', coins: 29999, image: 'https://cdn/lion.png', type: 2 }]);
    t.source.emit('event', { type: 'gift', user: 'b', giftId: '777', giftName: 'Mới', count: 2, coins: 20 });
    const gifts = (await t.json('GET', '/api/state')).body.gifts;
    assert.deepEqual(gifts.map((g) => [g.id, g.coins]), [['777', 10], ['6369', 29999]]);
    await t.json('POST', '/api/simulate', { giftId: '6369' });
    assert.equal((await ov.wait((m) => m.type === 'fx' && m.effect === 'fireworks')).image, 'https://cdn/lion.png');

    // Khung nhạc từ bảng điều khiển chỉ tới overlay khi bật "Nhạc và nhịp", và được làm sạch.
    const panel = new WebSocket(`ws://127.0.0.1:${t.app.port}/ws?role=panel`);
    await new Promise((r) => panel.on('open', r));
    panel.send(JSON.stringify({ type: 'audio', b: 0.5, beat: true }));
    const cfg0 = (await t.json('GET', '/api/state')).body.config;
    await t.json('PUT', '/api/config', { ...cfg0, music: { ...cfg0.music, enabled: true } });
    assert.equal((await ov.wait((m) => m.type === 'widgets' && m.music?.enabled)).music.palette, 'storm');
    panel.send(JSON.stringify({ type: 'audio', b: 7, l: 'x', beat: 'yes', s: 0.4, bands: [50, 999, -3] }));
    assert.deepEqual(await ov.wait((m) => m.type === 'audio'), { type: 'audio', b: 1, m: 0, h: 0, l: 0, beat: false, s: 0.4, bands: [50, 100, 0] });
    assert.equal(ov.msgs.filter((m) => m.type === 'audio').length, 1);
    panel.close();

    const sim = await t.json('POST', '/api/simulate', { type: 'follow' });
    assert.equal(sim.body.overlays, 1);
    await ov.wait((m) => m.type === 'fx' && m.effect === 'hearts');

    // Trang web khác trong trình duyệt không được gọi API hay mở WebSocket.
    assert.equal((await t.json('POST', '/api/simulate', { type: 'follow' }, { Origin: 'https://evil.example' })).status, 403);
    const rebind = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: t.app.port, path: '/api/state', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert.equal(rebind, 403);
    const bad = new WebSocket(`ws://127.0.0.1:${t.app.port}/ws?role=panel`, { origin: 'https://evil.example' });
    await new Promise((r) => { bad.on('error', r); bad.on('close', r); });
    assert.notEqual(bad.readyState, WebSocket.OPEN);
    ov.ws.close();
  } finally { await t.stop(); }
});

test('lưu cấu hình, thư viện tệp và đường dẫn nguy hiểm', async () => {
  const t = await boot();
  try {
    const { body: state } = await t.json('GET', '/api/state');
    state.config.widgets.goal.enabled = true;
    state.config.rules[0].name = 'Đổi tên';
    const saved = await t.json('PUT', '/api/config', state.config);
    assert.equal(saved.body.config.rules[0].name, 'Đổi tên');
    assert.equal(JSON.parse(fs.readFileSync(path.join(t.dataDir, 'config.json'), 'utf8')).widgets.goal.enabled, true);

    const up = await fetch(`${t.base}/api/media?name=${encodeURIComponent('../rồng lửa.webm')}`, { method: 'POST', body: Buffer.from('fake') });
    assert.deepEqual((await up.json()).media, ['rồng lửa.webm']);
    assert.ok(fs.existsSync(path.join(t.dataDir, 'media', 'rồng lửa.webm')));
    assert.equal((await fetch(`${t.base}/media/${encodeURIComponent('rồng lửa.webm')}`)).status, 200);
    assert.equal((await fetch(`${t.base}/api/media?name=a.exe`, { method: 'POST', body: 'x' })).status, 400);
    assert.equal((await fetch(`${t.base}/media/..%2Fconfig.json`)).status, 403);
    assert.equal((await fetch(`${t.base}/panel/..%2F..%2Fpackage.json`)).status, 403);
    const del = await t.json('DELETE', `/api/media/${encodeURIComponent('rồng lửa.webm')}`);
    assert.deepEqual(del.body.media, []);
  } finally { await t.stop(); }
});

test('điện thoại: tắt mặc định, cần mã ghép nối, chỉ bấm được nút bấm tay', async () => {
  const t = await boot();
  try {
    const { body: state } = await t.json('GET', '/api/state');
    assert.equal(state.remote.running, false);

    state.config.remote.enabled = true;
    state.config.remote.token = 'a'.repeat(32); // bảng điều khiển không tự đặt được mã
    const { body: on } = await t.json('PUT', '/api/config', state.config);
    assert.equal(on.remote.running, true);
    const token = on.config.remote.token;
    assert.match(token, /^[0-9a-f]{32}$/);
    assert.notEqual(token, 'a'.repeat(32));
    assert.match(on.remote.qr, /^<svg/);

    const remote = `http://127.0.0.1:${on.remote.port}`;
    const r = (method, url, key, body) => fetch(remote + url, { method, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
    assert.equal((await r('GET', '/')).status, 200);
    assert.equal((await r('GET', '/r/state')).status, 401);
    assert.equal((await r('GET', '/r/state', 'sai')).status, 401);
    assert.equal((await r('GET', '/api/state', token)).status, 404); // API quản trị không lộ ra mạng Wi-Fi
    assert.equal((await r('GET', '/panel/', token)).status, 404);

    const rs = await (await r('GET', '/r/state', token)).json();
    assert.deepEqual(rs.buttons.map((b) => b.id), ['r-btn-party', 'r-btn-thanks']);

    const ov = await t.overlay();
    assert.deepEqual(await (await r('POST', '/r/fire', token, { ruleId: 'r-btn-party' })).json(), { ok: true });
    assert.equal((await ov.wait((m) => m.type === 'fx')).effect, 'fireworks');
    // Kịch bản tự động (không phải nút bấm tay) không bấm được từ điện thoại.
    assert.deepEqual(await (await r('POST', '/r/fire', token, { ruleId: 'r-gift' })).json(), { ok: false });
    assert.deepEqual(await (await r('POST', '/r/fire', token, { effect: 'snow' })).json(), { ok: true });
    assert.deepEqual(await (await r('POST', '/r/fire', token, { clear: true })).json(), { ok: true });
    // Bật tắt chúc mừng quà từ điện thoại.
    assert.equal(rs.celebrate, true);
    assert.deepEqual(await (await r('POST', '/r/fire', token, { celebrate: false })).json(), { ok: true });
    assert.equal(t.app.config.gifts.celebrate, false);
    assert.equal((await (await r('GET', '/r/state', token)).json()).celebrate, false);
    await ov.wait((m) => m.type === 'clear');

    // Đổi mã: mã cũ mất hiệu lực ngay.
    const { body: rot } = await t.json('POST', '/api/remote/rotate');
    assert.equal((await r('GET', '/r/state', token)).status, 401);
    const fresh = new URL(rot.remote.urls[0] || `http://x/?k=${t.app.config.remote.token}`).searchParams.get('k');
    assert.equal((await r('GET', '/r/state', fresh)).status, 200);

    // Tắt: cổng đóng hẳn.
    const cfg = t.app.config;
    await t.json('PUT', '/api/config', { ...cfg, remote: { ...cfg.remote, enabled: false } });
    await assert.rejects(r('GET', '/'));
    ov.ws.close();
  } finally { await t.stop(); }
});

class FakePoller extends EventEmitter {
  status = { state: 'idle', error: '' };
  started = null;
  start(opts) { this.started = opts; this.status = { state: 'connected', error: '' }; this.emit('status', this.status); }
  stop() { this.started = null; this.status = { state: 'idle', error: '' }; }
}

test('ủng hộ: chuyển khoản tới overlay, mã QR theo tài khoản, link nhận sự kiện cần đúng khoá', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-effect-test-'));
  const sepay = new FakePoller();
  const app = await startApp({ dataDir, port: 0, source: new FakeSource(), sepay, twitch: new FakeSource() });
  const base = `http://127.0.0.1:${app.port}`;
  const put = async (config) => (await fetch(`${base}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })).json();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws?role=overlay`);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d)));
    await new Promise((r) => ws.on('open', r));
    const wait = async (pred) => { for (let i = 0; i < 100; i++) { const m = msgs.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 10)); } throw new Error('không nhận được tin'); };
    assert.equal((await wait((m) => m.type === 'widgets')).widgets.qr.svg, '');
    assert.equal(sepay.started, null);

    const cfg = app.config;
    const saved = await put({
      ...cfg,
      donate: { enabled: true, sepayToken: 'tok', bank: '970422', account: '0123456789', holder: 'NGUYEN VAN A', memo: 'Ung ho' },
      hook: { enabled: true, key: 'f'.repeat(32) },
      widgets: { ...cfg.widgets, qr: { ...cfg.widgets.qr, enabled: true } },
    });
    assert.deepEqual(sepay.started, { token: 'tok', account: '0123456789' });
    const w = await wait((m) => m.type === 'widgets' && m.widgets.qr.svg);
    assert.match(w.widgets.qr.svg, /^<svg/);
    assert.equal(w.widgets.qr.bank, 'MB Bank');
    assert.equal(w.widgets.qr.holder, 'NGUYEN VAN A');

    sepay.emit('event', { type: 'donate', user: '', nickname: '', amount: 50000, text: 'co len nha', source: 'bank' });
    assert.equal((await wait((m) => m.type === 'fx')).alert, 'Một bạn ủng hộ 50.000đ co len nha');

    // Khoá của link do máy chủ tạo, không nhận khoá bảng điều khiển gửi lên.
    const key = saved.config.hook.key;
    assert.match(key, /^[0-9a-f]{32}$/);
    assert.notEqual(key, 'f'.repeat(32));
    assert.equal(saved.hookUrl, `${base}/hook/${key}`);
    assert.equal((await fetch(`${base}/hook/${'f'.repeat(32)}?type=donate&amount=1`)).status, 404);
    msgs.length = 0;
    assert.equal((await fetch(`${base}/hook/${key}?type=donate&name=An&amount=120000&text=hay`)).status, 200);
    assert.equal((await wait((m) => m.type === 'fx')).alert, 'An ủng hộ 120.000đ hay');
    msgs.length = 0;
    assert.equal((await fetch(`${base}/hook/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ button: 'ăn mừng' }) })).status, 200);
    assert.equal((await wait((m) => m.type === 'fx')).effect, 'fireworks');
    assert.equal((await fetch(`${base}/hook/${key}?type=khong-co`)).status, 400);
    assert.equal((await fetch(`${base}/hook/${key}?button=khong-co`)).status, 404);

    // Tắt: link cũ chết, SePay dừng.
    await put({ ...app.config, donate: { ...app.config.donate, enabled: false }, hook: { enabled: false } });
    assert.equal(sepay.started, null);
    assert.equal((await fetch(`${base}/hook/${key}?type=donate&amount=1`)).status, 404);
    ws.close();
  } finally { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('điện thoại: tải video lên thành nút mới kèm ảnh thu nhỏ, vẫn cần mã ghép nối', async () => {
  const t = await boot();
  try {
    const { body: state } = await t.json('GET', '/api/state');
    state.config.remote.enabled = true;
    const { body: on } = await t.json('PUT', '/api/config', state.config);
    const token = on.config.remote.token;
    const remote = `http://127.0.0.1:${on.remote.port}`;
    const name = encodeURIComponent('Vương Lâm.mov');

    assert.equal((await fetch(`${remote}/r/upload?name=${name}`, { method: 'POST', body: 'x' })).status, 401);
    assert.equal((await fetch(`${remote}/r/upload?name=virus.exe`, { method: 'POST', headers: { 'X-Key': token }, body: 'x' })).status, 400);
    assert.equal((await fetch(`${remote}/r/upload?name=${name}`, { method: 'POST', headers: { 'X-Key': token }, body: '' })).status, 400);

    const up = await fetch(`${remote}/r/upload?name=${name}&title=${encodeURIComponent('Hùng - Vương Lâm')}`, { method: 'POST', headers: { 'X-Key': token }, body: Buffer.from('fake video') });
    const upBody = await up.json();
    assert.equal(up.status, 200);
    assert.equal(upBody.name, 'Vương Lâm.mov');
    assert.equal(fs.readFileSync(path.join(t.dataDir, 'media', 'Vương Lâm.mov'), 'utf8'), 'fake video');
    assert.ok(!fs.existsSync(path.join(t.dataDir, 'media', 'Vương Lâm.mov.part')));
    assert.equal((await fetch(`${t.base}/media/${name}`)).headers.get('content-type'), 'video/mp4');

    const rule = t.app.config.rules.find((r) => r.id === upBody.ruleId);
    assert.deepEqual([rule.name, rule.trigger.type, rule.action.media, rule.action.effect], ['Hùng - Vương Lâm', 'button', 'Vương Lâm.mov', 'none']);

    // Ảnh thu nhỏ: chỉ nhận JPEG thật, cho tệp có trong thư viện.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const thumb = (n, body, key = token) => fetch(`${remote}/r/thumb?name=${n}`, { method: 'POST', headers: { 'X-Key': key }, body });
    assert.equal((await thumb(name, Buffer.from('<svg onload=alert(1)>'))).status, 400);
    assert.equal((await thumb('khong-co.mp4', jpeg)).status, 400);
    assert.equal((await thumb(name, jpeg, 'sai')).status, 401);
    assert.equal((await thumb(name, jpeg)).status, 200);
    assert.equal((await fetch(`${remote}/r/thumb/${name}`)).status, 401);
    const got = await fetch(`${remote}/r/thumb/${name}`, { headers: { 'X-Key': token } });
    assert.equal(got.headers.get('content-type'), 'image/jpeg');
    assert.equal((await fetch(`${t.base}/thumb/${name}`)).status, 200);

    const rs = await (await fetch(`${remote}/r/state`, { headers: { 'X-Key': token } })).json();
    assert.deepEqual(rs.buttons.at(-1), { id: upBody.ruleId, name: 'Hùng - Vương Lâm', effect: 'none', media: 'Vương Lâm.mov', thumb: true });

    // Xoá tệp thì ảnh thu nhỏ cũng mất.
    await t.json('DELETE', `/api/media/${name}`);
    assert.equal((await fetch(`${t.base}/thumb/${name}`)).status, 404);
  } finally { await t.stop(); }
});
