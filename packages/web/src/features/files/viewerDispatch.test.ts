/** resolveViewer 纯函数锚点（FR-13.9 / T-106a）。 */
import { describe, expect, it } from 'vitest';
import { extOfPath, resolveViewer } from './viewerDispatch';

describe('resolveViewer（FR-13.9 预览分发器）', () => {
  it('Office 白名单走 office（大小写不敏感、含路径分隔）', () => {
    expect(resolveViewer('docs/设计.docx')).toBe('office');
    expect(resolveViewer('manual.PDF')).toBe('office');
    expect(resolveViewer('data/table.XLSX')).toBe('office');
    expect(resolveViewer('a/b.xls')).toBe('office');
  });

  it('图片走 image，其余走 editor', () => {
    expect(resolveViewer('img/logo.png')).toBe('image');
    expect(resolveViewer('a/b.WebP')).toBe('image');
    expect(resolveViewer('src/app.tsx')).toBe('editor');
    expect(resolveViewer('data/config.csv')).toBe('editor');
  });

  it('无扩展名与 .gitignore 类点文件落 editor', () => {
    expect(resolveViewer('LICENSE')).toBe('editor');
    expect(resolveViewer('.gitignore')).toBe('editor');
  });

  it('extOfPath 取末段扩展名', () => {
    expect(extOfPath('a.b.c.TXT')).toBe('txt');
    expect(extOfPath('noext')).toBe('');
  });
});
