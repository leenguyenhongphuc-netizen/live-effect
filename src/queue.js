// Hàng đợi hiệu ứng. Hiệu ứng nhẹ (hạt, âm thanh, thông báo) chạy ngay và chồng lên nhau
// được; video / hình toàn màn hình thì mỗi lúc chỉ phát một cái, cái nào ưu tiên cao hơn
// được chen lên trước. Khi "Tạm dừng hiệu ứng", mọi thứ mới đến đều xếp hàng chờ.

const MAX_WAITING = 100;
const VIDEO = /\.(webm|mp4|mov)$/i;

export class EffectQueue {
  /**
   * @param {object} deps
   * @param {(msg: object) => void} deps.dispatch gửi một hiệu ứng lên sóng
   * @param {() => void} [deps.onChange] báo khi hàng đợi thay đổi
   * @param {number} [deps.videoTimeoutMs] chờ tối đa bao lâu cho một video (overlay không báo xong)
   */
  constructor({ dispatch, onChange, videoTimeoutMs = 125000 }) {
    this.dispatch = dispatch;
    this.onChange = onChange;
    this.videoTimeoutMs = videoTimeoutMs;
    this.paused = false;
    this.waiting = [];
    this.current = null;
    this.seq = 0;
    this.timer = null;
  }

  state() {
    const brief = (i) => ({ id: i.id, label: i.msg.label || '', who: i.msg.who || '', priority: i.priority, media: Boolean(i.msg.media) });
    return { paused: this.paused, current: this.current ? brief(this.current) : null, waiting: this.waiting.map(brief) };
  }

  push(msg) {
    const blocking = Boolean(msg.media);
    if (!this.paused && !blocking) { this.dispatch(msg); return; }
    const item = { id: `q${++this.seq}`, seq: this.seq, priority: Math.min(4, Math.max(1, Math.round(msg.priority) || 3)), msg };
    // Xếp theo ưu tiên (1 là cao nhất), cùng ưu tiên thì ai đến trước phát trước.
    const at = this.waiting.findIndex((w) => w.priority > item.priority);
    if (at === -1) this.waiting.push(item); else this.waiting.splice(at, 0, item);
    // Quá dài thì bỏ món cuối hàng (ưu tiên thấp nhất, đến sau cùng).
    if (this.waiting.length > MAX_WAITING) this.waiting.pop();
    this.#pump();
    this.onChange?.();
  }

  #pump() {
    if (this.paused) return;
    // Hiệu ứng nhẹ đang chờ (do vừa tạm dừng) được thả ra ngay, đúng thứ tự.
    for (let i = 0; i < this.waiting.length;) {
      if (!this.waiting[i].msg.media) { this.dispatch(this.waiting.splice(i, 1)[0].msg); } else i += 1;
    }
    if (this.current || !this.waiting.length) return;
    const item = this.waiting.shift();
    this.current = item;
    this.dispatch({ ...item.msg, id: item.id });
    const ms = VIDEO.test(item.msg.media) ? this.videoTimeoutMs : (Number(item.msg.duration) || 5) * 1000 + 1500;
    this.timer = setTimeout(() => this.done(item.id), ms);
  }

  /** Overlay báo đã phát xong (hoặc hết thời gian chờ). */
  done(id) {
    if (!this.current || this.current.id !== id) return false;
    clearTimeout(this.timer);
    this.current = null;
    this.#pump();
    this.onChange?.();
    return true;
  }

  setPaused(paused) {
    if (this.paused === Boolean(paused)) return;
    this.paused = Boolean(paused);
    this.#pump();
    this.onChange?.();
  }

  clear() {
    clearTimeout(this.timer);
    this.waiting = [];
    this.current = null;
    this.onChange?.();
  }
}
