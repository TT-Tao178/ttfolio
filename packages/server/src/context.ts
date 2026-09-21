/** 应用上下文：把依赖一次性装配（TS-12：显式初始化的单例边界）。 */
import type Database from 'better-sqlite3';
import type { Logger } from './core/logger.js';
import type { SseHub } from './core/sse.js';
import type { TaskManager } from './core/tasks.js';
import type { WatcherManager } from './core/watcher.js';
import type { TrashService } from './core/trash.js';
import type { DataDirLayout } from './config.js';
import type { LibraryStore } from './db/index.js';

export interface AppContext {
  logger: Logger;
  sse: SseHub;
  tasks: TaskManager;
  watcher: WatcherManager;
  trash: TrashService;
  layout: DataDirLayout;
  store: LibraryStore;
  db(): Database.Database;
  token: string;
  port: number;
  userContentPort: number;
  webDist: string | null;
  startedAt: number;
  version: string;
  dbSize(): number;
}
