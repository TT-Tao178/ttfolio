/** unified diff 视图（FR-5.2）：行级 +/- 高亮、大 diff 截断提示、前 500 行渲染。 */
import { Alert } from 'antd';
import React from 'react';
import { SEMANTIC } from '@/theme/tokens';

export function DiffView({ patch, truncated }: { patch: string; truncated: boolean }): React.JSX.Element {
  const lines = patch.split('\n').slice(0, 500);
  return (
    <div>
      {truncated && (
        <Alert type="warning" message="diff 过大，已截断显示前 500 行" style={{ marginBottom: 6 }} />
      )}
      <pre
        className="tt-mono"
        style={{
          fontSize: 12,
          lineHeight: 1.5,
          overflow: 'auto',
          borderRadius: 6,
          padding: 8,
          background: SEMANTIC.layoutBg,
          margin: 0,
        }}
      >
        {lines.map((line, i) => {
          const cls =
            line.startsWith('+') && !line.startsWith('+++')
              ? 'tt-diff-add'
              : line.startsWith('-') && !line.startsWith('---')
                ? 'tt-diff-del'
                : line.startsWith('@@')
                  ? 'tt-diff-hunk'
                  : '';
          return (
            <div key={i} className={cls} style={{ whiteSpace: 'pre-wrap' }}>
              {line === '' ? ' ' : line}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
