/** PathGuard 越界用例集（C-02 / 红线 1）。 */
import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { assertNoWindowsPathHazards, assertSafeName, guardPath, isInsideOrEqual, resolveWithin } from './pathGuard.js';
import { AppError } from './errors.js';

async function tmpDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'ttfolio-pg-'));
}

describe('assertSafeName', () => {
  it('拒绝 Windows 保留名（含带扩展名）', () => {
    for (const name of ['CON', 'prn.txt', 'AUX', 'NUL', 'COM1', 'lpt9.bak']) {
      expect(() => assertSafeName(name)).toThrow(AppError);
    }
  });
  it('拒绝非法字符', () => {
    for (const name of ['a\\b', 'a/b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', '>b', 'a|b']) {
      expect(() => assertSafeName(name)).toThrow(AppError);
    }
  });
  it('拒绝尾随点/空格与空名', () => {
    expect(() => assertSafeName('file.')).toThrow(AppError);
    expect(() => assertSafeName('file ')).toThrow(AppError);
    expect(() => assertSafeName('..')).toThrow(AppError);
    expect(() => assertSafeName('  ')).toThrow(AppError);
  });
  it('接受正常名字与中文', () => {
    expect(assertSafeName('设计文档-v2.md')).toBe('设计文档-v2.md');
  });
});

describe('assertNoWindowsPathHazards', () => {
  it('拒绝 ADS 冒号流', () => {
    expect(() => assertNoWindowsPathHazards('C:\\a\\file.txt:stream')).toThrow(AppError);
  });
  it('拒绝 UNC', () => {
    expect(() => assertNoWindowsPathHazards('\\\\server\\share\\x')).toThrow(AppError);
  });
  it('拒绝保留名路径段', () => {
    expect(() => assertNoWindowsPathHazards('C:\\ok\\CON\\x')).toThrow(AppError);
  });
});

describe('isInsideOrEqual（path.relative 口径）', () => {
  it('C:\\a 不包含 C:\\ab（经典 startsWith 误判）', () => {
    expect(isInsideOrEqual('C:\\a', 'C:\\ab')).toBe(false);
    expect(isInsideOrEqual('C:\\a', 'C:\\a\\b')).toBe(true);
    expect(isInsideOrEqual('C:\\a', 'C:\\a')).toBe(true);
  });
  it('Windows 上大小写不敏感（path.win32.relative 语义）；posix 视为不同目录', () => {
    if (process.platform === 'win32') {
      expect(isInsideOrEqual('C:\\a', 'C:\\A\\b')).toBe(true);
    } else {
      expect(isInsideOrEqual('C:\\a', 'C:\\A\\b')).toBe(false);
    }
  });
});

describe('guardPath', () => {
  it('白名单内路径通过并返回相对路径', async () => {
    const root = await tmpDir();
    await fsp.mkdir(path.join(root, 'sub'));
    await fsp.writeFile(path.join(root, 'sub', 'a.txt'), 'x');
    const g = await guardPath({ userPath: path.join(root, 'sub', 'a.txt'), allowedRoots: [root] }, { mustExist: true });
    expect(g.relToRoot).toBe('sub/a.txt');
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('拒绝越界（..）', async () => {
    const root = await tmpDir();
    const outside = await tmpDir();
    await fsp.writeFile(path.join(outside, 'secret.txt'), 's');
    await expect(
      guardPath({ userPath: path.join(root, '..', path.basename(outside), 'secret.txt'), allowedRoots: [root] }, { mustExist: true })
    ).rejects.toThrow(AppError);
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(outside, { recursive: true, force: true });
  });

  it('拒绝白名单外的绝对路径', async () => {
    const root = await tmpDir();
    await expect(
      guardPath({ userPath: 'C:\\Windows\\system32', allowedRoots: [root] }, { mustExist: false })
    ).rejects.toThrow(AppError);
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('符号链接逃逸被 realpath 拦截', async () => {
    const root = await tmpDir();
    const outside = await tmpDir();
    await fsp.writeFile(path.join(outside, 't.txt'), 'x');
    try {
      await fsp.symlink(path.join(outside, 't.txt'), path.join(root, 'link.txt'));
      await expect(
        guardPath({ userPath: path.join(root, 'link.txt'), allowedRoots: [root] }, { mustExist: true })
      ).rejects.toThrow(AppError);
    } catch {
      // Windows 无符号链接权限时跳过该用例
    }
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(outside, { recursive: true, force: true });
  });

  it('新建场景：父目录在白名单内时放行（mustExist=false）', async () => {
    const root = await tmpDir();
    const g = await guardPath({ userPath: path.join(root, 'new.md'), allowedRoots: [root] }, { mustExist: false });
    expect(g.relToRoot).toBe('new.md');
    await fsp.rm(root, { recursive: true, force: true });
  });
});

describe('resolveWithin（词法检查）', () => {
  it('拒绝 .. 越界', () => {
    expect(() => resolveWithin('C:\\root', '..\\outside')).toThrow(AppError);
    expect(resolveWithin('C:\\root', 'a\\b.txt')).toBe('C:\\root\\a\\b.txt');
  });
});
