/** 自定义「我的视图」schema 单测（FR-4.11 / KNOWN-GAPS #5，第 62 轮）。 */
import { describe, expect, it } from 'vitest';
import { customViewsSchema, customViewSchema } from './schemas.js';

const base = { createdAt: '2026-10-22T00:00:00.000Z' };

describe('customViewSchema', () => {
  it('合法视图通过（含 ulidLike 的连字符 id）', () => {
    const r = customViewSchema.safeParse({
      id: 'TAB-M0001-AB12',
      name: '我负责的前端项目',
      filters: { status: 'active', type: 'frontend', stale: '14' },
      ...base,
    });
    expect(r.success).toBe(true);
  });

  it('id 过短（<10 字符）拒绝', () => {
    expect(customViewSchema.safeParse({ id: 'view01', name: 'x', filters: {}, ...base }).success).toBe(false);
  });

  it('未知筛选键拒绝', () => {
    const r = customViewSchema.safeParse({
      id: 'view000001',
      name: 'x',
      filters: { status: 'active', hacker: '1' },
      ...base,
    });
    expect(r.success).toBe(false);
  });

  it('status / git 取值白名单', () => {
    expect(
      customViewSchema.safeParse({ id: 'view000001', name: 'x', filters: { status: 'weird' }, ...base })
        .success,
    ).toBe(false);
    expect(
      customViewSchema.safeParse({ id: 'view000001', name: 'x', filters: { git: 'all' }, ...base }).success,
    ).toBe(false);
    expect(
      customViewSchema.safeParse({ id: 'view000001', name: 'x', filters: { git: 'nogit' }, ...base }).success,
    ).toBe(true);
  });

  it('stale 必须是 1..3650 整数', () => {
    expect(
      customViewSchema.safeParse({ id: 'view000001', name: 'x', filters: { stale: '0' }, ...base }).success,
    ).toBe(false);
    expect(
      customViewSchema.safeParse({ id: 'view000001', name: 'x', filters: { stale: '99999' }, ...base })
        .success,
    ).toBe(false);
    expect(
      customViewSchema.safeParse({ id: 'view000001', name: 'x', filters: { stale: '30' }, ...base }).success,
    ).toBe(true);
  });

  it('名称长度与列表上限', () => {
    expect(customViewSchema.safeParse({ id: 'view000001', name: '', filters: {}, ...base }).success).toBe(
      false,
    );
    expect(
      customViewSchema.safeParse({ id: 'view000001', name: '名'.repeat(51), filters: {}, ...base }).success,
    ).toBe(false);
    const many = Array.from({ length: 31 }, (_, i) => ({
      id: `view${String(i).padStart(7, '0')}`,
      name: `v${i}`,
      filters: {},
      ...base,
    }));
    expect(customViewsSchema.safeParse(many).success).toBe(false);
    expect(customViewsSchema.safeParse(many.slice(0, 30)).success).toBe(true);
  });
});
