/**
 * 忽略规则（FS-9）：内置默认 + 用户规则，glob 语义，
 * 在所有遍历点（分析/文件树/搜索/监听/内容索引）统一生效。
 */
import type { IgnoreRule } from '@ttfolio/shared';
import { SENSITIVE_FILE_PATTERNS } from '@ttfolio/shared';

export interface CompiledIgnore {
  /** 相对路径（/ 分隔）是否被 hide 规则命中（不显示不统计） */
  isHidden(relPath: string): boolean;
  /** 相对路径是否被 analyze_only 规则命中（显示但不统计） */
  isAnalyzeOnly(relPath: string): boolean;
  /** 是否敏感文件（不进内容索引，但不在树中隐藏） */
  isSensitive(relPath: string): boolean;
}

interface GlobMatcher {
  regex: RegExp;
  mode: 'hide' | 'analyze_only';
  hasSlash: boolean;
}

export function globToRegex(pattern: string): RegExp {
  let re = '';
  const p = pattern.trim();
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === undefined) break;
    if (ch === '*') {
      if (p[i + 1] === '*') {
        re += '.*';
        i++;
        if (p[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

export function compileIgnore(rules: IgnoreRule[]): CompiledIgnore {
  const matchers: GlobMatcher[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const cleaned = rule.pattern.trim().replace(/^\//, '').replace(/\/$/, '');
    if (cleaned === '') continue;
    matchers.push({
      regex: globToRegex(cleaned.toLowerCase()),
      mode: rule.mode,
      hasSlash: cleaned.includes('/'),
    });
  }

  const matchAny = (relPath: string, mode: 'hide' | 'analyze_only'): boolean => {
    const lower = relPath.toLowerCase();
    const segments = lower.split('/');
    for (const m of matchers) {
      if (m.mode !== mode) continue;
      if (m.hasSlash) {
        if (m.regex.test(lower)) return true;
      } else {
        for (const seg of segments) {
          if (m.regex.test(seg)) return true;
        }
      }
    }
    return false;
  };

  return {
    isHidden: (rel) => matchAny(rel, 'hide'),
    isAnalyzeOnly: (rel) => matchAny(rel, 'analyze_only'),
    isSensitive: (rel) => {
      const lower = rel.toLowerCase();
      const segments = lower.split('/');
      const fileName = segments[segments.length - 1] ?? '';
      if (SENSITIVE_FILE_PATTERNS.some((re) => re.test(fileName))) return true;
      if (SENSITIVE_FILE_PATTERNS.some((re) => re.test(lower))) return true;
      return false;
    },
  };
}

/** DDL/提示词中的默认忽略清单（内置规则，入库 is_builtin=1） */
export const BUILTIN_IGNORE_PATTERNS: Array<{ pattern: string; mode: 'hide' | 'analyze_only' }> = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'vendor',
  'Pods',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.gradle',
  '.cargo',
  'dist',
  'build',
  'out',
  'output',
  'target',
  'bin',
  'obj',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.parcel-cache',
  'coverage',
  'release',
  'DerivedData',
  '.idea',
  '.vscode',
  '.vs',
  '.DS_Store',
  'Thumbs.db',
  '*.log',
  '*.tmp',
  'tmp',
  'temp',
].map((pattern) => ({ pattern, mode: 'hide' as const }));

/** 敏感文件规则入库（mode 仅用于展示，敏感判定由 isSensitive 负责，且不从文件树隐藏） */
export const BUILTIN_SENSITIVE_PATTERNS: string[] = [
  '.env*',
  '*.pem',
  '*.key',
  '*.pfx',
  '*.keystore',
  'id_rsa*',
  '.npmrc',
  '.netrc',
  '.aws',
  '.ssh',
  'credentials*',
  'secrets*',
];
