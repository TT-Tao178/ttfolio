/** 命令注册表（FR-13.6 / T-100，落地 7.3 动作注册表）：
 * 命令面板、快捷键改绑（FR-11.4）与「?」帮助的唯一来源。
 * 新增用户可见操作：先登记为命令，再在面板/快捷键里引用，禁止各处各写一份。
 * 预留插件命令贡献点（T-101 插件声明 commands 即自动入表）。 */
import type { ReactNode } from 'react';
import type { CommandTemplate, CustomView } from '@ttfolio/shared';
import type { useAppStore } from '@/app/store';
import type { SettingKey, SettingsShape } from '@/app/settings';

type AppStore = ReturnType<typeof useAppStore.getState>;

/** 需要服务端/跨组件协作的动作（由 CommandPalette 注入，保持 store 纯 UI 状态）。 */
export interface CommandActions {
  openProject: (projectId: string) => Promise<void>;
  analyze: (projectIds: string[]) => Promise<void>;
  rebuildIndex: (projectIds: string[]) => Promise<void>;
  openExternal: (projectId: string, target: 'explorer' | 'terminal') => Promise<void>;
  runTemplate: (projectId: string, templateId: string) => Promise<void>;
  closeActive: () => void;
  cycleTab: (delta: number) => void;
}

/** 命令面板执行上下文（由 CommandPalette 注入，命令实现不直接依赖 React）。 */
export interface CommandContext {
  store: AppStore;
  settings: SettingsShape;
  setSetting: (key: SettingKey, value: unknown) => void;
  message: {
    success: (content: string) => void;
    info: (content: string) => void;
    error: (content: string) => void;
  };
  actions: CommandActions;
  activeProjectId: string | null;
  activeProjectName: string | null;
}

export type CommandCategory = '视图' | '项目' | '外观' | '文件' | 'Git' | '模板' | '插件';

export interface CommandArg {
  name: 'projectIds';
  label: string;
  /** 参数表单类型：项目多选 */
  type: 'projects';
}

export interface CommandValues {
  projectIds?: string[];
}

export interface CommandDef {
  id: string;
  title: string;
  category: CommandCategory;
  icon?: ReactNode;
  /** 默认快捷键（chord 格式，如 'Ctrl+Shift+P'）；keyEditable 表示可在设置里改绑 */
  keys?: string;
  keyEditable?: boolean;
  /** 带参数的命令：选中后在面板内展开内联表单 */
  args?: CommandArg;
  /** 需要活动项目；无项目时禁用并提示 */
  needsProject?: boolean;
  run: (ctx: CommandContext, values: CommandValues) => void | Promise<void>;
}

/** 主题七种（与 tokens ThemeMode 对齐；命令里循环切换用） */
const THEMES = ['light', 'dark', 'oled', 'cyberpunk', 'sketch', 'glass', 'system'] as const;
const SCHEMES = ['classic', 'warm', 'neon'] as const;

function openStoreTab(
  store: AppStore,
  kind: Parameters<AppStore['openTab']>[0]['kind'],
  title: string,
  subTab: string | null = null,
): void {
  store.openTab({ kind, projectId: null, targetPath: null, subTab, scroll: 0 }, title);
}

function projectCommand(ctx: CommandContext, values: CommandValues): Array<{ id: string; name: string }> {
  void ctx;
  const ids = values.projectIds ?? [];
  return ids.map((id) => ({ id, name: id }));
}

/** 内置命令（顺序即面板默认展示顺序）。 */
export const BUILTIN_COMMANDS: CommandDef[] = [
  // ---- 视图 ----
  {
    id: 'view.workbench',
    title: '打开工作台总览',
    category: '视图',
    run: (ctx) => openStoreTab(ctx.store, 'overview', '工作台'),
  },
  {
    id: 'terminal.toggle',
    title: '打开 / 收起集成终端',
    category: '视图',
    keys: 'Ctrl+`',
    // T-123 收编：App 全局快捷键循环统一走注册表匹配（xterm 的
    // attachCustomKeyEventHandler 已把该组合交还宿主，聚焦终端时同样生效），
    // 硬编码分支已删除；可改绑。
    keyEditable: true,
    run: (ctx) => ctx.store.setTerminalOpen(!ctx.store.terminalOpen),
  },
  {
    id: 'view.plugins',
    title: '打开插件广场',
    category: '视图',
    run: (ctx) => openStoreTab(ctx.store, 'plugins', '插件广场'),
  },
  {
    id: 'palette.search',
    title: '全局搜索',
    category: '视图',
    keys: 'Ctrl+K',
    keyEditable: true,
    run: (ctx) => ctx.store.setPalette(true, { mode: 'search' }),
  },
  {
    id: 'palette.commands',
    title: '命令模式（打开命令面板）',
    category: '视图',
    keys: 'Ctrl+Shift+P',
    keyEditable: true,
    run: (ctx) => ctx.store.setPalette(true, { mode: 'command' }),
  },
  {
    id: 'view.settings',
    title: '打开设置',
    category: '视图',
    keys: 'Ctrl+,',
    keyEditable: true,
    run: (ctx) => openStoreTab(ctx.store, 'settings', '设置'),
  },
  {
    id: 'view.trash',
    title: '打开回收站',
    category: '视图',
    run: (ctx) => openStoreTab(ctx.store, 'trash', '回收站'),
  },
  {
    id: 'view.git-overview',
    title: '跨项目 Git 总览',
    category: 'Git',
    run: (ctx) => openStoreTab(ctx.store, 'search', 'Git 总览', 'git-overview'),
  },
  // 「打开搜索页」死命令已删（T-115）：kind='search' 除 git-overview 外无渲染分支，
  // 此前执行得到空白标签；搜索入口已有 Ctrl+K / 顶栏搜索 / 侧栏搜索域。
  // ---- 项目 ----
  {
    id: 'project.add',
    title: '添加项目',
    category: '项目',
    run: (ctx) => {
      openStoreTab(ctx.store, 'overview', '工作台');
      ctx.store.requestAddProject();
    },
  },
  {
    id: 'project.open',
    title: '打开项目…',
    category: '项目',
    args: { name: 'projectIds', label: '选择要打开的项目（打开第一个）', type: 'projects' },
    run: async (ctx, values) => {
      const first = projectCommand(ctx, values)[0];
      if (first === undefined) return;
      await ctx.actions.openProject(first.id);
    },
  },
  {
    id: 'project.analyze',
    title: '重新分析项目…',
    category: '项目',
    args: { name: 'projectIds', label: '选择要重新分析的项目（可多选）', type: 'projects' },
    run: async (ctx, values) => {
      const ids = values.projectIds ?? [];
      if (ids.length === 0) return;
      await ctx.actions.analyze(ids);
      ctx.message.success(`已开始分析 ${ids.length} 个项目`);
    },
  },
  {
    id: 'project.rebuild-index',
    title: '重建项目索引（内容搜索）…',
    category: '项目',
    args: { name: 'projectIds', label: '选择要重建内容索引的项目（可多选）', type: 'projects' },
    run: async (ctx, values) => {
      const ids = values.projectIds ?? [];
      if (ids.length === 0) return;
      await ctx.actions.rebuildIndex(ids);
      ctx.message.success(`已开始重建 ${ids.length} 个项目的内容索引`);
    },
  },
  {
    id: 'project.explorer',
    title: '在资源管理器中打开当前项目',
    category: '项目',
    needsProject: true,
    run: async (ctx) => {
      if (ctx.activeProjectId === null) return;
      await ctx.actions.openExternal(ctx.activeProjectId, 'explorer');
    },
  },
  {
    id: 'project.terminal',
    title: '在终端中打开当前项目',
    category: '项目',
    needsProject: true,
    run: async (ctx) => {
      if (ctx.activeProjectId === null) return;
      await ctx.actions.openExternal(ctx.activeProjectId, 'terminal');
    },
  },
  // ---- 外观 ----
  {
    id: 'appearance.cycle-theme',
    title: '切换主题（循环）',
    category: '外观',
    run: (ctx) => {
      const idx = THEMES.indexOf(ctx.settings.theme as (typeof THEMES)[number]);
      const next = THEMES[(idx + 1) % THEMES.length] ?? 'light';
      ctx.setSetting('theme', next);
      ctx.message.info(`主题：${next}`);
    },
  },
  {
    id: 'appearance.cycle-scheme',
    title: '切换代码配色（循环）',
    category: '外观',
    run: (ctx) => {
      const idx = SCHEMES.indexOf(ctx.settings.syntaxScheme as (typeof SCHEMES)[number]);
      const next = SCHEMES[(idx + 1) % SCHEMES.length] ?? 'classic';
      ctx.setSetting('syntaxScheme', next);
      ctx.message.info(`代码配色：${next}`);
    },
  },
  // ---- 文件 / 标签 ----
  {
    id: 'editor.save',
    title: '保存当前文件',
    category: '文件',
    keys: 'Ctrl+S',
    keyEditable: true,
    run: () => {
      // 保存状态在编辑器内部：广播事件，由 EditorPane 接管（未在编辑态则忽略）
      window.dispatchEvent(new CustomEvent('ttfolio:save'));
    },
  },
  {
    id: 'tab.close',
    title: '关闭当前标签',
    category: '视图',
    keys: 'Ctrl+W',
    keyEditable: true,
    run: (ctx) => ctx.actions.closeActive(),
  },
  {
    id: 'tab.next',
    title: '切换到下一个标签',
    category: '视图',
    keys: 'Ctrl+Tab',
    keyEditable: true,
    run: (ctx) => ctx.actions.cycleTab(1),
  },
  {
    id: 'tab.prev',
    title: '切换到上一个标签',
    category: '视图',
    keys: 'Ctrl+Shift+Tab',
    keyEditable: true,
    run: (ctx) => ctx.actions.cycleTab(-1),
  },
  {
    id: 'nav.back',
    title: '后退',
    category: '视图',
    keys: 'Alt+ArrowLeft',
    keyEditable: true,
    run: (ctx) => ctx.store.navigate(-1),
  },
  {
    id: 'nav.forward',
    title: '前进',
    category: '视图',
    keys: 'Alt+ArrowRight',
    keyEditable: true,
    run: (ctx) => ctx.store.navigate(1),
  },
  {
    id: 'panel.detail',
    title: '切换右栏详情',
    category: '视图',
    keys: 'Ctrl+B',
    keyEditable: true,
    run: (ctx) => {
      if (ctx.activeProjectId === null) {
        ctx.message.info('右栏详情在打开项目后可用');
        return;
      }
      ctx.store.setDetail(!ctx.store.detailVisible);
    },
  },
];

/** 插件命令贡献点（T-101 接入时向此数组 push；面板自动可见）。 */
export const pluginCommandContributions: CommandDef[] = [];

/** 启用的命令模板 → 命令项（FR-10.3 入表；在活动项目上下文中执行）。 */
export function templateCommands(templates: CommandTemplate[], hasProject: boolean): CommandDef[] {
  return templates
    .filter((t) => t.enabled)
    .map((t) => ({
      id: `template.${t.id}`,
      title: `用模板打开：${t.label}`,
      category: '模板' as const,
      needsProject: true,
      run: async (ctx: CommandContext) => {
        if (!hasProject || ctx.activeProjectId === null) {
          ctx.message.info('模板命令需要先打开一个项目');
          return;
        }
        await ctx.actions.runTemplate(ctx.activeProjectId, t.id);
      },
    }));
}

/** 全部命令（内置 + 插件贡献 + 模板 + 自定义视图，FR-4.11）。 */
export function allCommands(
  templates: CommandTemplate[],
  hasProject: boolean,
  customViews: CustomView[] = [],
): CommandDef[] {
  return [
    ...BUILTIN_COMMANDS,
    ...pluginCommandContributions,
    ...templateCommands(templates, hasProject),
    ...customViewCommands(customViews),
  ];
}

/** 自定义「我的视图」→ 打开命令（FR-4.11 / KNOWN-GAPS #5）：每视图一条。 */
export function customViewCommands(views: CustomView[]): CommandDef[] {
  return views.map((v) => ({
    id: `view.custom.${v.id}`,
    title: `打开视图：${v.name}`,
    category: '视图' as const,
    run: (ctx: CommandContext) => {
      openStoreTab(ctx.store, 'overview', v.name, `view:custom:${v.id}`);
    },
  }));
}

// ---------------- 模糊匹配 ----------------

/**
 * 子序列模糊匹配打分：不匹配返回 -1。
 * 分值：连续命中 +3/字符，词首（含非字母数字前）命中 +2，其余 +1；标题越短分越高（-0.05*长度）。
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (q === '') return 0;
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastHit = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    const prev = ti > 0 ? (t[ti - 1] ?? '') : '';
    const isWordStart = ti === 0 || /[^\p{L}\p{N}]/u.test(prev);
    score += isWordStart ? 2 : ti === lastHit + 1 ? 3 : 1;
    lastHit = ti;
    qi += 1;
  }
  if (qi < q.length) return -1;
  return score - t.length * 0.05;
}

/** 过滤并排序（保持稳定顺序：同分按原顺序）。 */
export function filterCommands(commands: CommandDef[], query: string): CommandDef[] {
  if (query.trim() === '') return commands;
  return commands
    .map((c) => ({ c, s: fuzzyScore(query, `${c.title} ${c.category}`) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

// ---------------- MRU（最近使用，localStorage 沿 ttfolio-theme 惯例） ----------------

export const MRU_KEY = 'ttfolio-cmd-mru';
export const MRU_MAX = 8;

export function readMru(): string[] {
  try {
    const raw = localStorage.getItem(MRU_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function pushMru(id: string, prev: string[] = readMru()): string[] {
  const next = [id, ...prev.filter((x) => x !== id)].slice(0, MRU_MAX);
  try {
    localStorage.setItem(MRU_KEY, JSON.stringify(next));
  } catch {
    /* 存储不可用不影响命令执行 */
  }
  return next;
}

/** MRU 置顶排序（未使用过的保持原序）。 */
export function sortByMru(commands: CommandDef[], mru: string[]): CommandDef[] {
  if (mru.length === 0) return commands;
  const rank = new Map(mru.map((id, i) => [id, i]));
  return [...commands].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra === undefined && rb === undefined) return 0;
    if (ra === undefined) return 1;
    if (rb === undefined) return -1;
    return ra - rb;
  });
}

// ---------------- 快捷键（chord 解析与匹配，FR-11.4） ----------------

export interface Chord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

/** 解析 'Ctrl+Shift+P' → {ctrl,shift,alt,key:'p'}；特殊键保留（'Tab'/'ArrowLeft'/','）。 */
export function parseChord(chord: string): Chord | null {
  const parts = chord.split('+').map((p) => p.trim());
  if (parts.length === 0) return null;
  const keyRaw = parts[parts.length - 1] ?? '';
  if (keyRaw === '') return null;
  const mods = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));
  const key = keyRaw.length === 1 ? keyRaw.toLowerCase() : keyRaw;
  return { ctrl: mods.has('ctrl') || mods.has('cmd'), shift: mods.has('shift'), alt: mods.has('alt'), key };
}

/** 事件 → 是否命中 chord。特殊键（Tab/方向键）区分 shift；字母键统一小写比较。 */
export function chordMatches(
  chord: Chord,
  e: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  },
): boolean {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return (
    chord.ctrl === (e.ctrlKey || e.metaKey) &&
    chord.shift === e.shiftKey &&
    chord.alt === e.altKey &&
    chord.key === key
  );
}

/** 键盘事件 → chord 字符串（改绑捕获用）。无修饰键返回 null（不让普通按键劫持输入）。 */
export function chordFromEvent(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): string | null {
  const modOnly = ['Control', 'Meta', 'Shift', 'Alt', 'CapsLock'];
  if (modOnly.includes(e.key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.shiftKey) mods.push('Shift');
  if (e.altKey) mods.push('Alt');
  if (mods.length === 0) return null;
  let key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (key === 'Escape') key = 'Esc';
  return [...mods, key].join('+');
}

/** 生效快捷键：设置覆盖（keybindings_json）优先，否则用默认。 */
export function effectiveChord(cmd: CommandDef, keybindings: Record<string, string>): string | null {
  const custom = keybindings[cmd.id];
  if (typeof custom === 'string' && custom.trim() !== '') return custom;
  return cmd.keys ?? null;
}

/** 「?」帮助文案（由注册表生成，不再手工维护）。 */
export function helpText(keybindings: Record<string, string>): string {
  const items = [...BUILTIN_COMMANDS, ...pluginCommandContributions]
    .map((c) => ({ c, chord: effectiveChord(c, keybindings) }))
    .filter((x): x is { c: CommandDef; chord: string } => x.chord !== null && x.chord !== '')
    .map((x) => `${x.chord} ${x.c.title}`);
  return `快捷键：${items.join(' · ')} · ? 本帮助`;
}
