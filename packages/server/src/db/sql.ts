/** better-sqlite3 动态绑定辅助（收敛类型断言到一处）。 */
import type Database from 'better-sqlite3';

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

interface LooseStatement {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => unknown;
  run: (...params: unknown[]) => RunResult;
}

function loose(db: Database.Database, sql: string): LooseStatement {
  return db.prepare(sql) as unknown as LooseStatement;
}

export function getAll<T>(db: Database.Database, sql: string, params: unknown[] = []): T[] {
  return loose(db, sql).all(...params) as T[];
}

export function getOne<T>(db: Database.Database, sql: string, params: unknown[] = []): T | undefined {
  return loose(db, sql).get(...params) as T | undefined;
}

export function run(db: Database.Database, sql: string, params: unknown[] = []): RunResult {
  return loose(db, sql).run(...params);
}
