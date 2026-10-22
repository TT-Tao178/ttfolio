/**
 * 移动/复制任务执行体（FR-4.7 / KNOWN-GAPS #1）：从路由抽出，便于对取消、
 * 部分成功、「失败绝不删源」做直接单测。进度与取消语义：
 * - 同盘 move 走 rename 瞬时完成（与 movePath 原语义一致）；
 * - 其余走 渐进复制 → 渐进校验 →（move）删源；verify 全部通过才删源（ERR-6），
 *   取消发生在删源前，源目录恒完整；
 * - 取消时本次新建的目标半成品会被清理；目标原已存在（覆盖语义）则保留现场
 *   并如实计入失败——旧内容在预检阶段已按用户确认删除，无法也不应悄悄"还原"；
 * - 单项失败不中止整批（部分成功范式同 trash-empty），终态以 markPartial 标记。
 */
import { isErrnoException } from './errors.js';
import * as fsx from './fsx.js';
import type { TaskContext } from './tasks.js';

export interface MoveStep {
  src: string;
  dest: string;
  /** 预检测得的源字节数（进度总量口径） */
  bytes: number;
  /** 目标在开工前是否已存在（overwrite 语义下旧内容已被删除） */
  destPreExisted: boolean;
  /** 项目根相对路径（正斜杠），供变更流水使用 */
  srcRel: string;
  destRel: string;
}

export interface MoveCopyOptions {
  mode: 'move' | 'copy';
}

export interface MoveCopyOutcome {
  succeeded: MoveStep[];
  failures: string[];
}

function isCancel(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'CANCELLED';
}

export async function runMoveCopyPlan(
  steps: MoveStep[],
  opts: MoveCopyOptions,
  taskCtx: TaskContext,
  onItemDone: (step: MoveStep) => void,
): Promise<MoveCopyOutcome> {
  const total = Math.max(
    steps.reduce((sum, s) => sum + s.bytes, 0),
    1,
  );
  // committed = 已完成项字节累计；复制进行中报表 = committed + 当前项已复制字节
  let committed = 0;
  let lastEmit = 0;
  const report = (done: number, phase: string): void => {
    const now = Date.now();
    if (now - lastEmit >= 300) {
      lastEmit = now;
      taskCtx.progress(done, total, phase);
    }
  };
  const succeeded: MoveStep[] = [];
  const failures: string[] = [];
  const noteFailure = (step: MoveStep, err: unknown): void => {
    failures.push(`${step.srcRel}：${err instanceof Error ? err.message : String(err)}`);
    taskCtx.markPartial(failures.join('；'));
  };
  // 取消/失败时正在进行的项：fresh 目标是本次新建，清掉半成品
  let inFlight: { step: MoveStep; fresh: boolean } | null = null;

  const cleanupFresh = (): void => {
    if (inFlight === null || !inFlight.fresh) return;
    try {
      fsx.rmSync(inFlight.step.dest, { recursive: true, force: true });
    } catch {
      /* 清理失败保留现场，失败说明里已如实记录 */
    }
  };

  for (const step of steps) {
    taskCtx.checkCancelled();
    if (opts.mode === 'move') {
      try {
        fsx.renameSync(step.src, step.dest);
        fsx.markSelfWrite(step.dest);
        committed += step.bytes;
        report(committed, '移动');
        succeeded.push(step);
        onItemDone(step);
        continue;
      } catch (err) {
        if (!isErrnoException(err) || err.code !== 'EXDEV') {
          noteFailure(step, err);
          continue;
        }
        // 跨盘 → 走 渐进复制+校验+删源
      }
    }
    inFlight = { step, fresh: !step.destPreExisted };
    try {
      await fsx.copyTreeProgressive(step.src, step.dest, {
        checkCancelled: taskCtx.checkCancelled,
        onProgress: (n) => {
          report(committed + n, '复制');
        },
      });
      report(committed + step.bytes, '校验');
      await fsx.verifyTreeProgressive(step.src, step.dest, { checkCancelled: taskCtx.checkCancelled });
    } catch (err) {
      cleanupFresh();
      inFlight = null;
      if (isCancel(err)) throw err;
      noteFailure(step, err);
      continue;
    }
    inFlight = null;
    if (opts.mode === 'move') {
      // 校验已全部通过，此处删源不可取消也无需取消（数据已在目标完整存在）
      fsx.rmSync(step.src, { recursive: true, force: false });
      report(committed + step.bytes, '删源');
    }
    fsx.markSelfWrite(step.dest);
    committed += step.bytes;
    succeeded.push(step);
    onItemDone(step);
  }
  taskCtx.progress(total, total);
  if (failures.length > 0) taskCtx.markPartial(failures.join('；'));
  return { succeeded, failures };
}
