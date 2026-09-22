/**
 * 工作台总览（对齐原型 3.1：6 个 KPI + 最近打开 + 需要处理 + 跨项目清单汇总）。
 * 与「项目卡片墙」是两个屏：卡片墙是筛选/浏览项目，本屏回答"哪里需要我"。
 */
import { Button, Card, Empty, List, Statistic, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { api } from '@/lib/api';
import type { ProjectSummary } from '@ttfolio/shared';
import { relTime } from '@/lib/format';
import { useAppStore } from '@/app/store';
import { SEMANTIC } from '@/theme/tokens';

interface TodoRow {
  id: string;
  title: string;
  done: boolean;
  projectId: string | null;
}

export function Dashboard(): React.JSX.Element {
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects', 'dashboard'],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects', { status: 'active' })
  });
  const { data: todos } = useQuery({
    queryKey: ['todos', 'dashboard'],
    queryFn: () => api.get<TodoRow[]>('/api/todos', { scope: 'all' }),
    retry: 0
  });

  const list = projects ?? [];
  const today = new Date().toDateString();
  const isToday = (iso: string | null): boolean => iso !== null && new Date(iso).toDateString() === today;
  const dirty = list.filter((p) => p.gitIsRepo && p.gitDirty).length;
  const noDocs = list.filter((p) => !p.hasDocs).length;
  const noArch = list.filter((p) => !p.hasArch).length;
  const openedToday = list.filter((p) => isToday(p.lastOpenedAt)).length;
  const avgMs = (() => {
    const vals = list.map((p) => p.analyzeMs ?? 0).filter((v) => v > 0);
    return vals.length === 0 ? 0 : Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  })();

  const goView = (subTab: string): void => {
    useAppStore.getState().updateActiveLocation({ subTab }, true);
  };

  const recent = [...list]
    .filter((p) => p.lastOpenedAt !== null)
    .sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)))
    .slice(0, 5);

  const need: Array<{ title: string; desc: string; subTab: string; count: number }> = [
    { title: '有未提交改动', desc: '工作区脏的项目', subTab: 'view:my-dirty', count: dirty },
    { title: '缺设计文档', desc: '没有关联任何设计文档', subTab: 'view:my-nodocs', count: noDocs },
    { title: '缺架构图', desc: '没有登记架构图目录', subTab: 'view:my-noarch', count: noArch },
    { title: '未分析', desc: '尚未完成分析', subTab: 'view:my-unanalyzed', count: list.filter((p) => p.analyzedAt === null).length }
  ];

  const openTodos = (todos ?? []).filter((t) => !t.done);

  return (
    <div style={{ overflow: 'auto', height: '100%', paddingRight: 4 }} data-testid="dashboard">
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12, marginTop: 12 }}>
        <Card size="small" title="最近打开" extra={<a onClick={() => goView('view:recent')}>查看全部</a>}>
          {recent.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有打开过项目" />
          ) : (
            <List
              size="small"
              dataSource={recent}
              renderItem={(p) => (
                <List.Item
                  style={{ cursor: 'pointer' }}
                  onClick={() =>
                    useAppStore
                      .getState()
                      .openTab({ kind: 'project', projectId: p.id, targetPath: null, subTab: 'files', scroll: 0 }, p.alias ?? p.diskName)
                  }
                >
                  <span style={{ flex: 1 }} className="tt-ellipsis">{p.alias ?? p.diskName}</span>
                  <span style={{ color: SEMANTIC.textTertiary, fontSize: 12 }}>{relTime(p.lastOpenedAt)} · {p.openCount} 次</span>
                </List.Item>
              )}
            />
          )}
        </Card>

        <Card size="small" title="需要处理">
          <List
            size="small"
            dataSource={need}
            renderItem={(n) => (
              <List.Item
                style={{ cursor: 'pointer' }}
                onClick={() => goView(n.subTab)}
                actions={[<Tag key="c" color={n.count > 0 ? 'orange' : 'default'}>{n.count}</Tag>]}
              >
                <span style={{ flex: 1 }}>
                  {n.title}
                  <div style={{ fontSize: 12, color: SEMANTIC.textTertiary }}>{n.desc}</div>
                </span>
              </List.Item>
            )}
          />
        </Card>
      </div>

      <Card
        size="small"
        title="跨项目清单（未完成）"
        style={{ marginTop: 12 }}
        extra={<span style={{ fontSize: 12, color: SEMANTIC.textTertiary }}>共 {openTodos.length} 项</span>}
      >
        {openTodos.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有未完成的清单项" />
        ) : (
          <List
            size="small"
            dataSource={openTodos.slice(0, 10)}
            renderItem={(t) => <List.Item>• {t.title}</List.Item>}
          />
        )}
        <Button size="small" style={{ marginTop: 8 }} onClick={() => goView('view:my-dirty')}>
          去按项目处理
        </Button>
      </Card>
    </div>
  );
}
