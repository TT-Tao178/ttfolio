/** 状态栏（FR-1.6）：本地模式 / 索引库 / 项目数 / 最近分析 / 文件监听 + 长任务进度（可取消）+ 实时连接。
 *  尺寸与条目对齐《界面原型-AntD.html》的 #statusbar：高 28px、字号 12、左右 padding 16。 */
import { Button, Modal, Progress, Space, Table, Tag, Tooltip } from 'antd';
import { ApiOutlined, ApiFilled, CloseCircleOutlined, HistoryOutlined } from '@ant-design/icons';
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { HealthInfo, TaskInfo } from '@ttfolio/shared';
import { fmtBytes, relTime } from '@/lib/format';
import { useAppStore } from '@/app/store';
import { useSettings } from '@/app/settings';
import { SEMANTIC } from '@/theme/tokens';

interface TaskRunInfo {
  id: string;
  kind: string;
  title: string;
  status: string;
  error: string | null;
  startedAt: string;
  durationMs: number | null;
}

const RUN_STATUS: Record<string, { label: string; color: string | undefined }> = {
  running: { label: '进行中', color: 'processing' },
  done: { label: '完成', color: 'success' },
  error: { label: '失败', color: 'error' },
  cancelled: { label: '已取消', color: 'default' },
};

/** 任务历史（FR-13.11 / T-108）：跨重启保留 30 天，失败原因可查。 */
function TaskHistoryModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { data: runs } = useQuery({
    queryKey: ['task-history'],
    queryFn: () => api.get<TaskRunInfo[]>('/api/tasks/history', { limit: '100' }),
  });
  return (
    <Modal
      title="任务历史（保留 30 天）"
      open
      onCancel={onClose}
      footer={null}
      width={720}
      data-testid="task-history-modal"
    >
      <Table
        size="small"
        rowKey="id"
        dataSource={runs ?? []}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        columns={[
          { title: '时间', dataIndex: 'startedAt', width: 86, render: (v) => relTime(v) },
          { title: '任务', dataIndex: 'title', ellipsis: true },
          {
            title: '状态',
            dataIndex: 'status',
            width: 76,
            render: (s) => {
              const conf = RUN_STATUS[s] ?? { label: s, color: undefined };
              return <Tag color={conf.color}>{conf.label}</Tag>;
            },
          },
          {
            title: '耗时',
            dataIndex: 'durationMs',
            width: 76,
            render: (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`),
          },
          {
            title: '错误',
            dataIndex: 'error',
            ellipsis: true,
            render: (e: string | null) =>
              e === null ? (
                '—'
              ) : (
                <span title={e} style={{ color: SEMANTIC.error }}>
                  {e}
                </span>
              ),
          },
        ]}
      />
    </Modal>
  );
}

export function StatusBar({ sseState }: { sseState: 'connecting' | 'open' | 'closed' }): React.JSX.Element {
  const { settings } = useSettings();
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthInfo>('/api/health'),
    refetchInterval: 30000,
  });
  const { data: tasks } = useQuery({
    queryKey: ['tasks'],
    // FR-4.7：全 kind 运行中任务（分析/索引/移动复制/清空回收站）
    queryFn: () => api.get<{ running: TaskInfo[] }>('/api/tasks'),
    refetchInterval: 5000,
  });

  const running: TaskInfo[] = tasks?.running ?? [];
  const backfill = useAppStore((s) => s.thumbBackfill);
  const lastAnalyze = health?.lastAnalyzeAt ?? null;

  return (
    <div
      className="tt-glass-surface"
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
      <Tooltip title="任务历史（含失败原因，保留 30 天）">
        <Button
          size="small"
          type="text"
          icon={<HistoryOutlined />}
          onClick={() => setHistoryOpen(true)}
          data-testid="task-history-btn"
        />
      </Tooltip>
      {backfill !== null && (
        <Space size={4} data-testid="status-thumbs">
          <span className="tt-ellipsis" style={{ maxWidth: 180 }}>
            缩略图补建 {backfill.done}/{backfill.total}
          </span>
          <Progress
            percent={Math.round((backfill.done / Math.max(backfill.total, 1)) * 100)}
            size="small"
            style={{ width: 100 }}
          />
          <Button
            size="small"
            type="text"
            danger
            icon={<CloseCircleOutlined />}
            title="取消补建"
            onClick={() => {
              const cur = useAppStore.getState().thumbBackfill;
              if (cur !== null) useAppStore.getState().setThumbBackfill({ ...cur, cancelled: true });
            }}
          />
        </Space>
      )}
      {running.length > 0 && (
        <Space size={4}>
          <span data-testid="status-task" className="tt-ellipsis" style={{ maxWidth: 200 }}>
            {running[0]?.title}
            {running.length > 1 ? `（+${running.length - 1}）` : ''}
          </span>
          <Progress
            percent={Math.round(((running[0]?.done ?? 0) / Math.max(running[0]?.total ?? 1, 1)) * 100)}
            size="small"
            style={{ width: 120 }}
          />
          <Tooltip title="取消该任务">
            <Button
              size="small"
              type="text"
              danger
              icon={<CloseCircleOutlined />}
              onClick={() => {
                const id = running[0]?.taskId;
                if (id !== undefined) void api.post('/api/tasks/cancel', { taskId: id });
              }}
            />
          </Tooltip>
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
      {historyOpen && <TaskHistoryModal onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
