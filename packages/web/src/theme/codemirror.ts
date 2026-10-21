/** CodeMirror 6 主题（配色取 AntD token 值，C-50 豁免目录）。
 * 语法配色三方案（FR-13.4 / T-098）：classic / warm / neon，独立于应用主题；
 * 编辑器（EditorPane）、文档 Markdown 代码块、Agent 动态视图三处共用。 */
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { DEFAULT_SYNTAX_SCHEME, type SyntaxScheme } from '@ttfolio/shared';

export function cmTheme(dark: boolean) {
  return EditorView.theme(
    {
      '&': {
        color: dark ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.88)',
        backgroundColor: dark ? '#141414' : '#ffffff',
        fontSize: '13px',
      },
      '.cm-content': { fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace" },
      '.cm-gutters': {
        backgroundColor: dark ? '#1d1d1d' : '#fafafa',
        color: dark ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.25)',
        border: 'none',
      },
      '.cm-activeLine': { backgroundColor: dark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.02)' },
      '.cm-activeLineGutter': { backgroundColor: dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.04)' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: dark ? '#1668dc33' : '#1677ff22',
      },
    },
    { dark },
  );
}

/** 七类 token 着色（keyword/string/number/comment/function/type/variable/tag）+ 标题/链接。 */
interface SchemeColors {
  keyword: string;
  string: string;
  number: string;
  comment: string;
  fn: string;
  type: string;
  variable: string;
  tag: string;
}

/** classic：One Dark 系（深色沿用 0.3.8 前的观感；浅色为同族明度适配）。 */
const CLASSIC_DARK: SchemeColors = {
  keyword: '#ff7de9',
  string: '#aff05b',
  number: '#ffb86b',
  comment: 'rgba(255,255,255,.65)',
  fn: '#69b4ff',
  type: '#7ee0ff',
  variable: '#ff9da4',
  tag: '#ff9da4',
};
const CLASSIC_LIGHT: SchemeColors = {
  keyword: '#7c4dbe',
  string: '#0e7c61',
  number: '#b2680c',
  comment: 'rgba(0,0,0,.45)',
  fn: '#0b6bcb',
  type: '#0e6a9c',
  variable: '#c4475e',
  tag: '#c4475e',
};

/** warm：低饱和暖调（赭石关键字/墨绿字符串/砖红数字/暖灰注释），浅色主题最佳拍档。 */
const WARM_DARK: SchemeColors = {
  keyword: '#d99a55',
  string: '#9db874',
  number: '#d98a70',
  comment: 'rgba(255,240,220,.55)',
  fn: '#d4b978',
  type: '#c9ad78',
  variable: '#c9989f',
  tag: '#c9989f',
};
const WARM_LIGHT: SchemeColors = {
  keyword: '#a4682d',
  string: '#5f7a49',
  number: '#b05f43',
  comment: 'rgba(90,80,66,.65)',
  fn: '#8a6d1f',
  type: '#96743a',
  variable: '#a3565c',
  tag: '#a3565c',
};

/** neon：高对比霓虹（电红关键字/霓虹青字符串/品红数字），配 OLED/赛博朋克；浅色自动降饱和。 */
const NEON_DARK: SchemeColors = {
  keyword: '#ff3355',
  string: '#00e5ff',
  number: '#ff2fb3',
  comment: 'rgba(180,190,205,.6)',
  fn: '#00ffa3',
  type: '#ffe600',
  variable: '#ff7ab8',
  tag: '#ff7ab8',
};
const NEON_LIGHT: SchemeColors = {
  keyword: '#cc4d64',
  string: '#1f8fa3',
  number: '#b34a92',
  comment: 'rgba(70,76,88,.65)',
  fn: '#4f5db0',
  type: '#8f862c',
  variable: '#b05a86',
  tag: '#b05a86',
};

const SCHEMES: Record<SyntaxScheme, { dark: SchemeColors; light: SchemeColors }> = {
  classic: { dark: CLASSIC_DARK, light: CLASSIC_LIGHT },
  warm: { dark: WARM_DARK, light: WARM_LIGHT },
  neon: { dark: NEON_DARK, light: NEON_LIGHT },
};

export function cmHighlight(dark: boolean, scheme: string = DEFAULT_SYNTAX_SCHEME) {
  const colors = (SCHEMES[scheme as SyntaxScheme] ?? SCHEMES.classic)[dark ? 'dark' : 'light'];
  return syntaxHighlighting(
    HighlightStyle.define([
      {
        tag: [tags.keyword, tags.moduleKeyword, tags.controlKeyword, tags.operatorKeyword],
        color: colors.keyword,
      },
      { tag: [tags.string, tags.special(tags.string)], color: colors.string },
      { tag: [tags.number, tags.bool, tags.null], color: colors.number },
      {
        tag: [tags.comment, tags.lineComment, tags.blockComment],
        color: colors.comment,
        fontStyle: 'italic',
      },
      {
        tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
        color: colors.fn,
      },
      { tag: [tags.typeName, tags.className], color: colors.type },
      { tag: [tags.variableName, tags.propertyName], color: colors.variable },
      { tag: [tags.tagName], color: colors.tag },
      { tag: tags.heading, fontWeight: 'bold' },
      { tag: tags.link, textDecoration: 'underline' },
    ]),
  );
}
