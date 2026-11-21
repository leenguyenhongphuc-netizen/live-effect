// Không khí sân khấu: phủ một tông màu lên cả khung hình, sương khói dưới sàn, và màn khói
// tối lướt qua mỗi lần đổi góc máy (thay cho cắt cảnh cứng).

export class Atmos {
  constructor(root) {
    this.tint = document.createElement('div');
    this.tint.id = 'tint';
    this.fog = document.createElement('div');
    this.fog.id = 'fog';
    this.wipeEl = document.createElement('div');
    this.wipeEl.id = 'wipe';
    root.prepend(this.tint, this.fog);
    root.append(this.wipeEl);
    this.level = 'normal';
  }

  setMood({ level = 'normal', tint = '', fog = false, active = false } = {}) {
    this.level = level;
    const strength = { calm: 0.1, normal: 0.16, peak: 0.26 }[level] || 0.16;
    this.tint.style.background = active && tint ? tint : 'transparent';
    this.tint.style.opacity = active && tint ? String(strength) : '0';
    this.fog.dataset.level = level;
    this.fog.classList.toggle('on', Boolean(active && fog));
  }

  /** Màn khói tối lướt nhanh, che khoảnh khắc đổi góc máy. */
  wipe() {
    this.wipeEl.classList.remove('go');
    void this.wipeEl.offsetWidth; // khởi động lại animation
    this.wipeEl.classList.add('go');
  }
}
