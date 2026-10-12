/** AntD Design Token 主题（C-50/C-51）：唯一的色值定义处，默认浅色。 */
import { theme as antdTheme, type ThemeConfig } from 'antd';

/** 用户可选主题（settings.theme 持久值）；system 跟随操作系统在浅/深间解析。 */
export type ThemeMode = 'light' | 'dark' | 'oled' | 'system';

/** 解析后的实际主题：oled（电红色发光）按深色系渲染，但有独立变量表与发光规则。 */
export type ResolvedTheme = 'light' | 'dark' | 'oled';

export const GITHUB_LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Astro: '#ff5a03',
  Python: '#3572A5',
  Jupyter: '#DA5B0B',
  Java: '#b07219',
  JSP: '#2A6277',
  Kotlin: '#A97BFF',
  Go: '#00ADD8',
  Rust: '#dea584',
  'C#': '#178600',
  C: '#555555',
  'C++': '#f34b7d',
  'Objective-C': '#438eff',
  'Objective-C++': '#6866fb',
  Razor: '#512be4',
  PHP: '#4F5D95',
  Ruby: '#701516',
  Swift: '#F05138',
  Dart: '#00B4AB',
  Scala: '#c22d40',
  Groovy: '#4298b8',
  Gradle: '#02303a',
  Lua: '#000080',
  Perl: '#0298c3',
  R: '#198CE7',
  Erlang: '#B83983',
  Elixir: '#6e4a7e',
  Haskell: '#5e5086',
  OCaml: '#3be133',
  'F#': '#b845fc',
  'Visual Basic .NET': '#945db7',
  Clojure: '#db5855',
  Pascal: '#b0ce4e',
  D: '#ba595e',
  Zig: '#ec915c',
  Nim: '#ffc200',
  Crystal: '#000100',
  Solidity: '#AA6746',
  Julia: '#a270ba',
  Racket: '#3c5caa',
  CoffeeScript: '#244776',
  Assembly: '#6E4C13',
  Tcl: '#e4cc98',
  'Vim Script': '#199f4b',
  'Emacs Lisp': '#c065db',
  Scheme: '#1e4aec',
  Nix: '#7e7eff',
  Bicep: '#519aba',
  Prisma: '#5a67d8',
  HTML: '#e34c26',
  EJS: '#a91e50',
  Handlebars: '#f7931e',
  Pug: '#a86454',
  WXML: '#50b4e8',
  WXSS: '#2f7cf6',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Sass: '#c6538c',
  Less: '#1d365d',
  Stylus: '#ff6347',
  Markdown: '#083fa1',
  MDX: '#fcb32c',
  reStructuredText: '#141414',
  JSON: '#292929',
  YAML: '#cb171e',
  TOML: '#9c4221',
  INI: '#d1dbe0',
  XML: '#0060ac',
  SVG: '#ffb13b',
  SQL: '#e38c00',
  CSV: '#237346',
  Shell: '#89e051',
  PowerShell: '#012456',
  Batch: '#C1F12E',
  Dockerfile: '#384d54',
  CMake: '#DA3434',
  Makefile: '#427819',
  GraphQL: '#e10098',
  'Protocol Buffers': '#6866CB',
  HCL: '#844FBA',
  Diff: '#88DE28',
  Fortran: '#4d41b1',
  COBOL: '#005ca5',
  DotEnv: '#ecd53f',
  Other: '#8b949e',
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
  'tt-text-3': 'rgba(0,0,0,.45)',
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
  'tt-text-3': 'rgba(255,255,255,.45)',
};

/**
 * 电红色发光主题（第 34 轮，用户命名）：OLED 纯黑底 + 电光红主色。
 * 布局底压到 #000000（OLED 面板真黑、省电），容器只留一丝层次；
 * 主色用电光红，深浅适配借用 GitHub Dark 语法色系（黑底可读性已验证）。
 */
const VARS_OLED: Record<string, string> = {
  'tt-primary': '#ff3b47',
  'tt-primary-bg': '#221114',
  'tt-primary-border': '#572028',
  'tt-success': '#3fb950',
  'tt-warning': '#d29922',
  'tt-error': '#f85149',
  'tt-layout-bg': '#000000',
  'tt-container-bg': '#0b0b0d',
  'tt-split': '#1c1c20',
  'tt-border': '#2b2b31',
  'tt-text': 'rgba(255,255,255,.88)',
  'tt-text-2': 'rgba(255,255,255,.62)',
  'tt-text-3': 'rgba(255,255,255,.42)',
};

export const THEME_STYLE_ID = 'tt-theme-vars';

/** 电光红发光的统一光晕（OLED 黑底上红色 box-shadow 即"发光"观感）。 */
const OLED_GLOW = 'rgba(255,59,71,.4)';

/** 生成变量表样式文本：浅色进 :root，深色进 html[data-tt-dark="1"]，
 *  电红色发光在深色基础上覆写（data-tt-oled 必伴随 data-tt-dark="1"）并附发光规则。 */
export function themeVarsCss(): string {
  const toCss = (vars: Record<string, string>): string =>
    Object.entries(vars)
      .map(([k, v]) => `--${k}:${v};`)
      .join('');
  const light = toCss(VARS_LIGHT);
  const dark = toCss(VARS_DARK);
  const oled = toCss(VARS_OLED);
  const glow = [
    `html[data-tt-oled="1"] .ant-btn-primary{box-shadow:0 0 10px ${OLED_GLOW}}`,
    `html[data-tt-oled="1"] .ant-btn-primary:not(:disabled):hover{box-shadow:0 0 14px rgba(255,59,71,.6)}`,
    `html[data-tt-oled="1"] .ant-switch-checked{box-shadow:0 0 8px ${OLED_GLOW}}`,
    `html[data-tt-oled="1"] .ant-checkbox-checked .ant-checkbox-inner,html[data-tt-oled="1"] .ant-radio-checked .ant-radio-inner{border-color:#ff3b47;box-shadow:0 0 6px ${OLED_GLOW}}`,
  ].join('');
  return `:root{${light}}html[data-tt-dark="1"]{${dark}}html[data-tt-oled="1"]{${oled}}${glow}`;
}

/** 把变量表写入文档（幂等；只创建一次 <style>，之后仅切换 html 上的 data-tt-*）。 */
export function applyThemeVars(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(THEME_STYLE_ID);
  if (el === null) {
    el = document.createElement('style');
    el.id = THEME_STYLE_ID;
    el.textContent = themeVarsCss();
    document.head.appendChild(el);
  }
  document.documentElement.dataset['ttDark'] = resolved === 'light' ? '0' : '1';
  document.documentElement.dataset['ttOled'] = resolved === 'oled' ? '1' : '0';
  // 让浏览器原生控件（滚动条、表单、默认底色）也跟随深浅，避免"深色页面配白滚动条"
  document.documentElement.style.colorScheme = resolved === 'light' ? 'light' : 'dark';
  const vars = resolved === 'light' ? VARS_LIGHT : resolved === 'oled' ? VARS_OLED : VARS_DARK;
  const bg = vars['tt-layout-bg'] ?? '';
  document.documentElement.style.background = bg;
  document.body.style.background = bg;
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
  textTertiary: 'var(--tt-text-3)',
} as const;

export function langColor(language: string): string {
  return GITHUB_LANG_COLORS[language] ?? GITHUB_LANG_COLORS['Other'] ?? '#8b949e';
}

export function antdThemeConfig(resolved: ResolvedTheme): ThemeConfig {
  // oled 沿用 darkAlgorithm（组件明暗关系一致），只是换一套真实 hex 让 AntD 推导派生色
  const algorithm = resolved === 'light' ? antdTheme.defaultAlgorithm : antdTheme.darkAlgorithm;
  // 这里必须给真实 hex（AntD 要用它推导 hover/active 等派生色，传 var() 会算不出派生色）；
  // 取值与上面的变量表同源，保证「AntD 组件底色」与「自绘容器底色」是同一套色。
  const v = resolved === 'light' ? VARS_LIGHT : resolved === 'oled' ? VARS_OLED : VARS_DARK;
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
      lineHeight: 1.5715,
    },
    components: {
      Card: { borderRadiusLG: 8 },
      Modal: { borderRadiusLG: 8 },
      Menu: { itemBorderRadius: 8, itemBg: 'transparent' },
      Tag: { borderRadiusSM: 4 },
      Segmented: { borderRadiusSM: 4 },
      Layout: { bodyBg: v['tt-layout-bg'] },
    },
  };
}

export function componentSizeOf(density: string): 'small' | 'middle' | 'large' {
  return density === 'small' ? 'small' : density === 'large' ? 'large' : 'middle';
}
