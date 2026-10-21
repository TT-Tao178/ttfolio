/** computeViewDiff 纯函数锚点（FR-13.9 ③ / T-106c）。 */
import { describe, expect, it } from 'vitest';
import type { ArchiveInfo } from '@ttfolio/shared';
import { capList, computeViewDiff } from './viewDiff';

function info(viewSnapshot: ArchiveInfo['viewSnapshot'], rels: string[]): ArchiveInfo {
  return {
    id: 'a1',
    label: null,
    dirPath: 'D:/demo/arch',
    entryRel: 'index.html',
    entrySource: 'index_html',
    htmlCount: rels.length,
    totalBytes: 0,
    isDefault: false,
    lastSeenAt: null,
    lastViewedAt: null,
    changed: true,
    sourceJsonFiles: [],
    htmlFiles: rels.map((rel) => ({ rel, mtime: '', size: 0, hasSourceJson: false })),
    imageFiles: [],
    textFiles: [],
    viewSnapshot,
  };
}

describe('computeViewDiff（FR-13.9 ③ 架构图变更明细）', () => {
  it('有快照时给出增减两组清单', () => {
    const d = computeViewDiff(
      info({ viewedAt: '2026-10-20T00:00:00.000Z', files: ['index.html', 'old.html'] }, [
        'index.html',
        'new.html',
      ]),
    );
    expect(d.hasSnapshot).toBe(true);
    expect(d.added).toEqual(['new.html']);
    expect(d.removed).toEqual(['old.html']);
    expect(d.viewedAt).toBe('2026-10-20T00:00:00.000Z');
  });

  it('无快照诚实降级（hasSnapshot=false）', () => {
    const d = computeViewDiff(info(null, ['index.html']));
    expect(d.hasSnapshot).toBe(false);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('清单无增减时两组为空', () => {
    const d = computeViewDiff(info({ viewedAt: 'x', files: ['index.html'] }, ['index.html']));
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('capList 截断并聚合余量', () => {
    expect(capList(['a', 'b', 'c'], 2)).toEqual({ shown: ['a', 'b'], rest: 1 });
    expect(capList(['a'], 3)).toEqual({ shown: ['a'], rest: 0 });
  });
});
