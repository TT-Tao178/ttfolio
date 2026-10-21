/** 资源仓库会话仓储（FR-13.3 / T-097，EN-7：SQL 收敛于此）。
 * 只记「文件路径与时间」，不快照内容；ended_at 为 NULL 即记录中。 */
import type Database from 'better-sqlite3';
import { getAll, getOne, run } from '../sql.js';
import { ulid } from '../../core/ulid.js';
import type { AgentSessionFileRow, AgentSessionRow } from '../rowTypes.js';
import type { AgentRepoMode, AgentRepoSession, AgentRepoSessionFile } from '@ttfolio/shared';

function mapSession(r: AgentSessionRow, fileCount: number): AgentRepoSession {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    actor: r.actor,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    summary: r.summary,
    summarySource:
      r.summary_source === 'auto' || r.summary_source === 'user' || r.summary_source === 'agent'
        ? r.summary_source
        : null,
    auto: r.auto === 1,
    startHead: r.start_head,
    fileCount,
  };
}

export function mapSessionFile(r: AgentSessionFileRow): AgentRepoSessionFile {
  return {
    path: r.path,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    changeCount: r.change_count,
    firstSha: r.first_sha,
    latestSha: r.latest_sha,
  };
}

export function getAgentRepoEnabled(db: Database.Database, projectId: string): boolean {
  return isRepoRecordingEnabled(db, projectId);
}

/** 全局记录模式（FR-13.3 v2）：on（默认）| off；未设置按 on。 */
export function getGlobalRepoMode(db: Database.Database): 'on' | 'off' {
  const row = getOne<{ value: string | null }>(
    db,
    "SELECT value FROM settings WHERE key = 'agent_repo_mode'",
  );
  return row?.value === 'off' ? 'off' : 'on';
}

/** 项目三态（follow/on/off）；未设置 = follow。 */
export function getProjectRepoMode(db: Database.Database, projectId: string): AgentRepoMode {
  const row = getOne<{ agent_repo_mode: string | null }>(
    db,
    'SELECT agent_repo_mode FROM projects WHERE id = ? AND deleted_at IS NULL',
    [projectId],
  );
  const m = row?.agent_repo_mode;
  return m === 'on' || m === 'off' ? m : 'follow';
}

/** 有效开关：项目强制 off → 关；强制 on → 开；follow → 跟随全局。 */
export function isRepoRecordingEnabled(db: Database.Database, projectId: string): boolean {
  const m = getProjectRepoMode(db, projectId);
  if (m === 'off') return false;
  if (m === 'on') return true;
  return getGlobalRepoMode(db) === 'on';
}

/** 写项目三态；null = 恢复 follow。旧 agent_repo_enabled 同步（兼容旧读点）。 */
export function setAgentRepoMode(db: Database.Database, projectId: string, mode: AgentRepoMode | null): void {
  const now = new Date().toISOString();
  run(db, 'UPDATE projects SET agent_repo_mode = ?, updated_at = ? WHERE id = ?', [mode, now, projectId]);
  const enabled = mode === 'on' ? 1 : mode === 'off' ? 0 : isRepoRecordingEnabled(db, projectId) ? 1 : 0;
  run(db, 'UPDATE projects SET agent_repo_enabled = ? WHERE id = ?', [enabled, projectId]);
}

export function setAgentRepoEnabled(db: Database.Database, projectId: string, enabled: boolean): void {
  setAgentRepoMode(db, projectId, enabled ? 'on' : 'off');
}

function fileCountOf(db: Database.Database, sessionId: string): number {
  const c = getOne<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM agent_session_files WHERE session_id = ?', [
    sessionId,
  ]);
  return c?.c ?? 0;
}

export function getAgentSession(db: Database.Database, id: string): AgentRepoSession | null {
  const r = getOne<AgentSessionRow>(db, 'SELECT * FROM agent_sessions WHERE id = ?', [id]);
  return r === undefined ? null : mapSession(r, fileCountOf(db, id));
}

/** 该项目当前记录中的会话（ended_at IS NULL）；没有则 null。 */
export function getActiveSession(db: Database.Database, projectId: string): AgentRepoSession | null {
  const r = getOne<AgentSessionRow>(
    db,
    'SELECT * FROM agent_sessions WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
    [projectId],
  );
  return r === undefined ? null : mapSession(r, fileCountOf(db, r.id));
}

export function startAgentSession(
  db: Database.Database,
  projectId: string,
  actor: string | null,
  opts: { auto?: boolean; startHead?: string | null } = {},
): AgentRepoSession {
  const id = ulid();
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO agent_sessions (id, project_id, title, actor, started_at, ended_at, summary, auto, summary_source, start_head)
     VALUES (?, ?, NULL, ?, ?, NULL, NULL, ?, NULL, ?)`,
    [id, projectId, actor, now, opts.auto === true ? 1 : 0, opts.startHead ?? null],
  );
  const s = getAgentSession(db, id);
  if (s === null) throw new Error('start agent session failed');
  return s;
}

/**
 * 自动会话（FR-13.3 v2）：无活动会话且项目有效开启记录时，为本项目开一段
 * auto 会话；已有活动会话（手动或自动）直接返回它。
 */
export function ensureAutoSession(
  db: Database.Database,
  projectId: string,
  actor: string | null,
  startHead: string | null,
): string | null {
  const s = getOne<{ id: string }>(
    db,
    'SELECT id FROM agent_sessions WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
    [projectId],
  );
  if (s !== undefined) return s.id;
  if (!isRepoRecordingEnabled(db, projectId)) return null;
  try {
    return startAgentSession(db, projectId, actor, { auto: true, startHead }).id;
  } catch {
    return null;
  }
}

/** 记录中的会话（含 auto 标记与末次文件时间），供空闲/跨日自动收尾判定。 */
export function listActiveSessions(
  db: Database.Database,
): Array<{ id: string; projectId: string; startedAt: string; auto: boolean; lastActivityAt: string }> {
  const rows = getAll<{
    id: string;
    project_id: string;
    started_at: string;
    auto: number;
    last_activity_at: string | null;
  }>(
    db,
    `SELECT s.id, s.project_id, s.started_at, s.auto,
            (SELECT MAX(f.last_seen_at) FROM agent_session_files f WHERE f.session_id = s.id) AS last_activity_at
     FROM agent_sessions s WHERE s.ended_at IS NULL`,
  );
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    startedAt: r.started_at,
    auto: r.auto === 1,
    lastActivityAt: r.last_activity_at ?? r.started_at,
  }));
}

/**
 * 结束记录：写 ended_at。已结束的会话重复结束幂等返回原样。
 * summarySource 供自动摘要标记来源（auto）；用户/agent 写入走 patchAgentSession 的显式参数。
 */
export function stopAgentSession(
  db: Database.Database,
  id: string,
  summarySource?: 'auto' | 'user' | 'agent',
): AgentRepoSession | null {
  const cur = getAgentSession(db, id);
  if (cur === null || cur.endedAt !== null) return cur;
  if (summarySource !== undefined) {
    run(
      db,
      'UPDATE agent_sessions SET ended_at = ?, summary_source = COALESCE(summary_source, ?) WHERE id = ?',
      [new Date().toISOString(), summarySource, id],
    );
  } else {
    run(db, 'UPDATE agent_sessions SET ended_at = ? WHERE id = ?', [new Date().toISOString(), id]);
  }
  return getAgentSession(db, id);
}

export function patchAgentSession(
  db: Database.Database,
  id: string,
  fields: { title?: string; summary?: string; summarySource?: 'auto' | 'user' | 'agent' },
): AgentRepoSession | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.title !== undefined) {
    sets.push('title = ?');
    values.push(fields.title === '' ? null : fields.title);
  }
  if (fields.summary !== undefined) {
    sets.push('summary = ?');
    values.push(fields.summary === '' ? null : fields.summary);
  }
  if (fields.summarySource !== undefined) {
    sets.push('summary_source = ?');
    values.push(fields.summarySource);
  }
  if (sets.length > 0) {
    values.push(id);
    run(db, `UPDATE agent_sessions SET ${sets.join(', ')} WHERE id = ?`, values);
  }
  return getAgentSession(db, id);
}

/** 自动摘要写入（FR-13.3 v2）：只覆盖 source 为 null/auto 的会话，用户/agent 写过的绝不覆盖。 */
export function writeAutoSummary(db: Database.Database, id: string, summary: string): boolean {
  const cur = getAgentSession(db, id);
  if (cur === null) return false;
  if (cur.summarySource === 'user' || cur.summarySource === 'agent') return false;
  patchAgentSession(db, id, { summary, summarySource: 'auto' });
  return true;
}

export function listAgentSessions(db: Database.Database, projectId: string): AgentRepoSession[] {
  const rows = getAll<AgentSessionRow>(
    db,
    'SELECT * FROM agent_sessions WHERE project_id = ? ORDER BY started_at DESC',
    [projectId],
  );
  return rows.map((r) => mapSession(r, fileCountOf(db, r.id)));
}

export function listAgentSessionFiles(db: Database.Database, sessionId: string): AgentRepoSessionFile[] {
  return getAll<AgentSessionFileRow>(
    db,
    'SELECT * FROM agent_session_files WHERE session_id = ? ORDER BY last_seen_at DESC',
    [sessionId],
  ).map(mapSessionFile);
}

/**
 * 记录一条文件变更到「记录中」的会话（watcher flush 处调用）。
 * 首见插入、再见更新末见与次数；无活动会话或项目未开启仓库时静默跳过——
 * 记录管道必须零成本跟随监听主链路，绝不因沉淀层故障影响 fs.changed 分发。
 */
export function recordSessionFileChange(
  db: Database.Database,
  projectId: string,
  relPath: string,
  at: string,
): void {
  recordSessionFileChanges(db, projectId, [relPath], at);
}

/**
 * 批量版：自动开会话（若开启记录且无活动会话）→ 一次会话查询 + 事务内逐条 upsert。
 * watcher/路由写操作都经 ChangeTracker 汇集到这里（FR-13.2 v2 / FR-13.3 v2）。
 * snapshots：path → {sha} 可选快照层结果（默认关时为空）。
 */
export function recordSessionFileChanges(
  db: Database.Database,
  projectId: string,
  relPaths: string[],
  at: string,
  snapshots?: Map<string, string>,
): void {
  if (relPaths.length === 0) return;
  ensureAutoSession(db, projectId, null, null);
  const s = getOne<{ id: string }>(
    db,
    'SELECT id FROM agent_sessions WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
    [projectId],
  );
  if (s === undefined) return;
  const upsert = db.prepare(
    `INSERT INTO agent_session_files (session_id, path, first_seen_at, last_seen_at, change_count, first_sha, latest_sha)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(session_id, path) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       change_count = change_count + 1,
       latest_sha = COALESCE(excluded.latest_sha, latest_sha)`,
  );
  db.transaction(() => {
    for (const p of relPaths) {
      const sha = snapshots?.get(p) ?? null;
      upsert.run(s.id, p, at, at, sha, sha);
    }
  })();
}
