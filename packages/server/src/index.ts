/** 启动：读配置 → 建/迁移库 → 校验项目路径 → 起双端口 HTTP → 起 Watcher → 每日备份。 */
import { existsSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadPort, resolveDataDir, ensureDataDirs, writeRuntime, loadOrCreateToken } from './config.js';
import { createLogger } from './core/logger.js';
import { SseHub } from './core/sse.js';
import { TaskManager } from './core/tasks.js';
import { WatcherManager } from './core/watcher.js';
import { TrashService } from './core/trash.js';
import { LibraryStore } from './db/index.js';
import { runMigrations, integrityCheck } from './db/migrate.js';
import { buildApp } from './app.js';
import { startUserContentServer } from './static/userContent.js';
import { listIgnoreRules } from './db/repo/rulesRepo.js';
import { checkPathOk } from './db/repo/projectsRepo.js';
import { hasWindowsPathHazard } from './core/pathGuard.js';
import { compileIgnore } from './core/ignore.js';
import { createBackup } from './core/backup.js';
import { getSetting, setSetting } from './db/repo/metaRepo.js';
import { getAll } from './db/sql.js';
import { SETTING_KEYS } from '@ttfolio/shared';

const version = '0.3.6';
const startedAt = Date.now();

/** 真正的 SQLite 库损坏（才会走"改名自愈"）；native 模块加载失败等启动期错误不算。 */
function isRealDbCorruption(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /file is not a database|database disk image is malformed|file is encrypted or is not a database|unsupported file format/i.test(
    msg,
  );
}

async function main(): Promise<void> {
  const dataDir = resolveDataDir();
  const layout = ensureDataDirs(dataDir);
  const logger = createLogger(layout.logDir);
  logger.info({ mod: 'boot', msg: `ttFolio starting, dataDir=${dataDir}` });

  // ---- 库：自愈 → 打开 → 迁移 ----
  // 自愈条件收窄（实测教训）：只有 SQLite 报"文件不是库/镜像损坏"才允许改名另存。
  // 之前任何 open 失败都会触发改名——native 模块 ABI 不匹配这种**与库无关**的失败
  // 会把真实索引库改名走，数据像凭空消失（本轮已在用户机上出现过一次，已恢复）。
  const store = new LibraryStore({ id: 'default', dbFile: layout.dbFile });
  let db;
  try {
    db = store.open();
    const ic = integrityCheck(db);
    if (!ic.ok) {
      logger.warn({ mod: 'boot', msg: `integrity_check: ${ic.message}（尝试 WAL 恢复）` });
    }
  } catch (err) {
    logger.error({ mod: 'boot', msg: `库打开失败：${err instanceof Error ? err.message : String(err)}` });
    if (!isRealDbCorruption(err)) {
      process.stdout.write(
        `索引库打开失败，但不是库损坏，服务退出且未触碰库文件：${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
    // 损坏自愈：坏库另存，新建空库（登记与索引丢失，项目文件不受影响）
    const broken = `${layout.dbFile}.corrupted-${Date.now()}`;
    try {
      renameSync(layout.dbFile, broken);
      logger.warn({ mod: 'boot', msg: `原库已另存为 ${broken}，将新建空库重新登记` });
    } catch {
      /* 原库可能不存在 */
    }
    db = store.open();
  }
  const mig = runMigrations(db, layout.backupDir);
  if (mig.applied.length > 0) {
    logger.info({ mod: 'boot', msg: `migrations applied: ${mig.applied.map((m) => m.file).join(', ')}` });
  }

  // ---- 每日备份（>24h） ----
  const lastBackup = getSetting(db, SETTING_KEYS.lastBackupAt);
  const lastMs = lastBackup !== null ? Date.parse(lastBackup) : 0;
  if (!Number.isFinite(lastMs) || Date.now() - lastMs > 24 * 3600 * 1000) {
    try {
      const r = createBackup(layout.dbFile, layout.backupDir);
      setSetting(db, SETTING_KEYS.lastBackupAt, new Date().toISOString());
      logger.info({ mod: 'boot', msg: `daily backup -> ${r.file} (integrity: ${r.integrity})` });
    } catch (err) {
      logger.warn({ mod: 'boot', msg: `backup failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  // ---- 端口探测 ----
  // token 持久化（DECISIONS.md D-TOKEN）：dev 下 tsx watch 每次改后端代码都会重启进程，
  // 若每次重新随机则页面/N不刷新的 SSE 与 vite 代理头立刻 401；因此复用数据目录下的 token 文件，
  // 想轮换时删除该文件即可。文件权限尽量收紧（Windows 上以目录 ACL 为准）。
  const token = loadOrCreateToken(layout.dataDir);
  const basePort = loadPort();
  let port = basePort;
  let userContentPort = basePort + 100;
  const { createServer } = await import('node:net');
  const isFree = (p: number): Promise<boolean> =>
    new Promise((resolve) => {
      const srv = createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen(p, '127.0.0.1');
    });
  for (let i = 0; i < 20; i++) {
    if ((await isFree(port)) && (await isFree(userContentPort))) break;
    port += 1;
    userContentPort = port + 100;
  }

  // ---- 服务装配 ----
  const sse = new SseHub();
  const tasks = new TaskManager(sse, logger);
  const watcher = new WatcherManager(sse, logger);
  const trash = new TrashService(layout.trashDir);
  const webDistCandidates = [
    // 桌面版（Electron）由主进程注入 asar 内的产物路径；dev/生产 web 模式走 cwd 相对定位
    ...(process.env['TTFOLIO_WEB_DIST'] !== undefined && process.env['TTFOLIO_WEB_DIST'] !== ''
      ? [path.resolve(process.env['TTFOLIO_WEB_DIST'])]
      : []),
    path.resolve(process.cwd(), 'packages', 'web', 'dist'),
    path.resolve(process.cwd(), 'dist'),
  ];
  const webDist = webDistCandidates.find((d) => existsSync(path.join(d, 'index.html'))) ?? null;

  const ctx = {
    logger,
    sse,
    tasks,
    watcher,
    trash,
    layout,
    store,
    db: () => store.get(),
    token,
    port,
    userContentPort,
    webDist,
    startedAt,
    version,
    dbSize: () => {
      try {
        return statSync(layout.dbFile).size;
      } catch {
        return 0;
      }
    },
  };

  const app = buildApp(ctx);
  await app.listen({ port, host: '127.0.0.1' });
  await startUserContentServer(ctx);

  writeRuntime(layout.runtimeFile, {
    pid: process.pid,
    port,
    userContentPort,
    token,
    version,
    startedAt: new Date().toISOString(),
  });

  // ---- 路径失效检测（启动一次） ----
  // 判据从"existsSync"升级为"存在 + 不触发危险段规则"：根目录名是 Windows 保留名或路径为 UNC 时，
  // 目录其实存在（existsSync 为 true），但每次打开都会被 pathGuard 拦下 —— 卡片必须标红，
  // 否则用户面对的是"能导入、永远打不开、且毫无线索"（P1-7）。
  try {
    const missing = checkPathOk(db, (p) => {
      if (hasWindowsPathHazard(path.resolve(p)) !== null) return false;
      return existsSync(p);
    });
    if (missing > 0) {
      logger.warn({
        mod: 'boot',
        msg: `${missing} 个项目目录不可访问（缺失或路径不合规），卡片将标红并提供重新定位`,
      });
    }
  } catch {
    /* 首次启动无项目 */
  }

  // ---- Watcher（默认全项目，忽略规则生效；设置可关） ----
  const watchEnabled = getSetting(db, 'watch_enabled') !== '0';
  if (watchEnabled) {
    const rows = getAll<{ id: string; dir_path: string }>(
      db,
      'SELECT id, dir_path FROM projects WHERE deleted_at IS NULL',
    );
    const rules = listIgnoreRules(db);
    const matcher = compileIgnore(rules);
    const stability = Number(getSetting(db, 'watch_stability_ms') ?? '300');
    for (const r of rows) {
      try {
        watcher.watch(r.id, r.dir_path, matcher, stability);
      } catch (err) {
        logger.warn({
          mod: 'boot',
          msg: `watcher failed for ${r.dir_path}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  const say = (s: string): void => {
    process.stdout.write(s + '\n');
  };
  say('ttFolio 已启动：');
  say(`  应用地址    http://127.0.0.1:${port}`);
  say(`  用户内容    http://127.0.0.1:${userContentPort}（架构图/原始文件，只读）`);
  say(`  数据目录    ${dataDir}`);
  say(`  token       ${token.slice(0, 6)}...（已写入 runtime.json，页面自动注入）`);

  const shutdown = (): void => {
    logger.info({ mod: 'boot', msg: 'shutting down' });
    watcher.unwatchAll();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  process.stdout.write(`启动失败：${err instanceof Error ? (err.stack ?? err.message) : String(err)}
`);
  process.exit(1);
});
