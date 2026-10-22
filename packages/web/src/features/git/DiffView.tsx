/**
 * unified diff 视图（FR-5.2）：行级 +/- 高亮。
 * 第 63 轮（KNOWN-GAPS #6）：react-virtual 虚拟渲染——行 whiteSpace:'pre'（横向滚动、
 * 行高恒定 18px）使超长 diff 不再整体铺 DOM；分块加载由父组件以 useInfiniteQuery
 * 驱动，经 totalLines/loadedLines/hasMore/onLoadMore 传入，滚动近底自动续页 +
 * 底部手动按钮双保险。只传 patch（如提交详情）时渲染整段、无续页，行为兼容。
 */
import { Alert, Button, Spin } from 'antd';
import React, { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { SEMANTIC } from '@/theme/tokens';

const ROW_HEIGHT = 18; // 12px 字号 × 1.5 行距
const OVERSCAN = 30;
/** 距底部不足此行数时自动取下一页 */
const AUTO_LOAD_AHEAD = 40;

export function DiffView({
  patch,
  truncated,
  totalLines,
  loadedLines,
  hasMore,
  onLoadMore,
  loadingMore,
}: {
  patch: string;
  /** 兼容字段：服务端超长单行字符兜底截断时提示（分页场景下与 hasMore 无关） */
  truncated?: boolean;
  /** 完整 patch 总行数（分页时由服务端返回） */
  totalLines?: number;
  /** 已加载行数（分页时由父组件累计） */
  loadedLines?: number;
  /** 是否还有后续页 */
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}): React.JSX.Element {
  const lines = useMemo(() => patch.split('\n'), [patch]);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.length > 0 ? (items[items.length - 1]?.index ?? -1) : -1;

  useEffect(() => {
    if (hasMore !== true || loadingMore === true || onLoadMore === undefined) return;
    if (lastIndex >= 0 && lastIndex >= lines.length - 1 - AUTO_LOAD_AHEAD) onLoadMore();
  }, [hasMore, loadingMore, onLoadMore, lastIndex, lines.length]);

  return (
    <div>
      {loadedLines !== undefined && totalLines !== undefined && (
        <Alert
          type={hasMore ? 'warning' : 'info'}
          message={
            hasMore
              ? `大 diff 分块加载中：已载 ${Math.min(loadedLines, totalLines)} / 共 ${totalLines} 行（滚动到底自动续页）`
              : `已加载全部 ${totalLines} 行`
          }
          style={{ marginBottom: 6 }}
        />
      )}
      {truncated && (
        <Alert type="warning" message="diff 过大，超长部分已按字符截断" style={{ marginBottom: 6 }} />
      )}
      <div
        ref={parentRef}
        data-testid="diff-scroll"
        className="tt-mono"
        style={{
          fontSize: 12,
          lineHeight: '18px',
          overflow: 'auto',
          height: 'min(70vh, 720px)',
          borderRadius: 6,
          background: SEMANTIC.layoutBg,
        }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map((vRow) => {
            const line = lines[vRow.index] ?? '';
            const cls =
              line.startsWith('+') && !line.startsWith('+++')
                ? 'tt-diff-add'
                : line.startsWith('-') && !line.startsWith('---')
                  ? 'tt-diff-del'
                  : line.startsWith('@@')
                    ? 'tt-diff-hunk'
                    : '';
            return (
              <div
                key={vRow.key}
                className={cls}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  transform: `translateY(${vRow.start}px)`,
                  height: ROW_HEIGHT,
                  width: 'max-content',
                  minWidth: '100%',
                  whiteSpace: 'pre',
                  padding: '0 8px',
                }}
              >
                {line === '' ? ' ' : line}
              </div>
            );
          })}
        </div>
        {hasMore && (
          <div style={{ padding: '6px 8px 10px' }}>
            {loadingMore ? (
              <Spin size="small" />
            ) : (
              <Button
                size="small"
                onClick={onLoadMore}
                data-testid="diff-load-more"
                disabled={onLoadMore === undefined}
              >
                加载更多
                {totalLines !== undefined && loadedLines !== undefined
                  ? `（剩 ${Math.max(totalLines - loadedLines, 0)} 行）`
                  : ''}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
