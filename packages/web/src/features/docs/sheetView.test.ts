/** 表格预览数据模型（P1 修复）单测：链接白名单、合并单元格、截断上限。 */
import { describe, expect, it } from 'vitest';
import { buildSheetGrid, isSafeExternalUrl } from './sheetView';

describe('isSafeExternalUrl', () => {
  it('只放行 http/https', () => {
    expect(isSafeExternalUrl('https://example.com/a')).toBe(true);
    expect(isSafeExternalUrl('http://127.0.0.1:7717/x')).toBe(true);
  });

  it('拦掉脚本类与相对路径', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('JavaScript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('java\nscript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeExternalUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeExternalUrl('file:///C:/Windows/win.ini')).toBe(false);
    expect(isSafeExternalUrl('./relative.html')).toBe(false);
    expect(isSafeExternalUrl('')).toBe(false);
    expect(isSafeExternalUrl(undefined)).toBe(false);
  });
});

describe('buildSheetGrid', () => {
  it('按 !ref 铺格子，优先用格式化值 w', () => {
    const grid = buildSheetGrid({
      '!ref': 'A1:B2',
      A1: { v: 1, w: '1.00' },
      B1: { v: 'text' },
      A2: { v: 0.5, w: '50%' },
    });
    expect(grid.rows).toHaveLength(2);
    expect(grid.rows[0]?.[0]?.text).toBe('1.00');
    expect(grid.rows[0]?.[1]?.text).toBe('text');
    expect(grid.rows[1]?.[0]?.text).toBe('50%');
    expect(grid.rows[1]?.[1]?.text).toBe('');
  });

  it('合并单元格：锚点带 span，覆盖格为 null', () => {
    const grid = buildSheetGrid({
      '!ref': 'A1:C2',
      A1: { v: '标题' },
      '!merges': [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }],
    });
    expect(grid.rows[0]?.[0]).toMatchObject({ text: '标题', colSpan: 3, rowSpan: 1 });
    expect(grid.rows[0]?.[1]).toBeNull();
    expect(grid.rows[0]?.[2]).toBeNull();
  });

  it('危险超链接降级为纯文本（href=null）', () => {
    const grid = buildSheetGrid({
      '!ref': 'A1:A2',
      A1: { v: 'bad', l: { Target: 'javascript:alert(1)' } },
      A2: { v: 'good', l: { Target: 'https://example.com/doc' } },
    });
    expect(grid.rows[0]?.[0]?.href).toBeNull();
    expect(grid.rows[1]?.[0]?.href).toBe('https://example.com/doc');
  });

  it('超大表截断并标记 truncated', () => {
    const grid = buildSheetGrid({ '!ref': 'A1:B3000' });
    expect(grid.rows).toHaveLength(2000);
    expect(grid.truncated).toBe(true);
  });

  it('真实 xlsx 往返后仍能正确铺格子（合并 + 链接 + 格式化值）', async () => {
    // 走一遍真实读写：确保 SheetJS 产出的工作表对象形状与我们的模型假设一致
    const XLSX = await import('xlsx');
    const ws = {
      '!ref': 'A1:C2',
      A1: { t: 's', v: '标题' },
      A2: { t: 's', v: '链接', l: { Target: 'https://example.com/x' } },
      B2: { t: 's', v: '危险', l: { Target: 'javascript:alert(1)' } },
      C2: { t: 'n', v: 0.256, z: '0.0%' },
      '!merges': [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }],
      '!cols': [{ wch: 10 }, { wch: 10 }, { wch: 10 }],
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws as never, 'S1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const back = XLSX.read(buf, { type: 'buffer' });
    const grid = buildSheetGrid(back.Sheets[back.SheetNames[0] as string] as never);
    expect(grid.rows[0]?.[0]).toMatchObject({ text: '标题', colSpan: 3 });
    expect(grid.rows[0]?.[1]).toBeNull();
    expect(grid.rows[1]?.[0]?.href).toBe('https://example.com/x');
    expect(grid.rows[1]?.[1]?.href).toBeNull();
    expect(grid.rows[1]?.[2]?.text).toBe('25.6%');
  });

  it('没有 !ref 时返回空网格', () => {
    expect(buildSheetGrid({}).rows).toHaveLength(0);
  });

  it('单元格文本过长会截断（防巨型 DOM）', () => {
    const grid = buildSheetGrid({ '!ref': 'A1', A1: { v: 'x'.repeat(9000) } });
    expect((grid.rows[0]?.[0]?.text ?? '').length).toBeLessThan(4100);
  });
});
