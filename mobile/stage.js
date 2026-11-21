// Màn hình "sân khấu" trên điện thoại làm camera chính: hình camera, hiệu ứng phủ lên,
// và hiệu ứng bay SAU LƯNG người (tách người khỏi nền ngay trên máy). TikTok phát lại
// màn hình này bằng chế độ live chia sẻ màn hình, nên sau khi bắt đầu không được có nút nào.
import { keyedCanvas } from './vendor/key.js';

const VERSION = '0.3';
const $ = (id) => document.getElementById(id);
const cam = $('cam');
const person = $('person');
const pctx = person.getContext('2d');
const layers = { front: $('front'), behind: $('behind') };
const params = new URLSearchParams(location.search);
let facing = 'user';
let stream = null;
let segmenter = null;
let segmenterFailed = false;
let behindCount = 0; // số hiệu ứng "sau lưng" đang chạy; chỉ tách người khi > 0 để máy đỡ nóng
let wake = null;

// Trạng thái để kiểm thử tự động và để xem khi cần gỡ lỗi (?debug=1).
const state = window.__stage = { started: false, playing: 0, segmenter: 'chưa tải', delegate: '', unlocked: null, muted: false, lastWhere: '', touches: 0, segFrames: 0, cover: 0, segMs: 0, fallback: '', lastError: '' };
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ----- Camera ---------------------------------------------------------------
async function openCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  });
  cam.srcObject = stream;
  cam.classList.toggle('mirror', facing === 'user');
  person.classList.toggle('mirror', facing === 'user');
  await cam.play();
}

// ----- Tách người khỏi nền ----------------------------------------------------
async function loadSegmenter() {
  if (segmenter || segmenterFailed) return segmenter;
  try {
    state.segmenter = 'đang tải';
    const { FilesetResolver, ImageSegmenter } = await import('./vendor/mediapipe/vision_bundle.mjs');
    const files = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
    const make = (delegate) => ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: './model/selfie_segmenter.tflite', delegate },
      runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false,
    });
    // Safari trên iPhone đọc kết quả từ card đồ hoạ không ổn định (mặt nạ ra sai), nên chạy trên CPU.
    const want = params.get('delegate') === 'gpu' ? 'GPU' : params.get('delegate') === 'cpu' || IOS ? 'CPU' : 'GPU';
    try { segmenter = await make(want); state.delegate = want; } catch { segmenter = await make('CPU'); state.delegate = 'CPU'; }
    state.segmenter = 'sẵn sàng';
  } catch (err) {
    segmenterFailed = true;
    state.segmenter = 'lỗi';
    state.lastError = String(err?.message || err);
  }
  return segmenter;
}

const maskCanvas = document.createElement('canvas');
const mctx = maskCanvas.getContext('2d');
let maskImage = null;
let lastSeg = 0;
let badFrames = 0;

/** Tách người không dùng được: đưa mọi hiệu ứng đang ở sau lưng ra phía trước, để không bao giờ bị trống. */
function giveUpBehind(why) {
  state.fallback = why;
  badFrames = 0;
  for (const node of [...layers.behind.children]) layers.front.append(node);
  for (const entry of players.values()) if (entry.where === 'behind') entry.where = 'front';
  behindCount = 0;
  pctx.clearRect(0, 0, person.width, person.height);
}

/** Vẽ riêng phần người (cắt theo mặt nạ) lên lớp nằm trên hiệu ứng "sau lưng". */
function drawPerson(now) {
  requestAnimationFrame(drawPerson);
  if (!behindCount || !segmenter || cam.readyState < 2) {
    if (person.width && !behindCount) { pctx.clearRect(0, 0, person.width, person.height); }
    return;
  }
  if (now - lastSeg < 45) return; // khoảng 20 lần mỗi giây là đủ mượt
  lastSeg = now;
  let sum = 0;
  try {
    const t0 = performance.now();
    const result = segmenter.segmentForVideo(cam, now);
    const masks = result.confidenceMasks || [];
    const mask = masks[masks.length - 1]; // mô hình 2 lớp thì lớp cuối là người
    if (!mask) return;
    const { width: mw, height: mh } = mask;
    if (maskCanvas.width !== mw || maskCanvas.height !== mh) {
      maskCanvas.width = mw; maskCanvas.height = mh;
      maskImage = mctx.createImageData(mw, mh);
    }
    const conf = mask.getAsFloat32Array();
    const px = maskImage.data;
    for (let i = 0; i < conf.length; i++) {
      // Làm gắt mép: dưới 0,35 coi là nền, trên 0,65 coi là người, giữa thì mờ dần.
      const a = Math.min(1, Math.max(0, (conf[i] - 0.35) / 0.3)) || 0;
      px[i * 4 + 3] = a * 255;
      sum += a;
    }
    mctx.putImageData(maskImage, 0, 0);
    for (const m of masks) m.close?.();
    state.cover = sum / conf.length;
    state.segMs = Math.round(performance.now() - t0);
  } catch (err) {
    state.lastError = `tách người: ${err?.message || err}`;
    giveUpBehind('lỗi khi tách người');
    return;
  }
  // Mặt nạ nói "cả khung hình là người" thì chắc chắn sai: người sẽ che kín hiệu ứng.
  badFrames = state.cover > 0.93 ? badFrames + 1 : 0;
  if (badFrames >= 6) { giveUpBehind('mặt nạ phủ kín khung hình'); return; }

  // Khung vẽ khớp với cách camera đang được cắt cho vừa màn hình (object-fit: cover).
  const W = person.clientWidth, H = person.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (person.width !== Math.round(W * dpr)) { person.width = Math.round(W * dpr); person.height = Math.round(H * dpr); }
  const vw = cam.videoWidth, vh = cam.videoHeight;
  const scale = Math.max(person.width / vw, person.height / vh);
  const dw = vw * scale, dh = vh * scale;
  const dx = (person.width - dw) / 2, dy = (person.height - dh) / 2;
  pctx.globalCompositeOperation = 'source-over';
  pctx.clearRect(0, 0, person.width, person.height);
  pctx.imageSmoothingEnabled = true;
  pctx.drawImage(maskCanvas, dx, dy, dw, dh);
  pctx.globalCompositeOperation = 'source-in';
  pctx.drawImage(cam, dx, dy, dw, dh);
  state.segFrames += 1;
}

// ----- Hiệu ứng ----------------------------------------------------------------
const EFFECTS = {
  rong: { src: './media/rong-vang.mp4', key: 'black', text: 'Rồng vàng giáng lâm' },
};

function showAlert(text) {
  const el = $('alert');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(showAlert.t);
  showAlert.t = setTimeout(() => el.classList.remove('on'), 4200);
}

// Mỗi hiệu ứng có sẵn một trình phát, được "mở khoá" ngay trong cú bấm Bắt đầu. Trình duyệt
// trên điện thoại (nhất là iPhone) chỉ cho phát có tiếng khi lệnh phát đến từ một cú bấm thật;
// trình phát đã được mở khoá một lần thì về sau phát lại bằng cử chỉ nào cũng có tiếng.
const players = new Map(); // id -> { video, node, where, timer }

function unlockPlayers() {
  for (const [id, fx] of Object.entries(EFFECTS)) {
    if (players.has(id)) continue;
    const video = document.createElement('video');
    video.src = fx.src;
    video.playsInline = true;
    video.preload = 'auto';
    const entry = { video, node: keyedCanvas(video, fx.key) || video, where: null, timer: 0 };
    players.set(id, entry);
    video.addEventListener('ended', () => stopPlayer(id));
    video.addEventListener('error', () => { state.lastError = `clip: ${video.error?.message || 'không phát được'}`; stopPlayer(id); });
    const p = video.play();
    p?.then(() => { if (!entry.where) { video.pause(); video.currentTime = 0; } state.unlocked = true; })
      .catch((err) => { state.unlocked = false; state.lastError = `mở khoá tiếng: ${err?.name || err}`; });
  }
}

function stopPlayer(id) {
  const entry = players.get(id);
  if (!entry?.where) return;
  clearTimeout(entry.timer);
  entry.video.pause();
  entry.node.remove();
  if (entry.where === 'behind' && behindCount > 0) behindCount -= 1;
  entry.where = null;
  state.playing -= 1;
}

/** Phát một clip hiệu ứng (đã xoá nền) ở lớp phía trước hoặc sau lưng người. */
async function play(id, where = 'front') {
  const fx = EFFECTS[id];
  if (!fx || !state.started) return;
  if (!players.has(id)) unlockPlayers();
  const entry = players.get(id);
  stopPlayer(id); // đang phát dở thì phát lại từ đầu
  const { video } = entry;
  entry.where = 'front';
  state.playing += 1;
  layers.front.append(entry.node);
  try { video.currentTime = 0; } catch { /* chưa tải xong */ }
  video.muted = false;
  video.play().catch(() => { video.muted = true; state.muted = true; return video.play(); })
    .catch((err) => { state.lastError = `phát clip: ${err?.name || err}`; stopPlayer(id); });
  entry.timer = setTimeout(() => stopPlayer(id), 20000);
  showAlert(fx.text);
  state.lastWhere = where;
  if (where !== 'behind') return;
  // Không tách được người thì clip cứ ở phía trước, còn hơn không có gì.
  if (!(await loadSegmenter())) { state.fallback = 'không tải được bộ tách người'; return; }
  if (entry.where !== 'front') return; // đã dừng trong lúc chờ
  state.fallback = '';
  entry.where = 'behind';
  behindCount += 1;
  layers.behind.append(entry.node);
}
window.__play = play;

// ----- Cử chỉ: không có nút nào trên màn hình live -----------------------------------
let holdTimer = null;
$('stage').addEventListener('touchstart', (e) => {
  e.preventDefault();
  clearTimeout(holdTimer);
  const n = e.touches.length;
  state.touches = n;
  if (n >= 3) { holdTimer = setTimeout(backToSetup, 1000); return; }
  // Chờ một nhịp ngắn để phân biệt 1 ngón với 2 ngón.
  clearTimeout(play.t);
  play.t = setTimeout(() => play('rong', n === 2 ? 'behind' : 'front'), 90);
}, { passive: false });
$('stage').addEventListener('touchend', () => clearTimeout(holdTimer));
$('stage').addEventListener('click', (e) => { if (e.detail && !('ontouchstart' in window)) play('rong', e.shiftKey ? 'behind' : 'front'); });

// ----- Bắt đầu / quay về ----------------------------------------------------------
async function keepAwake() {
  try { wake = await navigator.wakeLock?.request('screen'); } catch { /* máy không hỗ trợ */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.started) keepAwake(); });

function backToSetup() {
  state.started = false;
  $('setup').hidden = false;
  document.exitFullscreen?.().catch(() => {});
  wake?.release?.().catch(() => {});
}

for (const b of document.querySelectorAll('[data-facing]')) {
  b.addEventListener('click', () => {
    facing = b.dataset.facing;
    for (const x of document.querySelectorAll('[data-facing]')) x.setAttribute('aria-pressed', String(x === b));
  });
}

$('go').addEventListener('click', async () => {
  const go = $('go');
  go.disabled = true;
  $('err').textContent = '';
  unlockPlayers(); // phải gọi ngay trong cú bấm, trước khi chờ bất cứ thứ gì
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Trình duyệt này không mở được camera. Hãy dùng Chrome (Android) hoặc Safari (iPhone).');
    await openCamera();
    $('setup').hidden = true;
    state.started = true;
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    keepAwake();
    loadSegmenter(); // tải sẵn để lần chạm 2 ngón đầu tiên không phải chờ
    const auto = Number(params.get('auto'));
    if (auto >= 5) setInterval(() => play('rong', 'behind'), auto * 1000);
  } catch (err) {
    $('err').textContent = err?.name === 'NotAllowedError'
      ? 'Bạn chưa cho phép dùng camera. Vào cài đặt trang của trình duyệt, cho phép Camera rồi bấm lại.'
      : (err?.message || 'Không mở được camera.');
  } finally {
    go.disabled = false;
  }
});

requestAnimationFrame(drawPerson);

// ?debug=1: hiện tốc độ tách người ở góc màn hình, để đo trên máy thật (đừng bật khi live).
if (params.get('debug')) {
  const box = document.createElement('p');
  box.style.cssText = 'position:fixed;left:8px;right:8px;top:calc(env(safe-area-inset-top) + 8px);z-index:9;margin:0;padding:4px 8px;border-radius:8px;background:rgba(0,0,0,.6);color:#9f9;font:12px/1.4 monospace;pointer-events:none';
  document.body.append(box);
  let last = 0;
  setInterval(() => {
    box.hidden = !state.started; // không đè lên màn hình cài đặt
    box.textContent = `chạm: ${state.touches} ngón → ${state.lastWhere || '-'} · tiếng: ${state.unlocked === null ? '?' : state.unlocked ? 'mở' : 'KHOÁ'}${state.muted ? ' (đang tắt tiếng)' : ''} · tách người: ${state.segmenter} (${state.delegate}) · ${state.segFrames - last} khung/giây · ${state.segMs} ms · người chiếm ${Math.round(state.cover * 100)}% · đang phát: ${state.playing}${state.fallback ? ` · đã chuyển ra trước: ${state.fallback}` : ''}${state.lastError ? ` · lỗi: ${state.lastError}` : ''}`;
    last = state.segFrames;
  }, 1000);
}

// ----- Kiểm tra máy: chạy từng bước và ghi kết quả ra màn hình để chụp gửi lại -----------
async function diagnose() {
  const out = $('diag');
  const lines = [];
  const say = (ok, text) => { lines.push(`${ok === null ? '•' : ok ? '✓' : '✗'} ${text}`); out.textContent = lines.join('\n'); };
  const step = async (name, fn, ms = 20000) => {
    try {
      const r = await Promise.race([fn(), new Promise((_, no) => setTimeout(() => no(new Error(`quá ${ms / 1000} giây`)), ms))]);
      say(true, `${name}${r ? `: ${r}` : ''}`);
      return true;
    } catch (err) { say(false, `${name}: ${err?.name && err.name !== 'Error' ? `${err.name} ` : ''}${err?.message || err}`); return false; }
  };
  out.hidden = false;
  unlockPlayers();
  const ua = navigator.userAgent;
  const inApp = /FBAN|FBAV|Instagram|Zalo|Line\/|MicroMessenger|TikTok|musical_ly|BytedanceWebview/i.test(ua);
  say(null, `Bản ${VERSION} · ${IOS ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : 'máy khác'} · ${(/(CriOS|Chrome|Version|Firefox|SamsungBrowser)\/[\d.]+/.exec(ua) || ['?'])[0]} · màn ${innerWidth}×${innerHeight}`);
  say(!inApp, inApp ? 'Đang mở trong trình duyệt của ứng dụng khác (Zalo, Facebook, TikTok…): hãy mở bằng Chrome hoặc Safari' : 'Mở bằng trình duyệt thường');
  say(window.isSecureContext, 'Kết nối an toàn (https)');
  const camOk = await step('Camera', async () => { await openCamera(); return `${cam.videoWidth}×${cam.videoHeight}`; });
  await step('Xoá nền clip (WebGL)', async () => {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) throw new Error('máy không có WebGL');
    return String(gl.getParameter(gl.VERSION)).slice(0, 28);
  });
  await step('Tải clip rồng', async () => {
    const v = players.get('rong').video;
    if (v.readyState < 2) await new Promise((ok, no) => { v.addEventListener('loadeddata', ok, { once: true }); v.addEventListener('error', () => no(new Error(v.error?.message || 'không giải mã được')), { once: true }); v.load(); });
    return `${v.videoWidth}×${v.videoHeight}, ${v.duration.toFixed(1)} giây`;
  });
  await step('Phát có tiếng', async () => {
    await new Promise((r) => setTimeout(r, 600));
    if (state.unlocked === false) throw new Error(state.lastError || 'trình duyệt chặn');
    return state.unlocked ? 'đã mở khoá' : 'chưa rõ';
  });
  const segOk = await step('Tải bộ tách người', async () => {
    const t0 = performance.now();
    if (!(await loadSegmenter())) throw new Error(state.lastError || 'không tải được');
    return `${state.delegate}, ${Math.round(performance.now() - t0)} ms`;
  }, 60000);
  if (camOk && segOk) {
    await step('Tách người trên hình camera', async () => {
      const times = []; let cover = 0; let size = '';
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 120));
        const t0 = performance.now();
        const res = segmenter.segmentForVideo(cam, performance.now());
        const masks = res.confidenceMasks || [];
        const m = masks[masks.length - 1];
        const a = m.getAsFloat32Array();
        let n = 0; for (let k = 0; k < a.length; k++) if (a[k] > 0.5) n += 1;
        cover = n / a.length;
        size = `${m.width}×${m.height}, ${masks.length} lớp`;
        for (const x of masks) x.close?.();
        times.push(Math.round(performance.now() - t0));
      }
      const verdict = cover > 0.93 ? ' → SAI: coi cả khung là người' : cover < 0.02 ? ' → không thấy người (hãy đứng trước camera, đủ sáng)' : ' → ổn';
      return `${size}, ${times.join('/')} ms, người chiếm ${Math.round(cover * 100)}%${verdict}`;
    });
  }
  say(null, 'Xong. Chụp màn hình này gửi lại.');
  stream?.getTracks().forEach((t) => t.stop());
}
$('check').addEventListener('click', async () => { $('check').disabled = true; try { await diagnose(); } finally { $('check').disabled = false; } });
