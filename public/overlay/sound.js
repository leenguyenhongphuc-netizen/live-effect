// Âm thanh tổng hợp bằng WebAudio: không cần tệp âm thanh đi kèm.

let ctx = null;
let master = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, start, dur, { type = 'sine', gain = 0.5, slideTo } = {}) {
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(start, dur, { gain = 0.5, from = 4000, to = 200 } = {}) {
  const t0 = ctx.currentTime + start;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(from, t0);
  filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
}

const SYNTH = {
  ding() {
    tone(1318.5, 0, 0.9, { gain: 0.4 });
    tone(1975.5, 0.09, 1.1, { gain: 0.3 });
  },
  coin() {
    tone(987.8, 0, 0.09, { type: 'square', gain: 0.22 });
    tone(1318.5, 0.08, 0.45, { type: 'square', gain: 0.22 });
  },
  fanfare() {
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(f, i * 0.13, 0.28, { type: 'triangle', gain: 0.4 }));
    [523.3, 659.3, 784, 1046.5].forEach((f) => tone(f, 0.56, 0.9, { type: 'triangle', gain: 0.22 }));
  },
  pop() {
    tone(520, 0, 0.14, { gain: 0.5, slideTo: 1400 });
  },
  boom() {
    noise(0, 0.9, { gain: 0.7, from: 2600, to: 90 });
    tone(110, 0, 0.7, { gain: 0.6, slideTo: 38 });
  },
  whoosh() {
    noise(0, 0.55, { gain: 0.35, from: 300, to: 5200 });
  },
};

const playing = new Set();

export function playSound(id, muted) {
  if (muted || !id || id === 'none') return;
  if (id.startsWith('file:')) {
    const el = new Audio(`/media/${encodeURIComponent(id.slice(5))}`);
    el.volume = 0.9;
    playing.add(el);
    el.onended = el.onerror = () => playing.delete(el);
    el.play().catch(() => playing.delete(el));
    return;
  }
  if (!SYNTH[id] || !audio()) return;
  SYNTH[id]();
}

export function stopSounds() {
  for (const el of playing) el.pause();
  playing.clear();
}
