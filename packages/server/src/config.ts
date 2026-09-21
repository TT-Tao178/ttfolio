/** 运行配置：数据目录、端口、运行模式。 */
import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export interface AppConfig {
  dataDir: string;
  port: number;
  portMaxTries: number;
  mode: 'web';
}

export function resolveDataDir(): string {
  if (process.env['TTFOLIO_DATA_DIR']) return path.resolve(process.env['TTFOLIO_DATA_DIR']);
  if (process.platform === 'win32' && process.env['APPDATA']) {
    return path.join(process.env['APPDATA'], 'ttFolio');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'ttFolio');
  const xdg = process.env['XDG_DATA_HOME'];
  if (xdg) return path.join(xdg, 'ttfolio');
  const fallback = path.join(os.homedir(), '.local', 'share', 'ttfolio');
  if (existsSync(fallback) || !existsSync(path.join(os.homedir(), '.ttfolio'))) return fallback;
  return path.join(os.homedir(), '.ttfolio');
}

export interface DataDirLayout {
  dataDir: string;
  dbFile: string;
  backupDir: string;
  trashDir: string;
  thumbsDir: string;
  logDir: string;
  runtimeFile: string;
}

export function ensureDataDirs(dataDir: string): DataDirLayout {
  const layout: DataDirLayout = {
    dataDir,
    dbFile: path.join(dataDir, 'library.db'),
    backupDir: path.join(dataDir, 'backups'),
    trashDir: path.join(dataDir, 'trash'),
    thumbsDir: path.join(dataDir, 'thumbs'),
    logDir: path.join(dataDir, 'logs'),
    runtimeFile: path.join(dataDir, 'runtime.json')
  };
  for (const dir of [dataDir, layout.backupDir, layout.trashDir, layout.thumbsDir, layout.logDir]) {
    mkdirSync(dir, { recursive: true });
  }
  return layout;
}

export function loadPort(): number {
  const raw = process.env['TTFOLIO_PORT'];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 7717;
}

export function writeRuntime(file: string, payload: Record<string, unknown>): void {
  writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
}

export function readRuntime(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
