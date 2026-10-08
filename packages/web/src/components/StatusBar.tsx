/** 状态栏（FR-1.6）：本地模式 / 索引库 / 项目数 / 最近分析 / 文件监听 + 长任务进度（可取消）+ 实时连接。
 *  尺寸与条目对齐《界面原型-AntD.html》的 #statusbar：高 28px、字号 12、左右 padding 16。 */
import { Button, Progress, Space, Tooltip } from 'antd';
import { ApiOutlined, ApiFilled, CloseCircleOutlined } from '@ant-design/icons';
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { HealthInfo, TaskInfo } from '@ttfolio/shared';
import { fmtBytes, relTime } from '@/lib/format';
import { useSettings } from '@/app/settings';
import { SEMANTIC } from '@/theme/tokens';

export function StatusBar({ sseState }: { sseState: 'connecting' | 'open' | 'closed' }): React.JSX.Element {
  const { settings } = useSettings();
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthInfo>('/api/health'),
    refetchInterval: 30000,
  });
  const { data: tasks } = useQuery({
    queryKey: ['tasks'],
    queryFn: () =>
      api.get<{ running: TaskInfo[]; stats: { files: number; bytes: number } | null }>(
        '/api/search/index/status',
      ),
    refetchInterval: 5000,
  });

  const running: TaskInfo[] = tasks?.running ?? [];
  const lastAnalyze = health?.lastAnalyzeAt ?? null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        height: 28,
        padding: '0 16px',
        fontSize: 12,
        borderTop: `1px solid ${SEMANTIC.split}`,
        opacity: 0.85,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <i
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: SEMANTIC.success,
            display: 'inline-block',
          }}
        />
        本地模式 · 仅 127.0.0.1
      </span>
      <span className="tt-ellipsis" style={{ maxWidth: 320 }} data-testid="status-db">
        索引库 {health?.dbPath ?? '…'}（{fmtBytes(health?.dbSize ?? 0)}）
      </span>
      <span>项目 {health?.projectCount ?? '—'}</span>
      <span data-testid="status-last-analyze">
        最近分析 {lastAnalyze === null ? '—' : relTime(lastAnalyze)}
      </span>
      <span data-testid="status-watch" style={{ opacity: 0.75 }}>
        文件监听 {settings.watchEnabled ? '开' : '关'}
      </span>
      {running.length > 0 && (
        <Space size={4}>
          <span data-testid="status-task" className="tt-ellipsis" style={{ maxWidth: 200 }}>
            {running[0]?.title}
          </span>
          <Progress
            percent={Math.round(((running[0]?.done ?? 0) / Math.max(running[0]?.total ?? 1, 1)) * 100)}
            size="small"
            style={{ width: 120 }}
          />
          <Button
            size="small"
            type="text"
            danger
            icon={<CloseCircleOutlined />}
            onClick={() => {
              const id = running[0]?.taskId;
              if (id !== undefined) void api.post('/api/search/index/cancel', { taskId: id });
            }}
          />
        </Space>
      )}
      <span style={{ marginLeft: 'auto' }}>
        {sseState === 'open' ? (
          <Tooltip title="实时更新已连接">
            <ApiFilled style={{ color: SEMANTIC.success }} />
          </Tooltip>
        ) : sseState === 'connecting' ? (
          <Tooltip title="连接中…">
            <ApiOutlined />
          </Tooltip>
        ) : (
          <Tooltip title="实时更新已断开（自动重连中）">
            <ApiOutlined style={{ color: SEMANTIC.warning }} />
          </Tooltip>
        )}
      </span>
      <span>{relTime(new Date().toISOString()).replace(/^刚刚$/, '就绪')}</span>
    </div>
  );
}
