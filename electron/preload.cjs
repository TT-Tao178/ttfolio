/**
 * 渲染层 → 主进程的最小桥（contextIsolation + sandbox 均开启，只暴露这一个无返回值的方法）。
 * 目前只有一件事：主题设置变化时上报，主进程据此切 nativeTheme.themeSource，
 * 让 Windows 原生窗口标题栏跟随应用深浅色（原生标题栏默认恒白、不随页面变，历史报障）。
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('ttfolioNative', {
  /** mode 取值：light | dark | oled | system；主进程按白名单映射，未知值回 system。 */
  setTheme: (mode) => {
    ipcRenderer.send('tt:theme-changed', String(mode));
  },
  /**
   * 拖拽登记（FR-2.2 决策修订 / T-118）：把 DataTransfer 里的 File 对象换成绝对路径。
   * 仅桌面版可用（Web 沙箱拿不到路径）；失败返回空串由调用方过滤。
   */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  /**
   * 缩略图原生解码（FR-13.5 / T-113）：绝对路径 + 目标最长边 → dataURL | null。
   * 主进程校验扩展名/大小并缩放；失败返回 null，渲染层自行解码兜底。
   */
  thumbDecode: (absPath, maxPx) => ipcRenderer.invoke('tt:thumb-decode', String(absPath), Number(maxPx)),
  /**
   * 集成终端（FR-14.2 / T-104）：伪终端跑在主进程，这里只做受控收发。
   * 只暴露 create/write/resize/kill 与两个订阅；不暴露任意进程执行能力。
   */
  terminal: {
    shells: () => ipcRenderer.invoke('tt:term-shells'),
    create: (opts) => ipcRenderer.invoke('tt:term-create', opts),
    write: (id, data) => ipcRenderer.send('tt:term-write', String(id), String(data)),
    resize: (id, cols, rows) => ipcRenderer.send('tt:term-resize', String(id), Number(cols), Number(rows)),
    kill: (id) => ipcRenderer.send('tt:term-kill', String(id)),
    onData: (cb) => {
      const h = (_e, id, data) => cb(String(id), String(data));
      ipcRenderer.on('tt:term-data', h);
      return () => ipcRenderer.removeListener('tt:term-data', h);
    },
    onExit: (cb) => {
      const h = (_e, id, code) => cb(String(id), Number(code));
      ipcRenderer.on('tt:term-exit', h);
      return () => ipcRenderer.removeListener('tt:term-exit', h);
    },
  },
  /**
   * 窗口嵌入（FR-14.3 / T-102，T0 只读）：只提供窗口枚举；实际画面由渲染层
   * 经 getUserMedia 桌面源读取并直接展示（不落盘、不注入输入）。
   */
  embed: {
    windows: () => ipcRenderer.invoke('tt:embed-windows'),
  },
});
