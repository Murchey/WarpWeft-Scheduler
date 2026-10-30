const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { startApi } = require('../../server/api/api.cjs');

const rootDir = path.resolve(__dirname, '../..');
const appIcon = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(rootDir, 'assets', 'icon.png');

// 主进程侧的少量文案（窗口标题、文件对话框、覆盖确认）。渲染层通过
// warpweft:set-locale 同步语言，保证界面与原生对话框不会语言错位。
const MAIN_MESSAGES = {
  'zh-CN': {
    appTitle: 'WarpWeft 排课',
    chooseWorkspace: '选择工作区存放位置',
    saveExport: '保存导出文件',
    saveExportsFolder: '选择课表保存文件夹',
    confirmOverwrite: '确认覆盖课表',
    overwriteMessage: '目标文件夹中已有 {count} 个同名文件',
    overwriteDetail: '继续保存将覆盖这些文件：',
    btnOverwrite: '覆盖',
    btnCancel: '取消',
    csvFile: 'CSV 文件',
    xlsxFile: 'Excel 工作簿',
    errNotFolder: '所选位置不是文件夹',
    errBadExport: '导出数据格式无效',
    errTooLarge: '导出文件过大',
    errEmpty: '导出内容为空',
    errEmptyNamed: '导出内容为空：{name}',
    errTooLargeNamed: '单个导出文件过大：{name}',
    errNoFiles: '没有可保存的文件',
    errTooMany: '一次最多保存 1000 个文件',
    errUnsupported: '不支持的导出文件类型：{name}',
    errBatchTooLarge: '批量导出文件总大小超过 500 MB',
    errNoPath: '没有文件路径',
    errMissing: '文件不存在：{path}',
  },
  'en-US': {
    appTitle: 'WarpWeft Scheduler',
    chooseWorkspace: 'Choose workspace folder',
    saveExport: 'Save exported file',
    saveExportsFolder: 'Choose timetable folder',
    confirmOverwrite: 'Overwrite timetables?',
    overwriteMessage: '{count} file(s) with the same name already exist',
    overwriteDetail: 'Saving will overwrite these files:',
    btnOverwrite: 'Overwrite',
    btnCancel: 'Cancel',
    csvFile: 'CSV file',
    xlsxFile: 'Excel workbook',
    errNotFolder: 'The selected location is not a folder',
    errBadExport: 'Invalid export data',
    errTooLarge: 'Exported file is too large',
    errEmpty: 'Export content is empty',
    errEmptyNamed: 'Export content is empty: {name}',
    errTooLargeNamed: 'Exported file is too large: {name}',
    errNoFiles: 'No files to save',
    errTooMany: 'At most 1000 files per save',
    errUnsupported: 'Unsupported export file type: {name}',
    errBatchTooLarge: 'Batch export exceeds 500 MB',
    errNoPath: 'No file path',
    errMissing: 'File not found: {path}',
  },
};

let locale = 'zh-CN';

function m(key, vars) {
  const table = MAIN_MESSAGES[locale] || MAIN_MESSAGES['zh-CN'];
  const template = table[key] ?? MAIN_MESSAGES['zh-CN'][key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) => (vars[name] === undefined ? whole : String(vars[name])));
}

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
    title: m('chooseWorkspace'),
    defaultPath: currentDataDir(),
    properties: ['openDirectory', 'createDirectory'],
  };
  const chosen = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  if (chosen.canceled || !chosen.filePaths?.[0]) return { canceled: true };
  const selected = path.resolve(chosen.filePaths[0]);
  try {
    if (!fs.existsSync(selected) || !fs.statSync(selected).isDirectory()) {
      return { status: 'failed', error: m('errNotFolder') };
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
    return { status: 'failed', error: m('errBadExport') };
  }
  if (buffer.length > 50 * 1024 * 1024) return { status: 'failed', error: m('errTooLarge') };
  if (buffer.length === 0) return { status: 'failed', error: m('errEmpty') };

  const extension = path.extname(filename).toLowerCase();
  const filters =
    extension === '.csv'
      ? [{ name: m('csvFile'), extensions: ['csv'] }]
      : extension === '.xlsx'
        ? [{ name: m('xlsxFile'), extensions: ['xlsx'] }]
        : [];
  const options = {
    title: m('saveExport'),
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
  if (files.length === 0) return { status: 'failed', error: m('errNoFiles') };
  if (files.length > 1000) return { status: 'failed', error: m('errTooMany') };

  const pending = [];
  let totalBytes = 0;
  for (const file of files) {
    const filename = safeExportFileName(file?.filename);
    const extension = path.extname(filename).toLowerCase();
    if (extension !== '.xlsx' && extension !== '.csv') {
      return { status: 'failed', error: m('errUnsupported', { name: filename }) };
    }
    const data = file?.data;
    let buffer;
    if (data instanceof ArrayBuffer) {
      buffer = Buffer.from(new Uint8Array(data));
    } else if (ArrayBuffer.isView(data)) {
      buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    } else {
      return { status: 'failed', error: m('errBadExport') + '：' + filename };
    }
    if (buffer.length === 0) return { status: 'failed', error: m('errEmptyNamed', { name: filename }) };
    if (buffer.length > 50 * 1024 * 1024) return { status: 'failed', error: m('errTooLargeNamed', { name: filename }) };
    totalBytes += buffer.length;
    if (totalBytes > 500 * 1024 * 1024) return { status: 'failed', error: m('errBatchTooLarge') };
    pending.push({ filename, buffer });
  }

  const options = {
    title: m('saveExportsFolder'),
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
        buttons: [m('btnOverwrite'), m('btnCancel')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: m('confirmOverwrite'),
        message: m('overwriteMessage', { count: conflicts.length }),
        detail:
          m('overwriteDetail') +
          '\n' +
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
  if (typeof target !== 'string' || !target.trim()) return { ok: false, error: m('errNoPath') };
  try {
    if (!fs.existsSync(target)) return { ok: false, error: m('errMissing', { path: target }) };
    shell.showItemInFolder(target);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// ── 无边框窗口控制 ───────────────────────────────────────────
// Windows/Linux 使用自绘标题栏；macOS 保留原生红绿灯（hiddenInset）。
const USE_NATIVE_FRAME = process.platform === 'darwin';

function windowOf(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

ipcMain.handle('warpweft:window-minimize', (event) => {
  const target = windowOf(event);
  if (target) target.minimize();
});

ipcMain.handle('warpweft:window-toggle-maximize', (event) => {
  const target = windowOf(event);
  if (!target) return { maximized: false };
  if (target.isMaximized()) target.unmaximize();
  else target.maximize();
  return { maximized: target.isMaximized() };
});

ipcMain.handle('warpweft:window-close', (event) => {
  const target = windowOf(event);
  if (target) target.close();
});

ipcMain.handle('warpweft:set-theme', (event, theme) => {
  const target = windowOf(event);
  if (target) target.setBackgroundColor(theme === 'dark' ? '#000000' : '#f5f5f7');
});

ipcMain.handle('warpweft:set-locale', (event, next) => {
  if (next !== 'zh-CN' && next !== 'en-US') return { locale };
  locale = next;
  const target = windowOf(event);
  if (target) target.setTitle(m('appTitle'));
  return { locale };
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 700,
    icon: appIcon,
    // 自绘标题栏：Windows/Linux 去掉原生边框，macOS 交给系统红绿灯。
    frame: USE_NATIVE_FRAME,
    titleBarStyle: USE_NATIVE_FRAME ? 'hiddenInset' : 'hidden',
    // 首帧白闪规避：与浅色主题 --paper 一致，切主题时通过 set-theme 更新。
    backgroundColor: '#f5f5f7',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  window.setTitle(m('appTitle'));
  window.setMenuBarVisibility(false);

  const pushWindowState = () => {
    if (window.isDestroyed()) return;
    window.webContents.send('warpweft:window-state', {
      maximized: window.isMaximized(),
      fullScreen: window.isFullScreen(),
      focused: window.isFocused(),
      platform: process.platform,
    });
  };
  window.once('ready-to-show', () => window.show());
  for (const channel of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur', 'resize']) {
    window.on(channel, pushWindowState);
  }
  window.webContents.on('did-finish-load', pushWindowState);

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
  // 系统语言决定原生对话框语言；渲染层加载后会用 set-locale 覆盖为用户选择。
  locale = app.getLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
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