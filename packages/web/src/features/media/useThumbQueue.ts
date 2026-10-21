/** 缩略图队列 v2（FR-13.5 / T-113）：
 * ① 首屏先读存在性索引（thumb-index），命中直接出图，未命中才入队；
 * ② 只给「可视区 + overscan」的条目排生成（滚动增量补），并发受限；
 * ③ 失败 5 分钟 TTL 内不再重排（如实回退图标）；
 * ④ 灯箱预览档（p）按需生成。
 * 生成与上传在 thumbGen（Electron 原生解码优先 / Web canvas 兜底）。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { missingItems, thumbNameOf } from './mediaHelpers';
import { FAILED_TTL_MS, generateThumb, type ThumbTier } from './thumbGen';
import type { MediaItem } from '@ttfolio/shared';

export interface ThumbState {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  /** g 档文件名（网格） */
  g?: string;
  /** p 档文件名（灯箱预览） */
  p?: string;
  failedAt?: number;
}

const CONCURRENCY = 3;

export interface ThumbQueueApi {
  states: Map<string, ThumbState>;
  /** 灯箱按需请求 p 档预览。 */
  requestPreview: (path: string) => void;
}

export function useThumbQueue(
  projectId: string,
  dirPath: string,
  items: MediaItem[],
  enabled: boolean,
  visiblePaths: Set<string>,
): ThumbQueueApi {
  const [states, setStates] = useState<Map<string, ThumbState>>(new Map());
  const [names, setNames] = useState<Map<string, { g: string; p: string }>>(new Map());
  const queueRef = useRef<Array<{ item: MediaItem; tier: ThumbTier }>>([]);
  const queuedRef = useRef<Set<string>>(new Set());
  const runningRef = useRef(0);
  const haveRef = useRef<Set<string>>(new Set());
  const statesRef = useRef(states);
  statesRef.current = states;
  const namesRef = useRef(names);
  namesRef.current = names;

  const indexQuery = useQuery({
    queryKey: ['thumb-index', projectId],
    queryFn: () => api.get<{ names: string[] }>(`/api/media/${projectId}/thumb-index`),
    enabled,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (indexQuery.data === undefined) return;
    haveRef.current = new Set(indexQuery.data.names);
    // 索引到达后，命中项立刻转 ready（首屏直接出图，不等生成）
    setStates((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const it of items) {
        const n = namesRef.current.get(it.path);
        if (n === undefined) continue;
        const cur = next.get(it.path);
        if (cur?.status === 'ready') continue;
        const g = haveRef.current.has(n.g) ? n.g : undefined;
        const p = haveRef.current.has(n.p) ? n.p : undefined;
        if (g !== undefined || p !== undefined) {
          next.set(it.path, { status: g !== undefined ? 'ready' : (cur?.status ?? 'idle'), g, p });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // names 也要进依赖：名称异步算完（可能晚于索引）时必须重新标记命中项
  }, [indexQuery.data, items, names]);

  // 名称（sha1）按条目异步计算并缓存
  useEffect(() => {
    if (!enabled || items.length === 0) return undefined;
    let alive = true;
    void (async () => {
      const next = new Map(namesRef.current);
      let added = false;
      for (const it of items) {
        if (next.has(it.path)) continue;
        next.set(it.path, { g: await thumbNameOf(it.path, 'g'), p: await thumbNameOf(it.path, 'p') });
        added = true;
      }
      if (alive && added) setNames(next);
    })();
    return () => {
      alive = false;
    };
  }, [items, enabled]);

  const visibleKey = useMemo(() => [...visiblePaths].sort().join('|'), [visiblePaths]);

  const pump = (): void => {
    while (runningRef.current < CONCURRENCY && queueRef.current.length > 0) {
      const job = queueRef.current.shift();
      if (job === undefined) break;
      runningRef.current += 1;
      const key = `${job.item.path}|${job.tier}`;
      void (async () => {
        setStates((prev) =>
          new Map(prev).set(job.item.path, { ...prev.get(job.item.path), status: 'loading' }),
        );
        const name = await generateThumb(projectId, dirPath, job.item, job.tier);
        if (name !== null) haveRef.current.add(name);
        setStates((prev) => {
          const cur = prev.get(job.item.path) ?? { status: 'idle' as const };
          return new Map(prev).set(
            job.item.path,
            name !== null
              ? { ...cur, status: job.tier === 'g' ? 'ready' : cur.status, [job.tier]: name }
              : { ...cur, status: job.tier === 'g' ? 'failed' : cur.status, failedAt: Date.now() },
          );
        });
        queuedRef.current.delete(key);
        runningRef.current -= 1;
        pump();
      })();
    }
  };

  // 可视优先入队：只排当前视口（含 overscan）里还没有 g 档的条目
  useEffect(() => {
    if (!enabled || names.size === 0) return;
    const missing = missingItems(items, haveRef.current, names, 'g').filter((it) =>
      visiblePaths.has(it.path),
    );
    let added = false;
    for (const it of missing) {
      const key = `${it.path}|g`;
      if (queuedRef.current.has(key)) continue;
      const cur = statesRef.current.get(it.path);
      if (cur?.status === 'failed' && Date.now() - (cur.failedAt ?? 0) < FAILED_TTL_MS) continue;
      queueRef.current.push({ item: it, tier: 'g' });
      queuedRef.current.add(key);
      added = true;
    }
    if (added) pump();
    // visibleKey 承载视口变化；items/names 变化同样需要重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, items, names, enabled]);

  const requestPreview = (relPath: string): void => {
    const it = items.find((x) => x.path === relPath);
    if (it === undefined || it.kind === 'audio') return;
    const n = namesRef.current.get(it.path);
    if (n !== undefined && haveRef.current.has(n.p)) return;
    const key = `${relPath}|p`;
    if (queuedRef.current.has(key)) return;
    queuedRef.current.add(key);
    queueRef.current.push({ item: it, tier: 'p' });
    pump();
  };

  return { states, requestPreview };
}

/** 后台补建用：按索引列出缺口（上限 cap），供分析完成后的静默补建。 */
export async function planMissingThumbs(
  projectId: string,
  items: MediaItem[],
  cap = 200,
): Promise<MediaItem[]> {
  const idx = await api.get<{ names: string[] }>(`/api/media/${projectId}/thumb-index`);
  const have = new Set(idx.names);
  const names = new Map<string, { g: string; p: string }>();
  for (const it of items) {
    if (it.kind === 'audio') continue;
    names.set(it.path, { g: await thumbNameOf(it.path, 'g'), p: await thumbNameOf(it.path, 'p') });
  }
  return missingItems(items, have, names, 'g', cap);
}
