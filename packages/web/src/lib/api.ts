/** API 客户端：统一 {ok,data}/{ok,error} 信封（API-2），错误码驱动提示。 */
import type { ApiError, ApiResponse } from '@ttfolio/shared';

declare global {
  interface Window {
    __TTFOLIO_TOKEN__?: string;
    __TTFOLIO_PORT__?: string;
    __TTFOLIO_API_BASE__?: string;
    __TTFOLIO_CONTENT_BASE__?: string;
    /** Electron preload 桥（桌面版才有）：T-113 缩略图原生解码快速路径。 */
    ttfolioNative?: {
      setTheme?: (mode: string) => void;
      /** 主进程 nativeImage 解码并按最长边缩放，返回 dataURL；失败返回 null。 */
      thumbDecode?: (absPath: string, maxPx: number) => Promise<string | null>;
      /** 拖拽登记（T-118）：DataTransfer 的 File → 绝对路径；仅桌面版存在。 */
      getPathForFile?: (file: File) => string;
    };
  }
}

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly detail?: unknown,
    public readonly status: number = 500,
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

/**
 * 文档二进制预览取回（第 40 轮）：Word/PDF/Excel 前端渲染需要字节保真，
 * 且 query token 仅对 SSE 放行 —— 与导出下载同款做法：带鉴权头手动 fetch。
 * 仅限 /api/docs/raw 白名单格式（docx/pdf/xlsx/xls/csv），50MB 上限由服务端把关。
 */
export async function fetchDocsRaw(
  projectId: string,
  path: string,
  mountId: string | null,
): Promise<ArrayBuffer> {
  const url = new URL(base() + '/api/docs/raw', window.location.origin);
  url.searchParams.set('projectId', projectId);
  url.searchParams.set('path', path);
  if (mountId !== null) url.searchParams.set('mountId', mountId);
  return fetchArrayBuffer(url);
}

/** 文档根内 Office 字节取回（FR-13.12 / T-110 文档库预览用）。 */
export async function fetchDocRootRaw(rootId: string, rel: string): Promise<ArrayBuffer> {
  const url = new URL(base() + `/api/doc-roots/${rootId}/raw`, window.location.origin);
  url.searchParams.set('rel', rel);
  return fetchArrayBuffer(url);
}

async function fetchArrayBuffer(url: URL | string): Promise<ArrayBuffer> {
  const res = await fetch(url.toString(), { headers: { 'x-ttfolio-token': token() } });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as ApiResponse<never> | null;
    const err = payload !== null && payload.ok === false ? payload.error : undefined;
    throw new ApiClientError(
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? `HTTP ${res.status}`,
      undefined,
      res.status,
    );
  }
  return res.arrayBuffer();
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<T> {
  const url = new URL(base() + path, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = { 'x-ttfolio-token': token() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
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
    res.status,
  );
}

export const api = {
  get: <T>(path: string, query?: Record<string, string>) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string, query?: Record<string, string>) => request<T>('DELETE', path, undefined, query),
  /** 原始字节体 POST（FR-13.5 / T-113 缩略图 webp 直传；仅 image/webp 服务端认） */
  postBinary: async <T>(path: string, body: Blob, contentType: string): Promise<T> => {
    const res = await fetch(new URL(base() + path, window.location.origin).toString(), {
      method: 'POST',
      headers: { 'x-ttfolio-token': token(), 'content-type': contentType },
      body,
    });
    const payload = (await res.json().catch(() => null)) as ApiResponse<T> | null;
    if (payload !== null && payload.ok === true) return payload.data;
    const err = payload !== null && payload.ok === false ? payload.error : undefined;
    throw new ApiClientError(
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? `请求失败（HTTP ${res.status}）`,
      err?.detail,
      res.status,
    );
  },
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

/** 个人头像（FR-13.7）：数据目录 avatar.png，经用户内容端口伺服（query token）。 */
export function avatarUrl(): string {
  return `${userContentBase()}/avatar?token=${encodeURIComponent(token())}`;
}

/** 项目头像（可选功能 2026-10-29）：avatars/<id>.png 经用户内容端口伺服；
 *  v = 文件 mtime，上传/清除后变化以穿透浏览器缓存。 */
export function projectAvatarUrl(projectId: string, v: number): string {
  return `${userContentBase()}/pavatar/${projectId}?token=${encodeURIComponent(token())}&v=${v}`;
}

/** 数据目录缩略图（FR-13.5）：sha1(相对路径).png，由渲染层生成后经服务端落盘。 */
/** 缩略图 URL（FR-13.5 / T-113）：带源文件 mtime 作版本参数，配合服务端 immutable 缓存。 */
export function thumbUrl(projectId: string, thumbName: string, version?: string | null): string {
  const v =
    version === undefined || version === null || version === '' ? '' : `&v=${encodeURIComponent(version)}`;
  return `${userContentBase()}/thumbs/${projectId}/${thumbName}?token=${encodeURIComponent(token())}${v}`;
}

export function sseUrl(): string {
  return `${base()}/api/events?token=${encodeURIComponent(token())}`;
}

/**
 * 带鉴权的下载（导出清单等）。
 *
 * 为什么不能用 `window.open('/api/export/...')`：浏览器原生跳转（window.open / <a download> / <img>）
 * **无法携带 x-ttfolio-token 请求头**，而服务端的 query token 只对 SSE 放行 —— 实测直接打开
 * 返回 401，表现为"设置页里点导出没反应/报错"。
 * 这里改为：带 token 取回内容 → 生成 blob → 触发本地保存。
 * 刻意不改服务端鉴权闸门（为两个按钮放宽鉴权会扩大安全面）。
 */
export async function downloadWithToken(path: string, fallbackName: string): Promise<void> {
  const url = new URL(base() + path, window.location.origin);
  const res = await fetch(url.toString(), { headers: { 'x-ttfolio-token': token() } });
  if (!res.ok) {
    let message = `导出失败（HTTP ${res.status}）`;
    try {
      const payload = (await res.json()) as ApiResponse<unknown>;
      if (payload.ok === false) message = payload.error.message;
    } catch {
      /* 错误体不是 JSON：保留 HTTP 状态提示 */
    }
    throw new ApiClientError(`HTTP_${res.status}`, message, undefined, res.status);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const matched = /filename="?([^";]+)"?/.exec(disposition);
  const name = matched?.[1] ?? fallbackName;
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
}
