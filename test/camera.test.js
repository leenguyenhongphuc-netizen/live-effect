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
  const state = { transforms: [], scene: 'Game', items, sockets: new Set() };
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
      }[requestType];
      if (requestType === 'SetSceneItemTransform') state.transforms.push(requestData);
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
