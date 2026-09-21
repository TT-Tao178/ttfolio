/**
 * 文件监听（C-32 / FR-4.8 / 8.4）：chokidar + 忽略规则 + awaitWriteFinish；
 * 事件 500ms 聚合；自身写入抑制；Git 信号 1s 去抖；可在设置里整体关闭。
 */
import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import type { SseHub } from './sse.js';
import type { Logger } from './logger.js';
import type { CompiledIgnore } from './ignore.js';
import { isSelfWrite } from './fsx.js';

interface ProjectWatch {
  projectId: string;
  root: string;
  watcher: FSWatcher;
  pending: Map<string, 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'>;
  timer: NodeJS.Timeout | null;
  gitTimer: NodeJS.Timeout | null;
}

export class WatcherManager {
  private watches = new Map<string, ProjectWatch>();

  constructor(
    private readonly sse: SseHub,
    private readonly logger: Logger
  ) {}

  /** 为项目启动监听（幂等）。enabled=false 时忽略。 */
  watch(projectId: string, root: string, matcher: CompiledIgnore, stabilityMs: number): void {
    if (this.watches.has(projectId)) return;
    const pending = new Map<string, 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'>();
    let timer: NodeJS.Timeout | null = null;
    let gitTimer: NodeJS.Timeout | null = null;

    const flush = (): void => {
      timer = null;
      if (pending.size === 0) return;
      const paths: string[] = [];
      const openedModified: string[] = [];
      let kind = 'update';
      for (const [abs, evt] of pending) {
        pending.delete(abs);
        if (isSelfWrite(abs)) continue; // 自己的写入不当外部修改
        paths[paths.length] = abs;
        if (evt === 'change') openedModified[openedModified.length] = abs;
        if (evt === 'unlink' || evt === 'unlinkDir') kind = 'delete';
        if (evt === 'add' || evt === 'addDir') kind = 'create';
      }
      if (paths.length === 0) return;
      this.sse.publish('fs.changed', {
        projectId,
        paths: paths.slice(0, 200),
        kind,
        modified: openedModified.slice(0, 50).map((p) => path.relative(root, p).split(path.sep).join('/'))
      });
      // Git 信号 1s 去抖
      if (gitTimer !== null) clearTimeout(gitTimer);
      gitTimer = setTimeout(() => {
        gitTimer = null;
        this.sse.publish('git.changed', { projectId });
      }, 1000);
    };

    const watcher = chokidar.watch(root, {
      ignoreInitial: true,
      followSymlinks: false,
      depth: 12,
      awaitWriteFinish: { stabilityThreshold: stabilityMs, pollInterval: 100 },
      ignored: (absPath) => {
        const rel = path.relative(root, absPath);
        if (rel === '') return false;
        return matcher.isHidden(rel.split(path.sep).join('/'));
      }
    });

    const record = (evt: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir') => (absPath: string) => {
      pending.set(absPath, evt);
      if (timer === null) {
        timer = setTimeout(flush, 500);
      }
    };

    watcher
      .on('add', record('add'))
      .on('change', record('change'))
      .on('unlink', record('unlink'))
      .on('addDir', record('addDir'))
      .on('unlinkDir', record('unlinkDir'))
      .on('error', (err) => {
        this.logger.warn({ mod: 'watcher', msg: `watcher error: ${err instanceof Error ? err.message : String(err)}` });
      });

    this.watches.set(projectId, { projectId, root, watcher, pending, timer: null, gitTimer: null });
    // 保持引用，避免 TS 认为未使用
    void timer;
    void gitTimer;
  }

  unwatch(projectId: string): void {
    const w = this.watches.get(projectId);
    if (w === undefined) return;
    void w.watcher.close();
    if (w.timer !== null) clearTimeout(w.timer);
    if (w.gitTimer !== null) clearTimeout(w.gitTimer);
    this.watches.delete(projectId);
  }

  unwatchAll(): void {
    for (const id of [...this.watches.keys()]) this.unwatch(id);
  }

  isWatching(projectId: string): boolean {
    return this.watches.has(projectId);
  }
}
