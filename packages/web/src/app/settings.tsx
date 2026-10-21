/**
 * 设置上下文（FR-11.3，默认浅色 + 标准密度）。
 *
 * 修复要点（用户报障 1/3/4）：
 * 1) setSetting 原先只发 PATCH、从不更新 react-query 缓存 → 所有受控控件（主题/密度/开关）
 *    读到的 settings 永远是旧值：改完立刻弹回、主题不变，表现为"设置里功能不能用"。
 *    现在改为「乐观写缓存 → 立即生效 → PATCH → 成功后按需失效相关查询 / 失败回滚并提示」。
 * 2) 主题模式原先让 localStorage **永久压过**服务端值（缓存没变化时 effect 不重跑）→ 改主题无效。
 *    现在服务端值为准，localStorage 只在服务端值到达前用于首帧（TT-THEME-CACHE，C-29 例外）。
 * 3) 底色原先全透明（html/body/#root/.ant-app 都是 rgba(0,0,0,0)）→ 深色模式下"面板深、底白"。
 *    现在由 applyThemeVars 在根元素写入 CSS 变量，并把令牌底色给到 .ant-app 与 body。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  antdThemeConfig,
  applyThemeVars,
  componentSizeOf,
  SEMANTIC,
  type ResolvedTheme,
  type ThemeMode,
} from '@/theme/tokens';
import { api, ApiClientError } from '@/lib/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export interface SettingsShape {
  theme: ThemeMode;
  density: 'small' | 'middle' | 'large';
  watchEnabled: boolean;
  watchStabilityMs: number;
  autoSave: boolean;
  trashRetentionDays: number;
  /** 备份快照保留天数（FR-13.11 / T-108）；0 = 智能保留 */
  backupKeepDays: number;
  defaultArchDirName: string;
  cardSort: string;
  showIgnored: boolean;
  defaultProjectTab: string;
  docRootBlacklist: string[];
  keybindings: Record<string, string>;
  /** 代码语法配色（FR-13.4）：classic | warm | neon */
  syntaxScheme: string;
  scanRootDirs: unknown[];
  /** 可拖拽面板尺寸（见 hooks/usePaneSize.ts） */
  uiLayout: {
    sidebarWidth?: number;
    detailWidth?: number;
    treeWidth?: number;
    gitListWidth?: number;
    docsListWidth?: number;
  };
}

export const DEFAULT_SETTINGS: SettingsShape = {
  theme: 'light',
  density: 'middle',
  watchEnabled: true,
  watchStabilityMs: 300,
  autoSave: false,
  trashRetentionDays: 30,
  backupKeepDays: 0,
  defaultArchDirName: '架构图',
  cardSort: 'last_opened',
  showIgnored: false,
  defaultProjectTab: 'files',
  docRootBlacklist: [],
  keybindings: {},
  syntaxScheme: 'classic',
  scanRootDirs: [],
  uiLayout: {},
};

/**
 * 前端字段名（camelCase，与 SettingsShape 一致）→ 服务端 settings 表键名（snake_case）。
 * 调用方一律用 camelCase：与它们读的 settings.xxx 同名，避免"读 defaultProjectTab、写 default_project_tab"
 * 这种两边不对称的写法再犯。
 */
const SERVER_KEY: Record<string, string> = {
  theme: 'theme',
  density: 'density',
  watchEnabled: 'watch_enabled',
  watchStabilityMs: 'watch_stability_ms',
  autoSave: 'auto_save',
  trashRetentionDays: 'trash_retention_days',
  backupKeepDays: 'backup_keep_days',
  defaultArchDirName: 'default_arch_dir_name',
  cardSort: 'card_sort',
  showIgnored: 'show_ignored',
  defaultProjectTab: 'default_project_tab',
  docRootBlacklist: 'doc_root_blacklist_json',
  keybindings: 'keybindings_json',
  syntaxScheme: 'syntax_scheme',
  scanRootDirs: 'scan_root_dirs_json',
  uiLayout: 'ui_layout_json',
};

export type SettingKey = keyof SettingsShape;

type SetSetting = (key: SettingKey, value: unknown) => void;

interface SettingsCtx {
  settings: SettingsShape;
  dark: boolean;
  /** 解析后的实际主题（system 已按系统深浅落成 light/dark；oled 独立态） */
  resolved: ResolvedTheme;
  setSetting: SetSetting;
}

const Ctx = createContext<SettingsCtx>({
  settings: DEFAULT_SETTINGS,
  dark: false,
  resolved: 'light',
  setSetting: () => {},
});

export const useSettings = (): SettingsCtx => useContext(Ctx);

/**
 * toast 持有者：SettingsProvider 渲染在 AntdApp 之外，拿不到 message 上下文，
 * 而 setSetting 需要"保存失败"的提示。这里由 AntdApp 内部的 ToastBridge 注入（AntD 静态
 * message 也是同样的做法，只是它拿不到动态主题）。模块级单例：本应用只有一个 Provider。
 */
const toast: { error: (msg: string) => void } = { error: () => {} };

function ToastBridge({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { message } = AntdApp.useApp();
  toast.error = (msg: string) => void message.error(msg);
  return <>{children}</>;
}

/** 仅用于首帧的主题缓存（TT-THEME-CACHE）。 */
function cachedTheme(): ThemeMode | null {
  try {
    const c = localStorage.getItem('ttfolio-theme');
    return c === 'dark' ||
      c === 'light' ||
      c === 'oled' ||
      c === 'cyberpunk' ||
      c === 'sketch' ||
      c === 'system'
      ? c
      : null;
  } catch {
    return null;
  }
}

function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function SettingsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<Partial<SettingsShape>>('/api/settings'),
    // 必须用 placeholderData 而不是 initialData：initialData 会把 dataUpdatedAt 记为「现在」，
    // 叠加全局 staleTime=15000 后 react-query 认为数据是新鲜的 → 根本不发 GET /api/settings
    // （实测：启动后只有 /api/health，服务端设置永远读不到，界面一直跑默认值）。
    placeholderData: DEFAULT_SETTINGS,
  });
  const settings: SettingsShape = useMemo(() => ({ ...DEFAULT_SETTINGS, ...data }), [data]);

  const serverTheme = (data as Partial<SettingsShape> | undefined)?.theme;
  const [mode, setMode] = useState<ThemeMode>(() => cachedTheme() ?? DEFAULT_SETTINGS.theme);
  useEffect(() => {
    if (serverTheme !== undefined) setMode(serverTheme);
  }, [serverTheme]);
  useEffect(() => {
    try {
      localStorage.setItem('ttfolio-theme', mode);
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }, [mode]);

  // Electron 桌面版：主题变化上报主进程切 nativeTheme，让原生窗口标题栏跟随深浅
  // （第 34 轮）。oled 属深色系按 dark 上报；桥由 preload 注入，浏览器/Web 模式没有
  // 它，可选调用即 no-op。
  useEffect(() => {
    const native = (window as unknown as { ttfolioNative?: { setTheme: (m: string) => void } }).ttfolioNative;
    // 深色系主题（oled/cyberpunk）让标题栏走深色，sketch 走浅色，其余原样上报
    native?.setTheme(mode === 'oled' || mode === 'cyberpunk' ? 'dark' : mode === 'sketch' ? 'light' : mode);
  }, [mode]);

  // 三态解析：system 由系统深浅解析为 light/dark；oled 独立成态（有自己的变量表与发光规则）。
  // dark 布尔保留在上下文里（= resolved !== 'light'）供既有消费方兼容。
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    mode === 'system' ? (systemDark() ? 'dark' : 'light') : mode,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const compute = (): void => setResolved(mode === 'system' ? (mq.matches ? 'dark' : 'light') : mode);
    compute();
    mq.addEventListener('change', compute);
    return () => mq.removeEventListener('change', compute);
  }, [mode]);

  // useLayoutEffect：早于绘制写入变量，避免先亮后暗闪一下
  useLayoutEffect(() => {
    applyThemeVars(resolved);
  }, [resolved]);

  /** 无 toast 的核心实现（toast 需要 AntdApp 上下文，见 SettingsBridge）。 */
  const coreSetSetting = useCallback<SetSetting>(
    (key, value) => {
      if (key === 'theme') setMode(value as ThemeMode);
      const prev = queryClient.getQueryData<Partial<SettingsShape>>(['settings']);
      queryClient.setQueryData<Partial<SettingsShape>>(['settings'], (old) => ({
        ...(old ?? {}),
        [key]: value,
      }));
      const serverKey = SERVER_KEY[key];
      if (serverKey === undefined) return;
      void api
        .patch('/api/settings', { [serverKey]: value })
        .then(() => {
          // 界面已乐观生效，这里只做"落地确认 + 依赖项刷新"
          if (key === 'showIgnored') void queryClient.invalidateQueries({ queryKey: ['tree'] });
          if (key === 'cardSort') void queryClient.invalidateQueries({ queryKey: ['projects'] });
          // 尺寸由 usePaneSize 自己按"最新 uiLayout"合并写入，回读会与其竞态，故不回读
          if (key !== 'uiLayout') void queryClient.invalidateQueries({ queryKey: ['settings'] });
        })
        .catch((e: unknown) => {
          queryClient.setQueryData<Partial<SettingsShape>>(['settings'], prev);
          if (key === 'theme' && prev?.theme !== undefined) setMode(prev.theme);
          toast.error(e instanceof ApiClientError ? `设置未保存：${e.message}` : '设置未保存（服务端拒绝）');
        });
    },
    [queryClient],
  );

  const value = useMemo<SettingsCtx>(
    () => ({ settings, dark: resolved !== 'light', resolved, setSetting: coreSetSetting }),
    [settings, resolved, coreSetSetting],
  );

  return (
    <ConfigProvider
      locale={zhCN}
      button={{ autoInsertSpace: false }}
      componentSize={componentSizeOf(settings.density)}
      theme={antdThemeConfig(resolved)}
    >
      {/* height:100% 是必需的：AntD App 会额外渲染一层 div.ant-app，若不给高度，
          其高度退化为内容高度，导致应用壳的 height:100% 无法撑满视口（整体只剩内容高度、
          底部留大片空白、面板高度随内容跳动）。
          background/color 走令牌：原先透明，深色模式下会露出浏览器白底。 */}
      <AntdApp style={{ height: '100%', background: SEMANTIC.layoutBg, color: SEMANTIC.text, fontSize: 14 }}>
        <ToastBridge>
          <Ctx.Provider value={value}>{children}</Ctx.Provider>
        </ToastBridge>
      </AntdApp>
    </ConfigProvider>
  );
}
