/** 回归锚点：移动/复制任务化（FR-4.7 / KNOWN-GAPS #1）——渐进原语、执行体、HTTP 路由。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { LibraryStore } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { createLogger } from './core/logger.js';
import { SseHub } from './core/sse.js';
import { TaskManager, type TaskContext } from './core/tasks.js';
import { WatcherManager } from './core/watcher.js';
import { TrashService } from './core/trash.js';
import { ChangeTracker } from './core/changes.js';
import * as fsx from './core/fsx.js';
import { runMoveCopyPlan, type MoveStep } from './core/fstask.js';
import type { AppContext } from './context.js';
import { insertProject } from './db/repo/projectsRepo.js';
import { pathKey } from './db/repo/docsRepo.js';
import type { TaskInfo } from '@ttfolio/shared';

let root: string;
let app: FastifyInstance;
let ctx: AppContext;
let pid: string;
const port = 7798;
const token = 'd'.repeat(48);

function cancelledError(): Error {
  return Object.assign(new Error('已取消'), { code: 'CANCELLED' });
}

/** 第 n+1 次 checkCancelled 起抛 CANCELLED 的任务上下文桩。 */
function cancelAfter(n: number): TaskContext & { calls: () => number } {
  let calls = 0;
  return {
    taskId: 'test',
    calls: () => calls,
    checkCancelled: (): void => {
      calls += 1;
      if (calls > n) throw cancelledError();
    },
    isCancelled: (): boolean => calls > n,
    progress: (): void => {},
    markPartial: (): void => {},
  };
}

function noopCtx(): TaskContext {
  return {
    taskId: 'test',
    checkCancelled: (): void => {},
    isCancelled: (): boolean => false,
    progress: (): void => {},
    markPartial: (): void => {},
  };
}

async function inject(method: 'GET' | 'POST', url: string, opts: { payload?: Record<string, unknown> } = {}) {
  const headers: Record<string, string> = { host: `127.0.0.1:${port}`, 'x-ttfolio-token': token };
  const res = await app.inject({
    method,
    url,
    headers,
    ...(opts.payload !== undefined ? { payload: opts.payload as never } : {}),
  } as never);
  return res as unknown as { statusCode: number; json(): Record<string, unknown> };
}

async function waitTask(taskId: string): Promise<TaskInfo> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const info = ctx.tasks.get(taskId);
    if (info !== null && info.status !== 'running') return info;
    if (Date.now() > deadline) throw new Error(`任务超时未结束：${taskId}`);
    await new Promise((r) => {
      setTimeout(r, 20);
    });
  }
}

function makeTree(dir: string, fileCount: number): void {
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < fileCount; i++) {
    fs.writeFileSync(path.join(dir, `f${String(i).padStart(2, '0')}.txt`), `内容-${i}`, 'utf8');
  }
}

function treeFiles(dir: string): string[] {
  return fs.readdirSync(dir).sort();
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttfolio-fsmove-'));
  const logDir = path.join(root, 'logs');
  const trashDir = path.join(root, 'trash');
  const thumbsDir = path.join(root, 'thumbs');
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(trashDir, { recursive: true });
  fs.mkdirSync(thumbsDir, { recursive: true });
  const store = new LibraryStore({ id: 'default', dbFile: path.join(root, 'library.db') });
  const db = store.open();
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, null);
  const projDir = path.join(root, 'proj');
  fs.mkdirSync(projDir, { recursive: true });
  fs.writeFileSync(path.join(projDir, 'a.txt'), 'A-内容', 'utf8');
  makeTree(path.join(projDir, 'big'), 10);
  fs.mkdirSync(path.join(projDir, 'dest2'), { recursive: true });
  pid = insertProject(db, {
    dirPath: projDir,
    dirPathKey: pathKey(projDir),
    diskName: 'proj',
    defaultArchDir: '架构图',
  }).id;
  const sse = new SseHub();
  const logger = createLogger(logDir);
  ctx = {
    logger,
    sse,
    tasks: new TaskManager(sse, logger),
    watcher: new WatcherManager(sse, logger),
    trash: new TrashService(trashDir),
    changes: new ChangeTracker(() => db, sse, logger),
    layout: {
      dataDir: root,
      dbFile: path.join(root, 'library.db'),
      backupDir: path.join(root, 'backups'),
      trashDir,
      thumbsDir,
      logDir,
      runtimeFile: path.join(root, 'runtime.json'),
    },
    store,
    db: () => store.get(),
    token,
    port,
    userContentPort: port + 100,
    webDist: null,
    startedAt: Date.now(),
    version: '0.0.0-test',
    dbSize: () => 0,
  };
  app = buildApp(ctx);
});

afterAll(async () => {
  await app.close();
  ctx.store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('渐进复制/校验原语（fsx，FR-4.7）', () => {
  it('复制目录树内容一致并回报字节进度', async () => {
    const src = path.join(root, 't1-src');
    const dest = path.join(root, 't1-dst');
    makeTree(src, 5);
    let seen = 0;
    const n = await fsx.copyTreeProgressive(src, dest, {
      checkCancelled: (): void => {},
      onProgress: (done) => {
        seen = done;
      },
    });
    expect(treeFiles(dest)).toEqual(treeFiles(src));
    expect(seen).toBeGreaterThan(0);
    expect(n).toBe(seen);
    await fsx.verifyTreeProgressive(src, dest, {
      checkCancelled: (): void => {},
      onProgress: (): void => {},
    });
  });

  it('取消：抛 CANCELLED，源完整，半成品目标留给调用方处置', async () => {
    const src = path.join(root, 't2-src');
    const dest = path.join(root, 't2-dst');
    makeTree(src, 10);
    const hooks = cancelAfter(3);
    await expect(
      fsx.copyTreeProgressive(src, dest, {
        checkCancelled: hooks.checkCancelled,
        onProgress: (): void => {},
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(treeFiles(src)).toHaveLength(10);
    expect(fs.existsSync(dest)).toBe(true); // 仅复制了前 3 个文件
    expect(fs.existsSync(path.join(dest, 'f00.txt'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'f09.txt'))).toBe(false);
  });

  it('校验：篡改目标内容后报哈希不一致', async () => {
    const src = path.join(root, 't3-src');
    const dest = path.join(root, 't3-dst');
    makeTree(src, 3);
    fsx.copyRecursive(src, dest);
    fs.writeFileSync(path.join(dest, 'f01.txt'), '被篡改', 'utf8');
    await expect(
      fsx.verifyTreeProgressive(src, dest, { checkCancelled: (): void => {}, onProgress: (): void => {} }),
    ).rejects.toMatchObject({ code: 'IO_ERROR' });
  });
});

describe('runMoveCopyPlan（移动/复制任务执行体）', () => {
  it('同盘 move：rename 完成、源消失、逐项回调', async () => {
    const src = path.join(root, 'm1-src.txt');
    const dest = path.join(root, 'm1-dst.txt');
    fs.writeFileSync(src, 'move-me', 'utf8');
    const done: string[] = [];
    const out = await runMoveCopyPlan(
      [{ src, dest, bytes: 7, destPreExisted: false, srcRel: 'm1-src.txt', destRel: 'm1-dst.txt' }],
      { mode: 'move' },
      noopCtx(),
      (step) => {
        done.push(step.destRel);
      },
    );
    expect(out.failures).toEqual([]);
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.readFileSync(dest, 'utf8')).toBe('move-me');
    expect(done).toEqual(['m1-dst.txt']);
  });

  it('取消：源恒完整，新建的半成品目标被清理', async () => {
    const src = path.join(root, 'm2-src');
    const dest = path.join(root, 'm2-dst');
    makeTree(src, 10);
    const hooks = cancelAfter(4);
    await expect(
      runMoveCopyPlan(
        [{ src, dest, bytes: 10, destPreExisted: false, srcRel: 'm2-src', destRel: 'm2-dst' }],
        { mode: 'copy' },
        hooks,
        (): void => {},
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(treeFiles(src)).toHaveLength(10);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('取消：目标原已存在（覆盖语义）时保留现场不清理', async () => {
    const src = path.join(root, 'm3-src');
    const dest = path.join(root, 'm3-dst');
    makeTree(src, 10);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, '旧的.txt'), 'keep', 'utf8');
    const hooks = cancelAfter(2);
    await expect(
      runMoveCopyPlan(
        [{ src, dest, bytes: 10, destPreExisted: true, srcRel: 'm3-src', destRel: 'm3-dst' }],
        { mode: 'copy' },
        hooks,
        (): void => {},
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(path.join(dest, '旧的.txt'), 'utf8')).toBe('keep');
  });

  it('单项失败不中止整批：失败计入 markPartial，成功项照常完成，move 不删源', async () => {
    // 第二项的 dest 预置了同名「目录」→ 复制必然失败（非取消错误）
    const okSrc = path.join(root, 'm4-ok.txt');
    fs.writeFileSync(okSrc, 'good', 'utf8');
    const badSrc = path.join(root, 'm4-bad');
    const badDest = path.join(root, 'm4-bad-dst');
    fs.mkdirSync(badSrc, { recursive: true });
    fs.writeFileSync(path.join(badSrc, 'x.txt'), 'x', 'utf8');
    fs.mkdirSync(badDest, { recursive: true });
    fs.mkdirSync(path.join(badDest, 'x.txt'), { recursive: true });
    const steps: MoveStep[] = [
      {
        src: okSrc,
        dest: path.join(root, 'm4-ok-dst.txt'),
        bytes: 4,
        destPreExisted: false,
        srcRel: 'm4-ok.txt',
        destRel: 'm4-ok-dst.txt',
      },
      { src: badSrc, dest: badDest, bytes: 1, destPreExisted: true, srcRel: 'm4-bad', destRel: 'm4-bad-dst' },
    ];
    const partials: string[] = [];
    const taskCtx: TaskContext = {
      ...noopCtx(),
      markPartial: (m) => {
        partials.push(m);
      },
    };
    const out = await runMoveCopyPlan(steps, { mode: 'move' }, taskCtx, (): void => {});
    expect(out.succeeded).toHaveLength(1);
    expect(out.failures).toHaveLength(1);
    expect(partials.length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(root, 'm4-ok-dst.txt'), 'utf8')).toBe('good');
    // 失败项：源完好（绝不删源），fresh=false 的目标现场保留
    expect(fs.existsSync(path.join(badSrc, 'x.txt'))).toBe(true);
  });
});

describe('POST /api/fs/move 路由（HTTP，任务化语义）', () => {
  it('返回 taskId，任务完成后文件移动、源消失', async () => {
    const res = await inject('POST', '/api/fs/move', {
      payload: { projectId: pid, items: ['big'], targetDir: 'dest2', mode: 'move', onConflict: 'ask' },
    });
    expect(res.statusCode).toBe(200);
    const taskId = (res.json().data as { taskId: string | null }).taskId;
    expect(taskId).not.toBeNull();
    const info = await waitTask(taskId as string);
    expect(info.status).toBe('done');
    expect(fs.existsSync(path.join(root, 'proj', 'big'))).toBe(false);
    expect(treeFiles(path.join(root, 'proj', 'dest2', 'big'))).toHaveLength(10);
  });

  it('ask 冲突 → 400 INVALID_NAME（同步预检，不建任务、不动目标）', async () => {
    fs.writeFileSync(path.join(root, 'proj', 'dest2', 'a.txt'), '旧内容', 'utf8');
    const res = await inject('POST', '/api/fs/move', {
      payload: { projectId: pid, items: ['a.txt'], targetDir: 'dest2', mode: 'move', onConflict: 'ask' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json().error as { code: string }).code).toBe('INVALID_NAME');
    expect(fs.readFileSync(path.join(root, 'proj', 'a.txt'), 'utf8')).toBe('A-内容');
    expect(fs.readFileSync(path.join(root, 'proj', 'dest2', 'a.txt'), 'utf8')).toBe('旧内容');
  });

  it('overwrite：目标旧内容被替换，任务完成后源消失', async () => {
    const res = await inject('POST', '/api/fs/move', {
      payload: {
        projectId: pid,
        items: ['a.txt'],
        targetDir: 'dest2',
        mode: 'move',
        onConflict: 'overwrite',
      },
    });
    expect(res.statusCode).toBe(200);
    const taskId = (res.json().data as { taskId: string | null }).taskId;
    const info = await waitTask(taskId as string);
    expect(info.status).toBe('done');
    expect(fs.readFileSync(path.join(root, 'proj', 'dest2', 'a.txt'), 'utf8')).toBe('A-内容');
    expect(fs.existsSync(path.join(root, 'proj', 'a.txt'))).toBe(false);
  });

  it('copy 模式：源保留、目标出现', async () => {
    fs.writeFileSync(path.join(root, 'proj', 'c.txt'), 'C', 'utf8');
    const res = await inject('POST', '/api/fs/move', {
      payload: { projectId: pid, items: ['c.txt'], targetDir: 'dest2', mode: 'copy', onConflict: 'ask' },
    });
    expect(res.statusCode).toBe(200);
    const taskId = (res.json().data as { taskId: string | null }).taskId;
    await waitTask(taskId as string);
    expect(fs.readFileSync(path.join(root, 'proj', 'c.txt'), 'utf8')).toBe('C');
    expect(fs.readFileSync(path.join(root, 'proj', 'dest2', 'c.txt'), 'utf8')).toBe('C');
  });

  it('全部自移动无可执行项 → taskId:null（同步完成语义）', async () => {
    fs.writeFileSync(path.join(root, 'proj', 'b.txt'), 'B', 'utf8');
    const res = await inject('POST', '/api/fs/move', {
      payload: { projectId: pid, items: ['b.txt'], targetDir: '.', mode: 'move', onConflict: 'ask' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as { taskId: string | null }).taskId).toBeNull();
  });
});

describe('任务端点（GET /api/tasks、POST /api/tasks/cancel，FR-4.7）', () => {
  it('运行中任务可见、按 taskId 精确取消、终态 cancelled', async () => {
    const taskId = ctx.tasks.start('move-copy', '测试长任务', 100, async (tc) => {
      while (!tc.isCancelled()) {
        await new Promise((r) => {
          setTimeout(r, 10);
        });
      }
    });
    const list = await inject('GET', '/api/tasks');
    const running = (list.json().data as { running: TaskInfo[] }).running;
    expect(running.some((t) => t.taskId === taskId)).toBe(true);
    const cancel = await inject('POST', '/api/tasks/cancel', { payload: { taskId } });
    expect((cancel.json().data as { cancelled: boolean }).cancelled).toBe(true);
    const info = await waitTask(taskId);
    expect(info.status).toBe('cancelled');
  });

  it('缺 taskId → 400', async () => {
    const res = await inject('POST', '/api/tasks/cancel', { payload: {} });
    expect(res.statusCode).toBe(400);
  });
});
