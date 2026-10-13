/** parseSubTab 纯函数单测（第 33 轮）——集合过滤分支是 0.2.8 修复（4823f5d）的回归锚点。 */
import { describe, expect, it } from 'vitest';
import { parseSubTab } from './parseSubTab';

describe('parseSubTab', () => {
  it('null → 工作台总览（status=active）', () => {
    expect(parseSubTab(null)).toEqual({ status: 'active' });
  });

  it('view:recent → 按最近打开排序', () => {
    expect(parseSubTab('view:recent')).toEqual({ status: 'active', sort: 'last_opened' });
  });

  it('view:pinned → 仅 status', () => {
    expect(parseSubTab('view:pinned')).toEqual({ status: 'active' });
  });

  it('view:my-* 六个内置视图映射', () => {
    expect(parseSubTab('view:my-dirty')).toEqual({ status: 'active', dirty: '1' });
    expect(parseSubTab('view:my-nodocs')).toEqual({ status: 'active', hasDocs: '0' });
    expect(parseSubTab('view:my-noarch')).toEqual({ status: 'active', hasArch: '0' });
    expect(parseSubTab('view:my-unanalyzed')).toEqual({ status: 'active', analyzed: '0' });
    expect(parseSubTab('view:my-stale')).toEqual({ status: 'active', stale: '30' });
    expect(parseSubTab('view:my-archived')).toEqual({ status: 'archived' });
    expect(parseSubTab('view:my-unknown')).toEqual({ status: 'active' });
  });

  it('col:<id> → 集合过滤参数（回归锚点：此前只返回 status 导致集合视图显示全部项目）', () => {
    expect(parseSubTab('col:01ABC')).toEqual({ status: 'active', collection: '01ABC' });
  });

  it('tag:<id> → 标签过滤参数（第 36 轮 A2 补齐 KNOWN-GAPS #8，与 col: 同构）', () => {
    expect(parseSubTab('tag:01XYZ')).toEqual({ status: 'active', tag: '01XYZ' });
    expect(parseSubTab('tag:')).toEqual({ status: 'active', tag: '' });
  });

  it('JSON 分支透传筛选参数', () => {
    expect(parseSubTab('{"status":"archived","q":"demo"}')).toEqual({ status: 'archived', q: 'demo' });
  });

  it('非法 JSON 回落默认', () => {
    expect(parseSubTab('{broken')).toEqual({ status: 'active' });
  });

  it('未知前缀回落默认', () => {
    expect(parseSubTab('weird')).toEqual({ status: 'active' });
  });
});
