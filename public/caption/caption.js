// Trang phụ đề dịch, mở trong Chrome hoặc Edge (không chạy trong cửa sổ Live Effect):
//   - nghe giọng nói bằng bộ nhận dạng có sẵn của trình duyệt (Web Speech API),
//   - dịch bằng bộ dịch chạy ngay trên máy của Chrome (Translator API, Chrome 138+),
//   - gửi câu gốc và bản dịch về Live Effect để hiện lên overlay.
// Cả hai đều miễn phí và không cần khoá API.

const LANGS = [
  ['vi', 'vi-VN', 'Tiếng Việt'], ['en', 'en-US', 'Tiếng Anh'], ['zh', 'zh-CN', 'Tiếng Trung'], ['ko', 'ko-KR', 'Tiếng Hàn'],
  ['ja', 'ja-JP', 'Tiếng Nhật'], ['th', 'th-TH', 'Tiếng Thái'], ['id', 'id-ID', 'Tiếng Indonesia'], ['es', 'es-ES', 'Tiếng Tây Ban Nha'],
  ['fr', 'fr-FR', 'Tiếng Pháp'], ['pt', 'pt-BR', 'Tiếng Bồ Đào Nha'], ['ru', 'ru-RU', 'Tiếng Nga'], ['hi', 'hi-IN', 'Tiếng Hindi'],
];
const nameOf = (code) => LANGS.find((l) => l[0] === code)?.[2] || code;
const $ = (id) => document.getElementById(id);

const saved = (() => { try { return JSON.parse(localStorage.getItem('le-caption') || '{}'); } catch { return {}; } })();
const state = {
  source: LANGS.some((l) => l[0] === saved.source) ? saved.source : 'vi',
  targets: Array.isArray(saved.targets) ? saved.targets.filter((t) => LANGS.some((l) => l[0] === t)).slice(0, 2) : ['en'],
  listening: false,
};
const persist = () => { try { localStorage.setItem('le-caption', JSON.stringify({ source: state.source, targets: state.targets })); } catch { /* không lưu được cũng không sao */ } };

function setStatus(kind, text) {
  $('status').className = `status${kind ? ` ${kind}` : ''}`;
  $('status').textContent = text;
}

// --- Dịch -------------------------------------------------------------------
// Bộ dịch được chuẩn bị ở nền (lần đầu phải tải gói dịch, có thể lâu). Câu nào tới mà bộ
// dịch chưa sẵn sàng thì lên live bằng câu gốc trước: việc dịch không bao giờ được chặn phụ đề.
const translators = new Map(); // "vi>en" -> { tr, state: 'loading' | 'ready' | 'none' }
const TRANSLATE_TIMEOUT = 4000;

function prepare(from, to) {
  const key = `${from}>${to}`;
  if (translators.has(key)) return translators.get(key);
  const slot = { tr: null, state: 'loading' };
  translators.set(key, slot);
  (async () => {
    if (!('Translator' in self)) { slot.state = 'none'; return; }
    const pair = { sourceLanguage: from, targetLanguage: to };
    if ((await self.Translator.availability(pair)) === 'unavailable') { slot.state = 'none'; return; }
    slot.tr = await self.Translator.create({
      ...pair,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => { if (slot.state === 'loading') setStatus('wait', `Đang tải gói dịch ${nameOf(to)}: ${Math.round((e.loaded || 0) * 100)}%. Trong lúc chờ, câu gốc vẫn lên live.`); });
      },
    });
    slot.state = 'ready';
  })().catch(() => { slot.state = 'none'; });
  return slot;
}

const timeout = (ms) => new Promise((r) => { setTimeout(() => r(null), ms); });

async function translateAll(text) {
  return Promise.all(state.targets.filter((to) => to !== state.source).map(async (to) => {
    const slot = prepare(state.source, to);
    if (slot.state !== 'ready') return { lang: to, text: '', why: slot.state };
    const out = await Promise.race([slot.tr.translate(text).catch(() => null), timeout(TRANSLATE_TIMEOUT)]);
    return { lang: to, text: typeof out === 'string' ? out : '', why: out ? '' : 'slow' };
  }));
}

// --- Gửi lên live -----------------------------------------------------------
async function post(body) {
  try {
    const res = await fetch('/api/caption', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await res.json();
  } catch {
    return null;
  }
}

function show(text, lines, interim) {
  const box = $('live');
  box.replaceChildren();
  for (const l of lines.filter((x) => x.text)) {
    const p = document.createElement('p');
    p.className = 'tr';
    p.textContent = l.text;
    box.append(p);
  }
  const src = document.createElement('p');
  src.className = `src${interim ? ' interim' : ''}`;
  src.textContent = text;
  box.append(src);
}

let seq = 0;
async function publish(text) {
  const mine = ++seq;
  // 1) Câu gốc lên live ngay.
  show(text, [], false);
  const out = await post({ text, lines: [], final: true });
  if (!out) { setStatus('err', 'Không gửi được về Live Effect. Kiểm tra ứng dụng đang mở.'); return; }
  if (!out.enabled) { setStatus('wait', 'Phụ đề đang tắt trong Live Effect: vào mục Phụ đề và bật công tắc để hiện lên live.'); return; }
  // 2) Bản dịch bổ sung sau, nếu chưa có câu mới hơn chen vào.
  const lines = await translateAll(text);
  if (mine !== seq) return;
  const done = lines.filter((l) => l.text);
  if (done.length) {
    show(text, done, false);
    await post({ text, lines: done, final: true });
  }
  const missing = lines.filter((l) => !l.text);
  if (!missing.length) setStatus('ok', state.listening ? 'Đang nghe và dịch…' : 'Đã gửi lên live.');
  else if (!('Translator' in self)) setStatus('wait', 'Trình duyệt này chưa có bộ dịch tích hợp (cần Chrome 138 trở lên trên máy tính). Câu gốc vẫn lên live.');
  else if (missing.some((l) => l.why === 'loading')) setStatus('wait', `Đang chuẩn bị bộ dịch ${missing.map((l) => nameOf(l.lang)).join(', ')}. Câu gốc vẫn lên live.`);
  else setStatus('wait', `Chrome chưa dịch được sang ${missing.map((l) => nameOf(l.lang)).join(', ')}. Câu gốc vẫn lên live.`);
}

// --- Nghe giọng nói ---------------------------------------------------------
const SR = self.SpeechRecognition || self.webkitSpeechRecognition;
let rec = null;
let lastInterim = 0;

function startRec() {
  rec = new SR();
  rec.lang = LANGS.find((l) => l[0] === state.source)[1];
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e) => {
    const r = e.results[e.results.length - 1];
    const text = r[0].transcript.trim();
    if (!text) return;
    if (r.isFinal) { publish(text); return; }
    // Câu đang nói dở: hiện ngay câu gốc để khán giả thấy có phản hồi, chưa dịch.
    show(text, [], true);
    const now = Date.now();
    if (now - lastInterim > 350) { lastInterim = now; post({ text, lines: [], final: false }); }
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      state.listening = false;
      paint();
      setStatus('err', 'Chưa được phép dùng micro. Bấm biểu tượng ổ khoá cạnh thanh địa chỉ, cho phép Micro rồi thử lại.');
    } else if (e.error === 'audio-capture') {
      state.listening = false;
      paint();
      setStatus('err', 'Không tìm thấy micro. Cắm micro rồi thử lại.');
    }
  };
  // Chrome tự dừng nghe sau một lúc im lặng: nối lại ngay nếu người dùng chưa bấm dừng.
  rec.onend = () => { if (state.listening) setTimeout(() => { if (state.listening) { try { startRec(); } catch { /* thử lại ở lần sau */ } } }, 250); };
  rec.start();
}

function paint() {
  const b = $('toggle');
  b.textContent = state.listening ? 'Dừng nghe' : 'Bắt đầu nghe';
  b.setAttribute('aria-pressed', String(state.listening));
}

$('toggle').addEventListener('click', async () => {
  if (state.listening) {
    state.listening = false;
    rec?.stop();
    paint();
    setStatus('', 'Đã dừng.');
    return;
  }
  if (!SR) { setStatus('err', 'Trình duyệt này không nghe được giọng nói. Hãy mở trang này bằng Chrome hoặc Edge.'); return; }
  state.listening = true;
  paint();
  setStatus('ok', 'Đang nghe… hãy nói một câu.');
  // Tải sẵn gói dịch ngay lúc bấm nút (Chrome chỉ cho tải khi có thao tác của người dùng).
  state.targets.forEach((to) => { if (to !== state.source) prepare(state.source, to); });
  try { startRec(); } catch { state.listening = false; paint(); setStatus('err', 'Không bật được micro.'); }
});

$('manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (text) publish(text);
});

// --- Dịch bình luận của khán giả ---------------------------------------------
// Live Effect gửi từng bình luận sang đây; trang nhận diện ngôn ngữ, nếu khác tiếng của
// bạn thì dịch sang tiếng của bạn rồi gửi trả. Bình luận cùng tiếng thì trả về rỗng.
let detector = null;
async function detect(text) {
  if (!('LanguageDetector' in self) || text.trim().length < 4) return '';
  try {
    detector = detector || await self.LanguageDetector.create();
    const [best] = await detector.detect(text);
    return best && best.confidence > 0.5 ? String(best.detectedLanguage).split('-')[0] : '';
  } catch {
    return '';
  }
}

async function translateChat({ id, text }) {
  let out = '';
  const from = await detect(text);
  if (from && from !== 'und' && from !== state.source) {
    const slot = prepare(from, state.source);
    if (slot.state === 'ready') {
      const r = await Promise.race([slot.tr.translate(text).catch(() => null), timeout(2500)]);
      if (typeof r === 'string' && r.trim() && r.trim().toLowerCase() !== text.trim().toLowerCase()) out = r.trim();
    }
  }
  fetch('/api/caption/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, text: out }) }).catch(() => {});
  if (out) {
    const box = $('chatlog');
    const row = document.createElement('p');
    row.textContent = `${text}  →  ${out}`;
    box.prepend(row);
    while (box.children.length > 6) box.lastElementChild.remove();
    $('chatcard').hidden = false;
  }
}

function listen() {
  const ws = new WebSocket(`ws://${location.host}/ws?role=caption`);
  ws.onmessage = (e) => {
    try { const msg = JSON.parse(e.data); if (msg.type === 'chat') translateChat(msg); } catch { /* bỏ qua tin hỏng */ }
  };
  ws.onclose = () => setTimeout(listen, 2000);
}
listen();

// --- Chọn ngôn ngữ ----------------------------------------------------------
for (const [code, , name] of LANGS) $('source').append(new Option(name, code));
$('source').value = state.source;
$('source').addEventListener('change', (e) => {
  state.source = e.target.value;
  persist();
  if (state.listening) { rec?.stop(); } // onend sẽ nối lại với ngôn ngữ mới
});
for (const [code, , name] of LANGS) {
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.value = code;
  box.checked = state.targets.includes(code);
  box.addEventListener('change', () => {
    if (box.checked && state.targets.length >= 2) {
      box.checked = false;
      setStatus('wait', 'Chỉ chọn tối đa 2 ngôn ngữ, để phụ đề không che mất hình.');
      return;
    }
    state.targets = [...document.querySelectorAll('#targets input:checked')].map((i) => i.value);
    persist();
  });
  label.append(box, name);
  $('targets').append(label);
}
paint();
if (!SR) setStatus('wait', 'Trình duyệt này không nghe được giọng nói; bạn vẫn gõ thử được. Để nói, hãy mở bằng Chrome hoặc Edge.');
