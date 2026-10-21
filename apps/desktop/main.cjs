const { app, BrowserWindow } = require('electron');
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

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 700,
    webPreferences: { contextIsolation: true, sandbox: true },
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