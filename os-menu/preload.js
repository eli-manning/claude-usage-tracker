const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeAPI', {
  getUsage: () => ipcRenderer.invoke('get-usage'),
  refresh: () => ipcRenderer.invoke('refresh'),
  closePopup: () => ipcRenderer.invoke('close-popup'),
  onUsageUpdate: (cb) => ipcRenderer.on('usage-update', (_, data) => cb(data)),
});
