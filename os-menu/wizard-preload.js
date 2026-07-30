const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wizardAPI', {
  platform: process.platform,
  getUsage: () => ipcRenderer.invoke('get-usage'),
  refresh: () => ipcRenderer.invoke('refresh'),
  onUsageUpdate: (cb) => ipcRenderer.on('usage-update', (_, data) => cb(data)),
  getLoginItem: () => ipcRenderer.invoke('wizard-get-login-item'),
  setLoginItem: (enabled) => ipcRenderer.invoke('wizard-set-login-item', enabled),
  finish: () => ipcRenderer.invoke('wizard-finish'),
});
