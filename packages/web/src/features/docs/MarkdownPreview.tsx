/** Markdown 渲染（FR-6.4）：react-markdown + GFM + sanitize，相对图片经 /raw 代理。 */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { rawUrl } from '@/lib/api';

export default function MarkdownPreview({ content, projectId, mountId, basePath }: {
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
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
