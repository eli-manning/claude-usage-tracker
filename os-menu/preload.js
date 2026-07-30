const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeAPI', {
  getUsage: () => ipcRenderer.invoke('get-usage'),
  refresh: () => ipcRenderer.invoke('refresh'),
  closePopup: () => ipcRenderer.invoke('close-popup'),
  setWindowSize: (width, height) => ipcRenderer.invoke('set-window-size', width, height),
  onUsageUpdate: (cb) => ipcRenderer.on('usage-update', (_, data) => cb(data)),
});
