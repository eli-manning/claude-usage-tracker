const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeAPI', {
  getUsage: () => ipcRenderer.invoke('get-usage'),
  refresh: () => ipcRenderer.invoke('refresh'),
  closePopup: () => ipcRenderer.invoke('close-popup'),
  setWindowWidth: (width) => ipcRenderer.invoke('set-window-width', width),
  onUsageUpdate: (cb) => ipcRenderer.on('usage-update', (_, data) => cb(data)),
});
