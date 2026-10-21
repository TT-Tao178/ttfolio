/** 动态页签文件流的纯函数 reducer（FR-13.2）：fs.changed 事件 → 有界滚动窗口。 */
export interface LiveEntry {
  id: number;
  kind: 'create' | 'update' | 'delete';
  /** 项目内相对路径（正斜杠） */
  relPath: string;
  /** epoch ms */
  at: number;
}

/** 滚动窗口上限（FR-13.2：500 条），旧的被挤出即丢弃——流是会话级实时视图，不落库。 */
export const LIVE_STREAM_CAP = 500;

/** 绝对路径 → 项目内相对路径（正斜杠统一）；不在项目内时回退 basename（诚实降级）。 */
export function toRelPath(abs: string, rootAbs: string): string {
  const norm = (s: string): string => s.replace(/\\/g, '/');
  const a = norm(abs);
  const r = norm(rootAbs).replace(/\/+$/, '');
  if (r !== '') {
    const prefix = `${r}/`;
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return a.slice(a.lastIndexOf('/') + 1);
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

/**
 * 应用一条 fs.changed 事件：paths（绝对路径数组，服务端已截 200）逐条转相对路径
 * 插入流头部，窗口封顶 LIVE_STREAM_CAP。kind 只认 create/delete，其余一律 update
 * （与服务端 watcher 的 kind 语义对齐：update 是默认动作）。
 */
export function applyFsChanged(
  prev: LiveEntry[],
  evt: { kind?: unknown; paths?: unknown },
  rootAbs: string,
  now: number,
  nextId: () => number,
): LiveEntry[] {
  const kind = evt.kind === 'create' || evt.kind === 'delete' ? evt.kind : 'update';
  const paths = asStringArray(evt.paths);
  if (paths.length === 0) return prev;
  const added: LiveEntry[] = paths.map((abs) => ({
    id: nextId(),
    kind,
    relPath: toRelPath(abs, rootAbs),
    at: now,
  }));
  return added.reverse().concat(prev).slice(0, LIVE_STREAM_CAP);
}

/** 事件涉及的项目内相对路径集合（防抖刷新判断「正在查看的文件是否又变了」用）。 */
export function changedRelPaths(evt: { paths?: unknown }, rootAbs: string): Set<string> {
  return new Set(asStringArray(evt.paths).map((abs) => toRelPath(abs, rootAbs)));
}
