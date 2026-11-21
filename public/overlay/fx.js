// Hệ hạt vẽ trên canvas cho các hiệu ứng toàn màn hình.
// Mọi kích thước tính theo đơn vị u (tỉ lệ với khung hình) nên chạy đúng ở cả
// 1080x1920 (dọc), 1920x1080 (ngang) lẫn khung xem thử nhỏ trong bảng điều khiển.

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[(Math.random() * list.length) | 0];

const PALETTE = {
  confetti: ['#ff4d5e', '#ffb020', '#2ed3a1', '#3aa0ff', '#b476ff', '#ffffff'],
  hearts: ['#ff4d6d', '#ff758f', '#ff8fa3', '#ff2e55'],
  stars: ['#ffd84d', '#fff3b0', '#ffffff', '#ffb020'],
  fireworks: ['#ff4d5e', '#ffb020', '#2ed3a1', '#3aa0ff', '#b476ff', '#ff7ad9', '#fff3b0'],
};

const MAX_PARTICLES = 1400;

function heartPath(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(0, s * 0.35);
  ctx.bezierCurveTo(-s * 1.1, -s * 0.35, -s * 0.5, -s * 1.05, 0, -s * 0.45);
  ctx.bezierCurveTo(s * 0.5, -s * 1.05, s * 1.1, -s * 0.35, 0, s * 0.35);
  ctx.closePath();
}

function starPath(ctx, s) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? s * 0.45 : s;
    const a = (i / 10) * TAU - Math.PI / 2;
    ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}

const DRAW = {
  rect(ctx, p) {
    ctx.rotate(p.rot);
    ctx.scale(1, Math.cos(p.flip));
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
  },
  heart(ctx, p) {
    ctx.rotate(p.rot);
    heartPath(ctx, p.size);
    ctx.fillStyle = p.color;
    ctx.fill();
  },
  star(ctx, p) {
    ctx.rotate(p.rot);
    starPath(ctx, p.size);
    ctx.fillStyle = p.color;
    ctx.fill();
  },
  coin(ctx, p) {
    const sx = Math.max(0.12, Math.abs(Math.cos(p.flip)));
    ctx.scale(sx, 1);
    ctx.beginPath();
    ctx.arc(0, 0, p.size, 0, TAU);
    ctx.fillStyle = '#f7b500';
    ctx.fill();
    ctx.lineWidth = p.size * 0.16;
    ctx.strokeStyle = '#c98500';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, p.size * 0.55, 0, TAU);
    ctx.fillStyle = '#ffd95a';
    ctx.fill();
  },
  dot(ctx, p) {
    ctx.beginPath();
    ctx.arc(0, 0, p.size, 0, TAU);
    ctx.fillStyle = p.color;
    ctx.fill();
  },
  spark(ctx, p) {
    // Tia pháo hoa: vệt ngắn theo hướng bay, sáng dần về đầu.
    const len = Math.hypot(p.vx, p.vy) * 0.045 + p.size;
    ctx.rotate(Math.atan2(p.vy, p.vx));
    ctx.fillStyle = p.color;
    ctx.fillRect(-len, -p.size / 2, len, p.size);
    ctx.beginPath();
    ctx.arc(0, 0, p.size * 0.9, 0, TAU);
    ctx.fill();
  },
  balloon(ctx, p) {
    const s = p.size;
    // Dây treo và món quà đung đưa bên dưới quả bóng.
    const swing = Math.sin(p.phase + p.life * 2.2) * 0.25;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.beginPath();
    ctx.moveTo(0, s * 1.15);
    ctx.quadraticCurveTo(s * swing, s * 1.9, s * swing * 1.6, s * 2.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.92, s * 1.12, 0, 0, TAU);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.16, s * 1.08); ctx.lineTo(s * 0.16, s * 1.08); ctx.lineTo(0, s * 1.3); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-s * 0.32, -s * 0.42, s * 0.2, s * 0.32, -0.5, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fill();
    ctx.save();
    ctx.translate(s * swing * 1.6, s * 3.1);
    DRAW.gift(ctx, { ...p, rot: swing, size: s * 0.72 });
    ctx.restore();
  },
  gift(ctx, p) {
    ctx.rotate(p.rot);
    const s = p.size;
    if (p.img && p.img.complete && p.img.naturalWidth) {
      ctx.drawImage(p.img, -s, -s, s * 2, s * 2);
      return;
    }
    // Hộp quà vẽ tay khi không có hình quà từ TikTok.
    ctx.fillStyle = p.color;
    ctx.fillRect(-s * 0.8, -s * 0.35, s * 1.6, s * 1.15);
    ctx.fillRect(-s * 0.92, -s * 0.7, s * 1.84, s * 0.4);
    ctx.fillStyle = '#fff3b0';
    ctx.fillRect(-s * 0.14, -s * 0.7, s * 0.28, s * 1.5);
    ctx.beginPath();
    ctx.ellipse(-s * 0.3, -s * 0.85, s * 0.3, s * 0.18, -0.5, 0, TAU);
    ctx.ellipse(s * 0.3, -s * 0.85, s * 0.3, s * 0.18, 0.5, 0, TAU);
    ctx.fill();
  },
};

export class Fx {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.emitters = [];
    this.running = false;
    this.last = 0;
    this.images = new Map();
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

  image(url) {
    if (!url) return null;
    if (!this.images.has(url)) {
      const im = new Image();
      im.src = url;
      this.images.set(url, im);
      if (this.images.size > 40) this.images.delete(this.images.keys().next().value);
    }
    return this.images.get(url);
  }

  add(p) {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({
      x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, rot: 0, vr: 0, flip: 0, vflip: 0,
      size: this.u, life: 0, max: 3, fadeIn: 0, fadeOut: 0.4, sway: 0, swayF: 0, phase: rand(0, TAU),
      kind: 'dot', color: '#fff', add: false, ...p,
    });
  }

  /** Bộ phát: gọi fn(dt) đều đặn `rate` lần mỗi giây trong `seconds` giây. */
  emitter(seconds, rate, fn) {
    this.emitters.push({ left: seconds, rate, acc: 0, fn });
  }

  play(effect, { intensity = 2, duration = 5, image = '' } = {}) {
    const k = [0.6, 1, 1.7][Math.min(3, Math.max(1, intensity)) - 1];
    const fn = this[`fx_${effect}`];
    if (!fn) return;
    fn.call(this, k, duration, image);
    this.start();
  }

  fx_confetti(k, d) {
    const { w, h, u } = this;
    const one = (x, y, vx, vy) => this.add({
      kind: 'rect', x, y, vx, vy, g: u * 55, drag: 0.9,
      size: rand(1.1, 2.1) * u, color: pick(PALETTE.confetti),
      rot: rand(0, TAU), vr: rand(-6, 6), flip: rand(0, TAU), vflip: rand(4, 12),
      sway: u * 14, swayF: rand(1.5, 3.5), max: rand(3.5, 5.5), fadeOut: 0.8,
    });
    // Hai khẩu pháo ở hai góc dưới bắn chéo lên.
    for (let i = 0; i < 70 * k; i++) {
      one(0, h, rand(0.15, 0.75) * w, -rand(0.75, 1.5) * h);
      one(w, h, -rand(0.15, 0.75) * w, -rand(0.75, 1.5) * h);
    }
    // Sau đó rơi đều từ trên xuống.
    this.emitter(Math.min(d, 6), 55 * k, () => one(rand(0, w), -u * 3, rand(-8, 8) * u, rand(10, 30) * u));
  }

  fx_fireworks(k, d) {
    const { w, h, u } = this;
    const burst = () => {
      const x = rand(0.15, 0.85) * w;
      const y = rand(0.12, 0.5) * h;
      const color = pick(PALETTE.fireworks);
      const second = pick(PALETTE.fireworks);
      const n = Math.round(rand(55, 85));
      const power = rand(26, 44) * u;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rand(-0.05, 0.05);
        const sp = power * rand(0.55, 1);
        this.add({
          kind: 'spark', add: true, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          g: u * 14, drag: 1.5, size: rand(0.28, 0.5) * u, color: i % 4 ? color : second,
          max: rand(1.1, 1.9), fadeOut: 0.9,
        });
      }
      // Chớp sáng ở tâm.
      this.add({ kind: 'dot', add: true, x, y, size: u * 5, color: '#ffffff', max: 0.18, fadeOut: 0.18 });
    };
    burst();
    this.emitter(d, 2.2 * k, burst);
  }

  fx_hearts(k, d) {
    const { w, h, u } = this;
    this.emitter(Math.min(d, 10), 14 * k, () => this.add({
      kind: 'heart', x: rand(0.04, 0.96) * w, y: h + u * 4, vy: -rand(16, 34) * u,
      size: rand(1.6, 4) * u, color: pick(PALETTE.hearts), rot: rand(-0.35, 0.35), vr: rand(-0.4, 0.4),
      sway: u * rand(5, 16), swayF: rand(1, 2.4), max: rand(3, 5), fadeIn: 0.25, fadeOut: 1.2,
    }));
  }

  fx_stars(k, d) {
    const { w, u } = this;
    this.emitter(Math.min(d, 10), 16 * k, () => this.add({
      kind: 'star', add: true, x: rand(-0.1, 1.05) * w, y: -u * 4, vx: rand(4, 14) * u, vy: rand(22, 46) * u,
      size: rand(0.9, 2.6) * u, color: pick(PALETTE.stars), rot: rand(0, TAU), vr: rand(-3, 3),
      max: rand(3, 5), fadeIn: 0.2, fadeOut: 0.8,
    }));
  }

  fx_coins(k, d) {
    const { w, u } = this;
    this.emitter(Math.min(d, 8), 18 * k, () => this.add({
      kind: 'coin', x: rand(0.02, 0.98) * w, y: -u * 4, vx: rand(-4, 4) * u, vy: rand(8, 24) * u,
      g: u * 70, size: rand(1.4, 2.5) * u, flip: rand(0, TAU), vflip: rand(5, 11),
      max: rand(3, 4.5), fadeOut: 0.5, bounce: 0.38,
    }));
  }

  fx_snow(k, d) {
    const { w, u } = this;
    this.emitter(d, 26 * k, () => this.add({
      kind: 'dot', x: rand(-0.05, 1.05) * w, y: -u * 2, vy: rand(7, 16) * u, vx: rand(-2, 2) * u,
      size: rand(0.25, 0.85) * u, color: 'rgba(255,255,255,0.92)',
      sway: u * rand(3, 9), swayF: rand(0.6, 1.6), max: rand(7, 11), fadeIn: 0.4, fadeOut: 1.5,
    }));
  }

  fx_balloons(k, d, image) {
    const { w, h, u } = this;
    const im = this.image(image);
    this.emitter(Math.min(d, 8), 5 * k, () => this.add({
      kind: 'balloon', img: im, x: rand(0.06, 0.94) * w, y: h + u * 6, vy: -rand(13, 22) * u,
      size: rand(2.4, 3.6) * u, color: pick(['#ff4d5e', '#3aa0ff', '#2ed3a1', '#b476ff', '#ffb020']),
      sway: u * rand(3, 9), swayF: rand(0.8, 1.6), max: rand(5, 7), fadeIn: 0.3, fadeOut: 1,
    }));
  }

  fx_giftrain(k, d, image) {
    const { w, u } = this;
    const im = this.image(image);
    this.emitter(Math.min(d, 8), 9 * k, () => this.add({
      kind: 'gift', img: im, x: rand(0.04, 0.96) * w, y: -u * 6, vx: rand(-3, 3) * u, vy: rand(12, 26) * u,
      g: u * 30, size: rand(2.6, 4.4) * u, color: pick(['#ff4d5e', '#3aa0ff', '#2ed3a1', '#b476ff']),
      rot: rand(-0.5, 0.5), vr: rand(-1.6, 1.6), max: rand(3.5, 5), fadeOut: 0.6,
    }));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  clear() {
    this.particles.length = 0;
    this.emitters.length = 0;
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  frame(t) {
    // OBS tạm dừng nguồn khi ẩn; kẹp dt để hạt không nhảy vọt khi hiện lại.
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const { ctx, h } = this;

    for (const e of this.emitters) {
      e.left -= dt;
      e.acc += e.rate * dt;
      while (e.acc >= 1) { e.acc -= 1; e.fn(); }
    }
    this.emitters = this.emitters.filter((e) => e.left > 0);

    ctx.clearRect(0, 0, this.w, this.h);
    let alive = 0;
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.max) continue;
      if (p.drag) {
        const f = Math.exp(-p.drag * dt);
        p.vx *= f;
        p.vy *= f;
      }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.flip += p.vflip * dt;
      if (p.bounce && p.y > h - p.size && p.vy > 0) {
        p.y = h - p.size;
        p.vy = -p.vy * p.bounce;
        p.bounce *= 0.5;
        if (Math.abs(p.vy) < this.u * 4) { p.bounce = 0; p.vy = 0; p.g = 0; p.vflip = 0; }
      }
      if (p.y > h + this.u * 12 && p.vy > 0) { p.life = p.max; continue; }

      let alpha = 1;
      if (p.fadeIn && p.life < p.fadeIn) alpha = p.life / p.fadeIn;
      const rest = p.max - p.life;
      if (rest < p.fadeOut) alpha *= rest / p.fadeOut;

      const sx = p.sway ? Math.sin(p.phase + p.life * p.swayF) * p.sway : 0;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = p.add ? 'lighter' : 'source-over';
      ctx.translate(p.x + sx, p.y);
      DRAW[p.kind](ctx, p);
      ctx.restore();
      alive++;
    }
    if (alive !== this.particles.length) this.particles = this.particles.filter((p) => p.life < p.max);

    if (this.particles.length || this.emitters.length) {
      requestAnimationFrame((tt) => this.frame(tt));
    } else {
      this.running = false;
      ctx.clearRect(0, 0, this.w, this.h);
    }
  }
}
