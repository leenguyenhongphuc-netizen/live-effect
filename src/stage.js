// Sân khấu: đạo diễn hình cho người diễn một mình.
//   - Bài diễn có nhạc là tệp trên máy: các mốc chạy đúng từng giây, hết bài tự sang bài kế.
//   - Bài diễn không gắn tệp nhạc (nhạc phát từ phần mềm DJ, Spotify…): ứng dụng chỉ nghe được
//     tiếng, nên tự nhận biết đoạn lắng / đoạn cao trào theo độ mạnh của nhạc và điều khiển hình theo.
//   - Hai góc máy đổi theo mốc, theo nhịp, hoặc bấm tay.

const PEAK_HOLD_MS = 6000; // sau mỗi lần đổi trạng thái, giữ ít nhất chừng này trước khi đổi tiếp

/** Nhận biết đoạn cao trào từ độ mạnh của nhạc: so mức hiện tại với mức trung bình dài hạn. */
export class MoodTracker {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.fast = 0;
    this.slow = 0;
    this.level = 'normal';
    this.above = 0;
    this.below = 0;
    this.mid = 0;
    this.changedAt = -Infinity;
  }

  /** @param {number} energy 0..1 @returns {string | null} trạng thái mới nếu vừa đổi */
  push(energy) {
    if (this.slow === 0) this.slow = energy;
    this.fast += (energy - this.fast) * 0.2;
    // Mức trung bình dài hạn (khoảng 15 giây): điệp khúc dài vẫn được tính là cao trào.
    this.slow += (energy - this.slow) * 0.002;
    const hot = this.fast > 0.4 && this.fast > this.slow * 1.2;
    const cold = this.fast < Math.max(0.12, this.slow * 0.6);
    this.above = hot ? this.above + 1 : 0;
    this.below = cold ? this.below + 1 : 0;
    this.mid = !hot && !cold ? this.mid + 1 : 0; // phải ở lưng chừng khoảng 1 giây mới coi là hết cao trào / hết lắng
    if (this.now() - this.changedAt < PEAK_HOLD_MS) return null;
    let next = this.level;
    if (this.above >= 10) next = 'peak';
    else if (this.below >= 45) next = 'calm';
    else if (this.level !== 'normal' && this.mid >= 30) next = 'normal';
    if (next === this.level) return null;
    this.level = next;
    this.changedAt = this.now();
    return next;
  }
}

export class Stage {
  constructor({ getConfig, emit, fireCue, switchCam, onMood, now = () => Date.now() }) {
    this.getConfig = getConfig;
    this.emit = emit;
    this.fireCue = fireCue;
    this.switchCam = switchCam;
    this.onMood = onMood;
    this.now = now;
    this.timers = [];
    this.running = null; // { id, name, startedAt, length, timed }
    this.cam = 1;
    this.beats = 0;
    this.mood = new MoodTracker(now);
    this.level = 'normal';
    this.forced = null;
  }

  get cfg() {
    return this.getConfig().stage;
  }

  get show() {
    return this.running ? this.cfg.shows.find((s) => s.id === this.running.id) || null : null;
  }

  state() {
    const r = this.running;
    return {
      type: 'stage', cam: this.cam, level: this.level,
      running: r ? { id: r.id, name: r.name, timed: r.timed, elapsed: Math.round((this.now() - r.startedAt) / 1000), length: r.length } : null,
    };
  }

  /** Không khí hiện tại cho overlay và đèn: mức độ, tông màu và sương khói của bài đang diễn. */
  moodState() {
    const look = this.show?.look || { tint: '', fog: false };
    return { type: 'mood', level: this.level, tint: look.tint, fog: look.fog, active: Boolean(this.running) };
  }

  #setLevel(level) {
    if (level === this.level) return;
    this.level = level;
    const msg = this.moodState();
    this.emit(msg);
    this.emit(this.state());
    this.onMood?.(msg);
  }

  setCam(index) {
    const i = index === 2 ? 2 : 1;
    if (!this.cfg[`cam${i}`]) return false;
    if (i === this.cam) return true;
    this.cam = i;
    this.switchCam(i);
    this.emit(this.state());
    return true;
  }

  /** Mỗi khung phân tích nhạc (khoảng 30 lần mỗi giây). */
  onAudio({ level = 0, beat = false } = {}) {
    if (beat) {
      const n = this.cfg.beatSwitch;
      if (n && this.cfg.cam1 && this.cfg.cam2) {
        this.beats += 1;
        // Đang cao trào thì đổi góc máy nhanh gấp đôi.
        const every = this.level === 'peak' ? Math.max(1, Math.round(n / 2)) : n;
        if (this.beats % every === 0) this.setCam(this.cam === 1 ? 2 : 1);
      }
    }
    if (!this.running || !this.cfg.auto || this.forced) return;
    const next = this.mood.push(level);
    if (next) this.#setLevel(next);
  }

  /** Nút "Đẩy cao trào": ép lên cao trào trong vài giây rồi trả về tự động. */
  boost(seconds = 10) {
    clearTimeout(this.forced);
    this.#setLevel('peak');
    this.forced = setTimeout(() => { this.forced = null; this.#setLevel('normal'); }, seconds * 1000);
    this.forced.unref?.();
  }

  start(showId) {
    const show = this.cfg.shows.find((s) => s.id === showId);
    if (!show) return false;
    this.#halt();
    const cues = [...show.cues].sort((a, b) => a.t - b.t);
    const timed = Boolean(show.track);
    this.running = { id: show.id, name: show.name, startedAt: this.now(), length: cues.length ? cues.at(-1).t + 5 : 0, timed };
    this.mood = new MoodTracker(this.now);
    this.level = 'normal';
    this.emit({ type: 'show', cmd: 'start', track: show.track });
    for (const cue of cues) {
      const t = setTimeout(() => {
        if (cue.cam) this.setCam(cue.cam);
        this.fireCue(cue);
      }, cue.t * 1000);
      t.unref?.();
      this.timers.push(t);
    }
    const msg = this.moodState();
    this.emit(msg);
    this.onMood?.(msg);
    this.emit(this.state());
    return true;
  }

  /** Sang bài kế trong danh sách diễn (theo thứ tự các bài); hết danh sách thì dừng. */
  next() {
    const list = this.cfg.shows;
    if (!list.length) return false;
    const i = this.running ? list.findIndex((s) => s.id === this.running.id) : -1;
    const nxt = list[i + 1];
    if (!nxt) { this.stop(); return false; }
    return this.start(nxt.id);
  }

  /** Overlay báo bài nhạc đã hết: tự sang bài kế nếu đang bật tự chuyển bài. */
  trackEnded() {
    if (!this.running?.timed) return;
    if (this.cfg.autoNext) this.next(); else this.stop();
  }

  #halt() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    clearTimeout(this.forced);
    this.forced = null;
  }

  stop() {
    this.#halt();
    if (!this.running) return;
    this.running = null;
    this.level = 'normal';
    this.emit({ type: 'show', cmd: 'stop' });
    const msg = this.moodState();
    this.emit(msg);
    this.onMood?.(msg);
    this.emit(this.state());
  }

  close() {
    this.#halt();
  }
}
