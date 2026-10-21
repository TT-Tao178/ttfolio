/** 自动摘要规则锚点（FR-13.3 v2 / T-112）：目录聚类与摘要组装（MUST NOT 调 AI）。 */
import { describe, expect, it } from 'vitest';
import { clusterDirs, composeSummary } from '../core/sessionSummary.js';

describe('clusterDirs（目录聚类 Top5）', () => {
  it('按首段聚合、计数倒序、根目录单独归类', () => {
    const d = clusterDirs(['src/a.ts', 'src/b.ts', 'docs/x.md', 'README.md']);
    expect(d[0]).toEqual({ dir: 'src', count: 2 });
    expect(d.some((x) => x.dir === '（根目录）')).toBe(true);
    expect(d.some((x) => x.dir === 'docs')).toBe(true);
  });

  it('超过 5 类只留前 5', () => {
    const dirs = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((x) => [`${x}/1.ts`, `${x}/2.ts`]);
    expect(clusterDirs(dirs)).toHaveLength(5);
  });
});

describe('composeSummary（自动摘要）', () => {
  const base = {
    startedAt: '2026-10-22T10:00:00.000Z',
    endedAt: '2026-10-22T10:20:00.000Z',
    files: [
      { path: 'src/a.ts', changeCount: 3 },
      { path: 'src/b.ts', changeCount: 1 },
    ],
  };

  it('git 项目：含时段/文件数/±行/目录分布/主要文件', () => {
    const s = composeSummary({
      ...base,
      git: { added: 12, deleted: 3, numstatFiles: 2, commits: ['abc123 修 bug'] },
      isRepo: true,
    });
    expect(s).toContain('时间段');
    expect(s).toContain('文件：2 个');
    expect(s).toContain('+12 / −3');
    expect(s).toContain('目录分布：src（2）');
    expect(s).toContain('src/a.ts×3');
    expect(s).toContain('期间提交：abc123 修 bug');
  });

  it('非 git 项目：诚实降级为「无法统计增删行」', () => {
    const s = composeSummary({ ...base, git: null, isRepo: false });
    expect(s).toContain('非 git 项目，无法统计增删行');
  });

  it('git 但无差异：如实说明', () => {
    const s = composeSummary({
      ...base,
      git: { added: 0, deleted: 0, numstatFiles: 0, commits: [] },
      isRepo: true,
    });
    expect(s).toContain('相对会话起点无差异');
  });
});
