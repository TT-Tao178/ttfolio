/**
 * 变更流水前端 store（FR-13.2 v2 / T-111）：module 级按项目缓存 + SSE 增量追加 +
 * 首次挂载 GET 回读（since/latest）。切页签、切项目、重启都不丢（数据在库里）。
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { subscribeSseEvents } from '@/app/sse';

export type ChangeSource = 'watcher' | 'api' | 'agent' | 'other';
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

/** 前端窗口上限：与后端回读 300 条配合，防长时间挂机无限增长。 */
const VIEW_CAP = 800;

const cache = new Map<string, ChangeEventInfo[]>();
const loaded = new Set<string>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
let sseStarted = false;

function emit(): void {
  for (const l of listeners) l();
}

/** 按 seq 合并（同 seq 以新事件替换：5 秒合并窗口内后端是删旧插新，seq 会前进，
 *  这里仍按 seq 去重以防 SSE 重放重复投递）。数组保持 seq 升序。 */
export function mergeEvents(prev: ChangeEventInfo[], incoming: ChangeEventInfo[]): ChangeEventInfo[] {
  if (incoming.length === 0) return prev;
  const bySeq = new Map<number, ChangeEventInfo>();
  for (const e of prev) bySeq.set(e.seq, e);
  let changed = false;
  for (const e of incoming) {
    const old = bySeq.get(e.seq);
    if (old === undefined || old.lastAt !== e.lastAt || old.changeCount !== e.changeCount) changed = true;
    bySeq.set(e.seq, e);
  }
  if (!changed) return prev;
  const next = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  return next.length > VIEW_CAP ? next.slice(next.length - VIEW_CAP) : next;
}

function applyEvents(projectId: string, incoming: ChangeEventInfo[]): void {
  const prev = cache.get(projectId) ?? [];
  const next = mergeEvents(prev, incoming);
  if (next === prev) return;
  cache.set(projectId, next);
  emit();
}

export function ensureLoaded(projectId: string): void {
  if (loaded.has(projectId) || loading.has(projectId)) return;
  loading.add(projectId);
  void api
    .get<{ seq: number; events: ChangeEventInfo[] }>('/api/changes', {
      projectId,
      limit: '300',
    })
    .then((r) => {
      cache.set(projectId, mergeEvents([], r.events));
      loaded.add(projectId);
      emit();
    })
    .catch(() => {
      /* 回读失败不阻断实时流：SSE 到了照样追加 */
      loaded.add(projectId);
    })
    .finally(() => {
      loading.delete(projectId);
    });
}

function startSse(): void {
  if (sseStarted) return;
  sseStarted = true;
  subscribeSseEvents((evt) => {
    if (evt.event !== 'fs.changed') return;
    const pid = evt.data['projectId'];
    if (typeof pid !== 'string' || pid === '') return;
    const events = evt.data['events'];
    if (!Array.isArray(events) || events.length === 0) return;
    ensureLoaded(pid);
    applyEvents(pid, events as ChangeEventInfo[]);
  });
}

/** 订阅某项目的流水（升序）。挂载时触发回读。 */
export function useLiveEvents(projectId: string): ChangeEventInfo[] {
  const [snapshot, setSnapshot] = useState<ChangeEventInfo[]>(() => cache.get(projectId) ?? []);
  useEffect(() => {
    startSse();
    ensureLoaded(projectId);
    const sync = (): void => setSnapshot(cache.get(projectId) ?? []);
    sync();
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, [projectId]);
  return snapshot;
}
