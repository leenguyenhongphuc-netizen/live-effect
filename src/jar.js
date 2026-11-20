// Hũ quà: trạng thái phía máy chủ. Mỗi quà nhận được rơi vào hũ; đủ số xu đặt ra thì hũ đầy,
// vỡ ra ăn mừng rồi bắt đầu lại. Máy chủ giữ con số và danh sách món đã rơi, để overlay nào
// mở sau (hoặc OBS tải lại) cũng dựng lại đúng cái hũ đang có.

const MAX_PIECES = 130; // số món hiển thị tối đa trong hũ

export class Jar {
  constructor(getConfig) {
    this.getConfig = getConfig;
    this.coins = 0;
    this.drops = []; // { image, each, n }
    this.rounds = 0; // số lần hũ đã đầy trong phiên
  }

  get cfg() {
    return this.getConfig().jar;
  }

  state() {
    const { target, title } = this.cfg;
    return { type: 'jar', coins: this.coins, target, title, rounds: this.rounds, drops: this.drops };
  }

  /**
   * Thêm một lượt quà. Trả về món vừa rơi và hũ đã đầy hay chưa.
   * @returns {{ drop: object, full: boolean } | null}
   */
  add({ coins = 0, count = 1, image = '' }) {
    if (!this.cfg.enabled || coins <= 0) return null;
    const n = Math.min(10, Math.max(1, Math.round(count)));
    const drop = { image: typeof image === 'string' && /^https?:\/\//i.test(image) ? image : '', each: Math.max(1, Math.round(coins / Math.max(1, count))), n };
    this.coins += Math.round(coins);
    this.drops.push(drop);
    let pieces = this.drops.reduce((s, d) => s + d.n, 0);
    while (pieces > MAX_PIECES && this.drops.length > 1) pieces -= this.drops.shift().n;
    const full = this.coins >= this.cfg.target;
    if (full) {
      this.rounds += 1;
      this.coins = 0;
      this.drops = [];
    }
    return { drop, full };
  }

  reset() {
    this.coins = 0;
    this.drops = [];
    this.rounds = 0;
  }
}
