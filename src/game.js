// Trò chơi "Hộp bí ẩn": một dãy hộp đánh số, đúng một hộp có bẫy. Khán giả gõ số trong
// bình luận để mở hộp; ai mở trúng hộp bẫy thì thua và ván kết thúc.

const PICK = /^\s*(?:mở|mo|open)?\s*#?(\d{1,2})\s*$/i;
const USER_COOLDOWN_MS = 2500; // chặn một người mở dồn dập nhiều hộp

export class BoxGame {
  /**
   * @param {object} deps
   * @param {() => object} deps.getConfig
   * @param {(msg: object) => void} deps.emit
   * @param {(ev: object) => void} deps.onLose gọi khi có người mở trúng hộp bẫy
   * @param {(max: number) => number} [deps.random] chọn hộp bẫy (thay được khi kiểm thử)
   */
  constructor({ getConfig, emit, onLose, random = (max) => Math.floor(Math.random() * max), now = () => Date.now() }) {
    this.getConfig = getConfig;
    this.emit = emit;
    this.onLose = onLose;
    this.random = random;
    this.now = now;
    this.round = 0;
    this.lastPick = new Map();
    this.#deal();
  }

  get cfg() {
    return this.getConfig().game;
  }

  #deal() {
    this.round += 1;
    this.size = this.cfg.boxes;
    this.trap = this.random(this.size) + 1;
    this.opened = new Map(); // số hộp -> tên người mở
    this.loser = null;
    this.lastPick.clear();
  }

  /** Trạng thái gửi cho overlay và bảng điều khiển. Không lộ hộp bẫy khi ván chưa kết thúc. */
  state() {
    return {
      type: 'game', round: this.round, size: this.size, title: this.cfg.title,
      opened: [...this.opened].map(([n, name]) => ({ n, name })),
      loser: this.loser, trap: this.loser ? this.trap : 0,
    };
  }

  reset() {
    clearTimeout(this.nextTimer);
    this.#deal();
    this.emit(this.state());
  }

  /**
   * Mở một hộp.
   * @returns {'safe' | 'trap' | null} null nếu lượt không hợp lệ
   */
  pick(n, ev = {}) {
    if (!this.cfg.enabled || this.loser) return null;
    // Đổi số hộp trong cài đặt giữa ván: chia ván mới cho khớp.
    if (this.size !== this.cfg.boxes) this.#deal();
    const num = Math.round(Number(n));
    if (!(num >= 1 && num <= this.size) || this.opened.has(num)) return null;
    const key = ev.user || ev.nickname || '';
    const now = this.now();
    if (key && !ev.host && now - (this.lastPick.get(key) || 0) < USER_COOLDOWN_MS) return null;
    if (key) this.lastPick.set(key, now);
    const name = ev.nickname || ev.user || 'Chủ phòng';
    this.opened.set(num, name);
    if (num !== this.trap) {
      this.emit(this.state());
      return 'safe';
    }
    this.loser = { name, n: num, avatar: ev.avatar || '' };
    this.emit(this.state());
    this.onLose?.({ type: 'game', user: ev.user || '', nickname: name, avatar: ev.avatar || '', text: String(num) });
    // Tự chia ván mới sau một lúc, để trò chơi chạy liên tục mà không cần bấm.
    this.nextTimer = setTimeout(() => this.reset(), this.cfg.restart * 1000);
    this.nextTimer.unref?.();
    return 'trap';
  }

  /** Bình luận chỉ gồm một con số (hoặc "mở 7") được tính là một lượt mở hộp. */
  handleChat(ev) {
    if (!this.cfg.enabled) return null;
    const m = PICK.exec(String(ev.text || ''));
    return m ? this.pick(Number(m[1]), ev) : null;
  }

  close() {
    clearTimeout(this.nextTimer);
  }
}
