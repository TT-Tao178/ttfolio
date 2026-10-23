/**
 * 「分析中」完成反馈（T-119）：本轮新登记的项目 id 暂存于此，App 层收到
 * project.analyzed SSE 时消费一次并 toast；纯 module 级，无持久化——刷新丢失
 * 只是少一条一次性提示，无功能影响。
 */
const pending = new Set<string>();

export function markPendingAnalysis(ids: string[]): void {
  for (const id of ids) pending.add(id);
}

/** 消费：命中返回 true 并移除（一次性）。 */
export function takePendingAnalysis(id: string): boolean {
  return pending.delete(id);
}
