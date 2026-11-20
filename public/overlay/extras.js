// Hiển thị đồng hồ đếm ngược, top thả tim và quà to nhất trên overlay.

const nf = new Intl.NumberFormat('vi-VN');
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const clock = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
};

export class Extras {
  constructor(root) {
    this.cfg = null;
    this.box = { timer: el('div', 'xw'), likes: el('div', 'xw'), best: el('div', 'xw'), queue: el('div', 'xw') };
    this.queue = [];
    for (const [k, node] of Object.entries(this.box)) { node.id = `x${k}`; node.hidden = true; root.append(node); }
    this.timer = { running: false, endsAt: 0, remaining: 0, title: '' };
    this.likes = { title: '', rows: [] };
    this.best = { title: '', best: null };
    setInterval(() => { if (this.timer.running) this.drawTimer(); }, 250);
  }

  setConfig(cfg) {
    if (!cfg) return;
    this.cfg = cfg;
    this.box.timer.dataset.pos = cfg.timer.position;
    this.box.likes.dataset.pos = cfg.topLikes.position;
    this.box.best.dataset.pos = cfg.bestGift.position;
    this.box.queue.dataset.pos = cfg.queueBoard.position;
    this.drawQueue();
    this.drawTimer();
    this.drawLikes();
    this.drawBest();
  }

  onTimer(msg) {
    // Máy chủ gửi số giây còn lại; overlay tự đếm tiếp từ lúc nhận.
    this.timer = { running: msg.running, remaining: msg.remaining, endsAt: Date.now() + msg.remaining * 1000, title: msg.title };
    this.added = msg.added > 0 ? { s: msg.added, until: Date.now() + 1800 } : this.added;
    this.drawTimer();
  }

  drawTimer() {
    const node = this.box.timer;
    node.hidden = !(this.cfg?.timer.enabled);
    if (node.hidden) return;
    const t = this.timer;
    const left = t.running ? Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000)) : t.remaining;
    const kids = [el('div', 'xt', t.title), el('div', `time${left === 0 ? ' zero' : ''}`, clock(left))];
    if (this.added && Date.now() < this.added.until) kids.push(el('div', 'add', `+${clock(this.added.s)}`));
    node.replaceChildren(...kids);
  }

  onLikes(msg) { this.likes = msg; this.drawLikes(); }

  drawLikes() {
    const node = this.box.likes;
    node.hidden = !(this.cfg?.topLikes.enabled && this.likes.rows.length);
    if (node.hidden) return;
    const list = el('ol', 'xrows');
    this.likes.rows.forEach((r, i) => {
      const li = el('li');
      li.append(el('span', 'rank', String(i + 1)));
      const a = httpUrl(r.avatar);
      if (a) { const im = el('img'); im.alt = ''; im.referrerPolicy = 'no-referrer'; im.src = a; im.onerror = () => im.remove(); li.append(im); }
      li.append(el('span', 'who', r.name || 'Ẩn danh'), el('span', 'num', nf.format(r.coins || 0)));
      list.append(li);
    });
    node.replaceChildren(el('div', 'xt', this.likes.title), list);
  }

  onQueue(msg) { this.queue = Array.isArray(msg.rows) ? msg.rows : []; this.drawQueue(); }

  drawQueue() {
    const node = this.box.queue;
    const cfg = this.cfg?.queueBoard;
    node.hidden = !(cfg?.enabled && this.queue.length);
    if (node.hidden) return;
    const list = el('ol', 'xrows');
    this.queue.slice(0, cfg.max).forEach((r, i) => {
      const li = el('li');
      li.append(el('span', 'rank', String(i + 1)), el('span', 'who', r.who ? `${r.who} · ${r.label}` : r.label));
      list.append(li);
    });
    node.replaceChildren(el('div', 'xt', cfg.title), list);
  }

  onBest(msg) { this.best = msg; this.drawBest(); }

  drawBest() {
    const node = this.box.best;
    const b = this.best.best;
    node.hidden = !(this.cfg?.bestGift.enabled && b);
    if (node.hidden) return;
    const row = el('div', 'best');
    const src = httpUrl(b.image);
    if (src) { const im = el('img'); im.alt = ''; im.referrerPolicy = 'no-referrer'; im.src = src; im.onerror = () => im.remove(); row.append(im); }
    const text = el('div', 'who');
    text.append(el('b', '', b.name), el('span', '', `${b.count > 1 ? `${b.count} × ` : ''}${b.gift} · ${nf.format(b.coins)} xu`));
    row.append(text);
    node.replaceChildren(el('div', 'xt', this.best.title), row);
  }
}
