/** 缩略图懒生成队列（FR-13.5 / T-099）：渲染层 canvas 解码缩放 → POST 服务端
 * 落盘（数据目录 thumbs/，单写者保持）；并发受限；失败诚实回退图标。
 * 音频无缩略图（直接 failed 态，UI 回退图标——沿诚实降级惯例）。 */
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { thumbNameOf } from './mediaHelpers';
import type { MediaItem, MediaKind } from '@ttfolio/shared';

export interface ThumbState {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  /** 服务端落盘后的缩略图文件名（sha1.png） */
  name?: string;
}

const CONCURRENCY = 3;
const MAX_PX = 320;

/** 解码 + canvas 缩放；视频取中点附近帧；音频/失败返回 null（诚实回退）。 */
async function generateDataUrl(url: string, kind: MediaKind): Promise<string | null> {
  const drawTo = (source: HTMLImageElement | HTMLVideoElement, sw: number, sh: number): string | null => {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, MAX_PX / Math.max(sw || 1, sh || 1));
    canvas.width = Math.max(1, Math.round((sw || 1) * scale));
    canvas.height = Math.max(1, Math.round((sh || 1) * scale));
    const ctx2d = canvas.getContext('2d');
    if (ctx2d === null) return null;
    ctx2d.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  };
  try {
    if (kind === 'image') {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image decode failed'));
        img.src = url;
      });
      return drawTo(img, img.naturalWidth, img.naturalHeight);
    }
    if (kind === 'video') {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'metadata';
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('video load timeout')), 8000);
        video.onloadeddata = () => {
          clearTimeout(timer);
          resolve();
        };
        video.onerror = () => {
          clearTimeout(timer);
          reject(new Error('video decode failed'));
        };
      });
      // 取中点附近一帧做封面（seek 失败不致命，用当前帧）
      const half = Number.isFinite(video.duration) ? video.duration / 2 : 0.1;
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        setTimeout(() => resolve(), 1500);
        try {
          video.currentTime = half;
        } catch {
          resolve();
        }
      });
      return drawTo(video, video.videoWidth, video.videoHeight);
    }
    return null;
  } catch {
    return null;
  }
}

export function useThumbQueue(
  projectId: string,
  items: MediaItem[],
  enabled: boolean,
): Map<string, ThumbState> {
  const [states, setStates] = useState<Map<string, ThumbState>>(new Map());
  const queueRef = useRef<MediaItem[]>([]);
  const runningRef = useRef(0);
  const statesRef = useRef(states);
  statesRef.current = states;

  useEffect(() => {
    if (!enabled) return;
    const pending = items.filter((it) => {
      if (it.kind === 'audio') return false; // 音频无缩略图，直接回退图标
      const cur = statesRef.current.get(it.path);
      return cur === undefined;
    });
    if (pending.length === 0) return;
    setStates((prev) => {
      const next = new Map(prev);
      for (const it of pending) next.set(it.path, { status: 'idle' });
      return next;
    });
    queueRef.current = [...queueRef.current, ...pending];
  }, [items, enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const pump = (): void => {
      while (runningRef.current < CONCURRENCY && queueRef.current.length > 0) {
        const item = queueRef.current.shift();
        if (item === undefined) break;
        runningRef.current += 1;
        void (async () => {
          try {
            const dataUrl = await generateDataUrl(
              // 动态 import 避免初始化顺序问题（rawUrl 依赖 window，已就绪）
              (await import('@/lib/api')).rawUrl(projectId, item.path),
              item.kind,
            );
            if (dataUrl === null) {
              setStates((prev) => new Map(prev).set(item.path, { status: 'failed' }));
              return;
            }
            const r = await api.post<{ thumb: string }>(`/api/media/${projectId}/thumb`, {
              path: item.path,
              dataUrl,
            });
            setStates((prev) => new Map(prev).set(item.path, { status: 'ready', name: r.thumb }));
          } catch {
            setStates((prev) => new Map(prev).set(item.path, { status: 'failed' }));
          } finally {
            runningRef.current -= 1;
            pump();
          }
        })();
      }
    };
    pump();
    return undefined;
  }, [projectId, enabled, items]);

  return states;
}

/** 计算某条目的缩略图名（供预取 /thumbs 是否存在；懒生成路径不需要）。 */
export { thumbNameOf };
