/** CodeMirror 6 主题（配色取 AntD token 值，C-50 豁免目录）。 */
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export function cmTheme(dark: boolean) {
  return EditorView.theme(
    {
      '&': {
        color: dark ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.88)',
        backgroundColor: dark ? '#141414' : '#ffffff',
        fontSize: '13px'
      },
      '.cm-content': { fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace" },
      '.cm-gutters': {
        backgroundColor: dark ? '#1d1d1d' : '#fafafa',
        color: dark ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.25)',
        border: 'none'
      },
      '.cm-activeLine': { backgroundColor: dark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.02)' },
      '.cm-activeLineGutter': { backgroundColor: dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.04)' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: dark ? '#1668dc33' : '#1677ff22'
      }
    },
    { dark }
  );
}

export function cmHighlight(dark: boolean) {
  const color = dark ? 'rgba(255,255,255,.65)' : 'rgba(0,0,0,.45)';
  return syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.keyword, color: dark ? '#ff7de9' : '#7c4dbe' },
      { tag: [tags.string], color: dark ? '#aff05b' : '#0e7c61' },
      { tag: [tags.number, tags.bool, tags.null], color: dark ? '#ffb86b' : '#b2680c' },
      { tag: [tags.comment, tags.lineComment, tags.blockComment], color, fontStyle: 'italic' },
      { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: dark ? '#69b4ff' : '#0b6bcb' },
      { tag: [tags.typeName, tags.className], color: dark ? '#7ee0ff' : '#0e6a9c' },
      { tag: tags.heading, fontWeight: 'bold' },
      { tag: tags.link, textDecoration: 'underline' }
    ])
  );
}
