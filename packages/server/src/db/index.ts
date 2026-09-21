/** 库连接（C-27 / FR-12.5）：单写连接；LibraryStore 预留"按工作区切换数据库文件"的抽象。 */
import Database from 'better-sqlite3';
import { AppError } from '../core/errors.js';

export interface WorkspaceRef {
  /** 工作区标识与库文件路径（当前单工作区，连接层已抽象） */
  id: string;
  dbFile: string;
}

export class LibraryStore {
  private db: Database.Database | null = null;
  private workspace: WorkspaceRef;

  constructor(workspace: WorkspaceRef) {
    this.workspace = workspace;
  }

  getWorkspace(): WorkspaceRef {
    return this.workspace;
  }

  /** 打开（或重开）库连接，应用 WAL/foreign_keys/busy_timeout/synchronous。 */
  open(): Database.Database {
    if (this.db !== null) return this.db;
    const db = new Database(this.workspace.dbFile);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
    this.db = db;
    return db;
  }

  get(): Database.Database {
    if (this.db === null) {
      throw new AppError('INTERNAL', '索引库尚未打开');
    }
    return this.db;
  }

  is_open(): boolean {
    return this.db !== null;
  }

  /** 关闭（恢复备份前调用）。 */
  close(): void {
    if (this.db !== null) {
      try {
        this.db.pragma('optimize');
      } catch {
        /* optimize 失败不阻断关闭 */
      }
      this.db.close();
      this.db = null;
    }
  }
}
