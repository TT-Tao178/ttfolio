/**
 * ttFolio 桌面版主进程。
 *
 * 架构决策（见 PROGRESS 第十九/二十轮与 DECISIONS）：
 *  - 服务端（Fastify + SQLite）以 esbuild 打成单文件 main.cjs，**进程内 require** 启动，
 *    不 spawn 子进程：打包版用户机器上不需要系统 Node，也少一个"安装版应用 spawn 子进程"
 *    的 EDR 敏感面。服务端只监听 127.0.0.1，端口运行时探测空闲，避免与 dev 的 7717 冲突。
 *  - 系统对话框走"桥"：主进程起一个仅 127.0.0.1 + 随机 token 的 HTTP 桥，
 *    服务端 /api/dialogs/* 检测到 TTFOLIO_DIALOG_BRIDGE_* 环境变量就把弹窗请求转发过来，
 *    用 Electron 原生 dialog.showOpenDialog 弹出（替代 PowerShell + WinForms 的误报高危组合）。
 *  - 数据目录仍是 %APPDATA%\ttFolio（安装/卸载、升级、Web 模式三态共用同一份数据）。
 */
const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeTheme,
  nativeImage,
  screen,
} = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const path = require('node:path');

// TTFOLIO_DATA_DIR 隔离数据目录时（自检冒烟 / 多数据目录测试），userData 也跟着隔离——
// 单实例锁按 userData 区分，否则冒烟实例会被用户正在使用的安装版持锁挡掉（启动即退出，
// verify-dist-electron 因此误报「启动冒烟失败」）。
if (process.env['TTFOLIO_DATA_DIR'] !== undefined && process.env['TTFOLIO_DATA_DIR'] !== '') {
  app.setPath('userData', path.join(process.env['TTFOLIO_DATA_DIR'], 'electron-userData'));
}

/**
 * 「以管理员身份重启」的第二次启动标记（管理员窗口接管，T-131 补充）。
 * 带这个参数启动时跳过单实例锁：旧实例要等它起来后立刻退出，若先锁上会把它挡死
 * （表现为点了按钮、UAC 过了、窗口什么都没变）。双实例并存窗口只有几百毫秒，
 * 且旧实例此时已进入退出流程、不再写库。
 */
const ELEVATED_RETRY = process.argv.includes('--ttfolio-embed-retry');

if (!ELEVATED_RETRY && !app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;

// 主题跟随（第 34 轮）：渲染层在主题设置变化/首帧时经 preload 桥上报，主进程切
// nativeTheme.themeSource——Windows 原生标题栏颜色随 shouldUseDarkColors 走，
// 深色主题下标题栏不再恒白。oled 属深色系按 dark 处理；未知值回 system（跟随操作系统），
// 防渲染层异常值把标题栏钉死。浏览器/Web 模式无此桥，纯网页不受影响。
ipcMain.on('tt:theme-changed', (_event, mode) => {
  const map = {
    light: 'light',
    dark: 'dark',
    oled: 'dark',
    cyberpunk: 'dark',
    sketch: 'light',
    glass: 'light',
  };
  nativeTheme.themeSource = map[mode] ?? 'system';
});

/**
 * 窗口寄宿（T-131 / FR-14.3 T1）：koffi 绑定 user32/ole32，全部同步调用跑在主线程。
 * koffi 加载失败（缺原生库/非 Windows）只让寄宿面板如实不可用，绝不影响启动——
 * 与 node-pty 同一姿势。mirror 直播（T-102）原样保留，是全部失败路径的降级终点。
 */
let embedHost = null;
let embedHostError = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  embedHost = require('./embed-host.cjs');
} catch (err) {
  embedHostError = err && err.message ? err.message : String(err);
}

/** 渲染层最近一次上报的面板 DIP 矩形（相对页面视口）；窗口移动/缩放/跨屏时用它重算。 */
let embedRectDip = null;

/**
 * 面板 DIP 矩形（相对页面视口）→ **屏幕物理像素**矩形。
 * 为什么要经过 screen.dipToScreenRect：手乘 devicePixelRatio 在跨屏/异缩放时不可靠；
 * 这里先补上客户区原点（getContentBounds 是屏幕 DIP）再整块换算。
 * 注意：容器是「归属于窗口的顶层弹出窗口」（见 embed-host.cjs 头部说明），定位用屏幕坐标，
 * 不是客户区坐标——这也是 route C 与设计 §1 子窗口方案在换算上的唯一差别。
 */
function embedRectToPx(rect) {
  if (win === null || win.isDestroyed()) return null;
  try {
    const cb = win.getContentBounds();
    const phys = screen.dipToScreenRect(win, {
      x: cb.x + rect.x,
      y: cb.y + rect.y,
      width: rect.width,
      height: rect.height,
    });
    return { x: phys.x, y: phys.y, width: phys.width, height: phys.height };
  } catch {
    return null;
  }
}

function sanitizeDipRect(rect) {
  if (rect === null || typeof rect !== 'object') return null;
  const x = Math.round(Number(rect.x));
  const y = Math.round(Number(rect.y));
  const width = Math.round(Number(rect.width));
  const height = Math.round(Number(rect.height));
  if (![x, y, width, height].every((v) => Number.isFinite(v))) return null;
  if (width < 40 || height < 40 || width > 20000 || height > 20000) return null;
  return { x, y, width, height };
}

/** 窗口移动/缩放/最大化/跨屏 DPI 变化时，按最近一次上报的 DIP 矩形重算容器位置。 */
function syncEmbedRect() {
  if (embedHost === null || !embedHost.isAttached() || embedRectDip === null) return;
  const px = embedRectToPx(embedRectDip);
  if (px !== null) embedHost.resize(px);
}

/** 退出/关窗口时的还原：与 before-quit 共用，幂等（两条路径都会触发）。 */
function detachAllEmbeds() {
  if (embedHost === null) return;
  try {
    embedHost.detachAll();
  } catch (err) {
    process.stdout.write(
      `[ttfolio-electron] embed detach failed: ${err && err.message ? err.message : err}\n`,
    );
  }
}

/**
 * 抓一帧窗口缩略图给渲染层当 poster（浮层遮挡期间顶住画面）。
 * 时序很关键：必须**在 attach 之前**抓——窗口一旦被重挂成别人的子窗口，EnumWindows 就
 * 枚举不到它了，desktopCapturer 只会返回 null（真机探针实测）。所以这里由渲染层在 attach
 * 前主动调一次，抓到的静帧随状态存在渲染层；attach 之后再抓必然失败。
 */
async function captureWindowFrame(sourceId, rect) {
  try {
    const width = Math.max(160, Math.min(1600, Math.round(Number(rect?.width) || 640)));
    const height = Math.max(90, Math.min(1200, Math.round(Number(rect?.height) || 360)));
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width, height },
      fetchWindowIcons: false,
    });
    const hit = sources.find((s) => s.id === sourceId);
    if (hit === undefined || hit.thumbnail.isEmpty()) return null;
    return hit.thumbnail.toDataURL();
  } catch {
    return null;
  }
}

if (embedHost !== null) {
  embedHost.init({
    onEvent: (payload) => {
      if (win !== null && !win.isDestroyed()) win.webContents.send('tt:embed-host-changed', payload);
    },
    // 以下三项都延迟取值：调用发生在运行期，此时 app/screen/win 一定就绪
    getWorkAreas: () => screen.getAllDisplays().map((d) => d.workArea),
    isHostMinimized: () => win !== null && !win.isDestroyed() && win.isMinimized(),
  });
}

/**
 * 缩略图原生解码（FR-13.5 / T-113）：渲染层给出项目内文件的绝对路径与目标最长边，
 * 主进程用 Electron 内置 nativeImage 解码并缩放（不新增原生依赖），返回 dataURL；
 * 渲染层再统一编码 WebP 交服务端落盘。任何异常一律 null（诚实回退渲染层解码）。
 * 约束：绝对路径、图片扩展名白名单、常规文件且 ≤80MB、最长边 64~4096。
 */
const THUMB_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg']);
ipcMain.handle('tt:thumb-decode', async (_event, absPath, maxPx) => {
  try {
    if (typeof absPath !== 'string' || absPath.includes('\u0000') || !path.isAbsolute(absPath)) {
      return null;
    }
    if (!THUMB_IMAGE_EXT.has(path.extname(absPath).toLowerCase())) return null;
    const pxRaw = Number(maxPx);
    const px = Number.isFinite(pxRaw) ? Math.max(64, Math.min(4096, Math.round(pxRaw))) : 640;
    const st = fs.statSync(absPath);
    if (!st.isFile() || st.size === 0 || st.size > 80 * 1024 * 1024) return null;
    const img = nativeImage.createFromPath(absPath);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const longest = Math.max(size.width, size.height);
    const scale = longest > px ? px / longest : 1;
    const resized =
      scale < 1
        ? img.resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale)),
            quality: 'good',
          })
        : img;
    // 网格档用 PNG 保清晰；大图档用 JPEG(88) 控制 IPC 体积（最终都会转 WebP）
    return px <= 800
      ? `data:image/png;base64,${resized.toPNG().toString('base64')}`
      : `data:image/jpeg;base64,${resized.toJPEG(88).toString('base64')}`;
  } catch {
    return null;
  }
});

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** 对话框桥：只收本机 + 带 token 的 POST，弹原生目录/文件多选框。 */
function startDialogBridge(token) {
  const server = http.createServer((req, res) => {
    if (req.headers['x-ttfolio-bridge'] !== token) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const kind = parsed.kind === 'file' ? 'file' : 'folder';
        const r = await dialog.showOpenDialog(win, {
          title: kind === 'file' ? '选择文件（可多选）' : '选择文件夹',
          properties: kind === 'file' ? ['openFile', 'multiSelections'] : ['openDirectory'],
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ paths: r.canceled ? [] : r.filePaths }));
      } catch {
        res.writeHead(500);
        res.end();
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: typeof address === 'object' && address !== null ? address.port : 0 });
    });
  });
}

async function fetchHealth(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`);
    return r.ok;
  } catch {
    return false;
  }
}

async function boot() {
  process.stdout.write('[ttfolio-electron] booting\n');
  // 允许外部固定端口（冒烟测试/企业策略），否则运行时探测空闲端口，避免与 dev 的 7717 冲突
  const envPort = Number(process.env['TTFOLIO_PORT']);
  const appPort = Number.isFinite(envPort) && envPort > 0 ? envPort : await getFreePort();
  const bridgeToken = crypto.randomBytes(16).toString('hex');
  const bridge = await startDialogBridge(bridgeToken);
  process.env['TTFOLIO_PORT'] = String(appPort);
  process.env['TTFOLIO_MIGRATIONS_DIR'] = path.join(
    __dirname,
    '..',
    'packages',
    'server',
    'src',
    'migrations',
  );
  process.env['TTFOLIO_WEB_DIST'] = path.join(__dirname, '..', 'packages', 'web', 'dist');
  process.env['TTFOLIO_DIALOG_BRIDGE_URL'] = `http://127.0.0.1:${bridge.port}/dialog`;
  process.env['TTFOLIO_DIALOG_BRIDGE_TOKEN'] = bridgeToken;

  // 进程内启动服务端（esbuild 产物；better-sqlite3 为 external，随安装包 native 目录分发）
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(path.join(__dirname, '..', 'app', 'server', 'main.cjs'));
    process.stdout.write('[ttfolio-electron] server bundle required\n');
  } catch (err) {
    process.stdout.write(`[ttfolio-electron] server require FAILED: ${err && err.stack ? err.stack : err}\n`);
    throw err;
  }

  const deadline = Date.now() + 30000;
  let healthy = false;
  while (Date.now() < deadline && !healthy) {
    healthy = await fetchHealth(appPort);
    // 120ms 粒度：服务通常 1~2s 就绪，轮询粒度直接决定窗口出现延迟（此前 400ms 平均多等 200ms）
    if (!healthy) await new Promise((r) => setTimeout(r, 120));
  }

  const state = loadWindowState({ width: 1440, height: 900 });
  win = new BrowserWindow(withRememberedBounds(state));
  if (state.maximized === true) win.maximize();
  // 白屏治理（用户反馈）：窗口 show:false，首帧就绪（ready-to-show）才显示——
  // 此前窗口默认立即显示、内容要等 loadURL + 首屏 bundle 解析，中间全白。
  // 8 秒兜底：加载异常时窗口也得出来（宁可白屏不可无窗），并如实打日志。
  win.once('ready-to-show', () => {
    if (win !== null && !win.isDestroyed() && !win.isVisible()) win.show();
  });
  setTimeout(() => {
    if (win !== null && !win.isDestroyed() && !win.isVisible()) {
      process.stdout.write('[ttfolio-electron] ready-to-show timeout, force show\n');
      win.show();
    }
  }, 8000);
  // 'close'（而非 'closed'）时保存——此时 win 引用仍在，getNormalBounds 可读。
  // 寄宿还原必须挂在这里（设计 P0-3）：等到 before-quit 时 BrowserWindow 的 HWND 已销毁，
  // 子窗口会被一起带走，正好命中"退出把用户窗口带走"这个最怕的情况。
  win.on('close', () => {
    if (win !== null) rememberWindowBounds(win);
    detachAllEmbeds();
  });
  // 渲染进程崩溃兜底（第 33 轮 M9）：reason/exitCode 落 userData/renderer-crash.log，
  // 静默不弹窗（诊断走日志）；载入前挂上，崩溃后不自动重载（避免错误循环）
  win.webContents.on('render-process-gone', (_event, details) => {
    try {
      const line = `${new Date().toISOString()} reason=${details.reason} exitCode=${details.exitCode}
`;
      require('node:fs').appendFileSync(path.join(app.getPath('userData'), 'renderer-crash.log'), line);
    } catch {
      /* 落盘失败不抛 */
    }
  });
  win.on('closed', () => {
    win = null;
  });
  // 寄宿窗口的矩形必须跟着宿主走：窗口拖动/缩放/最大化/全屏/跨屏 DPI 变化时 ResizeObserver 不 fire，
  // 只有这里能兜住。最小化/还原时重新推导可见性（推导函数在 embed-host 里，绝不在外面散写 ShowWindow）。
  for (const ev of [
    'resize',
    'move',
    'maximize',
    'unmaximize',
    'restore',
    'enter-full-screen',
    'leave-full-screen',
  ]) {
    win.on(ev, syncEmbedRect);
  }
  win.on('minimize', () => {
    if (embedHost !== null) embedHost.refresh();
  });
  win.on('restore', () => {
    if (embedHost !== null) embedHost.refresh();
    syncEmbedRect();
  });
  screen.on('display-metrics-changed', () => {
    syncEmbedRect();
    if (embedHost !== null) embedHost.refresh();
  });
  process.stdout.write(`[ttfolio-electron] server ready on 127.0.0.1:${appPort}, loading window\n`);
  await win.loadURL(`http://127.0.0.1:${appPort}/`);
  // 提权重启回来的那次：自动把嵌入面板打开，让用户接着接管（不用再自己找按钮）。
  // 渲染层订阅是 React 挂载后才建好的，单次发送容易丢——加载完成时发一次、2 秒后再补一次
  // （重复打开面板是幂等的）。
  if (ELEVATED_RETRY) {
    const ping = () => {
      if (win !== null && !win.isDestroyed()) win.webContents.send('tt:embed-retry');
    };
    win.webContents.once('did-finish-load', ping);
    setTimeout(ping, 2000);
  }
}

// ---- 窗口状态记忆（第 33 轮 M8）：尺寸/位置/最大化存 userData/window-state.json
// （userData 已随 TTFOLIO_DATA_DIR 隔离，main.cjs 顶部）。恢复前做上屏校验：
// bounds 必须与任一显示器工作区有交集，否则回落默认并居中——防外接屏拔除后
// 窗口恢复到不存在的坐标（经典坑）。----

function windowStateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

const WINDOW_MIN = { width: 960, height: 600 };

function loadWindowState(fallback) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require('node:fs').readFileSync(windowStateFile(), 'utf8');
    const s = JSON.parse(raw);
    if (typeof s !== 'object' || s === null || typeof s.width !== 'number' || typeof s.height !== 'number') {
      return { ...fallback };
    }
    const width = Math.max(WINDOW_MIN.width, Math.floor(s.width));
    const height = Math.max(WINDOW_MIN.height, Math.floor(s.height));
    const x = Number.isFinite(s.x) ? Math.floor(s.x) : undefined;
    const y = Number.isFinite(s.y) ? Math.floor(s.y) : undefined;
    // 上屏校验：无坐标或坐标不在任何显示器工作区内 → 居中
    const { screen } = require('electron');
    const onScreen =
      x === undefined ||
      y === undefined ||
      screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return x < a.x + a.width && x + width > a.x && y < a.y + a.height && y + height > a.y;
      });
    if (!onScreen) return { ...fallback, center: true };
    return { width, height, x, y, maximized: s.maximized === true };
  } catch {
    return { ...fallback };
  }
}

function withRememberedBounds(state) {
  const opts = {
    width: state.width,
    height: state.height,
    autoHideMenuBar: true,
    // 白屏治理：初始隐藏，ready-to-show（首帧就绪）再显示（boot 里有 8s 兜底）
    show: false,
    title: 'TT项目管理工作台',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  };
  if (state.x !== undefined && state.y !== undefined) {
    opts.x = state.x;
    opts.y = state.y;
  } else {
    opts.center = true;
  }
  return opts;
}

function rememberWindowBounds(win) {
  try {
    // 最大化时存还原后的尺寸（getNormalBounds），下次先还原尺寸再最大化
    const b = win.getNormalBounds();
    const payload = { width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() };
    require('node:fs').writeFileSync(windowStateFile(), JSON.stringify(payload));
  } catch {
    /* 状态保存失败不阻断退出 */
  }
}

/**
 * 集成终端（FR-14.2 / T-104）：node-pty 伪终端跑在主进程，渲染层只经 preload 桥
 * 收发数据（contextIsolation + sandbox 不变）。约束：
 *  - 只允许白名单 shell（pwsh / Windows PowerShell / cmd），cwd 必须是存在的绝对目录；
 *  - 不自动执行任何命令；输入不落日志；终端进程不跨重启存活（重启后如实为空）；
 *  - node-pty 加载失败（缺原生模块）只让面板显示「不可用」，绝不影响应用启动。
 */
let nodePty = null;
let nodePtyError = null;
try {
  nodePty = require('node-pty');
} catch (err) {
  nodePtyError = err && err.message ? err.message : String(err);
}

const terminals = new Map(); // id -> { pty, ownerId }

function detectShells() {
  const list = [];
  try {
    const { execFileSync } = require('node:child_process');
    execFileSync('where', ['pwsh'], { windowsHide: true, stdio: 'ignore' });
    list.push({ id: 'pwsh', label: 'PowerShell 7 (pwsh)' });
  } catch {
    /* 未安装 pwsh */
  }
  const sysRoot = process.env['SystemRoot'] || 'C:\\Windows';
  const psPath = path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (fs.existsSync(psPath)) list.push({ id: 'powershell', label: 'Windows PowerShell' });
  list.push({ id: 'cmd', label: '命令提示符 (cmd)' });
  return list;
}

function shellPathOf(id) {
  if (id === 'pwsh') return 'pwsh';
  if (id === 'powershell') {
    const sysRoot = process.env['SystemRoot'] || 'C:\\Windows';
    return path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  }
  return process.env['ComSpec'] || 'cmd.exe';
}

ipcMain.handle('tt:term-shells', async () => ({
  available: nodePty !== null,
  error: nodePtyError,
  shells: detectShells(),
  home: require('node:os').homedir(),
  defaultShell: detectShells().some((s) => s.id === 'pwsh') ? 'pwsh' : 'powershell',
}));

ipcMain.handle('tt:term-create', async (event, opts) => {
  if (nodePty === null) return { ok: false, error: nodePtyError ?? 'node-pty 不可用' };
  const shellId = opts && typeof opts.shell === 'string' ? opts.shell : 'powershell';
  const allowed = new Set(['pwsh', 'powershell', 'cmd']);
  if (!allowed.has(shellId)) return { ok: false, error: '不支持的 shell' };
  const cwd = opts && typeof opts.cwd === 'string' ? opts.cwd : '';
  if (cwd === '' || !path.isAbsolute(cwd) || !fs.existsSync(cwd)) {
    return { ok: false, error: '起始目录不存在' };
  }
  try {
    const id = crypto.randomUUID();
    const file = shellPathOf(shellId);
    const args = shellId === 'cmd' ? [] : ['-NoLogo'];
    const ptyProc = nodePty.spawn(file, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      useConpty: true,
    });
    const ownerId = event.sender.id;
    terminals.set(id, { pty: ptyProc, ownerId });
    ptyProc.onData((data) => {
      if (!event.sender.isDestroyed()) event.sender.send('tt:term-data', id, data);
    });
    ptyProc.onExit(({ exitCode }) => {
      terminals.delete(id);
      if (!event.sender.isDestroyed()) event.sender.send('tt:term-exit', id, exitCode);
    });
    return { ok: true, id, shell: shellId, title: shellId === 'cmd' ? 'cmd' : 'PowerShell' };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.on('tt:term-write', (event, id, data) => {
  const t = terminals.get(String(id));
  if (t === undefined || t.ownerId !== event.sender.id) return;
  if (typeof data !== 'string' || data.length > 100_000) return;
  try {
    t.pty.write(data);
  } catch {
    /* 进程已退出 */
  }
});

ipcMain.on('tt:term-resize', (event, id, cols, rows) => {
  const t = terminals.get(String(id));
  if (t === undefined || t.ownerId !== event.sender.id) return;
  const c = Math.max(2, Math.min(500, Math.round(Number(cols) || 80)));
  const r = Math.max(1, Math.min(300, Math.round(Number(rows) || 24)));
  try {
    t.pty.resize(c, r);
  } catch {
    /* 忽略 */
  }
});

ipcMain.on('tt:term-kill', (event, id) => {
  const t = terminals.get(String(id));
  if (t === undefined || t.ownerId !== event.sender.id) return;
  try {
    t.pty.kill();
  } catch {
    /* 已退出 */
  }
  terminals.delete(String(id));
});

function killAllTerminals() {
  for (const { pty: p } of terminals.values()) {
    try {
      p.kill();
    } catch {
      /* 忽略 */
    }
  }
  terminals.clear();
}

// before-quit 只作兜底（真正可靠的还原点是 win.on('close')，见设计 P0-3）：
// 两条路径都会触发，所以 detachAllEmbeds 与 killAllTerminals 都必须幂等。
app.on('before-quit', () => {
  killAllTerminals();
  detachAllEmbeds();
});

/**
 * 窗口嵌入（FR-14.3 / T-102，T0 只读监控）：枚举可见顶层窗口供选择器使用，
 * 返回小尺寸缩略图帮助辨认。捕获在渲染层经 getUserMedia（桌面源）进行——
 * 只读展示，不注入输入、不落盘；T1 交互嵌入（SetParent）本版不提供。
 */
ipcMain.handle('tt:embed-windows', async () => {
  try {
    const { desktopCapturer } = require('electron');
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 160, height: 90 },
      fetchWindowIcons: false,
    });
    const ownTitle = win && !win.isDestroyed() ? win.getTitle() : '';
    return {
      ok: true,
      error: null,
      windows: sources
        // 排除自身窗口（嵌入自己会形成无限镜像）
        .filter((s) => s.name !== ownTitle && s.name !== 'TT项目管理工作台')
        .map((s) => ({
          id: s.id,
          name: s.name || '（无标题窗口）',
          thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '',
        })),
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err), windows: [] };
  }
});

/**
 * 窗口寄宿（T-131 / FR-14.3 T1）：把选中的窗口真嵌进面板，可操作。
 * 与上面的只读监控并列（决策 4）：mirror 不删，是 attach 失败/失效的统一降级终点。
 * 状态零持久化（决策 3）：重启后回到监控模式，不记忆上次寄宿的窗口。
 */
function embedUnavailable() {
  return {
    ok: false,
    code: 'unavailable',
    error: `窗口寄宿组件不可用：${embedHostError ?? '未知原因'}`,
  };
}

ipcMain.handle('tt:embed-host-attach', async (_event, sourceId, rect) => {
  if (embedHost === null) return embedUnavailable();
  if (win === null || win.isDestroyed()) return { ok: false, code: 'host', error: '宿主窗口不可用' };
  const dip = sanitizeDipRect(rect);
  if (dip === null) return { ok: false, code: 'rect', error: '面板尺寸无效（可能尚未布局）' };
  const px = embedRectToPx(dip);
  if (px === null) return { ok: false, code: 'rect', error: '无法换算面板坐标' };
  try {
    const handle = win.getNativeWindowHandle().readBigUInt64LE(0);
    embedRectDip = dip;
    const r = embedHost.attach(Number(handle), String(sourceId), px);
    if (r.ok !== true) embedRectDip = null;
    return r;
  } catch (err) {
    embedRectDip = null;
    return { ok: false, code: 'exception', error: err && err.message ? err.message : String(err) };
  }
});

// poster 静帧：渲染层在 attach 之前调（此时目标还是顶层窗口，抓得到；attach 之后就抓不到了）
ipcMain.handle('tt:embed-host-snapshot', async (_event, sourceId, rect) => {
  const dip = sanitizeDipRect(rect);
  if (dip === null) return { ok: false, dataUrl: null };
  const dataUrl = await captureWindowFrame(String(sourceId), dip);
  return { ok: dataUrl !== null, dataUrl };
});

/**
 * 以管理员身份重启（默认不启用，只在「管理员窗口接管失败」时由用户显式点按钮触发）。
 * 走 ShellExecuteExW(runas)：UAC 弹一次；用户点了"否"就原样返回、什么都不做。
 * 成功拉起新实例后本实例退出（新实例带 --ttfolio-embed-retry，会跳过单实例锁并自动开面板）。
 */
ipcMain.handle('tt:embed-relaunch-admin', async () => {
  if (embedHost === null) return { ok: false, error: '窗口寄宿组件不可用' };
  if (embedHost.isSelfElevated() === true) return { ok: false, error: 'ttFolio 已经是管理员权限' };
  const params = process.defaultApp ? `"${app.getAppPath()}" --ttfolio-embed-retry` : '--ttfolio-embed-retry';
  const r = embedHost.relaunchElevated(params);
  if (r.ok === true) {
    // 给 UAC/新进程一点启动时间再退出，避免新实例还没拿到锁就被旧的挡住
    setTimeout(() => app.quit(), 400);
  }
  return r;
});

ipcMain.handle('tt:embed-host-detach', async () => {
  embedRectDip = null;
  if (embedHost === null) return { ok: true, detached: false };
  try {
    return embedHost.detach();
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.on('tt:embed-host-resize', (_event, rect) => {
  if (embedHost === null) return;
  const dip = sanitizeDipRect(rect);
  if (dip === null) return;
  embedRectDip = dip;
  const px = embedRectToPx(dip);
  if (px !== null) embedHost.resize(px);
});

ipcMain.on('tt:embed-host-set-visible', (_event, visible) => {
  if (embedHost === null) return;
  embedHost.setVisible(visible === true);
});

app.on('second-instance', () => {
  if (win !== null) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app
  .whenReady()
  .then(boot)
  .catch((err) => {
    dialog.showErrorBox('TT项目管理工作台启动失败', String(err && err.stack ? err.stack : err));
    app.quit();
  });
app.on('window-all-closed', () => app.quit());
