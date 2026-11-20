import { icon } from '/remote/icons.js';

// Trang điều khiển trên điện thoại. Mã ghép nối đến từ mã QR (?k=...), được cất
// vào bộ nhớ trình duyệt rồi xoá khỏi thanh địa chỉ để không lộ khi chụp màn hình.

const KEY_NAME = 'live-effect-key';
const params = new URLSearchParams(location.search);
let stored = null;
try { stored = localStorage.getItem(KEY_NAME); } catch { /* trình duyệt chặn lưu trữ */ }
const key = params.get('k') || stored || '';
if (params.get('k')) {
  try { localStorage.setItem(KEY_NAME, key); } catch { /* vẫn dùng được trong phiên này */ }
  history.replaceState(null, '', location.pathname);
}

const app = document.getElementById('app');
const statusEl = document.getElementById('status');
let lastShape = '';

const el = (tag, cls, ...kids) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  n.append(...kids.filter(Boolean));
  return n;
};

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw Object.assign(new Error('unauthorized'), { auth: true });
  if (!res.ok) throw new Error(`Lỗi ${res.status}`);
  return res.json();
}

function setStatus(kind, text) {
  statusEl.firstElementChild.className = `dot${kind ? ` ${kind}` : ''}`;
  statusEl.lastElementChild.textContent = text;
}

function message(title, text) {
  lastShape = '';
  app.replaceChildren(el('div', 'msg', el('b', '', title), el('p', '', text)));
}

async function press(btn, body) {
  navigator.vibrate?.(12);
  try {
    const out = await call('POST', '/r/fire', body);
    btn.classList.add(out.ok ? 'sent' : 'fail');
  } catch (err) {
    btn.classList.add('fail');
    if (err.auth) needPairing(); else setStatus('err', 'Mất kết nối với máy tính');
  }
  setTimeout(() => btn.classList.remove('sent', 'fail'), 350);
}

function keyButton(label, iconName, body, mine) {
  const btn = el('button', `key${mine ? ' mine' : ''}`, icon(iconName, mine ? 28 : 24), el('span', '', label));
  btn.type = 'button';
  btn.addEventListener('click', () => press(btn, body));
  return btn;
}

function draw(state) {
  // Chỉ dựng lại lưới nút khi danh sách nút thay đổi, để không giật khi đang bấm.
  const shape = JSON.stringify([state.buttons, state.effects, state.celebrate]);
  if (shape === lastShape) return;
  lastShape = shape;
  const mine = state.buttons.map((b) =>
    keyButton(b.name, b.media ? 'film' : b.effect !== 'none' ? b.effect : 'volume', { ruleId: b.id }, true));
  const quick = state.effects.map((e) => keyButton(e.name, e.id, { effect: e.id }, false));
  const mySection = el('section', '', el('h2', '', 'Nút của tôi'));
  if (mine.length) mySection.append(el('div', 'grid', ...mine));
  else mySection.append(el('p', 'hint', 'Chưa có nút riêng. Trên máy tính, vào Kịch bản và thêm kịch bản với sự kiện “Nút bấm tay”.'));
  const quickSection = el('section', '', el('h2', '', 'Hiệu ứng nhanh'), el('div', 'grid', ...quick));
  // Công tắc tổng cho chúc mừng quà: bấm là đổi ngay, không cần chạy về máy tính.
  const on = state.celebrate !== false;
  const sw = el('button', 'switch-row', el('span', '', 'Chúc mừng quà tặng'), el('b', '', on ? 'Đang bật' : 'Đang tắt'));
  sw.type = 'button';
  sw.id = 'celebrate';
  sw.setAttribute('aria-pressed', String(on));
  sw.addEventListener('click', async () => {
    navigator.vibrate?.(12);
    try { await call('POST', '/r/fire', { celebrate: !on }); } catch (err) { if (err.auth) return needPairing(); }
    return refresh();
  });
  app.replaceChildren(sw, mySection, quickSection);
}

function needPairing() {
  setStatus('err', 'Chưa ghép nối');
  message('Cần quét lại mã QR', 'Trên máy tính, mở Live Effect → Điện thoại rồi quét mã QR bằng camera của máy này.');
}

async function refresh() {
  if (!key) return needPairing();
  try {
    const state = await call('GET', '/r/state');
    draw(state);
    const s = state.status;
    if (!state.overlays) setStatus('wait', 'Phần mềm live chưa mở overlay');
    else if (s.state === 'connected') setStatus('ok', `@${s.username}${s.viewers ? ` · ${s.viewers} người xem` : ''}`);
    else setStatus('ok', 'Sẵn sàng');
  } catch (err) {
    if (err.auth) return needPairing();
    setStatus('err', 'Không thấy máy tính');
    if (!lastShape) message('Không kết nối được', 'Kiểm tra điện thoại và máy tính đang chung một mạng Wi-Fi, và Live Effect đang mở.');
  }
  return undefined;
}

document.getElementById('stop').addEventListener('click', (e) => press(e.currentTarget, { clear: true }));
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
