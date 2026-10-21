/** Agent 发现与受控读取接口（FR-13.1 / T-095）+ 资源仓库会话（FR-13.3 / T-097）。
 * 写通道零新增：agent 携 token + x-ttfolio-actor 头直调既有业务接口，
 * 审计自动落 agent 身份（app.ts 鉴权钩子 + core/actor.ts）。 */
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context.js';
import { ok, fail } from './helpers.js';
import { listProjects, getProjectSummary, listCollections, getProjectRow } from '../db/repo/projectsRepo.js';
import { buildContextPacket } from './contract.js';
import {
  getAgentRepoEnabled,
  getAgentSession,
  listAgentSessions,
  listAgentSessionFiles,
  patchAgentSession,
  startAgentSession,
  stopAgentSession,
} from '../db/repo/agentSessionRepo.js';
import { logActivity } from '../db/repo/metaRepo.js';
import { currentActor } from '../core/actor.js';
import { agentSessionPatchSchema, agentSessionSummarySchema } from '@ttfolio/shared';
import type { AgentManifest } from '@ttfolio/shared';

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

  // ---- 资源仓库会话（FR-13.3 / T-097） ----

  app.get('/api/agent/projects/:id/sessions', async (req) => {
    const { id } = req.params as { id: string };
    const db = ctx.db();
    if (getProjectRow(db, id) === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    const sessions = listAgentSessions(db, id);
    const active = sessions.find((s) => s.endedAt === null) ?? null;
    return ok({ enabled: getAgentRepoEnabled(db, id), active, sessions });
  });

  app.post('/api/agent/projects/:id/sessions', async (req) => {
    const { id } = req.params as { id: string };
    const db = ctx.db();
    if (getProjectRow(db, id) === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    const existing = listAgentSessions(db, id).find((s) => s.endedAt === null);
    if (existing !== undefined) return fail('BAD_REQUEST', '该项目已有记录中的会话');
    const s = startAgentSession(db, id, currentActor().actor);
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
    const s = stopAgentSession(db, id);
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
    const s = patchAgentSession(db, id, { summary: parsed.data.summary });
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
