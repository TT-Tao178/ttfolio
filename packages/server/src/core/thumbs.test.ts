/** 回归锚点：缩略图管线 v2（FR-13.5 / T-113）——两级命名、白名单、配额 LRU、级联清理。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  THUMB_NAME_RE,
  TIER_PX,
  clearProjectThumbs,
  enforceQuota,
  isWebp,
  legacyThumbName,
  listThumbNames,
  thumbName,
  thumbsStats,
  writeThumb,
} from './thumbs.js';

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttfolio-thumbs-'));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** 最小合法 webp 头（RIFF + WEBP），用于写入与魔数测试。 */
function fakeWebp(size = 64): Buffer {
  const buf = Buffer.alloc(size, 0);
  buf.write('RIFF', 0, 'ascii');
  buf.write('WEBP', 8, 'ascii');
  return buf;
}

describe('两级命名与白名单（T-113）', () => {
  it('同一路径的 g/p 命名稳定且可区分；旧版 png 仍被白名单接受', () => {
    const g = thumbName('assets/a.jpg', 'g');
    const p = thumbName('assets/a.jpg', 'p');
    expect(g).toMatch(/^[0-9a-f]{40}@g\.webp$/);
    expect(p).toMatch(/^[0-9a-f]{40}@p\.webp$/);
    expect(g).not.toBe(p);
    expect(thumbName('assets/b.jpg', 'g')).not.toBe(g);
    expect(THUMB_NAME_RE.test(legacyThumbName('assets/a.jpg'))).toBe(true);
    expect(THUMB_NAME_RE.test('../../evil.webp')).toBe(false);
    expect(THUMB_NAME_RE.test(`${'a'.repeat(40)}@x.webp`)).toBe(false);
    expect(TIER_PX).toEqual({ g: 640, p: 1920 });
  });

  it('isWebp 只认 RIFF/WEBP 魔数', () => {
    expect(isWebp(fakeWebp())).toBe(true);
    expect(isWebp(Buffer.from('not-a-webp-file'))).toBe(false);
    expect(isWebp(Buffer.alloc(4))).toBe(false);
  });
});

describe('落盘 / 索引 / 级联（T-113）', () => {
  it('写入后出现在索引；非法文件名拒绝；级联清理只删本项目', () => {
    writeThumb(root, 'projA', thumbName('x.png', 'g'), fakeWebp());
    writeThumb(root, 'projA', thumbName('x.png', 'p'), fakeWebp());
    writeThumb(root, 'projB', thumbName('y.png', 'g'), fakeWebp());
    expect(listThumbNames(root, 'projA').sort()).toEqual(
      [thumbName('x.png', 'g'), thumbName('x.png', 'p')].sort(),
    );
    expect(listThumbNames(root, 'nope')).toEqual([]);
    expect(() => writeThumb(root, 'projA', '../escape.webp', fakeWebp())).toThrow();
    expect(clearProjectThumbs(root, 'projA')).toBe(2);
    expect(listThumbNames(root, 'projA')).toEqual([]);
    expect(listThumbNames(root, 'projB')).toHaveLength(1);
  });

  it('统计按项目汇总（数量/字节/总量）', () => {
    const stats = thumbsStats(root);
    expect(stats.totalCount).toBe(1);
    expect(stats.projects[0]).toMatchObject({ projectId: 'projB', count: 1 });
    expect(stats.totalBytes).toBeGreaterThan(0);
  });
});

describe('配额 LRU（T-113）', () => {
  it('超过上限时按 mtime 最旧优先删除，降到配额内即停', () => {
    const dir = path.join(root, 'quota');
    fs.mkdirSync(dir, { recursive: true });
    // 三个项目各一张 1KB 图，mtime 递增
    const sizes = 1024;
    const names: string[] = [];
    for (const pid of ['p1', 'p2', 'p3']) {
      const n = thumbName(`${pid}.png`, 'g');
      writeThumb(dir, pid, n, fakeWebp(sizes));
      names.push(path.join(dir, pid, n));
    }
    const now = Date.now();
    fs.utimesSync(names[0] ?? '', new Date(now - 30_000), new Date(now - 30_000));
    fs.utimesSync(names[1] ?? '', new Date(now - 20_000), new Date(now - 20_000));
    fs.utimesSync(names[2] ?? '', new Date(now - 10_000), new Date(now - 10_000));

    // 上限 2.5KB → 必须删掉最旧的 1 张
    const r = enforceQuota(dir, 2560);
    expect(r.removed).toBe(1);
    expect(fs.existsSync(names[0] ?? '')).toBe(false);
    expect(fs.existsSync(names[1] ?? '')).toBe(true);
    expect(fs.existsSync(names[2] ?? '')).toBe(true);

    // 上限足够时不删
    expect(enforceQuota(dir, 10 * 1024 * 1024)).toEqual({ removed: 0, freed: 0 });
  });
});
