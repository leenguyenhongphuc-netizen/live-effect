import { EventEmitter } from 'node:events';

// Ủng hộ bằng chuyển khoản ngân hàng:
//   - tạo mã VietQR ngay trên máy (số tài khoản không gửi đi đâu để vẽ mã),
//   - hỏi SePay vài giây một lần xem có tiền vào, rồi phát sự kiện "donate".
// SePay chỉ đọc biến động số dư; ứng dụng không giữ tiền và không thu phí.

// Mã BIN theo danh sách ngân hàng nhận chuyển khoản nhanh của NAPAS.
export const BANKS = [
  ['970436', 'Vietcombank'], ['970415', 'VietinBank'], ['970418', 'BIDV'], ['970405', 'Agribank'],
  ['970422', 'MB Bank'], ['970407', 'Techcombank'], ['970416', 'ACB'], ['970432', 'VPBank'],
  ['970423', 'TPBank'], ['970403', 'Sacombank'], ['970437', 'HDBank'], ['970441', 'VIB'],
  ['970443', 'SHB'], ['970431', 'Eximbank'], ['970426', 'MSB'], ['970448', 'OCB'],
  ['970440', 'SeABank'], ['970449', 'LPBank'], ['970428', 'Nam A Bank'], ['970429', 'SCB'],
  ['970425', 'ABBank'], ['970409', 'Bac A Bank'], ['970412', 'PVcomBank'], ['970454', 'BVBank (Viet Capital)'],
  ['970452', 'KienlongBank'], ['970438', 'BaoViet Bank'], ['970419', 'NCB'], ['970430', 'PGBank'],
  ['970427', 'VietABank'], ['970433', 'VietBank'], ['970400', 'SaigonBank'], ['970424', 'Shinhan Bank'],
  ['970457', 'Woori Bank'], ['422589', 'CIMB'], ['546034', 'CAKE'], ['963388', 'Timo'], ['546035', 'Ubank'],
].map(([bin, name]) => ({ bin, name }));

const tlv = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** CRC-16/CCITT-FALSE, đúng loại chuẩn EMVCo yêu cầu cho trường 63. */
export function crc16(text) {
  let crc = 0xffff;
  for (const byte of Buffer.from(text, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Nội dung chuyển khoản chỉ gồm chữ không dấu, số và khoảng trắng để mọi app ngân hàng đều nhận. */
export function plainMemo(text, max = 50) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Chuỗi VietQR (chuẩn EMVCo của NAPAS) cho chuyển khoản tới một số tài khoản. */
export function vietQrPayload({ bin, account, amount = 0, memo = '' }) {
  const acc = String(account || '').replace(/[^A-Za-z0-9]/g, '');
  if (!/^\d{6}$/.test(String(bin)) || !acc) return '';
  const beneficiary = tlv('00', String(bin)) + tlv('01', acc);
  const merchant = tlv('00', 'A000000727') + tlv('01', beneficiary) + tlv('02', 'QRIBFTTA');
  const clean = plainMemo(memo);
  let out = tlv('00', '01') + tlv('01', amount > 0 ? '12' : '11') + tlv('38', merchant) + tlv('53', '704');
  if (amount > 0) out += tlv('54', String(Math.round(amount)));
  out += tlv('58', 'VN');
  if (clean) out += tlv('62', tlv('08', clean));
  out += '6304';
  return out + crc16(out);
}

/**
 * Nội dung chuyển khoản sẽ hiện trên sóng, nên bỏ dãy số dài (số tài khoản, mã giao dịch)
 * và các mã kỹ thuật ngân hàng tự chèn vào.
 */
export function cleanMemo(content) {
  return String(content || '')
    .replace(/\bCT tu\b.*$/i, ' ') // đuôi "CT tu <số tài khoản> toi <số tài khoản>..." của một số ngân hàng
    .replace(/\b(MBVCB|IBFT|NAPAS|Trace|Ma giao dich|Ma GD)\b[.:]?/gi, ' ')
    .replace(/\b[A-Za-z]{0,4}\d{6,}[A-Za-z0-9]*\b/g, ' ')
    .replace(/\d[\d.-]{5,}/g, ' ')
    .replace(/[^\p{L}\p{N} .,!?'’:()-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,:-]+|[\s.,:-]+$/g, '')
    .slice(0, 90);
}

export const formatVnd = (n) => `${Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;

const SEPAY_LIST = 'https://my.sepay.vn/userapi/transactions/list';
const POLL_MS = 6000;
const OLD_MS = 10 * 60 * 1000;

/** SePay ghi giờ Việt Nam dạng "2023-05-05 19:59:48". Trả về mili giây, hoặc NaN nếu không đọc được. */
export function sepayTime(text) {
  const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(String(text || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5], +m[6]) : NaN;
}

export class SepaySource extends EventEmitter {
  constructor({ fetchImpl = globalThis.fetch, pollMs = POLL_MS, now = () => Date.now() } = {}) {
    super();
    this.fetch = fetchImpl;
    this.pollMs = pollMs;
    this.now = now;
    this.startedAt = now();
    this.status = { state: 'idle', error: '' };
    this.timer = null;
    this.lastId = null; // id giao dịch mới nhất đã thấy; null = chưa lấy mốc
    this.generation = 0;
  }

  #setStatus(patch) {
    const next = { ...this.status, ...patch };
    if (next.state === this.status.state && next.error === this.status.error) return;
    this.status = next;
    this.emit('status', this.status);
  }

  /** Bắt đầu theo dõi. Giao dịch có trước lúc bật không phát hiệu ứng. */
  start({ token, account = '' }) {
    this.stop();
    this.token = String(token || '').trim();
    this.account = String(account || '').replace(/[^A-Za-z0-9]/g, '');
    if (!this.token) return;
    this.startedAt = this.now();
    const gen = ++this.generation;
    this.#setStatus({ state: 'connecting', error: '' });
    const loop = async () => {
      if (gen !== this.generation) return;
      const wait = await this.poll();
      if (gen !== this.generation) return;
      this.timer = setTimeout(loop, wait);
    };
    loop();
  }

  stop() {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = null;
    this.lastId = null;
    this.#setStatus({ state: 'idle', error: '' });
  }

  /** Hỏi SePay một lần; trả về số mili giây nên chờ trước lần sau. */
  async poll() {
    const url = new URL(SEPAY_LIST);
    if (this.account) url.searchParams.set('account_number', this.account);
    if (this.lastId === null) url.searchParams.set('limit', '1');
    else {
      url.searchParams.set('since_id', String(this.lastId + 1));
      url.searchParams.set('limit', '20');
    }
    let res;
    try {
      res = await this.fetch(url, { headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' } });
    } catch {
      this.#setStatus({ state: 'error', error: 'Không gọi được SePay. Kiểm tra kết nối Internet.' });
      return this.pollMs * 3;
    }
    if (res.status === 401 || res.status === 403) {
      this.#setStatus({ state: 'error', error: 'SePay từ chối API Token này. Kiểm tra lại token trong SePay → Cấu hình công ty → API Access.' });
      return this.pollMs * 10;
    }
    if (res.status === 429) {
      const retry = Number(res.headers?.get?.('x-sepay-userapi-retry-after')) || 2;
      return Math.max(this.pollMs, retry * 1000);
    }
    let data;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok || !data || !Array.isArray(data.transactions)) {
      this.#setStatus({ state: 'error', error: `SePay trả về lỗi ${res.status}. Sẽ thử lại.` });
      return this.pollMs * 3;
    }
    const rows = data.transactions
      .map((t) => ({ ...t, idNum: Number(t.id) }))
      .filter((t) => Number.isFinite(t.idNum))
      .sort((a, b) => a.idNum - b.idNum);
    if (this.lastId === null) {
      this.lastId = rows.length ? rows[rows.length - 1].idNum : 0;
    } else {
      for (const t of rows) {
        if (t.idNum <= this.lastId) continue;
        this.lastId = t.idNum;
        const amount = Math.round(Number(t.amount_in) || 0);
        if (amount <= 0) continue; // tiền ra không phải ủng hộ
        // Lớp chặn thứ hai: giao dịch ghi giờ cũ hơn hẳn lúc bật thì không phát hiệu ứng.
        const at = sepayTime(t.transaction_date);
        if (Number.isFinite(at) && at < this.startedAt - OLD_MS) continue;
        this.emit('event', { type: 'donate', user: '', nickname: '', amount, text: cleanMemo(t.transaction_content), source: 'bank' });
      }
    }
    this.#setStatus({ state: 'connected', error: '' });
    return this.pollMs;
  }
}
