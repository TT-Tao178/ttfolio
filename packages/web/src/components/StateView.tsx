/** 三态包装（C-53）：加载 Skeleton / 空 Empty+动作 / 错误 原因+重试。 */
import { Button, Empty, Skeleton } from 'antd';
import React from 'react';

interface Props {
  loading: boolean;
  error?: unknown;
  empty?: boolean;
  emptyText?: string;
  emptyAction?: { label: string; onClick: () => void };
  skeleton?: 'skeleton' | 'spin';
  /** 重试回调：优先于默认的整页刷新（整页刷新会丢失标签/滚动等现场） */
  onRetry?: () => void;
  /** 错误态附加操作（如「关闭此标签」「回到工作台」） */
  errorExtra?: React.ReactNode;
  children: React.ReactNode;
}

export function StateView({
  loading,
  error,
  empty,
  emptyText,
  emptyAction,
  onRetry,
  errorExtra,
  children,
}: Props): React.JSX.Element {
  if (loading) {
    return (
      <div style={{ padding: 16 }}>
        <Skeleton active paragraph={{ rows: 4 }} />
      </div>
    );
  }
  if (error !== undefined && error !== null) {
    return (
      <Empty
        description={`加载失败：${error instanceof Error ? error.message : String(error)}`}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      >
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <Button onClick={onRetry ?? (() => window.location.reload())}>重试</Button>
          {errorExtra}
        </div>
      </Empty>
    );
  }
  if (empty === true) {
    return (
      <Empty
        description={emptyText ?? '暂无数据'}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        style={{ padding: 32 }}
      >
        {emptyAction !== undefined && (
          <Button type="primary" onClick={emptyAction.onClick}>
            {emptyAction.label}
          </Button>
        )}
      </Empty>
    );
  }
  return <>{children}</>;
}
