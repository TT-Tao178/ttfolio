/**
 * 语义化版本比较（第 33 轮从 system.ts 抽出为纯函数，供单测覆盖）。
 * 只认数字段、忽略 v 前缀与预发布后缀；解析失败的段按 0 处理。
 * 返回 true 表示 a 严格大于 b。
 */
export function semverNewer(a: string, b: string): boolean {
  const p = (s: string): number[] =>
    s
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .slice(0, 3)
      .map((x) => parseInt(x, 10) || 0);
  const [a1 = 0, a2 = 0, a3 = 0] = p(a);
  const [b1 = 0, b2 = 0, b3 = 0] = p(b);
  return a1 !== b1 ? a1 > b1 : a2 !== b2 ? a2 > b2 : a3 > b3;
}
