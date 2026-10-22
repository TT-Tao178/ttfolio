/** SSE 订阅（C-30）：事件 → 精确失效对应 Query 缓存，绝不轮询整表。 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sseUrl } from '@/lib/api';
import type { SseEvent } from '@ttfolio/shared';

export type SseState = 'connecting' | 'open' | 'closed';

/** 组件级原始事件总线（FR-13.2）：Query 失效之外的订阅方（如动态页签文件流）从这里拿事件。 */
type SseListener = (e: SseEvent) => void;
const listeners = new Set<SseListener>();

export function subscribeSseEvents(fn: SseListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useSse(onState: (s: SseState) => void, onEvent?: (e: SseEvent) => void): void {
  const queryClient = useQueryClient();
  const lastIdRef = useRef<number>(undefined);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let closed = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = (): void => {
      if (closed) return;
      onState('connecting');
      const url = lastIdRef.current !== undefined ? `${sseUrl()}&lastEventId=${lastIdRef.current}` : sseUrl();
      es = new EventSource(url);

      const handle = (name: string) => (ev: MessageEvent) => {
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(ev.data) as Record<string, unknown>;
        } catch {
          data = {};
        }
        const id = Number.parseInt(ev.lastEventId ?? '', 10);
        if (Number.isFinite(id)) lastIdRef.current = id;
        const evt: SseEvent = {
          id: Number.isFinite(id) ? id : 0,
          event: name as SseEvent['event'],
          data,
        };
        onEventRef.current?.(evt);
        // 总线分发：单个订阅方异常不拖垮 SSE 主链路
        for (const fn of listeners) {
          try {
            fn(evt);
          } catch {
            /* 忽略订阅方错误 */
          }
        }
        const projectId = typeof data['projectId'] === 'string' ? (data['projectId'] as string) : null;
        switch (name) {
          case 'project.analyzed':
          case 'project.updated':
            if (projectId !== null) {
              void queryClient.invalidateQueries({ queryKey: ['projects'] });
              void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
            }
            break;
          case 'fs.changed':
            if (projectId !== null) {
              void queryClient.invalidateQueries({ queryKey: ['tree', projectId] });
              void queryClient.invalidateQueries({ queryKey: ['git', projectId] });
              // 体检 P2：外部修改了已打开文件时必须失效 ['file']，编辑器的
              // 「外部修改」警告才可能触发（EditorPane 有 loadedRef 版本守卫，
              // 重取不会覆盖未保存内容）
              const changed = (data['paths'] as string[] | undefined) ?? [];
              if (changed.length > 0) {
                void queryClient.invalidateQueries({ queryKey: ['file', projectId] });
              }
            }
            void queryClient.invalidateQueries({ queryKey: ['trash'] });
            break;
          case 'git.changed':
            if (projectId !== null) {
              void queryClient.invalidateQueries({ queryKey: ['git', projectId] });
              void queryClient.invalidateQueries({ queryKey: ['projects'] });
              void queryClient.invalidateQueries({ queryKey: ['git-overview'] });
            }
            break;
          case 'trash.changed':
            void queryClient.invalidateQueries({ queryKey: ['trash'] });
            break;
          case 'search.index.progress':
            void queryClient.invalidateQueries({ queryKey: ['index-status'] });
            break;
          case 'analysis.progress':
          case 'task.progress':
            void queryClient.invalidateQueries({ queryKey: ['tasks'] });
            break;
          default:
            break;
        }
      };

      for (const name of [
        'hello',
        'analysis.progress',
        'task.progress',
        'project.analyzed',
        'project.updated',
        'fs.changed',
        'git.changed',
        'search.index.progress',
        'trash.changed',
        'notice',
      ]) {
        es.addEventListener(name, handle(name) as EventListener);
      }
      es.onopen = () => onState('open');
      es.onerror = () => {
        onState('closed');
        es?.close();
        es = null;
        retryTimer = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      es?.close();
    };
  }, [queryClient, onState]);
}
