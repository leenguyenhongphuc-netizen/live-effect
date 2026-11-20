import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { Store } from './store.js';
import { sendJson, readBody, readJson, saveBody, serveFile } from './http.js';
import { createRemote } from './remote.js';
import { GiftCatalog } from './gifts.js';
import { ObsCamera } from './obscam.js';
import { Jar } from './jar.js';
import { EffectQueue } from './queue.js';
import { Engine } from './engine.js';
import { TikTokSource } from './tiktok.js';
import { TwitchSource } from './twitch.js';
import { SepaySource, BANKS, vietQrPayload } from './donate.js';
import { addToObs } from './obs.js';
import { EFFECTS, SOUNDS, TRIGGERS, MEDIA_EXT, DEFAULT_PORT, safeMediaName, blankRule } from './defaults.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, '..', 'public');
const MAX_MEDIA_BYTES = 300 * 1024 * 1024;
const MAX_THUMB_BYTES = 400 * 1024;
const BAD_TYPE = 'Loại tệp không hỗ trợ. Dùng ảnh (png, jpg, gif, webp), video (webm, mp4, mov) hoặc âm thanh (mp3, wav, ogg).';

const SAMPLE = {
  follow: { type: 'follow', user: 'ban_xem_moi', nickname: 'Bạn xem mới' },
  gift: { type: 'gift', user: 'fan_cung', nickname: 'Fan cứng', giftName: 'Hoa hồng', count: 5, coins: 5 },
  biggift: { type: 'gift', user: 'dai_gia', nickname: 'Đại gia', giftName: 'Sư tử', count: 1, coins: 29999 },
  like: { type: 'like', user: 'nguoi_tha_tim', nickname: 'Người thả tim', likeCount: 100 },
  share: { type: 'share', user: 'ban_than', nickname: 'Bạn thân' },
  chat: { type: 'chat', user: 'khan_gia', nickname: 'Khán giả', text: 'Chào cả nhà nha!' },
  join: { type: 'join', user: 'khach_moi', nickname: 'Khách mới' },
  donate: { type: 'donate', user: '', nickname: 'Minh Anh', amount: 50000, text: 'Chị live vui quá, cố lên nha!' },
};

const HOOK_TYPES = ['donate', 'gift', 'follow', 'share', 'chat', 'like', 'join'];
const cut = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max) : '');
const posNum = (v, max) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)));

/** Đổi tham số của link nhận sự kiện thành một sự kiện chuẩn. Trả về null nếu không hợp lệ. */
export function hookEvent(p) {
  if (!HOOK_TYPES.includes(p.type)) return null;
  const name = cut(p.name, 60).trim();
  const ev = { type: p.type, user: name, nickname: name, text: cut(p.text, 200), source: 'hook' };
  if (p.type === 'donate') ev.amount = posNum(p.amount, 1e10);
  if (p.type === 'gift') {
    ev.count = posNum(p.count, 1e6) || 1;
    ev.coins = posNum(p.coins, 1e9);
    ev.giftName = cut(p.gift, 60) || 'quà';
  }
  if (p.type === 'like') ev.likeCount = posNum(p.count, 1e6) || 1;
  return ev;
}

function sameKey(given, expected) {
  if (typeof given !== 'string' || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Khởi động lõi ứng dụng: máy chủ HTTP + WebSocket chỉ nghe trên máy này.
 * @returns {Promise<object>} điều khiển ứng dụng (url, fireRule, close...)
 */
export async function startApp({ dataDir, port = DEFAULT_PORT, hotkeys = false, onConfigChange, source, twitch: twitchInjected, sepay: sepayInjected, obs = addToObs, obsPort } = {}) {
  const store = new Store(dataDir);
  const tiktok = source || new TikTokSource();
  const catalog = new GiftCatalog(path.join(dataDir, 'gifts.json'));
  tiktok.catalog = catalog;
  const jar = new Jar(() => store.config);
  const camera = new ObsCamera({ getConfig: () => store.config, port: obsPort, onStatus: () => broadcast('panel', statusMsg()) });
  const twitch = twitchInjected || new TwitchSource();
  const sepay = sepayInjected || new SepaySource();
  const clients = new Set(); // { ws, role }
  const log = []; // nhật ký sự kiện gần đây
  let hotkeyErrors = [];
  let boundPort = port;
  let qrCache = { payload: null, svg: '' };
  let sepayKey = '';

  const broadcast = (role, msg) => {
    const data = JSON.stringify(msg);
    for (const c of clients) if (c.role === role && c.ws.readyState === 1) c.ws.send(data);
  };
  const overlayCount = () => [...clients].filter((c) => c.role === 'overlay' && !c.preview).length;
  const statusMsg = () => ({
    type: 'status', tiktok: tiktok.status, twitch: twitch.status, donate: sepay.status, overlays: overlayCount(), hotkeyErrors,
    camera: camera.status,
  });
  const widgetsMsg = () => {
    const w = store.config.widgets;
    const dn = store.config.donate;
    return {
      type: 'widgets',
      music: store.config.music,
      captions: store.config.captions,
      jar: store.config.jar,
      widgets: { ...w, qr: { ...w.qr, svg: qrCache.svg, bank: BANKS.find((b) => b.bin === dn.bank)?.name || '', holder: dn.holder } },
    };
  };

  /** Vẽ lại mã VietQR khi thông tin tài khoản đổi. Mã được tạo ngay trên máy này. */
  async function refreshQr() {
    const dn = store.config.donate;
    const payload = vietQrPayload({ bin: dn.bank, account: dn.account, memo: dn.memo });
    if (payload === qrCache.payload) return;
    qrCache = { payload, svg: payload ? await QRCode.toString(payload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : '' };
  }

  function syncSepay() {
    const dn = store.config.donate;
    const key = dn.enabled && dn.sepayToken ? `${dn.sepayToken}|${dn.account}` : '';
    if (key === sepayKey) return;
    sepayKey = key;
    if (key) sepay.start({ token: dn.sepayToken, account: dn.account });
    else sepay.stop();
  }

  // Khung phân tích nhạc từ bảng điều khiển: kiểm tra từng số rồi mới chuyển cho overlay.
  const unit = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; };
  const relayAudio = (msg) => {
    if (!store.config.music.enabled) return;
    if (msg.beat === true) camera.beat(unit(msg.s));
    broadcast('overlay', {
      type: 'audio', b: unit(msg.b), m: unit(msg.m), h: unit(msg.h), l: unit(msg.l), beat: msg.beat === true, s: unit(msg.s),
      bands: Array.isArray(msg.bands) ? msg.bands.slice(0, 12).map((x) => Math.round(unit(Number(x) / 100) * 100)) : [],
    });
  };

  // Kịch bản có kèm chuyển động camera: gửi lệnh sang OBS cùng lúc với hiệu ứng trên overlay.
  const queue = new EffectQueue({
    dispatch: (msg) => {
      if (msg.camera && msg.camera !== 'none') camera.move(msg.camera, { duration: msg.duration });
      broadcast('overlay', msg);
    },
    onChange: () => { broadcast('panel', { type: 'queue', queue: queue.state() }); },
  });
  // Mọi hiệu ứng đi qua hàng đợi: video toàn màn hình phát lần lượt theo ưu tiên, còn lại chạy ngay.
  const engine = new Engine(() => store.config, (msg) => {
    if (msg.type === 'fx') queue.push(msg); else broadcast('overlay', msg);
  });

  const record = (ev, fired) => {
    const entry = { ...ev, at: Date.now(), fired };
    log.push(entry);
    if (log.length > 200) log.shift();
    broadcast('panel', { type: 'event', event: entry });
  };

  const mergeGifts = (list) => {
    if (catalog.merge(list)) broadcast('panel', { type: 'gifts', gifts: catalog.list() });
  };
  tiktok.on('gifts', mergeGifts);

  const ingest = (ev) => {
    if (ev.type === 'gift' && ev.giftId && !ev.simulated) {
      mergeGifts([{ id: ev.giftId, name: ev.giftName, coins: Math.round((ev.coins || 0) / (ev.count || 1)), image: ev.giftImage }]);
    }
    const fired = engine.handle(ev);
    // Hũ quà: quà nào cũng rơi vào hũ (kể cả khi đang tắt chúc mừng); đầy thì vỡ và chạy kịch bản "Hũ quà đầy".
    if (ev.type === 'gift') {
      const put = jar.add({ coins: ev.coins, count: ev.count, image: ev.giftImage });
      if (put) {
        broadcast('overlay', { type: 'jardrop', drop: put.drop, coins: put.full ? store.config.jar.target : jar.coins });
        if (put.full) {
          broadcast('overlay', { type: 'jarburst', rounds: jar.rounds });
          const full = { type: 'jar', user: ev.user, nickname: ev.nickname, avatar: ev.avatar, coins: store.config.jar.target, simulated: ev.simulated };
          record(full, engine.handle(full));
        }
      }
    }
    // Người vào xem xuất hiện dồn dập; chỉ ghi nhật ký khi có kịch bản chạy.
    if (ev.type !== 'join' || fired.length) record(ev, fired);
    const tts = store.config.tts;
    if (tts.enabled) {
      const who = ev.nickname || ev.user || 'bạn';
      let say = '';
      if (ev.type === 'chat' && tts.chat && ev.text) say = `${who} nói ${String(ev.text).slice(0, tts.maxLength)}`;
      else if (ev.type === 'gift' && tts.gift) say = `Cảm ơn ${who} đã tặng ${ev.count || 1} ${ev.giftName || 'quà'}`;
      else if (ev.type === 'follow' && tts.follow && fired.length) say = `Cảm ơn ${who} đã follow`;
      else if (ev.type === 'donate' && tts.donate) say = `Cảm ơn ${who} đã ủng hộ ${ev.amount || 0} đồng. ${String(ev.text || '').slice(0, tts.maxLength)}`;
      if (say) broadcast('panel', { type: 'tts', text: say });
    }
  };

  tiktok.on('event', ingest);
  tiktok.on('status', (s) => {
    if (s.state === 'connected' && tiktok.lastState !== 'connected') { engine.resetSession(); jar.reset(); broadcast('overlay', jar.state()); }
    tiktok.lastState = s.state;
    broadcast('panel', statusMsg());
  });
  twitch.on('event', ingest);
  twitch.on('status', () => broadcast('panel', statusMsg()));
  sepay.on('event', ingest);
  sepay.on('status', () => broadcast('panel', statusMsg()));

  const pushConfig = () => {
    broadcast('overlay', widgetsMsg());
    broadcast('overlay', engine.goalState());
    broadcast('overlay', engine.topState());
    broadcast('overlay', { ...jar.state(), drops: undefined });
    broadcast('panel', { type: 'config', config: store.config });
    onConfigChange?.(store.config);
  };

  /** Nhận một tệp vào thư viện. Trả về [mã HTTP, nội dung trả lời]. */
  async function receiveMedia(req, url) {
    const safe = safeMediaName(url.searchParams.get('name'));
    if (!safe) return [400, { error: BAD_TYPE }];
    try {
      await saveBody(req, path.join(store.mediaDir, safe.name), MAX_MEDIA_BYTES);
    } catch (err) {
      if (err.status === 413) return [413, { error: 'Tệp quá lớn (tối đa 300 MB).' }];
      if (err.status === 400) return [400, { error: 'Tệp rỗng hoặc bị ngắt giữa chừng. Hãy thử lại.' }];
      throw err;
    }
    broadcast('panel', { type: 'media', media: store.listMedia() });
    return [200, { name: safe.name, kind: safe.kind, media: store.listMedia() }];
  }

  async function receiveThumb(req, url) {
    const safe = safeMediaName(url.searchParams.get('name'));
    if (!safe || safe.kind === 'audio' || !store.listMedia().includes(safe.name)) return [400, { error: 'Không có tệp này trong thư viện' }];
    let buf;
    try { buf = await readBody(req, MAX_THUMB_BYTES); } catch { return [413, { error: 'Ảnh thu nhỏ quá lớn' }]; }
    return store.saveThumb(safe.name, buf) ? [200, { ok: true }] : [400, { error: 'Ảnh thu nhỏ phải là JPEG' }];
  }

  /** Tạo một "Nút bấm tay" phát video/hình toàn màn hình; nút hiện ngay trên điện thoại. */
  function addMediaButton(file, title) {
    const rule = blankRule(`r-${Date.now().toString(36)}`);
    rule.name = (cut(title, 60).trim() || file.replace(/\.[^.]+$/, '')).slice(0, 60);
    rule.trigger.type = 'button';
    rule.action = { ...rule.action, effect: 'none', sound: 'none', alert: false, text: '', media: file, mediaFit: 'cover' };
    store.set({ ...store.config, rules: [...store.config.rules, rule] });
    pushConfig();
    return rule.id;
  }

  const serveThumb = (res, name) => {
    const safe = safeMediaName(name);
    if (!safe) return sendJson(res, 404, { error: 'not found' });
    return serveFile(res, store.thumbDir, `${safe.name}.jpg`);
  };

  const remote = createRemote({
    publicDir: PUBLIC_DIR,
    getConfig: () => store.config,
    basePort: () => boundPort + 1,
    getState: () => ({
      status: { state: tiktok.status.state, username: tiktok.status.username, viewers: tiktok.status.viewers },
      overlays: overlayCount(),
      celebrate: store.config.gifts.celebrate,
      paused: queue.paused,
      camera: camera.status.state === 'ready',
      buttons: store.config.rules
        .filter((r) => r.enabled && r.trigger.type === 'button')
        .map((r) => ({ id: r.id, name: r.name, effect: r.action.effect, media: r.action.media, thumb: store.hasThumb(r.action.media) })),
      effects: EFFECTS,
    }),
    // Điện thoại chỉ được: bấm một nút, chạy một hiệu ứng có sẵn, dừng tất cả, và thêm video/hình thành nút mới.
    fire: (body) => {
      // Chuyển động camera bấm thẳng từ điện thoại (chỉ khi đã nối OBS).
      if (typeof body.camera === 'string') return camera.move(body.camera, { duration: 2.5 });
      if (typeof body.paused === 'boolean') { queue.setPaused(body.paused); return true; }
      if (typeof body.celebrate === 'boolean') {
        store.set({ ...store.config, gifts: { ...store.config.gifts, celebrate: body.celebrate } });
        broadcast('panel', { type: 'config', config: store.config });
        return true;
      }
      if (body.clear === true) {
        queue.clear();
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
    extra: async (req, res, url) => {
      const route = `${req.method} ${url.pathname}`;
      if (route === 'POST /r/upload') {
        const [status, body] = await receiveMedia(req, url);
        if (status === 200 && body.kind !== 'audio') body.ruleId = addMediaButton(body.name, url.searchParams.get('title'));
        delete body.media; // điện thoại không cần danh sách thư viện
        sendJson(res, status, body);
        return true;
      }
      if (route === 'POST /r/thumb') {
        const [status, body] = await receiveThumb(req, url);
        sendJson(res, status, body);
        return true;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/r/thumb/')) {
        serveThumb(res, decodeURIComponent(url.pathname.slice('/r/thumb/'.length)));
        return true;
      }
      return false;
    },
    onChange: () => remote.info().then((info) => broadcast('panel', { type: 'remote', remote: info })).catch(() => {}),
  });

  const hookUrl = () => (store.config.hook.enabled && store.config.hook.key ? `http://127.0.0.1:${boundPort}/hook/${store.config.hook.key}` : '');

  const state = async () => ({
    remote: await remote.info(),
    config: store.config,
    status: statusMsg(),
    media: store.listMedia(),
    gifts: catalog.list(),
    queue: queue.state(),
    catalog: { effects: EFFECTS, sounds: SOUNDS, triggers: TRIGGERS, mediaExt: MEDIA_EXT, banks: BANKS },
    overlayUrl: `http://127.0.0.1:${boundPort}/overlay`,
    hookUrl: hookUrl(),
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
      await refreshQr();
      syncSepay();
      pushConfig();
      await camera.sync();
      await remote.sync();
      return sendJson(res, 200, { config: store.config, remote: await remote.info(), hookUrl: hookUrl() });
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

    if (route === 'POST /api/twitch/connect') {
      const body = await readJson(req);
      const channel = cut(body.channel, 80) || store.config.twitch.channel;
      twitch.connect(channel);
      const joined = twitch.status.channel;
      if (joined && joined !== store.config.twitch.channel) {
        store.set({ ...store.config, twitch: { channel: joined } });
        broadcast('panel', { type: 'config', config: store.config });
      }
      return sendJson(res, 202, { ok: true });
    }

    if (route === 'POST /api/twitch/disconnect') {
      twitch.disconnect();
      return sendJson(res, 200, { ok: true });
    }

    if (route === 'POST /api/caption') {
      // Câu nói và bản dịch từ trang phụ đề (mở trong Chrome): làm sạch rồi đưa lên overlay.
      const body = await readJson(req);
      const text = typeof body.text === 'string' ? body.text.trim().slice(0, 300) : '';
      const on = store.config.captions.enabled;
      if (on && text) {
        const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 2)
          .map((l) => ({ lang: String(l?.lang || '').replace(/[^a-z-]/gi, '').slice(0, 8), text: typeof l?.text === 'string' ? l.text.trim().slice(0, 300) : '' }))
          .filter((l) => l.text);
        broadcast('overlay', { type: 'caption', text, lines, final: body.final === true });
      }
      return sendJson(res, 200, { ok: true, enabled: on, overlays: overlayCount() });
    }

    if (route === 'POST /api/obs/add') {
      return sendJson(res, 200, await obs(`http://127.0.0.1:${boundPort}/overlay`));
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
      // Thử đúng một món quà trong danh mục (kèm hình thật của quà đó).
      const gift = body.giftId ? catalog.get(String(body.giftId)) : null;
      if (gift) {
        ingest({ ...SAMPLE.gift, giftId: gift.id, giftName: gift.name, giftImage: gift.image, count: 1, coins: gift.coins, simulated: true });
        return sendJson(res, 200, { ok: true, overlays: overlayCount() });
      }
      const sample = SAMPLE[body.type];
      if (!sample) return sendJson(res, 400, { error: 'Loại sự kiện không hợp lệ' });
      // Mỗi lần giả lập follow dùng tên khác nhau để không bị coi là follow lặp.
      const ev = sample.type === 'follow' ? { ...sample, user: `${sample.user}_${Date.now() % 100000}` } : { ...sample };
      ingest({ ...ev, simulated: true });
      return sendJson(res, 200, { ok: true, overlays: overlayCount() });
    }

    if (route === 'POST /api/camera/test') {
      const body = await readJson(req);
      const ok = camera.move(String(body.move || ''), { duration: 2.5 });
      return sendJson(res, 200, { ok, camera: camera.status });
    }

    if (route === 'POST /api/queue') {
      const body = await readJson(req);
      if (typeof body.paused === 'boolean') queue.setPaused(body.paused);
      if (body.clear === true) queue.clear();
      return sendJson(res, 200, { queue: queue.state() });
    }

    if (route === 'POST /api/clear') {
      queue.clear();
      broadcast('overlay', { type: 'clear' });
      return sendJson(res, 200, { ok: true });
    }

    if (route === 'POST /api/jar/reset') {
      jar.reset();
      broadcast('overlay', jar.state());
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
      const [status, body] = await receiveMedia(req, url);
      return sendJson(res, status, body);
    }

    if (route === 'POST /api/thumb') {
      const [status, body] = await receiveThumb(req, url);
      return sendJson(res, status, body);
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/media/')) {
      const safe = safeMediaName(decodeURIComponent(url.pathname.slice('/api/media/'.length)));
      if (!safe) return sendJson(res, 400, { error: 'Tên tệp không hợp lệ' });
      store.removeMedia(safe.name);
      broadcast('panel', { type: 'media', media: store.listMedia() });
      return sendJson(res, 200, { media: store.listMedia() });
    }

    return sendJson(res, 404, { error: 'not found' });
  }

  /**
   * Link nhận sự kiện từ công cụ khác trên máy này (Streamer.bot, Stream Deck, script...):
   *   /hook/<khoá>?type=donate&name=An&amount=50000&text=...
   *   /hook/<khoá>?button=<tên hoặc id nút bấm tay>
   * Khoá nằm ngay trong link nên dùng được cả GET lẫn POST.
   */
  async function hook(req, res, url, key) {
    const cfg = store.config.hook;
    if (!cfg.enabled || !sameKey(key, cfg.key)) return sendJson(res, 404, { error: 'not found' });
    let params = Object.fromEntries(url.searchParams);
    if (req.method === 'POST') {
      const body = await readJson(req);
      if (body && typeof body === 'object') params = { ...params, ...body };
    }
    if (params.button) {
      const want = String(params.button).toLowerCase();
      const rule = store.config.rules.find((r) => r.enabled && r.trigger.type === 'button' && (r.id === params.button || r.name.toLowerCase() === want));
      if (!rule) return sendJson(res, 404, { error: 'Không có nút bấm tay nào tên như vậy' });
      engine.fireRule(rule.id, {});
      return sendJson(res, 200, { ok: true });
    }
    const ev = hookEvent(params);
    if (!ev) return sendJson(res, 400, { error: `type phải là một trong: ${HOOK_TYPES.join(', ')}; hoặc dùng button=<tên nút>` });
    ingest(ev);
    return sendJson(res, 200, { ok: true });
  }

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    } catch {
      return sendJson(res, 400, { error: 'bad request' });
    }
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { return sendJson(res, 400, { error: 'bad request' }); }
    const fail = (err) => {
      if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message || 'Lỗi máy chủ' });
    };

    if (p.startsWith('/api/')) {
      if (!trusted(req)) return sendJson(res, 403, { error: 'forbidden' });
      return api(req, res, url).catch(fail);
    }
    if (p.startsWith('/hook/')) {
      if (!allowedHosts().has(req.headers.host)) return sendJson(res, 403, { error: 'forbidden' });
      if (req.method !== 'GET' && req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return hook(req, res, url, p.slice('/hook/'.length)).catch(fail);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });

    if (p === '/' || p === '/panel') {
      res.writeHead(302, { Location: '/panel/' });
      return res.end();
    }
    if (p === '/panel/') return serveFile(res, PUBLIC_DIR, 'panel/index.html');
    if (p === '/caption' || p === '/caption/') return serveFile(res, PUBLIC_DIR, 'caption/index.html');
    if (p === '/overlay' || p === '/overlay/') return serveFile(res, PUBLIC_DIR, 'overlay/index.html');
    if (p.startsWith('/panel/') || p.startsWith('/overlay/') || p.startsWith('/remote/') || p.startsWith('/caption/')) return serveFile(res, PUBLIC_DIR, p.slice(1));
    if (p.startsWith('/media/')) return serveFile(res, store.mediaDir, p.slice('/media/'.length));
    if (p.startsWith('/thumb/')) return serveThumb(res, p.slice('/thumb/'.length));
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
        // Overlay báo một video / hình trong hàng đợi đã phát xong, để phát cái kế tiếp.
        ws.on('message', (data) => {
          if (data.length > 200) return;
          try {
            const msg = JSON.parse(data);
            if (msg && msg.type === 'done' && typeof msg.id === 'string') queue.done(msg.id);
          } catch { /* bỏ qua tin hỏng */ }
        });
      }
      if (client.role === 'panel') {
        ws.on('message', (data) => {
          if (data.length > 600) return;
          try {
            const msg = JSON.parse(data);
            if (msg && msg.type === 'audio') relayAudio(msg);
          } catch { /* bỏ qua tin hỏng */ }
        });
      }
      if (client.role === 'overlay') {
        ws.send(JSON.stringify(widgetsMsg()));
        ws.send(JSON.stringify(engine.goalState()));
        ws.send(JSON.stringify(jar.state()));
        ws.send(JSON.stringify(engine.topState()));
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

  await refreshQr();
  syncSepay();
  camera.sync().catch(() => {});
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
      sepay.stop();
      twitch.disconnect();
      await remote.close();
      await camera.close();
      await tiktok.disconnect().catch(() => {});
      for (const c of clients) c.ws.terminate();
      await new Promise((r) => server.close(r));
    },
  };
}
