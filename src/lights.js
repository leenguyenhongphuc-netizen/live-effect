// Đèn phòng live. Ứng dụng chỉ quyết định "màu gì, sáng bao nhiêu"; việc nói chuyện với đèn
// do một trong hai cách kết nối lo:
//   - wled: bộ điều khiển LED chạy WLED trong mạng nội bộ (rất phổ biến với dây LED RGB),
//   - webhook: gọi một địa chỉ bất kỳ kèm màu và độ sáng, để nối Home Assistant hoặc cầu nối
//     của hãng đèn khác.

const MIN_GAP_MS = 180; // không gửi quá ~5 lệnh mỗi giây, đèn không theo kịp nhanh hơn
const BRIGHT = { calm: 70, normal: 150, peak: 255 };

export function parseColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
}

export class Lights {
  constructor({ getConfig, fetchImpl = fetch, onStatus, now = () => Date.now() }) {
    this.getConfig = getConfig;
    this.fetchImpl = fetchImpl;
    this.onStatus = onStatus;
    this.now = now;
    this.last = 0;
    this.busy = false;
    this.status = { ok: false, error: '' };
  }

  get cfg() {
    return this.getConfig().lights;
  }

  /** Lệnh gửi đi cho một màu và độ sáng, theo kiểu kết nối đang chọn. */
  request(rgb, bri) {
    const c = this.cfg;
    if (c.type === 'wled') {
      if (!/^[a-z0-9.-]{1,80}(:\d{1,5})?$/i.test(c.host)) return null;
      return { url: `http://${c.host}/json/state`, body: { on: true, bri, transition: 2, seg: [{ col: [rgb] }] } };
    }
    try {
      const u = new URL(c.url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return { url: c.url, body: { color: `#${rgb.map((x) => x.toString(16).padStart(2, '0')).join('')}`, r: rgb[0], g: rgb[1], b: rgb[2], brightness: bri } };
    } catch {
      return null;
    }
  }

  set(hex, bri, force = false) {
    if (!this.cfg.enabled) return false;
    const rgb = parseColor(hex) || parseColor(this.cfg.color) || [255, 255, 255];
    const req = this.request(rgb, Math.min(255, Math.max(1, Math.round(bri))));
    if (!req) { this.#done('Địa chỉ đèn chưa đúng.'); return false; }
    const now = this.now();
    if (!force && (this.busy || now - this.last < MIN_GAP_MS)) return false;
    this.last = now;
    this.busy = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    this.fetchImpl(req.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body), signal: ctrl.signal, redirect: 'error' })
      .then((res) => this.#done(res.ok ? '' : `Đèn trả về lỗi ${res.status}.`))
      .catch(() => this.#done('Không gọi được đèn. Kiểm tra địa chỉ và đèn có cùng mạng Wi-Fi không.'))
      .finally(() => { clearTimeout(timer); this.busy = false; });
    return true;
  }

  /** Không khí sân khấu đổi: đèn đổi theo tông màu và mức độ. */
  onMood(mood) {
    if (!this.cfg.followStage) return;
    this.set(mood.tint || this.cfg.color, mood.active ? BRIGHT[mood.level] || BRIGHT.normal : BRIGHT.normal, true);
    this.mood = mood;
  }

  /** Nhịp nhạc lúc cao trào: đèn nháy sáng rồi dịu lại. */
  onBeat() {
    if (!this.cfg.beat || this.mood?.level !== 'peak') return;
    if (this.set(this.mood.tint || this.cfg.color, 255)) setTimeout(() => this.set(this.mood?.tint || this.cfg.color, 150), 200).unref?.();
  }

  #done(error) {
    const next = { ok: !error, error };
    if (next.ok === this.status.ok && next.error === this.status.error) return;
    this.status = next;
    this.onStatus?.(next);
  }
}
