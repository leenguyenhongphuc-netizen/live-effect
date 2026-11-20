// Lớp hiệu ứng chạy theo nhạc: viền đập theo âm trầm, chớp màu và sét theo nhịp,
// tàn lửa theo độ lớn, sóng nhạc 12 dải. Dữ liệu nhịp do bảng điều khiển gửi sang.

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

const PALETTES = {
  storm: { main: [[167, 139, 250]], bolt: [233, 213, 255], ember: [251, 146, 60] },
  fire: { main: [[251, 113, 133], [249, 115, 22]], bolt: [253, 230, 138], ember: [253, 186, 116] },
  ice: { main: [[56, 189, 248]], bolt: [224, 242, 254], ember: [165, 243, 252] },
  neon: { main: [[244, 114, 182], [34, 211, 238], [163, 230, 53], [250, 204, 21]], bolt: [255, 255, 255], ember: [244, 114, 182] },
};
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// An toàn cho người nhạy cảm với ánh sáng nhấp nháy: chớp toàn màn hình không quá
// 3 lần mỗi giây và độ sáng thấp (khuyến nghị WCAG 2.3.1).
const FLASH_MIN_GAP = 340;
const FLASH_MAX = 0.2;

export class Reactive {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cfg = { enabled: false, palette: 'storm', layers: {} };
    this.bass = 0;
    this.level = 0;
    this.bands = new Array(12).fill(0);
    this.shown = new Array(12).fill(0);
    this.flash = 0;
    this.lastFlash = 0;
    this.beats = 0;
    this.color = 0;
    this.bolts = [];
    this.embers = [];
    this.emberDebt = 0;
    this.lastMsg = 0;
    this.running = false;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.u = Math.sqrt(this.w * this.h) / 100;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setConfig(cfg) {
    if (!cfg) return;
    this.cfg = cfg;
    if (!cfg.enabled) this.clear();
  }

  clear() {
    this.bolts.length = 0;
    this.embers.length = 0;
    this.flash = 0;
    this.bass = 0;
    this.level = 0;
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  onAudio(msg) {
    if (!this.cfg.enabled) return;
    this.lastMsg = performance.now();
    this.targetBass = msg.b || 0;
    this.targetLevel = msg.l || 0;
    if (Array.isArray(msg.bands)) this.bands = msg.bands.slice(0, 12).map((x) => (Number(x) || 0) / 100);
    if (msg.beat) this.onBeat(Math.min(1, Math.max(0, msg.s || 0.5)));
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }
  }

  onBeat(strength) {
    const L = this.cfg.layers || {};
    const pal = PALETTES[this.cfg.palette] || PALETTES.storm;
    const now = performance.now();
    this.beats += 1;
    this.color = (this.color + 1) % pal.main.length;
    if (L.flash && now - this.lastFlash >= FLASH_MIN_GAP) {
      this.lastFlash = now;
      this.flash = Math.min(FLASH_MAX, 0.09 + 0.11 * strength);
    }
    // Sét đánh ở nhịp mạnh, hoặc cách một nhịp, để không rối mắt khi nhạc dồn dập.
    if (L.lightning && (strength > 0.55 || this.beats % 2 === 0)) {
      const n = strength > 0.8 ? 2 : 1;
      for (let i = 0; i < n; i++) this.bolts.push(this.makeBolt());
      if (this.bolts.length > 6) this.bolts.splice(0, this.bolts.length - 6);
    }
  }

  /** Một tia sét: đường gấp khúc từ mép trên đi xuống, có nhánh phụ. */
  makeBolt() {
    const { w, h, u } = this;
    const walk = (x, y, len, spread, steps) => {
      const pts = [[x, y]];
      let dir = rand(-0.5, 0.5);
      for (let i = 0; i < steps; i++) {
        dir = Math.max(-1.1, Math.min(1.1, dir + rand(-0.7, 0.7)));
        x += dir * spread;
        y += (len / steps) * rand(0.6, 1.4);
        pts.push([x, y]);
      }
      return pts;
    };
    const main = walk(rand(0.1, 0.9) * w, -u, rand(0.28, 0.55) * h, u * 3.2, 14);
    const branches = [];
    for (let i = 3; i < main.length - 3; i += 3) {
      if (Math.random() < 0.55) branches.push(walk(main[i][0], main[i][1], rand(0.08, 0.2) * h, u * 2.6, 6));
    }
    return { lines: [main, ...branches], born: performance.now(), life: rand(240, 360) };
  }

  frame(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const { ctx, w, h, u } = this;
    const L = this.cfg.layers || {};
    const pal = PALETTES[this.cfg.palette] || PALETTES.storm;
    const main = pal.main[this.color % pal.main.length];
    // Mất tín hiệu nhạc (dừng nghe, đóng bảng điều khiển): hiệu ứng lịm dần rồi tắt.
    const alive = t - this.lastMsg < 600;
    const tb = alive ? this.targetBass : 0;
    const tl = alive ? this.targetLevel : 0;
    this.bass += (tb - this.bass) * Math.min(1, dt * (tb > this.bass ? 28 : 7));
    this.level += (tl - this.level) * Math.min(1, dt * 6);

    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    if (L.pulse && this.bass > 0.02) {
      const depth = Math.min(w, h) * (0.1 + 0.16 * this.bass);
      const a = 0.12 + 0.5 * this.bass;
      for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [
        [0, 0, 0, depth, 0, 0, w, depth], [0, h, 0, h - depth, 0, h - depth, w, depth],
        [0, 0, depth, 0, 0, 0, depth, h], [w, 0, w - depth, 0, w - depth, 0, depth, h],
      ]) {
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, rgba(main, a));
        g.addColorStop(1, rgba(main, 0));
        ctx.fillStyle = g;
        ctx.fillRect(rx, ry, rw, rh);
      }
    }

    if (this.flash > 0.004) {
      ctx.fillStyle = rgba(main, this.flash);
      ctx.fillRect(0, 0, w, h);
      this.flash *= Math.exp(-dt * 9);
    } else this.flash = 0;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.bolts = this.bolts.filter((b) => t - b.born < b.life);
    for (const b of this.bolts) {
      const age = (t - b.born) / b.life;
      const a = (1 - age) * (age < 0.4 ? rand(0.55, 1) : 1); // nhấp nháy lúc mới đánh
      b.lines.forEach((pts, i) => {
        const width = (i ? 0.22 : 0.42) * u;
        ctx.beginPath();
        pts.forEach(([x, y], k) => ctx[k ? 'lineTo' : 'moveTo'](x, y));
        ctx.strokeStyle = rgba(main, 0.35 * a);
        ctx.lineWidth = width * 5;
        ctx.stroke();
        ctx.strokeStyle = rgba(pal.bolt, 0.95 * a);
        ctx.lineWidth = width;
        ctx.stroke();
      });
    }

    if (L.embers) {
      this.emberDebt += (alive ? 3 + 55 * this.level : 0) * dt;
      while (this.emberDebt >= 1 && this.embers.length < 260) {
        this.emberDebt -= 1;
        this.embers.push({ x: rand(0, w), y: h + u, vy: -rand(7, 20) * u, sway: rand(2, 7) * u, f: rand(0.8, 2.2), ph: rand(0, TAU), r: rand(0.14, 0.42) * u, age: 0, life: rand(2, 4.2) });
      }
      this.emberDebt = Math.min(this.emberDebt, 4);
      this.embers = this.embers.filter((e) => e.age < e.life);
      for (const e of this.embers) {
        e.age += dt;
        e.y += e.vy * dt * (0.7 + this.level);
        const k = e.age / e.life;
        const a = Math.min(1, e.age * 3) * (1 - k);
        const x = e.x + Math.sin(e.ph + e.age * e.f) * e.sway;
        ctx.fillStyle = rgba(pal.ember, 0.28 * a);
        ctx.beginPath(); ctx.arc(x, e.y, e.r * 3, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba(pal.ember, 0.95 * a);
        ctx.beginPath(); ctx.arc(x, e.y, e.r, 0, TAU); ctx.fill();
      }
    } else this.embers.length = 0;

    if (L.bars) {
      ctx.globalCompositeOperation = 'source-over';
      const total = Math.min(w * 0.8, u * 60);
      const bw = total / 12;
      const x0 = (w - total) / 2;
      let any = false;
      for (let i = 0; i < 12; i++) {
        const target = alive ? this.bands[i] : 0;
        this.shown[i] += (target - this.shown[i]) * Math.min(1, dt * (target > this.shown[i] ? 30 : 8));
        const bh = this.shown[i] * u * 14;
        if (bh < 0.5) continue;
        any = true;
        ctx.fillStyle = rgba(pal.main[i % pal.main.length], 0.9);
        ctx.fillRect(x0 + i * bw + bw * 0.14, h - u * 3 - bh, bw * 0.72, bh);
      }
      this.barsAlive = any;
    } else this.barsAlive = false;

    ctx.globalCompositeOperation = 'source-over';
    const busy = alive || this.bolts.length || this.embers.length || this.flash > 0 || this.bass > 0.02 || this.barsAlive;
    if (this.cfg.enabled && busy) requestAnimationFrame((tt) => this.frame(tt));
    else { this.running = false; ctx.clearRect(0, 0, w, h); }
  }
}
