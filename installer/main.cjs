/**
 * 自绘安装器（T-154）：窗口 + 真实安装/卸载。
 *
 * 三种运行形态：
 *  ① 开发/调试：`electron installer/main.cjs`，payload 用 TTFOLIO_PAYLOAD 指定；
 *  ② 便携目录：installer.exe 旁边放 payload.zip；
 *  ③ 单文件 SFX：payload.zip 追加在 exe 末尾，尾部 32 字节写 [magic, offset, size, rawSize]。
 *
 * 卸载复用同一个 exe：`--uninstall` 进入卸载界面；`--finish-uninstall` 是自删收尾进程。
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const inst = require('./install.cjs');

app.setAppUserModelId('com.tttao.ttfolio.installer');

/** 安装器日志：portable 启动器会吞掉 stdout/stderr，排障只能落文件。 */
function log(msg) {
  try {
    fs.appendFileSync(path.join(os.tmpdir(), 'ttfolio-installer.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* 日志失败不影响安装 */
  }
}

/** 安装器日志：portable 启动器会吞掉 stdout/stderr，排障只能落文件。 */
function log(msg) {
  try {
    fs.appendFileSync(path.join(os.tmpdir(), 'ttfolio-installer.log'), `${new Date().toISOString()} ${msg}
`);
  } catch {
    /* 日志失败不影响安装 */
  }
}

const ARGV = process.argv.slice(1);
const MODE_UNINSTALL = ARGV.includes('--uninstall');
const FINISH_INDEX = ARGV.indexOf('--finish-uninstall');

let win = null;
let busy = false;

/** SFX 尾部：magic(8) + offset(8) + size(8) + rawSize(8) */
const SFX_MAGIC = 'TTFPAY01';
const SFX_TRAILER = 32;

function readSfxMeta(exePath) {
  try {
    const fd = fs.openSync(exePath, 'r');
    const stat = fs.fstatSync(fd);
    if (stat.size < SFX_TRAILER) {
      fs.closeSync(fd);
      return null;
    }
    const buf = Buffer.alloc(SFX_TRAILER);
    fs.readSync(fd, buf, 0, SFX_TRAILER, stat.size - SFX_TRAILER);
    fs.closeSync(fd);
    if (buf.subarray(0, 8).toString('latin1') !== SFX_MAGIC) return null;
    return {
      offset: Number(buf.readBigUInt64LE(8)),
      size: Number(buf.readBigUInt64LE(16)),
      rawSize: Number(buf.readBigUInt64LE(24)),
    };
  } catch {
    return null;
  }
}

/**
 * 找到 payload（zip）并返回本地路径 + 解压后的预期字节数。
 * 单文件形态下把尾部字节抠出来落到 temp，再交给 tar。
 */
function resolvePayload() {
  const fromEnv = process.env['TTFOLIO_PAYLOAD'];
  if (typeof fromEnv === 'string' && fromEnv !== '' && fs.existsSync(fromEnv)) {
    const metaPath = `${fromEnv}.meta.json`;
    let raw = 0;
    try {
      raw = JSON.parse(fs.readFileSync(metaPath, 'utf8')).rawSize ?? 0;
    } catch {
      /* 没有 meta 就用 0（进度按"未知"处理） */
    }
    return { path: fromEnv, rawSize: raw };
  }

  // electron-builder 打 portable 时：payload 放在 resources 目录（随 exe 一起压缩）
  const inResources = path.join(process.resourcesPath ?? '', 'payload.zip');
  if (fs.existsSync(inResources)) {
    const metaPath = `${inResources}.meta.json`;
    let raw = 0;
    try {
      raw = JSON.parse(fs.readFileSync(metaPath, 'utf8')).rawSize ?? 0;
    } catch {
      /* 无 meta 时进度按未知处理 */
    }
    return { path: inResources, rawSize: raw };
  }

  const beside = path.join(path.dirname(process.execPath), 'payload.zip');
  if (fs.existsSync(beside)) return { path: beside, rawSize: 0 };

  // electron-builder 的 portable 目标会把 app 解到 temp 再运行，execPath 是副本；
  // 原始 exe（带 payload 尾巴的那个）在 PORTABLE_EXECUTABLE_FILE 里。
  const sfxHost = process.env['PORTABLE_EXECUTABLE_FILE'] || process.execPath;
  const meta = readSfxMeta(sfxHost);
  if (meta === null) throw new Error('安装包内未找到 payload（SFX 尾标缺失）');
  const out = path.join(os.tmpdir(), `ttfolio-payload-${Date.now()}.zip`);
  const fd = fs.openSync(sfxHost, 'r');
  const src = Buffer.alloc(meta.size);
  fs.readSync(fd, src, 0, meta.size, meta.offset);
  fs.closeSync(fd);
  fs.writeFileSync(out, src);
  return { path: out, rawSize: meta.rawSize };
}

function createWindow() {
  win = new BrowserWindow({
    width: 620,
    height: 330,
    frame: false,
    roundedCorners: true,
    backgroundColor: '#F6FAFF',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    resizable: false,
    maximizable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.removeMenu();
  const query = MODE_UNINSTALL ? '?mode=uninstall' : '';
  win.loadFile(path.join(__dirname, 'index.html'), { search: query });
  win.once('ready-to-show', () => win.show());
}

const send = (channel, payload) => {
  if (win !== null && !win.isDestroyed()) win.webContents.send(channel, payload);
};

ipcMain.on('inst:action', (event, action) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  if (w === null) return;
  if (action === 'close') w.close();
  if (action === 'minimize') w.minimize();
});

/** 探测已有安装：决定"安装"还是"升级"，并把路径预填给界面。 */
ipcMain.handle('inst:probe', async () => {
  const existing = await inst.detectExisting();
  return {
    existing,
    targetDir: existing ?? inst.defaultInstallDir(),
    version: app.getVersion(),
    mode: MODE_UNINSTALL ? 'uninstall' : 'install',
  };
});

ipcMain.handle('inst:install', async (_event, opts) => {
  if (busy) return { ok: false, error: '正在处理中' };
  busy = true;
  try {
    const payload = resolvePayload();
    const targetDir = String(opts?.targetDir ?? process.env['TTFOLIO_INSTALL_DIR'] ?? inst.defaultInstallDir());
    await inst.install({
      payloadPath: payload.path,
      targetDir,
      desktopShortcut: opts?.desktop !== false,
      expectedBytes: payload.rawSize,
      version: app.getVersion(),
      onProgress: (pct, msg) => send('inst:progress', { pct, msg }),
    });
    busy = false;
    send('inst:done', { type: 'install', exe: path.join(targetDir, inst.EXE_NAME) });
    if (opts?.runAfter !== false) {
      const exe = path.join(targetDir, inst.EXE_NAME);
      // 让界面先画完"完成"，再拉起应用
      setTimeout(() => {
        try {
          spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
        } catch {
          shell.openPath(exe);
        }
      }, 800);
    }
    return { ok: true };
  } catch (e) {
    busy = false;
    const message = e instanceof Error ? e.message : String(e);
    send('inst:error', { message });
    return { ok: false, error: message };
  }
});

ipcMain.handle('inst:uninstall', async (_event, opts) => {
  if (busy) return { ok: false, error: '正在处理中' };
  busy = true;
  try {
    const targetDir = String(opts?.targetDir ?? (await inst.detectExisting()) ?? inst.defaultInstallDir());
    const r = await inst.uninstall({
      targetDir,
      deleteData: opts?.deleteData === true,
      onProgress: (pct, msg) => send('inst:progress', { pct, msg }),
    });
    busy = false;
    send('inst:done', { type: 'uninstall' });
    if (r.pending === true) {
      // 自删进程会接管；这里给它一点时间再退出
      setTimeout(() => app.exit(0), 400);
    }
    return { ok: true };
  } catch (e) {
    busy = false;
    const message = e instanceof Error ? e.message : String(e);
    send('inst:error', { message });
    return { ok: false, error: message };
  }
});

app.whenReady().then(async () => {
  // 自删收尾进程：不建窗口，干完就退
  if (FINISH_INDEX >= 0) {
    const targetDir = ARGV[FINISH_INDEX + 1] ?? '';
    const del = ARGV[FINISH_INDEX + 2] === '1';
    if (targetDir !== '') await inst.finishUninstall(targetDir, del);
    app.exit(0);
    return;
  }
  // 无人值守：--silent 直接装，不建窗口（测试与批量部署用）
  log(`boot argv=${JSON.stringify(ARGV)} execPath=${process.execPath} portable=${process.env['PORTABLE_EXECUTABLE_FILE'] ?? '-'}`);
  log(`boot argv=${JSON.stringify(ARGV)} execPath=${process.execPath} portable=${process.env['PORTABLE_EXECUTABLE_FILE'] ?? '-'}`);
  if (ARGV.includes('--silent')) {
    try {
      const payload = resolvePayload();
      const targetDir = process.env['TTFOLIO_INSTALL_DIR'] ?? inst.defaultInstallDir();
      await inst.install({
        payloadPath: payload.path,
        targetDir,
        desktopShortcut: process.env['TTFOLIO_INSTALL_NO_SHORTCUT'] !== '1',
        expectedBytes: payload.rawSize,
        version: app.getVersion(),
        onProgress: () => {},
      });
      app.exit(0);
    } catch (e) {
      log('silent FAIL ' + String(e));
      process.stderr.write(String(e) + '\n');
      app.exit(2);
    }
    return;
  }
  createWindow();
});

app.on('window-all-closed', () => app.quit());
