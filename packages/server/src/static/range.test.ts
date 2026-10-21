/** 回归锚点：HTTP Range 解析（FR-13.5 媒体伺服）。 */
import { describe, expect, it } from 'vitest';
import { parseRange } from './range.js';

describe('parseRange（RFC 7233 单区间子集）', () => {
  it('常规与开区间', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange('bytes=500-9999', 1000)).toEqual({ start: 500, end: 999 });
  });

  it('后缀式：最后 N 字节（N 超大钳到 0）', () => {
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-9999', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('越界/非法 → invalid（416）；多区间/空 → null（走 200 全量）', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('invalid');
    expect(parseRange('bytes=-0', 1000)).toBe('invalid');
    expect(parseRange('bytes=5-2', 1000)).toBe('invalid');
    expect(parseRange('bytes=0-1,5-9', 1000)).toBeNull();
    expect(parseRange('bytes=-', 1000)).toBeNull();
    expect(parseRange('chunks=0-1', 1000)).toBeNull();
  });

  it('空文件不可满足', () => {
    expect(parseRange('bytes=0-', 0)).toBe('invalid');
  });
});
