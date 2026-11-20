import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { Engine } from '../src/engine.js';
import { defaultConfig, sanitizeConfig } from '../src/defaults.js';
import { crc16, vietQrPayload, plainMemo, cleanMemo, formatVnd, sepayTime, SepaySource, BANKS } from '../src/donate.js';
import { parseIrc, twitchEvent } from '../src/twitch.js';
import { addOverlayToObs, addToObs, OBS_INPUT_NAME } from '../src/obs.js';
import { hookEvent } from '../src/server.js';

test('VietQR: đúng cấu trúc, đúng mã kiểm tra, nội dung không dấu', () => {
  assert.equal(crc16('123456789'), '29B1'); // giá trị kiểm tra chuẩn của CRC-16/CCITT-FALSE
  const p = vietQrPayload({ bin: '970422', account: '0123 456 789', memo: 'Ủng hộ Đào' });
  assert.ok(p.startsWith('000201010211'));
  assert.ok(p.includes('0010A000000727'));
  assert.ok(p.includes('0006970422' + '01100123456789'));
  assert.ok(p.includes('0208QRIBFTTA'));
  assert.ok(p.includes('5303704') && p.includes('5802VN'));
  assert.ok(p.includes('0810Ung ho Dao'));
  assert.equal(p.slice(-4), crc16(p.slice(0, -4)));
  // Có số tiền thì là mã dùng một lần (12) và có trường 54.
  const paid = vietQrPayload({ bin: '970436', account: '999', amount: 50000 });
  assert.ok(paid.startsWith('000201010212') && paid.includes('540550000'));
  assert.equal(vietQrPayload({ bin: '', account: '123' }), '');
  assert.equal(vietQrPayload({ bin: '970436', account: '' }), '');
  assert.equal(plainMemo('  Chị đẹp!!!  cố lên  '), 'Chi dep co len');
  assert.equal(new Set(BANKS.map((b) => b.bin)).size, BANKS.length);
  assert.equal(formatVnd(1250000), '1.250.000đ');
});

test('nội dung chuyển khoản lên sóng không lộ số tài khoản hay mã giao dịch', () => {
  assert.equal(cleanMemo('MBVCB.7654321098.123456.NGUYEN VAN AN chuc chi live vui.CT tu 0123456789 toi 9876543210 tai MB'), 'NGUYEN VAN AN chuc chi live vui');
  assert.equal(cleanMemo('toi yeu kenh nay FT24123456789'), 'toi yeu kenh nay');
  assert.equal(cleanMemo('Ung ho 50k nha <script>'), 'Ung ho 50k nha script');
  assert.equal(cleanMemo(''), '');
});

function fakeSepay(pages) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: new URL(url), auth: opts.headers.Authorization });
    const page = pages.shift() || { status: 200, body: { transactions: [] } };
    return { status: page.status, ok: page.status === 200, headers: { get: () => page.retry || null }, json: async () => page.body };
  };
  return { calls, fetchImpl };
}

test('SePay: bỏ qua giao dịch cũ, chỉ báo tiền vào mới, không báo trùng', async () => {
  const tx = (id, amountIn, content, amountOut = '0.00') => ({ id: String(id), amount_in: amountIn, amount_out: amountOut, transaction_content: content });
  const { calls, fetchImpl } = fakeSepay([
    { status: 200, body: { transactions: [tx(100, '900000.00', 'giao dich cu')] } },
    { status: 200, body: { transactions: [tx(102, '0.00', 'tien ra', '20000.00'), tx(101, '50000.00', 'AN ung ho chi')] } },
    // Giao dịch ghi giờ từ hôm trước (SePay trả về muộn) không được phát hiệu ứng.
    { status: 200, body: { transactions: [{ ...tx(103, '70000.00', 'hom qua'), transaction_date: '2026-11-19 08:00:00' }] } },
    { status: 429, retry: '9' },
    { status: 401, body: {} },
  ]);
  const src = new SepaySource({ fetchImpl, pollMs: 1000, now: () => Date.UTC(2026, 10, 20, 5, 0, 0) });
  const events = [];
  src.on('event', (e) => events.push(e));
  src.token = 'tok';
  src.account = '0123';

  assert.equal(await src.poll(), 1000);
  assert.equal(events.length, 0); // giao dịch có trước lúc bật không phát hiệu ứng
  assert.equal(calls[0].url.searchParams.get('limit'), '1');
  assert.equal(calls[0].auth, 'Bearer tok');
  assert.equal(calls[0].url.searchParams.get('account_number'), '0123');

  await src.poll();
  assert.deepEqual(events, [{ type: 'donate', user: '', nickname: '', amount: 50000, text: 'AN ung ho chi', source: 'bank' }]);
  assert.equal(calls[1].url.searchParams.get('since_id'), '101');
  assert.equal(src.status.state, 'connected');

  await src.poll();
  assert.equal(events.length, 1);
  assert.equal(calls[2].url.searchParams.get('since_id'), '103');

  assert.equal(sepayTime('2026-11-20 12:00:00'), Date.UTC(2026, 10, 20, 5, 0, 0));
  assert.equal(await src.poll(), 9000); // bị giới hạn lượt: chờ đúng số giây SePay yêu cầu
  await src.poll();
  assert.equal(src.status.state, 'error');
  assert.match(src.status.error, /API Token/);
});

test('kịch bản ủng hộ: ngưỡng tiền, lời nhắn, thanh mục tiêu và bảng top', () => {
  const config = defaultConfig();
  config.widgets.goal.type = 'donate';
  config.rules.push({ id: 'r-big', name: 'Ủng hộ lớn', trigger: { type: 'donate', minAmount: 100000 }, action: { effect: 'fireworks', alert: false } });
  const clean = sanitizeConfig(config);
  const out = [];
  const engine = new Engine(() => clean, (m) => out.push(m));

  assert.deepEqual(engine.handle({ type: 'donate', amount: 50000, text: 'co len' }), ['r-donate']);
  assert.equal(out.find((m) => m.type === 'fx').alert, 'Một bạn ủng hộ 50.000đ co len');
  assert.deepEqual(engine.handle({ type: 'donate', nickname: 'An', amount: 200000 }), ['r-donate', 'r-big']);
  assert.equal(out.filter((m) => m.type === 'fx').at(-2).alert, 'An ủng hộ 200.000đ');
  assert.equal(engine.goalState().value, 250000);

  engine.handle({ type: 'gift', user: 'a', nickname: 'A', coins: 10 });
  engine.handle({ type: 'gift', user: 'b', nickname: 'B', coins: 99 });
  engine.handle({ type: 'gift', user: 'a', nickname: 'A', coins: 100 });
  assert.deepEqual(engine.topState().rows.map((r) => [r.name, r.coins]), [['A', 110], ['B', 99]]);
  engine.resetSession();
  assert.deepEqual(engine.topState().rows, []);
});

test('cấu hình bản 0.1 được thêm kịch bản ủng hộ, bản mới thì không tự thêm lại', () => {
  const old = { version: 1, rules: [{ id: 'r-gift', name: 'Quà', trigger: { type: 'gift' }, action: {} }] };
  const up = sanitizeConfig(old);
  assert.equal(up.version, 2);
  assert.deepEqual(up.rules.map((r) => r.trigger.type), ['gift', 'donate']);
  assert.equal(up.donate.enabled, false);
  assert.equal(up.hook.enabled, false);
  // Người dùng đã xoá kịch bản ủng hộ ở bản mới: tôn trọng lựa chọn đó.
  const again = sanitizeConfig({ ...up, rules: up.rules.filter((r) => r.trigger.type !== 'donate') });
  assert.deepEqual(again.rules.map((r) => r.trigger.type), ['gift']);
  assert.equal(sanitizeConfig({ donate: { bank: 'abc', account: '12-34 56' } }).donate.bank, '');
  assert.equal(sanitizeConfig({ donate: { bank: '970422', account: '12-34 56' } }).donate.account, '123456');
});

test('Twitch: đọc bình luận, Bits và Sub từ dòng IRC', () => {
  const chat = parseIrc('@badge-info=;display-name=Game\\sThủ;user-id=1 :gamethu!gamethu@gamethu.tmi.twitch.tv PRIVMSG #kenh :!phaohoa di anh em');
  assert.equal(chat.command, 'PRIVMSG');
  assert.equal(chat.channel, 'kenh');
  assert.deepEqual(twitchEvent(chat), { type: 'chat', user: 'gamethu', nickname: 'Game Thủ', avatar: '', text: '!phaohoa di anh em' });

  const bits = twitchEvent(parseIrc('@bits=250;display-name=Fan :fan!fan@fan.tmi.twitch.tv PRIVMSG #kenh :cheer250 hay qua'));
  assert.deepEqual([bits.type, bits.giftName, bits.coins, bits.count], ['gift', 'Bits', 250, 250]);

  const sub = twitchEvent(parseIrc('@display-name=Bạn;login=ban;msg-id=resub :tmi.twitch.tv USERNOTICE #kenh :6 tháng rồi'));
  assert.deepEqual([sub.type, sub.giftName, sub.user, sub.nickname], ['gift', 'Sub', 'ban', 'Bạn']);

  assert.equal(twitchEvent(parseIrc(':tmi.twitch.tv ROOMSTATE #kenh')), null);
  assert.equal(twitchEvent(parseIrc('@msg-id=raid :tmi.twitch.tv USERNOTICE #kenh')), null);
});

/** Máy chủ giả nói giao thức obs-websocket v5, đủ để kiểm tra phần xác thực và các lệnh. */
async function fakeObs({ password = '', inputs = [] } = {}) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.on('listening', r));
  const requests = [];
  const sha = (t) => crypto.createHash('sha256').update(t).digest('base64');
  wss.on('connection', (ws) => {
    const hello = { obsWebSocketVersion: '5.5.0', rpcVersion: 1 };
    if (password) hello.authentication = { challenge: 'chal', salt: 'salt' };
    ws.send(JSON.stringify({ op: 0, d: hello }));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.op === 1) {
        if (password && msg.d.authentication !== sha(sha(password + 'salt') + 'chal')) { ws.close(4009, 'Authentication failed'); return; }
        ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      } else if (msg.op === 6) {
        requests.push(msg.d);
        const data = {
          GetCurrentProgramScene: { currentProgramSceneName: 'Cảnh live' },
          GetVideoSettings: { baseWidth: 1080, baseHeight: 1920 },
          GetInputList: { inputs },
        }[msg.d.requestType] || {};
        ws.send(JSON.stringify({ op: 7, d: { requestType: msg.d.requestType, requestId: msg.d.requestId, requestStatus: { result: true, code: 100 }, responseData: data } }));
      }
    });
  });
  return { port: wss.address().port, requests, close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(r); }) };
}

test('OBS: thêm nguồn trình duyệt đúng cảnh, đúng kích thước; đã có thì chỉ cập nhật', async () => {
  const obs = await fakeObs({ password: 'bi-mat' });
  try {
    const out = await addOverlayToObs({ url: 'http://127.0.0.1:3939/overlay', port: obs.port, password: 'bi-mat' });
    assert.deepEqual(out, { scene: 'Cảnh live', created: true, width: 1080, height: 1920 });
    const create = obs.requests.find((r) => r.requestType === 'CreateInput').requestData;
    assert.equal(create.sceneName, 'Cảnh live');
    assert.equal(create.inputName, OBS_INPUT_NAME);
    assert.equal(create.inputKind, 'browser_source');
    assert.deepEqual([create.inputSettings.url, create.inputSettings.width, create.inputSettings.height], ['http://127.0.0.1:3939/overlay', 1080, 1920]);

    await assert.rejects(addOverlayToObs({ url: 'x', port: obs.port, password: 'sai' }), { code: 'auth' });
    await assert.rejects(addOverlayToObs({ url: 'x', port: obs.port }), { code: 'auth' });
  } finally { await obs.close(); }

  const has = await fakeObs({ inputs: [{ inputName: OBS_INPUT_NAME }] });
  try {
    const viaConfig = await addToObs('http://127.0.0.1:3939/overlay', { readConfig: () => ({ port: has.port, password: '' }) });
    assert.equal(viaConfig.ok, true);
    assert.equal(viaConfig.created, false);
    assert.ok(has.requests.some((r) => r.requestType === 'SetInputSettings'));
    assert.ok(!has.requests.some((r) => r.requestType === 'CreateInput'));
  } finally { await has.close(); }

  // OBS không mở: báo lỗi kèm cách bật WebSocket, không treo.
  const off = await addToObs('http://x/overlay', { readConfig: () => ({ port: 1, password: '' }), timeoutMs: 1500 });
  assert.equal(off.ok, false);
  assert.match(off.error, /WebSocket Server Settings/);
});

test('link nhận sự kiện: chỉ nhận loại đã biết, kẹp giá trị', () => {
  assert.equal(hookEvent({ type: 'xoa-het' }), null);
  assert.deepEqual(hookEvent({ type: 'donate', name: ' An ', amount: '50000', text: 'hi' }),
    { type: 'donate', user: 'An', nickname: 'An', text: 'hi', source: 'hook', amount: 50000 });
  assert.equal(hookEvent({ type: 'donate', amount: '-5' }).amount, 0);
  const gift = hookEvent({ type: 'gift', gift: 'Rose', coins: '12', count: 'abc' });
  assert.deepEqual([gift.giftName, gift.coins, gift.count], ['Rose', 12, 1]);
});
