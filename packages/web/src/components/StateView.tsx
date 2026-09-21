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
  children: React.ReactNode;
}

export function StateView({ loading, error, empty, emptyText, emptyAction, children }: Props): React.JSX.Element {
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
        <Button onClick={() => window.location.reload()}>重试</Button>
      </Empty>
    );
  }
  if (empty === true) {
    return (
      <Empty description={emptyText ?? '暂无数据'} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 32 }}>
        {emptyAction !== undefined && <Button type="primary" onClick={emptyAction.onClick}>{emptyAction.label}</Button>}
      </Empty>
    );
  }
  return <>{children}</>;
}
