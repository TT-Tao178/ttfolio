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
   * T-131 起并列一条「寄宿」链路：host.attach 把选中窗口真嵌进面板（可操作），
   * 失败由调用方如实降级回监控模式。寄宿状态零持久化。
   */
  embed: {
    windows: () => ipcRenderer.invoke('tt:embed-windows'),
    host: {
      /** rect 为面板矩形（CSS px，相对页面视口），主进程负责 DIP→物理换算 */
      attach: (sourceId, rect) => ipcRenderer.invoke('tt:embed-host-attach', String(sourceId), rect),
      /** poster 静帧：必须在 attach 之前取（窗口被重挂后枚举不到） */
      snapshot: (sourceId, rect) => ipcRenderer.invoke('tt:embed-host-snapshot', String(sourceId), rect),
      detach: () => ipcRenderer.invoke('tt:embed-host-detach'),
      resize: (rect) => ipcRenderer.send('tt:embed-host-resize', rect),
      setVisible: (visible) => ipcRenderer.send('tt:embed-host-set-visible', visible === true),
      onEvent: (cb) => {
        const h = (_e, payload) => cb(payload);
        ipcRenderer.on('tt:embed-host-changed', h);
        return () => ipcRenderer.removeListener('tt:embed-host-changed', h);
      },
      /**
       * 以管理员身份重启（管理员窗口接管失败后的显式入口）。会弹 UAC；用户拒绝则原样返回。
       * 默认不会被调用——只有用户自己点了那个按钮才会走到这里。
       */
      relaunchAsAdmin: () => ipcRenderer.invoke('tt:embed-relaunch-admin'),
      /** 提权重启回来时主进程会喊一声，渲染层据此打开嵌入面板 */
      onRetryRequest: (cb) => {
        const h = () => cb();
        ipcRenderer.on('tt:embed-retry', h);
        return () => ipcRenderer.removeListener('tt:embed-retry', h);
      },
    },
  },
});
