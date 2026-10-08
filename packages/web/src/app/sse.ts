/** SSE 订阅（C-30）：事件 → 精确失效对应 Query 缓存，绝不轮询整表。 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sseUrl } from '@/lib/api';
import type { SseEvent } from '@ttfolio/shared';

export type SseState = 'connecting' | 'open' | 'closed';

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
        onEventRef.current?.({ id: Number.isFinite(id) ? id : 0, event: name as SseEvent['event'], data });
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
            void queryClient.invalidateQueries({ queryKey: ['tasks'] });
            break;
          default:
            break;
        }
      };

      for (const name of [
        'hello',
        'analysis.progress',
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
