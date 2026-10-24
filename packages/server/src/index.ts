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
import { setDefaultActorName } from './core/actor.js';
import { hasWindowsPathHazard } from './core/pathGuard.js';
import { compileIgnore } from './core/ignore.js';
import { createBackup, applyRetentionByDays } from './core/backup.js';
import { getSetting, setSetting } from './db/repo/metaRepo.js';
import {
  insertTaskRun,
  finishTaskRun,
  purgeOldTaskRuns,
  failStaleRunningTaskRuns,
} from './db/repo/taskRunRepo.js';
import { ChangeTracker, purgeChangeEvents } from './core/changes.js';
import { pruneSnapshots } from './core/snapshots.js';
import { autoCloseSessions, closeAutoSessionsOnExit } from './core/sessionSummary.js';
import { enforceQuota } from './core/thumbs.js';
import { getAll } from './db/sql.js';
import { SETTING_KEYS } from '@ttfolio/shared';

const version = '0.4.10';
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

  // ---- 缩略图配额（FR-13.5 / T-113）：启动时按 LRU 收敛一次 ----
  try {
    const q = enforceQuota(layout.thumbsDir);
    if (q.removed > 0) {
      logger.info({ mod: 'boot', msg: `thumb quota: removed ${q.removed} files, freed ${q.freed} bytes` });
    }
  } catch {
    /* 配额清理失败不阻断启动 */
  }

  // ---- 个人主页（FR-13.7）：审计 actor 默认取用户名 ----
  setDefaultActorName(getSetting(db, 'profile_name'));

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
  // 备份保留可配（FR-13.11 / T-108）：backup_keep_days > 0 时按天数清理过期快照
  try {
    const keepDays = Number(getSetting(db, 'backup_keep_days') ?? '0');
    const removed = applyRetentionByDays(layout.backupDir, keepDays);
    if (removed > 0) {
      logger.info({ mod: 'boot', msg: `backup retention(${keepDays}d): removed ${removed}` });
    }
  } catch {
    /* 保留清理失败不阻断启动 */
  }

  // ---- 任务历史（FR-13.11 / T-108）：启动清 30 天前历史 + 崩溃遗留 running 判死 ----
  try {
    purgeOldTaskRuns(db, 30);
    failStaleRunningTaskRuns(db);
  } catch {
    /* 历史清理失败不阻断启动 */
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
  // 任务历史落库（FR-13.11 / T-108）：经 store.get() 惰性取当前库句柄（库恢复重建后不悬空）
  tasks.setRunPersistence({
    runStarted: (id, kind, title, startedAt) => insertTaskRun(store.get(), { id, kind, title, startedAt }),
    runFinished: (id, status, error, finishedAt, done, total) =>
      finishTaskRun(store.get(), { id, status, error, finishedAt, done, total }),
  });
  // 变更流水统一入口（FR-13.2 v2 / T-111）：watcher flush 与各路由的写操作都经它
  // （落库 → 会话聚合 → SSE）；库句柄惰性取，库恢复重建后不悬空。
  // 快照根启用可选快照层（FR-13.3 v2，默认关：settings.agent_repo_snapshots=1）
  const snapshotsRoot = path.join(layout.dataDir, 'snapshots');
  const changes = new ChangeTracker(() => store.get(), sse, logger, snapshotsRoot);
  const watcher = new WatcherManager(sse, logger, (projectId, relPaths, kind) => {
    changes.publish({
      projectId,
      relPaths,
      kind: kind === 'create' || kind === 'delete' ? kind : 'update',
      source: 'watcher',
    });
  });
  // 启动清理：变更流水热 7 天 + 全库 20 万行硬上限；每日滚动
  try {
    const removedChanges = purgeChangeEvents(store.get());
    if (removedChanges > 0) {
      logger.info({ mod: 'boot', msg: `change_event retention: removed ${removedChanges}` });
    }
  } catch {
    /* 清理失败不阻断启动 */
  }
  const changeCleanupTimer = setInterval(
    () => {
      try {
        purgeChangeEvents(store.get());
        pruneSnapshots(snapshotsRoot);
      } catch {
        /* 定时清理失败忽略 */
      }
    },
    24 * 3600 * 1000,
  );
  changeCleanupTimer.unref();

  // 自动会话收尾（FR-13.3 v2 / T-112）：每分钟检查空闲 15 分钟/跨自然日的 auto 会话，
  // 结束并生成自动摘要（不调 AI）；手动「结束本段」保留为里程碑语义
  const sessionCloseTimer = setInterval(() => {
    void autoCloseSessions(store.get(), logger).catch(() => {
      /* 单轮失败忽略，下一分钟再试 */
    });
  }, 60_000);
  sessionCloseTimer.unref();
  // 应用退出：尽力结束 auto 会话（生成摘要）；失败不阻塞退出
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      void closeAutoSessionsOnExit(store.get()).finally(() => process.exit(0));
    });
  }
  // 启动即清一次过期快照
  try {
    const pruned = pruneSnapshots(snapshotsRoot);
    if (pruned > 0) logger.info({ mod: 'boot', msg: `snapshots pruned: ${pruned}` });
  } catch {
    /* 忽略 */
  }
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
    changes,
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
    // Agent 发现段（FR-13.1 / T-095）：外部 agent 只凭本文件即可找到服务并列出项目
    agent: {
      protocolVersion: 1,
      apiBase: `http://127.0.0.1:${port}`,
      manifest: '/api/agent/manifest',
    },
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
