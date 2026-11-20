import { Fx } from '/overlay/fx.js';
import { playSound, stopSounds } from '/overlay/sound.js';
import { keyedCanvas } from '/overlay/key.js';
import { Reactive } from '/overlay/react.js';

// Tham số trên link:
//   ?preview=1            khung xem thử trong bảng điều khiển (tắt tiếng)
//   ?layers=fx,alerts...  chỉ hiện một số lớp, dùng khi muốn tách thành nhiều nguồn trong OBS
const params = new URLSearchParams(location.search);
const preview = params.get('preview') === '1';
const layers = new Set((params.get('layers') || 'caption,fx,alerts,media,chat,goal,top,qr').split(','));
const has = (name) => layers.has(name);

const $ = (id) => document.getElementById(id);
const fx = new Fx($('fx'));
const react = new Reactive($('react'));
const els = { alerts: $('alerts'), media: $('media'), chat: $('chat'), goal: $('goal'), border: $('border'), top: $('top'), qr: $('qr') };
const nf = new Intl.NumberFormat('vi-VN');
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');

let widgets = {
  alerts: { enabled: true, position: 'top' },
  chat: { enabled: false, position: 'bottom-left', max: 6 },
  goal: { enabled: false, position: 'top' },
  top: { enabled: false, position: 'top-left', max: 3, title: '' },
  qr: { enabled: false, position: 'bottom-right', title: '', svg: '', bank: '', holder: '' },
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

// --- Bảng top tặng quà ------------------------------------------------------
function setTop(rows) {
  const list = rows.map((r, i) => {
    const li = document.createElement('li');
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = String(i + 1);
    li.append(rank);
    const avatar = httpUrl(r.avatar);
    if (avatar) {
      const im = document.createElement('img');
      im.alt = '';
      im.referrerPolicy = 'no-referrer';
      im.src = avatar;
      im.onerror = () => im.remove();
      li.append(im);
    }
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = r.name || 'Ẩn danh';
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = nf.format(r.coins || 0);
    li.append(who, num);
    return li;
  });
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Chưa có ai, bạn mở màn nhé!';
    list.push(li);
  }
  $('top-rows').replaceChildren(...list);
}

function applyWidgets(next) {
  widgets = { ...widgets, ...next };
  els.top.dataset.pos = widgets.top.position;
  els.top.hidden = !(has('top') && widgets.top.enabled);
  $('top-title').textContent = widgets.top.title;
  els.qr.dataset.pos = widgets.qr.position;
  els.qr.hidden = !(has('qr') && widgets.qr.enabled && widgets.qr.svg);
  $('qr-title').textContent = widgets.qr.title;
  // Mã QR là SVG do chính ứng dụng tạo từ số tài khoản; không có nội dung từ người xem.
  if ($('qr-code').dataset.svg !== widgets.qr.svg) {
    $('qr-code').innerHTML = widgets.qr.svg || '';
    $('qr-code').dataset.svg = widgets.qr.svg || '';
  }
  $('qr-line').textContent = [widgets.qr.holder, widgets.qr.bank].filter(Boolean).join('\n');
  els.alerts.dataset.pos = widgets.alerts.position;
  els.chat.dataset.pos = widgets.chat.position;
  els.chat.hidden = !(has('chat') && widgets.chat.enabled);
  els.goal.dataset.pos = widgets.goal.position;
  els.goal.hidden = !(has('goal') && widgets.goal.enabled);
  while (els.chat.children.length > widgets.chat.max) els.chat.firstElementChild.remove();
}

// --- Phụ đề dịch ------------------------------------------------------------
let captionCfg = { enabled: false, showOriginal: true, position: 'bottom', size: 2 };
let captionTimer = null;
const captionEl = $('caption');

function applyCaptions(cfg) {
  if (!cfg) return;
  captionCfg = cfg;
  captionEl.dataset.pos = cfg.position;
  captionEl.dataset.size = cfg.size;
  if (!cfg.enabled) captionEl.hidden = true;
}

function showCaption({ text, lines = [], final }) {
  if (!has('caption') || !captionCfg.enabled || !text) return;
  // Câu đang nói dở chưa có bản dịch: giữ bản dịch của câu trước cho khỏi nhấp nháy.
  if (!final && captionEl.querySelector('.tr') && !lines.length) {
    const src = captionEl.querySelector('.src');
    if (src) src.textContent = text;
  } else {
    const rows = lines.map((l) => { const p = document.createElement('p'); p.className = 'tr'; p.textContent = l.text; return p; });
    if (captionCfg.showOriginal || !rows.length) {
      const p = document.createElement('p');
      p.className = rows.length ? 'src' : 'tr';
      p.textContent = text;
      rows.push(p);
    }
    captionEl.replaceChildren(...rows);
  }
  captionEl.hidden = false;
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => { captionEl.hidden = true; }, 7000);
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
    case 'widgets':
      applyWidgets(msg.widgets);
      if (has('fx')) react.setConfig(msg.music);
      applyCaptions(msg.captions);
      break;
    case 'audio': if (has('fx')) react.onAudio(msg); break;
    case 'caption': showCaption(msg); break;
    case 'chat': addChat(msg); break;
    case 'goal': setGoal(msg); break;
    case 'top': setTop(Array.isArray(msg.rows) ? msg.rows : []); break;
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
window.__overlay = { fx, react, onMessage };
