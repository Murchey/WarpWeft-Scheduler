const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('warpweft', {
  platform: process.platform,
  saveExport: (filename, data) => ipcRenderer.invoke('warpweft:save-export', { filename, data }),
  saveExports: (folderName, files) => ipcRenderer.invoke('warpweft:save-exports', { folderName, files }),
  showItemInFolder: (target) => ipcRenderer.invoke('warpweft:show-item', target),
  getWorkspace: () => ipcRenderer.invoke('warpweft:get-workspace'),
  chooseWorkspace: () => ipcRenderer.invoke('warpweft:choose-workspace'),
  // 自绘标题栏所需的窗口控制
  minimize: () => ipcRenderer.invoke('warpweft:window-minimize'),
  toggleMaximize: () => ipcRenderer.invoke('warpweft:window-toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('warpweft:window-close'),
  setTheme: (theme) => ipcRenderer.invoke('warpweft:set-theme', theme),
  setLocale: (locale) => ipcRenderer.invoke('warpweft:set-locale', locale),
  onWindowState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('warpweft:window-state', handler);
    return () => ipcRenderer.removeListener('warpweft:window-state', handler);
  },
});
