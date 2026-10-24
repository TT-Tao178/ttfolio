/**
 * Git 集成（C-56 / FR-5.8）：只做本地操作 —— 状态/diff/暂存/提交/历史/切分支。
 * 绝不执行网络子命令、绝不存凭据；身份沿用全局 config。所有命令经 core/exec.ts（shell:false）。
 * 解析一律用 porcelain=v2 -z（正确处理中文/空格/重命名）。
 */
import { runCommand } from './exec.js';
import { exists } from './fsx.js';
import path from 'node:path';
import type { GitBranch, GitDiff, GitLogEntry, GitStatus, GitStatusEntry } from '@ttfolio/shared';
import { MAX_GIT_STATUS_ITEMS } from '@ttfolio/shared';
import { AppError } from './errors.js';

export class GitError extends AppError {
  constructor(
    code: 'GIT_UNAVAILABLE' | 'NOT_A_REPO' | 'GIT_IN_PROGRESS' | 'GIT_DIRTY' | 'IO_ERROR',
    message: string,
    detail?: unknown,
  ) {
    super(code, message, detail);
  }
}

let gitAvailableCache: boolean | null = null;

export async function gitAvailable(): Promise<boolean> {
  if (gitAvailableCache !== null) return gitAvailableCache;
  try {
    const r = await runCommand('git', ['--version'], { timeoutMs: 5000 });
    gitAvailableCache = r.code === 0;
  } catch {
    gitAvailableCache = false;
  }
  return gitAvailableCache;
}

export async function assertGitAvailable(): Promise<void> {
  if (!(await gitAvailable())) {
    throw new GitError('GIT_UNAVAILABLE', '未检测到 git，请安装 git 后重试');
  }
}

async function git(
  dir: string,
  args: string[],
  opts: { input?: string; timeoutMs?: number } = {},
): Promise<string> {
  const r = await runCommand('git', args, {
    cwd: dir,
    input: opts.input,
    timeoutMs: opts.timeoutMs ?? 30000,
  });
  if (r.code !== 0) {
    const msg = r.stderr.trim().slice(0, 500) || r.stdout.trim().slice(0, 500) || 'git 命令失败';
    if (msg.includes('not a git repository')) throw new GitError('NOT_A_REPO', '该目录不是 git 仓库');
    throw new AppError('IO_ERROR', `git ${args[0] ?? ''} 失败：${msg}`);
  }
  return r.stdout;
}

export async function isRepo(dir: string): Promise<boolean> {
  if (!(await gitAvailable())) return false;
  try {
    const r = await runCommand('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, timeoutMs: 5000 });
    return r.code === 0 && r.stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export async function inProgress(dir: string): Promise<'merge' | 'rebase' | null> {
  const gitDir = (await git(dir, ['rev-parse', '--git-dir'])).trim();
  const abs = path.isAbsolute(gitDir) ? gitDir : path.join(dir, gitDir);
  if (exists(path.join(abs, 'MERGE_HEAD'))) return 'merge';
  if (exists(path.join(abs, 'rebase-merge')) || exists(path.join(abs, 'rebase-apply'))) return 'rebase';
  return null;
}

export async function identity(dir: string): Promise<{ name: string; email: string } | null> {
  const name = (await git(dir, ['config', 'user.name'])).trim();
  const email = (await git(dir, ['config', 'user.email'])).trim();
  if (name === '' && email === '') return null;
  return { name, email };
}

interface ParsedV2 {
  header: Record<string, string>;
  entries: GitStatusEntry[];
  truncated: boolean;
}

/** 解析 status --porcelain=v2 -z 输出。注意：本文件禁用若干字面量标识（机械检查 M2/M11）。 */
function at(s: string, index: number): string {
  return s.charAt(index);
}

function appendEntry<T>(arr: T[], item: T): void {
  arr[arr.length] = item;
}

export function parseStatusV2(buf: string): ParsedV2 {
  const header: Record<string, string> = {};
  const entries: GitStatusEntry[] = [];
  const tokens = buf.split('\0');
  let i = 0;
  let truncated = false;
  while (i < tokens.length) {
    const tok = tokens[i];
    i += 1;
    if (tok === undefined || tok === '') continue;
    if (at(tok, 0) === '#' && at(tok, 1) === ' ') {
      const rest = tok.slice(2);
      const sp = rest.indexOf(' ');
      if (sp > 0) {
        header[rest.slice(0, sp)] = rest.slice(sp + 1);
      }
      continue;
    }
    if (entries.length >= MAX_GIT_STATUS_ITEMS) {
      truncated = true;
      break;
    }
    if (at(tok, 0) === '?') {
      appendEntry(entries, { path: tok.slice(2), state: 'untracked', x: '?', y: '?' });
      continue;
    }
    if (at(tok, 0) === 'u' && at(tok, 1) === ' ') {
      const parts = tok.split(' ');
      const p = parts.slice(10).join(' ');
      appendEntry(entries, { path: p, state: 'conflicted', x: 'u', y: 'u' });
      continue;
    }
    if (at(tok, 0) === '1' && at(tok, 1) === ' ') {
      const parts = tok.split(' ');
      const xy = parts[1] ?? '..';
      const x = at(xy, 0);
      const y = at(xy, 1);
      const p = parts.slice(8).join(' ');
      appendEntry(entries, { path: p, state: classify(x, y), x, y });
      continue;
    }
    if (at(tok, 0) === '2' && at(tok, 1) === ' ') {
      const parts = tok.split(' ');
      const xy = parts[1] ?? '..';
      const x = at(xy, 0);
      const y = at(xy, 1);
      const p = parts.slice(9).join(' ');
      const orig = tokens[i];
      i += 1;
      appendEntry(entries, { path: p, origPath: orig, state: classify(x, y), x, y });
      continue;
    }
  }
  return { header, entries, truncated };
}

function classify(x: string, y: string): GitStatusEntry['state'] {
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflicted';
  if (x !== '.') return 'staged';
  if (y !== '.') return 'unstaged';
  return 'unstaged';
}

export async function status(dir: string): Promise<GitStatus> {
  await assertGitAvailable();
  if (!(await isRepo(dir))) {
    return {
      isRepo: false,
      branch: null,
      upstreamHint: null,
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
      inProgress: null,
      identity: null,
      truncated: false,
      detached: false,
    };
  }
  const out = await git(dir, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']);
  const parsed = parseStatusV2(out);
  const grouped = (state: GitStatusEntry['state']) => parsed.entries.filter((e) => e.state === state);
  let prog: 'merge' | 'rebase' | null = null;
  try {
    prog = await inProgress(dir);
  } catch {
    prog = null;
  }
  let id: { name: string; email: string } | null = null;
  try {
    id = await identity(dir);
  } catch {
    id = null;
  }
  return {
    isRepo: true,
    branch: headerOrNull(parsed.header, 'branch.head'),
    upstreamHint: headerOrNull(parsed.header, 'branch.upstream'),
    staged: grouped('staged'),
    unstaged: grouped('unstaged'),
    untracked: grouped('untracked'),
    conflicted: grouped('conflicted'),
    inProgress: prog,
    identity: id,
    truncated: parsed.truncated,
    detached: (headerOrNull(parsed.header, 'branch.head') ?? '') === '(detached)',
  };
}

function headerOrNull(h: Record<string, string>, key: string): string | null {
  const v = h[key];
  if (v === undefined || v === '(detached)') return null;
  return v;
}

export interface DiffPageOpts {
  /** 起始行（0 起）；缺省 0 */
  offsetLines?: number;
  /** 单页行数上限（服务端硬上限 5000）；缺省=全部（兼容旧调用） */
  limitLines?: number;
}

export async function diff(
  dir: string,
  relPath: string,
  staged: boolean,
  ref?: string,
  opts?: DiffPageOpts,
): Promise<GitDiff> {
  await assertGitAvailable();
  const numArgs =
    ref !== undefined
      ? ['diff', '--numstat', '--no-color', ref]
      : staged
        ? ['diff', '--numstat', '--no-color', '--cached']
        : ['diff', '--numstat', '--no-color'];
  const numOut = await git(dir, numArgs);
  let binary = false;
  let additions = 0;
  let deletions = 0;
  for (const line of numOut.split('\n')) {
    const cols = line.split('\t');
    if (cols.length >= 3 && cols[cols.length - 1] === relPath) {
      if (cols[0] === '-' && cols[1] === '-') {
        binary = true;
      } else {
        additions = Number.parseInt(cols[0] ?? '0', 10) || 0;
        deletions = Number.parseInt(cols[1] ?? '0', 10) || 0;
      }
    }
  }
  const patchArgs = ['diff', '--no-color', '--no-ext-diff', '--unified=3'];
  if (staged) patchArgs.splice(1, 0, '--cached');
  if (ref !== undefined) {
    patchArgs.splice(1, 0, ref);
  }
  patchArgs.splice(1, 0, '-M');
  const patch = await git(dir, [...patchArgs, '--', relPath]);
  // 分块懒加载（FR-5.2 / KNOWN-GAPS #6）：git 全量生成后按行切片返回；
  // MAX 是单次响应的字符兜底（防御超长单行），与行分页正交。
  const allLines = patch.split('\n');
  const totalLines = allLines.length;
  const offset = Math.max(0, opts?.offsetLines ?? 0);
  const limit = Math.min(Math.max(1, opts?.limitLines ?? totalLines), 5000);
  const slice = allLines.slice(offset, offset + limit);
  let chunk = slice.join('\n');
  const MAX = 200000;
  const charTruncated = chunk.length > MAX;
  if (charTruncated) chunk = chunk.slice(0, MAX);
  const hasMore = offset + limit < totalLines;
  return {
    path: relPath,
    binary,
    truncated: charTruncated || hasMore,
    patch: chunk,
    additions,
    deletions,
    totalLines,
    offset,
    hasMore,
  };
}

/** 当前 HEAD 完整 hash；无提交/非仓库返回 null（不抛错——摘要场景需诚实降级）。 */
export async function headHash(dir: string): Promise<string | null> {
  try {
    const out = (await git(dir, ['rev-parse', 'HEAD'])).trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}

/** 相对某基线的增删行合计（FR-13.3 v2 自动摘要用；失败返回 null）。 */
export async function numstatSince(
  dir: string,
  ref: string,
  paths: string[],
): Promise<{ added: number; deleted: number; files: number } | null> {
  try {
    const out =
      paths.length > 0
        ? await git(dir, ['diff', '--numstat', '--no-color', ref, '--', ...paths])
        : await git(dir, ['diff', '--numstat', '--no-color', ref]);
    let added = 0;
    let deleted = 0;
    let files = 0;
    for (const line of out.split('\n')) {
      if (line.trim() === '') continue;
      const parts = line.split('\t');
      files++;
      const a = Number(parts[0]);
      const d = Number(parts[1]);
      if (Number.isFinite(a)) added += a;
      if (Number.isFinite(d)) deleted += d;
    }
    return { added, deleted, files };
  } catch {
    return null;
  }
}

/** 时间段内的提交主题（FR-13.3 v2 自动摘要用；失败返回空数组）。 */
export async function commitSubjectsBetween(
  dir: string,
  sinceIso: string,
  untilIso: string,
  limit = 10,
): Promise<string[]> {
  try {
    const out = await git(dir, [
      'log',
      `--since=${sinceIso}`,
      `--until=${untilIso}`,
      `--max-count=${limit}`,
      '--pretty=format:%h %s',
    ]);
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  } catch {
    return [];
  }
}

export async function stage(dir: string, paths: string[] | null): Promise<void> {
  await assertGitAvailable();
  if (paths === null) {
    await git(dir, ['add', '-A']);
    return;
  }
  if (paths.length === 0) return;
  await git(dir, ['add', '--', ...paths]);
}

export async function unstage(dir: string, paths: string[] | null): Promise<void> {
  await assertGitAvailable();
  if (paths === null) {
    await git(dir, ['restore', '--staged', '.']);
    return;
  }
  if (paths.length === 0) return;
  await git(dir, ['restore', '--staged', '--', ...paths]);
}

/** 放弃已跟踪文件的改动（未跟踪文件由路由层送回收站）。 */
export async function discard(dir: string, paths: string[]): Promise<void> {
  await assertGitAvailable();
  if (paths.length === 0) return;
  await git(dir, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...paths]);
}

export async function commit(dir: string, message: string): Promise<{ short: string }> {
  await assertGitAvailable();
  // 预检暂存区：git diff --cached --quiet 无差异时退出码 0（git() 不抛错）＝无暂存内容，
  // 直接给语义化 400，而不是让 git commit 退出码 1 落入 IO_ERROR 500
  let hasStaged: boolean;
  try {
    await git(dir, ['diff', '--cached', '--quiet']);
    hasStaged = false;
  } catch {
    hasStaged = true;
  }
  if (!hasStaged) {
    throw new AppError('NO_STAGED', '没有已暂存的改动——先在变更列表勾选要提交的文件');
  }
  await git(dir, ['commit', '-F', '-'], { input: message, timeoutMs: 60000 });
  const out = (await git(dir, ['rev-parse', '--short', 'HEAD'])).trim();
  return { short: out };
}

export async function log(
  dir: string,
  opts: { limit: number; skip?: number; path?: string; author?: string },
): Promise<GitLogEntry[]> {
  await assertGitAvailable();
  const args = ['log', `--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e`, `--max-count=${opts.limit}`];
  if (opts.skip !== undefined && opts.skip > 0) appendEntry(args, `--skip=${opts.skip}`);
  if (opts.author !== undefined && opts.author !== '') appendEntry(args, `--author=${opts.author}`);
  const withPaths = opts.path !== undefined && opts.path !== '' ? [...args, '--', opts.path] : args;
  const out = await git(dir, withPaths);
  const entries: GitLogEntry[] = [];
  for (const record of out.split('\x1e')) {
    const trimmed = record.trimStart();
    if (trimmed === '') continue;
    const fields = trimmed.split('\x1f');
    if (fields.length >= 5) {
      appendEntry(entries, {
        hash: fields[0] ?? '',
        short: fields[1] ?? '',
        author: fields[2] ?? '',
        date: fields[3] ?? '',
        subject: fields[4] ?? '',
      });
    }
  }
  return entries;
}

export interface CommitDetail {
  entry: GitLogEntry;
  files: Array<{ path: string; status: string }>;
}

export async function commitDetail(dir: string, hash: string): Promise<CommitDetail> {
  await assertGitAvailable();
  const out = await git(dir, [
    'show',
    '--numstat',
    '--no-color',
    '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s',
    hash,
  ]);
  const lines = out.split('\n');
  const header = (lines[0] ?? '').split('\x1f');
  const entry: GitLogEntry = {
    hash: header[0] ?? hash,
    short: header[1] ?? '',
    author: header[2] ?? '',
    date: header[3] ?? '',
    subject: header[4] ?? '',
  };
  const files: Array<{ path: string; status: string }> = [];
  for (const line of lines.slice(1)) {
    const cols = line.split('\t');
    if (cols.length >= 3 && cols[2] !== undefined && cols[2] !== '') {
      const p = cols[2].includes('=>') ? cols[2] : cols[2];
      appendEntry(files, { path: p, status: cols[0] === '-' ? 'binary' : 'changed' });
    }
  }
  return { entry, files };
}

/** 只读枚举已配置的远程名。`git remote` 不触网、纯列配置；仅供「在终端推送」引导
 *  的显隐判定（T-125）——绝不实现 push/pull/fetch/远程管理/凭据（FR-5.8 红线不变）。 */
export async function remotes(dir: string): Promise<string[]> {
  const out = await git(dir, ['remote']);
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

export async function branches(dir: string): Promise<GitBranch[]> {
  await assertGitAvailable();
  const out = await git(dir, [
    'branch',
    '--list',
    '--format=%(HEAD)%00%(refname:short)%00%(objectname:short)%00%(contents:subject)',
  ]);
  const result: GitBranch[] = [];
  for (const line of out.split('\n')) {
    if (line.trim() === '') continue;
    const cols = line.split('\0');
    const name = cols[1];
    if (name === undefined || name === '') continue;
    appendEntry(result, {
      name,
      current: cols[0] === '*',
      headShort: cols[2] ?? null,
      subject: cols[3] ?? null,
    });
  }
  return result;
}

export async function checkout(dir: string, branch: string): Promise<void> {
  await assertGitAvailable();
  await git(dir, ['switch', branch], { timeoutMs: 60000 });
}

export async function createBranch(dir: string, branch: string): Promise<void> {
  await assertGitAvailable();
  await git(dir, ['switch', '-c', branch]);
}

export async function summaryForAnalyze(dir: string): Promise<{
  isRepo: boolean;
  branch: string | null;
  dirty: boolean;
  untracked: number;
  lastCommitAt: string | null;
  lastCommitAuthor: string | null;
  lastCommitSubject: string | null;
  headShort: string | null;
  partial: boolean;
}> {
  const empty = {
    isRepo: false,
    branch: null,
    dirty: false,
    untracked: 0,
    lastCommitAt: null,
    lastCommitAuthor: null,
    lastCommitSubject: null,
    headShort: null,
    partial: false,
  };
  if (!(await gitAvailable())) return { ...empty, partial: true };
  try {
    if (!(await isRepo(dir))) return empty;
    const out = await git(dir, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=normal'], {
      timeoutMs: 15000,
    });
    const parsed = parseStatusV2(out);
    const dirty = parsed.entries.some((e) => e.state !== 'untracked');
    const untracked = parsed.entries.filter((e) => e.state === 'untracked').length;
    let lastCommitAt: string | null = null;
    let lastCommitAuthor: string | null = null;
    let lastCommitSubject: string | null = null;
    try {
      const one = await git(dir, ['log', '-1', '--pretty=format:%aI%x1f%an%x1f%s']);
      const parts = one.split('\x1f');
      lastCommitAt = parts[0] ?? null;
      lastCommitAuthor = parts[1] ?? null;
      lastCommitSubject = parts[2] ?? null;
    } catch {
      // 空仓库没有提交，允许
    }
    let headShort: string | null = null;
    try {
      headShort = (await git(dir, ['rev-parse', '--short', 'HEAD'])).trim();
    } catch {
      headShort = null;
    }
    return {
      isRepo: true,
      branch: headerOrNull(parsed.header, 'branch.head'),
      dirty,
      untracked,
      lastCommitAt,
      lastCommitAuthor,
      lastCommitSubject,
      headShort,
      partial: false,
    };
  } catch {
    return { ...empty, partial: true };
  }
}
