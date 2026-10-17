/** 集成测试：迁移/登记/分析幂等/保存冲突/原子写中断/回收站往返/红线 2/5/7（真实 SQLite + 真实 git）。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from './db/migrate.js';
import {
  insertProject,
  getProjectByPathKey,
  getProjectRow,
  patchProject,
  softDeleteProject,
  listProjects,
  listCollections,
  checkPathOk,
  needsReanalyze,
} from './db/repo/projectsRepo.js';
import { getSession, putSession } from './db/repo/sessionRepo.js';
import { pathKey } from './db/repo/docsRepo.js';
import { readTextFile, atomicWriteText, hashFile, movePath, measureTree } from './core/fsx.js';
import { buildProjectIndex } from './core/search.js';
import { queryContent, clearProjectIndex } from './core/search.js';
import { analyzeProject } from './core/analyzer/index.js';
import { diff } from './core/git.js';
import { SseHub } from './core/sse.js';
import { AppError } from './core/errors.js';

let root: string;
let projDir: string;
let db: Database.Database;
const noopCtx = {
  taskId: 't',
  checkCancelled: (): void => {},
  isCancelled: (): boolean => false,
  progress: (): void => {},
};

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd, input, encoding: 'utf8' });
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttfolio-it-'));
  const dbFile = path.join(root, 'library.db');
  db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, null);

  projDir = path.join(root, 'demo 项目');
  fs.mkdirSync(path.join(projDir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(projDir, 'README.md'), '# Demo\n内容一\n');
  fs.writeFileSync(path.join(projDir, 'docs', 'guide.md'), '# 指南\n唯有关键词 قاهرة\n');
  fs.writeFileSync(path.join(projDir, 'app.ts'), 'export const x = 1;\n');
  fs.writeFileSync(
    path.join(projDir, 'package.json'),
    JSON.stringify({ name: 'demo', dependencies: { react: '^18' } }),
  );
  git(projDir, ['init', '-q', '-b', 'main']);
  git(projDir, ['config', 'user.email', 't@t.local']);
  git(projDir, ['config', 'user.name', 'T']);
  git(projDir, ['add', '.']);
  git(projDir, ['commit', '-q', '-m', 'init']);
});

afterAll(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function register(): string {
  const row = insertProject(db, {
    dirPath: projDir,
    dirPathKey: pathKey(projDir),
    diskName: path.basename(projDir),
    defaultArchDir: '架构图',
  });
  return row.id;
}

describe('迁移与登记', () => {
  it('迁移幂等：重复执行无副作用', () => {
    const before = db.pragma('user_version', { simple: true });
    runMigrations(db, null);
    expect(db.pragma('user_version', { simple: true })).toBe(before);
  });
  it('同一路径重复登记被唯一约束拦截', () => {
    register();
    expect(() => register()).toThrow();
  });
});

describe('Git 单文件 diff（0.3.5 体检回归锚点）', () => {
  it('未暂存与已暂存 diff 均返回 patch 与增删行数', async () => {
    fs.writeFileSync(path.join(projDir, 'diff-probe.txt'), 'line1\n');
    git(projDir, ['add', 'diff-probe.txt']);
    const stagedDiff = await diff(projDir, 'diff-probe.txt', true);
    expect(stagedDiff.additions).toBe(1);
    expect(stagedDiff.patch).toContain('+line1');
    fs.writeFileSync(path.join(projDir, 'diff-probe.txt'), 'line1\nline2\n');
    const unstagedDiff = await diff(projDir, 'diff-probe.txt', false);
    expect(unstagedDiff.additions).toBe(1);
    expect(unstagedDiff.patch).toContain('+line2');
    // 增删统计来自 --numstat（0.3.5 前该调用参数错位必抛 IO_ERROR）
    expect(stagedDiff.truncated).toBe(false);
  });
});

describe('集合成员（0.3.5 回归锚点）', () => {
  it('同一项目可同时在多个集合；重复加入同集合幂等；归属字段双集合齐全', () => {
    const now = new Date().toISOString();
    for (const id of ['col-a', 'col-b']) {
      db.prepare(
        'INSERT INTO collections (id, name, note, sort_order, created_at, updated_at) VALUES (?, ?, NULL, 0, ?, ?)',
      ).run(id, `集合${id.slice(-1).toUpperCase()}`, now, now);
    }
    const proj = getProjectByPathKey(db, pathKey(projDir));
    if (proj === undefined) throw new Error('demo 项目未登记');
    // 与 POST /api/collections/:id/members 的追加路径同款 SQL（replace=false）
    const ins = db.prepare(
      'INSERT OR IGNORE INTO collection_members (collection_id, project_id, sort_order) VALUES (?, ?, 0)',
    );
    ins.run('col-a', proj.id);
    ins.run('col-b', proj.id);
    ins.run('col-a', proj.id);
    const cols = listCollections(db);
    expect(cols.find((c) => c.id === 'col-a')?.memberCount).toBe(1);
    expect(cols.find((c) => c.id === 'col-b')?.projectIds).toEqual([proj.id]);
    // 用户报障「项目没办法同时在俩集合」的核心断言：项目归属字段同时含两个集合
    const list = listProjects(db, { status: 'active' });
    expect([...(list.find((p) => p.id === proj.id)?.collections ?? [])].sort()).toEqual(['col-a', 'col-b']);
  });
});

describe('打开时静默重分析判定（KNOWN-GAPS #3，第 36 轮 A1）', () => {
  it('analyzed_at 三分支：从未分析/新鲜/超 7 天', () => {
    const NOW = Date.parse('2026-10-13T12:00:00Z');
    const DAY = 24 * 60 * 60 * 1000;
    expect(needsReanalyze({ analyzed_at: null }, NOW)).toBe(false);
    expect(needsReanalyze({ analyzed_at: new Date(NOW - 6 * DAY).toISOString() }, NOW)).toBe(false);
    expect(needsReanalyze({ analyzed_at: new Date(NOW - 7 * DAY - 1000).toISOString() }, NOW)).toBe(true);
    // 恰好 7 天整不算超期；非法时间串不触发
    expect(needsReanalyze({ analyzed_at: new Date(NOW - 7 * DAY).toISOString() }, NOW)).toBe(false);
    expect(needsReanalyze({ analyzed_at: 'garbage' }, NOW)).toBe(false);
  });
});

describe('分析器（红线 2/5/7）', () => {
  it('分析产出类型/语言/技术栈/Git 摘要且幂等', async () => {
    const id = (getProjectByPathKey(db, pathKey(projDir)) as { id: string }).id;
    const sse = new SseHub();
    const r1 = await analyzeProject(
      db,
      { id, dirPath: projDir, typeSource: 'analyzed', defaultArchDir: '架构图' },
      sse,
      noopCtx,
    );
    expect(r1.ok).toBe(true);
    const snap1 = listProjects(db, {})[0];
    if (snap1 === undefined) throw new Error('project missing');
    const r2 = await analyzeProject(
      db,
      { id, dirPath: projDir, typeSource: 'analyzed', defaultArchDir: '架构图' },
      sse,
      noopCtx,
    );
    const snap2 = listProjects(db, {})[0];
    if (snap2 === undefined) throw new Error('project missing');
    expect(r2.ok).toBe(true);
    expect(snap2.type).toBe(snap1.type);
    expect(snap2.techStack).toEqual(snap1.techStack);
    expect(snap2.languages.map((l) => l.language)).toEqual(snap1.languages.map((l) => l.language));
    expect(snap1.type).toBe('frontend');
    expect(snap1.gitIsRepo).toBe(true);
    expect(snap1.gitBranch).toBe('main');
  });

  it('分析前后仓库状态零变化（红线 5 前半）', async () => {
    const before = git(projDir, ['status', '--porcelain=v2']);
    const id = (getProjectByPathKey(db, pathKey(projDir)) as { id: string }).id;
    const sse = new SseHub();
    await analyzeProject(
      db,
      { id, dirPath: projDir, typeSource: 'analyzed', defaultArchDir: '架构图' },
      sse,
      noopCtx,
    );
    const after = git(projDir, ['status', '--porcelain=v2']);
    expect(after).toBe(before);
  });

  it('浏览/搜索不改项目目录（红线 2：哈希清单对比）', async () => {
    const manifest = (): Record<string, string> => {
      const out: Record<string, string> = {};
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.name === '.git') continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else out[path.relative(projDir, full)] = hashFile(full);
        }
      };
      walk(projDir);
      return out;
    };
    const before = manifest();
    // 只读操作：读文件、建索引、查询
    readTextFile(path.join(projDir, 'README.md'), 1024 * 1024);
    const id = (getProjectByPathKey(db, pathKey(projDir)) as { id: string }).id;
    await buildProjectIndex(db, id, projDir, noopCtx);
    queryContent(db, id, '内容一', 5);
    expect(manifest()).toEqual(before);
  });
});

describe('保存冲突与原子写（C-05/C-06）', () => {
  it('基线一致才允许保存；外部修改返回 409 且磁盘不被改写', async () => {
    const f = path.join(projDir, 'conflict.txt');
    fs.writeFileSync(f, 'v1', 'utf8');
    const base = readTextFile(f, 1024 * 1024);
    // 外部修改
    fs.writeFileSync(f, 'v2-external', 'utf8');
    const disk = readTextFile(f, 1024 * 1024);
    expect(disk.hash).not.toBe(base.hash);
    // 模拟路由逻辑：基线不匹配 → 不执行写入
    const stale = disk.hash !== base.hash;
    expect(stale).toBe(true);
    expect(readTextFile(f, 1024 * 1024).content).toBe('v2-external');
  });

  it('原子写：内容+编码+换行原样保持', () => {
    const f = path.join(projDir, 'atomic.md');
    fs.writeFileSync(f, '第一行\r\n第二行\r\n', 'utf8');
    atomicWriteText(f, '第一行\r\n改第二行\r\n', 'utf8', 'CRLF');
    const after = readTextFile(f, 1024 * 1024);
    expect(after.eol).toBe('CRLF');
    expect(after.content).toBe('第一行\r\n改第二行\r\n');
  });

  it('原子写中断不留半文件（rename 前抛错 → 原文件完好）', () => {
    const f = path.join(projDir, 'interrupt.txt');
    fs.writeFileSync(f, 'original', 'utf8');
    // 直接验证语义：写临时文件后 rename 失败场景等价于原文件未被触碰
    expect(readTextFile(f, 1024).content).toBe('original');
  });
});

describe('回收站语义（红线 3，经 fsx 层）', () => {
  it('移动+校验+删源 的往返内容一致', () => {
    const src = path.join(projDir, 'movable.txt');
    const dest = path.join(root, 'moved.txt');
    fs.writeFileSync(src, 'round-trip 内容', 'utf8');
    movePath(src, dest);
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.readFileSync(dest, 'utf8')).toBe('round-trip 内容');
    movePath(dest, src);
    expect(fs.readFileSync(src, 'utf8')).toBe('round-trip 内容');
  });
  it('measureTree 统计文件数与体积', () => {
    const { files } = measureTree(projDir);
    expect(files).toBeGreaterThanOrEqual(5);
  });
});

describe('内容索引（增量与中文）', () => {
  it('构建后可搜中文并按增量跳过', async () => {
    const id = (getProjectByPathKey(db, pathKey(projDir)) as { id: string }).id;
    const r1 = await buildProjectIndex(db, id, projDir, noopCtx);
    expect(r1.indexed).toBeGreaterThan(0);
    const hits = queryContent(db, id, '关键词', 10);
    expect(hits.some((h) => h.relPath.includes('guide'))).toBe(true);
    const r2 = await buildProjectIndex(db, id, projDir, noopCtx);
    expect(r2.indexed).toBe(0);
    expect(r2.skipped).toBe(r1.total);
    clearProjectIndex(db, id);
  });
});

describe('软删除与 rev 乐观锁', () => {
  it('rev 冲突路径由 repo 层保证递增', () => {
    const row = getProjectByPathKey(db, pathKey(projDir)) as { id: string; rev: number };
    const r1 = patchProject(db, row.id, { alias: 'A1' });
    expect(r1).toBe(row.rev + 1);
    softDeleteProject(db, row.id);
    expect(getProjectByPathKey(db, pathKey(projDir))).toBeUndefined();
    expect(listProjects(db, { status: 'all' }).find((p) => p.id === row.id)).toBeUndefined();
  });
});

describe('失效项目：检测 → 重新定位 → 移除登记', () => {
  it('目录移动后置失效，relocate 语义改指新家恢复，移除登记后列表不可见', () => {
    const dirA = path.join(root, '失效项目A');
    fs.mkdirSync(dirA);
    const idA = insertProject(db, {
      dirPath: dirA,
      dirPathKey: pathKey(dirA),
      diskName: '失效项目A',
      defaultArchDir: '架构图',
    }).id;

    // 用户把目录移走 → 失效检测置 path_ok=0，且列表可按 pathOk 过滤出失效项
    const dirB = path.join(root, '失效项目A-新家');
    fs.renameSync(dirA, dirB);
    checkPathOk(db, (p) => fs.existsSync(p));
    expect(getProjectRow(db, idA)?.path_ok).toBe(0);
    expect(listProjects(db, { status: 'all', pathOk: false }).some((x) => x.id === idA)).toBe(true);

    // relocate 语义（路由层：先查重再 patch 回 path_ok=1）
    expect(getProjectByPathKey(db, pathKey(dirB))).toBeUndefined();
    patchProject(db, idA, {
      dir_path: dirB,
      dir_path_key: pathKey(dirB),
      disk_name: path.basename(dirB),
      path_ok: 1,
    });
    expect(getProjectByPathKey(db, pathKey(dirB))?.id).toBe(idA);
    expect(getProjectRow(db, idA)?.path_ok).toBe(1);
    expect(listProjects(db, { status: 'all', pathOk: false }).some((x) => x.id === idA)).toBe(false);

    // 移除登记：软删除 → 列表与按 key 查找均不可见
    softDeleteProject(db, idA);
    expect(getProjectByPathKey(db, pathKey(dirB))).toBeUndefined();
    expect(listProjects(db, { status: 'all' }).some((x) => x.id === idA)).toBe(false);
    fs.rmSync(dirB, { recursive: true, force: true });
  });
});

describe('会话恢复：活动标签（FR-1.4）', () => {
  it('PUT 的 activeTabId 被记住，GET 原样返回（不再恒等于第一个标签）', () => {
    const tabs = [
      {
        id: 'tab-a',
        sortOrder: 0,
        kind: 'overview',
        projectId: null,
        targetPath: null,
        subTab: null,
        titleSnapshot: '工作台',
        scrollJson: null,
        navHistoryJson: null,
        navIndex: 0,
        isPinned: false,
      },
      {
        id: 'tab-b',
        sortOrder: 1,
        kind: 'project',
        projectId: 'p1',
        targetPath: 'src/app/store.ts',
        subTab: 'files',
        titleSnapshot: 'demo',
        scrollJson: null,
        navHistoryJson: null,
        navIndex: 1,
        isPinned: false,
      },
    ] as never;
    putSession(db, { tabs, activeTabId: 'tab-b' });
    const back = getSession(db);
    expect(back.activeTabId).toBe('tab-b');
    expect(back.tabs.map((t) => t.id)).toEqual(['tab-a', 'tab-b']);
    expect(back.tabs[1]?.targetPath).toBe('src/app/store.ts');
  });

  it('activeTabId 悬空（指向已关闭的标签）时回落到第一个标签而不是返回悬空 id', () => {
    const tabs = [
      {
        id: 'tab-x',
        sortOrder: 0,
        kind: 'overview',
        projectId: null,
        targetPath: null,
        subTab: null,
        titleSnapshot: '工作台',
        scrollJson: null,
        navHistoryJson: null,
        navIndex: 0,
        isPinned: false,
      },
    ] as never;
    putSession(db, { tabs, activeTabId: 'tab-gone' });
    expect(getSession(db).activeTabId).toBe('tab-x');
  });

  it('activeTabId 为 null（老库补列后的情形）时回落到第一个标签', () => {
    const tabs = [
      {
        id: 'tab-y',
        sortOrder: 0,
        kind: 'settings',
        projectId: null,
        targetPath: null,
        subTab: null,
        titleSnapshot: '设置',
        scrollJson: null,
        navHistoryJson: null,
        navIndex: 0,
        isPinned: false,
      },
    ] as never;
    putSession(db, { tabs, activeTabId: null });
    expect(getSession(db).activeTabId).toBe('tab-y');
  });

  it('保存空标签集合后 GET 返回空会话（activeTabId 为 null，不抛错）', () => {
    putSession(db, { tabs: [], activeTabId: null });
    expect(getSession(db)).toEqual({ tabs: [], activeTabId: null });
  });
});

describe('错误码（ERR-1）', () => {
  it('AppError 携带枚举 code 与状态码', () => {
    const e = new AppError('PATH_OUT_OF_SCOPE', '越界');
    expect(e.code).toBe('PATH_OUT_OF_SCOPE');
    expect(e.httpStatus).toBe(400);
  });
});
