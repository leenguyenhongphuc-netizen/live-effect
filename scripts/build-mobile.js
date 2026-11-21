// Gom bản web cho điện thoại (thư mục mobile/) thành một trang tĩnh trong dist-mobile/,
// kèm trình xoá nền clip dùng chung với overlay và thư viện tách người.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist-mobile');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'mobile'), out, { recursive: true });
fs.mkdirSync(path.join(out, 'vendor/mediapipe'), { recursive: true });
fs.copyFileSync(path.join(root, 'public/overlay/key.js'), path.join(out, 'vendor/key.js'));
const mp = path.join(root, 'node_modules/@mediapipe/tasks-vision');
fs.copyFileSync(path.join(mp, 'vision_bundle.mjs'), path.join(out, 'vendor/mediapipe/vision_bundle.mjs'));
fs.cpSync(path.join(mp, 'wasm'), path.join(out, 'vendor/mediapipe/wasm'), { recursive: true });
console.log(`Xong: ${out}`);
