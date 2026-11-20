import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { defaultConfig, sanitizeConfig } from './defaults.js';

// Lưu cấu hình thành một tệp JSON trong thư mục dữ liệu của người dùng.
export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'config.json');
    this.mediaDir = path.join(dataDir, 'media');
    this.thumbDir = path.join(dataDir, 'thumbs'); // ảnh thu nhỏ cho nút video: <tên tệp>.jpg
    fs.mkdirSync(this.mediaDir, { recursive: true });
    fs.mkdirSync(this.thumbDir, { recursive: true });
    this.config = this.#load();
  }

  #load() {
    try {
      return sanitizeConfig(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Tệp hỏng: giữ lại bản cũ để người dùng không mất dữ liệu, rồi dùng mặc định.
        try { fs.renameSync(this.file, `${this.file}.hong-${Date.now()}`); } catch { /* bỏ qua */ }
      }
      return defaultConfig();
    }
  }

  /** Mã ghép nối điện thoại do máy chủ quản lý; bảng điều khiển không tự đặt được. */
  set(next, { rotateToken = false } = {}) {
    const clean = sanitizeConfig(next);
    clean.remote.token = rotateToken ? '' : this.config?.remote.token || '';
    if (clean.remote.enabled && !clean.remote.token) clean.remote.token = crypto.randomBytes(16).toString('hex');
    // Khoá của link nhận sự kiện từ công cụ khác cũng do máy chủ tạo.
    clean.hook.key = this.config?.hook.key || '';
    if (clean.hook.enabled && !clean.hook.key) clean.hook.key = crypto.randomBytes(16).toString('hex');
    this.config = clean;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.config, null, 2));
    fs.renameSync(tmp, this.file);
    return this.config;
  }

  hasThumb(name) {
    return Boolean(name) && fs.existsSync(path.join(this.thumbDir, `${name}.jpg`));
  }

  /** Lưu ảnh thu nhỏ JPEG cho một tệp trong thư viện. */
  saveThumb(name, buf) {
    // Chỉ nhận JPEG thật (bắt đầu bằng FF D8 FF) để thư mục này không chứa thứ gì khác.
    if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return false;
    fs.writeFileSync(path.join(this.thumbDir, `${name}.jpg`), buf);
    return true;
  }

  removeMedia(name) {
    try { fs.unlinkSync(path.join(this.mediaDir, name)); } catch { /* đã xoá */ }
    try { fs.unlinkSync(path.join(this.thumbDir, `${name}.jpg`)); } catch { /* không có ảnh thu nhỏ */ }
  }

  listMedia() {
    return fs.readdirSync(this.mediaDir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, 'vi'));
  }
}
