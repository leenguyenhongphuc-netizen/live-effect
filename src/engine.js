// Bộ máy kịch bản: nhận sự kiện đã chuẩn hoá (follow, gift, like...) và quyết định
// kịch bản nào chạy. Không phụ thuộc mạng hay Electron nên kiểm thử được độc lập.

import { formatVnd } from './donate.js';

const fill = (tpl, ctx) =>
  String(tpl || '').replace(/\{(\w+)\}/g, (m, key) => (ctx[key] !== undefined && ctx[key] !== null ? String(ctx[key]) : m))
    .replace(/\s+/g, ' ').trim();

export class Engine {
  /**
   * @param {() => object} getConfig trả về cấu hình hiện tại
   * @param {(msg: object) => void} emit gửi lệnh tới overlay
   * @param {() => number} now đồng hồ (ms), thay được khi kiểm thử
   */
  constructor(getConfig, emit, now = () => Date.now()) {
    this.getConfig = getConfig;
    this.emit = emit;
    this.now = now;
    this.lastFired = new Map(); // ruleId -> thời điểm chạy gần nhất
    this.likeBank = new Map(); // ruleId -> số tim đang dồn
    this.followed = new Set(); // người đã follow trong phiên, tránh lặp
    this.goal = { likes: 0, coins: 0, follows: 0, donate: 0 };
    this.gifters = new Map(); // người tặng -> { name, avatar, coins } trong phiên
  }

  resetSession() {
    this.lastFired.clear();
    this.likeBank.clear();
    this.followed.clear();
    this.goal = { likes: 0, coins: 0, follows: 0, donate: 0 };
    this.gifters.clear();
    this.#emitGoal();
    this.emit(this.topState());
  }

  /** Bảng xếp hạng người tặng quà nhiều nhất trong phiên. */
  topState() {
    const max = this.getConfig().widgets.top.max;
    const rows = [...this.gifters.values()].sort((a, b) => b.coins - a.coins).slice(0, max);
    return { type: 'top', rows };
  }

  goalState() {
    const g = this.getConfig().widgets.goal;
    return { type: 'goal', value: this.goal[g.type] || 0, target: g.target, title: g.title };
  }

  #emitGoal() {
    this.emit(this.goalState());
  }

  context(ev) {
    const user = ev.nickname || ev.user || (ev.type === 'donate' ? 'Một bạn' : 'Ai đó');
    return {
      user,
      amount: formatVnd(ev.amount || 0),
      gift: ev.giftName || 'quà',
      count: ev.count || 1,
      coins: ev.coins || 0,
      text: ev.text || '',
      likes: ev.likeCount || 0,
    };
  }

  /** Chạy trực tiếp một hành động (nút thử, phím tắt, bảng hiệu ứng). */
  fire(action, ev = {}) {
    const ctx = this.context(ev);
    this.emit({
      type: 'fx',
      effect: action.effect || 'none',
      intensity: action.intensity || 2,
      duration: action.duration || 5,
      sound: action.sound || 'none',
      media: action.media || '',
      mediaFit: action.mediaFit || 'cover',
      mediaKey: action.mediaKey || 'none',
      camera: action.camera || 'none',
      alert: action.alert && action.text ? fill(action.text, ctx) : '',
      avatar: ev.avatar || '',
      image: ev.giftImage || '',
    });
  }

  fireRule(ruleId, ev = {}) {
    const rule = this.getConfig().rules.find((r) => r.id === ruleId);
    if (!rule) return false;
    this.fire(rule.action, ev);
    this.lastFired.set(rule.id, this.now());
    return true;
  }

  #matches(rule, ev) {
    const t = rule.trigger;
    if (t.type !== ev.type) return false;
    // Hiệu ứng riêng cho một người: so theo ID TikTok, không phân biệt hoa thường.
    if (t.user && t.user.toLowerCase() !== String(ev.user || '').replace(/^@/, '').toLowerCase()) return false;
    switch (t.type) {
      case 'gift': {
        // Ưu tiên so theo mã quà (tên quà đổi theo ngôn ngữ của TikTok); không có mã thì so tên.
        if (t.giftId) { if (t.giftId !== String(ev.giftId || '')) return false; }
        else if (t.giftName && t.giftName.toLowerCase() !== String(ev.giftName || '').toLowerCase()) return false;
        return (ev.coins || 0) >= t.minCoins;
      }
      case 'donate':
        return (ev.amount || 0) >= (t.minAmount || 0);
      case 'chat': {
        // Không có từ khoá thì không chạy, tránh mọi bình luận đều kích hiệu ứng.
        if (!t.keyword) return false;
        return String(ev.text || '').toLowerCase().includes(t.keyword.toLowerCase());
      }
      case 'like': {
        const bank = (this.likeBank.get(rule.id) || 0) + (ev.likeCount || 1);
        if (bank < t.every) {
          this.likeBank.set(rule.id, bank);
          return false;
        }
        this.likeBank.set(rule.id, bank % t.every);
        return true;
      }
      case 'button':
        return false; // nút bấm tay đi qua fireRule
      default:
        return true;
    }
  }

  /** Xử lý một sự kiện; trả về danh sách id kịch bản đã chạy. */
  handle(ev) {
    const cfg = this.getConfig();
    const fired = [];

    if (ev.type === 'follow') {
      const key = ev.user || ev.nickname;
      if (key && this.followed.has(key)) return fired;
      if (key) this.followed.add(key);
      this.goal.follows += 1;
    } else if (ev.type === 'gift') {
      this.goal.coins += ev.coins || 0;
      const key = ev.user || ev.nickname;
      if (key && ev.coins > 0) {
        const row = this.gifters.get(key) || { name: ev.nickname || ev.user, avatar: ev.avatar || '', coins: 0 };
        row.coins += ev.coins;
        if (ev.avatar) row.avatar = ev.avatar;
        this.gifters.set(key, row);
        this.emit(this.topState());
      }
    } else if (ev.type === 'donate') {
      this.goal.donate += ev.amount || 0;
    } else if (ev.type === 'like') {
      // TikTok gửi kèm tổng tim của phiên; nếu có thì tin số đó hơn số tự cộng.
      this.goal.likes = ev.totalLikes > this.goal.likes ? ev.totalLikes : this.goal.likes + (ev.likeCount || 1);
    }
    if (['follow', 'gift', 'like', 'donate'].includes(ev.type)) this.#emitGoal();

    if (ev.type === 'chat' && cfg.widgets.chat.enabled) {
      this.emit({ type: 'chat', user: ev.nickname || ev.user || '', text: ev.text || '', avatar: ev.avatar || '' });
    }

    // Công tắc tổng "Chúc mừng quà tặng": tắt thì quà vẫn được đếm vào mục tiêu nhưng không hiện gì.
    if (ev.type === 'gift' && !cfg.gifts.celebrate) return fired;

    const now = this.now();
    let matched = cfg.rules.filter((rule) => rule.enabled && this.#matches(rule, ev));
    // Quà đã có hiệu ứng riêng thì không chạy thêm hiệu ứng chung cho "mọi loại quà".
    const own = (r) => r.trigger.giftId || r.trigger.giftName;
    if (ev.type === 'gift' && matched.some(own)) matched = matched.filter(own);
    for (const rule of matched) {
      const last = this.lastFired.get(rule.id);
      if (rule.cooldown > 0 && last !== undefined && now - last < rule.cooldown * 1000) continue;
      this.lastFired.set(rule.id, now);
      this.fire(rule.action, ev);
      fired.push(rule.id);
    }
    return fired;
  }
}
