/**
 * 可选快照层（FR-13.3 v2 / T-112，默认关）：内容寻址存数据目录 snapshots/<projectId>/<sha1>。
 *
 * 边界：只对 <512KB 文本；配额 1GB/项目、30 天过期；MUST NOT 写项目目录；
 * 与会话一起删除时由清理任务按过期/配额回收。快照只服务「与首次变更对比」，
 * 不做回放/回滚（留后续）。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as fsx from './fsx.js';

export const SNAPSHOT_MAX_BYTES = 512 * 1024;
export const SNAPSHOT_QUOTA_BYTES = 1024 * 1024 * 1024;
export const SNAPSHOT_KEEP_DAYS = 30;

export function snapshotDir(root: string, projectId: string): string {
  return path.join(root, projectId);
}

/** 存一份文件内容，返回 sha1；不可快照（二进制/超限/读失败）返回 null。 */
export function storeSnapshot(
  root: string,
  projectId: string,
  absFile: string,
): { sha: string; bytes: number } | null {
  try {
    const st = fsx.statSafe(absFile);
    if (st === null || st.isDir || st.size > SNAPSHOT_MAX_BYTES) return null;
    const buf = fsx.readFileSync(absFile);
    if (fsx.looksBinary(buf.subarray(0, 8192))) return null;
    const sha = createHash('sha1').update(buf).digest('hex');
    const dir = snapshotDir(root, projectId);
    fsx.ensureDir(dir);
    const target = path.join(dir, sha);
    if (!fs.existsSync(target)) {
      // 原子落盘：临时文件 + rename（同盘），避免半截快照被当有效内容
      const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, target);
    } else {
      // 命中复用：touch mtime 参与 LRU/过期判定
      const now = new Date();
      try {
        fs.utimesSync(target, now, now);
      } catch {
        /* 忽略 */
      }
    }
    return { sha, bytes: buf.length };
  } catch {
    return null;
  }
}

export function readSnapshot(root: string, projectId: string, sha: string): string | null {
  if (!/^[a-f0-9]{40}$/.test(sha)) return null;
  const file = path.join(snapshotDir(root, projectId), sha);
  const st = fsx.statSafe(file);
  if (st === null || st.isDir) return null;
  try {
    return fsx.readTextFile(file, SNAPSHOT_MAX_BYTES).content;
  } catch {
    return null;
  }
}

/** 清理：先按 30 天过期，再按项目配额（mtime LRU）删到配额内。返回删除数。 */
export function pruneSnapshots(projectsRoot: string): number {
  let removed = 0;
  let projects: string[] = [];
  try {
    projects = fs
      .readdirSync(projectsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - SNAPSHOT_KEEP_DAYS * 24 * 3600 * 1000;
  for (const pid of projects) {
    const dir = path.join(projectsRoot, pid);
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const entries: Array<{ f: string; size: number; mtime: number }> = [];
    for (const f of files) {
      try {
        const st = fs.statSync(path.join(dir, f));
        if (st.mtimeMs < cutoff) {
          fs.rmSync(path.join(dir, f), { force: true });
          removed++;
        } else {
          entries.push({ f, size: st.size, mtime: st.mtimeMs });
        }
      } catch {
        /* 单文件失败忽略 */
      }
    }
    let total = entries.reduce((a, e) => a + e.size, 0);
    if (total > SNAPSHOT_QUOTA_BYTES) {
      entries.sort((a, b) => a.mtime - b.mtime);
      for (const e of entries) {
        if (total <= SNAPSHOT_QUOTA_BYTES) break;
        try {
          fs.rmSync(path.join(dir, e.f), { force: true });
          total -= e.size;
          removed++;
        } catch {
          /* 忽略 */
        }
      }
    }
  }
  return removed;
}

/** 项目删除时的级联清理。 */
export function clearProjectSnapshots(projectsRoot: string, projectId: string): number {
  try {
    fs.rmSync(path.join(projectsRoot, projectId), { recursive: true, force: true });
    return 1;
  } catch {
    return 0;
  }
}
