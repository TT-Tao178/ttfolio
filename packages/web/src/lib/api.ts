/** API 客户端：统一 {ok,data}/{ok,error} 信封（API-2），错误码驱动提示。 */
import type { ApiError, ApiResponse } from '@ttfolio/shared';

declare global {
  interface Window {
    __TTFOLIO_TOKEN__?: string;
    __TTFOLIO_PORT__?: string;
    __TTFOLIO_API_BASE__?: string;
    __TTFOLIO_CONTENT_BASE__?: string;
  }
}

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly detail?: unknown,
    public readonly status: number = 500
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function token(): string {
  const t = window.__TTFOLIO_TOKEN__;
  if (t !== undefined && t !== '') return t;
  try {
    const v = new URLSearchParams(window.location.search).get('token');
    if (v !== null) return v;
  } catch {
    /* ignore */
  }
  return '';
}

function base(): string {
  // 显式基址优先（'' = 同源）：生产与 dev 均为同源——dev 由 vite 代理 /api，
  // 避免"页面在 5173、API 直连 7717"造成的跨源被 CORS/Host 校验拦截。
  const explicit = window.__TTFOLIO_API_BASE__;
  if (explicit !== undefined) return explicit;
  const p = window.__TTFOLIO_PORT__;
  if (p !== undefined && p !== '' && window.location.port !== p) {
    return `${window.location.protocol}//${window.location.hostname}:${p}`;
  }
  return '';
}

async function request<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
  const url = new URL(base() + path, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = { 'x-ttfolio-token': token() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload: ApiResponse<T> | null = null;
  try {
    payload = (await res.json()) as ApiResponse<T>;
  } catch {
    payload = null;
  }
  if (payload !== null && payload.ok === true) return payload.data;
  const err: ApiError | undefined = payload !== null && payload.ok === false ? payload.error : undefined;
  throw new ApiClientError(
    err?.code ?? `HTTP_${res.status}`,
    err?.message ?? `请求失败（HTTP ${res.status}）`,
    err?.detail,
    res.status
  );
}

export const api = {
  get: <T>(path: string, query?: Record<string, string>) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string, query?: Record<string, string>) => request<T>('DELETE', path, undefined, query)
};

/** 用户内容端口（架构图/原始文件），与应用同 host 不同端口（C-13 跨源隔离）。 */
export function userContentBase(): string {
  const explicit = window.__TTFOLIO_CONTENT_BASE__;
  if (explicit !== undefined && explicit !== '') return explicit;
  const appPort = window.__TTFOLIO_PORT__ ?? window.location.port;
  const portNum = Number.parseInt(appPort ?? '7717', 10);
  const contentPort = Number.isFinite(portNum) ? portNum + 100 : 7817;
  return `${window.location.protocol}//${window.location.hostname}:${contentPort}`;
}

export function archUrl(projectId: string, archiveId: string, rel: string): string {
  return `${userContentBase()}/arch/${projectId}/${archiveId}/${rel}?token=${encodeURIComponent(token())}`;
}

export function rawUrl(projectId: string, rel: string): string {
  return `${userContentBase()}/raw/${projectId}/${rel.split('\\').join('/')}?token=${encodeURIComponent(token())}`;
}

export function sseUrl(): string {
  return `${base()}/api/events?token=${encodeURIComponent(token())}`;
}
