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
  /** 部分成功标记（FR-4.7）：任务照常完成，但状态与历史里带失败说明。 */
  markPartial(message: string): void;
}

type Runner = (ctx: TaskContext) => Promise<void>;

interface TaskRecord extends TaskInfo {
  cancelled: boolean;
}

/** 任务历史持久化钩子（FR-13.11 / T-108）：实现方自兜异常隔离之外，这里再 try/catch 包一层。 */
export interface TaskRunPersist {
  runStarted(id: string, kind: string, title: string, startedAt: string): void;
  runFinished(
    id: string,
    status: 'done' | 'error' | 'cancelled',
    error: string | null,
    finishedAt: string,
    done: number,
    total: number,
  ): void;
}

export class TaskManager {
  private tasks = new Map<string, TaskRecord>();
  private persist: TaskRunPersist | null = null;

  constructor(
    private readonly sse: SseHub,
    private readonly logger: Logger,
  ) {}

  /** 挂接任务历史落库（库打开后调用；传 null 解绑）。持久化失败绝不影响任务本身。 */
  setRunPersistence(p: TaskRunPersist | null): void {
    this.persist = p;
  }

  start(
    kind: TaskInfo['kind'],
    title: string,
    total: number,
    runner: Runner,
    meta?: { projectId?: string },
  ): string {
    const taskId = ulid();
    const record: TaskRecord = {
      taskId,
      kind,
      title,
      done: 0,
      total,
      status: 'running',
      projectId: meta?.projectId,
      startedAt: new Date().toISOString(),
      cancelled: false,
    };
    this.tasks.set(taskId, record);
    try {
      this.persist?.runStarted(taskId, record.kind, title, record.startedAt);
    } catch {
      /* 历史落库失败不影响任务 */
    }
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
      markPartial: (message) => {
        record.partial = true;
        record.error = message;
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
        try {
          this.persist?.runFinished(
            taskId,
            record.status as 'done' | 'cancelled',
            null,
            record.finishedAt,
            record.done,
            record.total,
          );
        } catch {
          /* 历史落库失败不影响任务 */
        }
      })
      .catch((err: unknown) => {
        const code = (err as { code?: string }).code;
        record.status = code === 'CANCELLED' ? 'cancelled' : 'error';
        record.error = err instanceof Error ? err.message : String(err);
        record.finishedAt = new Date().toISOString();
        this.emitProgress(record);
        try {
          this.persist?.runFinished(
            taskId,
            record.status as 'error' | 'cancelled',
            record.error,
            record.finishedAt,
            record.done,
            record.total,
          );
        } catch {
          /* 历史落库失败不影响任务 */
        }
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
    // analyze/index 沿用既有事件名（消费方零改动）；其余任务走通用 task.progress（FR-4.7）
    const event =
      t.kind === 'index'
        ? 'search.index.progress'
        : t.kind === 'analyze'
          ? 'analysis.progress'
          : 'task.progress';
    this.sse.publish(event, {
      taskId: t.taskId,
      projectId: t.projectId,
      done: t.done,
      total: t.total,
      status: t.status,
      title: t.title,
      error: t.error,
      partial: t.partial,
    });
  }
}
