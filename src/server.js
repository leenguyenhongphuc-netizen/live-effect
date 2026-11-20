import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Store } from './store.js';
import { sendJson, readBody, readJson, serveFile } from './http.js';
import { createRemote } from './remote.js';
import { Engine } from './engine.js';
import { TikTokSource } from './tiktok.js';
import { EFFECTS, SOUNDS, TRIGGERS, MEDIA_EXT, DEFAULT_PORT, safeMediaName, blankRule } from './defaults.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, '..', 'public');
const MAX_MEDIA_BYTES = 80 * 1024 * 1024;

const SAMPLE = {
  follow: { type: 'follow', user: 'ban_xem_moi', nickname: 'Bạn xem mới' },
  gift: { type: 'gift', user: 'fan_cung', nickname: 'Fan cứng', giftName: 'Hoa hồng', count: 5, coins: 5 },
  biggift: { type: 'gift', user: 'dai_gia', nickname: 'Đại gia', giftName: 'Sư tử', count: 1, coins: 29999 },
  like: { type: 'like', user: 'nguoi_tha_tim', nickname: 'Người thả tim', likeCount: 100 },
  share: { type: 'share', user: 'ban_than', nickname: 'Bạn thân' },
  chat: { type: 'chat', user: 'khan_gia', nickname: 'Khán giả', text: 'Chào cả nhà nha!' },
  join: { type: 'join', user: 'khach_moi', nickname: 'Khách mới' },
};

/**
 * Khởi động lõi ứng dụng: máy chủ HTTP + WebSocket chỉ nghe trên máy này.
 * @returns {Promise<object>} điều khiển ứng dụng (url, fireRule, close...)
 */
export async function startApp({ dataDir, port = DEFAULT_PORT, hotkeys = false, onConfigChange, source } = {}) {
  const store = new Store(dataDir);
  const tiktok = source || new TikTokSource();
  const clients = new Set(); // { ws, role }
  const log = []; // nhật ký sự kiện gần đây
  let hotkeyErrors = [];
  let boundPort = port;

  const broadcast = (role, msg) => {
    const data = JSON.stringify(msg);
    for (const c of clients) if (c.role === role && c.ws.readyState === 1) c.ws.send(data);
  };
  const overlayCount = () => [...clients].filter((c) => c.role === 'overlay' && !c.preview).length;
  const statusMsg = () => ({ type: 'status', tiktok: tiktok.status, overlays: overlayCount(), hotkeyErrors });
  const widgetsMsg = () => ({ type: 'widgets', widgets: store.config.widgets });

  const engine = new Engine(() => store.config, (msg) => broadcast('overlay', msg));

  const record = (ev, fired) => {
    const entry = { ...ev, at: Date.now(), fired };
    log.push(entry);
    if (log.length > 200) log.shift();
    broadcast('panel', { type: 'event', event: entry });
  };

  const ingest = (ev) => {
    const fired = engine.handle(ev);
    // Người vào xem xuất hiện dồn dập; chỉ ghi nhật ký khi có kịch bản chạy.
    if (ev.type !== 'join' || fired.length) record(ev, fired);
    const tts = store.config.tts;
    if (tts.enabled) {
      const who = ev.nickname || ev.user || 'bạn';
      let say = '';
      if (ev.type === 'chat' && tts.chat && ev.text) say = `${who} nói ${String(ev.text).slice(0, tts.maxLength)}`;
      else if (ev.type === 'gift' && tts.gift) say = `Cảm ơn ${who} đã tặng ${ev.count || 1} ${ev.giftName || 'quà'}`;
      else if (ev.type === 'follow' && tts.follow && fired.length) say = `Cảm ơn ${who} đã follow`;
      if (say) broadcast('panel', { type: 'tts', text: say });
    }
  };

  tiktok.on('event', ingest);
  tiktok.on('status', (s) => {
    if (s.state === 'connected' && tiktok.lastState !== 'connected') engine.resetSession();
    tiktok.lastState = s.state;
    broadcast('panel', statusMsg());
  });

  const remote = createRemote({
    publicDir: PUBLIC_DIR,
    getConfig: () => store.config,
    basePort: () => boundPort + 1,
    getState: () => ({
      status: { state: tiktok.status.state, username: tiktok.status.username, viewers: tiktok.status.viewers },
      overlays: overlayCount(),
      buttons: store.config.rules
        .filter((r) => r.enabled && r.trigger.type === 'button')
        .map((r) => ({ id: r.id, name: r.name, effect: r.action.effect, media: Boolean(r.action.media) })),
      effects: EFFECTS,
    }),
    // Điện thoại chỉ được làm ba việc: bấm một nút, chạy một hiệu ứng có sẵn, dừng tất cả.
    fire: (body) => {
      if (body.clear === true) {
        broadcast('overlay', { type: 'clear' });
        return true;
      }
      if (typeof body.ruleId === 'string') {
        const rule = store.config.rules.find((r) => r.id === body.ruleId && r.enabled && r.trigger.type === 'button');
        return rule ? engine.fireRule(rule.id, {}) : false;
      }
      if (EFFECTS.some((e) => e.id === body.effect)) {
        engine.fire({ effect: body.effect, intensity: 2, duration: 5, sound: 'none' });
        return true;
      }
      return false;
    },
    onChange: () => remote.info().then((info) => broadcast('panel', { type: 'remote', remote: info })).catch(() => {}),
  });

  const state = async () => ({
    remote: await remote.info(),
    config: store.config,
    status: statusMsg(),
    media: store.listMedia(),
    catalog: { effects: EFFECTS, sounds: SOUNDS, triggers: TRIGGERS, mediaExt: MEDIA_EXT },
    overlayUrl: `http://127.0.0.1:${boundPort}/overlay`,
    capabilities: { hotkeys },
    log: log.slice(-100),
  });

  const allowedHosts = () => new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`]);
  // Chặn trang web lạ trong trình duyệt gọi vào máy chủ cục bộ (CSRF, DNS rebinding).
  const trusted = (req) => {
    const hosts = allowedHosts();
    if (!hosts.has(req.headers.host)) return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return hosts.has(new URL(origin).host); } catch { return false; }
  };

  async function api(req, res, url) {
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /api/state') return sendJson(res, 200, await state());

    if (route === 'PUT /api/config') {
      const body = await readJson(req);
      store.set(body);
      broadcast('overlay', widgetsMsg());
      broadcast('overlay', engine.goalState());
      broadcast('panel', { type: 'config', config: store.config });
      onConfigChange?.(store.config);
      await remote.sync();
      return sendJson(res, 200, { config: store.config, remote: await remote.info() });
    }

    if (route === 'POST /api/remote/rotate') {
      // Đổi mã ghép nối: mọi điện thoại đã quét mã cũ sẽ mất quyền điều khiển.
      store.set(store.config, { rotateToken: true });
      remote.sync();
      return sendJson(res, 200, { remote: await remote.info() });
    }

    if (route === 'POST /api/connect') {
      const body = await readJson(req);
      const username = String(body.username || store.config.tiktok.username || '').trim().replace(/^@/, '');
      if (username !== store.config.tiktok.username) {
        store.set({ ...store.config, tiktok: { ...store.config.tiktok, username } });
        broadcast('panel', { type: 'config', config: store.config });
      }
      // Không chờ kết nối xong: trạng thái được đẩy về qua WebSocket.
      tiktok.connect(username, { signApiKey: store.config.tiktok.signApiKey }).catch(() => {});
      return sendJson(res, 202, { ok: true });
    }

    if (route === 'POST /api/disconnect') {
      await tiktok.disconnect();
      return sendJson(res, 200, { ok: true });
    }

    if (route === 'POST /api/test') {
      const body = await readJson(req);
      if (body.ruleId) {
        const rule = store.config.rules.find((r) => r.id === body.ruleId);
        if (!rule) return sendJson(res, 404, { error: 'Không tìm thấy kịch bản' });
        const sample = SAMPLE[rule.trigger.type] || SAMPLE.follow;
        engine.fire(rule.action, { ...sample, giftName: rule.trigger.giftName || sample.giftName });
      } else {
        const a = body.action || {};
        engine.fire({
          effect: EFFECTS.some((e) => e.id === a.effect) ? a.effect : 'none',
          intensity: Math.min(3, Math.max(1, Number(a.intensity) || 2)),
          duration: Math.min(30, Math.max(1, Number(a.duration) || 5)),
          sound: typeof a.sound === 'string' ? a.sound.slice(0, 140) : 'none',
          media: typeof a.media === 'string' ? a.media.slice(0, 140) : '',
          alert: Boolean(a.text),
          text: typeof a.text === 'string' ? a.text.slice(0, 140) : '',
        }, SAMPLE.gift);
      }
      return sendJson(res, 200, { ok: true, overlays: overlayCount() });
    }

    if (route === 'POST /api/simulate') {
      const body = await readJson(req);
      const sample = SAMPLE[body.type];
      if (!sample) return sendJson(res, 400, { error: 'Loại sự kiện không hợp lệ' });
      // Mỗi lần giả lập follow dùng tên khác nhau để không bị coi là follow lặp.
      const ev = sample.type === 'follow' ? { ...sample, user: `${sample.user}_${Date.now() % 100000}` } : { ...sample };
      ingest({ ...ev, simulated: true });
      return sendJson(res, 200, { ok: true, overlays: overlayCount() });
    }

    if (route === 'POST /api/clear') {
      broadcast('overlay', { type: 'clear' });
      return sendJson(res, 200, { ok: true });
    }

    if (route === 'POST /api/goal/reset') {
      engine.resetSession();
      return sendJson(res, 200, { ok: true });
    }

    if (route === 'POST /api/rules/new') {
      return sendJson(res, 200, { rule: blankRule(`r-${Date.now().toString(36)}`) });
    }

    if (route === 'POST /api/media') {
      const safe = safeMediaName(url.searchParams.get('name'));
      if (!safe) return sendJson(res, 400, { error: 'Loại tệp không hỗ trợ. Dùng ảnh (png, jpg, gif, webp), video (webm, mp4) hoặc âm thanh (mp3, wav, ogg).' });
      let buf;
      try {
        buf = await readBody(req, MAX_MEDIA_BYTES);
      } catch (err) {
        if (err.status === 413) return sendJson(res, 413, { error: 'Tệp quá lớn (tối đa 80 MB).' });
        throw err;
      }
      fs.writeFileSync(path.join(store.mediaDir, safe.name), buf);
      broadcast('panel', { type: 'media', media: store.listMedia() });
      return sendJson(res, 200, { name: safe.name, kind: safe.kind, media: store.listMedia() });
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/media/')) {
      const safe = safeMediaName(decodeURIComponent(url.pathname.slice('/api/media/'.length)));
      if (!safe) return sendJson(res, 400, { error: 'Tên tệp không hợp lệ' });
      try { fs.unlinkSync(path.join(store.mediaDir, safe.name)); } catch { /* đã xoá */ }
      broadcast('panel', { type: 'media', media: store.listMedia() });
      return sendJson(res, 200, { media: store.listMedia() });
    }

    return sendJson(res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    } catch {
      return sendJson(res, 400, { error: 'bad request' });
    }
    const p = decodeURIComponent(url.pathname);

    if (p.startsWith('/api/')) {
      if (!trusted(req)) return sendJson(res, 403, { error: 'forbidden' });
      return api(req, res, url).catch((err) => {
        if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message || 'Lỗi máy chủ' });
      });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });

    if (p === '/' || p === '/panel') {
      res.writeHead(302, { Location: '/panel/' });
      return res.end();
    }
    if (p === '/panel/') return serveFile(res, PUBLIC_DIR, 'panel/index.html');
    if (p === '/overlay' || p === '/overlay/') return serveFile(res, PUBLIC_DIR, 'overlay/index.html');
    if (p.startsWith('/panel/') || p.startsWith('/overlay/') || p.startsWith('/remote/')) return serveFile(res, PUBLIC_DIR, p.slice(1));
    if (p.startsWith('/media/')) return serveFile(res, store.mediaDir, p.slice('/media/'.length));
    return sendJson(res, 404, { error: 'not found' });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/ws' || !trusted(req)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client = {
        ws,
        role: url.searchParams.get('role') === 'panel' ? 'panel' : 'overlay',
        preview: url.searchParams.get('preview') === '1',
      };
      clients.add(client);
      ws.on('pong', () => { client.dead = false; });
      if (client.role === 'overlay') {
        ws.send(JSON.stringify(widgetsMsg()));
        ws.send(JSON.stringify(engine.goalState()));
      } else {
        ws.send(JSON.stringify(statusMsg()));
      }
      broadcast('panel', statusMsg());
      ws.on('close', () => {
        clients.delete(client);
        broadcast('panel', statusMsg());
      });
      ws.on('error', () => {});
    });
  });

  // Giữ kết nối sống và dọn kết nối chết (OBS đôi khi đóng nguồn không báo).
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (c.dead) { c.ws.terminate(); continue; }
      c.dead = true;
      try { c.ws.ping(); } catch { /* đang đóng */ }
    }
  }, 20000);
  // Cổng đang bận thì thử cổng kế tiếp; bảng điều khiển luôn hiện đúng link thật.
  await new Promise((resolve, reject) => {
    let tries = 0;
    const tryListen = () => {
      const onError = (err) => {
        if (err.code === 'EADDRINUSE' && tries++ < 20) {
          boundPort += 1;
          tryListen();
        } else reject(err);
      };
      server.once('error', onError);
      server.listen(boundPort, '127.0.0.1', () => {
        server.off('error', onError);
        boundPort = server.address().port;
        resolve();
      });
    };
    tryListen();
  });

  await remote.sync();

  return {
    remote,
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}/panel/`,
    overlayUrl: `http://127.0.0.1:${boundPort}/overlay`,
    get config() { return store.config; },
    ingest,
    fireRule: (id) => engine.fireRule(id, {}),
    setHotkeyErrors(list) {
      hotkeyErrors = list;
      broadcast('panel', statusMsg());
    },
    async close() {
      clearInterval(heartbeat);
      await remote.close();
      await tiktok.disconnect().catch(() => {});
      for (const c of clients) c.ws.terminate();
      await new Promise((r) => server.close(r));
    },
  };
}
