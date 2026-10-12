/**
 * 渲染层 → 主进程的最小桥（contextIsolation + sandbox 均开启，只暴露这一个无返回值的方法）。
 * 目前只有一件事：主题设置变化时上报，主进程据此切 nativeTheme.themeSource，
 * 让 Windows 原生窗口标题栏跟随应用深浅色（原生标题栏默认恒白、不随页面变，历史报障）。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ttfolioNative', {
  /** mode 取值：light | dark | oled | system；主进程按白名单映射，未知值回 system。 */
  setTheme: (mode) => {
    ipcRenderer.send('tt:theme-changed', String(mode));
  },
});
