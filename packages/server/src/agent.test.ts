/** Agent 接口测试（FR-13.1 / T-095）：buildApp + inject，全部走临时数据目录。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from './app.js';
import { LibraryStore } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { createLogger } from './core/logger.js';
import { SseHub } from './core/sse.js';
import { TaskManager } from './core/tasks.js';
import { WatcherManager } from './core/watcher.js';
import { TrashService } from './core/trash.js';
import { ChangeTracker } from './core/changes.js';
import { writeRuntime, readRuntime } from './config.js';
import type { AppContext } from './context.js';
import { insertProject } from './db/repo/projectsRepo.js';
import { pathKey } from './db/repo/docsRepo.js';

let root: string;
let projDir: string;
let app: FastifyInstance;
let ctx: AppContext;
const port = 7799;
const token = 'a'.repeat(48);

interface InjectResult {
  statusCode: number;
  json(): Record<string, unknown>;
}

async function inject(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  opts: { body?: Record<string, unknown>; actor?: string; withToken?: boolean } = {},
): Promise<InjectResult> {
  const headers: Record<string, string> = { host: `127.0.0.1:${port}` };
  if (opts.withToken !== false) headers['x-ttfolio-token'] = token;
  if (opts.actor !== undefined) headers['x-ttfolio-actor'] = opts.actor;
  const res = await app.inject({ method, url, headers, payload: opts.body } as unknown as InjectOptions);
  return res as unknown as InjectResult;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttfolio-agent-'));
  const logDir = path.join(root, 'logs');
  const trashDir = path.join(root, 'trash');
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(trashDir, { recursive: true });

  const store = new LibraryStore({ id: 'default', dbFile: path.join(root, 'library.db') });
  const db = store.open();
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, null);

  // 示例项目：一个目录 + 集合 + 标签，验证 manifest 的清单字段
  projDir = path.join(root, 'demo');
  fs.mkdirSync(projDir, { recursive: true });
  fs.writeFileSync(path.join(projDir, 'README.md'), '# demo\n');
  const pid = insertProject(db, {
    dirPath: projDir,
    dirPathKey: pathKey(projDir),
    diskName: 'demo',
    defaultArchDir: '架构图',
  }).id;
  db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, NULL)').run('tag1', '前端');
  db.prepare('INSERT INTO project_tags (project_id, tag_id) VALUES (?, ?)').run(pid, 'tag1');
  db.prepare(
    'INSERT INTO collections (id, name, note, sort_order, created_at, updated_at) VALUES (?, ?, NULL, 0, ?, ?)',
  ).run('col1', '主力项目', new Date().toISOString(), new Date().toISOString());
  db.prepare('INSERT INTO collection_members (collection_id, project_id) VALUES (?, ?)').run('col1', pid);

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
  await app.close();
  ctx.store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('GET /api/agent/manifest（发现清单）', () => {
  it('未持 token 一律 401', async () => {
    const res = await inject('GET', '/api/agent/manifest', { withToken: false });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
  });

  it('返回服务版本、协议版本与能力端点表', async () => {
    const res = await inject('GET', '/api/agent/manifest');
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    const data = res.json().data as Record<string, unknown>;
    expect(data).toMatchObject({
      service: 'ttFolio',
      version: '0.0.0-test',
      protocolVersion: 1,
      apiBase: `http://127.0.0.1:${port}`,
    });
    const caps = data.capabilities as Record<string, string>;
    expect(caps.projectContext).toBe('GET /api/agent/projects/{id}/context');
    expect(caps.fileRead).toContain('/api/fs/file');
  });

  it('项目清单含 id/名称/别名/路径/标签/集合名（集合 id 映射为名）', async () => {
    const res = await inject('GET', '/api/agent/manifest');
    const projects = (res.json().data as { projects: Array<Record<string, unknown>> }).projects;
    const demo = projects.find((p) => p['diskName'] === 'demo');
    expect(demo).toBeDefined();
    expect(demo).toMatchObject({
      name: 'demo',
      alias: null,
      dirPath: projDir,
      tags: ['前端'],
      collections: ['主力项目'],
    });
  });
});

describe('GET /api/agent/projects/:id/context（受控读取）', () => {
  it('未持 token 401；不存在项目 404', async () => {
    expect((await inject('GET', '/api/agent/projects/nope/context', { withToken: false })).statusCode).toBe(
      401,
    );
    const res = await inject('GET', '/api/agent/projects/nope/context');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('头部注入 ttFolio 管理声明与发现端点，正文复用上下文包', async () => {
    const db = ctx.db();
    const pid = (db.prepare('SELECT id FROM projects WHERE disk_name = ?').get('demo') as { id: string }).id;
    const res = await inject('GET', `/api/agent/projects/${pid}/context`);
    expect(res.json().ok).toBe(true);
    const text = res.json().data as string;
    expect(text).toContain('本项目由 ttFolio 管理');
    expect(text).toContain('/api/agent/manifest');
    expect(text).toContain('# 项目上下文包');
    expect(text).toContain('- 路径：');
  });
});

describe('x-ttfolio-actor 经 HTTP 贯通审计', () => {
  it('带合法 actor 的登记操作在审计日志落 agent 身份', async () => {
    const dir2 = path.join(root, 'demo2');
    fs.mkdirSync(dir2, { recursive: true });
    const res = await inject('POST', '/api/projects', { body: { paths: [dir2] }, actor: 'claude-code' });
    expect(res.json().ok).toBe(true);

    const act = await inject('GET', '/api/activity?limit=5');
    const entries = act.json().data as Array<{ kind: string; actor: string }>;
    const add = entries.find((e) => e.kind === 'project.add');
    expect(add).toBeDefined();
    expect(add?.actor).toBe('claude-code');
  });

  it('actor 头不合法（冒充 local）→ 400，且不落任何数据', async () => {
    const res = await inject('POST', '/api/projects', { body: { paths: [] }, actor: 'local' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
  });
});

describe('runtime.json agent 发现段', () => {
  it('写入后可直接读回（宽容 JSON，老读方不受影响）', () => {
    const file = path.join(root, 'runtime.json');
    writeRuntime(file, {
      pid: 1,
      port,
      token,
      version: '0.0.0-test',
      startedAt: new Date().toISOString(),
      agent: { protocolVersion: 1, apiBase: `http://127.0.0.1:${port}`, manifest: '/api/agent/manifest' },
    });
    const rt = readRuntime(file);
    expect(rt).not.toBeNull();
    const agent = rt?.['agent'] as Record<string, unknown> | undefined;
    expect(agent?.['manifest']).toBe('/api/agent/manifest');
    expect(rt?.['port']).toBe(port);
  });
});

describe('资源仓库会话路由（FR-13.3 / T-097）', () => {
  it('start → agent 提交精华（带 actor）→ 查询列表 → stop → 文件清单', async () => {
    const db = ctx.db();
    const pid = (db.prepare('SELECT id FROM projects WHERE disk_name = ?').get('demo') as { id: string }).id;
    // 开启仓库开关（经项目 PATCH）
    const detail = await inject('GET', `/api/projects/${pid}`);
    const rev = (detail.json().data as { rev: number }).rev;
    const patchRes = await inject('PATCH', `/api/projects/${pid}`, {
      body: { rev, agentRepoEnabled: true },
    });
    expect(patchRes.json().ok).toBe(true);

    // manifest 能力表带上会话端点
    const caps = (
      (await inject('GET', '/api/agent/manifest')).json().data as {
        capabilities: Record<string, string>;
      }
    ).capabilities;
    expect(caps['agentSessionSummary']).toContain('/api/agent/sessions/{sessionId}/summary');

    // start（带 actor）
    const startRes = await inject('POST', `/api/agent/projects/${pid}/sessions`, {
      body: {},
      actor: 'claude-code',
    });
    expect(startRes.json().ok).toBe(true);
    const session = startRes.json().data as { id: string; actor: string; endedAt: string | null };
    expect(session.actor).toBe('claude-code');
    expect(session.endedAt).toBeNull();

    // 重复 start 被拒
    const dup = await inject('POST', `/api/agent/projects/${pid}/sessions`, { body: {} });
    expect(dup.json()).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });

    // agent 提交精华
    const sum = await inject('POST', `/api/agent/sessions/${session.id}/summary`, {
      body: { summary: '完成登录重构' },
      actor: 'claude-code',
    });
    expect((sum.json().data as { summary: string | null }).summary).toBe('完成登录重构');

    // 列表可见 active 会话与文件清单（空）
    const listRes = await inject('GET', `/api/agent/projects/${pid}/sessions`);
    const listData = listRes.json().data as {
      enabled: boolean;
      active: { id: string } | null;
      sessions: Array<{ id: string; fileCount: number }>;
    };
    expect(listData.enabled).toBe(true);
    expect(listData.active?.id).toBe(session.id);
    expect(listData.sessions[0]?.fileCount).toBe(0);
    const filesRes = await inject('GET', `/api/agent/sessions/${session.id}/files`);
    expect(filesRes.json().data).toEqual([]);

    // 审计带 actor（project.add 已在上一组用例验证；此处验证 agent.session.summary）
    const act = await inject('GET', '/api/activity?limit=5');
    const entries = act.json().data as Array<{ kind: string }>;
    expect(entries.some((e) => e.kind === 'agent.session.summary')).toBe(true);

    // stop 后 active 清空
    await inject('POST', `/api/agent/sessions/${session.id}/stop`, { body: {} });
    const after = await inject('GET', `/api/agent/projects/${pid}/sessions`).then(
      (r) => r.json().data as { active: unknown },
    );
    expect(after.active).toBeNull();
  });

  it('会话不存在 → 404；summary 超长 → 400', async () => {
    expect((await inject('POST', '/api/agent/sessions/nope/stop', { body: {} })).statusCode).toBe(404);
    const res404 = await inject('POST', '/api/agent/sessions/nope/summary', { body: { summary: 'x' } });
    expect(res404.json()).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    const res400 = await inject('POST', '/api/agent/sessions/nope/summary', {
      body: { summary: 'x'.repeat(8001) },
    });
    expect(res400.json()).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
  });
});
