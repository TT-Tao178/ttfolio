/**
 * 可拖拽面板尺寸（UI 偏好）。
 * 存储：服务端 settings 表 `ui_layout_json`（C-29：不用 localStorage 存业务/用户偏好；
 *      主题首帧缓存是唯一显式例外，见 DECISIONS.md TT-THEME-CACHE）。
 * 用法：拖动中 setSize 即时生效（不落库），拖动结束 commit 防抖写库——
 *      与 AntD Splitter 的受控 size + onResize/onResizeEnd 契约一致。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSettings } from '@/app/settings';

export interface UiLayout {
  sidebarWidth?: number;
  detailWidth?: number;
  treeWidth?: number;
  gitListWidth?: number;
  docsListWidth?: number;
}

export interface PaneSize {
  size: number;
  setSize: (v: number) => void;
  commit: (v: number) => void;
}

/** 设置在 react-query 里的缓存键（与 app/settings.tsx 的 useQuery 保持一致） */
const SETTINGS_QUERY_KEY = ['settings'] as const;

export function usePaneSize(key: keyof UiLayout, def: number): PaneSize {
  const { settings, setSetting } = useSettings();
  const queryClient = useQueryClient();
  const layout: UiLayout = useMemo(() => settings.uiLayout ?? {}, [settings.uiLayout]);
  const saved = layout[key];
  const [size, setSize] = useState<number>(typeof saved === 'number' && saved > 0 ? saved : def);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 服务端设置异步到达后同步一次（组件可能已用默认值挂载）
  useEffect(() => {
    if (typeof saved === 'number' && saved > 0) setSize(saved);
  }, [saved]);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const commit = useCallback(
    (v: number) => {
      const rounded = Math.round(v);
      setSize(rounded);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        // 关键：以「写入时刻的最新 uiLayout」为基准合并。
        // PATCH /api/settings 只回 {saved:true} 不回传设置，所以不能依赖服务端回包更新缓存——
        // 否则多个分栏各自持有一份陈旧快照，后写的会把先写的键覆盖掉（实测 sidebarWidth 被 detailWidth 覆盖）。
        const cached = queryClient.getQueryData<{ uiLayout?: UiLayout }>(SETTINGS_QUERY_KEY)?.uiLayout ?? {};
        const merged = { ...cached, [key]: rounded };
        queryClient.setQueryData(SETTINGS_QUERY_KEY, (old: unknown) => ({
          ...(typeof old === 'object' && old !== null ? old : {}),
          uiLayout: merged
        }));
        setSetting('uiLayout', merged);
      }, 400);
    },
    [key, setSetting, queryClient]
  );

  return { size, setSize, commit };
}
