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

/** 语义色常量（组件内唯一允许的取色来源；hex 本体只活在本文件，见约束 C-50 / 机械检查 M10）。 */
export const SEMANTIC = {
  primary: '#1677ff',
  primaryBg: '#e6f4ff',
  primaryBorder: '#91caff',
  success: '#52c41a',
  warning: '#faad14',
  error: '#ff4d4f',
  layoutBg: '#f5f5f5',
  /** 容器底色（卡片/侧栏/弹层） */
  containerBg: '#ffffff',
  /** 分割线与卡片描边（对应 AntD token.colorSplit / colorBorderSecondary） */
  split: '#f0f0f0',
  /** 控件描边（对应 token.colorBorder） */
  border: '#d9d9d9',
  textSecondary: 'rgba(0,0,0,.65)',
  textTertiary: 'rgba(0,0,0,.45)'
} as const;

export function langColor(language: string): string {
  return GITHUB_LANG_COLORS[language] ?? GITHUB_LANG_COLORS['Other'] ?? '#8b949e';
}

export function antdThemeConfig(resolvedDark: boolean): ThemeConfig {
  const algorithm = resolvedDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm;
  return {
    algorithm,
    token: {
      colorPrimary: '#1677ff',
      colorInfo: '#1677ff',
      colorSuccess: '#52c41a',
      colorWarning: '#faad14',
      colorError: '#ff4d4f',
      borderRadius: 6,
      fontSize: 14,
      lineHeight: 1.5715
    },
    components: {
      Card: { borderRadiusLG: 8 },
      Modal: { borderRadiusLG: 8 },
      Menu: { itemBorderRadius: 8 },
      Tag: { borderRadiusSM: 4 },
      Segmented: { borderRadiusSM: 4 }
    }
  };
}

export function componentSizeOf(density: string): 'small' | 'middle' | 'large' {
  return density === 'small' ? 'small' : density === 'large' ? 'large' : 'middle';
}
