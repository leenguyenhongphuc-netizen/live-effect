import fs from 'node:fs';

// Sổ fan: nhớ từng khán giả qua nhiều buổi live (số ngày đã ghé, lần cuối ghé, tổng xu đã tặng).
// Dùng để chào khách quen, khách lâu ngày quay lại, và xếp hạng người tặng nhiều nhất.

const DAY = 86400000;
const MAX_FANS = 20000;

export class FanBook {
  constructor(file, now = () => Date.now()) {
    this.file = file;
    this.now = now;
    this.map = new Map();
    this.rankCache = null;
    try {
      for (const [id, f] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) {
        this.map.set(id, { name: String(f.name || id).slice(0, 60), visits: Number(f.visits) || 0, last: Number(f.last) || 0, coins: Number(f.coins) || 0 });
      }
    } catch { /* chưa có sổ: bắt đầu trống */ }
  }

  #key(user) {
    return String(user || '').replace(/^@/, '').toLowerCase().slice(0, 60);
  }

  get(user) {
    return this.map.get(this.#key(user)) || null;
  }

  /**
   * Ghi nhận một lần vào phòng. Mỗi ngày chỉ tính một lần ghé.
   * @returns {{ visits: number, daysAway: number, firstTime: boolean }}
   */
  seen(user, name) {
    const id = this.#key(user);
    if (!id) return { visits: 0, daysAway: 0, firstTime: false };
    const now = this.now();
    const f = this.map.get(id);
    if (!f) {
      this.map.set(id, { name: String(name || user).slice(0, 60), visits: 1, last: now, coins: 0 });
      this.#dirty();
      return { visits: 1, daysAway: 0, firstTime: true };
    }
    const daysAway = Math.floor((now - f.last) / DAY);
    if (Math.floor(now / DAY) !== Math.floor(f.last / DAY)) f.visits += 1;
    f.last = now;
    if (name) f.name = String(name).slice(0, 60);
    this.#dirty();
    return { visits: f.visits, daysAway, firstTime: false };
  }

  addCoins(user, name, coins) {
    const id = this.#key(user);
    if (!id || !(coins > 0)) return;
    const f = this.map.get(id) || { name: String(name || user).slice(0, 60), visits: 1, last: this.now(), coins: 0 };
    f.coins += Math.round(coins);
    this.map.set(id, f);
    this.rankCache = null;
    this.#dirty();
  }

  /** Thứ hạng theo tổng xu đã tặng (1 là cao nhất); 0 nếu chưa tặng gì. */
  rank(user) {
    if (!this.rankCache) {
      const ids = [...this.map.entries()].filter(([, f]) => f.coins > 0).sort((a, b) => b[1].coins - a[1].coins).map(([id]) => id);
      this.rankCache = new Map(ids.map((id, i) => [id, i + 1]));
    }
    return this.rankCache.get(this.#key(user)) || 0;
  }

  top(n = 10) {
    return [...this.map.entries()].filter(([, f]) => f.coins > 0).sort((a, b) => b[1].coins - a[1].coins).slice(0, n)
      .map(([id, f]) => ({ user: id, name: f.name, coins: f.coins, visits: f.visits }));
  }

  get size() {
    return this.map.size;
  }

  #dirty() {
    if (this.map.size > MAX_FANS) {
      // Sổ quá lớn: bỏ bớt những người chưa tặng gì và lâu nhất không ghé.
      const drop = [...this.map.entries()].filter(([, f]) => !f.coins).sort((a, b) => a[1].last - b[1].last).slice(0, 2000);
      for (const [id] of drop) this.map.delete(id);
    }
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.save(); }, 5000);
    this.timer.unref?.();
  }

  save() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map)));
      fs.renameSync(tmp, this.file);
    } catch { /* không lưu được thì vẫn dùng trong bộ nhớ */ }
  }
}
