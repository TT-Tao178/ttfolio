/**
 * 安装/卸载的真实动作（T-154 第二步）。
 *
 * 设计原则：
 *  - 只用 Windows 自带工具（tar.exe / reg.exe / powershell），不引入第三方二进制；
 *  - 每个动作都是幂等的，失败不留下"半装状态"（先装到 .tmp 再改名）；
 *  - 卸载永远默认保留 %APPDATA%\ttFolio，只有显式要求才删。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_ID = 'com.tttao.ttfolio';
const APP_NAME = 'TT项目管理工作台';
const EXE_NAME = 'TT项目管理工作台.exe';
const UNINSTALL_KEY = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}`;
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const TAR = path.join(process.env['SystemRoot'] || 'C:\\Windows', 'System32', 'tar.exe');
const REG = path.join(process.env['SystemRoot'] || 'C:\\Windows', 'System32', 'reg.exe');

function defaultInstallDir() {
  return path.join(process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'ttFolio');
}

function dataDir() {
  return path.join(process.env['APPDATA'] || path.join(os.homedir(), 'AppData', 'Roaming'), 'ttFolio');
}

/** 跑一个命令，收集输出（不抛异常，返回 code/stdout/stderr）。 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    let out = '';
    let err = '';
    p.stdout?.on('data', (d) => {
      out += d.toString();
    });
    p.stderr?.on('data', (d) => {
      err += d.toString();
    });
    p.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

async function regQuery(key, value) {
  const r = await run(REG, ['query', key, '/v', value]);
  if (r.code !== 0) return null;
  const m = r.out.match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`));
  return m ? m[1].trim() : null;
}

/**
 * 找上次的安装位置：先读卸载项，其次读 Run 项（早期版本没写 InstallLocation）。
 * 返回 null 表示没装过。
 */
async function detectExisting() {
  const loc = await regQuery(UNINSTALL_KEY, 'InstallLocation');
  if (loc !== null && loc !== '') return loc;
  const runCmd = await regQuery(RUN_KEY, 'TTFolio');
  if (runCmd !== null) {
    const m = runCmd.match(/^"([^"]+)"/);
    if (m) return path.dirname(m[1]);
  }
  return null;
}

/** 目录大小（用于进度：解压到什么程度）。 */
function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* 解压中的文件可能瞬间不可读 */
        }
      }
    }
  }
  return total;
}

function rmrf(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* 忽略：占用中的文件留给下次 */
  }
}

/**
 * 解压 payload 到目标目录。
 * 先解到 `<target>.installing`，成功后整体改名——中途失败不会留下能启动的半装目录。
 * 进度用"目标目录已写字节 / 预期字节"估算（tar 不自带进度）。
 */
async function extractPayload(payloadPath, targetDir, onProgress, expectedBytes) {
  const staging = `${targetDir}.installing`;
  rmrf(staging);
  fs.mkdirSync(staging, { recursive: true });

  const child = spawn(TAR, ['-xf', payloadPath, '-C', staging], { windowsHide: true });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar 退出码 ${code}`))));
  });

  let last = 0;
  const timer = setInterval(() => {
    const now = dirSize(staging);
    if (expectedBytes > 0 && now > last) {
      last = now;
      onProgress(Math.min(96, Math.round((now / expectedBytes) * 92) + 4));
    }
  }, 400);

  try {
    await done;
  } finally {
    clearInterval(timer);
  }

  onProgress(96);
  rmrf(targetDir);
  // rename 可能被杀软扫描/资源管理器短暂占住（实测 520MB 解压后第一次必失败），重试 + 兜底拷贝
  let moved = false;
  for (let i = 0; i < 6 && !moved; i++) {
    try {
      fs.renameSync(staging, targetDir);
      moved = true;
    } catch {
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  if (!moved) {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.cpSync(staging, targetDir, { recursive: true, force: true });
    rmrf(staging);
  }
  onProgress(96);
}

/** 用 powershell 建快捷方式（.lnk 需要 COM，Node 侧没有现成写法）。 */
async function createShortcut(lnkPath, target, args, icon, workdir) {
  const script = [
    '$ws = New-Object -ComObject WScript.Shell',
    `$s = $ws.CreateShortcut('${lnkPath.replace(/'/g, "''")}')`,
    `$s.TargetPath = '${target.replace(/'/g, "''")}'`,
    args ? `$s.Arguments = '${args.replace(/'/g, "''")}'` : '',
    `$s.WorkingDirectory = '${workdir.replace(/'/g, "''")}'`,
    icon ? `$s.IconLocation = '${icon.replace(/'/g, "''")}'` : '',
    '$s.Save()',
  ]
    .filter(Boolean)
    .join('; ');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
}

function desktopDir() {
  return path.join(process.env['USERPROFILE'] || os.homedir(), 'Desktop');
}
function startMenuDir() {
  return path.join(
    process.env['APPDATA'] || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
  );
}

/**
 * 执行安装。
 * opts: { payloadPath, targetDir, desktopShortcut, runAfter, expectedBytes, onProgress }
 */
async function install(opts) {
  const { payloadPath, targetDir, desktopShortcut, expectedBytes, onProgress } = opts;
  const report = onProgress ?? (() => {});

  report(2, '正在准备…');
  if (!fs.existsSync(payloadPath)) throw new Error(`安装包数据缺失：${payloadPath}`);

  report(4, '正在解压文件…');
  await extractPayload(payloadPath, targetDir, (p) => report(p, '正在解压文件…'), expectedBytes);

  const exe = path.join(targetDir, EXE_NAME);
  if (!fs.existsSync(exe)) throw new Error(`解压后找不到主程序：${exe}`);
  report(97, '正在创建快捷方式…');

  const noShortcut = process.env['TTFOLIO_INSTALL_NO_SHORTCUT'] === '1';
  const noReg = process.env['TTFOLIO_INSTALL_NO_REG'] === '1';
  const startMenu = path.join(startMenuDir(), `${APP_NAME}.lnk`);
  if (!noShortcut) {
    await createShortcut(startMenu, exe, '', exe, targetDir);
    if (desktopShortcut) {
      await createShortcut(path.join(desktopDir(), `${APP_NAME}.lnk`), exe, '', exe, targetDir);
    }
  }

  report(98, '正在注册卸载信息…');
  const uninstaller = path.join(targetDir, `${APP_NAME}-卸载.exe`);
  // 卸载程序就是安装器自身的一份拷贝，带 --uninstall 参数运行
  try {
    fs.copyFileSync(process.execPath, uninstaller);
  } catch {
    /* 拷贝失败不致命：菜单里仍可用安装器卸载 */
  }
  const sizeKb = String(Math.round(dirSize(targetDir) / 1024));
  if (noReg) {
    report(100, '安装完成');
    return { exe, targetDir, regFailed: false };
  }
  const regCmds = [];
  regCmds.push(['add', UNINSTALL_KEY, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', APP_NAME, '/f']);
  regCmds.push(['add', UNINSTALL_KEY, '/v', 'DisplayIcon', '/t', 'REG_SZ', '/d', `${exe},0`, '/f']);
  regCmds.push(['add', UNINSTALL_KEY, '/v', 'DisplayVersion', '/t', 'REG_SZ', '/d', opts.version ?? '', '/f']);
  regCmds.push(['add', UNINSTALL_KEY, '/v', 'InstallLocation', '/t', 'REG_SZ', '/d', targetDir, '/f']);
  regCmds.push(['add', UNINSTALL_KEY, '/v', 'Publisher', '/t', 'REG_SZ', '/d', 'TT', '/f']);
  regCmds.push(['add', UNINSTALL_KEY, '/v', 'EstimatedSize', '/t', 'REG_DWORD', '/d', sizeKb, '/f']);
  regCmds.push(['add', UNINSTALL_KEY, '/v', 'UninstallString', '/t', 'REG_SZ', '/d', `"${uninstaller}" --uninstall`, '/f']);
  regCmds.push(['add', UNINSTALL_KEY, '/v', 'QuietUninstallString', '/t', 'REG_SZ', '/d', `"${uninstaller}" --uninstall --quiet`, '/f']);
  regCmds.push(['add', UNINSTALL_KEY, '/v', 'NoModify', '/t', 'REG_DWORD', '/d', '1', '/f']);
  regCmds.push(['add', UNINSTALL_KEY, '/v', 'NoRepair', '/t', 'REG_DWORD', '/d', '1', '/f']);

  // 注册表写失败不回滚程序文件：至少能跑，卸载项缺失会提示
  let regFailed = false;
  for (const args of regCmds) {
    const r = await run(REG, args);
    if (r.code !== 0) regFailed = true;
  }
  report(100, '安装完成');
  return { exe, targetDir, regFailed };
}

/**
 * 执行卸载。opts: { targetDir, deleteData, onProgress }
 * 注意顺序：先删快捷方式与注册表，再删程序目录，最后（可选）删数据。
 */
async function uninstall(opts) {
  const { targetDir, deleteData, onProgress } = opts;
  const report = onProgress ?? (() => {});

  report(10, '正在移除快捷方式…');
  rmrf(path.join(desktopDir(), `${APP_NAME}.lnk`));
  rmrf(path.join(startMenuDir(), `${APP_NAME}.lnk`));

  report(35, '正在清除注册信息…');
  await run(REG, ['delete', UNINSTALL_KEY, '/f']);
  await run(REG, ['delete', RUN_KEY, '/v', 'TTFolio', '/f']);

  report(60, '正在删除程序文件…');
  // 自删：把自己拷到 temp 再执行删除，避免"正在运行的文件删不掉"
  const self = process.execPath;
  const inInstallDir = path.resolve(self).toLowerCase().startsWith(path.resolve(targetDir).toLowerCase());
  if (!inInstallDir) {
    rmrf(targetDir);
  } else {
    const tmp = path.join(os.tmpdir(), `ttfolio-uninstall-${Date.now()}.exe`);
    try {
      fs.copyFileSync(self, tmp);
      spawn(tmp, ['--finish-uninstall', targetDir, deleteData ? '1' : '0'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
      report(100, '正在完成…');
      return { pending: true };
    } catch {
      rmrf(targetDir);
    }
  }

  if (deleteData) {
    report(85, '正在删除用户数据…');
    rmrf(dataDir());
  }
  report(100, '卸载完成');
  return { pending: false };
}

/** 卸载的收尾阶段（由临时拷贝的进程执行）。 */
async function finishUninstall(targetDir, deleteData) {
  // 等原进程退出、文件解锁
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 300));
    if (!fs.existsSync(path.join(targetDir, EXE_NAME))) break;
    rmrf(targetDir);
  }
  rmrf(targetDir);
  if (deleteData) rmrf(dataDir());
}

module.exports = {
  APP_ID,
  APP_NAME,
  EXE_NAME,
  UNINSTALL_KEY,
  RUN_KEY,
  defaultInstallDir,
  dataDir,
  detectExisting,
  install,
  uninstall,
  finishUninstall,
  run,
  dirSize,
};
