// Vỏ Windows của Live Effect: khởi động lõi (máy chủ cục bộ), mở cửa sổ bảng điều khiển
// và đăng ký phím tắt toàn hệ thống cho các kịch bản "Nút bấm tay".
import { app, BrowserWindow, Menu, dialog, globalShortcut, shell } from 'electron';
import { startApp } from '../src/server.js';

let win = null;
let core = null;

// Cho phép overlay xem thử và giọng đọc phát tiếng mà không cần bấm chuột trước.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function registerHotkeys(config) {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const rule of config.rules) {
    if (!rule.enabled || rule.trigger.type !== 'button' || !rule.trigger.hotkey) continue;
    let ok = false;
    try {
      ok = globalShortcut.register(rule.trigger.hotkey, () => core?.fireRule(rule.id));
    } catch { /* tổ hợp phím không hợp lệ */ }
    if (!ok) failed.push(rule.id);
  }
  core?.setHotkeyErrors(failed);
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#17161a',
    title: 'Live Effect',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Cửa sổ thu nhỏ vẫn phải đọc bình luận và nhận sự kiện đúng lúc.
      backgroundThrottling: false,
    },
  });
  const origin = new URL(core.url).origin;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  win.on('closed', () => { win = null; });
  await win.loadURL(core.url);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      core = await startApp({ dataDir: app.getPath('userData'), hotkeys: true, onConfigChange: registerHotkeys });
    } catch (err) {
      dialog.showErrorBox('Live Effect không khởi động được', String(err?.message || err));
      app.quit();
      return;
    }
    registerHotkeys(core.config);
    await createWindow();
  });

  app.on('window-all-closed', async () => {
    globalShortcut.unregisterAll();
    try { await core?.close(); } catch { /* đang thoát */ }
    app.quit();
  });
}
