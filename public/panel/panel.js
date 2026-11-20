// Bảng điều khiển Live Effect. Không dùng framework: một hàm h() dựng DOM,
// mỗi mục là một hàm vẽ lại khi cấu trúc thay đổi; gõ chữ thì chỉ lưu, không vẽ lại.

import { icon } from '/remote/icons.js';

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
  config: null, status: null, media: [], gifts: [], giftQuery: '', catalog: null, overlayUrl: '', capabilities: {}, log: [], remote: null,
  view: 'home', openRule: null, guide: 'obs', intensity: 2,
};
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
      if (S.view === 'phone') render();
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
function numInput(obj, key, { min = 0, max = 1e9, step = 1 } = {}) {
  return h('input.input', {
    type: 'number', value: obj[key], min, max, step, inputMode: 'decimal',
    oninput: (e) => {
      const n = Number(e.target.value);
      if (e.target.value !== '' && Number.isFinite(n)) { obj[key] = Math.min(max, Math.max(min, n)); save(); }
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

  const step1 = h('section.card.step', null,
    h(`div.step-num${linked ? '.done' : ''}`, { 'aria-hidden': 'true' }, '1'),
    h('h2', null, 'Dán link overlay vào phần mềm live'),
    h('div.step-body', null,
      h('div.row', null, h('div.field', null, url), copy),
      seg(Object.entries(GUIDES).map(([k, v]) => [k, v[0]]), S.guide, (v) => { S.guide = v; render(); }, 'Phần mềm live'),
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
      h('p.small.muted', null, 'Stream game trên YouTube, Facebook hay Twitch? Bỏ qua bước này, dùng nút bấm trên điện thoại hoặc phím tắt để bật hiệu ứng.'),
      h('details.adv', null,
        h('summary', null, 'Nâng cao: khoá Euler Stream'),
        field('Khoá API (không bắt buộc)', textInput(S.config.tiktok, 'signApiKey', { type: 'password', placeholder: 'Bỏ trống nếu chưa cần' }),
          'Kết nối TikTok đi qua dịch vụ ký Euler Stream, bản miễn phí có giới hạn lượt. Nếu hay bị báo giới hạn, tạo khoá tại eulerstream.com rồi dán vào đây.'))));

  const sims = [['follow', 'Follow'], ['gift', 'Quà nhỏ'], ['biggift', 'Quà lớn'], ['like', '100 tim'], ['share', 'Chia sẻ'], ['chat', 'Bình luận']];
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

// --- Mục: Bảng hiệu ứng -----------------------------------------------------
function viewDeck() {
  const fire = (action) => act('/api/test', { action: { intensity: S.intensity, duration: 5, ...action } });
  const { effects, sounds, mediaExt } = S.catalog;
  const visuals = S.media.filter((m) => !mediaExt.audio.includes(m.split('.').pop().toLowerCase()));
  return h('div.view', null,
    head('Bảng hiệu ứng', 'Bấm là chạy ngay trên sóng. Hợp với stream game hoặc khi muốn tự tay khuấy động.',
      seg([[1, 'Nhẹ'], [2, 'Vừa'], [3, 'Mạnh']], S.intensity, (v) => { S.intensity = v; render(); }, 'Mức độ')),
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
          h('button.tile.media', { type: 'button', title: m, onclick: () => fire({ media: m }) }, icon('film'), h('span', null, m))))
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
    button: t.hotkey ? `Nút bấm tay · phím ${t.hotkey}` : 'Nút bấm tay trên điện thoại',
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
    toggle(a, 'alert', 'Hiện dòng thông báo', render),
    a.alert ? field('Nội dung thông báo', textInput(a, 'text', { placeholder: 'Cảm ơn {user}!' }),
      'Chèn được: {user} tên người xem · {gift} tên quà · {count} số lượng · {coins} số xu') : null,
    h('div.rule-foot', null,
      h('div.row', null, field('Nghỉ giữa hai lần chạy (giây)', numInput(rule, 'cooldown', { max: 3600 }))),
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
    h('section.card', null,
      h('div.card-head', null, h('h2', null, `Danh sách quà${S.gifts.length ? ` (${S.gifts.length})` : ''}`)),
      S.gifts.length
        ? [h('input.input', { type: 'search', placeholder: 'Tìm theo tên quà', 'aria-label': 'Tìm quà', value: S.giftQuery,
          oninput: (e) => { S.giftQuery = e.target.value; fill(); } }), listBox]
        : h('p.muted', null, 'Danh sách quà được tải từ TikTok ở lần kết nối với phiên live đầu tiên, rồi lưu lại trong máy. Trong lúc chờ, bạn vẫn tạo được kịch bản quà theo tên ở mục Kịch bản.')));
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
          icon(b.action.media ? 'film' : b.action.effect !== 'none' ? b.action.effect : 'volume', 26), b.name)))
        : h('p.muted', null, 'Chưa có nút nào. Vào Kịch bản, thêm kịch bản với sự kiện “Nút bấm tay”.'),
      h('p.small.muted', null, 'Ngoài các nút này, điện thoại luôn có sẵn 8 hiệu ứng nhanh và nút dừng tất cả.')));
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
          S.media = (await api('POST', `/api/media?name=${encodeURIComponent(file.name)}`, file, true)).media;
        } catch (err) { toast(`${file.name}: ${err.message}`); }
      }
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
      h('p.small.muted', null, 'Video hiệu ứng: WebM trong suốt, hoặc MP4 nền đen / nền xanh (bật “Xoá nền video” trong kịch bản). Tối đa 80 MB mỗi tệp.'),
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
        field('Đếm theo', select(w.goal, 'type', [['likes', 'Số tim'], ['coins', 'Số xu quà tặng'], ['follows', 'Số follow mới']])),
        field('Mục tiêu', numInput(w.goal, 'target', { min: 1 })),
        field('Vị trí', select(w.goal, 'position', [['top', 'Phía trên'], ['bottom', 'Phía dưới']]))),
      h('div.btn-row', null, h('button.btn.ghost', { type: 'button', onclick: () => act('/api/goal/reset').then(() => toast('Đã đặt lại về 0')) }, 'Đặt lại về 0'))),
    h('section.card', null,
      h('div.card-head', null, h('h2', null, 'Giọng đọc tự động'), toggle(tts, 'enabled')),
      h('p.small.muted', null, 'Giọng đọc phát qua loa máy tính, OBS thu lại bằng nguồn âm thanh màn hình. Giọng tiếng Việt cần cài trong Windows: Cài đặt → Thời gian & ngôn ngữ → Giọng nói.'),
      h('div.btn-row', null, toggle(tts, 'chat', 'Đọc bình luận'), toggle(tts, 'gift', 'Cảm ơn quà tặng'), toggle(tts, 'follow', 'Cảm ơn follow')),
      h('div.grid2', null,
        field('Giọng đọc', select(tts, 'voice', [['', 'Mặc định của máy'], ...voices.map((v) => [v.name, `${v.name} (${v.lang})`])])),
        field('Tốc độ', numInput(tts, 'rate', { min: 0.5, max: 2, step: 0.1 })))));
}

// --- Mục: Nhật ký -----------------------------------------------------------
const KIND = { follow: 'Follow', gift: 'Quà', like: 'Tim', share: 'Chia sẻ', chat: 'Bình luận', join: 'Vào xem' };
function logRow(e) {
  const what = {
    gift: `tặng ${e.count || 1} ${e.giftName || 'quà'}${e.coins ? ` (${e.coins} xu)` : ''}`,
    like: `thả ${e.likeCount || 1} tim`,
    chat: e.text,
    follow: 'đã follow', share: 'đã chia sẻ', join: 'vào phòng',
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
  ['phone', 'Điện thoại', 'phone', viewPhone],
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
  document.getElementById('side-status').replaceChildren(
    h('div.stat', null, h(`span.dot${dot ? `.${dot}` : ''}`), h('span', null, line)),
    h('div.stat', null, h(`span.dot${overlays ? '.ok' : ''}`), h('span', null, overlays ? `Overlay: ${overlays} nguồn đang mở` : 'Overlay: chưa mở ở đâu')));
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
