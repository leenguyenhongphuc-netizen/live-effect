// Xoá nền video ngay lúc phát bằng WebGL: nền đen (video hiệu ứng kiểu "screen")
// hoặc nền xanh lá (green screen). Nhờ vậy dùng được video MP4 thường làm hiệu ứng
// trong suốt, không cần xuất WebM có kênh alpha.

const VERT = `
attribute vec2 p;
varying vec2 uv;
void main() { uv = vec2((p.x + 1.0) / 2.0, (1.0 - p.y) / 2.0); gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision mediump float;
uniform sampler2D tex;
uniform int mode;
varying vec2 uv;
void main() {
  vec4 c = texture2D(tex, uv);
  float a = 1.0;
  if (mode == 1) {
    // Nền đen: điểm càng tối càng trong suốt.
    a = smoothstep(0.04, 0.32, max(c.r, max(c.g, c.b)));
  } else {
    // Nền xanh lá: trong suốt theo mức xanh trội hơn đỏ và lam, rồi khử viền xanh.
    float d = c.g - max(c.r, c.b);
    a = 1.0 - smoothstep(0.06, 0.28, d);
    c.g = min(c.g, max(c.r, c.b) + 0.06);
  }
  gl_FragColor = vec4(c.rgb * a, a);
}`;

/** Trả về canvas hiển thị `video` đã xoá nền, hoặc null nếu máy không hỗ trợ WebGL. */
export function keyedCanvas(video, mode) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true });
  if (!gl) return null;

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'mode'), mode === 'black' ? 1 : 2);

  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // Vẽ theo nhịp màn hình. Trình duyệt báo "có khung hình mới" thì vẽ ngay; nếu tín hiệu đó
  // im lặng (có máy không báo đều cho video nằm ngoài trang) thì cứ khoảng 1/30 giây vẽ lại
  // một lần khi video đang chạy, để hiệu ứng không bao giờ bị trống.
  let stopped = false;
  let fresh = true;
  let lastTime = -1;
  let lastDraw = 0;
  const onFrame = () => { fresh = true; if (!stopped) video.requestVideoFrameCallback(onFrame); };
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(onFrame);
  const draw = (now) => {
    if (stopped) return;
    requestAnimationFrame(draw);
    if (video.readyState < 2 || !video.videoWidth) return;
    const moved = video.currentTime !== lastTime && now - lastDraw > 30;
    if (!fresh && !moved) return;
    fresh = false;
    lastTime = video.currentTime;
    lastDraw = now;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } catch { /* khung hình chưa sẵn sàng */ }
  };
  requestAnimationFrame(draw);
  canvas.stop = () => { stopped = true; };
  return canvas;
}
