/**
 * 变更流水统一广播入口（FR-13.2 v2 / T-111）。
 *
 * 写入收敛：落库（change_event）→ 会话聚合（资源仓库）→ SSE 三连，一处完成；
 * 路由不再各自 sse.publish('fs.changed') 绕过（避免「页签里看得到、库里没有」）。
 *
 * 合并规则：同项目同路径 5 秒内再次变更 → 删旧行后插入新行（保留 first_at、
 * change_count 累加、id 前进）——保留自增 id 作回读游标语义（since=seq 不漏
 * 合并后的更新）。
 *
 * 边界：单批 > 200 路径降级为批次摘要（只落前 50 条样本，SSE 带 summarized
 * 与总数）；忽略规则命中由调用方（watcher）先行过滤；MUST NOT 写项目目录。
 */
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { SseHub } from './sse.js';
import type { Logger } from './logger.js';
import { ulid } from './ulid.js';
import { getAll, getOne, run } from '../db/sql.js';
import { currentActor } from './actor.js';
import { recordSessionFileChanges } from '../db/repo/agentSessionRepo.js';
import { storeSnapshot } from './snapshots.js';
import * as fsx from './fsx.js';

export type ChangeSource = 'watcher' | 'api' | 'agent';
export type ChangeKind = 'create' | 'update' | 'delete';

export interface ChangeEventInfo {
  seq: number;
  projectId: string;
  sessionId: string | null;
  burstId: string;
  path: string;
  kind: ChangeKind;
  firstAt: string;
  lastAt: string;
  changeCount: number;
  bytes: number | null;
  source: ChangeSource;
}

export interface PublishChangeInput {
  projectId: string;
  /** 项目内相对路径（正斜杠）；空数组 = 仅通知刷新（不落库） */
  relPaths: string[];
  kind: ChangeKind;
  /** 缺省按当前 actor 推断：agent 身份 → agent，否则 api */
  source?: ChangeSource;
  sessionId?: string | null;
}

/** 合并窗口：同项目同路径 5 秒内合并为一条（FR-13.2 v2）。 */
export const MERGE_WINDOW_MS = 5000;
/** 单批落库样本上限（超出计为 summarized）。 */
export const BATCH_SAMPLE_CAP = 50;
/** 热保留天数与全库行数硬上限。 */
export const CHANGE_KEEP_DAYS = 7;
export const CHANGE_MAX_ROWS = 200_000;

const KIND_OK = new Set<ChangeKind>(['create', 'update', 'delete']);

export class ChangeTracker {
  /** 项目根缓存（rel → abs 反算用；项目路径变更后旧值不影响正确性——事件仍按 rel 落库） */
  private roots = new Map<string, string>();

  constructor(
    private readonly getDb: () => Database.Database,
    private readonly sse: SseHub,
    private readonly logger: Logger,
    /** 可选快照层根（dataDir/snapshots）；缺省 = 快照功能关闭 */
    private readonly snapshotsRoot: string | null = null,
  ) {}

  /** 项目根缓存失效（登记/重定位/移除时调用）。 */
  invalidateRoot(projectId?: string): void {
    if (projectId === undefined) this.roots.clear();
    else this.roots.delete(projectId);
  }

  /** 快照开关（settings.agent_repo_snapshots，默认关；每次读库，改设置立即生效）。 */
  private snapshotEnabled(): boolean {
    const row = getOne<{ value: string | null }>(
      this.getDb(),
      "SELECT value FROM settings WHERE key = 'agent_repo_snapshots'",
    );
    return row?.value === '1';
  }

  /** 自动会话的起点 HEAD 异步补记（首个变更开启会话时 HEAD 尚未取到）。 */
  private captureStartHead(projectId: string, sessionId: string): void {
    const row = getOne<{ git_is_repo: number; dir_path: string }>(
      this.getDb(),
      'SELECT git_is_repo, dir_path FROM projects WHERE id = ?',
      [projectId],
    );
    if (row?.git_is_repo !== 1) return;
    void import('./git.js')
      .then((m) => m.headHash(row.dir_path))
      .then((head) => {
        if (head === null) return;
        run(this.getDb(), 'UPDATE agent_sessions SET start_head = ? WHERE id = ? AND start_head IS NULL', [
          head,
          sessionId,
        ]);
      })
      .catch(() => {
        /* 基线取不到不影响记录（摘要诚实降级） */
      });
  }

  private rootOf(projectId: string): string {
    const cached = this.roots.get(projectId);
    if (cached !== undefined) return cached;
    const row = getOne<{ dir_path: string }>(this.getDb(), 'SELECT dir_path FROM projects WHERE id = ?', [
      projectId,
    ]);
    const root = row?.dir_path ?? '';
    this.roots.set(projectId, root);
    return root;
  }

  /**
   * 记录一批变更并广播。返回本次落库的事件（SSE 与回读同源）。
   * 落库/会话聚合异常只记日志，绝不影响 SSE 实时链路。
   */
  publish(input: PublishChangeInput): ChangeEventInfo[] {
    const db = this.getDb();
    const kind: ChangeKind = KIND_OK.has(input.kind) ? input.kind : 'update';
    const source: ChangeSource = input.source ?? (currentActor().actor !== 'local' ? 'agent' : 'api');
    const burstId = ulid();
    const nowIso = new Date().toISOString();
    const root = this.rootOf(input.projectId);
    const summarized = input.relPaths.length > BATCH_SAMPLE_CAP;
    const sample = summarized ? input.relPaths.slice(0, BATCH_SAMPLE_CAP) : input.relPaths;

    const events: ChangeEventInfo[] = [];
    if (sample.length > 0) {
      try {
        const mergeCutoff = new Date(Date.now() - MERGE_WINDOW_MS).toISOString();
        for (const rel of sample) {
          const sizeOf = (): number | null => {
            if (root === '') return null;
            const st = fsx.statSafe(path.join(root, rel));
            return st === null ? null : st.size;
          };
          const prev = getOne<{
            id: number;
            first_at: string;
            change_count: number;
            session_id: string | null;
          }>(
            db,
            `SELECT id, first_at, change_count, session_id FROM change_event
             WHERE project_id = ? AND path = ? AND last_at >= ?
             ORDER BY id DESC LIMIT 1`,
            [input.projectId, rel, mergeCutoff],
          );
          const firstAt = prev?.first_at ?? nowIso;
          const count = (prev?.change_count ?? 0) + 1;
          const sessionId = input.sessionId ?? prev?.session_id ?? null;
          if (prev !== undefined) run(db, 'DELETE FROM change_event WHERE id = ?', [prev.id]);
          const r = run(
            db,
            `INSERT INTO change_event
               (project_id, session_id, burst_id, path, kind, first_at, last_at, change_count, bytes, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [input.projectId, sessionId, burstId, rel, kind, firstAt, nowIso, count, sizeOf(), source],
          );
          events.push({
            seq: Number(r.lastInsertRowid),
            projectId: input.projectId,
            sessionId,
            burstId,
            path: rel,
            kind,
            firstAt,
            lastAt: nowIso,
            changeCount: count,
            bytes: sizeOf(),
            source,
          });
        }
      } catch (err) {
        this.logger.warn({
          mod: 'changes',
          msg: `record failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      // 会话聚合（资源仓库）：与落库同源；无活动会话时按项目开关自动开启一段
      try {
        const before = getOne<{ id: string }>(
          db,
          'SELECT id FROM agent_sessions WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
          [input.projectId],
        );
        // 可选快照层（默认关）：开启时抓变更后的内容（文本 ≤512KB），失败诚实跳过
        let snapshots: Map<string, string> | undefined;
        if (this.snapshotsRoot !== null && this.snapshotEnabled()) {
          snapshots = new Map<string, string>();
          for (const rel of sample) {
            const got = storeSnapshot(this.snapshotsRoot, input.projectId, path.join(root, rel));
            if (got !== null) snapshots.set(rel, got.sha);
          }
        }
        recordSessionFileChanges(db, input.projectId, sample, nowIso, snapshots);
        const after = getOne<{ id: string; start_head: string | null }>(
          db,
          'SELECT id, start_head FROM agent_sessions WHERE project_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
          [input.projectId],
        );
        if (before === undefined && after !== undefined && after.start_head === null) {
          this.captureStartHead(input.projectId, after.id);
        }
      } catch (err) {
        this.logger.warn({
          mod: 'changes',
          msg: `session aggregate failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    this.sse.publish('fs.changed', {
      projectId: input.projectId,
      // 兼容既有消费方（绝对路径 + rel 双通道）：applyFsChanged 旧逻辑仍可工作
      paths: events.map((e) => (root === '' ? e.path : path.join(root, e.path))),
      relPaths: events.map((e) => e.path),
      kind,
      source,
      burstId,
      summarized,
      total: input.relPaths.length,
      events,
    });
    return events;
  }
}

/** 读流水：since 给定则回增量（升序），否则最近 limit 条（升序输出便于前端追加）。 */
export function listChanges(
  db: Database.Database,
  projectId: string,
  opts: { since?: number; limit: number },
): ChangeEventInfo[] {
  const rows =
    opts.since !== undefined && Number.isFinite(opts.since)
      ? getAll<Record<string, unknown>>(
          db,
          `SELECT * FROM change_event WHERE project_id = ? AND id > ? ORDER BY id ASC LIMIT ?`,
          [projectId, opts.since, opts.limit],
        )
      : getAll<Record<string, unknown>>(
          db,
          `SELECT * FROM (
             SELECT * FROM change_event WHERE project_id = ? ORDER BY id DESC LIMIT ?
           ) ORDER BY id ASC`,
          [projectId, opts.limit],
        );
  return rows.map((r) => ({
    seq: Number(r['id']),
    projectId: String(r['project_id']),
    sessionId: (r['session_id'] as string | null) ?? null,
    burstId: String(r['burst_id']),
    path: String(r['path']),
    kind: (r['kind'] as ChangeKind) ?? 'update',
    firstAt: String(r['first_at']),
    lastAt: String(r['last_at']),
    changeCount: Number(r['change_count'] ?? 1),
    bytes: r['bytes'] === null ? null : Number(r['bytes']),
    source: (r['source'] as ChangeSource) ?? 'watcher',
  }));
}

/** 保留清理：热 keepDays 天 + 全库硬上限 maxRows（按 id 从旧到新删）。 */
export function purgeChangeEvents(
  db: Database.Database,
  keepDays = CHANGE_KEEP_DAYS,
  maxRows = CHANGE_MAX_ROWS,
): number {
  const cutoff = new Date(Date.now() - keepDays * 24 * 3600 * 1000).toISOString();
  let removed = run(db, 'DELETE FROM change_event WHERE last_at < ?', [cutoff]).changes;
  const row = getOne<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM change_event');
  const total = row?.c ?? 0;
  if (total > maxRows) {
    const keepFrom = getOne<{ id: number }>(
      db,
      'SELECT id FROM change_event ORDER BY id DESC LIMIT 1 OFFSET ?',
      [maxRows],
    );
    if (keepFrom !== undefined) {
      removed += run(db, 'DELETE FROM change_event WHERE id < ?', [keepFrom.id]).changes;
    }
  }
  return removed;
}
