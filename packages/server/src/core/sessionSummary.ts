/**
 * 自动会话收尾与自动摘要（FR-13.3 v2 / T-112）。
 *
 * 会话结束规则（仅 auto 会话）：空闲 15 分钟、跨自然日 0 点、应用退出。
 * 会话结束时按规则生成摘要（MUST NOT 调 AI）：时段与时长、文件数、±行
 * （git numstat，基线 = 会话起点 HEAD）、目录聚类 Top5、新增/删除文件、
 * 期间提交；非 git 项目诚实降级（只写路径与计数结论）。
 *
 * 用户编辑过的摘要（summary_source=user/agent）绝不被自动覆盖。
 */
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Logger } from './logger.js';
import {
  listActiveSessions,
  listAgentSessionFiles,
  getAgentSession,
  stopAgentSession,
  writeAutoSummary,
} from '../db/repo/agentSessionRepo.js';
import { getProjectRow } from '../db/repo/projectsRepo.js';
import { numstatSince, commitSubjectsBetween } from './git.js';

/** 空闲阈值：最后文件事件超过 15 分钟即收尾。 */
export const IDLE_CLOSE_MS = 15 * 60 * 1000;

function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function fmtDuration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${h} 小时` : `${h} 小时 ${rest} 分钟`;
}

/** 目录聚类：按相对路径首段统计（Top5）。 */
export function clusterDirs(paths: string[], top = 5): Array<{ dir: string; count: number }> {
  const m = new Map<string, number>();
  for (const p of paths) {
    const segs = p.split('/');
    const dir = segs.length > 1 ? (segs[0] ?? '') : '（根目录）';
    m.set(dir, (m.get(dir) ?? 0) + 1);
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .slice(0, top)
    .map(([dir, count]) => ({ dir, count }));
}

/** 组装摘要文本（纯函数部分可单测；git 部分由调用方注入结果）。 */
export function composeSummary(input: {
  startedAt: string;
  endedAt: string;
  files: Array<{ path: string; changeCount: number }>;
  git: { added: number; deleted: number; numstatFiles: number; commits: string[] } | null;
  isRepo: boolean;
}): string {
  const start = new Date(input.startedAt);
  const end = new Date(input.endedAt);
  const paths = input.files.map((f) => f.path);
  const dirs = clusterDirs(paths);
  const lines: string[] = [
    `时间段：${start.toLocaleString('zh-CN')} → ${end.toLocaleString('zh-CN')}（${fmtDuration(
      end.valueOf() - start.valueOf(),
    )}）`,
    `文件：${input.files.length} 个 · 变更事件 ${input.files.reduce((a, f) => a + f.changeCount, 0)} 次`,
  ];
  if (input.git !== null && input.git.numstatFiles > 0) {
    lines.push(`行数（相对会话起点 HEAD）：+${input.git.added} / −${input.git.deleted}`);
  } else if (input.isRepo) {
    lines.push('行数：相对会话起点无差异（可能尚未提交或改动已提交）');
  } else {
    lines.push('行数：非 git 项目，无法统计增删行');
  }
  if (dirs.length > 0) {
    lines.push(`目录分布：${dirs.map((d) => `${d.dir}（${d.count}）`).join('、')}`);
  }
  if (input.files.length > 0) {
    const top = [...input.files].sort((a, b) => b.changeCount - a.changeCount).slice(0, 8);
    lines.push(`主要文件：${top.map((f) => `${f.path}×${f.changeCount}`).join('、')}`);
  }
  if (input.git !== null && input.git.commits.length > 0) {
    lines.push(`期间提交：${input.git.commits.join('；')}`);
  }
  return lines.join('\n');
}

/** 结束一段会话并生成自动摘要；returns 是否写入。 */
export async function closeSessionWithSummary(db: Database.Database, sessionId: string): Promise<boolean> {
  const s = getAgentSession(db, sessionId);
  if (s === null) return false;
  const endedAt = s.endedAt ?? new Date().toISOString();
  const stopped = stopAgentSession(db, sessionId, 'auto');
  if (stopped === null) return false;
  const row = getProjectRow(db, s.projectId);
  const dirPath = row?.dir_path ?? '';
  const isRepo = row?.git_is_repo === 1;
  const files = listAgentSessionFiles(db, sessionId);
  let git: { added: number; deleted: number; numstatFiles: number; commits: string[] } | null = null;
  if (isRepo && dirPath !== '') {
    const startHead = s.startHead ?? null;
    const num = startHead !== null ? await numstatSince(dirPath, startHead, []) : null;
    const commits = await commitSubjectsBetween(dirPath, s.startedAt, endedAt);
    git = {
      added: num?.added ?? 0,
      deleted: num?.deleted ?? 0,
      numstatFiles: num?.files ?? 0,
      commits,
    };
  }
  const summary = composeSummary({
    startedAt: s.startedAt,
    endedAt,
    files: files.map((f) => ({ path: f.path, changeCount: f.changeCount })),
    git,
    isRepo,
  });
  return writeAutoSummary(db, sessionId, summary);
}

/**
 * 定时收尾（index.ts 每分钟调用）：空闲 15 分钟或跨自然日的 auto 会话自动结束
 * 并生成摘要；手动会话不动（保留用户「结束本段」的里程碑语义）。
 */
export async function autoCloseSessions(db: Database.Database, logger: Logger): Promise<number> {
  const now = new Date();
  const nowIso = now.toISOString();
  const today = localDayKey(nowIso);
  let closed = 0;
  for (const s of listActiveSessions(db)) {
    if (!s.auto) continue;
    const idle = now.valueOf() - Date.parse(s.lastActivityAt) > IDLE_CLOSE_MS;
    const crossDay = localDayKey(s.startedAt) !== today;
    if (!idle && !crossDay) continue;
    try {
      await closeSessionWithSummary(db, s.id);
      closed++;
    } catch (err) {
      logger.warn({
        mod: 'repo',
        msg: `auto close failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return closed;
}

/** 应用退出：结束所有 auto 会话（尽力而为，失败不阻塞退出）。 */
export async function closeAutoSessionsOnExit(db: Database.Database): Promise<void> {
  for (const s of listActiveSessions(db)) {
    if (!s.auto) continue;
    try {
      await closeSessionWithSummary(db, s.id);
    } catch {
      /* 退出路径忽略 */
    }
  }
}

/** 目录名（诊断/摘要展示用）：只取末段，避免把完整路径写进摘要。 */
export function baseNameOf(p: string): string {
  return path.basename(p);
}
