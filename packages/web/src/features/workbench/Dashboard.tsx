/**
 * 工作台总览：6 个 KPI + 项目卡片（分页）。
 * 用户反馈原来的「最近打开/需要处理/跨项目清单」三张卡跳转逻辑乱 → 移除，
 * 总览收敛为「KPI 一眼看全局 + 项目卡片直达」。
 */
import { App, Button, Card, Empty, List, Pagination, Statistic, Tag, Typography } from 'antd';
import { CheckOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import type { ProjectSummary, TodoItem } from '@ttfolio/shared';
import { relTime } from '@/lib/format';
import { useAppStore } from '@/app/store';
import { useSettings } from '@/app/settings';
import { ProjectCard } from './ProjectCard';
import { BatchActionBar } from './BatchActionBar';
import { buildTodoDigest } from './todoDigest';
import { langColor, SEMANTIC } from '@/theme/tokens';

/** 总览项目卡片的每页数量：1440 宽下约 3 列，12 个 = 4 屏内可翻完 */
const PAGE_SIZE = 12;

/** 跨项目未完成清单（FR-9.3）的展示上限：只影响展示，计数仍报全量 */
const TODO_DIGEST_LIMIT = 10;

/** 本地时区的 YYYY-MM-DD（评审：用 UTC 的 toISOString 比对「今天」，东八区每天 0-8 点算成昨天） */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function Dashboard(): React.JSX.Element {
  const { settings } = useSettings();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  // 批量多选（T-117）：与卡片墙同款交互——Ctrl/⌘+点选或勾选角标，共享 BatchActionBar
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const toggleSelect = (id: string): void =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects', 'dashboard', settings.cardSort],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects', { status: 'active', sort: settings.cardSort }),
  });
  // 跨项目未完成清单（FR-9.3）：只取未完成，汇总卡按项目分组展示
  const { data: openTodos } = useQuery({
    queryKey: ['todos', 'dash-digest'],
    queryFn: () => api.get<TodoItem[]>('/api/todos?scope=all&includeDone=0'),
  });

  const list = React.useMemo(() => projects ?? [], [projects]);
  const dirty = list.filter((p) => p.gitIsRepo && p.gitDirty).length;
  const noDocs = list.filter((p) => !p.hasDocs).length;
  const noArch = list.filter((p) => !p.hasArch).length;
  const todayKey = localDateKey(new Date());
  const openedToday = list.filter(
    (p) => p.lastOpenedAt !== null && localDateKey(new Date(String(p.lastOpenedAt))) === todayKey,
  ).length;
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

  // 分页器防漂移：以第 1 页（最满页）的卡片栅格实际高度锁定项目区最小高度——
  // 翻到内容不满的页时分页器纹丝不动（用户反馈：不满页时「共 N 个项目」会被往上顶）。
  // 高度锁定只对产生它的窗口宽度有效：宽度一变（全屏↔窗口）立即失效清零，
  // 停在/翻回第 1 页时按新列数重新校准——绝不沿用旧宽度的高度（那是切换窗口后大空白的根因）。
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const [gridMinH, setGridMinH] = useState(0);
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  React.useEffect(() => {
    const onResize = (): void => setViewportW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  React.useEffect(() => {
    setGridMinH(0);
  }, [viewportW]);
  React.useEffect(() => {
    if (page !== 1) return;
    const id = window.setTimeout(() => {
      const h = gridRef.current?.getBoundingClientRect().height ?? 0;
      if (h > 0) setGridMinH((prev) => (Math.abs(prev - h) > 2 ? Math.round(h) : prev));
    }, 80);
    return () => window.clearTimeout(id);
  }, [page, viewportW]);

  // 与卡片墙一致的动作（Workbench 同款实现，保持两处行为相同）：
  const openProject = (p: ProjectSummary): void => {
    const sub = settings.defaultProjectTab === 'overview' ? 'overview' : 'files';
    if (sub === 'files') useAppStore.getState().requestAutoOpenProject(p.id);
    useAppStore
      .getState()
      .openTab(
        { kind: 'project', projectId: p.id, targetPath: null, subTab: sub, scroll: 0 },
        p.alias ?? p.diskName,
      );
    void api.post(`/api/projects/${p.id}/open`);
  };
  const pin = useMutation({
    mutationFn: (p: ProjectSummary) =>
      api.patch(`/api/projects/${p.id}`, { rev: p.rev, isPinned: !p.isPinned }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '操作失败'),
  });
  const analyze = useMutation({
    mutationFn: (ids: string[]) => api.post('/api/projects/analyze', { projectIds: ids }),
    onSuccess: () => void message.success('已开始重新分析'),
  });

  // ---- 「继续上次」：最近打开的 6 个项目，chips 直达 ----
  const recent = [...list]
    .filter((p) => p.lastOpenedAt !== null)
    .sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)))
    .slice(0, 6);

  // ---- 「需要关注」行动条：只显示计数 > 0 的项，点击跳对应卡片墙 ----
  const unanalyzed = list.filter((p) => p.analyzedAt === null).length;
  const todoDigest = React.useMemo(() => {
    const names = new Map(list.map((p) => [p.id, p.alias ?? p.diskName]));
    return buildTodoDigest(openTodos ?? [], names, TODO_DIGEST_LIMIT);
  }, [openTodos, list]);
  const todoDone = useMutation({
    mutationFn: (id: string) => api.patch(`/api/todos/${id}`, { done: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['todos'] });
    },
  });
  const todosCardRef = React.useRef<HTMLDivElement | null>(null);
  const attention = [
    { key: 'my-dirty', label: '有未提交改动', count: dirty },
    { key: 'my-nodocs', label: '缺文档', count: noDocs },
    { key: 'my-noarch', label: '缺架构图', count: noArch },
    { key: 'my-unanalyzed', label: '未分析', count: unanalyzed },
    { key: 'my-todos', label: '未完成清单', count: todoDigest.total },
  ].filter((a) => a.count > 0);
  const goView = (key: string): void => {
    if (key === 'my-todos') {
      // 未完成清单不是卡片墙视图：平滑滚动到本页汇总卡（KPI「项目总数」同款手法）
      todosCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    useAppStore.getState().updateActiveLocation({ subTab: `view:${key}` }, true);
  };
  // 汇总卡里点项目名 → 打开该项目标签的概览页签（清单条目就住在那里）
  const openTodoProject = (projectId: string, projectName: string): void => {
    useAppStore
      .getState()
      .openTab({ kind: 'project', projectId, targetPath: null, subTab: 'overview', scroll: 0 }, projectName);
  };
  // KPI「项目总数」点击：平滑滚动到本屏项目区（数据就在下方，无需换视图）
  const projectsSectionRef = React.useRef<HTMLDivElement | null>(null);
  const scrollToProjects = (): void => {
    projectsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ---- 聚合语言占比：全部项目按字节聚合，GitHub 风格色条 + 图例（top6 + 其他） ----
  const langAgg = (() => {
    const m = new Map<string, number>();
    for (const p of list)
      for (const l of p.languages ?? []) m.set(l.language, (m.get(l.language) ?? 0) + l.bytes);
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    if (total === 0) return null;
    const entries = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const rows = entries
      .slice(0, 6)
      .map(([language, bytes]) => ({ language, percent: Math.round((bytes / total) * 100) }));
    const rest = entries.slice(6).reduce((a, b) => a + b[1], 0);
    if (rest > 0)
      rows.push({ language: 'Other', percent: Math.max(1, 100 - rows.reduce((s, r) => s + r.percent, 0)) });
    return rows.filter((r) => r.percent > 0);
  })();

  // ---- 「最近提交」动态流：跨项目按提交时间倒序 top 8，点行跳该项目 Git 页签 ----
  const commits = [...list]
    .filter((p) => p.gitLastCommitAt !== null)
    .sort((a, b) => String(b.gitLastCommitAt).localeCompare(String(a.gitLastCommitAt)))
    .slice(0, 8);
  const openGit = (p: ProjectSummary): void => {
    useAppStore
      .getState()
      .openTab(
        { kind: 'project', projectId: p.id, targetPath: null, subTab: 'git', scroll: 0 },
        p.alias ?? p.diskName,
      );
  };

  return (
    // flex column：项目区 flex:1 吃掉剩余高度，分页器 margin-top:auto 恒贴其底——
    // 翻到内容不满一屏的页时分页器不再被顶得上下跳（用户反馈）
    <div
      style={{ overflow: 'auto', height: '100%', paddingRight: 4, display: 'flex', flexDirection: 'column' }}
      data-testid="dashboard"
    >
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

      {/* 「继续上次」：最近打开的项目 chips，一键直达 */}
      {recent.length > 0 && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}
          data-testid="dash-recent"
        >
          <span style={{ fontSize: 12, color: SEMANTIC.textTertiary, flexShrink: 0 }}>继续上次：</span>
          {recent.map((p) => (
            <Button key={p.id} size="small" onClick={() => openProject(p)}>
              {p.alias ?? p.diskName}
            </Button>
          ))}
        </div>
      )}

      {/* KPI 卡片（第 39 轮）：可点的五张 hoverable + onClick 跳对应视图/锚点，
          「平均分析耗时」无对应项目集合保持静态；跳转复用「需要关注」条的 goView */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Card size="small" hoverable onClick={scrollToProjects} data-testid="kpi-total">
          <Statistic title="项目总数" value={list.length} loading={isLoading} />
        </Card>
        <Card size="small" hoverable onClick={() => goView('recent')} data-testid="kpi-opened-today">
          <Statistic title="今天动过" value={openedToday} loading={isLoading} />
        </Card>
        <Card size="small" hoverable onClick={() => goView('my-dirty')} data-testid="kpi-dirty">
          <Statistic
            title="有未提交改动"
            value={dirty}
            loading={isLoading}
            valueStyle={dirty > 0 ? { color: SEMANTIC.warning } : undefined}
          />
        </Card>
        <Card size="small" hoverable onClick={() => goView('my-nodocs')} data-testid="kpi-nodocs">
          <Statistic title="缺设计文档" value={noDocs} loading={isLoading} />
        </Card>
        <Card size="small" hoverable onClick={() => goView('my-noarch')} data-testid="kpi-noarch">
          <Statistic title="缺架构图" value={noArch} loading={isLoading} />
        </Card>
        <Card size="small">
          <Statistic title="平均分析耗时" value={avgMs} suffix="ms" loading={isLoading} />
        </Card>
      </div>

      {/* 「需要关注」行动条：只显示计数 > 0 的项，点击跳对应卡片墙视图 */}
      {attention.length > 0 && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12 }}
          data-testid="dash-attention"
        >
          <span style={{ fontSize: 12, color: SEMANTIC.warning, flexShrink: 0 }}>⚠ 需要关注：</span>
          {attention.map((a) => (
            <Tag
              key={a.key}
              color="warning"
              style={{ cursor: 'pointer', marginInlineEnd: 0 }}
              onClick={() => goView(a.key)}
            >
              {a.label} {a.count}
            </Tag>
          ))}
        </div>
      )}

      {/* 聚合语言占比：全部项目按字节聚合（GitHub 风格色条 + 图例） */}
      {langAgg !== null && (
        <div style={{ marginTop: 12 }} data-testid="dash-langs">
          <div style={{ fontSize: 12, color: SEMANTIC.textTertiary, marginBottom: 4 }}>
            语言构成（全部项目聚合）
          </div>
          <div
            style={{
              display: 'flex',
              height: 8,
              borderRadius: 4,
              overflow: 'hidden',
              background: SEMANTIC.split,
            }}
          >
            {langAgg.map((r) => (
              <div
                key={r.language}
                style={{ width: `${r.percent}%`, background: langColor(r.language) }}
                title={`${r.language} ${r.percent}%`}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
            {langAgg.map((r) => (
              <span key={r.language} style={{ fontSize: 12 }}>
                <i
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: langColor(r.language),
                    marginRight: 4,
                  }}
                />
                {r.language} {r.percent}%
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 项目区：flex:1 吃掉剩余高度，分页器恒贴本区底部 */}
      <div ref={projectsSectionRef} style={{ marginTop: 16, scrollMarginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            项目
          </Typography.Title>
          <span style={{ fontSize: 12, color: SEMANTIC.textTertiary }}>
            共 {total} 个 · 每页 {PAGE_SIZE} 个
          </span>
        </div>
        {total === 0 ? (
          <Card size="small">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <>
                  还没有登记项目
                  <br />
                  <span style={{ fontSize: 12, opacity: 0.65 }}>
                    ① 粘贴路径 / 选文件夹 / 拖入文件夹（桌面版）登记 → ② 自动分析 → ③ 浏览 · Git · 搜索
                  </span>
                </>
              }
            >
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => useAppStore.getState().requestAddProject()}
              >
                添加项目
              </Button>
            </Empty>
          </Card>
        ) : (
          <>
            <div
              ref={gridRef}
              data-testid="dashboard-project-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 12,
                minHeight: gridMinH > 0 ? gridMinH : undefined,
                // 用户反馈"卡片中部大片空白"：minHeight 撑高容器时默认 stretch 把内容少的
                // 卡拉出大片空白——改为顶对齐，卡片按内容收缩，留白落在容器底部
                alignItems: 'start',
              }}
            >
              {pageItems.map((p) => (
                <ProjectCard
                  key={p.id}
                  p={p}
                  onOpen={() => openProject(p)}
                  onPin={() => pin.mutate(p)}
                  onAnalyze={() => analyze.mutate([p.id])}
                  selected={selectedIds.includes(p.id)}
                  selectMode={selectedIds.length > 0}
                  onToggleSelect={() => toggleSelect(p.id)}
                />
              ))}
            </div>
            <div
              data-testid="dashboard-project-pagination"
              style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}
            >
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
            {selectedIds.length > 0 && (
              <BatchActionBar selectedIds={selectedIds} onClear={() => setSelectedIds([])} />
            )}
          </>
        )}
      </div>

      {/* 「最近提交」动态流：跨项目按提交时间倒序，点行跳该项目 Git 页签 */}
      {/* 弹性垫片：内容不满一屏时吃掉剩余空间、把底部两卡推到底部；超屏时收缩为 0 顺流。 */}
      <div style={{ flex: '1 1 0%', minHeight: 0 }} />

      {/* 跨项目未完成清单（FR-9.3）：只在有未完成条目时出现；按项目分组、组内截止排序，
          逾期标红；勾选即完成；点项目名跳该项目概览页签。旧版三卡曾因跳转乱被移除——
          本卡沿用「最近提交」的底部单卡惯例，入口只有「需要关注」条与本卡自身。 */}
      {todoDigest.total > 0 && (
        <div ref={todosCardRef} style={{ marginTop: 12, scrollMarginTop: 8 }}>
          <Card
            size="small"
            title={`未完成清单（${todoDigest.total}）`}
            style={{ marginTop: 12 }}
            data-testid="dash-todos"
            extra={
              <span style={{ fontSize: 12, color: SEMANTIC.textTertiary }}>
                {todoDigest.groups.length} 个项目
                {todoDigest.hidden > 0 ? ` · 还有 ${todoDigest.hidden} 条` : ''}
              </span>
            }
          >
            {todoDigest.groups.map((g, gi) => (
              <div key={g.projectId} style={{ marginBottom: gi === todoDigest.groups.length - 1 ? 0 : 10 }}>
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: 'auto' }}
                  onClick={() => openTodoProject(g.projectId, g.projectName)}
                >
                  {g.projectName}
                </Button>
                {g.items.map((t) => (
                  <div
                    key={t.id}
                    style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0 2px 12px' }}
                  >
                    <Button
                      size="small"
                      type="text"
                      icon={<CheckOutlined />}
                      onClick={() => todoDone.mutate(t.id)}
                    />
                    <span style={{ flex: 1, fontSize: 12 }}>{t.title}</span>
                    {t.dueOn !== null && (
                      <Tag style={{ fontSize: 10 }} color={t.dueOn < todayKey ? 'error' : undefined}>
                        截止 {t.dueOn}
                      </Tag>
                    )}
                    {t.category !== null && <Tag style={{ fontSize: 10 }}>{t.category}</Tag>}
                  </div>
                ))}
              </div>
            ))}
          </Card>
        </div>
      )}
      {commits.length > 0 && (
        <Card size="small" title="最近提交" style={{ marginTop: 12 }} data-testid="dash-commits">
          <List
            size="small"
            rowKey="id"
            dataSource={commits}
            renderItem={(p) => (
              <List.Item
                className="tt-commit-row"
                style={{ cursor: 'pointer', padding: '3px 0' }}
                onClick={() => openGit(p)}
              >
                <span style={{ display: 'inline-flex', gap: 8, width: '100%', alignItems: 'center' }}>
                  <strong style={{ flexShrink: 0, fontSize: 12 }}>{p.alias ?? p.diskName}</strong>
                  <span className="tt-ellipsis" style={{ flex: 1, fontSize: 12, opacity: 0.85 }}>
                    {p.gitLastCommitSubject ?? '（无提交主题）'}
                  </span>
                  <span style={{ fontSize: 12, opacity: 0.55, flexShrink: 0 }}>
                    {relTime(p.gitLastCommitAt)}
                  </span>
                </span>
              </List.Item>
            )}
          />
        </Card>
      )}
    </div>
  );
}
