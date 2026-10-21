/** 回归锚点：actor 身份机制（FR-13.1）——agent 头归一化、ALS 上下文、审计默认值。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { currentActor, normalizeActorHeader, runAs, enterActor } from './actor.js';
import { logActivity, listActivity } from '../db/repo/metaRepo.js';
import { runMigrations } from '../db/migrate.js';

describe('normalizeActorHeader（agent 身份头归一化）', () => {
  it('未声明返回 null（不进入任何上下文）', () => {
    expect(normalizeActorHeader(undefined)).toBeNull();
  });

  it('合法声明保留原文并去掉首尾空白', () => {
    expect(normalizeActorHeader('  claude-code  ')).toEqual({ actor: 'claude-code', ownerId: null });
  });

  it('控制字符被清洗后为空 → 拒绝', () => {
    expect(normalizeActorHeader('\u0000\u001f\u007f')).toBeNull();
  });

  it('超过 64 字符 → 拒绝', () => {
    expect(normalizeActorHeader('a'.repeat(65))).toBeNull();
    expect(normalizeActorHeader('a'.repeat(64))?.actor).toBe('a'.repeat(64));
  });

  it('冒充 local → 拒绝（审计身份必须与用户可辨）', () => {
    expect(normalizeActorHeader('local')).toBeNull();
    expect(normalizeActorHeader(' local ')).toBeNull();
  });
});

describe('currentActor / runAs / enterActor（身份上下文）', () => {
  it('默认恒为本地单人', () => {
    expect(currentActor()).toEqual({ actor: 'local', ownerId: null });
  });

  it('runAs 包住的同步链内取到声明身份，离开后回落 local', () => {
    const inside = runAs({ actor: 'agent-x', ownerId: null }, () => currentActor().actor);
    expect(inside).toBe('agent-x');
    expect(currentActor().actor).toBe('local');
  });

  it('enterWith 延续到同一异步链的后续 await（模拟 Fastify 钩子时序）', async () => {
    enterActor({ actor: 'agent-y', ownerId: null });
    await new Promise((r) => setTimeout(r, 1));
    expect(currentActor().actor).toBe('agent-y');
  });
});

describe('logActivity 审计默认值（FR-13.1：未显式传 actor 时取当前链身份）', () => {
  let root: string;
  let db: Database.Database;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttfolio-actor-'));
    db = new Database(path.join(root, 'library.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db, null);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('agent 上下文内的操作自动落 agent 身份；链外操作仍落 local', () => {
    runAs({ actor: 'claude-code', ownerId: null }, () => {
      logActivity(db, { kind: 'test.agent.op', level: 'L1' });
    });
    logActivity(db, { kind: 'test.user.op', level: 'L1' });
    logActivity(db, { kind: 'test.explicit.op', level: 'L1', actor: 'someone' });

    const rows = listActivity(db, 10);
    const byKind = new Map(rows.map((r) => [r.kind, r.actor]));
    expect(byKind.get('test.agent.op')).toBe('claude-code');
    expect(byKind.get('test.user.op')).toBe('local');
    expect(byKind.get('test.explicit.op')).toBe('someone');
  });
});
