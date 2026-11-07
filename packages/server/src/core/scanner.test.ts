/** 目录扫描器单测（FR-16.1 / T-132）：信号判定 / 忽略与已登记过滤 / 护栏截断。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanDirectory, SCAN_LIMITS } from './scanner.js';

let root = '';

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-scan-'));
  // 候选：含 package.json 的子目录（深度 1）
  fs.mkdirSync(path.join(root, 'proj-a'), { recursive: true });
  fs.writeFileSync(path.join(root, 'proj-a', 'package.json'), '{}');
  // 候选：深度 2 的嵌套项目
  fs.mkdirSync(path.join(root, 'workspace', 'proj-b'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workspace', 'proj-b', 'go.mod'), 'module x');
  // 非候选：空目录
  fs.mkdirSync(path.join(root, 'empty-dir'), { recursive: true });
  // 跳过：node_modules 下的"项目"（黑名单）
  fs.mkdirSync(path.join(root, 'node_modules', 'fake-proj'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'fake-proj', 'package.json'), '{}');
  // 候选但已登记/已忽略
  fs.mkdirSync(path.join(root, 'reg-proj'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reg-proj', 'README.md'), '# x');
  fs.mkdirSync(path.join(root, 'ignored-proj'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ignored-proj', 'README.md'), '# x');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('scanDirectory（FR-16.1 / T-132）', () => {
  it('信号判定 + 深度 2 内发现嵌套项目；node_modules/空目录不出候选', async () => {
    const r = await scanDirectory(root, { ignore: new Set(), isRegistered: () => false });
    const paths = r.candidates.map((c) => c.dirPath);
    expect(paths.some((p) => p.endsWith('proj-a'))).toBe(true);
    expect(paths.some((p) => p.endsWith('proj-b'))).toBe(true);
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
    expect(paths.some((p) => p.endsWith('empty-dir'))).toBe(false);
    const a = r.candidates.find((c) => c.dirPath.endsWith('proj-a'));
    expect(a?.matchedManifests).toContain('package.json');
  });

  it('已登记与忽略名单过滤', async () => {
    const r = await scanDirectory(root, {
      ignore: new Set([path.join(root, 'ignored-proj')]),
      isRegistered: (abs) => abs.endsWith('reg-proj'),
    });
    const paths = r.candidates.map((c) => c.dirPath);
    expect(paths.some((p) => p.endsWith('reg-proj'))).toBe(false);
    expect(paths.some((p) => p.endsWith('ignored-proj'))).toBe(false);
  });

  it('候选上限护栏：maxCandidates=1 时 truncated 如实标注', async () => {
    const r = await scanDirectory(root, {
      ignore: new Set([path.join(root, 'ignored-proj')]),
      isRegistered: () => false,
      maxCandidates: 1,
      maxScannedDirs: SCAN_LIMITS.maxScannedDirs,
      budgetMs: SCAN_LIMITS.budgetMs,
    });
    expect(r.candidates.length).toBe(1);
    expect(r.truncated).toBe(true);
  });
});
