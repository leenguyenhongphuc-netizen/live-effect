import { EventEmitter } from 'node:events';
import { normalizeCatalogGift } from './gifts.js';

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
    // Cấp tặng quà của người xem và cấp trong đội fan của kênh (dùng để chào khách theo bậc).
    level: Number(first(u.payGrade?.level, u.gifterLevel, 0)) || 0,
    fanLevel: Number(first(u.fansClub?.data?.level, u.fansClubInfo?.fansLevel, 0)) || 0,
  };
}

/** Trả về sự kiện quà đã chuẩn hoá, hoặc null nếu chuỗi quà chưa kết thúc. */
export function normalizeGift(data = {}, catalog = null) {
  const g = first(data.gift, data.giftDetails, data.extendedGiftInfo) || {};
  const giftId = String(first(data.giftId, g.id, '') ?? '');
  // Tin nhắn quà đôi khi không kèm tên và giá: lấy từ danh mục quà của phòng.
  const known = catalog?.get(giftId);
  const ext = data.extendedGiftInfo || (known ? { name: known.name, diamond_count: known.coins, image: known.image, type: known.type } : {});
  const giftType = Number(first(g.type, g.giftType, ext.type, 0));
  // Quà dạng chuỗi (type 1) bắn nhiều sự kiện khi đang bấm liên tục;
  // chỉ lấy sự kiện kết thúc chuỗi để đếm đúng số lượng.
  if (giftType === 1 && !data.repeatEnd) return null;
  const count = Number(first(data.repeatCount, data.comboCount, 1)) || 1;
  const diamonds = Number(first(g.diamondCount, ext.diamond_count, ext.diamondCount, 0)) || 0;
  return {
    type: 'gift',
    ...normalizeUser(data.user),
    giftId,
    giftName: first(g.name, g.giftName, ext.name, `Quà #${data.giftId || '?'}`),
    giftImage: first(img(g.image), img(g.icon), img(g.giftImage), typeof ext.image === 'string' ? ext.image : img(ext.image), img(ext.icon)) || '',
    count,
    coins: diamonds * count,
  };
}

const NETWORK = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|socket|fetch failed|timeout/i;

/**
 * Phân loại lỗi kết nối: `kind` để quyết định làm gì tiếp, `message` để hiện cho người
 * dùng, `detail` là nguyên văn lỗi kỹ thuật (để gửi khi cần hỗ trợ).
 */
export function classify(err, username = '') {
  const name = err?.name || err?.constructor?.name || '';
  const msg = String(err?.message || err || '');
  // Lỗi tổng hợp của thư viện gói lỗi của từng nguồn (trang kênh, API, Euler) ở đây.
  const subs = (err?.config?.requestErrs || []).map((e) => String(e?.message || e));
  const detail = [name && name !== 'Error' ? name : '', msg, ...subs].filter(Boolean).join(' | ').slice(0, 700);
  const who = username ? `@${username}` : 'này';
  const offline = {
    kind: 'offline',
    detail,
    message: `Kênh ${who} chưa lên sóng. Cứ để vậy: khi bạn bấm Phát LIVE, ứng dụng sẽ tự kết nối. Nếu đang live rồi mà vẫn thấy dòng này, hãy kiểm tra lại ID TikTok.`,
  };

  if (/UserOffline|offline|not.*live|isn't online|LIVE has ended/i.test(name + msg)) return offline;
  if (/Failed to retrieve room/i.test(msg)) {
    // TikTok có trả lời nhưng trang kênh không có phòng live: kênh chưa lên sóng (hoặc sai ID).
    if (subs.some((x) => /Failed to extract Room ID from (HTML|API)/i.test(x))) return offline;
    if (subs.length && subs.every((x) => NETWORK.test(x))) {
      return { kind: 'network', detail, message: 'Không có mạng hoặc TikTok không phản hồi. Kiểm tra kết nối Internet rồi thử lại.' };
    }
    return { kind: 'room', detail, message: 'Không lấy được phòng live của kênh này. Kiểm tra lại ID TikTok (phần sau dấu @) và kết nối Internet.' };
  }
  if (/rate.?limit|429|too many/i.test(name + msg)) {
    return { kind: 'ratelimit', detail, message: 'Máy chủ ký kết nối đang giới hạn lượt dùng miễn phí. Chờ vài phút rồi thử lại, hoặc nhập khoá Euler Stream ở mục Nâng cao.' };
  }
  if (NETWORK.test(name + msg)) {
    return { kind: 'network', detail, message: 'Không có mạng hoặc TikTok không phản hồi. Kiểm tra kết nối Internet rồi thử lại.' };
  }
  if (/\bnot found\b|user.*exist/i.test(name + msg)) {
    return { kind: 'notfound', detail, message: 'Không tìm thấy kênh này. Kiểm tra lại ID TikTok (phần sau dấu @).' };
  }
  return { kind: 'other', detail, message: `Không kết nối được: ${msg.slice(0, 160) || name || 'lỗi không rõ'}` };
}

export const friendlyError = (err) => classify(err).message;

const RETRY_DELAYS = [3000, 8000, 15000, 30000, 60000];
const POLL_MS = 20000; // nhịp hỏi "kênh đã lên sóng chưa" khi đang chờ

export class TikTokSource extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {() => Promise<object>} [opts.loadLib] thay thư viện kết nối khi kiểm thử
   * @param {number} [opts.pollMs] nhịp hỏi trạng thái live khi đang chờ
   */
  constructor({ loadLib = () => import('tiktok-live-connector'), pollMs = POLL_MS } = {}) {
    super();
    this.loadLib = loadLib;
    this.pollMs = pollMs;
    this.waitTicks = 0;
    this.catalog = null; // danh mục quà do máy chủ cấp, để bù tên và giá quà
    this.conn = null;
    this.username = '';
    this.status = { state: 'idle', username: '', error: '', detail: '', viewers: 0 };
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
      this.#setStatus({ state: 'error', error: 'Hãy nhập ID TikTok của kênh.', detail: '' });
      return;
    }
    this.signApiKey = signApiKey || '';
    this.wanted = true;
    this.retry = 0;
    this.waitTicks = 0;
    await this.#open();
  }

  /** @param {boolean} [quiet] đang chờ kênh lên sóng: thử kết nối mà không đổi dòng trạng thái */
  async #open(quiet = false) {
    const gen = ++this.generation;
    if (!quiet) this.#setStatus({ state: 'connecting', username: this.username, error: '', detail: '' });
    let lib;
    try {
      lib = await this.loadLib();
    } catch (err) {
      this.wanted = false;
      this.#setStatus({ state: 'error', error: `Thiếu thư viện kết nối TikTok: ${err.message}` });
      return;
    }
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = lib;
    // Không bật enableExtendedGiftInfo: thư viện sẽ coi lỗi tải danh sách quà là lỗi kết nối.
    // Danh sách quà được tải riêng sau khi kết nối, hỏng cũng không ảnh hưởng phiên live.
    const opts = { processInitialData: false };
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
    conn.on(WebcastEvent.GIFT, (d) => { const ev = normalizeGift(d, this.catalog); if (ev) push(ev); });
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
      this.#setStatus({ state: 'idle', error: 'Phiên live đã kết thúc.', detail: '', viewers: 0 });
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
      this.#setStatus({ state: 'connected', username: this.username, error: '', detail: '' });
      Promise.resolve()
        .then(() => conn.fetchAvailableGifts?.())
        .then((list) => { if (live() && Array.isArray(list)) this.emit('gifts', list.map(normalizeCatalogGift).filter(Boolean)); })
        .catch(() => { /* không có danh sách quà: vẫn học dần từ quà nhận được */ });
    } catch (err) {
      if (!live()) return;
      const fail = classify(err, this.username);
      if (fail.kind === 'offline') {
        // Kênh chưa lên sóng: không bắt người dùng bấm lại, tự chờ rồi tự kết nối.
        this.#setStatus({ state: 'waiting', username: this.username, error: fail.message, detail: fail.detail, viewers: 0 });
        this.#pollUntilLive();
      } else if (fail.kind === 'room' || fail.kind === 'notfound' || this.retry >= RETRY_DELAYS.length) {
        // Sai ID thì thử lại cũng vô ích: dừng và báo rõ.
        this.wanted = false;
        this.#setStatus({ state: 'error', error: fail.message, detail: fail.detail });
      } else {
        this.#scheduleRetry(fail.message, fail.detail);
      }
    }
  }

  #pollUntilLive() {
    clearTimeout(this.retryTimer);
    const gen = this.generation;
    const conn = this.conn;
    this.retryTimer = setTimeout(async () => {
      if (gen !== this.generation || !this.wanted) return;
      this.waitTicks += 1;
      let isLive = null;
      try { isLive = await conn.fetchIsLive(); } catch { /* không hỏi được: xử lý bên dưới */ }
      if (gen !== this.generation || !this.wanted) return;
      // TikTok trả lời rõ "chưa live" thì chờ tiếp. Khi không hỏi được (ví dụ TikTok chặn
      // trang kênh), cứ ba nhịp lại thử kết nối thật một lần để không bỏ lỡ lúc lên sóng.
      if (isLive === true) this.#open();
      else if (isLive === null && this.waitTicks % 3 === 0) this.#open(true);
      else this.#pollUntilLive();
    }, this.pollMs);
  }

  #scheduleRetry(message, detail = '') {
    if (this.retry >= RETRY_DELAYS.length) {
      this.wanted = false;
      this.#setStatus({ state: 'error', error: 'Đã thử nối lại nhiều lần không được. Bấm Kết nối để thử lại.' });
      return;
    }
    const delay = RETRY_DELAYS[this.retry++];
    this.#setStatus({ state: 'connecting', error: `${message} (thử lại sau ${Math.round(delay / 1000)} giây)`, detail });
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
    this.#setStatus({ state: 'idle', error: '', detail: '', viewers: 0 });
  }
}
