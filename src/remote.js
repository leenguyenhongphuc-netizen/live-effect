import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { sendJson, readJson, serveFile } from './http.js';

// Máy chủ điều khiển từ điện thoại. Khác máy chủ chính (chỉ nghe trên máy này),
// máy chủ này nghe trên mạng Wi-Fi nội bộ, nên:
//   - chỉ bật khi người dùng tự bật trong bảng điều khiển,
//   - chỉ phục vụ trang điều khiển và hai lệnh /r/state, /r/fire,
//   - mọi lệnh đều phải kèm mã ghép nối ngẫu nhiên 128 bit (nằm trong mã QR).

const HTML_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
};

/** Địa chỉ IPv4 trong mạng nội bộ, ưu tiên dải mạng nhà riêng thường gặp. */
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  const score = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((a, b) => score(a) - score(b));
}

function sameKey(given, expected) {
  if (typeof given !== 'string' || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createRemote({ publicDir, getConfig, basePort, getState, fire, onChange }) {
  let server = null;
  let port = 0;
  let error = '';
  let qrCache = { url: '', svg: '' };

  const handler = (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://remote');
    } catch {
      return sendJson(res, 400, { error: 'bad request' });
    }
    const p = url.pathname;

    if (p.startsWith('/r/')) {
      if (!sameKey(req.headers['x-key'], getConfig().remote.token)) {
        return sendJson(res, 401, { error: 'Mã ghép nối không đúng hoặc đã đổi. Hãy quét lại mã QR trên máy tính.' });
      }
      if (req.method === 'GET' && p === '/r/state') return sendJson(res, 200, getState());
      if (req.method === 'POST' && p === '/r/fire') {
        return readJson(req)
          .then((body) => sendJson(res, 200, { ok: fire(body) }))
          .catch((err) => sendJson(res, err.status || 400, { error: err.message }));
      }
      return sendJson(res, 404, { error: 'not found' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
    if (p === '/' || p === '/remote' || p === '/remote/') return serveFile(res, publicDir, 'remote/index.html', HTML_HEADERS);
    if (p.startsWith('/remote/')) return serveFile(res, publicDir, p.slice(1), HTML_HEADERS);
    return sendJson(res, 404, { error: 'not found' });
  };

  function listen(startPort) {
    return new Promise((resolve, reject) => {
      const srv = http.createServer(handler);
      let candidate = startPort;
      let tries = 0;
      const attempt = () => {
        const onError = (err) => {
          if (err.code === 'EADDRINUSE' && tries++ < 20) {
            candidate += 1;
            attempt();
          } else reject(err);
        };
        srv.once('error', onError);
        srv.listen(candidate, '0.0.0.0', () => {
          srv.off('error', onError);
          resolve(srv);
        });
      };
      attempt();
    });
  }

  async function stop() {
    if (!server) return;
    const srv = server;
    server = null;
    port = 0;
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }

  /** Bật hoặc tắt máy chủ theo cấu hình hiện tại. */
  async function sync() {
    const want = getConfig().remote.enabled;
    if (want && !server) {
      try {
        server = await listen(basePort());
        port = server.address().port;
        error = '';
      } catch (err) {
        server = null;
        error = `Không mở được cổng cho điện thoại: ${err.message}`;
      }
    } else if (!want && server) {
      await stop();
      error = '';
    }
    onChange?.();
  }

  async function info() {
    const { enabled, token } = getConfig().remote;
    const running = Boolean(server);
    const urls = running ? lanAddresses().map((ip) => `http://${ip}:${port}/?k=${token}`) : [];
    let qr = '';
    if (urls[0]) {
      if (qrCache.url !== urls[0]) {
        qrCache = { url: urls[0], svg: await QRCode.toString(urls[0], { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }) };
      }
      qr = qrCache.svg;
    }
    return { enabled, running, error, port, urls, qr };
  }

  return { sync, info, close: stop };
}
