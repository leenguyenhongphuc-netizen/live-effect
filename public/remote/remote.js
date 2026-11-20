import { icon } from '/remote/icons.js';
import { makeThumb } from '/remote/thumb.js';

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

// Ảnh thu nhỏ tải kèm mã ghép nối trong tiêu đề yêu cầu (không đưa mã lên đường dẫn ảnh).
const thumbs = new Map(); // tên tệp -> Promise<objectURL | ''>
function thumbUrl(media) {
  if (!thumbs.has(media)) {
    thumbs.set(media, fetch(`/r/thumb/${encodeURIComponent(media)}`, { headers: { 'X-Key': key } })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => (blob ? URL.createObjectURL(blob) : ''))
      .catch(() => ''));
  }
  return thumbs.get(media);
}

function keyButton(label, iconName, body, mine, thumbOf) {
  const ic = icon(iconName, mine ? 28 : 24);
  const btn = el('button', `key${mine ? ' mine' : ''}`, ic, el('span', '', label));
  btn.type = 'button';
  btn.addEventListener('click', () => press(btn, body));
  if (thumbOf) {
    thumbUrl(thumbOf).then((src) => {
      if (!src) return;
      const img = el('img', 'thumb');
      img.alt = '';
      img.src = src;
      ic.replaceWith(img);
      btn.classList.add('has-thumb');
    });
  }
  return btn;
}

// --- Thêm video / hình từ điện thoại thành một nút mới ----------------------
const picker = el('input');
picker.type = 'file';
picker.accept = 'video/mp4,video/webm,video/quicktime,image/*';
picker.hidden = true;
document.body.append(picker);

function upload(file, title, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/r/upload?name=${encodeURIComponent(file.name)}&title=${encodeURIComponent(title)}`);
    xhr.setRequestHeader('X-Key', key);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* trả lời không phải JSON */ }
      if (xhr.status === 200) resolve(data);
      else reject(new Error(data.error || `Lỗi ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Mất kết nối với máy tính khi đang tải lên.'));
    xhr.send(file);
  });
}

function addSheet(file) {
  const name = el('input', 'name');
  name.type = 'text';
  name.maxLength = 60;
  name.value = file.name.replace(/\.[^.]+$/, '').slice(0, 60);
  name.setAttribute('aria-label', 'Tên nút');
  const bar = el('div', 'progress', el('i'));
  const note = el('p', 'hint', `${(file.size / 1048576).toFixed(1)} MB. Video nên là MP4 hoặc WebM; nền đen thì bật “Xoá nền” trên máy tính.`);
  const ok = el('button', 'stop', 'Thêm thành nút');
  ok.type = 'button';
  const cancel = el('button', 'ghost', 'Huỷ');
  cancel.type = 'button';
  const sheet = el('div', 'sheet', el('b', '', 'Thêm hiệu ứng mới'), name, bar, note, ok, cancel);
  const back = el('div', 'backdrop', sheet);
  const close = () => back.remove();
  cancel.addEventListener('click', close);
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    cancel.disabled = true;
    ok.textContent = 'Đang tải lên…';
    try {
      const thumb = makeThumb(file); // chạy song song với lúc tải lên
      const out = await upload(file, name.value.trim(), (p) => { bar.firstElementChild.style.width = `${Math.round(p * 100)}%`; });
      const blob = await thumb;
      if (blob && out.name) {
        await fetch(`/r/thumb?name=${encodeURIComponent(out.name)}`, { method: 'POST', headers: { 'X-Key': key }, body: blob }).catch(() => {});
        thumbs.delete(out.name);
      }
      close();
      lastShape = '';
      await refresh();
    } catch (err) {
      note.textContent = err.message;
      note.classList.add('err');
      ok.disabled = false;
      cancel.disabled = false;
      ok.textContent = 'Thử lại';
    }
  });
  document.body.append(back);
  name.select();
}

picker.addEventListener('change', () => {
  const file = picker.files[0];
  picker.value = '';
  if (file) addSheet(file);
});

function draw(state) {
  // Chỉ dựng lại lưới nút khi danh sách nút thay đổi, để không giật khi đang bấm.
  const shape = JSON.stringify([state.buttons, state.effects, state.celebrate, state.camera, state.paused]);
  if (shape === lastShape) return;
  lastShape = shape;
  const mine = state.buttons.map((b) =>
    keyButton(b.name, b.media ? 'film' : b.effect !== 'none' ? b.effect : 'volume', { ruleId: b.id }, true, b.thumb ? b.media : ''));
  const add = el('button', 'key mine add', icon('plus', 28), el('span', '', 'Thêm video từ máy này'));
  add.type = 'button';
  add.addEventListener('click', () => picker.click());
  const mySection = el('section', '', el('h2', '', 'Nút của tôi'), el('div', 'grid', ...mine, add));
  const quick = state.effects.map((e) => keyButton(e.name, e.id, { effect: e.id }, false));
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
  // Camera chuyển động: chỉ hiện khi máy tính đã nối được OBS.
  const CAM = [['zoomin', 'Zoom vào'], ['zoomout', 'Kéo ra'], ['shake', 'Rung'], ['tilt', 'Nghiêng lắc'], ['spin', 'Xoay vòng']];
  const camSection = state.camera
    ? el('section', '', el('h2', '', 'Camera'), el('div', 'grid', ...CAM.map(([id, name]) => keyButton(name, 'camera', { camera: id }, false))))
    : null;
  // Tạm dừng hiệu ứng: quà mới vẫn xếp hàng, bật lại là phát tiếp.
  const paused = state.paused === true;
  const pz = el('button', 'switch-row', el('span', '', 'Tạm dừng hiệu ứng'), el('b', '', paused ? 'Đang dừng' : 'Đang chạy'));
  pz.type = 'button';
  pz.id = 'pause';
  pz.setAttribute('aria-pressed', String(paused));
  pz.addEventListener('click', async () => {
    navigator.vibrate?.(12);
    try { await call('POST', '/r/fire', { paused: !paused }); } catch (err) { if (err.auth) return needPairing(); }
    return refresh();
  });
  app.replaceChildren(...[sw, pz, mySection, camSection, quickSection].filter(Boolean));
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
