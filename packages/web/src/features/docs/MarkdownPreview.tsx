/** Markdown 渲染（FR-6.4）：react-markdown + GFM + sanitize，相对图片经 /raw 代理。
 * 代码块高亮（FR-13.4）：与编辑器/Agent 动态视图共用 cmTheme/cmHighlight 与语言包。 */
import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { rawUrl } from '@/lib/api';
import { useSettings } from '@/app/settings';
import { useSettingsDark } from '@/features/files/useDark';
import { cmTheme, cmHighlight } from '@/theme/codemirror';
import { langExtension } from '@/features/files/langExt';

/** 常见语言 id → 文件扩展名（langExtension 按扩展名分流）。 */
const LANG_EXT: Record<string, string> = {
  ts: 'ts',
  typescript: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  javascript: 'js',
  py: 'py',
  python: 'py',
  json: 'json',
  html: 'html',
  xml: 'xml',
  svg: 'svg',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  java: 'java',
  md: 'md',
  vue: 'vue',
  sh: 'sh',
  bash: 'sh',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
};

export default function MarkdownPreview({
  content,
  projectId,
  mountId,
  basePath,
}: {
  content: string;
  projectId: string;
  mountId: string | null;
  basePath: string;
}): React.JSX.Element {
  void mountId;
  void basePath;
  return (
    <div className="tt-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          img: ({ src, alt }) => {
            if (typeof src === 'string' && !/^https?:/i.test(src) && !src.startsWith('data:')) {
              const dir = basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/') + 1) : '';
              return <img src={rawUrl(projectId, dir + src)} alt={alt ?? ''} loading="lazy" />;
            }
            return <img src={typeof src === 'string' ? src : ''} alt={alt ?? ''} loading="lazy" />;
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => {
            const child = React.Children.toArray(children)[0];
            if (React.isValidElement(child)) {
              const cls = (child.props as { className?: string }).className;
              if (typeof cls === 'string' && cls.startsWith('language-')) {
                const langId = cls.slice('language-'.length).split(/\s+/)[0] ?? '';
                const code = String((child.props as { children?: unknown }).children ?? '').replace(
                  /\n$/,
                  '',
                );
                return <MdCodeBlock langId={langId} code={code} />;
              }
            }
            return <pre>{children}</pre>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** 文档代码块：只读 CodeMirror 渲染（与编辑器同一套主题/配色/语言包）。 */
function MdCodeBlock({ langId, code }: { langId: string; code: string }): React.JSX.Element {
  const dark = useSettingsDark();
  const { settings } = useSettings();
  const scheme = settings.syntaxScheme;
  const ext = LANG_EXT[langId] ?? '';
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hostRef.current === null) return undefined;
    const view = new EditorView({
      doc: code,
      extensions: [
        ext !== '' ? langExtension(`x.${ext}`) : [],
        cmTheme(dark),
        cmHighlight(dark, scheme),
        EditorView.lineWrapping,
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
      ],
      parent: hostRef.current,
    });
    return () => view.destroy();
  }, [code, dark, scheme, ext]);
  return (
    <div ref={hostRef} className="tt-mono" style={{ fontSize: 12, borderRadius: 6, overflow: 'auto' }} />
  );
}
