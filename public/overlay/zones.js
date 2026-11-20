import { keyedCanvas } from '/overlay/key.js';

// Vùng ánh xạ: đặt clip vào đúng một phần của căn phòng (trần, tường sau, sàn) thay vì phủ kín
// màn hình. Mỗi góc máy có toạ độ vùng riêng; mép vùng được làm mờ dần để hoà vào hình live.

export class Zones {
  constructor(root) {
    this.root = document.createElement('div');
    this.root.id = 'zones';
    root.prepend(this.root);
    this.cfg = null;
    this.cam = 1;
    this.layers = new Map(); // id vùng -> { box, video, keyed }
  }

  setConfig(cfg) {
    if (!cfg) return;
    this.cfg = cfg;
    for (const id of this.layers.keys()) this.place(id);
  }

  /** Đổi góc máy: các clip đang phát chuyển sang toạ độ vùng của góc máy mới. */
  setCam(cam) {
    this.cam = cam === 2 ? 2 : 1;
    for (const id of this.layers.keys()) this.place(id);
  }

  rect(id, cam = this.cam) {
    return this.cfg?.[id]?.[cam] || null;
  }

  place(id, box = this.layers.get(id)?.box, cam = this.cam) {
    const r = this.rect(id, cam);
    if (!r || !box) return;
    Object.assign(box.style, { left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` });
    // Mép chạm cạnh khung hình thì giữ nét; mép nằm giữa khung thì mờ dần.
    const f = this.cfg[id].feather;
    const edge = (touch) => (touch ? 0 : f);
    const [l, t, rr, b] = [edge(r.x <= 0.5), edge(r.y <= 0.5), edge(r.x + r.w >= 99.5), edge(r.y + r.h >= 99.5)];
    const mask = `linear-gradient(to right, transparent 0, #000 ${l}%, #000 ${100 - rr}%, transparent 100%), linear-gradient(to bottom, transparent 0, #000 ${t}%, #000 ${100 - b}%, transparent 100%)`;
    box.style.maskImage = mask;
    box.style.webkitMaskImage = mask;
    box.style.maskComposite = 'intersect';
    box.style.webkitMaskComposite = 'source-in';
  }

  stop(id) {
    const layer = this.layers.get(id);
    if (!layer) return;
    this.layers.delete(id);
    layer.keyed?.stop();
    layer.video?.pause();
    layer.box.classList.add('out');
    setTimeout(() => layer.box.remove(), 500);
  }

  /** Phát một clip / hình vào vùng. `loop`: giữ cho tới khi có clip khác vào vùng đó hoặc bài diễn dừng. */
  play(id, file, key = 'none', loop = false) {
    if (!this.rect(id)) return;
    this.stop(id);
    const box = document.createElement('div');
    box.className = 'zone';
    const layer = { box, video: null, keyed: null };
    const src = `/media/${encodeURIComponent(file)}`;
    if (/\.(webm|mp4|mov)$/i.test(file)) {
      const v = document.createElement('video');
      v.muted = true; // clip ánh xạ là lớp hình; tiếng do bài nhạc lo
      v.loop = loop;
      v.playsInline = true;
      v.src = src;
      if (!loop) v.onended = () => { if (this.layers.get(id) === layer) this.stop(id); };
      v.onerror = () => { if (this.layers.get(id) === layer) this.stop(id); };
      layer.video = v;
      layer.keyed = key !== 'none' ? keyedCanvas(v, key) : null;
      box.append(layer.keyed || v);
      v.play().catch(() => {});
    } else {
      const im = document.createElement('img');
      im.alt = '';
      im.src = src;
      box.append(im);
      if (!loop) setTimeout(() => { if (this.layers.get(id) === layer) this.stop(id); }, 8000);
    }
    this.layers.set(id, layer);
    this.place(id);
    this.root.append(box);
  }

  clear() {
    for (const id of [...this.layers.keys()]) this.stop(id);
  }

  /** Hiện khung viền của các vùng trong vài giây, để căn chỉnh toạ độ cho một góc máy. */
  preview(cam) {
    if (!this.cfg) return;
    this.root.querySelectorAll('.zone-guide').forEach((n) => n.remove());
    const names = { ceiling: 'Trần', wall: 'Tường sau', floor: 'Sàn' };
    for (const id of Object.keys(names)) {
      const r = this.rect(id, cam);
      if (!r) continue;
      const g = document.createElement('div');
      g.className = 'zone-guide';
      g.textContent = `${names[id]} · camera ${cam}`;
      Object.assign(g.style, { left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` });
      this.root.append(g);
      setTimeout(() => g.remove(), 5000);
    }
  }
}
