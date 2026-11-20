const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('inst', {
  action: (name) => ipcRenderer.send('inst:action', String(name)),
});
