// Bắt nhịp từ năng lượng âm trầm. Thuần tính toán (không đụng WebAudio) để kiểm thử được.
//
// Cách làm: một nhịp là lúc năng lượng TĂNG vọt so với khung trước (flux), vượt hẳn mức
// dao động bình thường của khoảng một giây gần nhất. Nhờ so với chính nền của bài nhạc,
// bài nhỏ hay to, dồn dập hay thưa đều bắt được mà không cần chỉnh tay.

const avg = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

export class BeatDetector {
  constructor({ sensitivity = 1, minGapMs = 230, window = 45 } = {}) {
    this.sensitivity = sensitivity;
    this.minGapMs = minGapMs; // chặn bắt trùng một tiếng trống; cũng là trần ~260 nhịp/phút
    this.window = window;
    this.hist = [];
    this.prev = 0;
    this.last = -Infinity;
    this.intervals = [];
    this.bpm = 0;
  }

  /**
   * @param {number} energy năng lượng âm trầm đã chuẩn hoá 0..1
   * @param {number} tMs thời điểm của khung (ms)
   * @returns {{ beat: boolean, strength: number }}
   */
  push(energy, tMs) {
    const flux = Math.max(0, energy - this.prev);
    this.prev = energy;
    const h = this.hist;
    const mean = avg(h);
    const sd = Math.sqrt(avg(h.map((x) => (x - mean) ** 2)));
    const threshold = mean + (2.2 * sd + 0.02) / this.sensitivity;
    h.push(flux);
    if (h.length > this.window) h.shift();

    if (h.length < 12 || flux <= threshold || energy < 0.1 || tMs - this.last < this.minGapMs) {
      return { beat: false, strength: 0 };
    }
    const gap = tMs - this.last;
    this.last = tMs;
    if (gap >= 250 && gap <= 1500) {
      this.intervals.push(gap);
      if (this.intervals.length > 12) this.intervals.shift();
      if (this.intervals.length >= 4) {
        const sorted = [...this.intervals].sort((a, b) => a - b);
        let bpm = 60000 / sorted[sorted.length >> 1];
        while (bpm < 70) bpm *= 2;
        while (bpm > 180) bpm /= 2;
        this.bpm = Math.round(bpm);
      }
    }
    return { beat: true, strength: Math.min(1, Math.max(0.25, flux / (threshold * 2.5))) };
  }

  reset() {
    this.hist.length = 0;
    this.intervals.length = 0;
    this.prev = 0;
    this.last = -Infinity;
    this.bpm = 0;
  }
}
