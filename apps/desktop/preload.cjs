const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('warpweft', {
  saveExport: (filename, data) => ipcRenderer.invoke('warpweft:save-export', { filename, data }),
  showItemInFolder: (target) => ipcRenderer.invoke('warpweft:show-item', target),
  getWorkspace: () => ipcRenderer.invoke('warpweft:get-workspace'),
  chooseWorkspace: () => ipcRenderer.invoke('warpweft:choose-workspace'),
});

