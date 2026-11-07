/** Agent 发现与受控读取接口（FR-13.1 / T-095）+ 资源仓库会话（FR-13.3 / T-097）。
 * 写通道零新增：agent 携 token + x-ttfolio-actor 头直调既有业务接口，
 * 审计自动落 agent 身份（app.ts 鉴权钩子 + core/actor.ts）。 */
import type { FastifyPluginAsync } from 'fastify';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { ok, fail } from './helpers.js';
import { listProjects, getProjectSummary, listCollections, getProjectRow } from '../db/repo/projectsRepo.js';
import { buildContextPacket } from './contract.js';
import {
  getAgentRepoEnabled,
  getAgentSession,
  getGlobalRepoMode,
  getProjectRepoMode,
  listAgentSessions,
  listAgentSessionFiles,
  patchAgentSession,
  setAgentRepoMode,
  startAgentSession,
} from '../db/repo/agentSessionRepo.js';
import { closeSessionWithSummary } from '../core/sessionSummary.js';
import { readSnapshot } from '../core/snapshots.js';
import { headHash } from '../core/git.js';
import { logActivity, getSetting } from '../db/repo/metaRepo.js';
import { currentActor } from '../core/actor.js';
import { listChanges } from '../core/changes.js';
import { listTodos } from '../db/repo/sessionRepo.js';
import { agentSessionPatchSchema, agentSessionSummarySchema } from '@ttfolio/shared';
import type { AgentManifest } from '@ttfolio/shared';

/** 默认交接单模板（FR-16.3 / T-134）；自定义模板存 settings 键 handoff_templates_json */
const DEFAULT_HANDOFF_TEMPLATE = `# 交接单：{{project}}

## 速览
- 路径：{{path}}
- 类型 / 主语言 / 技术栈：{{type}} / {{language}} / {{stack}}
- Git：{{branch}}{{dirty}}
- 最后打开：{{lastOpened}}

## 归属
- 集合：{{collections}}
- 标签：{{tags}}

## 未完成清单（{{todoCount}}）
{{todos}}

## 最近变更（最近 {{changeCount}} 条）
{{recentChanges}}

## 备注
{{note}}
`;

function parseHandoffTemplates(raw: string | null): Array<{ id: string; name: string; body: string }> {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is { id: string; name: string; body: string } =>
          t !== null &&
          typeof t === 'object' &&
          typeof (t as { id?: unknown }).id === 'string' &&
          typeof (t as { name?: unknown }).name === 'string' &&
          typeof (t as { body?: unknown }).body === 'string',
      )
      .slice(0, 10);
  } catch {
    return [];
  }
}

/** 占位符白名单渲染：未知/缺失值渲染为空并附「缺失」标记（FR-16.3 验收） */
function renderHandoff(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = values[key];
    return v !== undefined && v !== '' ? v : `（缺失：${key}）`;
  });
}

/** 能力端点表：只列既有真实端点（含真实参数名），给 agent 一张可靠的地图。 */
function capabilityTable(): Record<string, string> {
  return {
    projectsList: 'GET /api/projects',
    projectSummary: 'GET /api/projects/{id}',
    projectContext: 'GET /api/agent/projects/{id}/context',
    projectAnalyze: 'POST /api/projects/{id}/analyze',
    fileTree: 'GET /api/fs/tree?projectId={id}&path={path}',
    fileRead: 'GET /api/fs/file?projectId={id}&path={path}',
    gitStatus: 'GET /api/git/{id}/status',
    gitDiff: 'GET /api/git/{id}/diff?path={path}',
    gitLog: 'GET /api/git/{id}/log?limit=50',
    search: 'GET /api/search?q={q}&scope=all',
    todos: 'GET /api/todos',
    // 资源仓库会话（FR-13.3）：开启记录 / 提交精华（需项目开启资源仓库）
    agentSessions: 'GET /api/agent/projects/{id}/sessions',
    agentSessionStart: 'POST /api/agent/projects/{id}/sessions',
    agentSessionSummary: 'POST /api/agent/sessions/{sessionId}/summary',
  };
}

export const agentRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  app.get('/api/agent/manifest', async () => {
    const db = ctx.db();
    const colNames = new Map(listCollections(db).map((c) => [c.id, c.name]));
    const projects = listProjects(db, { status: 'all' }).map((p) => ({
      id: p.id,
      name: p.alias ?? p.diskName,
      alias: p.alias,
      diskName: p.diskName,
      dirPath: p.dirPath,
      tags: p.tags,
      collections: p.collections.map((cid) => colNames.get(cid) ?? cid),
    }));
    const manifest: AgentManifest = {
      service: 'ttFolio',
      version: ctx.version,
      protocolVersion: 1,
      apiBase: `http://127.0.0.1:${ctx.port}`,
      capabilities: capabilityTable(),
      projects,
    };
    return ok(manifest);
  });

  app.get('/api/agent/projects/:id/context', async (req) => {
    const { id } = req.params as { id: string };
    const db = ctx.db();
    const p = getProjectSummary(db, id);
    if (p === null) return fail('NOT_FOUND', '项目不存在', 404);
    const packet = buildContextPacket(db, id);
    if (packet === null) return fail('NOT_FOUND', '项目不存在', 404);
    const header = [
      `> 本项目由 ttFolio 管理（本地项目工作台）：磁盘是真相，本包只是索引快照。`,
      `> Agent 发现：GET http://127.0.0.1:${ctx.port}/api/agent/manifest（服务地址与 token 见数据目录 runtime.json）。`,
      ``,
    ].join('\n');
    return ok(`${header}${packet}`);
  });

  // ---- 交接单（FR-16.3 / T-134）：Markdown 附件，模板可自定义（settings 键
  // handoff_templates_json ≤10 条）；只读聚合绝不写项目文件；占位符缺失渲染
  // 「（缺失：key）」标记。----
  app.get('/api/agent/projects/:id/handoff', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { template?: string };
    const db = ctx.db();
    const p = getProjectSummary(db, id);
    if (p === null) return fail('NOT_FOUND', '项目不存在', 404);
    const todos = listTodos(db, { projectId: id, includeDone: false });
    const changes = listChanges(db, id, { limit: 10 });
    const colNames = listCollections(db)
      .filter((c) => c.projectIds.includes(id))
      .map((c) => c.name);
    const row = getProjectRow(db, id);
    const values: Record<string, string> = {
      project: p.alias ?? p.diskName,
      path: p.dirPath,
      type: String(p.type),
      language: p.primaryLanguage ?? '',
      stack: p.techStack.length > 0 ? p.techStack.join('、') : '',
      branch: row?.git_is_repo === 1 ? (row.git_branch ?? '（无提交）') : '非 git 仓库',
      dirty: row?.git_is_repo === 1 && row.git_dirty === 1 ? '（有未提交改动）' : '（工作区干净）',
      lastOpened: p.lastOpenedAt === null ? '从未打开' : new Date(p.lastOpenedAt).toLocaleString('zh-CN'),
      collections: colNames.length > 0 ? colNames.join('、') : '（无）',
      tags: p.tags.length > 0 ? p.tags.join('、') : '（无）', // tags 为 string[]
      todoCount: String(todos.length),
      todos:
        todos.length > 0
          ? todos.map((t) => `- [ ] ${t.title}${t.dueOn !== null ? `（截止 ${t.dueOn}）` : ''}`).join('\n')
          : '（无未完成项）',
      changeCount: String(changes.length),
      recentChanges:
        changes.length > 0
          ? changes
              .map(
                (c) =>
                  `- ${c.kind} ${c.path}（${c.source}，${new Date(c.firstAt ?? Date.now()).toLocaleString('zh-CN')}）`,
              )
              .join('\n')
          : '（暂无变更记录）',
      note: p.notes ?? '（无备注）',
    };
    const templates = parseHandoffTemplates(getSetting(db, 'handoff_templates_json'));
    const tpl = q.template !== undefined ? templates.find((t) => t.id === q.template) : undefined;
    const markdown = renderHandoff(tpl !== undefined ? tpl.body : DEFAULT_HANDOFF_TEMPLATE, values);
    logActivity(db, {
      kind: 'agent.handoff_export',
      level: 'L1',
      projectId: id,
      actor: currentActor().actor,
      detail: { template: tpl?.id ?? 'default' },
    });
    reply.header('content-type', 'text/markdown; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="ttfolio-handoff.md"');
    return reply.send(markdown);
  });

  // ---- 资源仓库会话（FR-13.3 / T-097） ----

  app.get('/api/agent/projects/:id/sessions', async (req) => {
    const { id } = req.params as { id: string };
    const db = ctx.db();
    if (getProjectRow(db, id) === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    const sessions = listAgentSessions(db, id);
    const active = sessions.find((s) => s.endedAt === null) ?? null;
    return ok({
      enabled: getAgentRepoEnabled(db, id),
      mode: getProjectRepoMode(db, id),
      globalMode: getGlobalRepoMode(db),
      active,
      sessions,
    });
  });

  // 项目三态开关（FR-13.3 v2 / T-112）：null = 跟随全局
  app.patch('/api/agent/projects/:id/mode', async (req) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { mode?: unknown };
    const mode = b.mode === 'on' || b.mode === 'off' ? b.mode : null;
    const db = ctx.db();
    if (getProjectRow(db, id) === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    setAgentRepoMode(db, id, mode);
    logActivity(db, {
      kind: 'agent.repo.mode',
      level: 'L1',
      projectId: id,
      detail: { mode: mode ?? 'follow' },
      actor: currentActor().actor,
    });
    return ok({ mode: getProjectRepoMode(db, id), enabled: getAgentRepoEnabled(db, id) });
  });

  // 可选快照层内容读取（FR-13.3 v2；默认关时 404）
  app.get('/api/agent/snapshots/:projectId/:sha', async (req) => {
    const { projectId, sha } = req.params as { projectId: string; sha: string };
    const content = readSnapshot(path.join(ctx.layout.dataDir, 'snapshots'), projectId, sha);
    if (content === null) return fail('NOT_FOUND', '快照不存在（或快照层未开启）', 404);
    return ok({ content });
  });

  app.post('/api/agent/projects/:id/sessions', async (req) => {
    const { id } = req.params as { id: string };
    const db = ctx.db();
    const row = getProjectRow(db, id);
    if (row === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    const existing = listAgentSessions(db, id).find((s) => s.endedAt === null);
    if (existing !== undefined) return fail('BAD_REQUEST', '该项目已有记录中的会话');
    // 起点 HEAD 作摘要的 ±行基线（非 git 为 null，诚实降级）
    const startHead = row.git_is_repo === 1 ? await headHash(row.dir_path) : null;
    const s = startAgentSession(db, id, currentActor().actor, { startHead });
    logActivity(db, {
      kind: 'agent.session.start',
      level: 'L1',
      projectId: id,
      detail: { sessionId: s.id },
    });
    return ok(s);
  });

  app.post('/api/agent/sessions/:id/stop', async (req) => {
    const { id } = req.params as { id: string };
    const db = ctx.db();
    const before = getAgentSession(db, id);
    if (before === null) return fail('NOT_FOUND', '会话不存在', 404);
    // 结束即生成自动摘要（FR-13.3 v2：MUST NOT 调 AI；用户/agent 已写过的摘要不覆盖）
    await closeSessionWithSummary(db, id);
    const s = getAgentSession(db, id);
    logActivity(db, {
      kind: 'agent.session.stop',
      level: 'L1',
      projectId: before.projectId,
      detail: { sessionId: id },
    });
    return ok(s);
  });

  app.patch('/api/agent/sessions/:id', async (req) => {
    const { id } = req.params as { id: string };
    const parsed = agentSessionPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const db = ctx.db();
    const before = getAgentSession(db, id);
    if (before === null) return fail('NOT_FOUND', '会话不存在', 404);
    const s = patchAgentSession(db, id, {
      title: parsed.data.title ?? undefined,
      summary: parsed.data.summary ?? undefined,
      // 用户手改过 → summary_source=user，此后自动摘要不再覆盖
      summarySource: parsed.data.summary !== undefined ? 'user' : undefined,
    });
    logActivity(db, {
      kind: 'agent.session.patch',
      level: 'L1',
      projectId: before.projectId,
      detail: { sessionId: id, fields: Object.keys(parsed.data) },
    });
    return ok(s);
  });

  /** agent 提交精华（FR-13.3 双写入口之二）：与用户手填同一存储，actor 随审计。 */
  app.post('/api/agent/sessions/:id/summary', async (req) => {
    const { id } = req.params as { id: string };
    const parsed = agentSessionSummarySchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const db = ctx.db();
    const before = getAgentSession(db, id);
    if (before === null) return fail('NOT_FOUND', '会话不存在', 404);
    const s = patchAgentSession(db, id, {
      summary: parsed.data.summary,
      summarySource: 'agent',
    });
    logActivity(db, {
      kind: 'agent.session.summary',
      level: 'L1',
      projectId: before.projectId,
      detail: { sessionId: id },
    });
    return ok(s);
  });

  app.get('/api/agent/sessions/:id/files', async (req) => {
    const { id } = req.params as { id: string };
    if (getAgentSession(ctx.db(), id) === null) return fail('NOT_FOUND', '会话不存在', 404);
    return ok(listAgentSessionFiles(ctx.db(), id));
  });
};
