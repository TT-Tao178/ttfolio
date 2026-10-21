/** 回归锚点：缩略图 v2 路由（FR-13.5 / T-113）——索引、两级二进制上传、校验。 */
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
import { TaskManager } from './core/tasks.js';
import { WatcherManager } from './core/watcher.js';
import { TrashService } from './core/trash.js';
import { ChangeTracker } from './core/changes.js';
import type { AppContext } from './context.js';
import { insertProject } from './db/repo/projectsRepo.js';
import { pathKey } from './db/repo/docsRepo.js';
import { thumbName } from './core/thumbs.js';

let root: string;
let app: FastifyInstance;
let ctx: AppContext;
let pid: string;
const port = 7796;
const token = 'c'.repeat(48);

function fakeWebp(size = 128): Buffer {
  const buf = Buffer.alloc(size, 0);
  buf.write('RIFF', 0, 'ascii');
  buf.write('WEBP', 8, 'ascii');
  return buf;
}

async function inject(
  method: 'GET' | 'POST',
  url: string,
  opts: { payload?: Buffer | Record<string, unknown>; contentType?: string } = {},
) {
  const headers: Record<string, string> = { host: `127.0.0.1:${port}`, 'x-ttfolio-token': token };
  if (opts.contentType !== undefined) headers['content-type'] = opts.contentType;
  const res = await app.inject({
    method,
    url,
    headers,
    ...(opts.payload !== undefined ? { payload: opts.payload as never } : {}),
  } as never);
  return res as unknown as { statusCode: number; json(): Record<string, unknown> };
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttfolio-thumb-routes-'));
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

describe('缩略图 v2 路由（T-113）', () => {
  it('初始索引为空；二进制上传 g/p 后索引可见，落数据目录且项目目录零写入', async () => {
    const empty = await inject('GET', `/api/media/${pid}/thumb-index`);
    expect(empty.json().data).toEqual({ names: [] });

    const rel = 'assets/a.jpg';
    const g = await inject('POST', `/api/media/${pid}/thumb/g?path=${encodeURIComponent(rel)}`, {
      payload: fakeWebp(),
      contentType: 'image/webp',
    });
    expect(g.json()).toMatchObject({ ok: true, data: { thumb: thumbName(rel, 'g') } });
    const p = await inject('POST', `/api/media/${pid}/thumb/p?path=${encodeURIComponent(rel)}`, {
      payload: fakeWebp(256),
      contentType: 'image/webp',
    });
    expect(p.json()).toMatchObject({ ok: true, data: { thumb: thumbName(rel, 'p') } });

    const idx = await inject('GET', `/api/media/${pid}/thumb-index`);
    const names = (idx.json().data as { names: string[] }).names;
    expect(names).toContain(thumbName(rel, 'g'));
    expect(names).toContain(thumbName(rel, 'p'));
    expect(fs.existsSync(path.join(ctx.layout.thumbsDir, pid, thumbName(rel, 'g')))).toBe(true);
    // 项目目录零写入（红线）
    const projFiles = fs.readdirSync(path.join(root, 'proj'));
    expect(projFiles).toEqual([]);

    const stats = await inject('GET', '/api/thumbs/stats');
    const s = stats.json().data as { totalCount: number; projects: Array<{ projectId: string }> };
    expect(s.totalCount).toBe(2);
    expect(s.projects[0]?.projectId).toBe(pid);
  });

  it('非法 tier / 非 WebP 数据 / 缺 path / 超限 → 400', async () => {
    const badTier = await inject('POST', `/api/media/${pid}/thumb/x?path=a.png`, {
      payload: fakeWebp(),
      contentType: 'image/webp',
    });
    expect(badTier.statusCode).toBe(400);

    const notWebp = await inject('POST', `/api/media/${pid}/thumb/g?path=a.png`, {
      payload: Buffer.from('plain text'),
      contentType: 'image/webp',
    });
    expect(notWebp.statusCode).toBe(400);

    const noPath = await inject('POST', `/api/media/${pid}/thumb/g`, {
      payload: fakeWebp(),
      contentType: 'image/webp',
    });
    expect(noPath.statusCode).toBe(400);

    const tooBig = await inject('POST', `/api/media/${pid}/thumb/g?path=b.png`, {
      payload: fakeWebp(700_000),
      contentType: 'image/webp',
    });
    expect(tooBig.statusCode).toBe(400);
  });

  it('不存在的项目 → 404（索引与上传）', async () => {
    expect((await inject('GET', '/api/media/nope/thumb-index')).statusCode).toBe(404);
    const up = await inject('POST', '/api/media/nope/thumb/g?path=x.png', {
      payload: fakeWebp(),
      contentType: 'image/webp',
    });
    expect(up.statusCode).toBe(404);
  });
});
