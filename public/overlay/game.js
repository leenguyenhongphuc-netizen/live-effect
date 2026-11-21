// Bàn chơi "Hộp bí ẩn" trên overlay: lưới hộp đánh số, hộp đã mở ghi tên người mở,
// hộp bẫy bung ra khi có người mở trúng.

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

export class GameView {
  constructor(root) {
    this.node = el('div', 'game');
    this.node.id = 'game';
    this.node.hidden = true;
    root.append(this.node);
    this.cfg = null;
    this.state = null;
  }

  setConfig(cfg) {
    if (!cfg) return;
    this.cfg = cfg;
    this.node.dataset.pos = cfg.position;
    this.draw();
  }

  setState(msg) {
    const hit = msg.loser && !(this.state?.loser);
    this.state = msg;
    this.draw();
    return hit; // true đúng lúc có người vừa mở trúng bẫy
  }

  draw() {
    const s = this.state;
    this.node.hidden = !(this.cfg?.enabled && s);
    if (this.node.hidden) return;
    const opened = new Map(s.opened.map((o) => [o.n, o.name]));
    const cols = s.size <= 8 ? 4 : s.size <= 15 ? 5 : 6;
    const grid = el('div', 'boxes');
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    for (let n = 1; n <= s.size; n++) {
      const trap = s.trap === n;
      const box = el('div', `box${opened.has(n) ? (trap ? ' trap' : ' open') : ''}`);
      box.append(el('b', '', String(n)));
      if (opened.has(n)) box.append(el('span', '', opened.get(n)));
      grid.append(box);
    }
    const head = el('div', 'gt', s.loser ? `${s.loser.name} mở trúng hộp ${s.loser.n}!` : s.title);
    const hint = el('div', 'gh', s.loser ? 'Ván mới sắp bắt đầu' : 'Gõ một con số trong bình luận để mở hộp');
    this.node.classList.toggle('over', Boolean(s.loser));
    this.node.replaceChildren(head, grid, hint);
  }
}
