// Đấu giá bằng quà: trong thời gian đấu giá, tổng số xu mỗi người tặng là giá họ trả.
// Hết giờ, người trả cao nhất thắng. Quà đến ở những giây cuối sẽ kéo dài thêm giờ,
// để không ai thắng nhờ chờ sát giây cuối.

const EXTEND_WINDOW = 10; // giây

export class Auction {
  constructor({ getConfig, emit, onWin, now = () => Date.now() }) {
    this.getConfig = getConfig;
    this.emit = emit;
    this.onWin = onWin;
    this.now = now;
    this.running = false;
    this.item = '';
    this.endsAt = 0;
    this.bids = new Map();
    this.winner = null;
  }

  get cfg() {
    return this.getConfig().auction;
  }

  remaining() {
    return this.running ? Math.max(0, Math.ceil((this.endsAt - this.now()) / 1000)) : 0;
  }

  rows(n = 3) {
    return [...this.bids.values()].sort((a, b) => b.coins - a.coins || a.at - b.at).slice(0, n).map(({ name, avatar, coins }) => ({ name, avatar, coins }));
  }

  state() {
    return { type: 'auction', running: this.running, item: this.item, remaining: this.remaining(), rows: this.rows(), winner: this.winner, bidders: this.bids.size };
  }

  #arm() {
    clearTimeout(this.timer);
    if (!this.running) return;
    this.timer = setTimeout(() => this.finish(), Math.max(0, this.endsAt - this.now()));
    this.timer.unref?.();
  }

  start({ item, seconds } = {}) {
    clearTimeout(this.hideTimer);
    this.item = String(item || this.cfg.item || 'Món đấu giá').slice(0, 60);
    this.bids = new Map();
    this.winner = null;
    this.running = true;
    this.endsAt = this.now() + Math.min(3600, Math.max(10, Math.round(Number(seconds) || this.cfg.seconds))) * 1000;
    this.#arm();
    this.emit(this.state());
  }

  /** Kết thúc: công bố người thắng (nếu có ai trả giá). */
  finish() {
    if (!this.running) return;
    this.running = false;
    clearTimeout(this.timer);
    const top = this.rows(1)[0] || null;
    this.winner = top ? { name: top.name, coins: top.coins, avatar: top.avatar } : { name: '', coins: 0, avatar: '' };
    this.emit(this.state());
    if (top) this.onWin?.({ type: 'auction', nickname: top.name, avatar: top.avatar, coins: top.coins, giftName: this.item });
    // Giữ bảng kết quả trên sóng một lúc rồi ẩn.
    this.hideTimer = setTimeout(() => { this.winner = null; this.item = ''; this.emit(this.state()); }, 15000);
    this.hideTimer.unref?.();
  }

  /** Huỷ giữa chừng, không có người thắng. */
  cancel() {
    clearTimeout(this.timer);
    clearTimeout(this.hideTimer);
    this.running = false;
    this.winner = null;
    this.item = '';
    this.bids = new Map();
    this.emit(this.state());
  }

  onGift(ev) {
    if (!this.running || !(ev.coins > 0)) return;
    const key = ev.user || ev.nickname;
    if (!key) return;
    const row = this.bids.get(key) || { name: ev.nickname || ev.user, avatar: ev.avatar || '', coins: 0, at: 0 };
    row.coins += Math.round(ev.coins);
    row.at = this.now(); // hai người bằng giá: ai đạt mức đó trước thì đứng trên
    if (ev.avatar) row.avatar = ev.avatar;
    this.bids.set(key, row);
    if (this.cfg.extend && this.endsAt - this.now() < EXTEND_WINDOW * 1000) {
      this.endsAt = this.now() + EXTEND_WINDOW * 1000;
      this.#arm();
    }
    this.emit(this.state());
  }

  close() {
    clearTimeout(this.timer);
    clearTimeout(this.hideTimer);
  }
}
