const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { startApi } = require('../../server/api/api.cjs');

const rootDir = path.resolve(__dirname, '../..');
let server;
let workspaceDir = null;

function workspaceConfigFile() {
  return path.join(app.getPath('userData'), 'workspace.json');
}

function defaultDataDir() {
  return app.isPackaged ? app.getPath('userData') : path.join(rootDir, 'data');
}

function readWorkspaceDir() {
  try {
    const raw = JSON.parse(fs.readFileSync(workspaceConfigFile(), 'utf8'));
    if (typeof raw?.path === 'string' && raw.path.trim()) {
      const candidate = path.resolve(raw.path);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    }
  } catch {
    // no saved workspace yet
  }
  return defaultDataDir();
}

function currentDataDir() {
  if (!workspaceDir) workspaceDir = readWorkspaceDir();
  return workspaceDir;
}

function startLocalApi() {
  if (process.env.WARPVEFT_SKIP_LOCAL_API === '1') return null;
  const dataDir = currentDataDir();
  const instance = startApi({
    rootDir,
    dataDir,
    port: 4317,
    // The persisted server config decides loopback vs LAN; WARPVEFT_HOST is
    // kept as a development override.
    host: process.env.WARPVEFT_HOST || undefined,
    packaged: app.isPackaged,
    configFile: path.join(dataDir, 'server-config.json'),
  });
  instance.on('error', (error) => console.error('Local API error:', error));
  return instance;
}

ipcMain.handle('warpweft:get-workspace', async () => ({
  path: currentDataDir(),
  customizable: true,
}));

ipcMain.handle('warpweft:choose-workspace', async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const options = {
    title: '选择工作区存放位置',
    defaultPath: currentDataDir(),
    properties: ['openDirectory', 'createDirectory'],
  };
  const chosen = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  if (chosen.canceled || !chosen.filePaths?.[0]) return { canceled: true };
  const selected = path.resolve(chosen.filePaths[0]);
  try {
    if (!fs.existsSync(selected) || !fs.statSync(selected).isDirectory()) {
      return { status: 'failed', error: '所选位置不是文件夹' };
    }
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(workspaceConfigFile(), JSON.stringify({ path: selected }, null, 2), 'utf8');
    return { status: 'saved', path: selected, restartRequired: true };
  } catch (error) {
    return { status: 'failed', error: error.message };
  }
});

ipcMain.handle('warpweft:save-export', async (event, payload) => {
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
    return { status: 'failed', error: '导出数据格式无效' };
  }
  if (buffer.length > 50 * 1024 * 1024) return { status: 'failed', error: '导出文件过大' };
  if (buffer.length === 0) return { status: 'failed', error: '导出内容为空' };

  const extension = path.extname(filename).toLowerCase();
  const filters =
    extension === '.csv'
      ? [{ name: 'CSV 文件', extensions: ['csv'] }]
      : extension === '.xlsx'
        ? [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
        : [];
  const options = {
    title: '保存导出文件',
    defaultPath: path.join(app.getPath('downloads'), filename),
    filters,
  };
  const window = BrowserWindow.fromWebContents(event.sender);
  const chosen = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
  if (chosen.canceled || !chosen.filePath) return { status: 'canceled' };
  try {
    fs.mkdirSync(path.dirname(chosen.filePath), { recursive: true });
    fs.writeFileSync(chosen.filePath, buffer);
    return { status: 'saved', path: chosen.filePath };
  } catch (error) {
    return { status: 'failed', error: error.message };
  }
});

ipcMain.handle('warpweft:show-item', async (_event, target) => {
  if (typeof target !== 'string' || !target.trim()) return { ok: false, error: '没有文件路径' };
  try {
    if (!fs.existsSync(target)) return { ok: false, error: '文件不存在：' + target };
    shell.showItemInFolder(target);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
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
