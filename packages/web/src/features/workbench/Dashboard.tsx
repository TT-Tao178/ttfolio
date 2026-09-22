/**
 * 工作台总览：6 个 KPI + 项目卡片（分页）。
 * 用户反馈原来的「最近打开/需要处理/跨项目清单」三张卡跳转逻辑乱 → 移除，
 * 总览收敛为「KPI 一眼看全局 + 项目卡片直达」。
 */
import { App, Button, Card, Empty, Pagination, Statistic, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import type { ProjectSummary } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';
import { useSettings } from '@/app/settings';
import { ProjectCard } from './ProjectCard';
import { SEMANTIC } from '@/theme/tokens';

/** 总览项目卡片的每页数量：1440 宽下约 3 列，12 个 = 4 屏内可翻完 */
const PAGE_SIZE = 12;


export function Dashboard(): React.JSX.Element {
  const { settings } = useSettings();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects', 'dashboard', settings.cardSort],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects', { status: 'active', sort: settings.cardSort })
  });

  const list = projects ?? [];
  const dirty = list.filter((p) => p.gitIsRepo && p.gitDirty).length;
  const noDocs = list.filter((p) => !p.hasDocs).length;
  const noArch = list.filter((p) => !p.hasArch).length;
  const openedToday = list.filter((p) => p.lastOpenedAt !== null && String(p.lastOpenedAt).slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  const avgMs = (() => {
    const vals = list.map((p) => p.analyzeMs ?? 0).filter((v) => v > 0);
    return vals.length === 0 ? 0 : Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  })();

  // ---- 项目卡片分页（总览新增）：数据已在内存，翻页纯客户端切片，不重复请求 ----
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // 列表变短（移除/归档）后当前页可能越界，回到最后一页
  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const pageItems = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 与卡片墙一致的动作（Workbench 同款实现，保持两处行为相同）：
  const openProject = (p: ProjectSummary): void => {
    const sub = settings.defaultProjectTab === 'overview' ? 'overview' : 'files';
    useAppStore.getState().openTab({ kind: 'project', projectId: p.id, targetPath: null, subTab: sub, scroll: 0 }, p.alias ?? p.diskName);
    void api.post(`/api/projects/${p.id}/open`);
  };
  const pin = useMutation({
    mutationFn: (p: ProjectSummary) => api.patch(`/api/projects/${p.id}`, { rev: p.rev, isPinned: !p.isPinned }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '操作失败')
  });
  const analyze = useMutation({
    mutationFn: (ids: string[]) => api.post('/api/projects/analyze', { projectIds: ids }),
    onSuccess: () => void message.success('已开始重新分析')
  });

  return (
    <div style={{ overflow: 'auto', height: '100%', paddingRight: 4 }} data-testid="dashboard">
      {/* 总览屏也必须能直接添加项目：原先入口只在卡片墙分支里，默认落总览时"找不到添加入口" */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          工作台总览
        </Typography.Title>
        <div style={{ flex: 1 }} />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          data-testid="add-project-btn"
          onClick={() => useAppStore.getState().requestAddProject()}
        >
          添加项目
        </Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Card size="small">
          <Statistic title="项目总数" value={list.length} loading={isLoading} />
        </Card>
        <Card size="small">
          <Statistic title="今天动过" value={openedToday} loading={isLoading} />
        </Card>
        <Card size="small">
          <Statistic title="有未提交改动" value={dirty} loading={isLoading} valueStyle={dirty > 0 ? { color: SEMANTIC.warning } : undefined} />
        </Card>
        <Card size="small">
          <Statistic title="缺设计文档" value={noDocs} loading={isLoading} />
        </Card>
        <Card size="small">
          <Statistic title="缺架构图" value={noArch} loading={isLoading} />
        </Card>
        <Card size="small">
          <Statistic title="平均分析耗时" value={avgMs} suffix="ms" loading={isLoading} />
        </Card>
      </div>

      {/* 项目卡片（与卡片墙同款 ProjectCard）：总览直接可看可打开，超过一页走分页 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '16px 0 8px' }}>
        <Typography.Title level={5} style={{ margin: 0 }}>项目</Typography.Title>
        <span style={{ fontSize: 12, color: SEMANTIC.textTertiary }}>共 {total} 个 · 每页 {PAGE_SIZE} 个</span>
      </div>
      {total === 0 ? (
        <Card size="small">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有登记项目，点右上「添加项目」开始" />
        </Card>
      ) : (
        <>
          <div data-testid="dashboard-project-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {pageItems.map((p) => (
              <ProjectCard key={p.id} p={p} onOpen={() => openProject(p)} onPin={() => pin.mutate(p)} onAnalyze={() => analyze.mutate([p.id])} />
            ))}
          </div>
          <div data-testid="dashboard-project-pagination" style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
            <Pagination
              current={page}
              pageSize={PAGE_SIZE}
              total={total}
              onChange={(next) => setPage(next)}
              hideOnSinglePage
              showSizeChanger={false}
              showTotal={(n) => `共 ${n} 个项目`}
            />
          </div>
        </>
      )}
    </div>
  );
}
