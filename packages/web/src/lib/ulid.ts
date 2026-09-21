/** 本地 id（仅前端标签用；业务 id 由服务端 ULID 生成）。 */
export function ulidLike(): string {
  const t = Date.now().toString(32).toUpperCase().padStart(8, '0');
  const r = Math.random().toString(32).slice(2, 8).toUpperCase();
  return `tab-${t}-${r}`;
}
