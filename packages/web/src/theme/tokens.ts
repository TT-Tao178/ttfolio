/** AntD Design Token 主题（C-50/C-51）：唯一的色值定义处，默认浅色。 */
import { theme as antdTheme, type ThemeConfig } from 'antd';

/** 用户可选主题（settings.theme 持久值）；system 跟随操作系统在浅/深间解析。 */
export type ThemeMode = 'light' | 'dark' | 'oled' | 'cyberpunk' | 'sketch' | 'glass' | 'system';

/** 解析后的实际主题：oled/cyberpunk 按深色系渲染（独立变量表+特效），sketch 为纸感浅色，
 *  glass 为流光玻璃浅色（渐变底+半透明卡片+backdrop blur）。 */
export type ResolvedTheme = 'light' | 'dark' | 'oled' | 'cyberpunk' | 'sketch' | 'glass';

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
/**
 * 默认浅色主题（v2，用户反馈"配色不好看"后按同类产品重设计，主色蓝保留）：
 * 灰阶骨架取 GitHub Primer 浅色主题（canvas-inset #f6f8fa / border-default #d0d7de /
 * fg 三级 #1f2328·#57606a·#8b949e），语义三色取 Primer success/attention/error
 * （#1a7f37 / #9a6700 / #cf222e，比 AntD 原色压暗一档，浅底小面积更稳）。
 * 与旧版的关键差异：全部灰阶带冷蓝色温（纯中性灰显脏）、发丝线与重边框分层
 * （卡片是浮在底上的，不是被框住的）、选中底/边与新灰阶同色温（不再断裂）。
 */
const VARS_LIGHT: Record<string, string> = {
  'tt-primary': '#1677ff',
  'tt-primary-bg': '#e9f1ff',
  'tt-primary-border': '#a5c8ff',
  'tt-success': '#1a7f37',
  'tt-warning': '#9a6700',
  'tt-error': '#cf222e',
  'tt-layout-bg': '#f6f8fa',
  'tt-container-bg': '#ffffff',
  'tt-split': '#e7ecf0',
  'tt-border': '#d0d7de',
  'tt-text': '#1f2328',
  'tt-text-2': '#57606a',
  'tt-text-3': '#8b949e',
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

/**
 * 赛博朋克主题（第 36 轮，用户点名）：夜城蓝黑底 + 霓虹青主色 + 品红警示，
 * 控件带青色霓虹光晕。与电红主题（纯黑+红光）刻意区分色系与明度层次。
 */
const VARS_CYBERPUNK: Record<string, string> = {
  'tt-primary': '#00f0ff',
  'tt-primary-bg': '#0d2126',
  'tt-primary-border': '#155e6b',
  'tt-success': '#00d26a',
  'tt-warning': '#ffe14d',
  'tt-error': '#ff2a6d',
  'tt-layout-bg': '#0a0a12',
  'tt-container-bg': '#12121e',
  'tt-split': '#23233a',
  'tt-border': '#34345a',
  'tt-text': 'rgba(235,242,255,.9)',
  'tt-text-2': 'rgba(215,226,255,.62)',
  'tt-text-3': 'rgba(195,208,240,.42)',
};

/**
 * 极简手绘主题（第 36 轮，用户点名）：米纸白底 + 炭铅笔主色 + 灰调功能色，
 * 形状层叠手绘不等圆角与纸面硬阴影（见 themeVarsCss 的 sketch 规则段），
 * 整体是"铅笔在纸上"的浅色观感。
 */
const VARS_SKETCH: Record<string, string> = {
  'tt-primary': '#44403a',
  'tt-primary-bg': '#f0ebe0',
  'tt-primary-border': '#d0c7b4',
  'tt-success': '#5a7d4a',
  'tt-warning': '#b08d3f',
  'tt-error': '#b0563f',
  'tt-layout-bg': '#faf7f2',
  'tt-container-bg': '#fffdf9',
  'tt-split': '#e8e2d6',
  'tt-border': '#c9c0ae',
  'tt-text': 'rgba(45,42,37,.92)',
  'tt-text-2': 'rgba(45,42,37,.62)',
  'tt-text-3': 'rgba(45,42,37,.42)',
};

/**
 * 流光玻璃主题（用户点名，参考图：柔和紫粉蓝渐变底 + 半透明白玻璃卡）：
 * v2（用户反馈"背景太淡、玻璃后面没东西可透、卡片是白底方框"）重做环境光——
 * 渐变底叠加三个高饱和径向光斑（紫/粉/青，"环境光"），玻璃卡透明度降档 + blur 加强，
 * 让光斑真实透过玻璃；厚圆角 + 顶部内高光 + 细描边给面板质感。
 * 深浅归属：浅色系（colorScheme=light、标题栏 light）。
 */
const VARS_GLASS: Record<string, string> = {
  'tt-primary': '#7c5cff',
  'tt-primary-bg': 'rgba(124,92,255,.14)',
  'tt-primary-border': 'rgba(124,92,255,.35)',
  'tt-success': '#18a058',
  'tt-warning': '#d4880f',
  'tt-error': '#e5484d',
  // layout-bg 是渐变的兜底纯色（供 antd colorBgLayout 与 JS 兜底；渐变本体在 CSS 规则）
  'tt-layout-bg': '#e9edfb',
  // 半透明白玻璃卡：作用于所有 SEMANTIC.containerBg 引用点（侧栏/顶栏/详情/终端等自绘容器）。
  // v2 降档到 .42——更透，环境光斑能透过玻璃
  'tt-container-bg': 'rgba(255,255,255,.42)',
  'tt-split': 'rgba(255,255,255,.6)',
  'tt-border': 'rgba(255,255,255,.85)',
  'tt-text': 'rgba(28,27,34,.92)',
  'tt-text-2': 'rgba(28,27,34,.64)',
  'tt-text-3': 'rgba(28,27,34,.44)',
};

/**
 * 流光玻璃的整页"环境光"底：多层径向光斑叠加线性渐变（fixed 不随滚动）。
 * v2：光斑饱和度拉高（此前太淡，玻璃后面没有东西可透）。
 */
export const GLASS_BG_GRADIENT =
  'radial-gradient(1200px 800px at 12% 8%, rgba(124,92,255,.5), transparent 55%),' +
  'radial-gradient(1000px 700px at 88% 14%, rgba(255,140,205,.45), transparent 55%),' +
  'radial-gradient(1100px 900px at 75% 85%, rgba(94,214,255,.42), transparent 55%),' +
  'radial-gradient(900px 700px at 20% 90%, rgba(255,196,140,.3), transparent 55%),' +
  'linear-gradient(160deg,#dfe6ff 0%,#f2e3ff 35%,#ffe6f2 60%,#e2f2ff 100%) fixed';

export const THEME_STYLE_ID = 'tt-theme-vars';

/** 电光红发光的统一光晕（OLED 黑底上红色 box-shadow 即"发光"观感）。 */
const OLED_GLOW = 'rgba(255,59,71,.4)';
/** 赛博朋克的霓虹青光晕。 */
const CYBER_GLOW = 'rgba(0,240,255,.38)';

/** 手绘不等圆角：四角半径刻意不对称，模拟铅笔手绘框的抖动感（经典 CSS 技巧）。 */
const SKETCH_RADIUS_BTN = '255px 15px 225px 15px / 15px 225px 15px 255px';
const SKETCH_RADIUS_CARD = '15px 255px 15px 225px / 225px 15px 255px 15px';

/** 生成变量表样式文本：浅色进 :root，深色进 html[data-tt-dark="1"]；
 *  oled/cyberpunk 在深色基础上覆写（必伴随 data-tt-dark="1"）并附霓虹发光规则；
 *  sketch 为浅色覆写（data-tt-dark="0"）并附手绘线条形状规则。 */
export function themeVarsCss(): string {
  const toCss = (vars: Record<string, string>): string =>
    Object.entries(vars)
      .map(([k, v]) => `--${k}:${v};`)
      .join('');
  const light = toCss(VARS_LIGHT);
  const dark = toCss(VARS_DARK);
  const oled = toCss(VARS_OLED);
  const cyber = toCss(VARS_CYBERPUNK);
  const sketch = toCss(VARS_SKETCH);
  const glass = toCss(VARS_GLASS);
  const neon = [
    `html[data-tt-oled="1"] .ant-btn-primary{box-shadow:0 0 10px ${OLED_GLOW}}`,
    `html[data-tt-oled="1"] .ant-btn-primary:not(:disabled):hover{box-shadow:0 0 14px rgba(255,59,71,.6)}`,
    `html[data-tt-oled="1"] .ant-switch-checked{box-shadow:0 0 8px ${OLED_GLOW}}`,
    `html[data-tt-oled="1"] .ant-checkbox-checked .ant-checkbox-inner,html[data-tt-oled="1"] .ant-radio-checked .ant-radio-inner{border-color:#ff3b47;box-shadow:0 0 6px ${OLED_GLOW}}`,
    `html[data-tt-cyber="1"] .ant-btn-primary{box-shadow:0 0 10px ${CYBER_GLOW}}`,
    `html[data-tt-cyber="1"] .ant-btn-primary:not(:disabled):hover{box-shadow:0 0 14px rgba(0,240,255,.6)}`,
    `html[data-tt-cyber="1"] .ant-switch-checked{box-shadow:0 0 8px ${CYBER_GLOW}}`,
    `html[data-tt-cyber="1"] .ant-checkbox-checked .ant-checkbox-inner,html[data-tt-cyber="1"] .ant-radio-checked .ant-radio-inner{border-color:#00f0ff;box-shadow:0 0 6px ${CYBER_GLOW}}`,
    `html[data-tt-cyber="1"] .ant-menu-item-selected{box-shadow:inset 2px 0 0 #ff2a6d}`,
  ].join('');
  const handDrawn = [
    `html[data-tt-sketch="1"] .ant-btn{border-radius:${SKETCH_RADIUS_BTN};border-width:1.5px}`,
    `html[data-tt-sketch="1"] .ant-btn-primary{border-color:#3a362f}`,
    `html[data-tt-sketch="1"] .ant-card{border-radius:${SKETCH_RADIUS_CARD};border:1.5px solid #c9c0ae;box-shadow:2px 3px 0 rgba(61,58,52,.12)}`,
    `html[data-tt-sketch="1"] .ant-modal .ant-modal-content{border-radius:${SKETCH_RADIUS_CARD};border:1.5px solid #c9c0ae;box-shadow:3px 4px 0 rgba(61,58,52,.14)}`,
    `html[data-tt-sketch="1"] .ant-tag{border-radius:${SKETCH_RADIUS_BTN};border-width:1px}`,
  ].join('');
  // 流光玻璃（glass v2，用户反馈"背景太淡、玻璃后面没东西可透、卡片是白底方框"）：
  // 环境光透过玻璃 + 厚圆角 + 顶部内高光 + 细描边的面板质感。
  // blur 只挂 .tt-glass-surface（壳层容器）与 antd 少数大表面，不全量铺开（GPU 成本可控）。
  const glassRules = [
    // 壳层玻璃表面（App 顶栏/域条/路径条/状态栏挂 tt-glass-surface）：
    // 更透（.42）+ blur 24 + saturate 160 + 顶部内高光——"环境光透过玻璃"的核心
    `html[data-tt-glass="1"] .tt-glass-surface{background:var(--tt-container-bg);backdrop-filter:blur(24px) saturate(160%);-webkit-backdrop-filter:blur(24px) saturate(160%);box-shadow:inset 0 1px 0 rgba(255,255,255,.65)}`,
    // antd 大表面玻璃化（厚圆角 16 + 内高光 + 柔和大投影）
    `html[data-tt-glass="1"] .ant-card:not(.ant-card-ghost){background:rgba(255,255,255,.5);backdrop-filter:blur(24px) saturate(160%);-webkit-backdrop-filter:blur(24px) saturate(160%);border:1px solid rgba(255,255,255,.7);box-shadow:inset 0 1px 0 rgba(255,255,255,.7),0 10px 36px rgba(93,76,180,.14);border-radius:16px}`,
    `html[data-tt-glass="1"] .ant-modal .ant-modal-content{background:rgba(255,255,255,.86);backdrop-filter:blur(28px) saturate(160%);-webkit-backdrop-filter:blur(28px) saturate(160%);border:1px solid rgba(255,255,255,.8);box-shadow:inset 0 1px 0 rgba(255,255,255,.8),0 24px 72px rgba(93,76,180,.26);border-radius:18px}`,
    `html[data-tt-glass="1"] .ant-table{background:rgba(255,255,255,.4)}`,
    `html[data-tt-glass="1"] .ant-table-wrapper .ant-table-container table .ant-table-thead>tr>th{background:rgba(255,255,255,.5)}`,
    // 浮层：下拉/消息/气泡玻璃化（短暂表面，blur 开销可接受）
    `html[data-tt-glass="1"] .ant-select-dropdown,html[data-tt-glass="1"] .ant-dropdown-menu{background:rgba(255,255,255,.85);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.75);border-radius:12px;box-shadow:0 12px 44px rgba(93,76,180,.2)}`,
    `html[data-tt-glass="1"] .ant-message-notice-content,html[data-tt-glass="1"] .ant-notification-notice{background:rgba(255,255,255,.84);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.8);border-radius:12px;box-shadow:0 12px 44px rgba(93,76,180,.2)}`,
    // 代码/编辑器表面保持实底（可读性优先，玻璃只给壳）
    `html[data-tt-glass="1"] .cm-editor{background:#ffffff}`,
  ].join('');
  // 选中与悬停强化（全主题生效——用户反馈默认主题选中不清晰、左侧上半部无选中效果）：
  // 菜单选中项统一「主色底 + 左侧 2px 指示条」，悬停统一中性底；html 前缀特异性压过 antd 默认。
  const selectionRules = [
    `html .ant-menu-item.ant-menu-item-selected{background:var(--tt-primary-bg);box-shadow:inset 2px 0 0 var(--tt-primary)}`,
    `html .ant-menu-light .ant-menu-item:not(.ant-menu-item-selected):hover,html .ant-menu-light .ant-menu-submenu-title:hover{background:rgba(127,127,127,.1)}`,
    `html .ant-menu-submenu-title.ant-menu-submenu-selected{color:var(--tt-primary)}`,
    // Segmented 选中块加重（默认主题下选中不明显的主要抱怨点之一）
    `html .ant-segmented .ant-segmented-item-selected{box-shadow:0 1px 6px rgba(0,0,0,.14)}`,
    // 表格行 hover 统一反馈
    `html .ant-table-wrapper .ant-table-tbody>tr.ant-table-row:hover>td{background:var(--tt-primary-bg)}`,
  ].join('');
  // 动效（全局唯一开关 html[data-tt-effects]，默认 1；外观卡可关）：
  // 全部走 transition/transform（合成层属性）保证流畅；关闭时零动画零过渡。
  const motionRules = [
    `html[data-tt-effects="1"] .ant-menu-item,html[data-tt-effects="1"] .ant-menu-submenu-title{transition:background-color .18s cubic-bezier(.2,.7,.3,1),color .18s cubic-bezier(.2,.7,.3,1),box-shadow .18s cubic-bezier(.2,.7,.3,1)}`,
    `html[data-tt-effects="1"] .ant-btn,html[data-tt-effects="1"] .ant-segmented-item,html[data-tt-effects="1"] .ant-switch,html[data-tt-effects="1"] .ant-input,html[data-tt-effects="1"] .ant-select-selector{transition:all .18s cubic-bezier(.2,.7,.3,1)}`,
    // 项目卡：hover 上浮 + 阴影加深（data-testid 稳定选择器；受控于动效开关）
    `html[data-tt-effects="1"] [data-testid="project-card"]{transition:transform .2s cubic-bezier(.2,.8,.25,1),box-shadow .2s cubic-bezier(.2,.8,.25,1),border-color .2s cubic-bezier(.2,.8,.25,1)}`,
    `html[data-tt-effects="1"] [data-testid="project-card"]:hover{transform:translateY(-3px);box-shadow:0 12px 32px rgba(0,0,0,.14)}`,
    `html[data-tt-effects="1"] [data-testid="project-card"]:active{transform:translateY(-1px) scale(.995)}`,
    // Modal 内容出入场更顺的缩放曲线（antd 自带动画仍在，这里只调曲线）
    `html[data-tt-effects="1"] .ant-modal{transition:transform .22s cubic-bezier(.2,.8,.25,1),opacity .22s ease}`,
  ].join('');
  return (
    `:root{${light}}html[data-tt-dark="1"]{${dark}}` +
    `html[data-tt-oled="1"]{${oled}}html[data-tt-cyber="1"]{${cyber}}` +
    `html[data-tt-sketch="1"]{${sketch}}html[data-tt-glass="1"]{${glass}}` +
    `${neon}${handDrawn}${glassRules}${selectionRules}${motionRules}`
  );
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
  const darkLike = resolved === 'dark' || resolved === 'oled' || resolved === 'cyberpunk';
  document.documentElement.dataset['ttDark'] = darkLike ? '1' : '0';
  document.documentElement.dataset['ttOled'] = resolved === 'oled' ? '1' : '0';
  document.documentElement.dataset['ttCyber'] = resolved === 'cyberpunk' ? '1' : '0';
  document.documentElement.dataset['ttSketch'] = resolved === 'sketch' ? '1' : '0';
  document.documentElement.dataset['ttGlass'] = resolved === 'glass' ? '1' : '0';
  // 让浏览器原生控件（滚动条、表单、默认底色）也跟随深浅，避免"深色页面配白滚动条"
  document.documentElement.style.colorScheme = darkLike ? 'dark' : 'light';
  const vars =
    resolved === 'light'
      ? VARS_LIGHT
      : resolved === 'oled'
        ? VARS_OLED
        : resolved === 'cyberpunk'
          ? VARS_CYBERPUNK
          : resolved === 'sketch'
            ? VARS_SKETCH
            : resolved === 'glass'
              ? VARS_GLASS
              : VARS_DARK;
  // glass 的整页底是渐变（inline 优先级高于 CSS 规则段，必须在这里写）
  const bg = resolved === 'glass' ? GLASS_BG_GRADIENT : (vars['tt-layout-bg'] ?? '');
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
  // oled/cyberpunk 沿用 darkAlgorithm（组件明暗关系一致），只是换一套真实 hex 让 AntD
  // 推导派生色；sketch 是纸感浅色，glass 是流光玻璃浅色，走 defaultAlgorithm
  const algorithm =
    resolved === 'light' || resolved === 'sketch' || resolved === 'glass'
      ? antdTheme.defaultAlgorithm
      : antdTheme.darkAlgorithm;
  // 这里必须给真实 hex（AntD 要用它推导 hover/active 等派生色，传 var() 会算不出派生色）；
  // 取值与上面的变量表同源，保证「AntD 组件底色」与「自绘容器底色」是同一套色。
  const v =
    resolved === 'light'
      ? VARS_LIGHT
      : resolved === 'oled'
        ? VARS_OLED
        : resolved === 'cyberpunk'
          ? VARS_CYBERPUNK
          : resolved === 'sketch'
            ? VARS_SKETCH
            : resolved === 'glass'
              ? { ...VARS_GLASS, 'tt-container-bg': '#ffffff' }
              : VARS_DARK;
  const base: ThemeConfig = {
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
      // 排版语言（用户给参考图后全局统一）：更小更精的字号 + 宽松行距 + 大圆角——
      // 参考图（文档式 UI）的舒服观感 = 13px 级正文、1.65 行距、8~14px 圆角、留白宽松
      fontSize: 13,
      lineHeight: 1.65,
      borderRadius: 8,
    },
    components: {
      Card: { borderRadiusLG: 12 },
      Modal: { borderRadiusLG: 14 },
      Menu: { itemBorderRadius: 8, itemBg: 'transparent', itemHeight: 36 },
      Tag: { borderRadiusSM: 4 },
      Segmented: { borderRadiusSM: 6 },
      Button: { borderRadius: 8 },
      Layout: { bodyBg: v['tt-layout-bg'] },
    },
  };
  // glass：色板给半透明的 surface 全部走不透明白（AntD 对 rgba 派生不可靠），
  // 玻璃化交给 themeVarsCss 的 glassRules（CSS 直控 Card/Modal/Table 底色与 blur）
  if (resolved === 'glass') {
    base.token = {
      ...base.token,
      colorBgContainer: '#ffffff',
      colorBgLayout: '#e9edfb',
      colorBorder: 'rgba(124,92,255,.22)',
      colorBorderSecondary: 'rgba(255,255,255,.75)',
      borderRadius: 10,
    };
    base.components = {
      ...base.components,
      Card: { borderRadiusLG: 16 },
      Modal: { borderRadiusLG: 18, contentBg: 'rgba(255,255,255,.86)' },
      Table: { colorBgContainer: 'rgba(255,255,255,.4)', headerBg: 'rgba(255,255,255,.5)' },
      Button: { borderRadius: 10 },
    };
  }
  return base;
}

export function componentSizeOf(density: string): 'small' | 'middle' | 'large' {
  return density === 'small' ? 'small' : density === 'large' ? 'large' : 'middle';
}
