/**
 * 内容端口票据的 React 绑定（T-148）。
 * 缓存与取票逻辑在 lib/api.ts（同步 URL 构造函数要用），这里只负责
 * "挂载时补票 + 票到货后重渲染"，避免 api 层依赖 React。
 */
import { useEffect, useSyncExternalStore } from 'react';
import { cachedTicket, ensureTicket, subscribeTicket, ticketVersionValue } from './api';

/** 视图顶层调用一次即可：拿不到票时返回 null，票到货后自动重渲染。 */
export function useContentTicket(projectId: string | null | undefined): string | null {
  const version = useSyncExternalStore(subscribeTicket, ticketVersionValue, ticketVersionValue);
  useEffect(() => {
    if (projectId !== null && projectId !== undefined && projectId !== '') void ensureTicket(projectId);
  }, [projectId, version]);
  return projectId === null || projectId === undefined ? null : cachedTicket(projectId);
}
