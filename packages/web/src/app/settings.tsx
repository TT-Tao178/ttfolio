/** 设置上下文：主题/密度经 ConfigProvider 下发（FR-11.3，默认浅色 + 标准）。 */
import React, { createContext, useContext, useEffect } from 'react';
import { theme as antdTheme, ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { antdThemeConfig, componentSizeOf, type ThemeMode } from '@/theme/tokens';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

export interface SettingsShape {
  theme: ThemeMode;
  density: 'small' | 'middle' | 'large';
  watchEnabled: boolean;
  watchStabilityMs: number;
  autoSave: boolean;
  trashRetentionDays: number;
  defaultArchDirName: string;
  cardSort: string;
  showIgnored: boolean;
  defaultProjectTab: string;
  docRootBlacklist: string[];
  keybindings: Record<string, string>;
  scanRootDirs: unknown[];
}

export const DEFAULT_SETTINGS: SettingsShape = {
  theme: 'light',
  density: 'middle',
  watchEnabled: true,
  watchStabilityMs: 300,
  autoSave: false,
  trashRetentionDays: 30,
  defaultArchDirName: '架构图',
  cardSort: 'last_opened',
  showIgnored: false,
  defaultProjectTab: 'files',
  docRootBlacklist: [],
  keybindings: {},
  scanRootDirs: []
};

interface SettingsCtx {
  settings: SettingsShape;
  dark: boolean;
  setSetting: (key: string, value: unknown) => void;
}

const Ctx = createContext<SettingsCtx>({ settings: DEFAULT_SETTINGS, dark: false, setSetting: () => {} });

export const useSettings = (): SettingsCtx => useContext(Ctx);

export function SettingsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<Partial<SettingsShape>>('/api/settings'),
    initialData: DEFAULT_SETTINGS
  });
  const settings: SettingsShape = { ...DEFAULT_SETTINGS, ...data };
  const [dark, setDark] = React.useState(false);

  // 主题缓存：仅 UI 主题选择（TT-THEME-CACHE，见 index.html 与 DECISIONS.md）
  useEffect(() => {
    let mode: ThemeMode = settings.theme;
    try {
      const cached = localStorage.getItem('ttfolio-theme');
      if (cached === 'dark' || cached === 'light' || cached === 'system') mode = cached;
    } catch {
      /* 隐私模式等场景忽略 */
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const compute = (): boolean => (mode === 'system' ? mq.matches : mode === 'dark');
    setDark(compute());
    const onChange = (): void => {
      if (mode === 'system') setDark(mq.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings.theme]);

  const setSetting = (key: string, value: unknown): void => {
    if (key === 'theme') {
      try {
        localStorage.setItem('ttfolio-theme', String(value));
      } catch {
        /* 忽略 */
      }
    }
    void api.patch('/api/settings', { [key]: value });
  };

  return (
    <Ctx.Provider value={{ settings, dark, setSetting }}>
      <ConfigProvider
        locale={zhCN}
        button={{ autoInsertSpace: false }}
        componentSize={componentSizeOf(settings.density)}
        theme={{
          algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          ...antdThemeConfig(dark)
        }}
      >
        {/* height:100% 是必需的：AntD App 会额外渲染一层 div.ant-app，若不给高度，
            其高度退化为内容高度，导致应用壳的 height:100% 无法撑满视口（整体只剩内容高度、
            底部留大片空白、面板高度随内容跳动） */}
        <AntdApp style={{ height: '100%' }}>{children}</AntdApp>
      </ConfigProvider>
    </Ctx.Provider>
  );
}
