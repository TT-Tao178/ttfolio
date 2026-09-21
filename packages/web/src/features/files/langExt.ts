/** 按扩展名选择 CodeMirror 语言包。 */
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { sql } from '@codemirror/lang-sql';
import { java } from '@codemirror/lang-java';
import type { Extension } from '@codemirror/state';

export function langExtension(path: string): Extension {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return javascript({ typescript: true, jsx: ext.endsWith('x') });
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return javascript({ jsx: ext.endsWith('x') });
    case 'vue':
      return [html(), javascript()];
    case 'py':
    case 'pyi':
      return python();
    case 'md':
    case 'mdx':
      return markdown();
    case 'json':
    case 'jsonc':
    case 'json5':
      return json();
    case 'html':
    case 'htm':
    case 'xml':
    case 'svg':
      return html();
    case 'css':
    case 'scss':
    case 'less':
      return css();
    case 'sql':
      return sql();
    case 'java':
      return java();
    default:
      return [];
  }
}
