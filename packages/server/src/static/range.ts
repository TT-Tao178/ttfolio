/** HTTP Range 解析（FR-13.5 媒体伺服）：单区间，RFC 7233 子集；纯函数供测试。 */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * 解析 Range 请求头。返回：
 * - null：无/不支持（多区间等）→ 走 200 全量
 * - 'invalid'：语法合法但越界/不可满足 → 416
 * - ByteRange：应返回 206
 */
export function parseRange(header: string, size: number): ByteRange | 'invalid' | null {
  if (size <= 0) return 'invalid';
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (m === null) return null;
  const sRaw = m[1] ?? '';
  const eRaw = m[2] ?? '';
  if (sRaw === '' && eRaw === '') return null;
  if (sRaw === '') {
    // 后缀式：bytes=-N → 最后 N 字节
    const n = Number(eRaw);
    if (!Number.isInteger(n) || n <= 0) return 'invalid';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(sRaw);
  if (!Number.isInteger(start) || start < 0 || start >= size) return 'invalid';
  if (eRaw === '') return { start, end: size - 1 };
  const end = Number(eRaw);
  if (!Number.isInteger(end) || end < start) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}
