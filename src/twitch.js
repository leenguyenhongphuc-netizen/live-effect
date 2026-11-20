import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

// Đọc chat Twitch cho stream game. Dùng cổng IRC công khai của Twitch ở chế độ khách
// (chỉ đọc), nên không cần đăng nhập hay khoá API.
//   Bình luận  -> sự kiện chat
//   Bits       -> sự kiện quà tên "Bits" (1 bit = 1 xu)
//   Sub        -> sự kiện quà tên "Sub"

const TWITCH_IRC = 'wss://irc-ws.chat.twitch.tv:443';
const SUB_COINS = 500;
const RETRY_DELAYS = [3000, 8000, 20000, 60000];

/** Tách một dòng IRC của Twitch thành { tags, command, channel, text }. */
export function parseIrc(line) {
  let rest = line;
  const tags = {};
  if (rest.startsWith('@')) {
    const end = rest.indexOf(' ');
    for (const pair of rest.slice(1, end).split(';')) {
      const eq = pair.indexOf('=');
      const value = eq < 0 ? '' : pair.slice(eq + 1);
      tags[eq < 0 ? pair : pair.slice(0, eq)] = value.replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\');
    }
    rest = rest.slice(end + 1);
  }
  let prefix = '';
  if (rest.startsWith(':')) {
    const end = rest.indexOf(' ');
    prefix = rest.slice(1, end);
    rest = rest.slice(end + 1);
  }
  const trail = rest.indexOf(' :');
  const head = (trail < 0 ? rest : rest.slice(0, trail)).split(' ');
  return {
    tags,
    prefix,
    command: head[0],
    channel: (head[1] || '').replace(/^#/, ''),
    text: trail < 0 ? '' : rest.slice(trail + 2),
  };
}

/** Đổi một tin IRC thành sự kiện chung của ứng dụng, hoặc null nếu không dùng. */
export function twitchEvent(msg) {
  const login = msg.tags.login || msg.prefix.split('!')[0] || '';
  const who = { user: login, nickname: msg.tags['display-name'] || login, avatar: '' };
  if (msg.command === 'PRIVMSG') {
    const bits = Number(msg.tags.bits) || 0;
    if (bits > 0) return { type: 'gift', ...who, giftName: 'Bits', count: bits, coins: bits, text: msg.text };
    return { type: 'chat', ...who, text: msg.text };
  }
  if (msg.command === 'USERNOTICE' && /^(sub|resub|subgift|anonsubgift)$/.test(msg.tags['msg-id'] || '')) {
    return { type: 'gift', ...who, giftName: 'Sub', count: 1, coins: SUB_COINS, text: msg.text };
  }
  return null;
}

export class TwitchSource extends EventEmitter {
  constructor({ WebSocketImpl = WebSocket, url = TWITCH_IRC } = {}) {
    super();
    this.WS = WebSocketImpl;
    this.url = url;
    this.status = { state: 'idle', channel: '', error: '' };
    this.ws = null;
    this.wanted = false;
    this.retry = 0;
    this.retryTimer = null;
    this.generation = 0;
  }

  #setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.status);
  }

  connect(channel) {
    this.disconnect();
    const name = String(channel || '').trim().toLowerCase().replace(/^.*twitch\.tv\//, '').replace(/^[@#]/, '');
    if (!/^[a-z0-9_]{2,25}$/.test(name)) {
      this.#setStatus({ state: 'error', channel: '', error: 'Tên kênh Twitch chỉ gồm chữ, số và dấu gạch dưới.' });
      return;
    }
    this.channel = name;
    this.wanted = true;
    this.retry = 0;
    this.#open();
  }

  #open() {
    const gen = ++this.generation;
    const live = () => gen === this.generation;
    this.#setStatus({ state: 'connecting', channel: this.channel, error: '' });
    let ws;
    try { ws = new this.WS(this.url); } catch (err) { this.#fail(err.message); return; }
    this.ws = ws;
    ws.on('open', () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`);
      ws.send(`JOIN #${this.channel}`);
    });
    ws.on('message', (data) => {
      if (!live()) return;
      for (const line of String(data).split('\r\n')) {
        if (!line) continue;
        if (line.startsWith('PING')) { ws.send(`PONG${line.slice(4)}`); continue; }
        const msg = parseIrc(line);
        if (msg.command === 'ROOMSTATE' || msg.command === '366') {
          this.retry = 0;
          if (this.status.state !== 'connected') this.#setStatus({ state: 'connected', error: '' });
          continue;
        }
        const ev = twitchEvent(msg);
        if (ev) this.emit('event', ev);
      }
    });
    ws.on('error', () => { /* close sẽ theo sau */ });
    ws.on('close', () => {
      if (!live() || !this.wanted) return;
      this.#fail('Mất kết nối Twitch');
    });
  }

  #fail(message) {
    if (this.retry >= RETRY_DELAYS.length) {
      this.wanted = false;
      this.#setStatus({ state: 'error', error: 'Không nối được chat Twitch. Kiểm tra tên kênh và mạng rồi bấm Kết nối lại.' });
      return;
    }
    const delay = RETRY_DELAYS[this.retry++];
    this.#setStatus({ state: 'connecting', error: `${message}, thử lại sau ${Math.round(delay / 1000)} giây` });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => { if (this.wanted) this.#open(); }, delay);
  }

  disconnect() {
    this.wanted = false;
    this.generation++;
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.terminate?.() ?? ws.close(); } catch { /* đã đóng */ } }
    this.#setStatus({ state: 'idle', channel: '', error: '' });
  }
}
