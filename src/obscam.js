import crypto from 'node:crypto';
import WebSocket from 'ws';
import { readObsLocalConfig, OBS_INPUT_NAME } from './obs.js';

// Chuyển động camera qua OBS: zoom vào, kéo ra, rung, nghiêng, xoay, và giật nhẹ theo nhịp
// nhạc. Ứng dụng nối tới máy chủ WebSocket có sẵn của OBS (bản 28+) và đổi vị trí, tỉ lệ,
// góc xoay của nguồn camera trong cảnh đang phát, rồi luôn trả về đúng trạng thái ban đầu.
//
// Mọi phép biến đổi lấy TÂM KHUNG HÌNH làm gốc, nên camera phóng to hay xoay tại chỗ dù
// nguồn đang được căn theo góc nào:   P' = C + k·R(θ)·(P − C) + rung

const sha = (text) => crypto.createHash('sha256').update(text).digest('base64');
const CAMERA_KINDS = ['dshow_input', 'av_capture_input', 'av_capture_input_v2', 'v4l2_input', 'decklink-input'];
const GAIN = [0.6, 1, 1.5];
export const PUBLIC_MOVES = ['zoomin', 'zoomout', 'shake', 'tilt', 'spin'];
const TICK_MS = 33;
const easeOut = (x) => 1 - (1 - x) ** 3;
const easeInOut = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - ((-2 * x + 2) ** 3) / 2);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Các kiểu chuyển động: nhận tiến độ 0..1 và thời lượng (giây), trả về {k, deg, dx, dy}. */
export const MOVES = {
  zoomin(p, sec, g) {
    const tin = Math.min(0.35, sec * 0.4);
    const tout = Math.min(0.45, sec * 0.4);
    const t = p * sec;
    const amt = t < tin ? easeOut(t / tin) : t > sec - tout ? 1 - easeInOut((t - (sec - tout)) / tout) : 1;
    return { k: 1 + 0.35 * g * amt };
  },
  // Kéo ra: vào cận ngay lập tức rồi lùi dần về khung gốc (không thu nhỏ quá khung để lộ viền).
  zoomout(p, sec, g) {
    return { k: 1 + 0.4 * g * (1 - easeInOut(p)) };
  },
  shake(p, sec, g) {
    const amp = 0.014 * g * (1 - p);
    return { k: 1.05, dx: (Math.random() * 2 - 1) * amp, dy: (Math.random() * 2 - 1) * amp };
  },
  tilt(p, sec, g) {
    const env = Math.sin(Math.PI * p);
    return { k: 1 + 0.14 * env, deg: 3.5 * g * env * Math.sin(p * Math.PI * 4) };
  },
  spin(p, sec, g) {
    return { k: 1 + (0.5 + 0.15 * g) * Math.sin(Math.PI * p), deg: 360 * easeInOut(p) };
  },
  beatzoom(p, sec, g, s) {
    return { k: 1 + 0.055 * g * s * (1 - easeOut(p)) };
  },
  beatshake(p, sec, g, s) {
    const amp = 0.008 * g * s * (1 - p);
    return { k: 1.03, dx: (Math.random() * 2 - 1) * amp, dy: (Math.random() * 2 - 1) * amp };
  },
};

/** Tính transform mới của nguồn từ trạng thái gốc và phép biến đổi quanh tâm khung hình. */
export function transformAround(base, canvas, { k = 1, deg = 0, dx = 0, dy = 0 }) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const rad = (deg * Math.PI) / 180;
  const px = base.positionX - cx;
  const py = base.positionY - cy;
  const out = {
    positionX: cx + k * (px * Math.cos(rad) - py * Math.sin(rad)) + dx * canvas.width,
    positionY: cy + k * (px * Math.sin(rad) + py * Math.cos(rad)) + dy * canvas.width,
    rotation: (base.rotation || 0) + deg,
  };
  // Nguồn đặt theo "khung bao" thì OBS bỏ qua tỉ lệ, phải đổi kích thước khung bao.
  if (base.boundsType && base.boundsType !== 'OBS_BOUNDS_NONE') {
    out.boundsWidth = Math.max(1, base.boundsWidth * k);
    out.boundsHeight = Math.max(1, base.boundsHeight * k);
  } else {
    out.scaleX = base.scaleX * k;
    out.scaleY = base.scaleY * k;
  }
  return out;
}

export class ObsCamera {
  constructor({ getConfig, onStatus, readConfig = readObsLocalConfig, WebSocketImpl = WebSocket, port } = {}) {
    this.getConfig = getConfig;
    this.onStatus = onStatus;
    this.readConfig = readConfig;
    this.WebSocketImpl = WebSocketImpl;
    this.port = port;
    this.status = { state: 'off', error: '', source: '', sources: [], linked: false, scene: '', scenes: [] };
    this.sceneTimer = null;
    this.ws = null;
    this.ready = false;
    this.pending = new Map();
    this.seq = 0;
    this.anim = null;
    this.item = null; // { scene, id, base }
    this.canvas = { width: 1080, height: 1920 };
    this.wanted = false;
  }

  #set(patch) {
    this.status = { ...this.status, ...patch };
    this.onStatus?.(this.status);
  }

  get cfg() {
    return this.getConfig().camera;
  }

  /** Bật, tắt hoặc tìm lại nguồn camera theo cấu hình hiện tại. */
  async sync() {
    const want = this.cfg.enabled;
    if (want && !this.wanted) {
      this.wanted = true;
      this.#connect();
    } else if (!want && this.wanted) {
      await this.close();
    } else if (want && this.ready && this.cfg.source !== this.lastSource) {
      await this.#restore();
      await this.#locate().catch(() => {});
    }
  }

  #connect() {
    clearTimeout(this.retryTimer);
    const local = this.readConfig() || {};
    const password = local.password || '';
    this.#set({ state: 'connecting', error: '' });
    let ws;
    try {
      ws = new this.WebSocketImpl(`ws://127.0.0.1:${this.port || local.port || 4455}`);
    } catch {
      this.#offline();
      return;
    }
    this.ws = ws;
    ws.on('error', () => {});
    ws.on('close', (code) => {
      if (this.ws !== ws) return;
      this.ready = false;
      this.#stopAnim();
      this.item = null;
      this.status = { ...this.status, linked: false };
      if (code === 4009) {
        this.#set({ state: 'error', error: 'OBS đang đặt mật khẩu WebSocket mà Live Effect không đọc được. Trong OBS: Tools → WebSocket Server Settings, bỏ tích “Enable Authentication”.' });
      } else this.#offline();
    });
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (msg.op === 0) {
        const auth = msg.d?.authentication;
        const identify = { rpcVersion: 1, eventSubscriptions: 4 }; // 4 = sự kiện về cảnh
        if (auth) identify.authentication = sha(sha(password + auth.salt) + auth.challenge);
        ws.send(JSON.stringify({ op: 1, d: identify }));
      } else if (msg.op === 2) {
        this.ready = true;
        this.#locate().catch((err) => this.#set({ state: 'error', error: `OBS báo lỗi: ${err.message}` }));
      } else if (msg.op === 5) {
        // Đổi cảnh trong OBS: tìm lại camera của cảnh mới.
        if (msg.d?.eventType === 'CurrentProgramSceneChanged') { this.#stopAnim(); this.#locate().catch(() => {}); }
      } else if (msg.op === 7) {
        const p = this.pending.get(msg.d?.requestId);
        if (!p) return;
        this.pending.delete(msg.d.requestId);
        if (msg.d.requestStatus?.result) p.ok(msg.d.responseData || {});
        else p.bad(new Error(msg.d.requestStatus?.comment || `mã ${msg.d.requestStatus?.code}`));
      }
    });
  }

  #offline() {
    if (!this.wanted) return;
    this.#set({ state: 'error', error: 'Chưa nối được OBS. Mở OBS, vào Tools → WebSocket Server Settings, tích “Enable WebSocket server”. Ứng dụng tự thử lại.' });
    this.retryTimer = setTimeout(() => { if (this.wanted) this.#connect(); }, 5000);
  }

  #request(requestType, requestData) {
    return new Promise((ok, bad) => {
      const requestId = `cam-${++this.seq}`;
      this.pending.set(requestId, { ok, bad });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }

  /** Gửi không chờ trả lời: dùng cho các khung hình của chuyển động. */
  #send(requestType, requestData) {
    if (this.ready && this.ws?.readyState === 1) this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId: `f-${++this.seq}`, requestData } }));
  }

  async #locate() {
    const { currentProgramSceneName: scene } = await this.#request('GetCurrentProgramScene');
    // Danh sách cảnh để chọn trong kịch bản "đổi cảnh". OBS trả từ dưới lên, đảo lại cho đúng thứ tự nhìn thấy.
    const list = await this.#request('GetSceneList').catch(() => ({}));
    this.#set({ linked: true, scene, scenes: (list.scenes || []).map((x) => x.sceneName).filter(Boolean).reverse() });
    const video = await this.#request('GetVideoSettings');
    this.canvas = { width: video.baseWidth || 1080, height: video.baseHeight || 1920 };
    const { sceneItems = [] } = await this.#request('GetSceneItemList', { sceneName: scene });
    const usable = sceneItems.filter((i) => i.sourceName !== OBS_INPUT_NAME);
    const sources = usable.map((i) => i.sourceName);
    this.lastSource = this.cfg.source;
    const pick = (this.cfg.source && usable.find((i) => i.sourceName === this.cfg.source))
      || usable.find((i) => CAMERA_KINDS.includes(i.inputKind));
    if (!pick) {
      this.item = null;
      this.#set({ state: 'error', source: '', sources, error: sources.length
        ? 'Chưa biết nguồn nào là camera trong cảnh này. Hãy chọn nguồn camera ở ô bên dưới.'
        : 'Cảnh đang phát trong OBS chưa có nguồn nào.' });
      return;
    }
    this.item = { scene, id: pick.sceneItemId, base: pick.sceneItemTransform };
    this.#set({ state: 'ready', error: '', source: pick.sourceName, sources });
  }

  #apply(t) {
    if (!this.item) return;
    this.#send('SetSceneItemTransform', { sceneName: this.item.scene, sceneItemId: this.item.id, sceneItemTransform: t });
  }

  #stopAnim() {
    clearInterval(this.anim?.timer);
    this.anim = null;
  }

  async #restore() {
    this.#stopAnim();
    if (this.item) this.#apply(transformAround(this.item.base, this.canvas, {}));
  }

  #play(kind, seconds, strength, priority) {
    if (!this.ready || !this.item || !Object.hasOwn(MOVES, kind)) return false;
    // Chuyển động do nút bấm / quà được ưu tiên hơn cú giật theo nhịp.
    if (this.anim && this.anim.priority > priority) return false;
    this.#stopAnim();
    const g = GAIN[Math.min(3, Math.max(1, Math.round(this.cfg.amount))) - 1];
    const start = Date.now();
    const item = this.item;
    const step = () => {
      const p = clamp01((Date.now() - start) / (seconds * 1000));
      if (p >= 1 || this.item !== item) {
        this.#stopAnim();
        if (this.item === item) this.#apply(transformAround(item.base, this.canvas, {}));
        return;
      }
      this.#apply(transformAround(item.base, this.canvas, MOVES[kind](p, seconds, g, strength)));
    };
    this.anim = { priority, timer: setInterval(step, TICK_MS) };
    step();
    return true;
  }

  /**
   * Đổi sang một cảnh khác; nếu có `returnSec` thì tự quay về cảnh cũ sau từng đó giây.
   * @returns {Promise<boolean>}
   */
  async scene(name, returnSec = 0) {
    if (!this.ready || !name || !this.status.scenes.includes(name)) return false;
    // Đang ở giữa một lần đổi cảnh tạm: vẫn nhớ cảnh gốc ban đầu để quay về đúng chỗ.
    const home = this.sceneHome || this.status.scene;
    clearTimeout(this.sceneTimer);
    this.sceneHome = null;
    try { await this.#request('SetCurrentProgramScene', { sceneName: name }); } catch { return false; }
    if (returnSec > 0 && home && home !== name) {
      this.sceneHome = home;
      this.sceneTimer = setTimeout(() => {
        this.sceneHome = null;
        if (this.ready) this.#request('SetCurrentProgramScene', { sceneName: home }).catch(() => {});
      }, returnSec * 1000);
      this.sceneTimer.unref?.();
    }
    return true;
  }

  /**
   * Hiện, ẩn, hoặc hiện một lúc rồi ẩn một nguồn trong cảnh đang phát.
   * @param {'show' | 'hide' | 'flash'} mode
   */
  async source(name, mode = 'flash', seconds = 5) {
    if (!this.ready || !name) return false;
    const sceneName = this.status.scene;
    try {
      const { sceneItemId } = await this.#request('GetSceneItemId', { sceneName, sourceName: name });
      await this.#request('SetSceneItemEnabled', { sceneName, sceneItemId, sceneItemEnabled: mode !== 'hide' });
      if (mode === 'flash') {
        const t = setTimeout(() => {
          if (this.ready) this.#request('SetSceneItemEnabled', { sceneName, sceneItemId, sceneItemEnabled: false }).catch(() => {});
        }, Math.max(0.5, seconds) * 1000);
        t.unref?.();
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Chuyển động do kịch bản hoặc nút bấm gọi. */
  move(kind, { duration = 2 } = {}) {
    // Chỉ nhận đúng năm kiểu công khai; tên lạ (kể cả tên có sẵn của đối tượng JavaScript) bị từ chối.
    if (!PUBLIC_MOVES.includes(kind)) return false;
    const cap = { shake: 1.5, spin: 1.4, tilt: 3 }[kind] || 12;
    return this.#play(kind, Math.min(cap, Math.max(0.4, duration)), 1, 2);
  }

  /** Cú giật theo nhịp nhạc. */
  beat(strength) {
    const mode = this.cfg.beat;
    if (mode === 'off') return false;
    return this.#play(mode === 'shake' ? 'beatshake' : 'beatzoom', 0.2, Math.max(0.3, strength), 1);
  }

  async close() {
    this.wanted = false;
    clearTimeout(this.retryTimer);
    await this.#restore();
    this.ready = false;
    this.item = null;
    const ws = this.ws;
    this.ws = null;
    // Chờ lệnh trả camera về chỗ cũ được gửi đi rồi mới đóng.
    if (ws) await new Promise((r) => { setTimeout(() => { try { ws.close(); } catch { /* đã đóng */ } r(); }, 60); });
    clearTimeout(this.sceneTimer);
    this.sceneHome = null;
    this.#set({ state: 'off', error: '', source: '', sources: [], linked: false, scene: '', scenes: [] });
  }
}
