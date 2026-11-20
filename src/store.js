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
    fs.mkdirSync(this.mediaDir, { recursive: true });
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
    this.config = clean;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.config, null, 2));
    fs.renameSync(tmp, this.file);
    return this.config;
  }

  listMedia() {
    return fs.readdirSync(this.mediaDir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, 'vi'));
  }
}
