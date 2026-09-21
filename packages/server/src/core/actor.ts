/** 当前 actor 注入点（FR-12.4 / C-57）：当前恒为本地单人，未来接入多用户/agent 时替换此实现。 */
export interface ActorContext {
  actor: string;
  ownerId: string | null;
}

export function currentActor(): ActorContext {
  return { actor: 'local', ownerId: null };
}
