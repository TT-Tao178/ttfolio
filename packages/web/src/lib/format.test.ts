/** openAgo（侧栏「最后打开」相对时间）分桶边界测试：注入固定 now，不依赖真实时钟。 */
import { describe, expect, it } from 'vitest';
import { openAgo } from './format';

const NOW = Date.parse('2026-10-12T12:00:00Z');

describe('openAgo（第 34 轮用户定制分桶）', () => {
  it('从未打开 / 空串 / 无法解析 → 空串（侧栏不占位）', () => {
    expect(openAgo(null, NOW)).toBe('');
    expect(openAgo(undefined, NOW)).toBe('');
    expect(openAgo('', NOW)).toBe('');
    expect(openAgo('not-a-date', NOW)).toBe('');
  });

  it('小于 1 分钟 → 1分钟内', () => {
    expect(openAgo('2026-10-12T12:00:00Z', NOW)).toBe('1分钟内');
    expect(openAgo('2026-10-12T11:59:30Z', NOW)).toBe('1分钟内');
  });

  it('大于等于 1 分钟 → N分钟前（含 1 分钟整与 59 分钟）', () => {
    expect(openAgo('2026-10-12T11:59:00Z', NOW)).toBe('1分钟前');
    expect(openAgo('2026-10-12T11:31:00Z', NOW)).toBe('29分钟前');
    expect(openAgo('2026-10-12T11:00:01Z', NOW)).toBe('59分钟前');
  });

  it('大于等于 1 小时 → N小时前（含 1 小时整与 22 小时）', () => {
    expect(openAgo('2026-10-12T11:00:00Z', NOW)).toBe('1小时前');
    expect(openAgo('2026-10-12T05:30:00Z', NOW)).toBe('6小时前');
    expect(openAgo('2026-10-11T13:00:01Z', NOW)).toBe('22小时前');
  });

  it('大于等于 1 天 → N天前（含 1 天整与 28 天）', () => {
    expect(openAgo('2026-10-11T12:00:00Z', NOW)).toBe('1天前');
    expect(openAgo('2026-10-05T00:00:00Z', NOW)).toBe('7天前');
    expect(openAgo('2026-09-13T12:00:01Z', NOW)).toBe('28天前');
  });

  it('30 天以上 → 日期（不再笼统写 N天前）', () => {
    const s = openAgo('2026-08-01T12:00:00Z', NOW);
    expect(s).not.toBe('');
    expect(s).not.toMatch(/天前$/);
  });

  it('未来时间（时钟偏差）按 1分钟内兜底', () => {
    expect(openAgo('2026-10-12T12:05:00Z', NOW)).toBe('1分钟内');
  });
});
