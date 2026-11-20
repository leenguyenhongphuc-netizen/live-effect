// Chào khách vào phòng theo bậc. Mỗi người chỉ được xếp vào MỘT bậc, bậc đứng trước trong
// danh sách được ưu tiên. Mỗi bậc có lời chào riêng và một nhóm video; nhiều video thì chọn
// ngẫu nhiên, không lặp lại video vừa phát.

export const TIERS = [
  { id: 'special', name: 'Khách đặc biệt', param: null, help: 'Danh sách ID TikTok bạn tự chọn.' },
  { id: 'top1', name: 'Top 1 tặng quà', param: null, help: 'Người tặng nhiều xu nhất trong sổ fan.' },
  { id: 'top3', name: 'Top 2–3 tặng quà', param: null, help: 'Hạng 2 và 3 trong sổ fan.' },
  { id: 'top10', name: 'Top 4–10 tặng quà', param: null, help: 'Hạng 4 đến 10 trong sổ fan.' },
  { id: 'level', name: 'Đại gia TikTok', param: 'Cấp người xem từ', min: 30, help: 'Theo cấp tặng quà của người xem trên TikTok.' },
  { id: 'fan', name: 'Đội fan', param: 'Cấp đội fan từ', min: 10, help: 'Theo cấp trong đội fan của kênh.' },
  { id: 'back', name: 'Lâu rồi mới gặp', param: 'Vắng từ (ngày)', min: 30, help: 'Khách cũ quay lại sau một thời gian vắng.' },
  { id: 'regular', name: 'Khách quen', param: 'Đã ghé từ (ngày)', min: 5, help: 'Người đã ghé nhiều buổi live.' },
];

const fill = (tpl, ctx) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (ctx[k] !== undefined ? String(ctx[k]) : m));

export class Greeter {
  /**
   * @param {object} deps
   * @param {() => object} deps.getConfig
   * @param {import('./fans.js').FanBook} deps.fans
   * @param {(msg: object) => void} deps.fire đưa lời chào vào hàng đợi hiệu ứng
   */
  constructor({ getConfig, fans, fire }) {
    this.getConfig = getConfig;
    this.fans = fans;
    this.fire = fire;
    this.greeted = new Set();
    this.lastVideo = new Map();
  }

  resetSession() {
    this.greeted.clear();
  }

  /** Bậc của một khán giả, hoặc null nếu không thuộc bậc nào đang bật. */
  tierOf(ev, visit) {
    const tiers = this.getConfig().greet.tiers;
    const id = String(ev.user || '').replace(/^@/, '').toLowerCase();
    const rank = this.fans.rank(id);
    const is = {
      special: () => tiers.special.users.split(/[\s,;]+/).some((u) => u && u.replace(/^@/, '').toLowerCase() === id),
      top1: () => rank === 1,
      top3: () => rank === 2 || rank === 3,
      top10: () => rank >= 4 && rank <= 10,
      level: () => (ev.level || 0) >= tiers.level.min,
      fan: () => (ev.fanLevel || 0) >= tiers.fan.min,
      back: () => !visit.firstTime && visit.daysAway >= tiers.back.min,
      regular: () => visit.visits >= tiers.regular.min,
    };
    return TIERS.find((t) => tiers[t.id].enabled && is[t.id]()) || null;
  }

  #video(tierId, videos) {
    if (!videos.length) return '';
    const last = this.lastVideo.get(tierId);
    const pool = videos.length > 1 ? videos.filter((v) => v !== last) : videos;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    this.lastVideo.set(tierId, pick);
    return pick;
  }

  /** Phát lời chào của một bậc cho một người. */
  greet(tier, ev) {
    const cfg = this.getConfig().greet.tiers[tier.id];
    const name = ev.nickname || ev.user || 'bạn';
    const media = this.#video(tier.id, cfg.videos);
    this.fire({
      type: 'fx', priority: 1, label: `Chào ${tier.name}`, who: name,
      effect: 'none', intensity: 2, duration: 5, sound: media ? 'none' : 'ding',
      media, mediaFit: 'cover', mediaKey: cfg.key, camera: 'none',
      alert: fill(cfg.text, { user: name, tier: tier.name }), avatar: ev.avatar || '', image: '',
    });
  }

  /**
   * Xử lý một người vào phòng.
   * @returns {string | null} tên bậc đã chào
   */
  handleJoin(ev) {
    const visit = this.fans.seen(ev.user, ev.nickname);
    const cfg = this.getConfig().greet;
    if (!cfg.enabled || !ev.user) return null;
    const key = String(ev.user).toLowerCase();
    if (cfg.once && this.greeted.has(key)) return null;
    const tier = this.tierOf(ev, visit);
    if (!tier) return null;
    this.greeted.add(key);
    this.greet(tier, ev);
    return tier.name;
  }
}
