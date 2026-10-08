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
const { app, BrowserWindow, dialog } = require('electron');
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;

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
    if (!healthy) await new Promise((r) => setTimeout(r, 400));
  }

  const state = loadWindowState({ width: 1440, height: 900 });
  win = new BrowserWindow(withRememberedBounds(state));
  if (state.maximized === true) win.maximize();
  // 'close'（而非 'closed'）时保存——此时 win 引用仍在，getNormalBounds 可读
  win.on('close', () => {
    if (win !== null) rememberWindowBounds(win);
  });
  win.on('closed', () => {
    win = null;
  });
  process.stdout.write(`[ttfolio-electron] server ready on 127.0.0.1:${appPort}, loading window\n`);
  await win.loadURL(`http://127.0.0.1:${appPort}/`);
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
    if (
      typeof s !== 'object' ||
      s === null ||
      typeof s.width !== 'number' ||
      typeof s.height !== 'number'
    ) {
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
    title: 'TT项目管理工作台',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
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
