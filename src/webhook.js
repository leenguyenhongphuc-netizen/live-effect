// Webhook gửi ra ngoài: mỗi sự kiện của buổi live được gửi (POST, JSON) tới một địa chỉ do
// người dùng nhập, để nối với Discord, n8n, Make, Google Sheets… Gửi một chiều, không gửi lại
// khi lỗi, và không bao giờ làm chậm hiệu ứng trên sóng.

const TIMEOUT_MS = 4000;
const MAX_PENDING = 20;

export function validHookUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export class Webhook {
  constructor({ getConfig, fetchImpl = fetch, onStatus }) {
    this.getConfig = getConfig;
    this.fetchImpl = fetchImpl;
    this.onStatus = onStatus;
    this.pending = 0;
    this.status = { sent: 0, failed: 0, lastError: '' };
  }

  /** Chỉ gửi những trường cần thiết, không gửi nguyên dữ liệu nội bộ. */
  static payload(ev) {
    const pick = {};
    for (const k of ['type', 'user', 'nickname', 'text', 'giftId', 'giftName', 'count', 'coins', 'likeCount', 'amount', 'greeted']) {
      if (ev[k] !== undefined && ev[k] !== '') pick[k] = ev[k];
    }
    return { source: 'live-effect', at: new Date(ev.at || Date.now()).toISOString(), event: pick };
  }

  send(ev) {
    const cfg = this.getConfig().webhook;
    if (!cfg.enabled || !validHookUrl(cfg.url) || ev.simulated || !cfg.events.includes(ev.type)) return false;
    // Địa chỉ đích chậm hoặc chết: bỏ bớt thay vì dồn hàng trăm yêu cầu đang treo.
    if (this.pending >= MAX_PENDING) { this.#done('Địa chỉ nhận phản hồi quá chậm, đã bỏ qua một số sự kiện.'); return false; }
    this.pending += 1;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    this.fetchImpl(cfg.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Webhook.payload(ev)), signal: ctrl.signal, redirect: 'error',
    }).then((res) => this.#done(res.ok ? '' : `Địa chỉ nhận trả về lỗi ${res.status}.`))
      .catch((err) => this.#done(err.name === 'AbortError' ? 'Địa chỉ nhận không phản hồi trong 4 giây.' : 'Không gửi được tới địa chỉ nhận.'))
      .finally(() => { clearTimeout(timer); this.pending -= 1; });
    return true;
  }

  #done(error) {
    if (error) this.status = { ...this.status, failed: this.status.failed + 1, lastError: error };
    else this.status = { ...this.status, sent: this.status.sent + 1, lastError: '' };
    this.onStatus?.(this.status);
  }
}
