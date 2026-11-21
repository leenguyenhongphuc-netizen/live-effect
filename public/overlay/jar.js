// Hũ quà trên overlay: mỗi món quà là một viên tròn mang hình quà, rơi vào hũ và xếp chồng
// lên nhau bằng mô phỏng vật lý đơn giản (Verlet + đẩy các viên chồng lấn ra khỏi nhau).

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const MAX_BODIES = 130;
const nf = new Intl.NumberFormat('vi-VN');

export class JarView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cfg = { enabled: false, position: 'right', size: 2 };
    this.state = { coins: 0, target: 500, title: 'Hũ quà' };
    this.bodies = [];
    this.images = new Map();
    this.bursting = 0;
    this.still = 0;
    this.running = false;
    this.resize();
    window.addEventListener('resize', () => { this.resize(); this.wake(); });
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.u = Math.sqrt(this.w * this.h) / 100;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout();
  }

  /** Vị trí và kích thước hũ theo cấu hình; lòng hũ là hình chữ nhật mở phía trên. */
  layout() {
    const { u, w, h } = this;
    const W = [15, 19, 24][Math.min(3, Math.max(1, this.cfg.size || 2)) - 1] * u;
    const H = W * 1.22;
    const pos = this.cfg.position || 'right';
    const x = pos.includes('left') ? u * 3 : w - W - u * 3;
    const y = pos.startsWith('bottom') ? h - H - u * 9 : h * 0.56 - H / 2;
    const t = W * 0.045; // độ dày thành hũ
    const old = this.box;
    this.box = { x, y, W, H, t, left: x + t, right: x + W - t, floor: y + H - t, top: y + H * 0.13 };
    // Hũ đổi chỗ hoặc đổi cỡ: dời các món theo để không rơi ra ngoài.
    if (old && this.bodies.length) {
      const k = W / old.W;
      for (const b of this.bodies) {
        b.x = x + (b.x - old.x) * k; b.px = x + (b.px - old.x) * k;
        b.y = y + (b.y - old.y) * k; b.py = y + (b.py - old.y) * k;
        b.r *= k;
      }
    }
  }

  image(url) {
    if (!url) return null;
    if (!this.images.has(url)) {
      const im = new Image();
      im.referrerPolicy = 'no-referrer';
      im.onload = () => this.wake();
      im.src = url;
      this.images.set(url, im);
      if (this.images.size > 60) this.images.delete(this.images.keys().next().value);
    }
    return this.images.get(url);
  }

  setConfig(cfg) {
    if (!cfg) return;
    const was = this.cfg.enabled;
    this.cfg = cfg;
    this.layout();
    if (!cfg.enabled) { this.bodies.length = 0; this.ctx.clearRect(0, 0, this.w, this.h); }
    else if (!was) this.wake();
    else this.wake();
  }

  /** Bán kính một món theo giá trị quà: quà đắt thì to hơn (theo thang logarit). */
  radius(each) {
    const base = this.box.W / 19;
    return Math.min(2.5, 0.95 + 0.42 * Math.log10(1 + each)) * base;
  }

  spawn(drop, inside) {
    const { box } = this;
    const im = this.image(drop.image);
    for (let i = 0; i < drop.n; i++) {
      const r = this.radius(drop.each);
      const x = rand(box.left + r, box.right - r);
      // Món mới rơi từ trên miệng hũ; khi dựng lại hũ cũ thì đặt sẵn bên trong cho nhanh yên.
      const y = inside ? rand(box.top + r, box.floor - r) : box.y - r - i * r * 2.2 - rand(0, box.H * 0.3);
      this.bodies.push({ x, y, px: x - rand(-1, 1) * r * 0.05, py: y, r, rot: rand(0, TAU), im, each: drop.each, a: 1 });
    }
    if (this.bodies.length > MAX_BODIES) this.bodies.splice(0, this.bodies.length - MAX_BODIES);
    this.wake();
  }

  /** Nhận toàn bộ trạng thái từ máy chủ (lúc mới kết nối, sau khi đặt lại). */
  setState(msg) {
    this.state = { coins: msg.coins || 0, target: msg.target || 1, title: msg.title || '', rounds: msg.rounds || 0 };
    if (Array.isArray(msg.drops)) {
      this.bodies.length = 0;
      if (this.cfg.enabled) for (const d of msg.drops) this.spawn(d, true);
    }
    this.wake();
  }

  drop(msg) {
    this.state.coins = msg.coins ?? this.state.coins;
    if (this.cfg.enabled && msg.drop) this.spawn(msg.drop, false);
    this.wake();
  }

  /** Hũ đầy: các món bung ra khỏi hũ rồi tan dần. */
  burst(msg) {
    this.state.coins = 0;
    this.state.rounds = msg?.rounds ?? this.state.rounds;
    if (!this.cfg.enabled) return;
    const cx = this.box.x + this.box.W / 2;
    for (const b of this.bodies) {
      const dx = (b.x - cx) / this.box.W;
      b.px = b.x - (dx * 2.2 + rand(-0.35, 0.35)) * this.u * 1.6;
      b.py = b.y + rand(1.2, 2.6) * this.u; // hất lên
    }
    this.bursting = 1.6;
    this.wake();
  }

  wake() {
    this.still = 0;
    if (this.running || !this.cfg.enabled) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  step(dt) {
    const { box, bodies } = this;
    const g = this.u * 95 * dt * dt;
    const walls = this.bursting <= 0;
    let moved = 0;
    for (const b of bodies) {
      const vx = (b.x - b.px) * 0.985;
      const vy = (b.y - b.py) * 0.985;
      b.px = b.x; b.py = b.y;
      b.x += vx; b.y += vy + g;
      b.rot += vx / b.r;
      moved = Math.max(moved, Math.abs(vx) + Math.abs(vy));
    }
    for (let it = 0; it < 4; it++) {
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const min = a.r + b.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const push = (min - d) / d / 2;
          a.x -= dx * push; a.y -= dy * push;
          b.x += dx * push; b.y += dy * push;
        }
        if (!walls) continue;
        // Chỉ giữ trong thành hũ khi món đã lọt qua miệng hũ.
        if (a.y > box.top - a.r) {
          if (a.x < box.left + a.r) a.x = box.left + a.r;
          if (a.x > box.right - a.r) a.x = box.right - a.r;
        }
        if (a.y > box.floor - a.r) { a.y = box.floor - a.r; a.px = a.x - (a.x - a.px) * 0.6; }
      }
    }
    return moved;
  }

  drawJar() {
    const { ctx, box, u } = this;
    const { x, y, W, H } = box;
    const r = W * 0.16;
    ctx.save();
    // Thân hũ thuỷ tinh
    ctx.beginPath();
    ctx.moveTo(x + W * 0.1, y + H * 0.1);
    ctx.lineTo(x, y + H * 0.24);
    ctx.lineTo(x, y + H - r);
    ctx.quadraticCurveTo(x, y + H, x + r, y + H);
    ctx.lineTo(x + W - r, y + H);
    ctx.quadraticCurveTo(x + W, y + H, x + W, y + H - r);
    ctx.lineTo(x + W, y + H * 0.24);
    ctx.lineTo(x + W * 0.9, y + H * 0.1);
    ctx.closePath();
    ctx.fillStyle = 'rgba(190, 215, 255, 0.13)';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, u * 0.28);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.stroke();
    // Vành miệng hũ
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.roundRect(x + W * 0.06, y + H * 0.03, W * 0.88, H * 0.08, H * 0.03);
    ctx.fill();
    // Vệt sáng trên thân
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = Math.max(1, u * 0.35);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + W * 0.14, y + H * 0.32);
    ctx.lineTo(x + W * 0.14, y + H * 0.7);
    ctx.stroke();
    ctx.restore();
  }

  drawLabel() {
    const { ctx, box, u, state } = this;
    const cx = box.x + box.W / 2;
    const fs = Math.max(9, box.W * 0.105);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.font = `700 ${fs}px "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`;
    const lines = [state.title, `${nf.format(Math.min(state.coins, state.target))} / ${nf.format(state.target)} xu`];
    lines.forEach((text, i) => {
      const y = box.y + box.H + fs * (1.25 + i * 1.2);
      ctx.lineWidth = fs * 0.28;
      ctx.strokeStyle = 'rgba(20, 18, 26, 0.9)';
      ctx.strokeText(text, cx, y);
      ctx.fillStyle = i ? '#ffcf4a' : '#ffffff';
      ctx.fillText(text, cx, y);
    });
    // Thanh mức đầy ngay dưới chữ
    const bw = box.W * 0.9;
    const by = box.y + box.H + fs * 2.85;
    const k = Math.min(1, state.coins / state.target);
    ctx.fillStyle = 'rgba(20, 18, 26, 0.85)';
    ctx.beginPath(); ctx.roundRect(cx - bw / 2, by, bw, u * 0.9, u * 0.45); ctx.fill();
    if (k > 0) { ctx.fillStyle = '#ff4d5e'; ctx.beginPath(); ctx.roundRect(cx - bw / 2, by, Math.max(u * 0.9, bw * k), u * 0.9, u * 0.45); ctx.fill(); }
    ctx.restore();
  }

  frame(t) {
    const dt = Math.min(0.033, (t - this.last) / 1000) || 0.016;
    this.last = t;
    const { ctx } = this;
    const moved = this.step(dt);
    if (this.bursting > 0) {
      this.bursting -= dt;
      for (const b of this.bodies) b.a = Math.max(0, Math.min(1, this.bursting / 0.6));
      if (this.bursting <= 0) this.bodies.length = 0;
    }
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawJar();
    for (const b of this.bodies) {
      ctx.save();
      ctx.globalAlpha = b.a;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      if (b.im && b.im.complete && b.im.naturalWidth) ctx.drawImage(b.im, -b.r, -b.r, b.r * 2, b.r * 2);
      else {
        // Chưa có hình quà: vẽ một đồng xu.
        ctx.beginPath(); ctx.arc(0, 0, b.r, 0, TAU); ctx.fillStyle = '#f7b500'; ctx.fill();
        ctx.lineWidth = b.r * 0.16; ctx.strokeStyle = '#c98500'; ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, b.r * 0.55, 0, TAU); ctx.fillStyle = '#ffd95a'; ctx.fill();
      }
      ctx.restore();
    }
    this.drawLabel();
    // Mọi thứ đã nằm yên một lúc thì ngừng vẽ, đỡ tốn máy.
    this.still = moved < this.u * 0.004 && this.bursting <= 0 ? this.still + 1 : 0;
    if (this.cfg.enabled && this.still < 40) requestAnimationFrame((tt) => this.frame(tt));
    else this.running = false;
  }
}
