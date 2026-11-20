// Chạy lõi ứng dụng không cần Electron (để phát triển và kiểm thử trong trình duyệt).
import path from 'node:path';
import os from 'node:os';
import { startApp } from '../src/server.js';

const dataDir = process.env.LIVE_EFFECT_DATA || path.join(os.homedir(), '.live-effect-dev');
const app = await startApp({ dataDir, port: Number(process.env.PORT) || undefined });
console.log(`Bảng điều khiển: ${app.url}`);
console.log(`Link overlay:    ${app.overlayUrl}`);
