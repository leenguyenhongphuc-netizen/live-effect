import { EventEmitter } from 'node:events';

// Kết nối tới phiên TikTok LIVE qua thư viện tiktok-live-connector (không chính thức)
// và chuẩn hoá sự kiện về một dạng chung cho bộ máy kịch bản.
//
// Thư viện đổi tên trường giữa các phiên bản giao thức, nên mọi trường đều đọc qua
// nhiều tên có thể có thay vì tin một tên duy nhất.

const first = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');
const img = (m) => (m ? first(m.urlList?.[0], m.url?.[0], m.mUrls?.[0], m.urls?.[0], m.giftPictureUrl) : undefined);

export function normalizeUser(u = {}) {
  return {
    user: first(u.uniqueId, u.displayId, u.userId, u.id) || '',
    nickname: first(u.nickname, u.uniqueId, u.displayId) || '',
    avatar: first(img(u.avatarThumb), img(u.profilePicture), img(u.avatarMedium)) || '',
  };
}

/** Trả về sự kiện quà đã chuẩn hoá, hoặc null nếu chuỗi quà chưa kết thúc. */
export function normalizeGift(data = {}) {
  const g = first(data.gift, data.giftDetails, data.extendedGiftInfo) || {};
  const ext = data.extendedGiftInfo || {};
  const giftType = Number(first(g.type, g.giftType, ext.type, 0));
  // Quà dạng chuỗi (type 1) bắn nhiều sự kiện khi đang bấm liên tục;
  // chỉ lấy sự kiện kết thúc chuỗi để đếm đúng số lượng.
  if (giftType === 1 && !data.repeatEnd) return null;
  const count = Number(first(data.repeatCount, data.comboCount, 1)) || 1;
  const diamonds = Number(first(g.diamondCount, ext.diamond_count, ext.diamondCount, 0)) || 0;
  return {
    type: 'gift',
    ...normalizeUser(data.user),
    giftName: first(g.name, g.giftName, ext.name, `Quà #${data.giftId || '?'}`),
    giftImage: first(img(g.image), img(g.icon), img(g.giftImage), img(ext.image), img(ext.icon)) || '',
    count,
    coins: diamonds * count,
  };
}

export function friendlyError(err) {
  const name = err?.name || err?.constructor?.name || '';
  const msg = String(err?.message || err || '');
  if (/offline|not.*live|isn't online|LIVE has ended/i.test(name + msg)) {
    return 'Kênh này chưa bật LIVE. Hãy bắt đầu phiên live trước rồi bấm Kết nối lại.';
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|socket|fetch failed/i.test(name + msg)) {
    return 'Không có mạng hoặc TikTok không phản hồi. Kiểm tra kết nối Internet rồi thử lại.';
  }
  // Thư viện báo cùng một lỗi cho "sai ID" và "không vào được TikTok", nên nói rõ cả hai khả năng.
  if (/Failed to retrieve room/i.test(name + msg)) {
    return 'Không lấy được phòng live của kênh này. Kiểm tra lại ID TikTok (phần sau dấu @) và kết nối Internet.';
  }
  if (/\bnot found\b|user.*exist/i.test(name + msg)) {
    return 'Không tìm thấy kênh này. Kiểm tra lại ID TikTok (phần sau dấu @).';
  }
  if (/rate.?limit|429|too many/i.test(name + msg)) {
    return 'Máy chủ ký kết nối đang giới hạn lượt dùng miễn phí. Chờ vài phút rồi thử lại, hoặc nhập khoá Euler Stream ở mục Nâng cao.';
  }
  return `Không kết nối được: ${msg.slice(0, 160) || name || 'lỗi không rõ'}`;
}

const RETRY_DELAYS = [3000, 8000, 15000, 30000, 60000];

export class TikTokSource extends EventEmitter {
  constructor() {
    super();
    this.conn = null;
    this.username = '';
    this.status = { state: 'idle', username: '', error: '', viewers: 0 };
    this.wanted = false; // người dùng đang muốn giữ kết nối
    this.retry = 0;
    this.retryTimer = null;
    this.generation = 0; // loại bỏ sự kiện của kết nối cũ
  }

  #setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.status);
  }

  async connect(username, { signApiKey } = {}) {
    await this.disconnect();
    this.username = String(username || '').trim().replace(/^@/, '');
    if (!this.username) {
      this.#setStatus({ state: 'error', error: 'Hãy nhập ID TikTok của kênh.' });
      return;
    }
    this.signApiKey = signApiKey || '';
    this.wanted = true;
    this.retry = 0;
    await this.#open();
  }

  async #open() {
    const gen = ++this.generation;
    this.#setStatus({ state: 'connecting', username: this.username, error: '' });
    let lib;
    try {
      lib = await import('tiktok-live-connector');
    } catch (err) {
      this.wanted = false;
      this.#setStatus({ state: 'error', error: `Thiếu thư viện kết nối TikTok: ${err.message}` });
      return;
    }
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = lib;
    const opts = { enableExtendedGiftInfo: true, processInitialData: false };
    if (this.signApiKey) opts.signApiKey = this.signApiKey;

    let conn;
    try {
      conn = new TikTokLiveConnection(this.username, opts);
    } catch (err) {
      this.wanted = false;
      this.#setStatus({ state: 'error', error: friendlyError(err) });
      return;
    }
    this.conn = conn;
    const live = () => gen === this.generation;
    const push = (ev) => { if (live()) this.emit('event', ev); };

    conn.on(WebcastEvent.CHAT, (d) => push({ type: 'chat', ...normalizeUser(d.user), text: first(d.comment, d.content) || '' }));
    conn.on(WebcastEvent.GIFT, (d) => { const ev = normalizeGift(d); if (ev) push(ev); });
    conn.on(WebcastEvent.LIKE, (d) => push({
      type: 'like',
      ...normalizeUser(d.user),
      likeCount: Number(first(d.likeCount, d.count, 1)) || 1,
      totalLikes: Number(first(d.totalLikeCount, d.total, 0)) || 0,
    }));
    conn.on(WebcastEvent.FOLLOW, (d) => push({ type: 'follow', ...normalizeUser(d.user) }));
    conn.on(WebcastEvent.SHARE, (d) => push({ type: 'share', ...normalizeUser(d.user) }));
    conn.on(WebcastEvent.MEMBER, (d) => push({ type: 'join', ...normalizeUser(d.user) }));
    conn.on(WebcastEvent.ROOM_USER, (d) => {
      if (live() && typeof d.viewerCount === 'number') this.#setStatus({ viewers: d.viewerCount });
    });
    conn.on(WebcastEvent.STREAM_END, () => {
      if (!live()) return;
      this.wanted = false;
      this.#setStatus({ state: 'idle', error: 'Phiên live đã kết thúc.', viewers: 0 });
    });
    conn.on(ControlEvent.ERROR, () => { /* lỗi lẻ khi giải mã tin nhắn: bỏ qua, kết nối vẫn sống */ });
    conn.on(ControlEvent.DISCONNECTED, () => {
      if (!live() || !this.wanted) return;
      this.#scheduleRetry('Mất kết nối, đang thử nối lại…');
    });

    try {
      await conn.connect();
      if (!live()) return;
      this.retry = 0;
      this.#setStatus({ state: 'connected', error: '' });
    } catch (err) {
      if (!live()) return;
      const message = friendlyError(err);
      // Kênh chưa live hoặc sai ID thì thử lại cũng vô ích: dừng và báo rõ.
      const permanent = /chưa bật LIVE|Không tìm thấy kênh|Không lấy được phòng live/.test(message);
      if (permanent || this.retry >= RETRY_DELAYS.length) {
        this.wanted = false;
        this.#setStatus({ state: 'error', error: message });
      } else {
        this.#scheduleRetry(message);
      }
    }
  }

  #scheduleRetry(message) {
    if (this.retry >= RETRY_DELAYS.length) {
      this.wanted = false;
      this.#setStatus({ state: 'error', error: 'Đã thử nối lại nhiều lần không được. Bấm Kết nối để thử lại.' });
      return;
    }
    const delay = RETRY_DELAYS[this.retry++];
    this.#setStatus({ state: 'connecting', error: `${message} (thử lại sau ${Math.round(delay / 1000)} giây)` });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => { if (this.wanted) this.#open(); }, delay);
  }

  async disconnect() {
    this.wanted = false;
    this.generation++;
    clearTimeout(this.retryTimer);
    const conn = this.conn;
    this.conn = null;
    if (conn) {
      try { await conn.disconnect(); } catch { /* đã đóng */ }
    }
    this.#setStatus({ state: 'idle', error: '', viewers: 0 });
  }
}
