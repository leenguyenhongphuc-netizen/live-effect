// Ba widget theo dõi buổi live: đồng hồ đếm ngược (quà cộng thêm giờ), top thả tim,
// và món quà to nhất. Máy chủ giữ số liệu; overlay chỉ hiển thị.

const MAX_ADD_PER_GIFT = 3600; // một lượt quà cộng tối đa 1 giờ

export class LiveExtras {
  /**
   * @param {object} deps
   * @param {() => object} deps.getConfig
   * @param {(msg: object) => void} deps.emit gửi trạng thái cho overlay và bảng điều khiển
   * @param {() => void} deps.onTimeUp gọi khi đồng hồ về 0
   */
  constructor({ getConfig, emit, onTimeUp, now = () => Date.now() }) {
    this.getConfig = getConfig;
    this.emit = emit;
    this.onTimeUp = onTimeUp;
    this.now = now;
    this.likers = new Map();
    this.best = null;
    this.running = false;
    this.endsAt = 0;
    this.left = null; // giây còn lại khi đang dừng; null = chưa bắt đầu
    this.likeTimer = null;
  }

  get cfg() {
    return this.getConfig().extras;
  }

  // --- Đồng hồ --------------------------------------------------------------
  remaining() {
    if (this.running) return Math.max(0, Math.ceil((this.endsAt - this.now()) / 1000));
    return this.left ?? this.cfg.timer.minutes * 60;
  }

  timerState(added = 0) {
    return { type: 'timer', running: this.running, remaining: this.remaining(), serverNow: this.now(), title: this.cfg.timer.title, added };
  }

  #arm() {
    clearTimeout(this.timeUp);
    if (!this.running) return;
    this.timeUp = setTimeout(() => {
      if (!this.running) return;
      this.running = false;
      this.left = 0;
      this.emit(this.timerState());
      this.onTimeUp?.();
    }, Math.max(0, this.endsAt - this.now()));
    this.timeUp.unref?.();
  }

  start() {
    if (this.running) return;
    const left = this.remaining() || this.cfg.timer.minutes * 60;
    this.endsAt = this.now() + left * 1000;
    this.running = true;
    this.#arm();
    this.emit(this.timerState());
  }

  pause() {
    if (!this.running) return;
    this.left = this.remaining();
    this.running = false;
    this.#arm();
    this.emit(this.timerState());
  }

  reset() {
    this.running = false;
    this.left = null;
    this.#arm();
    this.emit(this.timerState());
  }

  add(seconds) {
    const s = Math.round(Number(seconds) || 0);
    if (!s) return;
    if (this.running) { this.endsAt = Math.max(this.now(), this.endsAt + s * 1000); this.#arm(); }
    else this.left = Math.max(0, this.remaining() + s);
    this.emit(this.timerState(s));
  }

  // --- Top thả tim và quà to nhất --------------------------------------------
  likesState() {
    const rows = [...this.likers.values()].sort((a, b) => b.coins - a.coins).slice(0, this.cfg.topLikes.max);
    return { type: 'toplikes', title: this.cfg.topLikes.title, rows };
  }

  bestState() {
    return { type: 'bestgift', title: this.cfg.bestGift.title, best: this.best };
  }

  onEvent(ev) {
    if (ev.type === 'like') {
      const key = ev.user || ev.nickname;
      if (!key) return;
      // Dùng tên trường "coins" cho số tim để overlay vẽ chung một kiểu bảng xếp hạng.
      const row = this.likers.get(key) || { name: ev.nickname || ev.user, avatar: ev.avatar || '', coins: 0 };
      row.coins += ev.likeCount || 1;
      if (ev.avatar) row.avatar = ev.avatar;
      this.likers.set(key, row);
      // Tim đến dồn dập: gộp lại, mỗi giây cập nhật bảng một lần.
      if (!this.likeTimer) {
        this.likeTimer = setTimeout(() => { this.likeTimer = null; this.emit(this.likesState()); }, 1000);
        this.likeTimer.unref?.();
      }
    } else if (ev.type === 'gift' && ev.coins > 0) {
      if (!this.best || ev.coins > this.best.coins) {
        this.best = { name: ev.nickname || ev.user || 'Ẩn danh', gift: ev.giftName || 'quà', count: ev.count || 1, coins: ev.coins, image: ev.giftImage || '' };
        this.emit(this.bestState());
      }
      const per = this.cfg.timer.perCoin;
      if (this.cfg.timer.enabled && this.running && per > 0) this.add(Math.min(MAX_ADD_PER_GIFT, Math.round(ev.coins * per)));
    }
  }

  resetSession() {
    this.likers.clear();
    this.best = null;
    this.emit(this.likesState());
    this.emit(this.bestState());
  }

  close() {
    clearTimeout(this.timeUp);
    clearTimeout(this.likeTimer);
  }
}
