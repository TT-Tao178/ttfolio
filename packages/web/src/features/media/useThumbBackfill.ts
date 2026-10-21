/** 缩略图后台补建（FR-13.5 / T-113）：项目分析完成后，把该项目缺失的 g 档
 * 缩略图静默补建（单次 ≤200 张、并发 2、状态栏可见、可取消）。
 * 只补「缺失」：已有索引的条目跳过；失败不重试（下次分析或滚动可视时再试）。 */
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { useAppStore } from '@/app/store';
import { subscribeSseEvents } from '@/app/sse';
import type { MediaItem, ProjectDetail } from '@ttfolio/shared';
import { planMissingThumbs } from './useThumbQueue';
import { generateThumb } from './thumbGen';

const BACKFILL_CAP = 200;
const BACKFILL_CONCURRENCY = 2;

async function runBackfill(projectId: string): Promise<void> {
  const store = useAppStore.getState();
  if (store.thumbBackfill !== null) return; // 同一时间只跑一个项目，避免互相挤占
  try {
    const [detail, items] = await Promise.all([
      api.get<ProjectDetail>(`/api/projects/${projectId}`),
      api.get<MediaItem[]>(`/api/projects/${projectId}/media`),
    ]);
    const targets = await planMissingThumbs(projectId, items, BACKFILL_CAP);
    if (targets.length === 0) return;
    useAppStore.getState().setThumbBackfill({ projectId, done: 0, total: targets.length, cancelled: false });

    const queue = [...targets];
    let done = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const cur = useAppStore.getState().thumbBackfill;
        if (cur === null || cur.cancelled) return;
        const item = queue.shift();
        if (item === undefined) return;
        await generateThumb(projectId, detail.dirPath, item, 'g');
        done += 1;
        const now = useAppStore.getState().thumbBackfill;
        if (now !== null) useAppStore.getState().setThumbBackfill({ ...now, done });
      }
    };
    await Promise.all(Array.from({ length: BACKFILL_CONCURRENCY }, () => worker()));
  } catch {
    /* 后台补建失败不打扰（状态栏消失；缩略图仍由可视区按需生成兜底） */
  } finally {
    useAppStore.getState().setThumbBackfill(null);
  }
}

/** 挂在 App 根：订阅 SSE，分析完成即补建。 */
export function useThumbBackfill(): void {
  useEffect(() => {
    const off = subscribeSseEvents((evt) => {
      if (evt.event !== 'project.analyzed') return;
      const projectId = evt.data['projectId'];
      if (typeof projectId === 'string' && projectId !== '') void runBackfill(projectId);
    });
    return off;
  }, []);
}
