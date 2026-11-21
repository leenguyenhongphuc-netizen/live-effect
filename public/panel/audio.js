import { BeatDetector } from '/panel/beat.js';

// Nghe nhạc đang phát rồi phân tích: mức âm trầm / trung / cao, phổ 12 dải, và nhịp.
// Chạy trong bảng điều khiển vì overlay nằm trong OBS không thu được âm thanh của máy.

const TICK_MS = 22;
const SEND_MS = 33;

const RAW = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

export async function listInputs() {
  try {
    return (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, name: d.label || `Thiết bị thu ${i + 1}` }));
  } catch {
    return [];
  }
}

export class AudioReactive {
  /** @param {(frame: object) => void} onFrame nhận khung phân tích ~30 lần mỗi giây */
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.running = false;
    this.detector = new BeatDetector();
  }

  async start({ source, deviceId, sensitivity }) {
    this.stop();
    let stream;
    if (source === 'system') {
      // Trong ứng dụng Windows: lấy thẳng âm thanh đang phát của máy. Trong trình duyệt:
      // hiện hộp thoại chia sẻ, cần tick "chia sẻ âm thanh".
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: RAW });
      stream.getVideoTracks().forEach((t) => t.stop());
      if (!stream.getAudioTracks().length) {
        throw new Error('Nguồn vừa chọn không kèm âm thanh. Chọn lại và bật "Chia sẻ âm thanh".');
      }
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...RAW, deviceId: { exact: deviceId } } : RAW });
    }
    this.stream = stream;
    this.ctx = new AudioContext();
    await this.ctx.resume().catch(() => {});
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.35;
    this.ctx.createMediaStreamSource(stream).connect(this.analyser);

    const bins = new Uint8Array(this.analyser.frequencyBinCount);
    const hz = this.ctx.sampleRate / this.analyser.fftSize;
    const range = (lo, hi) => [Math.max(1, Math.round(lo / hz)), Math.max(2, Math.round(hi / hz))];
    const mean = ([a, b]) => { let s = 0; for (let i = a; i < b; i++) s += bins[i]; return s / ((b - a) * 255); };
    const BASS = range(30, 160);
    const MID = range(160, 2000);
    const HIGH = range(2000, 9000);
    // 12 dải cách đều theo thang logarit, cho phần sóng nhạc.
    const edges = Array.from({ length: 13 }, (_, i) => 40 * (9000 / 40) ** (i / 12));
    const BANDS = edges.slice(0, 12).map((lo, i) => range(lo, edges[i + 1]));

    this.detector = new BeatDetector({ sensitivity });
    let peak = 0.2; // đỉnh gần đây, để nhạc nhỏ hay to đều cho ra mức 0..1
    let lastSend = 0;
    this.running = true;
    this.timer = setInterval(() => {
      this.analyser.getByteFrequencyData(bins);
      const raw = { b: mean(BASS), m: mean(MID), h: mean(HIGH) };
      peak = Math.max(raw.b, raw.m, peak * 0.9995, 0.12);
      const b = Math.min(1, raw.b / peak);
      const now = performance.now();
      const { beat, strength } = this.detector.push(b, now);
      if (!beat && now - lastSend < SEND_MS) return;
      lastSend = now;
      const m = Math.min(1, raw.m / peak);
      const h = Math.min(1, (raw.h / peak) * 1.6);
      this.onFrame({
        b, m, h, l: Math.min(1, (b + m + h) / 2.2), beat, s: strength, bpm: this.detector.bpm,
        bands: BANDS.map((r) => Math.min(100, Math.round((mean(r) / peak) * 100))),
      });
    }, TICK_MS);
    stream.getAudioTracks()[0].addEventListener('ended', () => { this.stop(); this.onEnded?.(); });
  }

  setSensitivity(v) {
    this.detector.sensitivity = v;
  }

  stop() {
    clearInterval(this.timer);
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
  }
}
