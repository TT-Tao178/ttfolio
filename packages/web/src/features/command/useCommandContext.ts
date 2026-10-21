/** 命令上下文 Hook（FR-13.6 / T-100）：App 快捷键与命令面板共用同一套动作实现，
 * 避免「面板里能关标签、快捷键关标签不提示未保存」这类双实现漂移。 */
import { App as AntdApp } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useSettings } from '@/app/settings';
import { useAppStore } from '@/app/store';
import { useCloseTab } from '@/app/useCloseTab';
import { api } from '@/lib/api';
import type { CommandContext } from './registry';

export function useCommandContext(): CommandContext {
  const { message } = AntdApp.useApp();
  const { settings, setSetting } = useSettings();
  const closeTabConfirmed = useCloseTab();
  const queryClient = useQueryClient();
  const store = useAppStore();
  const activeTab = store.tabs.find((t) => t.id === store.activeTabId) ?? null;

  return {
    store: useAppStore.getState(),
    settings,
    setSetting,
    message: {
      success: (c: string) => void message.success(c),
      info: (c: string) => void message.info(c),
      error: (c: string) => void message.error(c),
    },
    actions: {
      openProject: async (projectId: string) => {
        await api.post(`/api/projects/${projectId}/open`);
        let name = projectId;
        try {
          const p = await api.get<{ alias: string | null; diskName: string }>(`/api/projects/${projectId}`);
          name = p.alias ?? p.diskName;
        } catch {
          /* 名称取不到不影响打开（标题回落 id 并如实呈现） */
        }
        openTabWith(store, projectId, name);
      },
      analyze: async (ids: string[]) => {
        for (const pid of ids) await api.post(`/api/projects/${pid}/analyze`);
      },
      rebuildIndex: async (ids: string[]) => {
        for (const pid of ids) await api.post('/api/search/index', { projectId: pid });
        void queryClient.invalidateQueries({ queryKey: ['index-status'] });
      },
      openExternal: async (projectId: string, target: 'explorer' | 'terminal') => {
        await api.post('/api/open', { projectId, target });
      },
      runTemplate: async (projectId: string, templateId: string) => {
        await api.post('/api/open', { projectId, target: 'template', templateId });
      },
      closeActive: () => {
        const tab = store.tabs.find((t) => t.id === store.activeTabId);
        if (tab !== undefined) closeTabConfirmed(tab);
      },
      cycleTab: (delta: number) => {
        const idx = store.tabs.findIndex((t) => t.id === store.activeTabId);
        const next = store.tabs[(idx + delta + store.tabs.length) % Math.max(store.tabs.length, 1)];
        if (next !== undefined) store.activateTab(next.id);
      },
    },
    activeProjectId: activeTab?.projectId ?? null,
    activeProjectName: activeTab?.title ?? null,
  };
}

function openTabWith(store: ReturnType<typeof useAppStore.getState>, projectId: string, name: string): void {
  store.openTab({ kind: 'project', projectId, targetPath: null, subTab: 'files', scroll: 0 }, name);
}
