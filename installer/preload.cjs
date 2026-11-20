/** 安装器桥：只暴露"查状态 / 装 / 卸 / 进度订阅"，不开放任意能力。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inst', {
  action: (name) => ipcRenderer.send('inst:action', String(name)),
  probe: () => ipcRenderer.invoke('inst:probe'),
  install: (opts) => ipcRenderer.invoke('inst:install', opts ?? {}),
  uninstall: (opts) => ipcRenderer.invoke('inst:uninstall', opts ?? {}),
  onProgress: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('inst:progress', h);
    return () => ipcRenderer.removeListener('inst:progress', h);
  },
  onDone: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('inst:done', h);
    return () => ipcRenderer.removeListener('inst:done', h);
  },
  onError: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('inst:error', h);
    return () => ipcRenderer.removeListener('inst:error', h);
  },
});
