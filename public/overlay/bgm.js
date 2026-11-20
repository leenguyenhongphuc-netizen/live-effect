import { keyedCanvas } from '/overlay/key.js';

// Hai lớp luôn chạy nền trên overlay:
//   - Cảnh vật trước ống kính: một video / hình lặp vô tận phủ lên hình live (lá rơi, tuyết, khung viền…).
//   - Nhạc nền: phát lần lượt các bài trong danh sách, tự nhỏ tiếng hoặc tạm dừng khi có video hiệu ứng,
//     kèm thẻ "đang phát".

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const title = (file) => String(file || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
const DUCK_LEVEL = 0.25;

export class Scenery {
  constructor(root) {
    this.node = el('div');
    this.node.id = 'scenery';
    root.prepend(this.node);
    this.sig = '';
  }

  setConfig(cfg) {
    if (!cfg) return;
    const sig = cfg.enabled && cfg.media ? `${cfg.media}|${cfg.key}` : '';
    this.node.style.opacity = String(cfg.opacity ?? 1);
    if (sig === this.sig) return;
    this.sig = sig;
    this.canvas?.stop?.();
    this.node.replaceChildren();
    if (!sig) return;
    const src = `/media/${encodeURIComponent(cfg.media)}`;
    if (/\.(webm|mp4|mov)$/i.test(cfg.media)) {
      const v = el('video');
      v.muted = true; // chỉ là lớp hình, không bao giờ phát tiếng
      v.loop = true;
      v.playsInline = true;
      v.src = src;
      this.canvas = cfg.key !== 'none' ? keyedCanvas(v, cfg.key) : null;
      this.node.append(this.canvas || v);
      v.play().catch(() => {});
    } else {
      const im = el('img');
      im.alt = '';
      im.src = src;
      this.node.append(im);
    }
  }
}

export class Bgm {
  /** @param {boolean} silent khung xem thử: chỉ hiện thẻ, không phát tiếng */
  constructor(root, silent) {
    this.silent = silent;
    this.cfg = null;
    this.index = 0;
    this.paused = false;
    this.ducked = false;
    this.audio = new Audio();
    this.audio.addEventListener('ended', () => this.next());
    this.audio.addEventListener('error', () => { if (this.cfg?.tracks.length > 1) this.next(); });
    this.card = el('div', 'xw');
    this.card.id = 'xbgm';
    this.card.hidden = true;
    root.append(this.card);
  }

  get tracks() {
    return this.cfg?.enabled ? this.cfg.tracks : [];
  }

  setConfig(cfg) {
    if (!cfg) return;
    const was = JSON.stringify(this.tracks);
    this.cfg = cfg;
    this.card.dataset.pos = cfg.position;
    if (JSON.stringify(this.tracks) !== was) {
      this.index = Math.min(this.index, Math.max(0, this.tracks.length - 1));
      this.load();
    }
    this.applyVolume();
    this.draw();
  }

  load() {
    const file = this.tracks[this.index];
    if (!file) { this.audio.pause(); this.audio.removeAttribute('src'); this.draw(); return; }
    if (!this.silent) {
      this.audio.src = `/media/${encodeURIComponent(file)}`;
      if (!this.paused && !(this.ducked && this.cfg.duck === 'pause')) this.audio.play().catch(() => {});
    }
    this.draw();
  }

  next() {
    if (!this.tracks.length) return;
    this.index = this.cfg.shuffle && this.tracks.length > 2
      ? (this.index + 1 + Math.floor(Math.random() * (this.tracks.length - 1))) % this.tracks.length
      : (this.index + 1) % this.tracks.length;
    this.load();
  }

  applyVolume() {
    if (!this.cfg) return;
    const base = this.cfg.volume;
    this.audio.volume = Math.min(1, Math.max(0, this.ducked && this.cfg.duck === 'lower' ? base * DUCK_LEVEL : base));
  }

  /** Có video hiệu ứng đang phát: nhỏ tiếng hoặc tạm dừng nhạc nền theo cài đặt. */
  duck(on) {
    if (this.ducked === on || !this.cfg) return;
    this.ducked = on;
    if (this.cfg.duck === 'pause' && !this.silent && this.tracks.length) {
      if (on) this.audio.pause(); else if (!this.paused) this.audio.play().catch(() => {});
    }
    this.applyVolume();
  }

  cmd(msg) {
    if (!this.tracks.length) return;
    if (msg.cmd === 'next') this.next();
    else if (msg.cmd === 'pause') { this.paused = true; this.audio.pause(); }
    else if (msg.cmd === 'play') {
      this.paused = false;
      if (Number.isInteger(msg.index) && this.tracks[msg.index]) { this.index = msg.index; this.load(); }
      else if (!this.silent) this.audio.play().catch(() => {});
    }
    this.draw();
  }

  draw() {
    const file = this.tracks[this.index];
    this.card.hidden = !(this.cfg?.enabled && this.cfg.showCard && file);
    if (this.card.hidden) return;
    const disc = el('span', `disc${this.paused ? ' still' : ''}`);
    const text = el('div', 'who');
    text.append(el('span', 'xt', this.paused ? 'Tạm dừng' : 'Đang phát'), el('b', '', title(file)));
    const row = el('div', 'np');
    row.append(disc, text);
    this.card.replaceChildren(row);
  }
}
