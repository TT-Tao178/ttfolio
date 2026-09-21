/** UI 状态（Zustand）：标签会话、域切换、脏文件注册表（FR-1.2/1.3/4.3）。 */
import { create } from 'zustand';
import { ulidLike } from '@/lib/ulid';

export type TabKind = 'overview' | 'project' | 'file' | 'image' | 'doc' | 'archive' | 'git' | 'search' | 'settings' | 'trash';

export interface TabLocation {
  kind: TabKind;
  projectId: string | null;
  targetPath: string | null;
  subTab: string | null;
  scroll: number;
}

export interface Tab extends TabLocation {
  id: string;
  title: string;
  history: TabLocation[];
  historyIndex: number;
  isPinned: boolean;
  invalid: 'path-missing' | 'project-removed' | null;
}

export type Domain = 'projects' | 'git' | 'archives' | 'docs' | 'search' | 'settings';

interface AppState {
  tabs: Tab[];
  activeTabId: string | null;
  domain: Domain;
  sidebarCollapsed: boolean;
  detailVisible: boolean;
  dirty: Map<string, true>;
  settingsPaletteOpen: boolean;
  paletteOpen: boolean;

  openTab: (loc: TabLocation, title: string) => void;
  closeTab: (id: string) => string | null;
  activateTab: (id: string) => void;
  moveTab: (from: number, to: number) => void;
  togglePin: (id: string) => void;
  updateActiveLocation: (loc: Partial<TabLocation>, pushHistory: boolean) => void;
  navigate: (delta: number) => void;
  renameTab: (id: string, title: string) => void;
  setDomain: (d: Domain) => void;
  setSidebar: (v: boolean) => void;
  setDetail: (v: boolean) => void;
  markDirty: (key: string) => void;
  clearDirty: (key: string) => void;
  setPalette: (v: boolean) => void;
  syncFromServer: (tabs: Array<{ id: string; kind: TabKind; projectId?: string | null; targetPath?: string | null; subTab?: string | null; titleSnapshot?: string | null; scrollJson?: string | null; navHistoryJson?: string | null; navIndex?: number; isPinned?: boolean }>, activeId: string | null) => void;
}

function tabKey(loc: TabLocation): string {
  return `${loc.kind}|${loc.projectId ?? ''}|${loc.targetPath ?? ''}`;
}

export const useAppStore = create<AppState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  domain: 'projects',
  sidebarCollapsed: false,
  detailVisible: true,
  dirty: new Map(),
  settingsPaletteOpen: false,
  paletteOpen: false,

  openTab: (loc, title) => {
    const { tabs } = get();
    const key = tabKey(loc);
    const found = tabs.find((t) => tabKey(t) === key);
    if (found !== undefined) {
      set({ activeTabId: found.id });
      return;
    }
    const tab: Tab = {
      ...loc,
      id: ulidLike(),
      title,
      history: [{ ...loc }],
      historyIndex: 0,
      isPinned: false,
      invalid: null
    };
    set({ tabs: [...tabs, tab], activeTabId: tab.id });
  },

  closeTab: (id) => {
    const { tabs, activeTabId, dirty } = get();
    const tab = tabs.find((t) => t.id === id);
    if (tab === undefined) return null;
    const tabDirtyKey = tab.projectId !== null && tab.targetPath !== null ? `${tab.projectId}|${tab.targetPath}` : null;
    if (tabDirtyKey !== null && dirty.has(tabDirtyKey)) return id;
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    const nextActive =
      activeTabId === id ? (next[Math.min(idx, next.length - 1)]?.id ?? null) : activeTabId;
    set({ tabs: next, activeTabId: nextActive });
    return null;
  },

  activateTab: (id) => set({ activeTabId: id }),

  moveTab: (from, to) => {
    const { tabs } = get();
    if (from === to || from < 0 || to < 0 || from >= tabs.length || to >= tabs.length) return;
    const next = [...tabs];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    set({ tabs: next });
  },

  togglePin: (id) => {
    set({
      tabs: get().tabs.map((t) => (t.id === id ? { ...t, isPinned: !t.isPinned } : t))
    });
  },

  updateActiveLocation: (loc, pushHistory) => {
    const { tabs, activeTabId } = get();
    set({
      tabs: tabs.map((t) => {
        if (t.id !== activeTabId) return t;
        const merged: TabLocation = {
          kind: loc.kind ?? t.kind,
          projectId: loc.projectId !== undefined ? loc.projectId : t.projectId,
          targetPath: loc.targetPath !== undefined ? loc.targetPath : t.targetPath,
          subTab: loc.subTab !== undefined ? loc.subTab : t.subTab,
          scroll: loc.scroll ?? t.scroll
        };
        if (!pushHistory) return { ...t, ...merged };
        const kept = t.history.slice(0, t.historyIndex + 1);
        if (kept.length > 0) {
          const last = kept[kept.length - 1];
          if (last !== undefined && tabKey(last) === tabKey(merged)) {
            return { ...t, ...merged };
          }
        }
        const history = [...kept, { ...merged }].slice(-100);
        return { ...t, ...merged, history, historyIndex: history.length - 1 };
      })
    });
  },

  navigate: (delta) => {
    const { tabs, activeTabId } = get();
    set({
      tabs: tabs.map((t) => {
        if (t.id !== activeTabId) return t;
        const idx = t.historyIndex + delta;
        if (idx < 0 || idx >= t.history.length) return t;
        const loc = t.history[idx];
        if (loc === undefined) return t;
        return { ...t, ...loc, historyIndex: idx };
      })
    });
  },

  renameTab: (id, title) => {
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, title } : t)) });
  },

  setDomain: (d) => set({ domain: d }),
  setSidebar: (v) => set({ sidebarCollapsed: v }),
  setDetail: (v) => set({ detailVisible: v }),
  markDirty: (key) => set({ dirty: new Map(get().dirty).set(key, true) }),
  clearDirty: (key) => {
    const m = new Map(get().dirty);
    m.delete(key);
    set({ dirty: m });
  },
  setPalette: (v) => set({ paletteOpen: v }),

  syncFromServer: (serverTabs, activeId) => {
    const tabs = serverTabs.map<Tab>((t) => ({
      id: t.id,
      kind: t.kind,
      projectId: t.projectId ?? null,
      targetPath: t.targetPath ?? null,
      subTab: t.subTab ?? null,
      scroll: 0,
      title: t.titleSnapshot ?? t.kind,
      history: [],
      historyIndex: -1,
      isPinned: t.isPinned ?? false,
      invalid: null
    }));
    set({ tabs, activeTabId: activeId ?? tabs[0]?.id ?? null });
  }
}));

export function serializeSession(tabs: Tab[], activeTabId: string | null) {
  return {
    tabs: tabs.map((t, i) => ({
      id: t.id,
      sortOrder: i,
      kind: t.kind,
      projectId: t.projectId,
      targetPath: t.targetPath,
      subTab: t.subTab,
      titleSnapshot: t.title,
      scrollJson: JSON.stringify({ scroll: t.scroll }),
      navHistoryJson: JSON.stringify({ history: t.history.slice(-30), index: t.historyIndex }),
      navIndex: t.historyIndex,
      isPinned: t.isPinned
    })),
    activeTabId
  };
}
