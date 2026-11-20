import fs from 'node:fs';

// Danh mục quà TikTok: tải từ phòng live khi kết nối, và học thêm từ chính các quà nhận được.
// Lưu ra tệp để lần sau mở ứng dụng (chưa live) vẫn có danh sách mà gán hiệu ứng.

const first = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');
const img = (m) => (typeof m === 'string' ? m : m ? first(m.url_list?.[0], m.urlList?.[0], m.url?.[0], m.mUrls?.[0]) : undefined);
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u.slice(0, 500) : '');

/** Chuẩn hoá một quà từ API TikTok (snake_case) hoặc từ tin nhắn quà (camelCase). */
export function normalizeCatalogGift(g = {}) {
  const id = String(first(g.id, g.giftId, '') ?? '').replace(/\D/g, '');
  if (!id) return null;
  return {
    id,
    name: String(first(g.name, g.giftName, `Quà #${id}`)).slice(0, 60),
    coins: Math.max(0, Math.round(Number(first(g.diamond_count, g.diamondCount, g.coins, 0)) || 0)),
    image: httpUrl(first(img(g.image), img(g.icon), img(g.giftImage))),
    type: Number(first(g.type, g.giftType, 0)) || 0,
  };
}

export class GiftCatalog {
  constructor(file) {
    this.file = file;
    this.map = new Map();
    try {
      for (const g of JSON.parse(fs.readFileSync(file, 'utf8'))) {
        const clean = normalizeCatalogGift(g);
        if (clean) this.map.set(clean.id, clean);
      }
    } catch { /* chưa có tệp hoặc tệp hỏng: bắt đầu trống */ }
  }

  get(id) {
    return this.map.get(String(id));
  }

  /** Gộp danh sách mới; trả về true nếu có thay đổi. */
  merge(list) {
    let changed = false;
    for (const raw of Array.isArray(list) ? list.slice(0, 5000) : []) {
      const g = normalizeCatalogGift(raw);
      if (!g) continue;
      const old = this.map.get(g.id);
      // Quà học từ sự kiện có thể thiếu hình hoặc giá: không ghi đè thông tin tốt bằng thông tin rỗng.
      const next = old ? {
        id: g.id,
        name: g.name.startsWith('Quà #') ? old.name : g.name,
        coins: g.coins || old.coins,
        image: g.image || old.image,
        type: g.type || old.type,
      } : g;
      if (!old || JSON.stringify(old) !== JSON.stringify(next)) {
        this.map.set(g.id, next);
        changed = true;
      }
    }
    if (changed) this.#save();
    return changed;
  }

  #save() {
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.list()));
      fs.renameSync(tmp, this.file);
    } catch { /* không lưu được thì vẫn dùng trong bộ nhớ */ }
  }

  list() {
    return [...this.map.values()].sort((a, b) => a.coins - b.coins || a.name.localeCompare(b.name));
  }
}
