/** 回归锚点：媒体识别与 Range 解析（FR-13.5 / T-099）。 */
import { describe, expect, it } from 'vitest';
import { mediaKindOf } from './media.js';

describe('mediaKindOf（扩展名 → 媒体类型）', () => {
  it('图/音/视频全映射，大小写不敏感', () => {
    expect(mediaKindOf('a.JPG')).toBe('image');
    expect(mediaKindOf('b.webp')).toBe('image');
    expect(mediaKindOf('c.avif')).toBe('image');
    expect(mediaKindOf('d.MP4')).toBe('video');
    expect(mediaKindOf('e.mkv')).toBe('video');
    expect(mediaKindOf('f.flac')).toBe('audio');
    expect(mediaKindOf('g.m4a')).toBe('audio');
  });

  it('路径中的目录点号不干扰；非媒体返回 null', () => {
    expect(mediaKindOf('src/v1.2/clip.mp4')).toBe('video');
    expect(mediaKindOf('readme.md')).toBeNull();
    expect(mediaKindOf('noext')).toBeNull();
    expect(mediaKindOf('archive.tar.gz')).toBeNull();
  });
});
