// Bảng điều khiển Live Effect. Không dùng framework: một hàm h() dựng DOM,
// mỗi mục là một hàm vẽ lại khi cấu trúc thay đổi; gõ chữ thì chỉ lưu, không vẽ lại.

import { icon } from '/remote/icons.js';
import { AudioReactive, listInputs } from '/panel/audio.js';
import { makeThumb } from '/remote/thumb.js';

/** Dựng phần tử: h('div.card', { onclick }, con1, con2). Chuỗi luôn thành text, không bao giờ là HTML. */
function h(spec, props, ...kids) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const S = {
  config: null, status: null, media: [], gifts: [], giftQuery: '', queue: { paused: false, current: null, waiting: [] }, catalog: null, overlayUrl: '', hookUrl: '', capabilities: {}, log: [], remote: null,
  fans: { size: 0, top: [] }, openTier: null,
  view: 'home', openRule: null, guide: 'obs', intensity: 2, obs: null, thumbStamp: Date.now(),
};
const fmtVnd = (n) => `${new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0))}đ`;
const main = document.getElementById('main');
const nf = new Intl.NumberFormat('vi-VN');
const nameOf = (list, id, fallback = '') => list.find((x) => x.id === id)?.name || fallback;

// --- Giao tiếp với ứng dụng -------------------------------------------------
async function api(method, path, body, raw) {
  const res = await fetch(path, {
    method,
    headers: body && !raw ? { 'Content-Type': 'application/json' } : undefined,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

let toastTimer;
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

let saveTimer;
let saving = false;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saving = true;
    try {
      const out = await api('PUT', '/api/config', S.config);
      if (out.remote) S.remote = out.remote;
      const hookChanged = out.hookUrl !== undefined && out.hookUrl !== S.hookUrl;
      if (hookChanged) S.hookUrl = out.hookUrl;
      if (S.view === 'phone' || (hookChanged && S.view === 'donate')) render();
    } catch (err) {
      toast(`Chưa lưu được: ${err.message}`);
    } finally {
      saving = false;
    }
  }, 350);
}

// Báo cho người dùng khi bấm thử mà chưa có phần mềm nào mở overlay.
async function act(path, body) {
  try {
    await api('POST', path, body);
  } catch (err) {
    toast(err.message);
  }
}

// --- Thành phần nhỏ ---------------------------------------------------------
function field(label, control, help) {
  return h('label.field', null, h('span', null, label), control, help && h('span.help', null, help));
}
function textInput(obj, key, props = {}, after) {
  return h('input.input', {
    type: 'text', value: obj[key] ?? '', autocomplete: 'off', spellcheck: false, ...props,
    oninput: (e) => { obj[key] = e.target.value; save(); after?.(e); },
  });
}
function numInput(obj, key, { min = 0, max = 1e9, step = 1 } = {}, after) {
  return h('input.input', {
    type: 'number', value: obj[key], min, max, step, inputMode: 'decimal',
    oninput: (e) => {
      const n = Number(e.target.value);
      if (e.target.value !== '' && Number.isFinite(n)) { obj[key] = Math.min(max, Math.max(min, n)); save(); after?.(); }
    },
  });
}
function select(obj, key, options, onchange) {
  const el = h('select.input', {
    onchange: (e) => { obj[key] = e.target.value; save(); onchange?.(); },
  }, options.map(([value, label]) => h('option', { value }, label)));
  el.value = obj[key];
  return el;
}
function toggle(obj, key, label, onchange) {
  return h('label.switch', null,
    h('input', { type: 'checkbox', checked: Boolean(obj[key]), onchange: (e) => { obj[key] = e.target.checked; save(); onchange?.(); } }),
    h('i'), label && h('span', null, label));
}
function seg(options, current, onpick, label) {
  return h('div.seg', { role: 'group', 'aria-label': label }, options.map(([value, text]) =>
    h('button', { type: 'button', 'aria-pressed': String(value === current), onclick: () => onpick(value) }, text)));
}
function head(title, sub, extra) {
  return h('div.view-head', null, h('div', null, h('h1', null, title), sub && h('p', null, sub)), extra);
}
function copyField(value, label, done) {
  const input = h('input.input', { type: 'text', readOnly: true, value, 'aria-label': label, onfocus: (e) => e.target.select() });
  const btn = h('button.btn', { type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(value); } catch { input.select(); document.execCommand('copy'); }
    toast(done);
  } }, icon('copy'), 'Sao chép');
  return h('div.row', null, h('div.field', null, input), btn);
}
/** Ảnh thu nhỏ của một tệp trong thư viện; chưa có ảnh thì hiện biểu tượng. */
function thumbOrIcon(name, size = 26) {
  const img = h('img.thumb', { alt: '', loading: 'lazy', src: `/thumb/${encodeURIComponent(name)}?v=${S.thumbStamp}` });
  img.onerror = () => img.replaceWith(icon('film', size));
  return img;
}

// --- Mục: Bắt đầu -----------------------------------------------------------
const GUIDES = {
  obs: ['OBS Studio', [
    ['Trong ô ', ['b', 'Sources'], ' bấm dấu ', ['b', '+'], ' rồi chọn ', ['b', 'Browser'], '.'],
    ['Dán link ở trên vào ô ', ['b', 'URL'], '.'],
    ['Đặt ', ['b', 'Width 1080, Height 1920'], ' nếu live dọc, hoặc ', ['b', '1920 × 1080'], ' nếu live ngang.'],
    ['Bấm OK và kéo nguồn này lên ', ['b', 'trên cùng'], ' danh sách.'],
  ]],
  tiktok: ['TikTok LIVE Studio', [
    ['Bấm ', ['b', 'Thêm nguồn'], ' (Add source) rồi chọn ', ['b', 'Liên kết'], ' (Link).'],
    ['Dán link ở trên rồi bấm ', ['b', 'Thêm'], '.'],
    ['Kéo góc khung cho ', ['b', 'phủ kín'], ' màn hình live và để nó nằm trên cùng.'],
  ]],
  other: ['Phần mềm khác', [
    ['Streamlabs, vMix, XSplit, Prism…: thêm nguồn loại ', ['b', 'Browser / Web / Trang web'], '.'],
    ['Dán link ở trên, đặt kích thước bằng khung hình live của bạn.'],
    ['Live YouTube, Facebook hay Twitch qua OBS đều dùng được link này.'],
  ]],
};

function viewHome() {
  const st = S.status;
  const tk = st.tiktok;
  const linked = st.overlays > 0;
  const connected = tk.state === 'connected';
  const waiting = tk.state === 'waiting';
  const busy = tk.state === 'connecting' || waiting;

  const url = h('input.input', { type: 'text', readOnly: true, value: S.overlayUrl, 'aria-label': 'Link overlay', onfocus: (e) => e.target.select() });
  const copy = h('button.btn.primary', { type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(S.overlayUrl); } catch { url.select(); document.execCommand('copy'); }
    toast('Đã sao chép link overlay');
  } }, icon('copy'), 'Sao chép link');

  const [, lines] = GUIDES[S.guide];
  const rich = (parts) => parts.map((p) => (Array.isArray(p) ? h(p[0], null, p[1]) : p));

  // OBS: thêm nguồn giúp người dùng qua WebSocket có sẵn của OBS, khỏi dán link bằng tay.
  const addObs = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      S.obs = await api('POST', '/api/obs/add');
      if (S.obs.ok) toast(S.obs.created ? `Đã thêm nguồn “Live Effect” vào cảnh “${S.obs.scene}”` : 'Nguồn “Live Effect” đã có trong OBS, đã cập nhật link');
    } catch (err) { S.obs = { ok: false, error: err.message }; }
    render();
  };
  const obsAuto = S.guide === 'obs' && !linked ? h('div.auto-obs', null,
    h('button.btn.primary', { type: 'button', onclick: addObs }, icon('plus'), 'Tự thêm vào OBS giúp tôi'),
    h('span.small.muted', null, 'OBS đang mở và đã bật WebSocket thì một lần bấm là xong. Không được thì làm tay theo các bước dưới.'),
    S.obs && !S.obs.ok ? h('p.note.err', { role: 'status' }, S.obs.error) : null,
    S.obs?.ok ? h('p.note.ok', { role: 'status' }, `Đã gắn vào cảnh “${S.obs.scene}” (${S.obs.width} × ${S.obs.height}). Kéo nguồn “Live Effect” lên trên cùng nếu nó bị che.`) : null) : null;

  const step1 = h('section.card.step', null,
    h(`div.step-num${linked ? '.done' : ''}`, { 'aria-hidden': 'true' }, '1'),
    h('h2', null, 'Dán link overlay vào phần mềm live'),
    h('div.step-body', null,
      h('div.row', null, h('div.field', null, url), copy),
      seg(Object.entries(GUIDES).map(([k, v]) => [k, v[0]]), S.guide, (v) => { S.guide = v; render(); }, 'Phần mềm live'),
      obsAuto,
      h('ol.steps-list', null, lines.map((l) => h('li', null, rich(l)))),
      h(`p.note${linked ? '.ok' : ''}`, null, linked
        ? `Đã có ${st.overlays} nguồn đang mở overlay. Hiệu ứng sẽ lên sóng.`
        : 'Chưa có phần mềm nào mở link này. Sau khi dán, dòng này sẽ báo đã nhận.')));

  const userInput = h('input.input', {
    type: 'text', value: S.config.tiktok.username, placeholder: 'ten_kenh', autocomplete: 'off', spellcheck: false,
    'aria-label': 'ID TikTok', disabled: connected || busy,
    oninput: (e) => { S.config.tiktok.username = e.target.value.trim().replace(/^@/, ''); save(); },
    // Bỏ con trỏ khỏi ô nhập để dòng trạng thái bên dưới được cập nhật ngay.
    onkeydown: (e) => { if (e.key === 'Enter') { e.target.blur(); connect(); } },
  });
  const connect = () => {
    if (!S.config.tiktok.username) { toast('Hãy nhập ID TikTok của kênh'); userInput.focus(); return; }
    act('/api/connect', { username: S.config.tiktok.username });
  };
  const connectBtn = connected || busy
    ? h('button.btn', { type: 'button', onclick: () => act('/api/disconnect') }, waiting ? 'Dừng chờ' : 'Ngắt kết nối')
    : h('button.btn.primary', { type: 'button', onclick: connect }, 'Kết nối');
  const tkNote = connected ? ['ok', `Đã kết nối @${tk.username}. Quà, follow, tim sẽ tự kích hiệu ứng.`]
    : waiting ? ['wait', tk.error]
      : busy ? ['', tk.error || 'Đang kết nối…']
        : tk.error ? ['err', tk.error]
          : ['', 'Bấm Kết nối trước hay sau khi lên sóng đều được: ứng dụng tự chờ kênh bắt đầu live. Không cần mật khẩu TikTok.'];

  const step2 = h('section.card.step', null,
    h(`div.step-num${connected ? '.done' : ''}`, { 'aria-hidden': 'true' }, '2'),
    h('h2', null, 'Kết nối kênh TikTok'),
    h('div.step-body', null,
      h('div.row', null, h('div.field.prefix', null, h('i', null, '@'), userInput), connectBtn),
      h(`p.note${tkNote[0] ? `.${tkNote[0]}` : ''}`, { role: 'status' }, tkNote[1]),
      tk.detail && !connected ? h('details.adv', null,
        h('summary', null, 'Chi tiết kỹ thuật (gửi kèm khi cần hỗ trợ)'),
        h('p.small.muted.mono', null, tk.detail)) : null,
      h('p.small.muted', null, 'Stream game trên YouTube hay Facebook? Bỏ qua bước này, dùng nút bấm trên điện thoại hoặc phím tắt để bật hiệu ứng.'),
      twitchBox(),
      h('details.adv', null,
        h('summary', null, 'Nâng cao: khoá Euler Stream'),
        field('Khoá API (không bắt buộc)', textInput(S.config.tiktok, 'signApiKey', { type: 'password', placeholder: 'Bỏ trống nếu chưa cần' }),
          'Kết nối TikTok đi qua dịch vụ ký Euler Stream, bản miễn phí có giới hạn lượt. Nếu hay bị báo giới hạn, tạo khoá tại eulerstream.com rồi dán vào đây.'))));

  const sims = [['follow', 'Follow'], ['gift', 'Quà nhỏ'], ['biggift', 'Quà lớn'], ['like', '100 tim'], ['share', 'Chia sẻ'], ['chat', 'Bình luận'], ['donate', 'Ủng hộ 50.000đ']];
  const step3 = h('section.card.step', null,
    h('div.step-num', { 'aria-hidden': 'true' }, '3'),
    h('h2', null, 'Thử trước khi lên sóng'),
    h('div.step-body', null,
      h('p.muted', null, 'Bấm để giả lập một sự kiện. Hiệu ứng hiện ở khung xem thử bên phải và trong phần mềm live của bạn.'),
      h('div.btn-row', null, sims.map(([type, label]) =>
        h('button.btn', { type: 'button', onclick: () => act('/api/simulate', { type }) }, label)))));

  return h('div.view', null,
    head('Bắt đầu trong 3 bước', 'Live Effect chạy song song với OBS, TikTok LIVE Studio và mọi phần mềm live có nguồn trình duyệt.'),
    step1, step2, step3);
}

// Chat Twitch cho stream game: chỉ cần tên kênh, không đăng nhập.
function twitchBox() {
  const tw = S.status.twitch || { state: 'idle' };
  const on = tw.state === 'connected' || tw.state === 'connecting';
  const input = h('input.input', {
    type: 'text', value: S.config.twitch.channel, placeholder: 'Tên kênh Twitch, ví dụ: ten_kenh', autocomplete: 'off', spellcheck: false,
    'aria-label': 'Tên kênh Twitch', disabled: on,
    oninput: (e) => { S.config.twitch.channel = e.target.value.trim().toLowerCase(); save(); },
    onkeydown: (e) => { if (e.key === 'Enter') go(); },
  });
  const go = () => {
    if (!S.config.twitch.channel) { toast('Hãy nhập tên kênh Twitch'); input.focus(); return; }
    act('/api/twitch/connect', { channel: S.config.twitch.channel });
  };
  const note = tw.state === 'connected' ? ['ok', `Đang đọc chat kênh ${tw.channel}. Bình luận có từ khoá, Bits và Sub sẽ kích hiệu ứng.`]
    : tw.state === 'connecting' ? ['', tw.error || 'Đang nối chat Twitch…']
      : tw.error ? ['err', tw.error] : null;
  return h('details.adv', { open: on || Boolean(tw.error) },
    h('summary', null, 'Stream game trên Twitch: đọc chat để kích hiệu ứng'),
    h('div.row', null, h('div.field', null, input),
      on ? h('button.btn', { type: 'button', onclick: () => act('/api/twitch/disconnect') }, 'Ngắt')
        : h('button.btn', { type: 'button', onclick: go }, 'Kết nối')),
    note ? h(`p.note${note[0] ? `.${note[0]}` : ''}`, { role: 'status' }, note[1]) : null,
    h('p.small.muted', null, 'Bits tính như quà tên “Bits” (1 bit = 1 xu), Sub tính như quà tên “Sub”. Đặt kịch bản theo tên quà đó.'));
}

// --- Hàng đợi hiệu ứng ------------------------------------------------------
const PRIORITIES = [[1, 'Cao nhất'], [2, 'Cao'], [3, 'Thường'], [4, 'Thấp nhất']];

async function setQueue(body) {
  try { S.queue = (await api('POST', '/api/queue', body)).queue; render(); } catch (err) { toast(err.message); }
}

function queueCard() {
  const q = S.queue;
  const pick = { paused: q.paused };
  const row = (item, playing) => h('div.media-item', null,
    h('span', null, item.label || 'Hiệu ứng', item.who ? h('em', null, item.who) : null),
    h('em', null, playing ? 'đang phát' : `ưu tiên: ${nameOf(PRIORITIES.map(([id, name]) => ({ id, name })), item.priority, '').toLowerCase()}`));
  const shown = q.waiting.slice(0, 8);
  return h('section.card', null,
    h('div.card-head', null, h('h2', null, 'Hàng đợi hiệu ứng'),
      toggle(pick, 'paused', q.paused ? 'Đang tạm dừng' : 'Đang chạy', () => setQueue({ paused: pick.paused }))),
    h('p.muted', null, q.paused
      ? 'Đang tạm dừng: quà và sự kiện mới vẫn được ghi nhận và xếp hàng, bật lại là phát tiếp.'
      : 'Video toàn màn hình phát lần lượt, cái ưu tiên cao được chen lên trước. Tạm dừng khi cần màn hình yên mà không muốn mất hiệu ứng của khán giả.'),
    q.current || shown.length ? h('div.media-list', null, q.current ? row(q.current, true) : null, shown.map((i) => row(i, false))) : null,
    q.waiting.length > shown.length ? h('p.small.muted', null, `…và ${q.waiting.length - shown.length} hiệu ứng nữa đang chờ.`) : null,
    q.current || q.waiting.length ? h('div.btn-row', null, h('button.btn.ghost', { type: 'button', onclick: () => setQueue({ clear: true }) }, 'Xoá hàng đợi')) : null);
}

// --- Mục: Bảng hiệu ứng -----------------------------------------------------
function viewDeck() {
  const fire = (action) => act('/api/test', { action: { intensity: S.intensity, duration: 5, ...action } });
  const { effects, sounds, mediaExt } = S.catalog;
  const visuals = S.media.filter((m) => !mediaExt.audio.includes(m.split('.').pop().toLowerCase()));
  return h('div.view', null,
    head('Bảng hiệu ứng', 'Bấm là chạy ngay trên sóng. Hợp với stream game hoặc khi muốn tự tay khuấy động.',
      seg([[1, 'Nhẹ'], [2, 'Vừa'], [3, 'Mạnh']], S.intensity, (v) => { S.intensity = v; render(); }, 'Mức độ')),
    queueCard(),
    h('section.card', null,
      h('h2', null, 'Hiệu ứng toàn màn hình'),
      h('div.tiles', null, effects.map((e) =>
        h('button.tile', { type: 'button', onclick: () => fire({ effect: e.id }) }, icon(e.id, 26), e.name)))),
    h('section.card', null,
      h('h2', null, 'Âm thanh'),
      h('div.tiles', null, sounds.map((s) =>
        h('button.tile.sound', { type: 'button', onclick: () => fire({ sound: s.id }) }, icon('volume'), s.name)))),
    h('section.card', null,
      h('h2', null, 'Video và hình của bạn'),
      visuals.length
        ? h('div.tiles', null, visuals.map((m) =>
          h('button.tile.media', { type: 'button', title: m, onclick: () => fire({ media: m }) }, thumbOrIcon(m), h('span', null, m))))
        : h('p.muted', null, 'Chưa có tệp nào. Vào mục Hiển thị để thêm video hiệu ứng, ảnh GIF hoặc âm thanh của riêng bạn.')));
}

// --- Mục: Kịch bản ----------------------------------------------------------
function describe(rule) {
  const t = rule.trigger;
  const who = t.user ? ` (chỉ @${t.user})` : '';
  const when = {
    follow: `Khi có người follow${who}`,
    gift: `Khi ${t.user ? `@${t.user}` : 'có người'} tặng ${t.giftName || 'quà'}${t.minCoins ? ` từ ${t.minCoins} xu` : ''}`,
    like: `Mỗi ${t.every} tim`,
    share: `Khi có người chia sẻ${who}`,
    chat: t.keyword ? `Khi bình luận có “${t.keyword}”${who}` : 'Khi bình luận có từ khoá (chưa đặt từ khoá)',
    join: t.user ? `Khi @${t.user} vào phòng` : 'Khi có người vào xem',
    donate: `Khi có người ủng hộ${t.minAmount ? ` từ ${fmtVnd(t.minAmount)}` : ''}`,
    button: t.hotkey ? `Nút bấm tay · phím ${t.hotkey}` : 'Nút bấm tay trên điện thoại',
    jar: 'Khi hũ quà đầy',
  }[t.type];
  const a = rule.action;
  const then = [
    a.effect !== 'none' && nameOf(S.catalog.effects, a.effect),
    a.media && `video/hình ${a.media}`,
    a.sound !== 'none' && (a.sound.startsWith('file:') ? a.sound.slice(5) : nameOf(S.catalog.sounds, a.sound)),
    a.alert && a.text && 'thông báo',
  ].filter(Boolean);
  return `${when} → ${then.join(', ') || 'chưa chọn hiệu ứng'}`;
}

function hotkeyInput(rule) {
  const el = h('input.input', {
    type: 'text', readOnly: true, value: rule.trigger.hotkey, placeholder: 'Bấm vào đây rồi nhấn phím',
    onkeydown: (e) => {
      e.preventDefault();
      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Delete') { rule.trigger.hotkey = ''; el.value = ''; save(); return; }
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
      let key = '';
      if (/^F\d{1,2}$/.test(e.key)) key = e.key;
      else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
      else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
      else if (/^Numpad\d$/.test(e.code)) key = `num${e.code.slice(6)}`;
      if (!key) return;
      // Phím chữ, số đứng một mình sẽ chặn việc gõ phím ở mọi ứng dụng khác.
      if (!mods.length && !key.startsWith('F') && !key.startsWith('num')) { toast('Dùng F1–F12, phím số bên phải, hoặc kèm Ctrl / Alt'); return; }
      rule.trigger.hotkey = [...mods, key].join('+');
      el.value = rule.trigger.hotkey;
      save();
    },
  });
  return el;
}

function ruleEditor(rule) {
  const t = rule.trigger;
  const a = rule.action;
  const { effects, sounds, triggers, mediaExt } = S.catalog;
  const ext = (m) => m.split('.').pop().toLowerCase();
  const audio = S.media.filter((m) => mediaExt.audio.includes(ext(m)));
  const visual = S.media.filter((m) => !mediaExt.audio.includes(ext(m)));
  const isVideo = mediaExt.video.includes(ext(a.media || ''));

  const cond = [];
  if (t.type === 'gift') {
    if (S.gifts.length) {
      // Chọn quà từ danh mục thật của TikTok: khớp theo mã quà nên không sợ sai tên.
      const pick = { id: t.giftId };
      const opts = [['', 'Mọi loại quà'], ...S.gifts.map((g) => [g.id, `${g.name} · ${nf.format(g.coins)} xu`])];
      if (t.giftId && !S.gifts.some((g) => g.id === t.giftId)) opts.push([t.giftId, t.giftName || `Quà #${t.giftId}`]);
      cond.push(field('Quà', select(pick, 'id', opts, () => {
        t.giftId = pick.id;
        t.giftName = S.gifts.find((g) => g.id === pick.id)?.name || '';
        save(); render();
      })));
    } else {
      cond.push(field('Tên quà', textInput(t, 'giftName', { placeholder: 'Bỏ trống = mọi loại quà' }), 'Ví dụ: Rose, Lion, Universe. Sau lần kết nối live đầu tiên, ở đây sẽ có danh sách quà để chọn.'));
    }
    cond.push(field('Tổng giá trị từ (xu)', numInput(t, 'minCoins', { max: 1e6 })));
  }
  if (t.type === 'donate') {
    cond.push(field('Số tiền từ (đồng)', numInput(t, 'minAmount', { max: 1e9, step: 1000 }),
      'Ví dụ 50000 để chỉ chạy với khoản từ 50.000đ. Bật nhận chuyển khoản ở mục Ủng hộ.'));
  }
  if (t.type === 'like') cond.push(field('Cứ mỗi bao nhiêu tim', numInput(t, 'every', { min: 1, max: 1e6 })));
  if (t.type === 'chat') cond.push(field('Từ khoá trong bình luận', textInput(t, 'keyword', { placeholder: 'Ví dụ: !phaohoa' })));
  if (['gift', 'join', 'follow', 'share', 'chat'].includes(t.type)) {
    cond.push(field('Chỉ với một người', h('div.prefix', null, h('i', null, '@'), textInput(t, 'user', { placeholder: 'Bỏ trống = tất cả mọi người' })),
      t.type === 'join' ? 'Điền ID TikTok để phát hiệu ứng chào riêng khi người này vào phòng.' : 'Điền ID TikTok nếu đây là hiệu ứng riêng của một người.'));
  }
  if (t.type === 'button') {
    cond.push(field('Phím tắt trên máy tính (không bắt buộc)', hotkeyInput(rule),
      S.capabilities.hotkeys ? 'Hoạt động cả khi đang trong game. Nhấn Esc để xoá.' : 'Phím tắt chỉ hoạt động trong ứng dụng Windows.'));
  }

  return h('div.rule-edit', null,
    h('h3', null, 'Khi nào chạy'),
    h('div.grid2', null,
      field('Tên kịch bản', textInput(rule, 'name', {}, () => { main.querySelector(`[data-rule="${rule.id}"] b`).textContent = rule.name || 'Chưa đặt tên'; })),
      field('Sự kiện', select(t, 'type', triggers.map((x) => [x.id, x.name]), render))),
    cond.length ? h('div.grid2', null, cond) : null,
    h('h3', null, 'Thì hiện gì'),
    h('div.grid3', null,
      field('Hiệu ứng', select(a, 'effect', [['none', 'Không'], ...effects.map((e) => [e.id, e.name])], render)),
      field('Mức độ', select(a, 'intensity', [[1, 'Nhẹ'], [2, 'Vừa'], [3, 'Mạnh']], () => { a.intensity = Number(a.intensity); })),
      field('Thời lượng (giây)', numInput(a, 'duration', { min: 1, max: 30 }))),
    h('div.grid2', null,
      field('Video hoặc hình', select(a, 'media', [['', 'Không'], ...visual.map((m) => [m, m])], render),
        visual.length ? null : 'Thêm tệp ở mục Hiển thị → Thư viện.'),
      field('Âm thanh', select(a, 'sound', [['none', 'Không'], ...sounds.map((s) => [s.id, s.name]), ...audio.map((m) => [`file:${m}`, m])], render))),
    a.media ? h('div.grid2', null,
      field('Cách hiện', select(a, 'mediaFit', [['cover', 'Phủ kín màn hình'], ['center', 'Nhỏ ở giữa']])),
      isVideo && field('Xoá nền video', select(a, 'mediaKey', [['none', 'Không (video WebM trong suốt hoặc phủ kín)'], ['black', 'Xoá nền đen'], ['green', 'Xoá nền xanh lá']]),
        'Dùng khi video hiệu ứng có nền đen hoặc nền xanh, để vẫn thấy hình live phía sau.')) : null,
    field('Chuyển động camera (cần bật ở mục Nhạc và nhịp, chỉ với OBS)', select(a, 'camera', [['none', 'Không'], ...CAM_MOVES])),
    toggle(a, 'alert', 'Hiện dòng thông báo', render),
    a.alert ? field('Nội dung thông báo', textInput(a, 'text', { placeholder: 'Cảm ơn {user}!' }),
      t.type === 'donate'
        ? 'Chèn được: {user} tên người ủng hộ · {amount} số tiền · {text} lời nhắn'
        : 'Chèn được: {user} tên người xem · {gift} tên quà · {count} số lượng · {coins} số xu') : null,
    h('div.rule-foot', null,
      h('div.row', null,
        field('Nghỉ giữa hai lần chạy (giây)', numInput(rule, 'cooldown', { max: 3600 })),
        field('Ưu tiên trong hàng đợi', select(rule, 'priority', PRIORITIES, () => { rule.priority = Number(rule.priority); }))),
      h('button.btn.danger', { type: 'button', onclick: () => {
        S.config.rules = S.config.rules.filter((r) => r !== rule);
        S.openRule = null;
        save(); render();
        toast(`Đã xoá “${rule.name}”`);
      } }, icon('trash'), 'Xoá kịch bản')));
}

function viewRules() {
  const add = async () => {
    try {
      const { rule } = await api('POST', '/api/rules/new');
      S.config.rules.push(rule);
      S.openRule = rule.id;
      save(); render();
      main.querySelector(`[data-rule="${rule.id}"]`)?.scrollIntoView({ block: 'center' });
    } catch (err) { toast(err.message); }
  };
  const row = (rule) => {
    const open = S.openRule === rule.id;
    const hotkeyFailed = S.status.hotkeyErrors?.includes(rule.id);
    return h(`div.rule${rule.enabled ? '' : '.off'}`, { 'data-rule': rule.id },
      h('div.rule-row', null,
        toggle(rule, 'enabled', null, render),
        h('div.rule-text', null, h('b', null, rule.name || 'Chưa đặt tên'),
          h('span', null, hotkeyFailed ? `Phím ${rule.trigger.hotkey} đang bị ứng dụng khác dùng. Hãy chọn phím khác.` : describe(rule))),
        h('div.rule-actions', null,
          h('button.btn.icon', { type: 'button', title: 'Chạy thử', 'aria-label': `Chạy thử ${rule.name}`, onclick: () => act('/api/test', { ruleId: rule.id }) }, icon('play')),
          h('button.btn', { type: 'button', 'aria-expanded': String(open), onclick: () => { S.openRule = open ? null : rule.id; render(); } }, open ? 'Xong' : 'Sửa'))),
      open ? ruleEditor(rule) : null);
  };
  return h('div.view', null,
    head('Kịch bản tự động', 'Mỗi kịch bản là một câu “Khi… thì…”. Nhiều kịch bản cùng khớp thì chạy cùng lúc.',
      h('button.btn.primary', { type: 'button', onclick: add }, icon('plus'), 'Thêm kịch bản')),
    h('div.rules', null, S.config.rules.length ? S.config.rules.map(row) : h('p.empty', null, 'Chưa có kịch bản nào. Bấm “Thêm kịch bản” để tạo cái đầu tiên.')));
}

// --- Mục: Chào khách --------------------------------------------------------
function tierBlock(tier) {
  const g = S.config.greet.tiers[tier.id];
  const open = S.openTier === tier.id;
  const ext = (m) => m.split('.').pop().toLowerCase();
  const visuals = S.media.filter((m) => !S.catalog.mediaExt.audio.includes(ext(m)));
  const summary = [
    tier.param ? `${tier.param.toLowerCase()} ${g.min}` : tier.id === 'special' ? `${g.users.split(/[\s,;]+/).filter(Boolean).length} người` : null,
    g.videos.length ? `${g.videos.length} video` : 'chỉ lời chào',
  ].filter(Boolean).join(' · ');
  const editor = () => h('div.rule-edit', null,
    h('p.small.muted', null, tier.help),
    tier.id === 'special' ? field('ID TikTok của khách đặc biệt', textInput(g, 'users', { placeholder: 'anhca0811, chi_ba, …' }), 'Cách nhau bằng dấu phẩy hoặc dấu cách.') : null,
    h('div.grid2', null,
      tier.param ? field(tier.param, numInput(g, 'min', { min: 1, max: 10000 })) : null,
      field('Lời chào', textInput(g, 'text', { placeholder: 'Chào mừng {user}!' }), 'Chèn được {user}. Bỏ trống nếu chỉ muốn phát video.')),
    h('div.field', null, h('span', null, 'Video vào phòng (chọn nhiều thì phát ngẫu nhiên, không lặp liền nhau)'),
      visuals.length ? h('div.checks', null, visuals.map((m) => h('label.check', null,
        h('input', { type: 'checkbox', checked: g.videos.includes(m), onchange: (e) => {
          g.videos = e.target.checked ? [...g.videos, m] : g.videos.filter((v) => v !== m);
          save();
        } }), h('span', null, m))))
        : h('p.small.muted', null, 'Chưa có video nào trong thư viện. Thêm ở mục Hiển thị → Thư viện.')),
    g.videos.length ? field('Xoá nền video', select(g, 'key', [['none', 'Không'], ['black', 'Xoá nền đen'], ['green', 'Xoá nền xanh lá']])) : null);
  return h(`div.rule${g.enabled ? '' : '.off'}`, { 'data-tier': tier.id },
    h('div.rule-row', null,
      toggle(g, 'enabled', null, render),
      h('div.rule-text', null, h('b', null, tier.name), h('span', null, summary)),
      h('div.rule-actions', null,
        h('button.btn.icon', { type: 'button', title: 'Chào thử', 'aria-label': `Chào thử ${tier.name}`, onclick: () => act('/api/greet/test', { tier: tier.id }) }, icon('play')),
        h('button.btn', { type: 'button', 'aria-expanded': String(open), onclick: () => { S.openTier = open ? null : tier.id; render(); } }, open ? 'Xong' : 'Sửa'))),
    open ? editor() : null);
}

function viewGreet() {
  const g = S.config.greet;
  return h('div.view', null,
    head('Chào khách vào phòng', 'Khách quý vào phòng là có lời chào và video riêng theo bậc của họ.'),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, 'Chào khách'), toggle(g, 'enabled', g.enabled ? 'Đang bật' : 'Đang tắt', render)),
      h('p.muted', null, 'Mỗi người được xếp vào một bậc duy nhất, bậc nằm trên được ưu tiên. Lời chào đi vào hàng đợi với ưu tiên cao nhất.'),
      toggle(g, 'once', 'Mỗi người chỉ chào một lần trong một buổi live'),
      h('p.small.muted', null, S.fans.size
        ? `Sổ fan đang nhớ ${nf.format(S.fans.size)} khán giả.${S.fans.top.length ? ` Tặng nhiều nhất: ${S.fans.top.slice(0, 3).map((f) => `${f.name} (${nf.format(f.coins)} xu)`).join(', ')}.` : ''}`
        : 'Sổ fan còn trống. Nó tự ghi lại khán giả vào phòng và số xu họ tặng qua từng buổi live.')),
    h('div.rules', null, S.catalog.greetTiers.map(tierBlock)));
}

// --- Mục: Quà tặng ----------------------------------------------------------
const ruleForGift = (gift) => S.config.rules.find((r) => r.trigger.type === 'gift'
  && (r.trigger.giftId ? r.trigger.giftId === gift.id : r.trigger.giftName && r.trigger.giftName.toLowerCase() === gift.name.toLowerCase()));

async function giftRule(gift) {
  try {
    const { rule } = await api('POST', '/api/rules/new');
    rule.name = `Quà ${gift.name}`.slice(0, 60);
    rule.trigger = { ...rule.trigger, type: 'gift', giftId: gift.id, giftName: gift.name };
    S.config.rules.push(rule);
    S.openRule = rule.id;
    S.view = 'rules';
    save(); render();
    main.querySelector(`[data-rule="${rule.id}"]`)?.scrollIntoView({ block: 'center' });
  } catch (err) { toast(err.message); }
}

function giftRow(gift) {
  const rule = ruleForGift(gift);
  const pic = gift.image
    ? h('img', { src: gift.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', width: 40, height: 40 })
    : h('span.gift-ph', { 'aria-hidden': 'true' }, icon('giftrain', 22));
  return h('div.gift-row', null, pic,
    h('div.rule-text', null, h('b', null, gift.name),
      h('span', null, `${nf.format(gift.coins)} xu · ${rule ? `riêng: ${rule.name}${rule.enabled ? '' : ' (đang tắt)'}` : 'hiệu ứng chung'}`)),
    h('div.rule-actions', null,
      h('button.btn.icon', { type: 'button', title: 'Thử quà này', 'aria-label': `Thử quà ${gift.name}`, onclick: () => act('/api/simulate', { giftId: gift.id }) }, icon('play')),
      rule
        ? h('button.btn', { type: 'button', onclick: () => { S.openRule = rule.id; S.view = 'rules'; render(); } }, 'Sửa')
        : h('button.btn', { type: 'button', onclick: () => giftRule(gift) }, 'Hiệu ứng riêng')));
}

function jarCard() {
  const j = S.config.jar;
  return h('section.card', null,
    h('div.card-head', null, h('h2', null, 'Hũ quà'), toggle(j, 'enabled', j.enabled ? 'Đang bật' : 'Đang tắt', render)),
    h('p.muted', null, 'Mỗi món quà rơi vào một chiếc hũ trên màn hình và xếp chồng lên nhau. Đủ số xu thì hũ đầy, vỡ ra ăn mừng rồi bắt đầu lại. Khán giả nhìn thấy hũ gần đầy sẽ muốn góp cho đầy.'),
    j.enabled ? [
      h('div.grid2', null,
        field('Tên hũ', textInput(j, 'title')),
        field('Đầy khi đủ (xu)', numInput(j, 'target', { min: 10, max: 1e7 })),
        field('Vị trí', select(j, 'position', [['right', 'Bên phải'], ['left', 'Bên trái'], ['bottom-right', 'Góc dưới phải'], ['bottom-left', 'Góc dưới trái']])),
        field('Cỡ hũ', select(j, 'size', [[1, 'Nhỏ'], [2, 'Vừa'], [3, 'Lớn']], () => { j.size = Number(j.size); }))),
      h('div.btn-row', null,
        h('button.btn', { type: 'button', onclick: () => act('/api/simulate', { type: 'gift' }) }, 'Thả thử một quà'),
        h('button.btn.ghost', { type: 'button', onclick: () => act('/api/jar/reset').then(() => toast('Đã đổ hũ về rỗng')) }, 'Đổ hũ')),
      h('p.small.muted', null, 'Hũ đầy sẽ tự bắn pháo giấy. Muốn thêm video hoặc lời cảm ơn riêng: vào Kịch bản, tạo kịch bản với sự kiện “Hũ quà đầy”.'),
    ] : null);
}

function viewGifts() {
  const g = S.config.gifts;
  const general = S.config.rules.filter((r) => r.enabled && r.trigger.type === 'gift' && !r.trigger.giftId && !r.trigger.giftName && !r.trigger.user);
  const listBox = h('div.gift-list');
  const fill = () => {
    const q = S.giftQuery.trim().toLowerCase();
    const rows = S.gifts.filter((x) => !q || x.name.toLowerCase().includes(q));
    listBox.replaceChildren(...(rows.length ? rows.map(giftRow) : [h('p.empty', null, `Không có quà nào tên “${S.giftQuery}”.`)]));
  };
  fill();
  return h('div.view', null,
    head('Quà tặng', 'Bật tắt chúc mừng, và gán hiệu ứng riêng cho từng món quà của TikTok.'),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, 'Chúc mừng quà tặng'), toggle(g, 'celebrate', g.celebrate ? 'Đang bật' : 'Đang tắt', render)),
      h('p.muted', null, 'Tắt khi bạn muốn màn hình yên, ví dụ đang PK hoặc đang nói chuyện nghiêm túc. Quà vẫn được đếm vào thanh mục tiêu. Công tắc này cũng có trên điện thoại.'),
      h('p.small.muted', null, general.length
        ? `Quà chưa có hiệu ứng riêng sẽ chạy kịch bản chung: ${general.map((r) => r.name).join(', ')}.`
        : 'Hiện không có kịch bản chung nào cho quà: chỉ những quà có hiệu ứng riêng mới được chúc mừng.')),
    jarCard(),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, `Danh sách quà${S.gifts.length ? ` (${S.gifts.length})` : ''}`)),
      S.gifts.length
        ? [h('input.input', { type: 'search', placeholder: 'Tìm theo tên quà', 'aria-label': 'Tìm quà', value: S.giftQuery,
          oninput: (e) => { S.giftQuery = e.target.value; fill(); } }), listBox]
        : h('p.muted', null, 'Danh sách quà được tải từ TikTok ở lần kết nối với phiên live đầu tiên, rồi lưu lại trong máy. Trong lúc chờ, bạn vẫn tạo được kịch bản quà theo tên ở mục Kịch bản.')));
}

const CAM_MOVES = [['zoomin', 'Zoom vào rồi trả về'], ['zoomout', 'Vào cận rồi kéo ra'], ['shake', 'Rung'], ['tilt', 'Nghiêng lắc'], ['spin', 'Xoay một vòng']];

// --- Mục: Phụ đề ------------------------------------------------------------
function viewCaptions() {
  const c = S.config.captions;
  const url = `${location.origin}/caption/`;
  const link = h('input.input', { type: 'text', readOnly: true, value: url, 'aria-label': 'Link trang phụ đề', onfocus: (e) => e.target.select() });
  return h('div.view', null,
    head('Phụ đề dịch', 'Bạn nói tiếng Việt, khán giả nước ngoài đọc được phụ đề bằng tiếng của họ ngay trên live.'),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, 'Hiện phụ đề trên live'), toggle(c, 'enabled', c.enabled ? 'Đang bật' : 'Đang tắt', render)),
      h('ol.steps-list', null,
        h('li', null, 'Bấm ', h('b', null, 'Mở trang phụ đề'), '. Trang mở trong Chrome hoặc Edge của máy.'),
        h('li', null, 'Chọn tiếng bạn nói và tối đa 2 tiếng muốn dịch sang.'),
        h('li', null, 'Bấm ', h('b', null, 'Bắt đầu nghe'), ' và cho phép dùng micro. Giữ tab đó mở suốt buổi live.')),
      h('div.row', null, h('div.field', null, link),
        h('button.btn.primary', { type: 'button', onclick: () => window.open(url, '_blank', 'noopener') }, 'Mở trang phụ đề')),
      h('p.small.muted', null, 'Miễn phí, không cần khoá. Nghe giọng nói dùng dịch vụ có sẵn của trình duyệt (cần Internet); phần dịch chạy ngay trên máy và cần Chrome 138 trở lên, lần đầu sẽ tải một gói dịch cho mỗi ngôn ngữ.')),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, 'Cách hiện')),
      h('div.grid2', null,
        field('Vị trí', select(c, 'position', [['bottom', 'Phía dưới'], ['middle', 'Giữa màn hình'], ['top', 'Phía trên']])),
        field('Cỡ chữ', select(c, 'size', [[1, 'Nhỏ'], [2, 'Vừa'], [3, 'Lớn']], () => { c.size = Number(c.size); }))),
      toggle(c, 'showOriginal', 'Hiện kèm câu gốc bên dưới bản dịch'),
      h('div.btn-row', null, h('button.btn', { type: 'button', onclick: async () => {
        try {
          const out = await api('POST', '/api/caption', { text: 'Chào mọi người, cảm ơn đã ghé xem', lines: [{ lang: 'en', text: 'Hi everyone, thanks for stopping by' }], final: true });
          if (!out.enabled) toast('Bật công tắc “Hiện phụ đề trên live” trước đã');
        } catch (err) { toast(err.message); }
      } }, 'Hiện một câu mẫu'))));
}

// --- Mục: Nhạc và nhịp ------------------------------------------------------
let panelWs = null;
const M = { error: '', inputs: [], bar: null, lamp: null, bpm: null };
const audio = new AudioReactive((frame) => {
  if (panelWs?.readyState === 1) panelWs.send(JSON.stringify({ type: 'audio', ...frame }));
  if (!M.bar?.isConnected) return;
  M.bar.style.width = `${Math.round(frame.b * 100)}%`;
  if (frame.beat) { M.lamp.classList.add('on'); setTimeout(() => M.lamp?.classList.remove('on'), 110); }
  M.bpm.textContent = frame.bpm ? `${frame.bpm} nhịp/phút` : 'đang dò nhịp…';
});
audio.onEnded = () => { M.error = 'Nguồn âm thanh đã dừng. Bấm “Bắt đầu nghe” để nghe lại.'; if (S.view === 'music') render(); };

async function startListening() {
  const m = S.config.music;
  try {
    await audio.start({ source: m.source, deviceId: m.deviceId, sensitivity: m.sensitivity });
    M.error = '';
  } catch (err) {
    M.error = err.name === 'NotAllowedError' ? 'Chưa được phép thu âm thanh. Hãy bấm Cho phép khi được hỏi, rồi thử lại.'
      : err.name === 'NotFoundError' || err.name === 'OverconstrainedError' ? 'Không tìm thấy thiết bị thu này. Hãy chọn nguồn âm thanh khác.'
        : err.message || 'Không nghe được âm thanh.';
  }
  M.inputs = await listInputs();
  if (S.view === 'music') render();
}

function cameraCard() {
  const cam = S.config.camera;
  const st = S.status.camera || { state: 'off', sources: [] };
  const note = !cam.enabled ? ['', 'Khi bật, Live Effect nối vào OBS và di chuyển nguồn camera: zoom, rung, nghiêng, xoay. Xong mỗi lần, camera trở về đúng chỗ cũ.']
    : st.state === 'ready' ? ['ok', `Đã nối OBS, đang điều khiển nguồn “${st.source}”.`]
      : st.state === 'error' ? ['err', st.error] : ['', 'Đang nối OBS…'];
  const sources = [['', 'Tự tìm webcam trong cảnh'], ...(st.sources || []).map((x) => [x, x])];
  if (cam.source && !sources.some(([v]) => v === cam.source)) sources.push([cam.source, cam.source]);
  return h('section.card', null,
    h('div.card-head', null, h('h2', null, 'Camera chuyển động (OBS)'), toggle(cam, 'enabled', cam.enabled ? 'Đang bật' : 'Đang tắt', render)),
    h(`p.note${note[0] ? `.${note[0]}` : ''}`, { role: 'status' }, note[1]),
    cam.enabled ? [
      h('div.grid3', null,
        field('Nguồn camera', select(cam, 'source', sources)),
        field('Theo nhịp nhạc', select(cam, 'beat', [['off', 'Không'], ['zoom', 'Giật zoom mỗi nhịp'], ['shake', 'Rung mỗi nhịp']])),
        field('Độ mạnh', select(cam, 'amount', [[1, 'Nhẹ'], [2, 'Vừa'], [3, 'Mạnh']], () => { cam.amount = Number(cam.amount); }))),
      h('div.btn-row', null, CAM_MOVES.map(([id, name]) => h('button.btn', { type: 'button', disabled: st.state !== 'ready', onclick: async () => {
        try { if (!(await api('POST', '/api/camera/test', { move: id })).ok) toast('OBS chưa sẵn sàng'); } catch (err) { toast(err.message); }
      } }, name))),
      h('p.small.muted', null, 'Muốn bấm nút là zoom: vào Kịch bản, tạo kịch bản “Nút bấm tay” rồi chọn Chuyển động camera. Nút đó hiện trên điện thoại và gán được phím tắt. TikTok LIVE Studio không cho phần mềm ngoài điều khiển camera, nên phần này chỉ dùng với OBS.'),
    ] : null);
}

function viewMusic() {
  const m = S.config.music;
  const pick = { src: m.source === 'device' ? `dev:${m.deviceId}` : 'system' };
  const sources = [['system', 'Âm thanh đang phát trên máy tính'], ...M.inputs.map((d) => [`dev:${d.id}`, d.name])];
  if (!sources.some(([v]) => v === pick.src)) sources.push([pick.src, 'Thiết bị đã chọn trước đây']);
  M.bar = h('i');
  M.lamp = h('span.lamp', { 'aria-hidden': 'true' });
  M.bpm = h('span.small.muted', null, audio.running ? 'đang dò nhịp…' : 'chưa nghe');
  const LAYERS = [
    ['lightning', 'Sét đánh theo nhịp', 'Tia sét chạy từ mép trên xuống ở mỗi nhịp mạnh.'],
    ['flash', 'Chớp màu', 'Cả khung hình ửng màu nhẹ theo tiếng trống.'],
    ['embers', 'Tàn lửa', 'Đốm sáng bay lên, nhạc càng lớn càng dày.'],
    ['pulse', 'Viền đập', 'Viền sáng quanh khung co giãn theo âm trầm.'],
    ['bars', 'Sóng nhạc', 'Mười hai cột nhảy theo dải âm ở cạnh dưới.'],
  ];
  return h('div.view', null,
    head('Nhạc và nhịp', 'Hiệu ứng tự chạy theo bài nhạc đang phát, hợp với live nhảy, live hát và đánh nhạc.'),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, 'Nghe nhạc'),
        toggle(m, 'enabled', m.enabled ? 'Đang bật' : 'Đang tắt', () => { if (m.enabled) startListening(); else { audio.stop(); render(); } })),
      h('div.grid2', null,
        field('Nguồn âm thanh', select(pick, 'src', sources, () => {
          m.source = pick.src === 'system' ? 'system' : 'device';
          m.deviceId = pick.src === 'system' ? '' : pick.src.slice(4);
          save();
          if (audio.running) startListening();
        }), S.capabilities.hotkeys ? 'Chọn dòng đầu để nghe đúng bài nhạc đang phát qua loa hoặc tai nghe.' : 'Mở trong trình duyệt: khi được hỏi, chọn màn hình hoặc tab và bật “Chia sẻ âm thanh”.'),
        field('Độ nhạy bắt nhịp', numInput(m, 'sensitivity', { min: 0.5, max: 2, step: 0.1 }, () => audio.setSensitivity(m.sensitivity)), 'Từ 0,5 (chỉ nhịp rõ) đến 2 (bắt cả nhịp nhẹ).')),
      h('div.meter', { role: 'img', 'aria-label': 'Mức âm trầm và nhịp' }, M.lamp, h('div.meter-track', null, M.bar), M.bpm),
      M.error ? h('p.note.err', { role: 'alert' }, M.error) : null,
      m.enabled ? h('div.btn-row', null, audio.running
        ? h('button.btn', { type: 'button', onclick: () => { audio.stop(); render(); } }, 'Dừng nghe')
        : h('button.btn.primary', { type: 'button', onclick: startListening }, 'Bắt đầu nghe')) : null),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, 'Lớp hiệu ứng')),
      h('div.layers', null, LAYERS.map(([key, name, help]) => h('div.layer', null,
        h('div.rule-text', null, h('b', null, name), h('span', null, help)), toggle(m.layers, key)))),
      field('Tông màu', select(m, 'palette', [['storm', 'Bão tím'], ['fire', 'Lửa đỏ cam'], ['ice', 'Băng xanh'], ['neon', 'Neon đổi màu theo nhịp']])),
      h('p.small.muted', null, 'Chớp màu được giữ ở mức nhẹ và không quá 3 lần mỗi giây, để an toàn cho người xem nhạy cảm với ánh sáng nhấp nháy.')),
    cameraCard());
}

// --- Mục: Điện thoại --------------------------------------------------------
function viewPhone() {
  const r = S.remote || {};
  const cfg = S.config.remote;
  const buttons = S.config.rules.filter((x) => x.trigger.type === 'button');
  const body = [];
  if (cfg.enabled && r.running && r.urls.length) {
    const qr = h('div.qr', { role: 'img', 'aria-label': 'Mã QR mở trang điều khiển trên điện thoại' });
    qr.innerHTML = r.qr; // SVG do chính ứng dụng tạo ra
    body.push(h('div.phone-pair', null, qr,
      h('ol.steps-list', null,
        h('li', null, 'Nối điện thoại vào ', h('b', null, 'cùng mạng Wi-Fi'), ' với máy tính này.'),
        h('li', null, 'Mở ', h('b', null, 'camera'), ' điện thoại và quét mã QR.'),
        h('li', null, 'Trang điều khiển mở ra. Chọn ', h('b', null, 'Thêm vào màn hình chính'), ' để dùng như một ứng dụng.'),
        h('li', null, 'Lần đầu Windows có thể hỏi quyền tường lửa: chọn ', h('b', null, 'Cho phép'), '.'))));
    body.push(field('Hoặc gõ địa chỉ này trên điện thoại', h('input.input', { type: 'text', readOnly: true, value: r.urls[0], onfocus: (e) => e.target.select() }),
      r.urls.length > 1 ? `Máy có nhiều mạng. Nếu không vào được, thử: ${r.urls.slice(1).map((u) => new URL(u).host).join(', ')}` : null));
    body.push(h('div.btn-row', null, h('button.btn.ghost', { type: 'button', onclick: async () => {
      try { S.remote = (await api('POST', '/api/remote/rotate')).remote; render(); toast('Đã đổi mã. Điện thoại cũ cần quét lại.'); } catch (err) { toast(err.message); }
    } }, 'Đổi mã ghép nối')));
  } else if (cfg.enabled && r.error) {
    body.push(h('p.note.err', null, r.error));
  } else if (cfg.enabled && r.running) {
    body.push(h('p.note.err', null, 'Máy tính chưa nối mạng Wi-Fi hoặc mạng dây nào nên điện thoại chưa thể kết nối.'));
  } else if (!cfg.enabled) {
    body.push(h('p.muted', null, 'Khi bật, điện thoại hoặc máy tính bảng trong cùng mạng Wi-Fi sẽ thành bảng nút bấm hiệu ứng, không cần mua Stream Deck và không cần cài ứng dụng. Chỉ thiết bị đã quét mã QR mới điều khiển được.'));
  }

  return h('div.view', null,
    head('Điều khiển bằng điện thoại', 'Biến điện thoại thành bảng nút bấm hiệu ứng cho buổi live.'),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, 'Kết nối điện thoại'), toggle(cfg, 'enabled', cfg.enabled ? 'Đang bật' : 'Đang tắt', render)),
      body),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, 'Các nút sẽ hiện trên điện thoại'),
        h('button.btn', { type: 'button', onclick: () => { S.view = 'rules'; render(); } }, 'Sửa nút')),
      buttons.length
        ? h('div.tiles', null, buttons.map((b) => h('button.tile', { type: 'button', disabled: !b.enabled, onclick: () => act('/api/test', { ruleId: b.id }) },
          b.action.media ? thumbOrIcon(b.action.media) : icon(b.action.effect !== 'none' ? b.action.effect : 'volume', 26), b.name)))
        : h('p.muted', null, 'Chưa có nút nào. Vào Kịch bản, thêm kịch bản với sự kiện “Nút bấm tay”.'),
      h('p.small.muted', null, 'Ngoài các nút này, điện thoại luôn có sẵn 8 hiệu ứng nhanh và nút dừng tất cả. Trên điện thoại, bấm “Thêm video từ máy này” để đưa một video trong thư viện ảnh lên thành nút mới.')));
}

// --- Mục: Ủng hộ ------------------------------------------------------------
function viewDonate() {
  const dn = S.config.donate;
  const w = S.config.widgets;
  const hk = S.config.hook;
  const st = S.status.donate || { state: 'idle' };
  const ready = Boolean(dn.bank && dn.account);
  const corners = [['bottom-right', 'Dưới, bên phải'], ['bottom-left', 'Dưới, bên trái'], ['top-right', 'Trên, bên phải'], ['top-left', 'Trên, bên trái']];

  const sepayNote = !dn.enabled ? null
    : !dn.sepayToken ? ['', 'Dán API Token của SePay vào ô trên để bắt đầu.']
      : st.state === 'connected' ? ['ok', 'Đang theo dõi tài khoản. Có tiền vào là hiệu ứng chạy sau vài giây.']
        : st.state === 'error' ? ['err', st.error] : ['', 'Đang nối với SePay…'];

  return h('div.view', null,
    head('Ủng hộ qua chuyển khoản', 'Khán giả quét mã QR ngân hàng trên sóng, tiền vào thẳng tài khoản của bạn, hiệu ứng tự chạy. Live Effect không giữ tiền và không thu phí.'),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, '1. Mã QR trên khung hình'), toggle(w.qr, 'enabled', w.qr.enabled ? 'Đang hiện' : 'Đang ẩn', render)),
      h('div.grid2', null,
        field('Ngân hàng', select(dn, 'bank', [['', 'Chọn ngân hàng'], ...S.catalog.banks.map((b) => [b.bin, b.name])], render)),
        field('Số tài khoản', textInput(dn, 'account', { inputMode: 'numeric', placeholder: 'Chỉ gồm chữ và số' })),
        field('Tên chủ tài khoản (hiện dưới mã)', textInput(dn, 'holder', { placeholder: 'NGUYEN VAN A' })),
        field('Nội dung chuyển khoản gợi ý', textInput(dn, 'memo', { placeholder: 'Ung ho' }), 'Khán giả sửa được thành lời nhắn của họ. Không dấu.')),
      h('div.grid2', null,
        field('Dòng chữ trên mã', textInput(w.qr, 'title')),
        field('Vị trí', select(w.qr, 'position', corners))),
      h(`p.note${ready ? '' : '.err'}`, null, ready
        ? 'Mã QR được tạo ngay trên máy này theo chuẩn VietQR. Hãy tự quét thử bằng app ngân hàng và kiểm tra tên người nhận trước khi lên sóng.'
        : 'Chọn ngân hàng và nhập số tài khoản để có mã QR.'),
      h('p.small.muted', null, 'Lưu ý: TikTok có thể hạn chế việc đưa mã nhận tiền lên live. Bạn tự cân nhắc theo quy định của nền tảng mình đang live.')),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, '2. Tự nhận biết khi có tiền vào'), toggle(dn, 'enabled', dn.enabled ? 'Đang bật' : 'Đang tắt', render)),
      h('p.muted', null, 'Live Effect hỏi SePay vài giây một lần xem tài khoản có tiền vào không. SePay là dịch vụ báo biến động số dư, có gói miễn phí.'),
      h('ol.steps-list', null,
        h('li', null, 'Tạo tài khoản tại ', h('b', null, 'sepay.vn'), ' và thêm tài khoản ngân hàng ở bước 1 vào đó.'),
        h('li', null, 'Trong SePay vào ', h('b', null, 'Cấu hình công ty → API Access'), ', tạo một API Token.'),
        h('li', null, 'Dán token vào ô dưới đây rồi bật công tắc.')),
      field('API Token của SePay', textInput(dn, 'sepayToken', { type: 'password', placeholder: 'Dán token vào đây' }),
        'Token chỉ lưu trên máy này và chỉ gửi tới my.sepay.vn.'),
      sepayNote ? h(`p.note${sepayNote[0] ? `.${sepayNote[0]}` : ''}`, { role: 'status' }, sepayNote[1]) : null,
      h('div.btn-row', null,
        h('button.btn', { type: 'button', onclick: () => act('/api/simulate', { type: 'donate' }) }, icon('play'), 'Thử một lượt ủng hộ 50.000đ'),
        h('button.btn.ghost', { type: 'button', onclick: () => { S.view = 'rules'; S.openRule = S.config.rules.find((r) => r.trigger.type === 'donate')?.id || null; render(); } }, 'Sửa hiệu ứng khi có ủng hộ'))),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, 'Nguồn khác: link nhận sự kiện'), toggle(hk, 'enabled', hk.enabled ? 'Đang bật' : 'Đang tắt', render)),
      h('p.muted', null, 'Dành cho quà hay donate từ bất kỳ đâu: Streamer.bot, Stream Deck, công cụ donate khác hoặc script của bạn gọi link này là hiệu ứng chạy. Link chỉ dùng được trên chính máy này.'),
      hk.enabled && S.hookUrl ? [
        field('Báo một lượt ủng hộ', copyField(`${S.hookUrl}?type=donate&name=An&amount=50000&text=Co%20len`, 'Link báo ủng hộ', 'Đã sao chép link')),
        field('Bấm một nút bấm tay theo tên', copyField(`${S.hookUrl}?button=${encodeURIComponent(S.config.rules.find((r) => r.trigger.type === 'button')?.name || 'Ăn mừng')}`, 'Link bấm nút', 'Đã sao chép link')),
        h('p.small.muted', null, 'type nhận: donate, gift, follow, share, chat, like, join. Tham số: name, amount (đồng), coins, gift, count, text. Đừng đưa link này cho người khác.'),
      ] : hk.enabled ? h('p.muted', null, 'Đang tạo link…') : null));
}

// Tạo ngay một "Nút bấm tay" phát video/hình này toàn màn hình: hiện trên điện thoại liền.
async function makeButton(file) {
  try {
    const { rule } = await api('POST', '/api/rules/new');
    rule.name = file.replace(/\.[^.]+$/, '').slice(0, 60);
    rule.trigger.type = 'button';
    rule.action = { ...rule.action, effect: 'none', sound: 'none', alert: false, text: '', media: file, mediaFit: 'cover' };
    S.config.rules.push(rule);
    save();
    toast(`Đã tạo nút “${rule.name}”. Nút có sẵn trên điện thoại.`);
  } catch (err) { toast(err.message); }
}

// --- Mục: Hiển thị ----------------------------------------------------------
let voices = [];
function viewDisplay() {
  const w = S.config.widgets;
  const tts = S.config.tts;
  const upload = h('input', { type: 'file', hidden: true, multiple: true, accept: Object.values(S.catalog.mediaExt).flat().map((e) => `.${e}`).join(','),
    onchange: async (e) => {
      for (const file of e.target.files) {
        try {
          toast(`Đang thêm ${file.name}…`);
          const out = await api('POST', `/api/media?name=${encodeURIComponent(file.name)}`, file, true);
          S.media = out.media;
          // Ảnh thu nhỏ để nút trên điện thoại và bảng hiệu ứng dễ nhận ra.
          if (out.kind !== 'audio') {
            const blob = await makeThumb(file);
            if (blob) await api('POST', `/api/thumb?name=${encodeURIComponent(out.name)}`, blob, true).catch(() => {});
          }
        } catch (err) { toast(`${file.name}: ${err.message}`); }
      }
      S.thumbStamp = Date.now();
      e.target.value = '';
      render();
    } });
  const kind = (m) => {
    const e = m.split('.').pop().toLowerCase();
    return Object.entries({ image: 'Hình', video: 'Video', audio: 'Âm thanh' }).find(([k]) => S.catalog.mediaExt[k].includes(e))?.[1] || '';
  };

  return h('div.view', null,
    head('Hiển thị trên sóng', 'Những gì luôn nằm trên khung hình, và thư viện tệp của bạn.'),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, 'Thư viện video, hình, âm thanh'),
        h('button.btn.primary', { type: 'button', onclick: () => upload.click() }, icon('upload'), 'Thêm tệp')),
      upload,
      h('p.small.muted', null, 'Video hiệu ứng: WebM trong suốt, hoặc MP4 nền đen / nền xanh (bật “Xoá nền video” trong kịch bản). Tối đa 300 MB mỗi tệp.'),
      S.media.length ? h('div.media-list', null, S.media.map((m) => h('div.media-item', null,
        h('span', null, m, h('em', null, kind(m))),
        h('div.btn-row', null, kind(m) !== 'Âm thanh' && h('button.btn', { type: 'button', onclick: () => makeButton(m) }, icon('plus'), 'Tạo nút'),
        h('button.btn.icon.ghost', { type: 'button', title: 'Xoá', 'aria-label': `Xoá ${m}`, onclick: async () => {
          try { S.media = (await api('DELETE', `/api/media/${encodeURIComponent(m)}`)).media; render(); } catch (err) { toast(err.message); }
        } }, icon('trash')))))) : h('p.muted', null, 'Chưa có tệp nào.')),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, 'Dòng thông báo'), toggle(w.alerts, 'enabled')),
      field('Vị trí', select(w.alerts, 'position', [['top', 'Phía trên'], ['center', 'Giữa màn hình'], ['bottom', 'Phía dưới']]))),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, 'Khung bình luận'), toggle(w.chat, 'enabled')),
      h('div.grid2', null,
        field('Vị trí', select(w.chat, 'position', [['bottom-left', 'Dưới, bên trái'], ['bottom-right', 'Dưới, bên phải'], ['top-left', 'Trên, bên trái'], ['top-right', 'Trên, bên phải']])),
        field('Số dòng', numInput(w.chat, 'max', { min: 1, max: 15 })))),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, 'Thanh mục tiêu'), toggle(w.goal, 'enabled')),
      h('div.grid2', null,
        field('Tiêu đề', textInput(w.goal, 'title')),
        field('Đếm theo', select(w.goal, 'type', [['likes', 'Số tim'], ['coins', 'Số xu quà tặng'], ['follows', 'Số follow mới'], ['donate', 'Tiền ủng hộ (đồng)']])),
        field('Mục tiêu', numInput(w.goal, 'target', { min: 1 })),
        field('Vị trí', select(w.goal, 'position', [['top', 'Phía trên'], ['bottom', 'Phía dưới']]))),
      h('div.btn-row', null, h('button.btn.ghost', { type: 'button', onclick: () => act('/api/goal/reset').then(() => toast('Đã đặt lại về 0')) }, 'Đặt lại về 0'))),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, 'Bảng top tặng quà'), toggle(w.top, 'enabled')),
      h('p.small.muted', null, 'Xếp hạng người tặng nhiều xu nhất trong phiên live, cập nhật theo từng món quà.'),
      h('div.grid3', null,
        field('Tiêu đề', textInput(w.top, 'title')),
        field('Số người hiện', numInput(w.top, 'max', { min: 1, max: 10 })),
        field('Vị trí', select(w.top, 'position', [['top-left', 'Trên, bên trái'], ['top-right', 'Trên, bên phải'], ['bottom-left', 'Dưới, bên trái'], ['bottom-right', 'Dưới, bên phải']])))),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, 'Giọng đọc tự động'), toggle(tts, 'enabled')),
      h('p.small.muted', null, 'Giọng đọc phát qua loa máy tính, OBS thu lại bằng nguồn âm thanh màn hình. Giọng tiếng Việt cần cài trong Windows: Cài đặt → Thời gian & ngôn ngữ → Giọng nói.'),
      h('div.btn-row', null, toggle(tts, 'chat', 'Đọc bình luận'), toggle(tts, 'gift', 'Cảm ơn quà tặng'), toggle(tts, 'follow', 'Cảm ơn follow'), toggle(tts, 'donate', 'Đọc lời nhắn ủng hộ')),
      h('div.grid2', null,
        field('Giọng đọc', select(tts, 'voice', [['', 'Mặc định của máy'], ...voices.map((v) => [v.name, `${v.name} (${v.lang})`])])),
        field('Tốc độ', numInput(tts, 'rate', { min: 0.5, max: 2, step: 0.1 })))));
}

// --- Mục: Nhật ký -----------------------------------------------------------
const KIND = { jar: 'Hũ quà', follow: 'Follow', gift: 'Quà', like: 'Tim', share: 'Chia sẻ', chat: 'Bình luận', join: 'Vào xem', donate: 'Ủng hộ' };
function logRow(e) {
  const what = {
    donate: `ủng hộ ${fmtVnd(e.amount)}${e.text ? `: ${e.text}` : ''}`,
    gift: `tặng ${e.count || 1} ${e.giftName || 'quà'}${e.coins ? ` (${e.coins} xu)` : ''}`,
    like: `thả ${e.likeCount || 1} tim`,
    chat: e.text,
    follow: 'đã follow', share: 'đã chia sẻ', join: e.greeted ? `vào phòng, được chào theo bậc ${e.greeted}` : 'vào phòng', jar: 'góp món cuối, hũ đã đầy',
  }[e.type] || '';
  const ran = (e.fired || []).map((id) => S.config.rules.find((r) => r.id === id)?.name).filter(Boolean);
  return h('div.log-row', null,
    h('time', null, new Date(e.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })),
    h('span.kind', null, KIND[e.type] || e.type, e.simulated ? ' (thử)' : ''),
    h('span.what', null, h('b', null, e.nickname || e.user || 'Ai đó'), ` ${what}`,
      ran.length ? h('small', null, `Đã chạy: ${ran.join(', ')}`) : null));
}
function viewLog() {
  return h('div.view', null,
    head('Nhật ký', 'Các sự kiện vừa nhận từ phiên live, mới nhất ở trên.'),
    h('section.card', null, S.log.length
      ? h('div.log', { id: 'log' }, [...S.log].reverse().map(logRow))
      : h('p.empty', null, 'Chưa có sự kiện nào. Kết nối TikTok hoặc bấm thử ở mục Bắt đầu.')));
}

// --- Khung chung ------------------------------------------------------------
const VIEWS = [
  ['home', 'Bắt đầu', 'home', viewHome],
  ['deck', 'Bảng hiệu ứng', 'deck', viewDeck],
  ['rules', 'Kịch bản', 'rules', viewRules],
  ['gifts', 'Quà tặng', 'giftrain', viewGifts],
  ['greet', 'Chào khách', 'greet', viewGreet],
  ['music', 'Nhạc và nhịp', 'music', viewMusic],
  ['captions', 'Phụ đề', 'caption', viewCaptions],
  ['phone', 'Điện thoại', 'phone', viewPhone],
  ['donate', 'Ủng hộ', 'donate', viewDonate],
  ['display', 'Hiển thị', 'layout', viewDisplay],
  ['log', 'Nhật ký', 'log', viewLog],
];

function renderNav() {
  document.getElementById('nav').replaceChildren(...VIEWS.map(([id, label, ic]) =>
    h('button.nav-btn', { type: 'button', 'aria-current': S.view === id ? 'page' : undefined,
      onclick: () => { S.view = id; render(); main.scrollTop = 0; } }, icon(ic), h('span', null, label))));
}

function renderStatus() {
  const { tiktok: tk, overlays } = S.status;
  const dot = { connected: 'ok', connecting: 'wait', waiting: 'wait', error: 'err' }[tk.state] || '';
  const line = tk.state === 'connected' ? [h('b', null, `@${tk.username}`), tk.viewers ? ` · ${tk.viewers} người xem` : ' · đang live']
    : tk.state === 'connecting' ? ['Đang kết nối TikTok…']
      : tk.state === 'waiting' ? ['Đang chờ ', h('b', null, `@${tk.username}`), ' lên sóng…']
      : tk.state === 'error' ? ['TikTok: lỗi kết nối'] : ['TikTok: chưa kết nối'];
  document.getElementById('side-status').replaceChildren(...[
    h('div.stat', null, h(`span.dot${dot ? `.${dot}` : ''}`), h('span', null, line)),
    h('div.stat', null, h(`span.dot${overlays ? '.ok' : ''}`), h('span', null, overlays ? `Overlay: ${overlays} nguồn đang mở` : 'Overlay: chưa mở ở đâu')),
    S.status.twitch?.state === 'connected' ? h('div.stat', null, h('span.dot.ok'), h('span', null, `Twitch: ${S.status.twitch.channel}`)) : null,
    S.config.donate.enabled && S.config.donate.sepayToken ? h('div.stat', null,
      h(`span.dot${{ connected: '.ok', connecting: '.wait', error: '.err' }[S.status.donate?.state] || ''}`),
      h('span', null, S.status.donate?.state === 'connected' ? 'Chuyển khoản: đang theo dõi' : S.status.donate?.state === 'error' ? 'Chuyển khoản: lỗi SePay' : 'Chuyển khoản: đang nối…')) : null,
  ].filter(Boolean),
    S.queue.paused ? h('div.stat', null, h('span.dot.wait'), h('span', null, `Hiệu ứng đang tạm dừng${S.queue.waiting.length ? ` · ${S.queue.waiting.length} đang chờ` : ''}`)) : null);
}

function render() {
  if (!S.config) return;
  renderNav();
  renderStatus();
  const view = VIEWS.find((v) => v[0] === S.view) || VIEWS[0];
  // Giữ vị trí cuộn khi vẽ lại cùng một mục.
  const keep = main.dataset.view === view[0] ? main.scrollTop : 0;
  main.replaceChildren(view[3]());
  main.dataset.view = view[0];
  main.scrollTop = keep;
}

// Không vẽ lại khi người dùng đang gõ, để không mất con trỏ.
function softRender() {
  const a = document.activeElement;
  if (a && main.contains(a) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName)) { renderStatus(); return; }
  render();
}

// --- Đọc bình luận ----------------------------------------------------------
function speak(text) {
  if (!('speechSynthesis' in window) || speechSynthesis.pending) return; // đang dồn thì bỏ bớt
  const u = new SpeechSynthesisUtterance(text);
  const v = voices.find((x) => x.name === S.config.tts.voice) || voices.find((x) => x.lang.startsWith('vi'));
  if (v) u.voice = v;
  u.rate = S.config.tts.rate;
  speechSynthesis.speak(u);
}
if ('speechSynthesis' in window) {
  const load = () => { voices = speechSynthesis.getVoices(); if (S.view === 'display') softRender(); };
  speechSynthesis.addEventListener('voiceschanged', load);
  load();
}

// --- Nhận cập nhật trực tiếp ------------------------------------------------
function connectWs() {
  const ws = new WebSocket(`ws://${location.host}/ws?role=panel`);
  panelWs = ws;
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'status') { S.status = msg; softRender(); }
    else if (msg.type === 'event') {
      S.log.push(msg.event);
      if (S.log.length > 200) S.log.shift();
      if (S.view === 'log') {
        const list = document.getElementById('log');
        if (list) list.prepend(logRow(msg.event)); else render();
      }
    } else if (msg.type === 'media') { S.media = msg.media; softRender(); }
    else if (msg.type === 'queue') { S.queue = msg.queue; if (S.view === 'deck') softRender(); else renderStatus(); }
    else if (msg.type === 'gifts') { S.gifts = msg.gifts; if (S.view === 'gifts') softRender(); }
    else if (msg.type === 'remote') { S.remote = msg.remote; if (S.view === 'phone') softRender(); }
    else if (msg.type === 'config' && !saving) { S.config = msg.config; softRender(); }
    else if (msg.type === 'tts') speak(msg.text);
  };
  ws.onclose = () => setTimeout(connectWs, 1500);
}

document.querySelectorAll('[data-orient]').forEach((btn) => {
  if (btn.tagName !== 'BUTTON') return;
  btn.addEventListener('click', () => {
    document.getElementById('stage').dataset.orient = btn.dataset.orient;
    document.querySelectorAll('button[data-orient]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  });
});
document.getElementById('clear-all').addEventListener('click', () => act('/api/clear'));

try {
  Object.assign(S, await api('GET', '/api/state'));
  S.status = S.status || { tiktok: { state: 'idle' }, overlays: 0 };
  render();
  connectWs();
} catch (err) {
  main.replaceChildren(h('div.view', null, head('Không mở được bảng điều khiển', err.message)));
}
