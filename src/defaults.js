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
  { id: 'balloons', name: 'Bóng bay quà' },
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
  { id: 'donate', name: 'Có người ủng hộ (chuyển khoản, nguồn khác)' },
  { id: 'jar', name: 'Hũ quà đầy' },
  { id: 'timer', name: 'Hết giờ đếm ngược' },
  { id: 'game', name: 'Trò chơi: có người mở trúng hộp bẫy' },
  { id: 'auction', name: 'Đấu giá: có người thắng' },
  { id: 'button', name: 'Nút bấm tay (điện thoại, phím tắt)' },
];

export const MEDIA_EXT = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
  video: ['webm', 'mp4', 'mov'],
  audio: ['mp3', 'wav', 'ogg'],
};

export const DEFAULT_PORT = 3939;

const rule = (id, name, trigger, action, extra = {}) => ({
  id,
  name,
  enabled: true,
  cooldown: 0,
  priority: 3,
  trigger: { type: 'follow', user: '', giftId: '', giftName: '', minCoins: 0, minAmount: 0, every: 100, keyword: '', hotkey: '', ...trigger },
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
    camera: 'none',
    scene: '',
    sceneReturn: true,
    source: '',
    sourceMode: 'flash',
    ...action,
  },
  ...extra,
});

const donateRule = () => rule('r-donate', 'Cảm ơn ủng hộ', { type: 'donate' }, {
  effect: 'coins', intensity: 3, duration: 7, text: '{user} ủng hộ {amount}  {text}', sound: 'fanfare',
});

export const CONFIG_VERSION = 2;

const GREET_TIERS = { special: 0, top1: 0, top3: 0, top10: 0, level: 30, fan: 10, back: 30, regular: 5 };
const GREET_TEXT = {
  special: 'Chào mừng {user} đã tới!', top1: 'Top 1 {user} vừa vào phòng!', top3: 'Chào đại gia {user}!', top10: 'Chào {user}, cảm ơn đã luôn ủng hộ!',
  level: 'Chào đại gia {user}!', fan: 'Đội fan {user} đã có mặt!', back: 'Lâu lắm mới gặp lại {user}!', regular: 'Chào khách quen {user}!',
};
function defaultGreetTiers() {
  return Object.fromEntries(Object.entries(GREET_TIERS).map(([id, min]) => [id, {
    enabled: ['special', 'top1', 'top3'].includes(id), min, users: '', videos: [], key: 'none', text: GREET_TEXT[id],
  }]));
}

export function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    tiktok: { username: '', signApiKey: '' },
    twitch: { channel: '' },
    donate: { enabled: false, sepayToken: '', bank: '', account: '', holder: '', memo: 'Ung ho' },
    hook: { enabled: false, key: '' },
    widgets: {
      alerts: { enabled: true, position: 'top' },
      chat: { enabled: false, position: 'bottom-left', max: 6 },
      goal: { enabled: false, type: 'likes', target: 1000, title: 'Mục tiêu tim', position: 'top' },
      top: { enabled: false, position: 'top-left', max: 3, title: 'Top tặng quà' },
      qr: { enabled: false, position: 'bottom-right', title: 'Quét mã để ủng hộ' },
    },
    tts: { enabled: false, chat: true, gift: true, follow: true, donate: true, voice: '', rate: 1, maxLength: 80 },
    remote: { enabled: false, token: '' },
    gifts: { celebrate: true },
    captions: { enabled: false, showOriginal: true, position: 'bottom', size: 2, translateChat: false },
    jar: { enabled: false, title: 'Hũ quà', target: 500, position: 'right', size: 2 },
    greet: { enabled: false, once: true, tiers: defaultGreetTiers() },
    webhook: { enabled: false, url: '', events: ['gift', 'follow', 'share', 'donate'] },
    scenery: { enabled: false, media: '', key: 'none', opacity: 1 },
    bgm: { enabled: false, tracks: [], volume: 0.5, duck: 'lower', shuffle: false, showCard: true, requests: true, position: 'top-left' },
    auction: { item: '', seconds: 120, extend: true, position: 'top-right' },
    stage: { cam1: '', cam2: '', beatSwitch: 0, shows: [] },
    game: { enabled: false, title: 'Hộp bí ẩn: ai mở trúng bẫy?', boxes: 12, restart: 8, position: 'bottom' },
    extras: {
      timer: { enabled: false, title: 'Thời gian live', minutes: 30, perCoin: 1, position: 'top-right' },
      topLikes: { enabled: false, title: 'Top thả tim', max: 3, position: 'bottom-left' },
      bestGift: { enabled: false, title: 'Quà to nhất', position: 'bottom-right' },
      queueBoard: { enabled: false, title: 'Sắp phát', max: 4, position: 'top-left' },
    },
    camera: { enabled: false, source: '', beat: 'off', amount: 2 },
    music: {
      enabled: false, source: 'system', deviceId: '', sensitivity: 1, palette: 'storm',
      layers: { lightning: true, flash: true, embers: true, pulse: true, bars: false },
    },
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
      donateRule(),
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
    priority: Math.round(num(r.priority, 1, 4, 3)),
    trigger: {
      // Bản cũ gọi nút bấm tay là "hotkey".
      type: oneOf(t.type === 'hotkey' ? 'button' : t.type, TRIGGER_IDS, 'gift'),
      user: str(t.user, 60).trim().replace(/^@/, ''),
      giftId: str(t.giftId, 24).replace(/\D/g, ''),
      giftName: str(t.giftName, 60).trim(),
      minCoins: Math.round(num(t.minCoins, 0, 1e6, 0)),
      minAmount: Math.round(num(t.minAmount, 0, 1e9, 0)),
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
      mediaFit: oneOf(a.mediaFit, ['cover', 'center', 'top', 'bottom'], 'cover'),
      mediaKey: oneOf(a.mediaKey, ['none', 'black', 'green'], 'none'),
      camera: oneOf(a.camera, ['none', 'zoomin', 'zoomout', 'shake', 'tilt', 'spin'], 'none'),
      scene: str(a.scene, 120),
      sceneReturn: bool(a.sceneReturn, true),
      source: str(a.source, 120),
      sourceMode: oneOf(a.sourceMode, ['flash', 'show', 'hide'], 'flash'),
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
  const cp = c.captions && typeof c.captions === 'object' ? c.captions : {};
  const cm = c.camera && typeof c.camera === 'object' ? c.camera : {};
  const jr = c.jar && typeof c.jar === 'object' ? c.jar : {};
  const gr = c.greet && typeof c.greet === 'object' ? c.greet : {};
  const grT = gr.tiers && typeof gr.tiers === 'object' ? gr.tiers : {};
  const greetTiers = Object.fromEntries(Object.entries(defaultGreetTiers()).map(([id, def]) => {
    const t = grT[id] && typeof grT[id] === 'object' ? grT[id] : {};
    const videos = (Array.isArray(t.videos) ? t.videos : []).slice(0, 30)
      .map((v) => safeMediaName(v)).filter((m) => m && m.kind !== 'audio').map((m) => m.name);
    return [id, {
      enabled: bool(t.enabled, def.enabled),
      min: Math.round(num(t.min, 1, 10000, def.min || 1)),
      users: str(t.users, 800),
      videos: [...new Set(videos)],
      key: oneOf(t.key, ['none', 'black', 'green'], 'none'),
      text: str(t.text, 100),
    }];
  }));
  const mu = c.music && typeof c.music === 'object' ? c.music : {};
  const ly = mu.layers && typeof mu.layers === 'object' ? mu.layers : {};
  const al = w.alerts || {};
  const ch = w.chat || {};
  const go = w.goal || {};
  const tp = w.top || {};
  const qr = w.qr || {};
  const dn = c.donate && typeof c.donate === 'object' ? c.donate : {};
  const hk = c.hook && typeof c.hook === 'object' ? c.hook : {};
  const tw = c.twitch && typeof c.twitch === 'object' ? c.twitch : {};

  const seen = new Set();
  const source = Array.isArray(c.rules) ? [...c.rules] : d.rules;
  // Cấu hình từ bản 0.1 chưa có kịch bản ủng hộ: thêm sẵn một cái để bật donate là chạy.
  if (Array.isArray(c.rules) && !(Number(c.version) >= CONFIG_VERSION) && !c.rules.some((r) => r?.trigger?.type === 'donate')) {
    source.push(donateRule());
  }
  const rules = source.slice(0, 100).map((r, i) => {
    const clean = sanitizeRule(r, i);
    while (seen.has(clean.id)) clean.id = `${clean.id}x`;
    seen.add(clean.id);
    return clean;
  });

  return {
    version: CONFIG_VERSION,
    tiktok: {
      username: str(tk.username, 60).trim().replace(/^@/, ''),
      signApiKey: str(tk.signApiKey, 200).trim(),
    },
    twitch: { channel: str(tw.channel, 40).trim().toLowerCase().replace(/[^a-z0-9_]/g, '') },
    donate: {
      enabled: bool(dn.enabled, false),
      sepayToken: str(dn.sepayToken, 200).trim(),
      bank: /^\d{6}$/.test(dn.bank) ? dn.bank : '',
      account: str(dn.account, 30).replace(/[^A-Za-z0-9]/g, ''),
      holder: str(dn.holder, 60).trim(),
      memo: str(dn.memo, 50),
    },
    hook: {
      enabled: bool(hk.enabled, false),
      key: /^[0-9a-f]{32}$/.test(hk.key) ? hk.key : '',
    },
    widgets: {
      top: {
        enabled: bool(tp.enabled, d.widgets.top.enabled),
        position: oneOf(tp.position, ['top-left', 'top-right', 'bottom-left', 'bottom-right'], 'top-left'),
        max: Math.round(num(tp.max, 1, 10, 3)),
        title: str(tp.title, 40) || d.widgets.top.title,
      },
      qr: {
        enabled: bool(qr.enabled, d.widgets.qr.enabled),
        position: oneOf(qr.position, ['top-left', 'top-right', 'bottom-left', 'bottom-right'], 'bottom-right'),
        title: str(qr.title, 40),
      },
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
        type: oneOf(go.type, ['likes', 'coins', 'follows', 'donate'], 'likes'),
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
      donate: bool(tts.donate, true),
      voice: str(tts.voice, 120),
      rate: num(tts.rate, 0.5, 2, 1),
      maxLength: Math.round(num(tts.maxLength, 10, 300, 80)),
    },
    remote: {
      enabled: bool(rm.enabled, false),
      token: /^[0-9a-f]{32}$/.test(rm.token) ? rm.token : '',
    },
    gifts: { celebrate: bool(gf.celebrate, true) },
    greet: { enabled: bool(gr.enabled, false), once: bool(gr.once, true), tiers: greetTiers },
    scenery: (() => {
      const sc = c.scenery && typeof c.scenery === 'object' ? c.scenery : {};
      const m = sc.media ? safeMediaName(sc.media) : null;
      return {
        enabled: bool(sc.enabled, false),
        media: m && m.kind !== 'audio' ? m.name : '',
        key: oneOf(sc.key, ['none', 'black', 'green'], 'none'),
        opacity: num(sc.opacity, 0.1, 1, 1),
      };
    })(),
    bgm: (() => {
      const bm = c.bgm && typeof c.bgm === 'object' ? c.bgm : {};
      const tracks = (Array.isArray(bm.tracks) ? bm.tracks : []).slice(0, 99).map((t) => safeMediaName(t)).filter((m) => m && m.kind === 'audio').map((m) => m.name);
      return {
        enabled: bool(bm.enabled, false),
        tracks: [...new Set(tracks)],
        volume: num(bm.volume, 0, 1, 0.5),
        duck: oneOf(bm.duck, ['lower', 'pause', 'none'], 'lower'),
        shuffle: bool(bm.shuffle, false),
        showCard: bool(bm.showCard, true),
        requests: bool(bm.requests, true),
        position: oneOf(bm.position, ['top-left', 'top-right', 'bottom-left', 'bottom-right'], 'top-left'),
      };
    })(),
    webhook: (() => {
      const wh = c.webhook && typeof c.webhook === 'object' ? c.webhook : {};
      const known = ['gift', 'follow', 'share', 'like', 'chat', 'join', 'donate', 'jar', 'game', 'timer'];
      return {
        enabled: bool(wh.enabled, false),
        url: str(wh.url, 500).trim(),
        events: Array.isArray(wh.events) ? known.filter((e) => wh.events.includes(e)) : ['gift', 'follow', 'share', 'donate'],
      };
    })(),
    stage: (() => {
      const sg = c.stage && typeof c.stage === 'object' ? c.stage : {};
      const shows = (Array.isArray(sg.shows) ? sg.shows : []).slice(0, 30).map((sh, i) => {
        const tr = sh?.track ? safeMediaName(sh.track) : null;
        const cues = (Array.isArray(sh?.cues) ? sh.cues : []).slice(0, 200).map((cu) => {
          const md = cu?.media ? safeMediaName(cu.media) : null;
          return {
            t: Math.round(num(cu?.t, 0, 3600, 0) * 10) / 10,
            effect: oneOf(cu?.effect, EFFECT_IDS, 'none'),
            media: md && md.kind !== 'audio' ? md.name : '',
            mediaKey: oneOf(cu?.mediaKey, ['none', 'black', 'green'], 'none'),
            camera: oneOf(cu?.camera, ['none', 'zoomin', 'zoomout', 'shake', 'tilt', 'spin'], 'none'),
            cam: [1, 2].includes(Number(cu?.cam)) ? Number(cu.cam) : 0,
          };
        }).sort((a, b) => a.t - b.t);
        return { id: str(sh?.id, 40).replace(/[^\w-]/g, '') || `show-${i}`, name: str(sh?.name, 60) || 'Bài diễn', track: tr && tr.kind === 'audio' ? tr.name : '', cues };
      });
      return { cam1: str(sg.cam1, 120), cam2: str(sg.cam2, 120), beatSwitch: Math.round(num(sg.beatSwitch, 0, 64, 0)), shows };
    })(),
    auction: (() => {
      const au = c.auction && typeof c.auction === 'object' ? c.auction : {};
      return {
        item: str(au.item, 60),
        seconds: Math.round(num(au.seconds, 10, 3600, 120)),
        extend: bool(au.extend, true),
        position: oneOf(au.position, ['top-left', 'top-right', 'bottom-left', 'bottom-right'], 'top-right'),
      };
    })(),
    game: (() => {
      const gm = c.game && typeof c.game === 'object' ? c.game : {};
      return {
        enabled: bool(gm.enabled, false),
        title: str(gm.title, 40) || 'Hộp bí ẩn: ai mở trúng bẫy?',
        boxes: Math.round(num(gm.boxes, 4, 24, 12)),
        restart: Math.round(num(gm.restart, 3, 120, 8)),
        position: oneOf(gm.position, ['top', 'middle', 'bottom'], 'bottom'),
      };
    })(),
    extras: (() => {
      const ex = c.extras && typeof c.extras === 'object' ? c.extras : {};
      const tm = ex.timer || {};
      const tl = ex.topLikes || {};
      const bg = ex.bestGift || {};
      const corner = (v, dflt) => oneOf(v, ['top-left', 'top-right', 'bottom-left', 'bottom-right'], dflt);
      return {
        timer: {
          enabled: bool(tm.enabled, false), title: str(tm.title, 30) || 'Thời gian live',
          minutes: num(tm.minutes, 1, 1440, 30), perCoin: num(tm.perCoin, 0, 600, 1), position: corner(tm.position, 'top-right'),
        },
        topLikes: { enabled: bool(tl.enabled, false), title: str(tl.title, 30) || 'Top thả tim', max: Math.round(num(tl.max, 1, 10, 3)), position: corner(tl.position, 'bottom-left') },
        bestGift: { enabled: bool(bg.enabled, false), title: str(bg.title, 30) || 'Quà to nhất', position: corner(bg.position, 'bottom-right') },
        queueBoard: { enabled: bool(ex.queueBoard?.enabled, false), title: str(ex.queueBoard?.title, 30) || 'Sắp phát', max: Math.round(num(ex.queueBoard?.max, 1, 8, 4)), position: corner(ex.queueBoard?.position, 'top-left') },
      };
    })(),
    jar: {
      enabled: bool(jr.enabled, false),
      title: str(jr.title, 30) || 'Hũ quà',
      target: Math.round(num(jr.target, 10, 1e7, 500)),
      position: oneOf(jr.position, ['right', 'left', 'bottom-right', 'bottom-left'], 'right'),
      size: Math.round(num(jr.size, 1, 3, 2)),
    },
    camera: {
      enabled: bool(cm.enabled, false),
      source: str(cm.source, 120),
      beat: oneOf(cm.beat, ['off', 'zoom', 'shake'], 'off'),
      amount: Math.round(num(cm.amount, 1, 3, 2)),
    },
    captions: {
      enabled: bool(cp.enabled, false),
      showOriginal: bool(cp.showOriginal, true),
      translateChat: bool(cp.translateChat, false),
      position: oneOf(cp.position, ['top', 'middle', 'bottom'], 'bottom'),
      size: Math.round(num(cp.size, 1, 3, 2)),
    },
    music: {
      enabled: bool(mu.enabled, false),
      source: oneOf(mu.source, ['system', 'device'], 'system'),
      deviceId: str(mu.deviceId, 200),
      sensitivity: num(mu.sensitivity, 0.5, 2, 1),
      palette: oneOf(mu.palette, ['storm', 'fire', 'ice', 'neon'], 'storm'),
      layers: Object.fromEntries(Object.entries(d.music.layers).map(([k, v]) => [k, bool(ly[k], v)])),
    },
    rules,
  };
}
