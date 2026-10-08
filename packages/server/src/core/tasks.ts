/** 长任务管理（C-31 / API-7）：异步 + 进度 + 可取消 + 部分成功有状态。 */
import type { TaskInfo } from '@ttfolio/shared';
import { ulid } from './ulid.js';
import type { SseHub } from './sse.js';
import type { Logger } from './logger.js';

export interface TaskContext {
  taskId: string;
  /** 抛出 CANCELLED AppError */
  checkCancelled(): void;
  isCancelled(): boolean;
  progress(done: number, total: number, phase?: string): void;
}

type Runner = (ctx: TaskContext) => Promise<void>;

interface TaskRecord extends TaskInfo {
  cancelled: boolean;
}

export class TaskManager {
  private tasks = new Map<string, TaskRecord>();

  constructor(
    private readonly sse: SseHub,
    private readonly logger: Logger,
  ) {}

  start(kind: TaskInfo['kind'], title: string, total: number, runner: Runner): string {
    const taskId = ulid();
    const record: TaskRecord = {
      taskId,
      kind,
      title,
      done: 0,
      total,
      status: 'running',
      startedAt: new Date().toISOString(),
      cancelled: false,
    };
    this.tasks.set(taskId, record);
    const ctx: TaskContext = {
      taskId,
      checkCancelled: () => {
        if (record.cancelled) {
          const err = new Error('已取消') as Error & { code?: string };
          err.code = 'CANCELLED';
          throw err;
        }
      },
      isCancelled: () => record.cancelled,
      progress: (done, total_, phase) => {
        record.done = done;
        record.total = total_;
        if (phase) record.title = `${title} — ${phase}`;
        this.emitProgress(record);
      },
    };
    void runner(ctx)
      .then(() => {
        if (record.cancelled) {
          record.status = 'cancelled';
        } else {
          record.status = 'done';
          record.done = record.total;
        }
        record.finishedAt = new Date().toISOString();
        this.emitProgress(record);
      })
      .catch((err: unknown) => {
        const code = (err as { code?: string }).code;
        record.status = code === 'CANCELLED' ? 'cancelled' : 'error';
        record.error = err instanceof Error ? err.message : String(err);
        record.finishedAt = new Date().toISOString();
        this.emitProgress(record);
        if (record.status === 'error') {
          this.logger.warn({ mod: 'tasks', msg: `task ${record.kind} failed: ${record.error}` });
        }
      })
      .finally(() => {
        // 已结束的任务保留 10 分钟供查询
        setTimeout(
          () => {
            const t = this.tasks.get(taskId);
            if (t && t.status !== 'running') this.tasks.delete(taskId);
          },
          10 * 60 * 1000,
        );
      });
    return taskId;
  }

  cancel(taskId: string): boolean {
    const t = this.tasks.get(taskId);
    if (!t || t.status !== 'running') return false;
    t.cancelled = true;
    return true;
  }

  get(taskId: string): TaskInfo | null {
    const t = this.tasks.get(taskId);
    if (!t) return null;
    const { cancelled: _c, ...info } = t;
    return info;
  }

  list(): TaskInfo[] {
    return [...this.tasks.values()]
      .filter((t) => t.status === 'running')
      .map((t) => {
        const { cancelled: _c, ...info } = t;
        return info;
      });
  }

  private emitProgress(t: TaskRecord): void {
    const event = t.kind === 'index' ? 'search.index.progress' : 'analysis.progress';
    this.sse.publish(event, {
      taskId: t.taskId,
      projectId: undefined,
      done: t.done,
      total: t.total,
      status: t.status,
      title: t.title,
      error: t.error,
    });
  }
}
