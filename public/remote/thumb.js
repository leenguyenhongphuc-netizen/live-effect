// Tạo ảnh thu nhỏ JPEG từ một tệp video hoặc hình vừa chọn, ngay trong trình duyệt.
// Dùng chung cho bảng điều khiển trên máy tính và trang điện thoại.

const WIDTH = 320;

function draw(source, w, h) {
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = Math.round((WIDTH * h) / w);
  const g = canvas.getContext('2d');
  // Video hiệu ứng trong suốt cần nền tối để nhìn rõ trên nút.
  g.fillStyle = '#17161a';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
}

/** @returns {Promise<Blob|null>} null khi trình duyệt không giải mã được tệp. */
export function makeThumb(file, timeoutMs = 6000) {
  const url = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video/') || /\.(webm|mp4|mov)$/i.test(file.name);
  const work = new Promise((resolve) => {
    if (!isVideo) {
      const img = new Image();
      img.onload = () => resolve(draw(img, img.naturalWidth, img.naturalHeight));
      img.onerror = () => resolve(null);
      img.src = url;
      return;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onerror = () => resolve(null);
    video.onloadedmetadata = () => {
      // Lấy khung hình ở khoảng 1/3 video: đầu video hiệu ứng thường còn đen.
      const at = Number.isFinite(video.duration) ? Math.min(video.duration * 0.35, 4) : 0.5;
      video.onseeked = () => resolve(draw(video, video.videoWidth, video.videoHeight));
      video.currentTime = at;
    };
    video.src = url;
    video.load();
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
  return Promise.race([work, timeout]).catch(() => null).finally(() => URL.revokeObjectURL(url));
}
