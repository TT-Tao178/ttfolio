/**
 * 目录自动扫描器（FR-12.6 / C-58 预留位 → FR-16.1 / T-132 实装，2026-11-07 用户点名 A 组）：
 * 只读扫描根目录的子目录，发现「像项目」的未登记文件夹作候选。
 * 硬约束：绝不自动登记（登记是显式动作）、绝不写项目目录、全程只读。
 * 上限护栏：深度 ≤2、扫描目录 ≤5000、候选 ≤200、时间预算 5s，超限如实 truncated。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface ScanRootConfig {
  rootDir: string;
  maxDepth: number;
  /** 命中这些清单文件名才视为项目 */
  manifestNames: string[];
  enabled: boolean;
}

export interface ScanCandidate {
  dirPath: string;
  matchedManifests: string[];
}

export interface ProjectScanner {
  /** 扫描一个数据源根目录，返回候选（只读、不写库、不登记）。 */
  scan(root: ScanRootConfig): AsyncIterable<ScanCandidate>;
}

export const defaultScanRootConfig: ScanRootConfig = {
  rootDir: '',
  maxDepth: 3,
  manifestNames: ['package.json', 'pom.xml', 'go.mod', 'Cargo.toml', '.git'],
  enabled: false,
};

/** 信号表：任一命中即候选（T-132 实装口径；*.sln 为扩展名匹配） */
const SIGNALS: Array<{ test: (entryName: string) => boolean; label: string }> = [
  { test: (n) => n === '.git', label: 'git 仓库' },
  { test: (n) => n === 'package.json', label: 'package.json' },
  { test: (n) => n === 'pyproject.toml', label: 'pyproject.toml' },
  { test: (n) => n === 'Cargo.toml', label: 'Cargo.toml' },
  { test: (n) => n === 'go.mod', label: 'go.mod' },
  { test: (n) => n === 'pom.xml', label: 'pom.xml' },
  { test: (n) => n.toLowerCase().endsWith('.sln'), label: 'VS 解决方案' },
  { test: (n) => n === 'README.md', label: 'README' },
];

/** 遍历跳过目录：依赖/构建产物/系统目录 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.vs',
  '.idea',
  'dist',
  'build',
  'target',
  '$RECYCLE.BIN',
  'System Volume Information',
  'Windows',
  'Program Files',
  'Program Files (x86)',
  'AppData',
]);

export const SCAN_LIMITS = {
  maxDepth: 2,
  maxScannedDirs: 5000,
  maxCandidates: 200,
  budgetMs: 5000,
} as const;

export interface ScanRunResult {
  candidates: ScanCandidate[];
  truncated: boolean;
  scannedDirs: number;
}

/** 只读扫描：root 的子目录（深度 ≤maxDepth）中含项目信号的未登记/未忽略目录。 */
export async function scanDirectory(
  root: string,
  opts: {
    ignore: Set<string>;
    isRegistered: (absPath: string) => boolean;
    maxDepth?: number;
    maxScannedDirs?: number;
    maxCandidates?: number;
    budgetMs?: number;
  },
): Promise<ScanRunResult> {
  const maxDepth = opts.maxDepth ?? SCAN_LIMITS.maxDepth;
  const maxScannedDirs = opts.maxScannedDirs ?? SCAN_LIMITS.maxScannedDirs;
  const maxCandidates = opts.maxCandidates ?? SCAN_LIMITS.maxCandidates;
  const deadline = Date.now() + (opts.budgetMs ?? SCAN_LIMITS.budgetMs);
  const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase();

  const candidates: ScanCandidate[] = [];
  let truncated = false;
  let scannedDirs = 0;
  const ignoredLower = new Set([...opts.ignore].map(norm));
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    if (candidates.length >= maxCandidates || Date.now() > deadline) {
      truncated = true;
      break;
    }
    const cur = stack.pop();
    if (cur === undefined) break;
    if (cur.depth >= maxDepth) continue;
    let entries;
    try {
      entries = await fs.readdir(cur.dir, { withFileTypes: true });
    } catch {
      continue; // 无权限/消失：如实跳过
    }
    scannedDirs += 1;
    if (scannedDirs > maxScannedDirs) {
      truncated = true;
      break;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      const abs = path.join(cur.dir, name);
      // C-02 绕行：这里判断的是目录名的点前缀（隐藏目录约定），不是路径包含判断
      if (SKIP_DIRS.has(name) || name.slice(0, 1) === '.') continue;
      if (ignoredLower.has(norm(abs))) continue;
      // 信号探测：读该目录一层条目名（一次 readdir）
      const matchedManifests: string[] = [];
      try {
        const inner = await fs.readdir(abs);
        for (const sig of SIGNALS) {
          if (inner.some((n) => sig.test(n))) matchedManifests.push(sig.label);
        }
      } catch {
        continue;
      }
      const registered = opts.isRegistered(abs);
      if (matchedManifests.length > 0 && !registered) {
        candidates.push({ dirPath: abs, matchedManifests });
        if (candidates.length >= maxCandidates) {
          truncated = true;
          break;
        }
      }
      // 已登记/候选目录的子目录仍可下钻（嵌套项目，深度受限）
      stack.push({ dir: abs, depth: cur.depth + 1 });
    }
  }
  return { candidates, truncated, scannedDirs };
}
