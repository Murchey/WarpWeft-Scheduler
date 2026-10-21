const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { startApi } = require('./api.cjs');

const rootDir = path.resolve(__dirname, '../..');
let server;

function startLocalApi() {
  const dataDir = app.isPackaged ? app.getPath('userData') : path.join(rootDir, 'data');
  const instance = startApi({
    rootDir,
    dataDir,
    port: 4317,
    packaged: app.isPackaged,
  });
  instance.on('error', (error) => console.error('Local API error:', error));
  return instance;
}

ipcMain.handle('warpweft:save-export', async (_event, payload) => {
  const rawName = String(payload?.filename || 'warpweft-export');
  const filename = path
    .basename(rawName)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'warpweft-export';
  const data = payload?.data;
  let buffer;
  if (data instanceof ArrayBuffer) {
    buffer = Buffer.from(new Uint8Array(data));
  } else if (ArrayBuffer.isView(data)) {
    buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  } else {
    throw new Error('导出数据格式无效');
  }
  if (buffer.length > 50 * 1024 * 1024) throw new Error('导出文件过大');
  const downloads = app.getPath('downloads');
  fs.mkdirSync(downloads, { recursive: true });
  let target = path.join(downloads, filename);
  if (fs.existsSync(target)) {
    const extension = path.extname(filename);
    const base = path.basename(filename, extension);
    target = path.join(downloads, base + '-' + Date.now() + extension);
  }
  fs.writeFileSync(target, buffer);
  return target;
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 700,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // Load from the local HTTP server, not file://. ES module scripts are
    // blocked under file:// in Chromium, which produced a blank packaged app.
    window.loadURL('http://127.0.0.1:4317/');
  }
}

app.whenReady().then(() => {
  const openWindow = () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  };
  try {
    server = startLocalApi();
    if (!server) {
      openWindow();
    } else if (server.listening) {
      openWindow();
    } else {
      server.once('listening', openWindow);
      server.once('error', (error) => {
        console.error('Local API failed:', error);
        openWindow();
      });
    }
  } catch (error) {
    console.error('Unable to start local API:', error);
    openWindow();
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (server) server.close();
  if (process.platform !== 'darwin') app.quit();
});