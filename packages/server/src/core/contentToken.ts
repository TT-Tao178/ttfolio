/**
 * 内容端口的"能力票"（T-148）。
 *
 * 背景：主 token 是全权限的——它能读任何已登记项目的原始文件。而内容端口是给
 * `<img>/<video>/<iframe>` 用的，URL 会出现在页面里（日志、复制、截图），
 * 一旦泄漏就等于把整个库的读权限送出去。
 *
 * 做法：给每个项目签一张短期只读票（5 分钟），绑定 projectId；内容端口只认票，
 * 不再接受主 token 读项目文件。票用 HMAC-SHA256 对 `${projectId}.${exp}` 签名，
 * 校验方不需要存任何状态。
 */
import crypto from 'node:crypto';

export interface ContentTicketPayload {
  projectId: string;
  exp: number;
}

/** 默认票有效期：5 分钟（前端在到期前 60s 续签）。 */
export const CONTENT_TICKET_TTL_MS = 5 * 60 * 1000;

export function signContentTicket(
  secret: string,
  projectId: string,
  ttlMs = CONTENT_TICKET_TTL_MS,
): {
  token: string;
  expiresAt: number;
} {
  const exp = Date.now() + ttlMs;
  const payload = `${projectId}.${exp}`;
  const body = Buffer.from(payload, 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${body}.${mac}`, expiresAt: exp };
}

/** 校验票：签名不对 / 格式不对 / 过期 / projectId 不匹配，一律 null。 */
export function verifyContentTicket(
  secret: string,
  token: string | null | undefined,
  projectId?: string,
): ContentTicketPayload | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 512) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  let payload: string;
  try {
    payload = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const [p, expRaw] = payload.split('.');
  if (p === undefined || expRaw === undefined) return null;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= Date.now()) return null;
  if (projectId !== undefined && p !== projectId) return null;
  const expect = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const given = token.slice(dot + 1);
  const a = Buffer.from(expect);
  const b = Buffer.from(given);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { projectId: p, exp };
}
