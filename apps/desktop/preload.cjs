const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('warpweft', {
  saveExport: (filename, data) => ipcRenderer.invoke('warpweft:save-export', { filename, data }),
});
