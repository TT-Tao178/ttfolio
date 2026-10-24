/** UI 状态（Zustand）：标签会话、域切换、脏文件注册表（FR-1.2/1.3/4.3）。 */
import { create } from 'zustand';
import React, { useEffect, useRef } from 'react';
import { ulidLike } from '@/lib/ulid';

export type TabKind =
  | 'overview'
  | 'project'
  | 'file'
  | 'image'
  | 'doc'
  | 'archive'
  | 'git'
  | 'search'
  | 'settings'
  | 'trash'
  | 'activity'
  | 'compare'
  | 'doclib'
  | 'plugins';

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

export type Domain = 'projects' | 'git' | 'archives' | 'docs' | 'search' | 'activity' | 'settings';

interface AppState {
  tabs: Tab[];
  activeTabId: string | null;
  domain: Domain;
  sidebarCollapsed: boolean;
  detailVisible: boolean;
  /** 集成终端底部面板（FR-14.2 / T-104） */
  terminalOpen: boolean;
  /** 窗口嵌入面板（FR-14.3 / T-102，实验性） */
  embedOpen: boolean;
  /**
   * 遮挡寄宿画面的原生浮层计数（T-131 空域守卫）：>0 时寄宿窗口必须让位（隐藏 + poster 顶住）。
   * 由 EmbedPanel 的 MutationObserver 维护；可见性本身仍由主进程的推导函数统一决定。
   */
  nativeOverlayCount: number;
  dirty: Map<string, true>;
  settingsPaletteOpen: boolean;
  paletteOpen: boolean;
  /** 命令面板打开时的搜索作用域（「在当前项目内搜索」入口置 project，体检 P2） */
  paletteScope: 'all' | 'project';
  /** 面板模式（FR-13.6）：search 搜索为主 / command 命令模式 */
  paletteMode: 'search' | 'command';
  /** 已关闭标签栈（评审：缺「恢复已关闭」）——closeTab 压栈（上限 10），reopenLastClosed 弹出重开 */
  closedTabs: Array<{ loc: TabLocation; title: string }>;

  openTab: (loc: TabLocation, title: string) => void;
  closeTab: (id: string) => string | null;
  reopenLastClosed: () => void;
  activateTab: (id: string) => void;
  moveTab: (from: number, to: number) => void;
  togglePin: (id: string) => void;
  updateActiveLocation: (loc: Partial<TabLocation>, pushHistory: boolean) => void;
  navigate: (delta: number) => void;
  renameTab: (id: string, title: string) => void;
  setDomain: (d: Domain) => void;
  setSidebar: (v: boolean) => void;
  setDetail: (v: boolean) => void;
  setTerminalOpen: (v: boolean) => void;
  setEmbedOpen: (v: boolean) => void;
  setNativeOverlayCount: (n: number) => void;
  markDirty: (key: string) => void;
  clearDirty: (key: string) => void;
  setPalette: (v: boolean, opts?: { scope?: 'all' | 'project'; mode?: 'search' | 'command' }) => void;
  /** 「＋导入」入口信号：顶栏按钮自增，工作台监听到变化即打开添加项目弹窗 */
  addProjectNonce: number;
  requestAddProject: () => void;
  /** 新手导览（T-120）：设置→关于「重新查看」入口信号，nonce 自增触发 */
  onboardingNonce: number;
  requestOnboarding: () => void;
  /** 拖拽登记（T-118）：全局 drop 收集到的路径，AddProjectModal 打开时消费一次 */
  addProjectPrefill: string | null;
  setAddProjectPrefill: (v: string | null) => void;
  /** 待自动打开第一个文件的项目 id（打开项目落「文件」页签时设置，FilesTab 消费后清空） */
  pendingAutoOpenProject: string | null;
  requestAutoOpenProject: (projectId: string) => void;
  /** 面包屑目录段点击的定位请求（第 26 轮）：FilesTab 监听 nonce 变化，展开树到该目录并选中 */
  treeLocate: { projectId: string; path: string; nonce: number } | null;
  setTreeLocate: (loc: { projectId: string; path: string }) => void;
  /** 缩略图后台补建进度（FR-13.5 / T-113）：状态栏展示 + 可取消 */
  thumbBackfill: { projectId: string; done: number; total: number; cancelled: boolean } | null;
  setThumbBackfill: (
    v: { projectId: string; done: number; total: number; cancelled: boolean } | null,
  ) => void;
  /** 媒体联动信号（FR-13.5）：文件树点击媒体文件 → 跳媒体页签并开灯箱 */
  mediaFocus: { projectId: string; path: string; nonce: number } | null;
  setMediaFocus: (loc: { projectId: string; path: string }) => void;
  /** 写回活动标签的内容区滚动位置（0.3.8 补 KNOWN-GAPS #4：滚动随会话持久化） */
  setActiveTabScroll: (scroll: number) => void;
  syncFromServer: (
    tabs: Array<{
      id: string;
      kind: TabKind;
      projectId?: string | null;
      targetPath?: string | null;
      subTab?: string | null;
      titleSnapshot?: string | null;
      scrollJson?: string | null;
      navHistoryJson?: string | null;
      navIndex?: number;
      isPinned?: boolean;
    }>,
    activeId: string | null,
  ) => void;
}

function tabKey(loc: TabLocation): string {
  const base = `${loc.kind}|${loc.projectId ?? ''}|${loc.targetPath ?? ''}`;
  // 工作台总览 / 卡片墙 / 我的视图 属于同一个 kind 的不同屏，必须把 subTab 纳入标识：
  // 否则点侧栏「最近打开」会复用「工作台总览」标签并停在总览屏（表现为"点了没反应"）。
  // 项目标签不纳入 subTab —— 项目页内切页签必须复用同一标签。
  if (loc.kind === 'overview') return `${base}|${loc.subTab ?? 'home'}`;
  // 项目标签也**不能**纳入 targetPath：项目标签内部"当前打开哪个文件"由 targetPath + 历史栈表示，
  // 一旦它进了标识，打开过文件后再点项目卡就会开出第二个同名标签（实测会滚出十几个同名标签）。
  // 而 kind='file'（搜索面板打开文件）与 kind='git'（提交详情）本身就是"一个路径一个标签"，保留 targetPath。
  if (loc.kind === 'project') return `${loc.kind}|${loc.projectId ?? ''}`;
  return base;
}

export const useAppStore = create<AppState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  domain: 'projects',
  sidebarCollapsed: false,
  detailVisible: true,
  terminalOpen: false,
  embedOpen: false,
  nativeOverlayCount: 0,
  dirty: new Map(),
  settingsPaletteOpen: false,
  paletteOpen: false,
  paletteScope: 'all',
  paletteMode: 'search',
  closedTabs: [],

  openTab: (loc, title) => {
    const { tabs } = get();
    const key = tabKey(loc);
    const found = tabs.find((t) => tabKey(t) === key);
    if (found !== undefined) {
      // 复用既有标签时必须同步位置（尤其 subTab）：否则在工作台点项目卡会停在旧页签
      // （例如上次停在「文档」），看起来像"点了没打开文件页"。
      set({ activeTabId: found.id });
      get().updateActiveLocation(loc, true);
      if (title !== '') get().renameTab(found.id, title);
      return;
    }
    const tab: Tab = {
      ...loc,
      id: ulidLike(),
      title,
      history: [{ ...loc }],
      historyIndex: 0,
      isPinned: false,
      invalid: null,
    };
    set({ tabs: [...tabs, tab], activeTabId: tab.id });
  },

  closeTab: (id) => {
    const { tabs, activeTabId, dirty } = get();
    const tab = tabs.find((t) => t.id === id);
    if (tab === undefined) return null;
    const tabDirtyKey =
      tab.projectId !== null && tab.targetPath !== null ? `${tab.projectId}|${tab.targetPath}` : null;
    if (tabDirtyKey !== null && dirty.has(tabDirtyKey)) return id;
    const idx = tabs.findIndex((t) => t.id === id);
    // 记入已关闭栈（供「恢复已关闭标签」；脏标签被拦截的不记）
    set({
      closedTabs: [
        ...get().closedTabs,
        {
          loc: {
            kind: tab.kind,
            projectId: tab.projectId,
            targetPath: tab.targetPath,
            subTab: tab.subTab,
            scroll: tab.scroll,
          },
          title: tab.title,
        },
      ].slice(-10),
    });
    const next = tabs.filter((t) => t.id !== id);
    const nextActive = activeTabId === id ? (next[Math.min(idx, next.length - 1)]?.id ?? null) : activeTabId;
    set({ tabs: next, activeTabId: nextActive });
    // 关掉最后一个标签后不再留空白（用户反馈）：默认打开工作台总览；
    // 会话随 1s 防抖持久化，重启后恢复的也是总览（替代原「空会话」分支）
    if (next.length === 0) {
      get().openTab(
        { kind: 'overview', projectId: null, targetPath: null, subTab: null, scroll: 0 },
        '工作台',
      );
    }
    return null;
  },

  reopenLastClosed: () => {
    const { closedTabs } = get();
    const last = closedTabs[closedTabs.length - 1];
    if (last === undefined) return;
    set({ closedTabs: closedTabs.slice(0, -1) });
    get().openTab(last.loc, last.title);
  },

  activateTab: (id) => set({ activeTabId: id }),

  moveTab: (from, to) => {
    const { tabs } = get();
    if (from === to || from < 0 || to < 0 || from >= tabs.length || to >= tabs.length) return;
    const moved = tabs[from];
    if (moved === undefined) return;
    // 固定标签恒居最左（浏览器惯例，评审一.7）：非固定标签拖不进固定区、固定标签拖不出固定区
    const pinCount = tabs.filter((t) => t.isPinned).length;
    const lo = moved.isPinned ? 0 : pinCount;
    const hi = moved.isPinned ? Math.max(pinCount - 1, 0) : tabs.length - 1;
    const clamped = Math.min(Math.max(to, lo), hi);
    if (clamped === from) return;
    const next = [...tabs];
    const [taken] = next.splice(from, 1);
    if (taken === undefined) return;
    next.splice(clamped, 0, taken);
    set({ tabs: next });
  },

  togglePin: (id) => {
    set({
      tabs: get().tabs.map((t) => (t.id === id ? { ...t, isPinned: !t.isPinned } : t)),
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
          scroll: loc.scroll ?? t.scroll,
        };
        if (!pushHistory) return { ...t, ...merged };
        const kept = t.history.slice(0, t.historyIndex + 1);
        if (kept.length > 0) {
          const last = kept[kept.length - 1];
          // 必须比较**完整位置**，不能用 tabKey：tabKey 是"标签标识"（项目标签刻意不含 subTab/targetPath，
          // 以便复用同一标签），拿它判断"导航是否变化"会把"文件页→Git 页"当成没变化而不压栈，
          // 结果前进/后退无法在项目内页签之间回退（实测：文件→Git 后按后退仍停在 Git）。
          if (last !== undefined && sameLocation(last, merged)) {
            return { ...t, ...merged };
          }
        }
        const history = [...kept, { ...merged }].slice(-100);
        return { ...t, ...merged, history, historyIndex: history.length - 1 };
      }),
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
      }),
    });
  },

  renameTab: (id, title) => {
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, title } : t)) });
  },

  setDomain: (d) => set({ domain: d }),
  setSidebar: (v) => set({ sidebarCollapsed: v }),
  setDetail: (v) => set({ detailVisible: v }),
  setTerminalOpen: (v) => set({ terminalOpen: v }),
  setEmbedOpen: (v) => set({ embedOpen: v }),
  setNativeOverlayCount: (n) => {
    const next = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    if (get().nativeOverlayCount !== next) set({ nativeOverlayCount: next });
  },
  markDirty: (key) => set({ dirty: new Map(get().dirty).set(key, true) }),
  clearDirty: (key) => {
    const m = new Map(get().dirty);
    m.delete(key);
    set({ dirty: m });
  },
  setPalette: (v, opts) =>
    set({
      paletteOpen: v,
      ...(opts?.scope !== undefined ? { paletteScope: opts.scope } : {}),
      ...(opts?.mode !== undefined ? { paletteMode: opts.mode } : {}),
    }),
  addProjectNonce: 0,
  requestAddProject: () => set({ addProjectNonce: get().addProjectNonce + 1 }),
  onboardingNonce: 0,
  requestOnboarding: () => set({ onboardingNonce: get().onboardingNonce + 1 }),
  addProjectPrefill: null,
  setAddProjectPrefill: (v) => set({ addProjectPrefill: v }),
  pendingAutoOpenProject: null,
  requestAutoOpenProject: (projectId) => set({ pendingAutoOpenProject: projectId }),
  treeLocate: null,
  setTreeLocate: (loc) => set({ treeLocate: { ...loc, nonce: Date.now() } }),
  thumbBackfill: null,
  setThumbBackfill: (v) => set({ thumbBackfill: v }),
  mediaFocus: null,
  setMediaFocus: (loc) => set({ mediaFocus: { ...loc, nonce: Date.now() } }),
  setActiveTabScroll: (scroll) => {
    const { tabs, activeTabId } = get();
    if (activeTabId === null) return;
    // tabs 引用变化会触发既有 1s 会话防抖 PUT，滚动随会话落库（0.3.8 补 KNOWN-GAPS #4）
    set({ tabs: tabs.map((t) => (t.id === activeTabId && t.scroll !== scroll ? { ...t, scroll } : t)) });
  },

  syncFromServer: (serverTabs, activeId) => {
    const tabs = serverTabs.map<Tab>((t) => {
      let restoredScroll = 0;
      if (t.scrollJson !== null && t.scrollJson !== undefined && t.scrollJson !== '') {
        try {
          const parsed = JSON.parse(t.scrollJson) as { scroll?: unknown };
          if (typeof parsed.scroll === 'number' && Number.isFinite(parsed.scroll) && parsed.scroll > 0) {
            restoredScroll = parsed.scroll;
          }
        } catch {
          /* 脏数据回落 0 */
        }
      }
      const loc: TabLocation = {
        kind: t.kind,
        projectId: t.projectId ?? null,
        targetPath: t.targetPath ?? null,
        subTab: t.subTab ?? null,
        scroll: restoredScroll,
      };
      // 历史栈必须随标签一起恢复：原实现把 history 置空、historyIndex 置 -1，
      // 于是刷新/重启后「后退/前进」永远按不动（FR-1.3 要求恢复页签与浏览历史）。
      const restored = parseNavHistory(t.navHistoryJson, loc, t.navIndex);
      return {
        id: t.id,
        ...loc,
        title: t.titleSnapshot ?? t.kind,
        history: restored.history,
        historyIndex: restored.index,
        isPinned: t.isPinned ?? false,
        invalid: null,
      };
    });
    // FR-1.4：恢复"上次活动的标签"。服务端 activeTabId 可能为 null（老库）或指向一个已不存在的
    // 标签（异常中断保存）——两种都必须回落到第一个标签，绝不能把 activeTabId 设成悬空 id，
    // 否则恢复后没有任何标签匹配到 → 内容区整片空白。
    const restoredActive =
      activeId !== null && tabs.some((t) => t.id === activeId) ? activeId : (tabs[0]?.id ?? null);
    set({ tabs, activeTabId: restoredActive });
  },
}));

const TAB_KINDS: string[] = [
  'overview',
  'project',
  'file',
  'image',
  'doc',
  'archive',
  'git',
  'search',
  'settings',
  'trash',
];

/** 两个位置是否完全相同（导航是否真的发生了）。用于"是否压入历史栈"的判断。 */
function sameLocation(a: TabLocation, b: TabLocation): boolean {
  return (
    a.kind === b.kind && a.projectId === b.projectId && a.targetPath === b.targetPath && a.subTab === b.subTab
  );
}

function isTabLocation(v: unknown): v is TabLocation {
  if (typeof v !== 'object' || v === null) return false;
  const k = (v as { kind?: unknown }).kind;
  return typeof k === 'string' && TAB_KINDS.includes(k);
}

/** 解析服务端会话里的 navHistoryJson；脏数据/空历史回落到"单点历史"，绝不留下空栈。 */
function parseNavHistory(
  json: string | null | undefined,
  fallback: TabLocation,
  navIndex: number | undefined,
): { history: TabLocation[]; index: number } {
  try {
    if (json !== null && json !== undefined && json !== '') {
      const parsed = JSON.parse(json) as { history?: unknown; index?: unknown };
      const raw = Array.isArray(parsed.history) ? parsed.history : [];
      const history = raw.filter(isTabLocation).slice(-100);
      if (history.length > 0) {
        const want = typeof parsed.index === 'number' ? parsed.index : navIndex;
        const idx = typeof want === 'number' ? want : history.length - 1;
        return { history, index: Math.min(Math.max(idx, 0), history.length - 1) };
      }
    }
  } catch {
    /* 脏历史数据：落到单点历史 */
  }
  return { history: [{ ...fallback }], index: 0 };
}

/** 前进/后退可用性（供路径条按钮置灰，避免"按了没反应"却看不出原因）。 */
export function navAvailability(tab: Tab | null): { back: boolean; forward: boolean } {
  if (tab === null) return { back: false, forward: false };
  return { back: tab.historyIndex > 0, forward: tab.historyIndex < tab.history.length - 1 };
}

export function serializeSession(tabs: Tab[], activeTabId: string | null) {
  return {
    tabs: tabs.map((t, i) => {
      // 体检 P2：历史栈截断保留尾部 30 条时 index 必须同步平移——
      // 原实现 index 仍按原数组下标序列化，恢复后前进/后退指向错位
      const hist = t.history.slice(-30);
      const shift = t.history.length - hist.length;
      return {
        id: t.id,
        sortOrder: i,
        kind: t.kind,
        projectId: t.projectId,
        targetPath: t.targetPath,
        subTab: t.subTab,
        titleSnapshot: t.title,
        scrollJson: JSON.stringify({ scroll: t.scroll }),
        navHistoryJson: JSON.stringify({ history: hist, index: t.historyIndex - shift }),
        navIndex: t.historyIndex - shift,
        isPinned: t.isPinned,
      };
    }),
    activeTabId,
  };
}

/**
 * 标签内容区滚动同步（0.3.8 补 KNOWN-GAPS #4）：
 * 滚动 300ms 防抖写回活动标签（随会话落库）；key 变化（切标签/切视图/切页签）时回放该标签的 scroll。
 * 用法：const ref = useRef<HTMLDivElement>(null); useTabScroll(ref, `${activeTabId}|${subTab}`);
 */
export function useTabScroll(ref: React.RefObject<HTMLElement | null>, key: string): void {
  const activeTabId = useAppStore((s) => s.activeTabId);
  // 期望滚动位置：回放时设为恢复值；用户滚动（防抖后）跟随实际值。
  // 内容常在恢复之后才异步撑高（卡片墙数据未返回时回放会被钳回 0）——
  // 因此回放后在 400ms/1000ms 各补一次，把位置拉回期望值。
  const expectedRef = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const expected = useAppStore.getState().tabs.find((t) => t.id === activeTabId)?.scroll ?? 0;
    expectedRef.current = expected;
    el.scrollTop = expected;
    const t1 = setTimeout(() => {
      el.scrollTop = expectedRef.current;
    }, 400);
    const t2 = setTimeout(() => {
      el.scrollTop = expectedRef.current;
    }, 1000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // key 变化即回放（切标签/切视图）；activeTabId 变化必然伴随 key 变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = (): void => {
      // 钳位噪声过滤（体检复测发现）：回放时内容尚未撑高，scrollTop 被钳到 0 的
      // 滚动事件若照常写回，会把期望位置降级成 0、补偿回放随之失效——内容高度
      // 不足以到达期望位置时忽略本次滚动
      if (expectedRef.current > 0 && el.scrollHeight < expectedRef.current + el.clientHeight) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        expectedRef.current = Math.round(el.scrollTop);
        useAppStore.getState().setActiveTabScroll(Math.round(el.scrollTop));
      }, 300);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (timer !== null) clearTimeout(timer);
    };
  }, [ref]);
}
