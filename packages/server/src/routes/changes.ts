/** 变更流水（FR-13.2 v2 / T-111）：动态页回读（since=seq 增量）。 */
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context.js';
import { ok, fail } from './helpers.js';
import { listChanges } from '../core/changes.js';

export const changesRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  app.get('/api/changes', async (req) => {
    const q = req.query as { projectId?: string; since?: string; limit?: string };
    if (q.projectId === undefined || q.projectId === '') return fail('BAD_REQUEST', '缺少 projectId');
    const limit = Math.min(Math.max(Number(q.limit ?? '300'), 1), 1000);
    const sinceNum = q.since !== undefined && q.since !== '' ? Number(q.since) : undefined;
    const since = sinceNum !== undefined && Number.isFinite(sinceNum) ? sinceNum : undefined;
    const events = listChanges(ctx.db(), q.projectId, { since, limit });
    return ok({ seq: events.length > 0 ? (events[events.length - 1]?.seq ?? 0) : (since ?? 0), events });
  });
};
