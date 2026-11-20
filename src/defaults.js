// Danh mục hiệu ứng, âm thanh và cấu hình mặc định.
// File này dùng chung cho máy chủ; bảng điều khiển nhận danh mục qua /api/state.

export const EFFECTS = [
  { id: 'confetti', name: 'Pháo giấy' },
  { id: 'fireworks', name: 'Pháo hoa' },
  { id: 'hearts', name: 'Trái tim bay' },
  { id: 'stars', name: 'Sao rơi' },
  { id: 'coins', name: 'Mưa xu' },
  { id: 'snow', name: 'Tuyết rơi' },
  { id: 'giftrain', name: 'Mưa quà' },
  { id: 'border', name: 'Viền sáng' },
];

export const SOUNDS = [
  { id: 'ding', name: 'Chuông' },
  { id: 'coin', name: 'Tiếng xu' },
  { id: 'fanfare', name: 'Kèn chúc mừng' },
  { id: 'pop', name: 'Bụp' },
  { id: 'boom', name: 'Nổ' },
  { id: 'whoosh', name: 'Vút' },
];

export const TRIGGERS = [
  { id: 'follow', name: 'Có người follow' },
  { id: 'gift', name: 'Có người tặng quà' },
  { id: 'like', name: 'Thả tim' },
  { id: 'share', name: 'Có người chia sẻ' },
  { id: 'chat', name: 'Bình luận chứa từ khoá' },
  { id: 'join', name: 'Có người vào xem' },
  { id: 'button', name: 'Nút bấm tay (điện thoại, phím tắt)' },
];

export const MEDIA_EXT = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
  video: ['webm', 'mp4'],
  audio: ['mp3', 'wav', 'ogg'],
};

export const DEFAULT_PORT = 3939;

const rule = (id, name, trigger, action, extra = {}) => ({
  id,
  name,
  enabled: true,
  cooldown: 0,
  trigger: { type: 'follow', user: '', giftId: '', giftName: '', minCoins: 0, every: 100, keyword: '', hotkey: '', ...trigger },
  action: {
    effect: 'none',
    intensity: 2,
    duration: 5,
    alert: true,
    text: '',
    sound: 'none',
    media: '',
    mediaFit: 'cover',
    mediaKey: 'none',
    ...action,
  },
  ...extra,
});

export function defaultConfig() {
  return {
    version: 1,
    tiktok: { username: '', signApiKey: '' },
    widgets: {
      alerts: { enabled: true, position: 'top' },
      chat: { enabled: false, position: 'bottom-left', max: 6 },
      goal: { enabled: false, type: 'likes', target: 1000, title: 'Mục tiêu tim', position: 'top' },
    },
    tts: { enabled: false, chat: true, gift: true, follow: true, voice: '', rate: 1, maxLength: 80 },
    remote: { enabled: false, token: '' },
    gifts: { celebrate: true },
    rules: [
      rule('r-follow', 'Cảm ơn follow', { type: 'follow' }, {
        effect: 'hearts', text: 'Cảm ơn {user} đã follow!', sound: 'ding',
      }),
      rule('r-gift', 'Quà tặng', { type: 'gift' }, {
        effect: 'giftrain', text: '{user} tặng {count} {gift}', sound: 'coin',
      }),
      rule('r-biggift', 'Quà lớn từ 100 xu', { type: 'gift', minCoins: 100 }, {
        effect: 'fireworks', intensity: 3, duration: 7, alert: false, sound: 'fanfare',
      }),
      rule('r-share', 'Cảm ơn chia sẻ', { type: 'share' }, {
        effect: 'confetti', text: '{user} vừa chia sẻ phiên live', sound: 'pop',
      }),
      rule('r-like', 'Mỗi 100 tim', { type: 'like', every: 100 }, {
        effect: 'hearts', intensity: 1, duration: 3, alert: false,
      }),
      rule('r-btn-party', 'Ăn mừng', { type: 'button' }, {
        effect: 'fireworks', intensity: 3, duration: 6, alert: false, sound: 'fanfare',
      }),
      rule('r-btn-thanks', 'Cảm ơn cả nhà', { type: 'button' }, {
        effect: 'hearts', intensity: 2, duration: 5, text: 'Cảm ơn cả nhà đã ủng hộ!', sound: 'ding',
      }),
    ],
  };
}

export function blankRule(id) {
  return rule(id, 'Kịch bản mới', { type: 'gift' }, {
    effect: 'confetti', text: '{user} tặng {count} {gift}', sound: 'ding',
  });
}

// ---------------------------------------------------------------------------
// Làm sạch cấu hình nhận từ bên ngoài: chỉ giữ trường đã biết, ép kiểu, kẹp giá trị.

const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

const EFFECT_IDS = ['none', ...EFFECTS.map((e) => e.id)];
const SOUND_IDS = ['none', ...SOUNDS.map((s) => s.id)];
const TRIGGER_IDS = TRIGGERS.map((t) => t.id);

export function safeMediaName(name) {
  const base = String(name || '').split(/[\\/]/).pop().normalize('NFC');
  const clean = base.replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/^\.+/, '').slice(0, 120);
  const ext = clean.includes('.') ? clean.split('.').pop().toLowerCase() : '';
  const kind = Object.keys(MEDIA_EXT).find((k) => MEDIA_EXT[k].includes(ext));
  return kind ? { name: clean, kind } : null;
}

function sanitizeRule(input, index) {
  const base = blankRule(`r-${index}`);
  const r = input && typeof input === 'object' ? input : {};
  const t = r.trigger && typeof r.trigger === 'object' ? r.trigger : {};
  const a = r.action && typeof r.action === 'object' ? r.action : {};
  // Âm thanh là id có sẵn hoặc "file:<tên tệp âm thanh trong thư viện>".
  let sound = 'none';
  if (SOUND_IDS.includes(a.sound)) sound = a.sound;
  else if (typeof a.sound === 'string' && a.sound.startsWith('file:')) {
    const m = safeMediaName(a.sound.slice(5));
    if (m && m.kind === 'audio') sound = `file:${m.name}`;
  }
  let media = '';
  if (a.media) {
    const m = safeMediaName(a.media);
    if (m && m.kind !== 'audio') media = m.name;
  }
  return {
    id: str(r.id, 40).replace(/[^\w-]/g, '') || base.id,
    name: str(r.name, 60) || base.name,
    enabled: bool(r.enabled, true),
    cooldown: num(r.cooldown, 0, 3600, 0),
    trigger: {
      // Bản cũ gọi nút bấm tay là "hotkey".
      type: oneOf(t.type === 'hotkey' ? 'button' : t.type, TRIGGER_IDS, 'gift'),
      user: str(t.user, 60).trim().replace(/^@/, ''),
      giftId: str(t.giftId, 24).replace(/\D/g, ''),
      giftName: str(t.giftName, 60).trim(),
      minCoins: Math.round(num(t.minCoins, 0, 1e6, 0)),
      every: Math.round(num(t.every, 1, 1e6, 100)),
      keyword: str(t.keyword, 60).trim(),
      hotkey: str(t.hotkey, 40).trim(),
    },
    action: {
      effect: oneOf(a.effect, EFFECT_IDS, 'none'),
      intensity: Math.round(num(a.intensity, 1, 3, 2)),
      duration: num(a.duration, 1, 30, 5),
      alert: bool(a.alert, true),
      text: str(a.text, 140),
      sound,
      media,
      mediaFit: oneOf(a.mediaFit, ['cover', 'center'], 'cover'),
      mediaKey: oneOf(a.mediaKey, ['none', 'black', 'green'], 'none'),
    },
  };
}

export function sanitizeConfig(input) {
  const d = defaultConfig();
  const c = input && typeof input === 'object' ? input : {};
  const w = c.widgets && typeof c.widgets === 'object' ? c.widgets : {};
  const tk = c.tiktok && typeof c.tiktok === 'object' ? c.tiktok : {};
  const tts = c.tts && typeof c.tts === 'object' ? c.tts : {};
  const rm = c.remote && typeof c.remote === 'object' ? c.remote : {};
  const gf = c.gifts && typeof c.gifts === 'object' ? c.gifts : {};
  const al = w.alerts || {};
  const ch = w.chat || {};
  const go = w.goal || {};

  const seen = new Set();
  const rules = (Array.isArray(c.rules) ? c.rules : d.rules).slice(0, 100).map((r, i) => {
    const clean = sanitizeRule(r, i);
    while (seen.has(clean.id)) clean.id = `${clean.id}x`;
    seen.add(clean.id);
    return clean;
  });

  return {
    version: 1,
    tiktok: {
      username: str(tk.username, 60).trim().replace(/^@/, ''),
      signApiKey: str(tk.signApiKey, 200).trim(),
    },
    widgets: {
      alerts: {
        enabled: bool(al.enabled, d.widgets.alerts.enabled),
        position: oneOf(al.position, ['top', 'center', 'bottom'], 'top'),
      },
      chat: {
        enabled: bool(ch.enabled, d.widgets.chat.enabled),
        position: oneOf(ch.position, ['top-left', 'top-right', 'bottom-left', 'bottom-right'], 'bottom-left'),
        max: Math.round(num(ch.max, 1, 15, 6)),
      },
      goal: {
        enabled: bool(go.enabled, d.widgets.goal.enabled),
        type: oneOf(go.type, ['likes', 'coins', 'follows'], 'likes'),
        target: Math.round(num(go.target, 1, 1e9, 1000)),
        title: str(go.title, 40) || d.widgets.goal.title,
        position: oneOf(go.position, ['top', 'bottom'], 'top'),
      },
    },
    tts: {
      enabled: bool(tts.enabled, false),
      chat: bool(tts.chat, true),
      gift: bool(tts.gift, true),
      follow: bool(tts.follow, true),
      voice: str(tts.voice, 120),
      rate: num(tts.rate, 0.5, 2, 1),
      maxLength: Math.round(num(tts.maxLength, 10, 300, 80)),
    },
    remote: {
      enabled: bool(rm.enabled, false),
      token: /^[0-9a-f]{32}$/.test(rm.token) ? rm.token : '',
    },
    gifts: { celebrate: bool(gf.celebrate, true) },
    rules,
  };
}
