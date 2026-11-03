/** 统计面板（FR-15.3 / T-144，2026-11-03 用户点名 C 组）：
 *  GET /api/stats/overview —— 现表聚合零迁移（语言分布/打开频率/提交活跃/体量分布/覆盖度）。
 *  项目 ≤1000 量级内存聚合无压力；口径与卡片墙/活动页一致（active 集合）。 */
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context.js';
import { ok } from './helpers.js';
import { listProjects, listCollections } from '../db/repo/projectsRepo.js';
import type { StatsOverview } from '@ttfolio/shared';

export const statsRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  app.get('/api/stats/overview', async () => {
    const db = ctx.db();
    const projects = listProjects(db, { status: 'active' });
    const total = projects.length;
    const emptyWeekly = [
      { label: '3 周前', count: 0 },
      { label: '2 周前', count: 0 },
      { label: '上周', count: 0 },
      { label: '本周', count: 0 },
    ];
    const emptySizeBuckets = [
      { label: '<1MB', count: 0 },
      { label: '1–10MB', count: 0 },
      { label: '10–100MB', count: 0 },
      { label: '≥100MB', count: 0 },
    ];
    if (total === 0) {
      return ok<StatsOverview>({
        totalProjects: 0,
        languages: [],
        openTop: [],
        weeklyCommits: emptyWeekly,
        sizeBuckets: emptySizeBuckets,
        coverage: { total: 0, unassigned: 0, noTags: 0, archived: 0 },
      });
    }

    // 语言分布：language_stats 全表聚合（跨项目求和），前 12 + 其他合并
    const langRows = db
      .prepare<[], { language: string; b: number }>(
        'SELECT language, SUM(bytes) AS b FROM language_stats GROUP BY language ORDER BY b DESC',
      )
      .all();
    const langTotal = langRows.reduce((s, r) => s + r.b, 0);
    const top = langRows.slice(0, 12);
    const restBytes = langRows.slice(12).reduce((s, r) => s + r.b, 0);
    const languages = [
      ...top.map((r) => ({
        language: r.language,
        bytes: r.b,
        share: langTotal > 0 ? r.b / langTotal : 0,
      })),
      ...(restBytes > 0
        ? [{ language: '其他', bytes: restBytes, share: langTotal > 0 ? restBytes / langTotal : 0 }]
        : []),
    ];

    // 打开频率 Top 8
    const openTop = projects
      .filter((p) => p.openCount > 0)
      .sort((a, b) => b.openCount - a.openCount)
      .slice(0, 8)
      .map((p) => ({ id: p.id, name: p.alias ?? p.diskName, openCount: p.openCount }));

    // 近 28 天提交活跃按 7 天分 4 桶（gitLastCommitAt 为 ISO 串）
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const buckets = [0, 0, 0, 0];
    const bump = (i: number): void => {
      const cur = buckets[i];
      if (cur !== undefined) buckets[i] = cur + 1;
    };
    for (const p of projects) {
      if (p.gitLastCommitAt === null) continue;
      const t = Date.parse(p.gitLastCommitAt);
      if (!Number.isFinite(t)) continue;
      const daysAgo = Math.floor((now - t) / DAY);
      if (daysAgo < 0)
        bump(3); // 未来时间戳（时钟偏差）归入最近桶
      else if (daysAgo < 28) bump(3 - Math.floor(daysAgo / 7));
    }
    const weeklyCommits = [
      { label: '3 周前', count: buckets[0] ?? 0 },
      { label: '2 周前', count: buckets[1] ?? 0 },
      { label: '上周', count: buckets[2] ?? 0 },
      { label: '本周', count: buckets[3] ?? 0 },
    ];

    // 体量分布 4 桶（sizeBytes 为项目目录实测字节数）
    const MB = 1024 * 1024;
    const sizeBuckets = emptySizeBuckets.map((b) => ({ ...b }));
    for (const p of projects) {
      const idx = p.sizeBytes < MB ? 0 : p.sizeBytes < 10 * MB ? 1 : p.sizeBytes < 100 * MB ? 2 : 3;
      const cur = sizeBuckets[idx];
      if (cur !== undefined) cur.count += 1;
    }

    // 组织覆盖度：未入集合 / 无标签 / 已归档
    const cols = listCollections(db);
    const memberIds = new Set(cols.flatMap((c) => c.projectIds));
    const unassigned = projects.filter((p) => !memberIds.has(p.id)).length;
    const noTags =
      db
        .prepare<[], { c: number }>(
          'SELECT COUNT(*) AS c FROM projects p WHERE p.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM project_tags pt WHERE pt.project_id = p.id)',
        )
        .get()?.c ?? 0;
    const archived =
      db
        .prepare<[], { c: number }>(
          'SELECT COUNT(*) AS c FROM projects WHERE deleted_at IS NULL AND is_archived = 1',
        )
        .get()?.c ?? 0;

    return ok<StatsOverview>({
      totalProjects: total,
      languages,
      openTop,
      weeklyCommits,
      sizeBuckets,
      coverage: { total, unassigned, noTags, archived },
    });
  });
};
