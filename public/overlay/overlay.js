import { Fx } from '/overlay/fx.js';
import { playSound, stopSounds } from '/overlay/sound.js';
import { keyedCanvas } from '/overlay/key.js';

// Tham số trên link:
//   ?preview=1            khung xem thử trong bảng điều khiển (tắt tiếng)
//   ?layers=fx,alerts...  chỉ hiện một số lớp, dùng khi muốn tách thành nhiều nguồn trong OBS
const params = new URLSearchParams(location.search);
const preview = params.get('preview') === '1';
const layers = new Set((params.get('layers') || 'fx,alerts,media,chat,goal').split(','));
const has = (name) => layers.has(name);

const $ = (id) => document.getElementById(id);
const fx = new Fx($('fx'));
const els = { alerts: $('alerts'), media: $('media'), chat: $('chat'), goal: $('goal'), border: $('border') };
const nf = new Intl.NumberFormat('vi-VN');
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');

let widgets = {
  alerts: { enabled: true, position: 'top' },
  chat: { enabled: false, position: 'bottom-left', max: 6 },
  goal: { enabled: false, position: 'top' },
};

// --- Thông báo: hiện lần lượt từng cái -------------------------------------
const alertQueue = [];
let alertBusy = false;

function nextAlert() {
  if (alertBusy || !alertQueue.length) return;
  alertBusy = true;
  const item = alertQueue.shift();
  const node = document.createElement('div');
  node.className = 'alert';
  const avatar = httpUrl(item.avatar);
  if (avatar) {
    const im = document.createElement('img');
    im.alt = '';
    im.referrerPolicy = 'no-referrer';
    im.src = avatar;
    im.onerror = () => { im.remove(); node.classList.add('no-avatar'); };
    node.append(im);
  } else {
    node.classList.add('no-avatar');
  }
  const span = document.createElement('span');
  span.textContent = item.text;
  node.append(span);
  els.alerts.replaceChildren(node);
  // Hàng chờ dài thì rút ngắn thời gian hiện để không bị dồn.
  const seconds = alertQueue.length > 3 ? Math.min(item.duration, 2.2) : item.duration;
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => {
      node.remove();
      alertBusy = false;
      nextAlert();
    }, 260);
  }, seconds * 1000);
}

function pushAlert(text, avatar, duration) {
  if (!has('alerts') || !widgets.alerts.enabled || !text) return;
  if (alertQueue.length >= 25) alertQueue.shift();
  alertQueue.push({ text, avatar, duration: Math.min(Math.max(duration, 2), 8) });
  nextAlert();
}

// --- Hình / video bật lên -------------------------------------------------
const mediaQueue = [];
let mediaBusy = false;
let currentMediaFinish = null;

function nextMedia() {
  if (mediaBusy || !mediaQueue.length) return;
  mediaBusy = true;
  const { name, duration, fit, key } = mediaQueue.shift();
  const src = `/media/${encodeURIComponent(name)}`;
  const isVideo = /\.(webm|mp4)$/i.test(name);
  const source = document.createElement(isVideo ? 'video' : 'img');
  // Video cần xoá nền thì vẽ qua canvas; phần tử video gốc chỉ để giải mã và phát tiếng.
  const keyed = isVideo && key !== 'none' ? keyedCanvas(source, key) : null;
  const node = keyed || source;
  node.className = fit === 'center' ? 'center' : 'cover';
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    node.classList.add('out');
    setTimeout(() => {
      keyed?.stop();
      if (isVideo) { source.pause(); source.removeAttribute('src'); source.load(); }
      node.remove();
      mediaBusy = false;
      nextMedia();
    }, 240);
  };
  currentMediaFinish = finish;
  source.onerror = finish;
  if (isVideo) {
    source.playsInline = true;
    source.muted = preview;
    source.onended = finish;
    setTimeout(finish, 120000); // chặn video quá dài chiếm màn hình: tối đa 2 phút
  } else {
    source.alt = '';
    setTimeout(finish, duration * 1000);
  }
  source.src = src;
  els.media.replaceChildren(node);
  if (isVideo) source.play().catch(() => { source.muted = true; source.play().catch(finish); });
}

function pushMedia(name, duration, fit, key) {
  if (!has('media') || !name) return;
  if (mediaQueue.length >= 10) return;
  mediaQueue.push({ name, duration, fit, key: key || 'none' });
  nextMedia();
}

// --- Viền sáng -------------------------------------------------------------
let borderTimer = null;
function flashBorder(duration) {
  els.border.classList.add('on');
  clearTimeout(borderTimer);
  borderTimer = setTimeout(() => els.border.classList.remove('on'), duration * 1000);
}

// --- Khung bình luận và thanh mục tiêu ------------------------------------
function addChat({ user, text }) {
  if (!has('chat') || !widgets.chat.enabled || !text) return;
  const row = document.createElement('div');
  row.className = 'msg';
  const b = document.createElement('b');
  b.textContent = user || 'Khán giả';
  row.append(b, document.createTextNode(String(text).slice(0, 200)));
  els.chat.append(row);
  while (els.chat.children.length > widgets.chat.max) els.chat.firstElementChild.remove();
}

function setGoal({ value = 0, target = 1, title = '' }) {
  $('goal-title').textContent = title;
  $('goal-num').textContent = `${nf.format(value)} / ${nf.format(target)}`;
  $('goal-fill').style.width = `${Math.min(100, (value / target) * 100)}%`;
  els.goal.classList.toggle('done', value >= target);
}

function applyWidgets(next) {
  widgets = { ...widgets, ...next };
  els.alerts.dataset.pos = widgets.alerts.position;
  els.chat.dataset.pos = widgets.chat.position;
  els.chat.hidden = !(has('chat') && widgets.chat.enabled);
  els.goal.dataset.pos = widgets.goal.position;
  els.goal.hidden = !(has('goal') && widgets.goal.enabled);
  while (els.chat.children.length > widgets.chat.max) els.chat.firstElementChild.remove();
}

function clearAll() {
  fx.clear();
  alertQueue.length = 0;
  mediaQueue.length = 0;
  currentMediaFinish?.();
  els.alerts.replaceChildren();
  alertBusy = false;
  mediaBusy = false;
  els.border.classList.remove('on');
  stopSounds();
}

function onMessage(msg) {
  switch (msg.type) {
    case 'fx':
      if (has('fx')) {
        if (msg.effect === 'border') flashBorder(msg.duration);
        else if (msg.effect && msg.effect !== 'none') {
          fx.play(msg.effect, { intensity: msg.intensity, duration: msg.duration, image: httpUrl(msg.image) });
        }
        playSound(msg.sound, preview);
      }
      pushAlert(msg.alert, msg.avatar, msg.duration);
      pushMedia(msg.media, msg.duration, msg.mediaFit, msg.mediaKey);
      break;
    case 'widgets': applyWidgets(msg.widgets); break;
    case 'chat': addChat(msg); break;
    case 'goal': setGoal(msg); break;
    case 'clear': clearAll(); break;
    default: break;
  }
}

// --- Kết nối tới ứng dụng, tự nối lại khi ứng dụng khởi động lại ---------
let retry = 500;
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws?role=overlay${preview ? '&preview=1' : ''}`);
  ws.onopen = () => { retry = 500; };
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch { /* bỏ qua tin hỏng */ }
  };
  ws.onclose = () => {
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 5000);
  };
}
applyWidgets(widgets);
connect();

// Cho phép kiểm thử tự động đọc trạng thái.
window.__overlay = { fx, onMessage };
