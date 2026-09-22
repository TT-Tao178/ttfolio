/** AntD Design Token 主题（C-50/C-51）：唯一的色值定义处，默认浅色。 */
import { theme as antdTheme, type ThemeConfig } from 'antd';

export type ThemeMode = 'light' | 'dark' | 'system';

export const GITHUB_LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Python: '#3572A5',
  Java: '#b07219',
  Kotlin: '#A97BFF',
  Go: '#00ADD8',
  Rust: '#dea584',
  'C#': '#178600',
  C: '#555555',
  'C++': '#f34b7d',
  PHP: '#4F5D95',
  Ruby: '#701516',
  Swift: '#F05138',
  Dart: '#00B4AB',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Markdown: '#083fa1',
  JSON: '#292929',
  YAML: '#cb171e',
  SQL: '#e38c00',
  Shell: '#89e051',
  PowerShell: '#012456',
  Other: '#8b949e'
};

/**
 * CSS 变量本体（hex 只活在本文件，见 C-50 / 机械检查 M10）。
 * 为什么要走变量：SEMANTIC 被 15 个文件直接 import 成常量，若改成 hook/多套常量，
 * 每个引用点都要改（连带面大、易漏）；改为 var(--tt-*) 后，组件代码一行都不用动，
 * 只由 SettingsProvider 在根元素上切换 `html[data-tt-dark]` 即可整体换肤。
 */
const VARS_LIGHT: Record<string, string> = {
  'tt-primary': '#1677ff',
  'tt-primary-bg': '#e6f4ff',
  'tt-primary-border': '#91caff',
  'tt-success': '#52c41a',
  'tt-warning': '#faad14',
  'tt-error': '#ff4d4f',
  'tt-layout-bg': '#f5f5f5',
  'tt-container-bg': '#ffffff',
  'tt-split': '#f0f0f0',
  'tt-border': '#d9d9d9',
  'tt-text': 'rgba(0,0,0,.88)',
  'tt-text-2': 'rgba(0,0,0,.65)',
  'tt-text-3': 'rgba(0,0,0,.45)'
};

const VARS_DARK: Record<string, string> = {
  'tt-primary': '#1668dc',
  'tt-primary-bg': '#111a2c',
  'tt-primary-border': '#15325b',
  'tt-success': '#49aa19',
  'tt-warning': '#d89614',
  'tt-error': '#dc4446',
  'tt-layout-bg': '#141414',
  'tt-container-bg': '#1f1f1f',
  'tt-split': '#303030',
  'tt-border': '#424242',
  'tt-text': 'rgba(255,255,255,.85)',
  'tt-text-2': 'rgba(255,255,255,.65)',
  'tt-text-3': 'rgba(255,255,255,.45)'
};

export const THEME_STYLE_ID = 'tt-theme-vars';

/** 生成变量表样式文本（浅色进 :root，深色进 html[data-tt-dark="1"]）。 */
export function themeVarsCss(): string {
  const light = Object.entries(VARS_LIGHT).map(([k, v]) => `--${k}:${v};`).join('');
  const dark = Object.entries(VARS_DARK).map(([k, v]) => `--${k}:${v};`).join('');
  return `:root{${light}}html[data-tt-dark="1"]{${dark}}`;
}

/** 把变量表写入文档（幂等；只创建一次 <style>，之后仅切换 html 上的 data-tt-dark）。 */
export function applyThemeVars(dark: boolean): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(THEME_STYLE_ID);
  if (el === null) {
    el = document.createElement('style');
    el.id = THEME_STYLE_ID;
    el.textContent = themeVarsCss();
    document.head.appendChild(el);
  }
  document.documentElement.dataset['ttDark'] = dark ? '1' : '0';
  // 让浏览器原生控件（滚动条、表单、默认底色）也跟随深浅，避免"深色页面配白滚动条"
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.documentElement.style.background = dark ? VARS_DARK['tt-layout-bg'] ?? '' : VARS_LIGHT['tt-layout-bg'] ?? '';
  document.body.style.background = dark ? VARS_DARK['tt-layout-bg'] ?? '' : VARS_LIGHT['tt-layout-bg'] ?? '';
}

/** 语义色常量（组件内唯一允许的取色来源，值与深浅无关，实际色值随 html[data-tt-dark] 切换）。 */
export const SEMANTIC = {
  primary: 'var(--tt-primary)',
  primaryBg: 'var(--tt-primary-bg)',
  primaryBorder: 'var(--tt-primary-border)',
  success: 'var(--tt-success)',
  warning: 'var(--tt-warning)',
  error: 'var(--tt-error)',
  layoutBg: 'var(--tt-layout-bg)',
  /** 容器底色（卡片/侧栏/弹层） */
  containerBg: 'var(--tt-container-bg)',
  /** 分割线与卡片描边（对应 AntD token.colorSplit / colorBorderSecondary） */
  split: 'var(--tt-split)',
  /** 控件描边（对应 token.colorBorder） */
  border: 'var(--tt-border)',
  text: 'var(--tt-text)',
  textSecondary: 'var(--tt-text-2)',
  textTertiary: 'var(--tt-text-3)'
} as const;

export function langColor(language: string): string {
  return GITHUB_LANG_COLORS[language] ?? GITHUB_LANG_COLORS['Other'] ?? '#8b949e';
}

export function antdThemeConfig(resolvedDark: boolean): ThemeConfig {
  const algorithm = resolvedDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm;
  // 这里必须给真实 hex（AntD 要用它推导 hover/active 等派生色，传 var() 会算不出派生色）；
  // 取值与上面的变量表同源，保证「AntD 组件底色」与「自绘容器底色」是同两个色。
  const v = resolvedDark ? VARS_DARK : VARS_LIGHT;
  return {
    algorithm,
    token: {
      colorPrimary: v['tt-primary'],
      colorInfo: v['tt-primary'],
      colorSuccess: v['tt-success'],
      colorWarning: v['tt-warning'],
      colorError: v['tt-error'],
      colorBgLayout: v['tt-layout-bg'],
      colorBgContainer: v['tt-container-bg'],
      colorBorder: v['tt-border'],
      colorBorderSecondary: v['tt-split'],
      colorText: v['tt-text'],
      colorTextSecondary: v['tt-text-2'],
      colorTextTertiary: v['tt-text-3'],
      borderRadius: 6,
      fontSize: 14,
      lineHeight: 1.5715
    },
    components: {
      Card: { borderRadiusLG: 8 },
      Modal: { borderRadiusLG: 8 },
      Menu: { itemBorderRadius: 8, itemBg: 'transparent' },
      Tag: { borderRadiusSM: 4 },
      Segmented: { borderRadiusSM: 4 },
      Layout: { bodyBg: v['tt-layout-bg'] }
    }
  };
}

export function componentSizeOf(density: string): 'small' | 'middle' | 'large' {
  return density === 'small' ? 'small' : density === 'large' ? 'large' : 'middle';
}
