/** 当前 actor 注入点（FR-12.4 / C-57）。
 * 恒定值 'local' 表示本地用户；agent 携 `x-ttfolio-actor` 头调用时由 app.ts 鉴权钩子
 * 进入该身份上下文，全部 logActivity 调用点自动落审计到 agent 身份（FR-13.1），
 * 既有业务路由零改动。多用户仍不做（FR-12.4 不变），ownerId 恒为 null。 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface ActorContext {
  actor: string;
  ownerId: string | null;
}

const actorStorage = new AsyncLocalStorage<ActorContext>();

/** 本机用户显示名（FR-13.7）：来自设置 profile_name，启动时与保存个人主页时同步。 */
let defaultActorName: string | null = null;

export function setDefaultActorName(name: string | null): void {
  const trimmed = name === null ? '' : name.trim();
  defaultActorName = trimmed === '' ? null : trimmed;
}

export function currentActor(): ActorContext {
  return actorStorage.getStore() ?? { actor: defaultActorName ?? 'local', ownerId: null };
}

/** 在指定 actor 上下文内同步执行回调（测试与内部装配用）。 */
export function runAs<T>(actor: ActorContext, fn: () => T): T {
  return actorStorage.run(actor, fn);
}

/**
 * 归一化 agent 声明的 actor 头。返回 null 表示声明不合法（调用方应拒绝请求）：
 * 空/纯控制字符/超 64 字符/冒充 'local' 都拒绝——审计身份必须与用户可辨，
 * 静默回落 local 会把 agent 操作伪装成用户操作，破坏审计可信度。
 */
export function normalizeActorHeader(raw: string | undefined): ActorContext | null {
  if (raw === undefined) return null;
  // 逐码点剔除控制字符（no-control-regex 规则禁正则写法）
  let cleaned = '';
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0;
    if (c > 0x1f && c !== 0x7f) cleaned += ch;
  }
  cleaned = cleaned.trim();
  if (cleaned === '' || cleaned.length > 64 || cleaned === 'local') return null;
  return { actor: cleaned, ownerId: null };
}

/** 进入 actor 上下文并延续到当前异步链的后续阶段（app.ts 鉴权钩子专用）。 */
export function enterActor(actor: ActorContext): void {
  actorStorage.enterWith(actor);
}
