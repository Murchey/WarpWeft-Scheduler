const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { startApi } = require('../../server/api/api.cjs');

const rootDir = path.resolve(__dirname, '../..');
const appIcon = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(rootDir, 'assets', 'icon.png');

// WarpWeft only talks to its own local/LAN/cloud server. A system proxy that
// intercepts TLS (common with local Clash/V2Ray-style tools) makes Chromium
// reject an IP-address certificate with ERR_CERT_COMMON_NAME_INVALID. Connect
// directly by default; set WARPVEFT_USE_SYSTEM_PROXY=1 to opt back in.
if (process.env.WARPVEFT_USE_SYSTEM_PROXY !== '1') {
  app.commandLine.appendSwitch('no-proxy-server');
}

app.setAppUserModelId('com.warpweft.scheduler');
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

function safeExportFileName(rawName) {
  return path
    .basename(String(rawName || 'warpweft-export'))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .slice(0, 160) || 'warpweft-export';
}

function uniqueExportFileName(name, used) {
  const extension = path.extname(name);
  const stem = path.basename(name, extension);
  let candidate = name;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = stem + ' (' + suffix + ')' + extension;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

ipcMain.handle('warpweft:save-exports', async (event, payload) => {
  const folderName = safeExportFileName(payload?.folderName || '课表导出');
  const files = Array.isArray(payload?.files) ? payload.files : [];
  if (files.length === 0) return { status: 'failed', error: '没有可保存的文件' };
  if (files.length > 1000) return { status: 'failed', error: '一次最多保存 1000 个文件' };

  const pending = [];
  let totalBytes = 0;
  for (const file of files) {
    const filename = safeExportFileName(file?.filename);
    const extension = path.extname(filename).toLowerCase();
    if (extension !== '.xlsx' && extension !== '.csv') {
      return { status: 'failed', error: '不支持的导出文件类型：' + filename };
    }
    const data = file?.data;
    let buffer;
    if (data instanceof ArrayBuffer) {
      buffer = Buffer.from(new Uint8Array(data));
    } else if (ArrayBuffer.isView(data)) {
      buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    } else {
      return { status: 'failed', error: '导出数据格式无效：' + filename };
    }
    if (buffer.length === 0) return { status: 'failed', error: '导出内容为空：' + filename };
    if (buffer.length > 50 * 1024 * 1024) return { status: 'failed', error: '单个导出文件过大：' + filename };
    totalBytes += buffer.length;
    if (totalBytes > 500 * 1024 * 1024) return { status: 'failed', error: '批量导出文件总大小超过 500 MB' };
    pending.push({ filename, buffer });
  }

  const options = {
    title: '选择课表保存文件夹',
    defaultPath: app.getPath('downloads'),
    properties: ['openDirectory', 'createDirectory'],
  };
  const window = BrowserWindow.fromWebContents(event.sender);
  const chosen = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  if (chosen.canceled || !chosen.filePaths?.[0]) return { status: 'canceled' };
  const folder = path.resolve(chosen.filePaths[0]);
  try {
    await fs.promises.mkdir(folder, { recursive: true });
    const used = new Set();
    const targets = pending.map((file) => ({
      ...file,
      filename: uniqueExportFileName(file.filename, used),
    }));
    const conflicts = targets
      .filter((file) => fs.existsSync(path.join(folder, file.filename)))
      .map((file) => file.filename);
    if (conflicts.length > 0) {
      const overwriteOptions = {
        type: 'warning',
        buttons: ['覆盖', '取消'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: '确认覆盖课表',
        message: '目标文件夹中已有 ' + conflicts.length + ' 个同名文件',
        detail:
          '继续保存将覆盖这些文件：\n' +
          conflicts.slice(0, 6).join('\n') +
          (conflicts.length > 6 ? '\n…' : ''),
      };
      const answer = window
        ? await dialog.showMessageBox(window, overwriteOptions)
        : await dialog.showMessageBox(overwriteOptions);
      if (answer.response !== 0) return { status: 'canceled' };
    }
    let written = 0;
    for (const file of targets) {
      await fs.promises.writeFile(path.join(folder, file.filename), file.buffer);
      written += 1;
    }
    return { status: 'saved', path: folder, files: written, folderName };
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
    icon: appIcon,
    // The app draws its own command rail; the native menu bar only adds a
    // second, redundant toolbar on Windows.
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  window.setMenuBarVisibility(false);
  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // Load from the local HTTP server, not file://. ES module scripts are
    // blocked under file:// in Chromium, which produced a blank packaged app.
    window.loadURL('http://127.0.0.1:4317/');
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
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