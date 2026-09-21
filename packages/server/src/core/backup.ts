/**
 * 备份与自愈（C-41 / 8.12）：VACUUM INTO 快照 + integrity_check；
 * 保留最近 10 份 + 每周 1 份；恢复前把当前库另存。
 */
import Database from 'better-sqlite3';
import { readdirSync, rmSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { AppError } from './errors.js';
import { integrityCheck } from '../db/migrate.js';

export interface BackupFileInfo {
  file: string;
  name: string;
  size: number;
  at: string;
}

export function createBackup(dbFile: string, backupDir: string): { file: string; integrity: string } {
  const stamp = formatStamp(new Date());
  const target = join(backupDir, `library-${stamp}.db`);
  const src = new Database(dbFile, { readonly: true });
  try {
    src.exec(`VACUUM INTO '${target.replace(/\\/g, '/').replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }
  const check = new Database(target, { readonly: true });
  let integrity = 'ok';
  try {
    integrity = integrityCheck(check).message;
  } finally {
    check.close();
  }
  applyRetention(backupDir);
  return { file: target, integrity };
}

function formatStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** 保留策略：最近 10 份 + 每周最早 1 份。 */
export function applyRetention(backupDir: string): void {
  const files = readdirSync(backupDir)
    .filter((f) => /^library-\d{8}-\d{4}\.db$/.test(f))
    .sort();
  if (files.length <= 10) return;
  const weekKeys = new Set<string>();
  const keep = new Set<string>();
  for (let i = files.length - 1; i >= 0; i--) {
    const f = files[i];
    if (f === undefined) continue;
    if (files.length - i <= 10) {
      keep.add(f);
      continue;
    }
    // 每周一份：以 ISO 周（年-周）为键
    const m = /^library-(\d{4})(\d{2})(\d{2})-/.exec(f);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const week = isoWeekKey(d);
      if (!weekKeys.has(week)) {
        weekKeys.add(week);
        keep.add(f);
      }
    }
  }
  for (const f of files) {
    if (!keep.has(f)) {
      try {
        rmSync(join(backupDir, f));
      } catch {
        /* 忽略删除失败 */
      }
    }
  }
}

function isoWeekKey(d: Date): string {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target.valueOf() - firstThursday.valueOf();
  const week = 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
  return `${target.getFullYear()}-W${week}`;
}

export function listBackups(backupDir: string): BackupFileInfo[] {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((f) => /^library-\d{8}-\d{4}\.db$|^pre-migration-.*\.db$/.test(f))
    .map((f) => {
      const st = statSync(join(backupDir, f));
      return { file: join(backupDir, f), name: f, size: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

/**
 * 恢复：调用方必须先 close 连接。步骤：
 * 当前库另存 library.before-restore.db → 校验目标 → 复制覆盖 db（删除旧 wal/shm）。
 */
export function restoreBackup(dbFile: string, backupFile: string): void {
  if (!existsSync(backupFile)) {
    throw new AppError('NOT_FOUND', '备份文件不存在');
  }
  const check = new Database(backupFile, { readonly: true });
  try {
    const r = integrityCheck(check);
    if (!r.ok) throw new AppError('IO_ERROR', `备份文件损坏：${r.message}`);
  } finally {
    check.close();
  }
  copyFileSync(dbFile, `${dbFile}.before-restore`);
  for (const suffix of ['-wal', '-shm']) {
    const p = `${dbFile}${suffix}`;
    if (existsSync(p)) rmSync(p);
  }
  copyFileSync(backupFile, dbFile);
}

export function backupFileName(f: string): string {
  return basename(f);
}
