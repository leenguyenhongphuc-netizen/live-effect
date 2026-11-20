import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';

// Tự thêm nguồn trình duyệt "Live Effect" vào cảnh đang mở trong OBS, qua máy chủ
// WebSocket có sẵn của OBS (bản 28 trở lên). Chỉ chạy khi người dùng bấm nút.

export const OBS_INPUT_NAME = 'Live Effect';

const sha = (text) => crypto.createHash('sha256').update(text).digest('base64');

/** Đọc cổng và mật khẩu WebSocket mà OBS lưu trên chính máy này. */
export function readObsLocalConfig(appData = process.env.APPDATA) {
  if (!appData) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(appData, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json'), 'utf8'));
    return {
      enabled: raw.server_enabled !== false,
      port: Number(raw.server_port) || 4455,
      password: raw.auth_required === false ? '' : String(raw.server_password || ''),
    };
  } catch {
    return null;
  }
}

const fail = (code, message) => Object.assign(new Error(message), { code });

/**
 * @returns {Promise<{scene: string, created: boolean, width: number, height: number}>}
 */
export function addOverlayToObs({ url, port = 4455, password = '', WebSocketImpl = WebSocket, timeoutMs = 6000 }) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocketImpl(`ws://127.0.0.1:${port}`); } catch (err) { reject(fail('offline', err.message)); return; }
    const pending = new Map();
    let seq = 0;
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* đã đóng */ }
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(() => finish(fail('offline', 'OBS không phản hồi')), timeoutMs);

    const request = (requestType, requestData) => new Promise((ok, bad) => {
      const requestId = `le-${++seq}`;
      pending.set(requestId, { ok, bad });
      ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });

    const run = async () => {
      const { currentProgramSceneName: scene } = await request('GetCurrentProgramScene');
      const video = await request('GetVideoSettings');
      const width = video.baseWidth || 1080;
      const height = video.baseHeight || 1920;
      const { inputs = [] } = await request('GetInputList');
      const settings = { url, width, height, shutdown: false, restart_when_active: false };
      if (inputs.some((i) => i.inputName === OBS_INPUT_NAME)) {
        await request('SetInputSettings', { inputName: OBS_INPUT_NAME, inputSettings: settings, overlay: true });
        return { scene, created: false, width, height };
      }
      await request('CreateInput', { sceneName: scene, inputName: OBS_INPUT_NAME, inputKind: 'browser_source', inputSettings: settings, sceneItemEnabled: true });
      return { scene, created: true, width, height };
    };

    ws.on('error', () => finish(fail('offline', 'Không nối được OBS')));
    // OBS đóng kết nối với mã 4009 khi sai mật khẩu.
    ws.on('close', (code) => finish(code === 4009 ? fail('auth', 'Sai mật khẩu WebSocket của OBS') : fail('offline', 'OBS đóng kết nối')));
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (msg.op === 0) {
        const auth = msg.d?.authentication;
        const identify = { rpcVersion: 1, eventSubscriptions: 0 };
        if (auth) {
          if (!password) { finish(fail('auth', 'OBS yêu cầu mật khẩu')); return; }
          identify.authentication = sha(sha(password + auth.salt) + auth.challenge);
        }
        ws.send(JSON.stringify({ op: 1, d: identify }));
      } else if (msg.op === 2) {
        run().then((value) => finish(null, value), (err) => finish(err.code ? err : fail('request', err.message)));
      } else if (msg.op === 7) {
        const p = pending.get(msg.d?.requestId);
        if (!p) return;
        pending.delete(msg.d.requestId);
        const st = msg.d.requestStatus || {};
        if (st.result) p.ok(msg.d.responseData || {});
        else p.bad(fail('request', st.comment || `OBS từ chối lệnh ${msg.d.requestType} (mã ${st.code})`));
      }
    });
  });
}

const HELP = {
  offline: 'Chưa nối được OBS. Mở OBS, vào Tools → WebSocket Server Settings, tích “Enable WebSocket server”, bấm OK rồi thử lại.',
  auth: 'OBS đang đặt mật khẩu WebSocket mà Live Effect không đọc được. Trong OBS: Tools → WebSocket Server Settings, bỏ tích “Enable Authentication” rồi thử lại.',
};

/** Thử thêm overlay vào OBS; trả về kết quả kèm lời hướng dẫn tiếng Việt khi lỗi. */
export async function addToObs(url, deps = {}) {
  const local = (deps.readConfig || readObsLocalConfig)();
  const opts = { url, port: local?.port || 4455, password: local?.password || '', WebSocketImpl: deps.WebSocketImpl, timeoutMs: deps.timeoutMs };
  try {
    const out = await addOverlayToObs(opts);
    return { ok: true, ...out };
  } catch (err) {
    return { ok: false, code: err.code || 'request', error: HELP[err.code] || `OBS báo lỗi: ${err.message}` };
  }
}
