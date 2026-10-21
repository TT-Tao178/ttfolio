/** 库体检（FR-13.11 / T-108）：版本/表行数/完整性检测/VACUUM/索引管理/备份保留。 */
import { App, Alert, Button, InputNumber, Space, Spin, Table, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { fmtBytes } from '@/lib/format';
import { useSettings } from '@/app/settings';

interface HealthOverview {
  dbPath: string;
  dbSize: number;
  userVersion: number;
  migrations: Array<{ file: string; label: string }>;
  tables: Record<string, number>;
}

interface FtsRow {
  projectId: string;
  name: string;
  stateCount: number;
  ftsRows: number;
}

const TABLE_LABELS: Record<string, string> = {
  projects: '登记项目',
  trash: '回收站条目',
  collections: '集合',
  tags: '标签',
  todos: '清单条目',
  editorDrafts: '编辑草稿',
  recentFiles: '最近查看',
  media: '媒体索引',
  activity: '审计记录',
  taskRuns: '任务历史',
};

export function HealthCard(): React.JSX.Element {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const { settings, setSetting } = useSettings();
  const [integrity, setIntegrity] = useState<{ integrity: string; fkViolations: unknown[] } | null>(null);
  const { data: overview } = useQuery({
    queryKey: ['health-overview'],
    queryFn: () => api.get<HealthOverview>('/api/health/overview'),
  });
  const { data: fts, isLoading: ftsLoading } = useQuery({
    queryKey: ['health-fts'],
    queryFn: () => api.get<FtsRow[]>('/api/health/fts'),
  });

  const checkIntegrity = useMutation({
    mutationFn: () => api.post<{ integrity: string; fkViolations: unknown[] }>('/api/health/integrity', {}),
    onSuccess: (r) => {
      setIntegrity(r);
      if (r.integrity === 'ok' && r.fkViolations.length === 0) void message.success('完整性检测通过');
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '检测失败'),
  });
  const maintenance = useMutation({
    mutationFn: (op: 'vacuum' | 'analyze') =>
      api.post<{ sizeBytesBefore: number; sizeBytesAfter: number }>('/api/health/maintenance', { op }),
    onSuccess: (r, op) => {
      const delta = r.sizeBytesAfter - r.sizeBytesBefore;
      void message.success(
        `${op === 'vacuum' ? 'VACUUM' : 'ANALYZE'} 完成（库体积 ${
          delta === 0 ? '不变' : `${delta > 0 ? '+' : ''}${fmtBytes(Math.abs(delta))}`
        }）`,
      );
      void queryClient.invalidateQueries({ queryKey: ['health-overview'] });
      void queryClient.invalidateQueries({ queryKey: ['health'] });
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '维护操作失败'),
  });
  const rebuild = useMutation({
    mutationFn: (projectId: string) => api.post<{ taskId: string }>('/api/health/fts/rebuild', { projectId }),
    onSuccess: () => {
      void message.success('已开始重建（状态栏可看进度）');
      void queryClient.invalidateQueries({ queryKey: ['health-fts'] });
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '重建失败'),
  });
  const clearIndex = useMutation({
    mutationFn: (projectId: string) => api.del(`/api/search/index/${projectId}`),
    onSuccess: () => {
      void message.success('已清除该项目索引');
      void queryClient.invalidateQueries({ queryKey: ['health-fts'] });
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '清除失败'),
  });
  const confirmVacuum = (): void => {
    modal.confirm({
      title: '执行 VACUUM？',
      content: '整理库文件、回收空闲页，期间界面可能短暂卡顿（数据不受影响）。',
      okText: '执行',
      onOk: () => maintenance.mutate('vacuum'),
    });
  };

  return (
    <div data-testid="health-card">
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        索引库
      </Typography.Title>
      {overview === undefined ? (
        <Spin />
      ) : (
        <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 12 }}>
          <span style={{ fontSize: 12 }} className="tt-mono">
            {overview.dbPath} · {fmtBytes(overview.dbSize)}
          </span>
          <span style={{ fontSize: 12 }}>
            迁移版本 user_version = {overview.userVersion}：
            {overview.migrations
              .filter((m) => Number(m.file) <= overview.userVersion)
              .map((m) => (
                <Tag key={m.file} style={{ fontSize: 10 }}>
                  {m.file} {m.label}
                </Tag>
              ))}
          </span>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
            {Object.entries(overview.tables).map(([k, v]) => (
              <span key={k}>
                {TABLE_LABELS[k] ?? k} <strong>{v}</strong>
              </span>
            ))}
          </div>
          <Space wrap style={{ marginTop: 4 }}>
            <Button
              size="small"
              loading={checkIntegrity.isPending}
              onClick={() => checkIntegrity.mutate()}
              data-testid="health-integrity-btn"
            >
              完整性检测
            </Button>
            <Button size="small" loading={maintenance.isPending} onClick={confirmVacuum}>
              VACUUM
            </Button>
            <Button size="small" onClick={() => maintenance.mutate('analyze')}>
              ANALYZE
            </Button>
          </Space>
          {integrity !== null &&
            (integrity.integrity === 'ok' && integrity.fkViolations.length === 0 ? (
              <Alert type="success" message="integrity_check 通过，无外键悬挂引用" showIcon />
            ) : (
              <Alert
                type="error"
                showIcon
                message="检测发现问题"
                description={
                  <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                    {integrity.integrity}
                    {JSON.stringify(integrity.fkViolations, null, 2)}
                  </pre>
                }
              />
            ))}
        </Space>
      )}

      <Typography.Title level={5}>内容索引（FTS）</Typography.Title>
      <Table
        size="small"
        rowKey="projectId"
        dataSource={fts ?? []}
        loading={ftsLoading}
        pagination={false}
        style={{ marginBottom: 12 }}
        columns={[
          { title: '项目', dataIndex: 'name', ellipsis: true },
          { title: '索引条目', dataIndex: 'stateCount', width: 90 },
          { title: 'FTS 行', dataIndex: 'ftsRows', width: 90 },
          {
            title: '操作',
            key: 'ops',
            width: 150,
            render: (_, r) =>
              r.stateCount === 0 && r.ftsRows === 0 ? (
                <span style={{ fontSize: 12, opacity: 0.5 }}>未建索引</span>
              ) : (
                <Space size={4}>
                  <Button size="small" onClick={() => rebuild.mutate(r.projectId)}>
                    重建
                  </Button>
                  <Button
                    size="small"
                    danger
                    onClick={() => {
                      modal.confirm({
                        title: `清除「${r.name}」的内容索引？`,
                        content: '只删索引数据，文件与项目登记不受影响；搜索内容前需重建。',
                        okText: '清除',
                        okButtonProps: { danger: true },
                        onOk: () => clearIndex.mutate(r.projectId),
                      });
                    }}
                  >
                    清除
                  </Button>
                </Space>
              ),
          },
        ]}
      />

      <Typography.Title level={5}>备份保留</Typography.Title>
      <Space align="center">
        <span style={{ fontSize: 12 }}>快照保留</span>
        <InputNumber
          min={0}
          max={3650}
          value={settings.backupKeepDays}
          onChange={(v) => {
            if (typeof v === 'number' && Number.isFinite(v)) {
              setSetting('backupKeepDays', Math.round(v));
            }
          }}
          addonAfter="天"
          style={{ width: 140 }}
          data-testid="backup-keep-days"
        />
        <span style={{ fontSize: 12, opacity: 0.6 }}>0 = 智能保留（最近 10 份 + 每周 1 份）</span>
      </Space>
    </div>
  );
}
