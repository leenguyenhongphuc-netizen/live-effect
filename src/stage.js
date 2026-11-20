// Sân khấu: chạy một "bài diễn" — một bài nhạc cùng các mốc hiệu ứng đặt theo giây —
// và đổi qua lại giữa hai góc camera (hai cảnh OBS) theo mốc hoặc theo nhịp.

export class Stage {
  /**
   * @param {object} deps
   * @param {() => object} deps.getConfig
   * @param {(msg: object) => void} deps.emit gửi lệnh nhạc cho overlay và trạng thái cho bảng điều khiển
   * @param {(cue: object) => void} deps.fireCue phát hiệu ứng của một mốc
   * @param {(index: 1 | 2) => void} deps.switchCam đổi sang camera 1 hoặc 2
   */
  constructor({ getConfig, emit, fireCue, switchCam, now = () => Date.now() }) {
    this.getConfig = getConfig;
    this.emit = emit;
    this.fireCue = fireCue;
    this.switchCam = switchCam;
    this.now = now;
    this.timers = [];
    this.running = null; // { id, name, startedAt, length }
    this.cam = 1;
    this.beats = 0;
  }

  get cfg() {
    return this.getConfig().stage;
  }

  state() {
    const r = this.running;
    return { type: 'stage', running: r ? { id: r.id, name: r.name, elapsed: Math.round((this.now() - r.startedAt) / 1000), length: r.length } : null, cam: this.cam };
  }

  setCam(index) {
    const i = index === 2 ? 2 : 1;
    if (!this.cfg[`cam${i}`]) return false;
    this.cam = i;
    this.switchCam(i);
    this.emit(this.state());
    return true;
  }

  /** Gọi ở mỗi nhịp nhạc: tự đổi camera sau mỗi N nhịp nếu đang bật. */
  onBeat() {
    const n = this.cfg.beatSwitch;
    if (!n || !this.cfg.cam1 || !this.cfg.cam2) return;
    this.beats += 1;
    if (this.beats % n === 0) this.setCam(this.cam === 1 ? 2 : 1);
  }

  start(showId) {
    const show = this.cfg.shows.find((s) => s.id === showId);
    if (!show) return false;
    this.stop(true);
    const cues = [...show.cues].sort((a, b) => a.t - b.t);
    const length = cues.length ? cues.at(-1).t + 5 : 5;
    this.running = { id: show.id, name: show.name, startedAt: this.now(), length };
    this.emit({ type: 'show', cmd: 'start', track: show.track });
    for (const cue of cues) {
      const t = setTimeout(() => {
        if (cue.cam) this.setCam(cue.cam);
        this.fireCue(cue);
      }, cue.t * 1000);
      t.unref?.();
      this.timers.push(t);
    }
    // Không có nhạc thì bài diễn kết thúc sau mốc cuối; có nhạc thì overlay báo hết bài (xem done()).
    if (!show.track) { const end = setTimeout(() => this.stop(), length * 1000); end.unref?.(); this.timers.push(end); }
    this.emit(this.state());
    return true;
  }

  stop(silent = false) {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (!this.running) return;
    this.running = null;
    this.emit({ type: 'show', cmd: 'stop' });
    if (!silent) this.emit(this.state());
  }

  close() {
    for (const t of this.timers) clearTimeout(t);
  }
}
