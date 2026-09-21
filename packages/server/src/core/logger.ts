/** 日志（C-40 / LOG-1..5）：pino 双写（滚动文件 + stdout），不记录内容与敏感值。 */
import pino from 'pino';
import { statSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const KEEP_ROTATIONS = 7;

/** 启动时如超过 10MB 则滚动（.1 最新，编号越大越旧）。运行期由定时任务再检查。 */
export function rotateLogIfNeeded(logFile: string): void {
  try {
    if (statSync(logFile).size < MAX_FILE_BYTES) return;
    const oldest = `${logFile}.${KEEP_ROTATIONS}`;
    try {
      if (statSync(oldest).isFile()) unlinkSync(oldest);
    } catch {
      /* 不存在则跳过 */
    }
    for (let i = KEEP_ROTATIONS - 1; i >= 1; i--) {
      const from = `${logFile}.${i}`;
      const to = `${logFile}.${i + 1}`;
      try {
        if (statSync(from).isFile()) renameSync(from, to);
      } catch {
        /* 不存在则跳过 */
      }
    }
    renameSync(logFile, `${logFile}.1`);
  } catch {
    /* 首个日志文件可能不存在 */
  }
}

export function createLogger(logDir: string, level = 'info'): pino.Logger {
  const logFile = join(logDir, 'ttfolio.log');
  rotateLogIfNeeded(logFile);
  const dest = pino.destination({ dest: logFile, append: true, sync: false, mkdir: true });
  return pino(
    { level, base: undefined },
    pino.multistream([
      { stream: dest },
      { stream: process.stdout, level: (['error', 'warn', 'info', 'debug'].includes(level) ? level : 'info') as pino.Level }
    ])
  );
}

export type Logger = pino.Logger;
