/** 清单（todos）与会话（sessions/session_tabs）仓储。 */
import type { SessionData, SessionTab, TodoItem } from '@ttfolio/shared';
import type Database from 'better-sqlite3';
import { getAll, getOne, run } from '../sql.js';
import { ulid } from '../../core/ulid.js';
import type { SessionRow, SessionTabRow, TodoRow } from '../rowTypes.js';

function mapTodo(r: TodoRow): TodoItem {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    category: r.category,
    dueOn: r.due_on,
    done: r.done === 1,
    sortOrder: r.sort_order,
    actor: r.actor,
    source: r.source,
    createdAt: r.created_at,
    doneAt: r.done_at,
  };
}

export function listTodos(
  db: Database.Database,
  opts: { projectId?: string; scopeAll?: boolean; includeDone: boolean },
): TodoItem[] {
  if (opts.scopeAll) {
    return getAll<TodoRow>(
      db,
      `SELECT t.* FROM todos t JOIN projects p ON p.id = t.project_id
         WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL ${opts.includeDone ? '' : 'AND t.done = 0'}
         ORDER BY t.sort_order, t.created_at`,
    ).map(mapTodo);
  }
  const pid = opts.projectId ?? '';
  return getAll<TodoRow>(
    db,
    `SELECT * FROM todos WHERE project_id = ? AND deleted_at IS NULL ${opts.includeDone ? '' : 'AND done = 0'}
       ORDER BY sort_order, created_at`,
    [pid],
  ).map(mapTodo);
}

export function createTodo(
  db: Database.Database,
  data: {
    projectId: string;
    title: string;
    category: string | null;
    dueOn: string | null;
    sortOrder: number;
  },
): TodoItem {
  const id = ulid();
  run(
    db,
    `INSERT INTO todos (id, project_id, title, category, due_on, done, sort_order, actor, source, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, 'human', 'manual', ?)`,
    [id, data.projectId, data.title, data.category, data.dueOn, data.sortOrder, new Date().toISOString()],
  );
  const row = getOne<TodoRow>(db, 'SELECT * FROM todos WHERE id = ?', [id]);
  if (row === undefined) throw new Error('insert todo failed');
  return mapTodo(row);
}

export function patchTodo(
  db: Database.Database,
  id: string,
  fields: {
    title?: string;
    category?: string | null;
    dueOn?: string | null;
    done?: boolean;
    sortOrder?: number;
  },
): boolean {
  const row = getOne<TodoRow>(db, 'SELECT * FROM todos WHERE id = ? AND deleted_at IS NULL', [id]);
  if (row === undefined) return false;
  const done = fields.done ?? row.done === 1;
  run(
    db,
    'UPDATE todos SET title = ?, category = ?, due_on = ?, done = ?, sort_order = ?, done_at = ? WHERE id = ?',
    [
      fields.title ?? row.title,
      fields.category !== undefined ? fields.category : row.category,
      fields.dueOn !== undefined ? fields.dueOn : row.due_on,
      done ? 1 : 0,
      fields.sortOrder ?? row.sort_order,
      done ? (row.done_at ?? new Date().toISOString()) : null,
      id,
    ],
  );
  return true;
}

export function deleteTodo(db: Database.Database, id: string): boolean {
  const r = run(db, 'UPDATE todos SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), id]);
  return r.changes > 0;
}

// ---------- 会话 ----------
function mapTab(r: SessionTabRow): SessionTab {
  return {
    id: r.id,
    sortOrder: r.sort_order,
    kind: r.kind as SessionTab['kind'],
    projectId: r.project_id,
    targetPath: r.target_path,
    subTab: r.sub_tab,
    titleSnapshot: r.title_snapshot,
    scrollJson: r.scroll_json,
    navHistoryJson: r.nav_history_json,
    navIndex: r.nav_index,
    isPinned: r.is_pinned === 1,
  };
}

function activeSessionId(db: Database.Database): string {
  let row = getOne<SessionRow>(db, 'SELECT * FROM sessions WHERE is_active = 1 ORDER BY updated_at DESC');
  if (row === undefined) {
    run(db, 'INSERT INTO sessions (id, name, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)', [
      'default',
      '默认会话',
      new Date().toISOString(),
      new Date().toISOString(),
    ]);
    row = getOne<SessionRow>(db, 'SELECT * FROM sessions WHERE id = ?', ['default']);
  }
  return row?.id ?? 'default';
}

export function getSession(db: Database.Database): SessionData {
  const sid = activeSessionId(db);
  const tabs = getAll<SessionTabRow>(
    db,
    'SELECT * FROM session_tabs WHERE session_id = ? ORDER BY sort_order',
    [sid],
  ).map(mapTab);
  // FR-1.4：恢复"上次活动的是哪个标签"。原实现恒取 tabs[0].id，于是刷新后活动标签永远落到
  // 第一个标签（实测停在项目页刷新 → 跳到「工作台」）。active_tab_id 为 NULL（老库）或指向
  // 已不存在的标签（该标签在保存前被关掉）时，才回落到第一个标签。
  const row = getOne<SessionRow>(db, 'SELECT active_tab_id FROM sessions WHERE id = ?', [sid]);
  const remembered = row?.active_tab_id ?? null;
  const activeTabId =
    remembered !== null && tabs.some((t) => t.id === remembered) ? remembered : (tabs[0]?.id ?? null);
  return { tabs, activeTabId };
}

export function putSession(db: Database.Database, data: SessionData): void {
  const sid = activeSessionId(db);
  const tx = db.transaction(() => {
    run(db, 'DELETE FROM session_tabs WHERE session_id = ?', [sid]);
    for (const t of data.tabs) {
      run(
        db,
        `INSERT INTO session_tabs (id, session_id, sort_order, kind, project_id, target_path, sub_tab, title_snapshot, scroll_json, nav_history_json, nav_index, is_pinned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          t.id,
          sid,
          t.sortOrder,
          t.kind,
          t.projectId,
          t.targetPath,
          t.subTab,
          t.titleSnapshot,
          t.scrollJson,
          t.navHistoryJson,
          t.navIndex,
          t.isPinned ? 1 : 0,
        ],
      );
    }
    run(db, 'UPDATE sessions SET updated_at = ?, active_tab_id = ? WHERE id = ?', [
      new Date().toISOString(),
      // 只在"确实指向本次保存的某个标签"时写库，避免存进一个悬空 id
      data.activeTabId !== null && data.tabs.some((t) => t.id === data.activeTabId) ? data.activeTabId : null,
      sid,
    ]);
  });
  tx();
}
