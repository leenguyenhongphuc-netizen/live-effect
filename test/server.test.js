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
