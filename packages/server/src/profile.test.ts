/** 回归锚点：个人主页（FR-13.7 / T-103）——资料往返、校验、头像落盘、审计 actor 联动。 */
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
import type { AppContext } from './context.js';
import { currentActor, setDefaultActorName } from './core/actor.js';
import { usedDays } from './routes/profile.js';

let root: string;
let app: FastifyInstance;
let ctx: AppContext;
const port = 7797;
const token = 'b'.repeat(48);

async function inject(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { host: `127.0.0.1:${port}`, 'x-ttfolio-token': token },
    ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
  } as never);
  return res as unknown as { statusCode: number; json(): Record<string, unknown> };
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttfolio-profile-'));
  const logDir = path.join(root, 'logs');
  const trashDir = path.join(root, 'trash');
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(trashDir, { recursive: true });
  const store = new LibraryStore({ id: 'default', dbFile: path.join(root, 'library.db') });
  const db = store.open();
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, null);
  const sse = new SseHub();
  const logger = createLogger(logDir);
  ctx = {
    logger,
    sse,
    tasks: new TaskManager(sse, logger),
    watcher: new WatcherManager(sse, logger),
    trash: new TrashService(trashDir),
    layout: {
      dataDir: root,
      dbFile: path.join(root, 'library.db'),
      backupDir: path.join(root, 'backups'),
      trashDir,
      thumbsDir: path.join(root, 'thumbs'),
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
  setDefaultActorName(null);
  await app.close();
  ctx.store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('个人主页（FR-13.7）', () => {
  it('初始状态：无用户名、无头像、统计字段完整', async () => {
    const res = await inject('GET', '/api/profile');
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Record<string, unknown>;
    expect(data['name']).toBeNull();
    expect(data['hasAvatar']).toBe(false);
    expect(data['projectCount']).toBe(0);
    expect(data['usedDays']).toBeGreaterThanOrEqual(1);
    expect(data['version']).toBe('0.0.0-test');
  });

  it('用户名保存/清空往返，且同步审计 actor 默认值（agent 身份仍优先）', async () => {
    const set = await inject('PATCH', '/api/profile', { name: '  阿涛  ' });
    expect(set.json().data).toEqual({ name: '阿涛' });
    // 未声明 agent 头时，审计默认 actor 变成用户名
    expect(currentActor().actor).toBe('阿涛');
    const got = (await inject('GET', '/api/profile')).json().data as Record<string, unknown>;
    expect(got['name']).toBe('阿涛');

    // 空串 = 清空 → 回落 local
    await inject('PATCH', '/api/profile', { name: '   ' });
    expect((await inject('GET', '/api/profile')).json().data).toMatchObject({ name: null });
    expect(currentActor().actor).toBe('local');
  });

  it('用户名超 30 字 → 400，不落库', async () => {
    const res = await inject('PATCH', '/api/profile', { name: 'x'.repeat(31) });
    expect(res.statusCode).toBe(400);
    expect((await inject('GET', '/api/profile')).json().data).toMatchObject({ name: null });
  });

  it('头像：非法 dataURL 拒绝；合法 PNG 落数据目录（不写项目目录）并可清除', async () => {
    const bad = await inject('POST', '/api/profile/avatar', { dataUrl: 'data:image/jpeg;base64,AAAA' });
    expect(bad.statusCode).toBe(400);

    const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}`;
    const okRes = await inject('POST', '/api/profile/avatar', { dataUrl: png });
    expect(okRes.json()).toMatchObject({ ok: true, data: { hasAvatar: true } });
    expect(fs.existsSync(path.join(root, 'avatar.png'))).toBe(true);
    expect((await inject('GET', '/api/profile')).json().data).toMatchObject({ hasAvatar: true });

    const del = await inject('DELETE', '/api/profile/avatar');
    expect(del.json().data).toMatchObject({ hasAvatar: false });
    expect(fs.existsSync(path.join(root, 'avatar.png'))).toBe(false);
  });
});

describe('使用天数（usedDays）', () => {
  it('无审计记录按第 1 天；有记录按最早一天起算', () => {
    const fake = {
      // 仅用到 getAll 的返回结构
      prepare: () => ({ all: () => [] }),
    } as never;
    expect(usedDays(fake, Date.UTC(2026, 0, 1))).toBe(1);
    const db = ctx.db();
    db.prepare("INSERT INTO activity_log (at, kind, level, actor) VALUES (?, 'probe', 'L1', 'local')").run(
      '2026-10-01T00:00:00.000Z',
    );
    expect(usedDays(db, Date.parse('2026-10-05T00:00:00.000Z'))).toBe(5);
  });
});
