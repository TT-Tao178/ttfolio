/** 迁移执行（DB-5..7 / C-34）：user_version 递增，只增不改；升级前 VACUUM INTO 快照；失败回滚。 */
import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export function migrationsDir(): string {
  // 迁移文件与源码同仓发布，路径基于本文件位置
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'migrations');
}

export interface MigrationOutcome {
  applied: Array<{ version: number; file: string }>;
  snapshotFile: string | null;
}

export function listMigrationFiles(): Array<{ version: number; file: string; sql: string }> {
  const dir = migrationsDir();
  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  return files.map((file) => {
    const version = Number.parseInt(file.slice(0, 4), 10);
    return { version, file, sql: readFileSync(join(dir, file), 'utf8') };
  });
}

export function runMigrations(db: Database.Database, backupDir: string | null): MigrationOutcome {
  const current = db.pragma('user_version', { simple: true }) as number;
  const pending = listMigrationFiles().filter((m) => m.version > current);
  const outcome: MigrationOutcome = { applied: [], snapshotFile: null };
  if (pending.length === 0) return outcome;

  // 升级前快照（VACUUM INTO 不能在事务内执行）
  if (backupDir !== null) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const snap = join(backupDir, `pre-migration-v${current}-${stamp}.db`);
    try {
      db.exec(`VACUUM INTO '${snap.replace(/\\/g, '/').replace(/'/g, "''")}'`);
      outcome.snapshotFile = snap;
    } catch {
      // 空库无法 VACUUM INTO 时跳过快照（首建库无数据可丢）
    }
  }

  for (const m of pending) {
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    });
    tx();
    outcome.applied.push({ version: m.version, file: m.file });
  }
  return outcome;
}

/** 完整性检查 */
export function integrityCheck(db: Database.Database): { ok: boolean; message: string } {
  const rows = db.pragma('integrity_check') as Array<unknown>;
  const first = rows[0];
  const msg = typeof first === 'string' ? first : 'unknown';
  return { ok: msg === 'ok', message: msg };
}
