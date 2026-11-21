// Màn hình "sân khấu" trên điện thoại làm camera chính: hình camera, hiệu ứng phủ lên,
// và hiệu ứng bay SAU LƯNG người (tách người khỏi nền ngay trên máy). TikTok phát lại
// màn hình này bằng chế độ live chia sẻ màn hình, nên sau khi bắt đầu không được có nút nào.
import { keyedCanvas } from './vendor/key.js';

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
const state = window.__stage = { started: false, playing: 0, segmenter: 'chưa tải', delegate: '', segFrames: 0, cover: 0, segMs: 0, fallback: '', lastError: '' };
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

/** Phát một clip hiệu ứng (đã xoá nền) ở lớp phía trước hoặc sau lưng người. */
async function play(id, where = 'front') {
  const fx = EFFECTS[id];
  if (!fx || !state.started) return;
  const video = document.createElement('video');
  video.src = fx.src;
  video.playsInline = true;
  video.preload = 'auto';
  // Gọi phát ngay trong lúc còn hiệu lực của cú chạm (iPhone chặn tiếng nếu gọi muộn).
  const started = video.play().catch(() => { video.muted = true; return video.play(); });
  showAlert(fx.text);
  state.playing += 1;
  let behind = false;
  let done = false;
  const node = keyedCanvas(video, fx.key) || video;
  const finish = () => {
    if (done) return;
    done = true;
    node.stop?.();
    node.remove();
    video.removeAttribute('src');
    video.load();
    state.playing -= 1;
    if (behind && behindCount > 0) behindCount -= 1;
  };
  video.addEventListener('ended', finish);
  video.addEventListener('error', () => { state.lastError = `clip: ${video.error?.message || 'không phát được'}`; finish(); });
  setTimeout(finish, 20000);
  // Không tách được người thì vẫn phát ở phía trước, còn hơn không có gì.
  if (where === 'behind' && !(await loadSegmenter())) { where = 'front'; state.fallback = 'không tải được bộ tách người'; }
  if (done) return;
  if (where === 'behind') { behind = true; behindCount += 1; state.fallback = ''; }
  layers[where].append(node);
  started.catch(finish);
}
window.__play = play;

// ----- Cử chỉ: không có nút nào trên màn hình live -----------------------------------
let holdTimer = null;
$('stage').addEventListener('touchstart', (e) => {
  e.preventDefault();
  clearTimeout(holdTimer);
  const n = e.touches.length;
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
    box.textContent = `tách người: ${state.segmenter} (${state.delegate}) · ${state.segFrames - last} khung/giây · ${state.segMs} ms · người chiếm ${Math.round(state.cover * 100)}% · đang phát: ${state.playing}${state.fallback ? ` · đã chuyển ra trước: ${state.fallback}` : ''}${state.lastError ? ` · lỗi: ${state.lastError}` : ''}`;
    last = state.segFrames;
  }, 1000);
}
