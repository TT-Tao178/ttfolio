/** 回归锚点：资源仓库会话仓储（FR-13.3 / T-097）——开关、生命周期、文件聚合。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../migrate.js';
import { insertProject } from './projectsRepo.js';
import { pathKey } from './docsRepo.js';
import {
  getActiveSession,
  getAgentRepoEnabled,
  getAgentSession,
  listAgentSessionFiles,
  listAgentSessions,
  patchAgentSession,
  recordSessionFileChange,
  setAgentRepoEnabled,
  startAgentSession,
  stopAgentSession,
} from './agentSessionRepo.js';

let root: string;
let db: Database.Database;
let pid: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttfolio-arepo-'));
  db = new Database(path.join(root, 'library.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, null);
  const dir = path.join(root, 'proj');
  fs.mkdirSync(dir, { recursive: true });
  pid = insertProject(db, {
    dirPath: dir,
    dirPathKey: pathKey(dir),
    diskName: 'proj',
    defaultArchDir: '架构图',
  }).id;
});

afterAll(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('资源仓库开关（projects.agent_repo_enabled，默认关）', () => {
  it('新项目默认关闭，可开启/关闭；关闭后数据保留', () => {
    expect(getAgentRepoEnabled(db, pid)).toBe(false);
    setAgentRepoEnabled(db, pid, true);
    expect(getAgentRepoEnabled(db, pid)).toBe(true);
    setAgentRepoEnabled(db, pid, false);
    expect(getAgentRepoEnabled(db, pid)).toBe(false);
  });
});

describe('会话生命周期与文件聚合', () => {
  it('start → 记录文件变更（首见插入/再见累加）→ stop 写 ended_at；关仓时静默不记', () => {
    setAgentRepoEnabled(db, pid, true);
    const s = startAgentSession(db, pid, 'claude-code');
    expect(s.endedAt).toBeNull();
    expect(s.actor).toBe('claude-code');

    const t1 = '2026-10-21T10:00:00.000Z';
    const t2 = '2026-10-21T10:05:00.000Z';
    recordSessionFileChange(db, pid, 'src/a.ts', t1);
    recordSessionFileChange(db, pid, 'src/b.ts', t1);
    recordSessionFileChange(db, pid, 'src/a.ts', t2);

    const files = listAgentSessionFiles(db, s.id);
    expect(files).toHaveLength(2);
    const a = files.find((f) => f.path === 'src/a.ts');
    expect(a).toMatchObject({ firstSeenAt: t1, lastSeenAt: t2, changeCount: 2 });

    const stopped = stopAgentSession(db, s.id);
    expect(stopped?.endedAt).not.toBeNull();
    // 幂等：重复结束不改动
    expect(stopAgentSession(db, s.id)?.endedAt).toBe(stopped?.endedAt);

    // 会话结束后不再有「活动会话」→ 新变更静默跳过
    recordSessionFileChange(db, pid, 'src/c.ts', t2);
    expect(listAgentSessionFiles(db, s.id)).toHaveLength(2);
  });

  it('未开启仓库时 start 出的会话仍可记录（开关只管页签可见性），但无会话时不记', () => {
    setAgentRepoEnabled(db, pid, false);
    // 无活动会话：静默
    recordSessionFileChange(db, pid, 'x.ts', '2026-10-21T11:00:00.000Z');
    expect(listAgentSessions(db, pid).every((s) => s.fileCount === 2)).toBe(true);

    setAgentRepoEnabled(db, pid, true);
    const s = startAgentSession(db, pid, null);
    recordSessionFileChange(db, pid, 'x.ts', '2026-10-21T11:01:00.000Z');
    expect(getActiveSession(db, pid)?.id).toBe(s.id);
    expect(listAgentSessionFiles(db, s.id)).toHaveLength(1);
    stopAgentSession(db, s.id);
    expect(getActiveSession(db, pid)).toBeNull();
  });

  it('标题与精华可编辑（空串清空为 NULL）；列表按开始时间倒序', () => {
    const s = startAgentSession(db, pid, 'user');
    patchAgentSession(db, s.id, { title: '重构登录', summary: '改了 a/b 两个文件' });
    expect(getAgentSession(db, s.id)).toMatchObject({ title: '重构登录', summary: '改了 a/b 两个文件' });
    patchAgentSession(db, s.id, { title: '' });
    expect(getAgentSession(db, s.id)?.title).toBeNull();
    const list = listAgentSessions(db, pid);
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < list.length; i++) {
      const prevAt = list[i - 1]?.startedAt ?? '';
      const curAt = list[i]?.startedAt ?? '';
      expect(prevAt >= curAt).toBe(true);
    }
    stopAgentSession(db, s.id);
  });
});
