import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { defaultConfig, sanitizeConfig, safeMediaName } from '../src/defaults.js';
import { normalizeGift, normalizeUser, friendlyError } from '../src/tiktok.js';

function setup(mutate) {
  const config = defaultConfig();
  mutate?.(config);
  const clean = sanitizeConfig(config);
  const out = [];
  let now = 1_000_000;
  const engine = new Engine(() => clean, (m) => out.push(m), () => now);
  return { engine, out, config: clean, tick: (ms) => { now += ms; }, fx: () => out.filter((m) => m.type === 'fx') };
}

test('quà nhỏ chỉ chạy kịch bản quà thường, quà lớn chạy thêm pháo hoa', () => {
  const { engine, fx } = setup();
  assert.deepEqual(engine.handle({ type: 'gift', nickname: 'An', giftName: 'Rose', count: 5, coins: 5 }), ['r-gift']);
  assert.equal(fx()[0].alert, 'An tặng 5 Rose');
  assert.deepEqual(engine.handle({ type: 'gift', nickname: 'Bình', giftName: 'Lion', count: 1, coins: 29999 }), ['r-gift', 'r-biggift']);
  assert.equal(fx().at(-1).effect, 'fireworks');
});

test('tim được dồn lại cho đủ ngưỡng và giữ phần dư', () => {
  const { engine } = setup();
  assert.deepEqual(engine.handle({ type: 'like', likeCount: 60 }), []);
  assert.deepEqual(engine.handle({ type: 'like', likeCount: 60 }), ['r-like']);
  assert.deepEqual(engine.handle({ type: 'like', likeCount: 70 }), []); // 20 dư + 70 = 90
  assert.deepEqual(engine.handle({ type: 'like', likeCount: 10 }), ['r-like']);
});

test('một người follow nhiều lần chỉ được chào một lần', () => {
  const { engine } = setup();
  assert.deepEqual(engine.handle({ type: 'follow', user: 'an' }), ['r-follow']);
  assert.deepEqual(engine.handle({ type: 'follow', user: 'an' }), []);
  assert.deepEqual(engine.handle({ type: 'follow', user: 'binh' }), ['r-follow']);
});

test('thời gian nghỉ chặn kịch bản chạy dồn dập', () => {
  const { engine, tick } = setup((c) => { c.rules.find((r) => r.id === 'r-share').cooldown = 10; });
  assert.deepEqual(engine.handle({ type: 'share', user: 'a' }), ['r-share']);
  tick(5000);
  assert.deepEqual(engine.handle({ type: 'share', user: 'b' }), []);
  tick(6000);
  assert.deepEqual(engine.handle({ type: 'share', user: 'c' }), ['r-share']);
});

test('hiệu ứng riêng chỉ chạy đúng người, không phân biệt hoa thường và dấu @', () => {
  const { engine, fx } = setup((c) => {
    c.rules.push({ id: 'vip', name: 'Chào anh Cả', trigger: { type: 'join', user: '@AnhCa0811' }, action: { media: 'anhca.mp4', mediaKey: 'black', alert: false } });
  });
  assert.deepEqual(engine.handle({ type: 'join', user: 'khach' }), []);
  assert.deepEqual(engine.handle({ type: 'join', user: 'anhca0811' }), ['vip']);
  assert.equal(fx().at(-1).media, 'anhca.mp4');
  assert.equal(fx().at(-1).mediaKey, 'black');
  assert.equal(fx().at(-1).mediaFit, 'cover');
});

test('bình luận chỉ kích hiệu ứng khi có từ khoá', () => {
  const { engine } = setup((c) => {
    c.rules.push({ id: 'kw', name: 'Lệnh', trigger: { type: 'chat', keyword: '!Hoa' }, action: { effect: 'stars' } });
    c.rules.push({ id: 'nokw', name: 'Trống', trigger: { type: 'chat', keyword: '' }, action: { effect: 'stars' } });
  });
  assert.deepEqual(engine.handle({ type: 'chat', text: 'xin chào' }), []);
  assert.deepEqual(engine.handle({ type: 'chat', text: 'cho xin !hoa nha' }), ['kw']);
});

test('nút bấm tay không tự chạy theo sự kiện, chỉ chạy qua fireRule', () => {
  const { engine, fx } = setup();
  for (const type of ['follow', 'gift', 'like', 'share', 'chat', 'join', 'button']) engine.handle({ type, user: `u-${type}`, coins: 1, likeCount: 1 });
  assert.ok(!fx().some((m) => m.effect === 'fireworks' && m.sound === 'fanfare'));
  assert.equal(engine.fireRule('r-btn-party'), true);
  assert.equal(fx().at(-1).effect, 'fireworks');
  assert.equal(engine.fireRule('khong-co'), false);
});

test('thanh mục tiêu cộng xu và tin tổng tim do TikTok báo', () => {
  const { engine, out, config } = setup();
  config.widgets.goal.type = 'coins';
  engine.handle({ type: 'gift', coins: 30 });
  engine.handle({ type: 'gift', coins: 12 });
  assert.equal(out.filter((m) => m.type === 'goal').at(-1).value, 42);
  config.widgets.goal.type = 'likes';
  engine.handle({ type: 'like', likeCount: 5, totalLikes: 900 });
  assert.equal(engine.goalState().value, 900);
});

test('cấu hình bẩn được làm sạch', () => {
  const c = sanitizeConfig({
    tiktok: { username: '@Kenh_Cua_Toi ' },
    remote: { enabled: true, token: 'khong-hop-le' },
    rules: [
      { id: 'a b<script>', trigger: { type: 'hotkey', minCoins: -5, every: 0 }, action: { effect: 'hack', intensity: 99, sound: 'file:../../x.mp3', media: '../secret.txt', mediaKey: 'pink' } },
      { id: 'ab', trigger: { type: 'nope' } },
    ],
  });
  assert.equal(c.tiktok.username, 'Kenh_Cua_Toi');
  assert.equal(c.remote.token, '');
  const [r, r2] = c.rules;
  assert.equal(r.id, 'abscript');
  assert.equal(r.trigger.type, 'button'); // tên cũ "hotkey"
  assert.equal(r.trigger.minCoins, 0);
  assert.equal(r.trigger.every, 1);
  assert.equal(r.action.effect, 'none');
  assert.equal(r.action.intensity, 3);
  assert.equal(r.action.sound, 'file:x.mp3');
  assert.equal(r.action.media, '');
  assert.equal(r.action.mediaKey, 'none');
  assert.equal(r2.trigger.type, 'gift');
  assert.notEqual(r.id, r2.id);
});

test('tên tệp thư viện không thoát được khỏi thư mục', () => {
  assert.deepEqual(safeMediaName('../../etc/passwd'), null);
  assert.deepEqual(safeMediaName('C:\\Users\\a\\hiệu ứng rồng.webm'), { name: 'hiệu ứng rồng.webm', kind: 'video' });
  assert.deepEqual(safeMediaName('..hidden.mp3'), { name: 'hidden.mp3', kind: 'audio' });
  assert.equal(safeMediaName('virus.exe'), null);
});

test('quà theo chuỗi chỉ tính khi chuỗi kết thúc', () => {
  const streak = { giftId: '5655', repeatCount: 7, user: { displayId: 'an', nickname: 'An', avatarThumb: { urlList: ['https://x/a.jpg'] } }, gift: { name: 'Rose', type: 1, diamondCount: 1, image: { urlList: ['https://x/rose.png'] } } };
  assert.equal(normalizeGift({ ...streak, repeatEnd: 0 }), null);
  assert.deepEqual(normalizeGift({ ...streak, repeatEnd: 1 }), {
    type: 'gift', user: 'an', nickname: 'An', avatar: 'https://x/a.jpg', giftName: 'Rose', giftImage: 'https://x/rose.png', count: 7, coins: 7,
  });
  // Dạng trường của phiên bản giao thức cũ.
  const old = normalizeGift({ repeatCount: 1, user: { uniqueId: 'b' }, giftDetails: { giftName: 'Lion', giftType: 2, diamondCount: 29999, giftImage: { giftPictureUrl: 'https://x/l.png' } } });
  assert.equal(old.coins, 29999);
  assert.equal(old.giftImage, 'https://x/l.png');
  assert.equal(normalizeUser({ uniqueId: 'b' }).nickname, 'b');
});

test('lỗi kết nối được dịch sang câu dễ hiểu', () => {
  assert.match(friendlyError(Object.assign(new Error('x'), { name: 'UserOfflineError' })), /chưa bật LIVE/);
  assert.match(friendlyError(new Error('Rate limited, 429')), /giới hạn/);
  assert.match(friendlyError(new Error('getaddrinfo ENOTFOUND www.tiktok.com')), /mạng/);
  assert.match(friendlyError(new Error('Failed to retrieve Room ID from all sources.')), /ID TikTok.*Internet/);
  assert.match(friendlyError(Object.assign(new Error('x'), { name: 'SignatureRateLimitError' })), /giới hạn/);
});
