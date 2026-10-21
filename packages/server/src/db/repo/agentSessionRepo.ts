/** 资源仓库会话仓储（FR-13.3 / T-097，EN-7：SQL 收敛于此）。
 * 只记「文件路径与时间」，不快照内容；ended_at 为 NULL 即记录中。 */
import type Database from 'better-sqlite3';
import { getAll, getOne, run } from '../sql.js';
import { ulid } from '../../core/ulid.js';
import type { AgentSessionFileRow, AgentSessionRow } from '../rowTypes.js';
import type { AgentRepoSession, AgentRepoSessionFile } from '@ttfolio/shared';

function mapSession(r: AgentSessionRow, fileCount: number): AgentRepoSession {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    actor: r.actor,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    summary: r.summary,
    fileCount,
  };
}

export function mapSessionFile(r: AgentSessionFileRow): AgentRepoSessionFile {
  return {
    path: r.path,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    changeCount: r.change_count,
  };
}

export function getAgentRepoEnabled(db: Database.Database, projectId: string): boolean {
  const row = getOne<{ agent_repo_enabled: number }>(
    db,
    'SELECT agent_repo_enabled FROM projects WHERE id = ? AND deleted_at IS NULL',
    [projectId],
  );
  return row?.agent_repo_enabled === 1;
}

export function setAgentRepoEnabled(db: Database.Database, projectId: string, enabled: boolean): void {
  run(db, 'UPDATE projects SET agent_repo_enabled = ?, updated_at = ? WHERE id = ?', [
    enabled ? 1 : 0,
    new Date().toISOString(),
    projectId,
  ]);
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
): AgentRepoSession {
  const id = ulid();
  const now = new Date().toISOString();
  run(
    db,
    'INSERT INTO agent_sessions (id, project_id, title, actor, started_at, ended_at, summary) VALUES (?, ?, NULL, ?, ?, NULL, NULL)',
    [id, projectId, actor, now],
  );
  const s = getAgentSession(db, id);
  if (s === null) throw new Error('start agent session failed');
  return s;
}

/** 结束记录：写 ended_at。已结束的会话重复结束幂等返回原样。 */
export function stopAgentSession(db: Database.Database, id: string): AgentRepoSession | null {
  const cur = getAgentSession(db, id);
  if (cur === null || cur.endedAt !== null) return cur;
  run(db, 'UPDATE agent_sessions SET ended_at = ? WHERE id = ?', [new Date().toISOString(), id]);
  return getAgentSession(db, id);
}

export function patchAgentSession(
  db: Database.Database,
  id: string,
  fields: { title?: string; summary?: string },
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
  if (sets.length > 0) {
    values.push(id);
    run(db, `UPDATE agent_sessions SET ${sets.join(', ')} WHERE id = ?`, values);
  }
  return getAgentSession(db, id);
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

/** 批量版：一次会话查询 + 事务内逐条 upsert（watcher flush 每次最多几十条）。 */
export function recordSessionFileChanges(
  db: Database.Database,
  projectId: string,
  relPaths: string[],
  at: string,
): void {
  if (relPaths.length === 0) return;
  const s = getOne<{ id: string }>(
    db,
    'SELECT id FROM agent_sessions WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
    [projectId],
  );
  if (s === undefined) return;
  const upsert = db.prepare(
    `INSERT INTO agent_session_files (session_id, path, first_seen_at, last_seen_at, change_count)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(session_id, path) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       change_count = change_count + 1`,
  );
  db.transaction(() => {
    for (const p of relPaths) upsert.run(s.id, p, at, at);
  })();
}
