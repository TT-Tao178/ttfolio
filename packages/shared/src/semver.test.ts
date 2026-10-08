/** semverNewer 纯函数单测（第 33 轮）——检查更新的版本比较回归锚点。 */
import { describe, expect, it } from 'vitest';
import { semverNewer } from './semver';

describe('semverNewer', () => {
  it('三段比较', () => {
    expect(semverNewer('0.2.13', '0.2.12')).toBe(true);
    expect(semverNewer('0.2.12', '0.2.13')).toBe(false);
    expect(semverNewer('0.2.12', '0.2.12')).toBe(false);
  });

  it('进位比较（0.2.9 < 0.2.10——数值而非字典序的回归锚点）', () => {
    expect(semverNewer('0.2.10', '0.2.9')).toBe(true);
    expect(semverNewer('0.2.9', '0.2.10')).toBe(false);
    expect(semverNewer('0.10.0', '0.9.9')).toBe(true);
  });

  it('忽略 v 前缀与大小写', () => {
    expect(semverNewer('v1.0.0', '0.9.9')).toBe(true);
    expect(semverNewer('V1.0.0', '1.0.0')).toBe(false);
  });

  it('忽略预发布/构建后缀', () => {
    expect(semverNewer('1.0.0-beta.1', '1.0.0')).toBe(false);
    expect(semverNewer('1.0.1+build.2', '1.0.0')).toBe(true);
  });

  it('两段/缺段按 0 补齐', () => {
    expect(semverNewer('1.1', '1.0.9')).toBe(true);
    expect(semverNewer('1', '0.99.99')).toBe(true);
  });

  it('解析失败的段按 0 处理（脏 tag 不崩溃）', () => {
    expect(semverNewer('abc', '0.0.1')).toBe(false);
    expect(semverNewer('0.0.2', 'abc')).toBe(true);
  });
});
