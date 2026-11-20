import fs from 'node:fs';
import path from 'node:path';

// Tiện ích HTTP dùng chung cho máy chủ cục bộ và máy chủ điều khiển từ điện thoại.

const MAX_JSON_BYTES = 512 * 1024;

const MIME = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml', json: 'application/json; charset=utf-8', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', webm: 'video/webm', mp4: 'video/mp4',
  webmanifest: 'application/manifest+json; charset=utf-8',
  mov: 'video/mp4', // video quay bằng iPhone: cùng họ với MP4, trình duyệt phát được khi là H.264
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', ico: 'image/x-icon',
};

export function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': MIME.json, 'Cache-Control': 'no-store' });
  res.end(data);
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Ghi thẳng thân yêu cầu xuống đĩa (video lớn không nằm trong bộ nhớ). Trả về số byte. */
export function saveBody(req, file, limit) {
  return new Promise((resolve, reject) => {
    const tmp = `${file}.part`;
    const out = fs.createWriteStream(tmp);
    let size = 0;
    let failed = false;
    const abort = (err) => {
      if (failed) return;
      failed = true;
      req.unpipe(out);
      req.resume(); // đọc bỏ phần còn lại để vẫn trả lời được cho bên gửi
      out.destroy();
      fs.rm(tmp, { force: true }, () => reject(err));
    };
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) abort(Object.assign(new Error('too large'), { status: 413 }));
    });
    req.on('error', abort);
    req.on('aborted', () => abort(Object.assign(new Error('aborted'), { status: 400 })));
    out.on('error', abort);
    out.on('finish', () => {
      if (failed) return;
      if (!size) { abort(Object.assign(new Error('empty'), { status: 400 })); return; }
      fs.rename(tmp, file, (err) => (err ? abort(err) : resolve(size)));
    });
    req.pipe(out);
  });
}

export async function readJson(req) {
  const buf = await readBody(req, MAX_JSON_BYTES);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON không hợp lệ'), { status: 400 });
  }
}

export function serveFile(res, root, relPath, extraHeaders = {}) {
  const file = path.resolve(root, `.${path.sep}${relPath}`);
  if (file !== root && !file.startsWith(root + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: 'not found' });
    const ext = path.extname(file).slice(1).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      // OBS giữ bộ nhớ đệm rất lâu; luôn hỏi lại để bản cập nhật có hiệu lực ngay.
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    });
    fs.createReadStream(file).pipe(res);
  });
}

