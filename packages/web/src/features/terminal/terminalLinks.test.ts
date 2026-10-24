/** terminalLinks 纯函数单测（T-124）：路径抽取与项目配对是 hover 高频路径，规则锁死防误伤。 */
import { describe, expect, it } from 'vitest';
import { extractPathsFromLine, matchProjectPath } from './terminalLinks';

const projects = [
  { id: 'p1', dirPath: 'D:\\demo\\alpha' },
  { id: 'p2', dirPath: 'D:\\demo\\alpha\\packages\\web' },
  { id: 'p3', dirPath: 'E:\\work\\beta' },
];

describe('matchProjectPath', () => {
  it('绝对路径命中项目根 → relPath 为空串', () => {
    expect(matchProjectPath('D:\\demo\\alpha', projects)).toEqual({ projectId: 'p1', relPath: '' });
  });

  it('项目子路径命中，relPath 用 / 分隔', () => {
    expect(matchProjectPath('D:\\demo\\alpha\\src\\index.ts', projects)).toEqual({
      projectId: 'p1',
      relPath: 'src/index.ts',
    });
  });

  it('嵌套登记时最长前缀胜出（p2 比 p1 深）', () => {
    expect(matchProjectPath('D:/demo/alpha/packages/web/src/a.ts', projects)?.projectId).toBe('p2');
  });

  it('大小写与分隔符不敏感', () => {
    expect(matchProjectPath('e:/WORK/beta/README.md', projects)?.projectId).toBe('p3');
  });

  it('项目外路径返回 null（降级复制）', () => {
    expect(matchProjectPath('D:\\somewhere\\else\\x.ts', projects)).toBeNull();
  });
});

describe('extractPathsFromLine', () => {
  it('抽出绝对路径并配对项目', () => {
    const links = extractPathsFromLine('error in D:\\demo\\alpha\\src\\a.ts at line 3', {
      projects,
      cwdProjectId: null,
    });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      start: 9,
      end: 31,
      text: 'D:\\demo\\alpha\\src\\a.ts',
      projectId: 'p1',
      relPath: 'src/a.ts',
    });
  });

  it('tsc 错误格式 path(12,5): 括号截断，行号不入路径', () => {
    const links = extractPathsFromLine('D:\\demo\\alpha\\src\\a.ts(12,5): error TS2345', {
      projects,
      cwdProjectId: null,
    });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ text: 'D:\\demo\\alpha\\src\\a.ts', projectId: 'p1' });
  });

  it('node 栈格式 path:12:5 剥行号尾缀', () => {
    const links = extractPathsFromLine('at D:\\demo\\alpha\\src\\a.ts:12:5', {
      projects,
      cwdProjectId: null,
    });
    expect(links).toHaveLength(1);
    expect(links[0]?.text).toBe('D:\\demo\\alpha\\src\\a.ts');
  });

  it('项目外绝对路径保留为降级复制候选', () => {
    const links = extractPathsFromLine('see C:\\other\\x.ts', { projects, cwdProjectId: null });
    expect(links[0]?.projectId).toBeNull();
    expect(links[0]?.relPath).toBeNull();
  });

  it('剥尾部标点：句号与右括号不属于路径', () => {
    const links = extractPathsFromLine('(D:\\demo\\alpha\\src\\a.ts).', { projects, cwdProjectId: null });
    expect(links[0]?.text).toBe('D:\\demo\\alpha\\src\\a.ts');
  });

  it('cwd 在项目内时识别相对路径并归到当前项目', () => {
    const links = extractPathsFromLine('built src/app/main.ts ok', { projects, cwdProjectId: 'p1' });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ text: 'src/app/main.ts', projectId: 'p1', relPath: 'src/app/main.ts' });
  });

  it('URL 片段与紧邻分隔符的候选不识别（https:// 的 s:// 不当盘符）', () => {
    const links = extractPathsFromLine('GET https://example.com/static/app.js done', {
      projects,
      cwdProjectId: 'p1',
    });
    expect(links).toHaveLength(0);
  });

  it('与绝对路径重叠的相对片段去重不重复出链', () => {
    const links = extractPathsFromLine('D:\\demo\\alpha\\src\\a.ts ok', { projects, cwdProjectId: 'p1' });
    expect(links).toHaveLength(1);
    expect(links[0]?.projectId).toBe('p1');
  });

  it('无扩展名的多段词不算相对路径（保守不误伤）', () => {
    expect(extractPathsFromLine('node server/dist/main', { projects, cwdProjectId: 'p1' })).toHaveLength(0);
  });

  it('每行链接数有上限（防御病态输出）', () => {
    const line = Array.from({ length: 100 }, (_, i) => `D:\\demo\\alpha\\f${i}.ts`).join(' ');
    const links = extractPathsFromLine(line, { projects, cwdProjectId: null });
    expect(links.length).toBeLessThanOrEqual(32);
  });
});
