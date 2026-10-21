/** 活动中心（FR-13.8 / T-105）：活动记录（筛选/分页/CSV）+ 时间线（按天）+ 最近查看（recent_files + 收藏置顶）。 */
import { Button, DatePicker, Empty, List, Select, Space, Tabs, Tag, Typography } from 'antd';
import { DownloadOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { api } from '@/lib/api';
import type { ActivityEntry, ProjectSummary } from '@ttfolio/shared';
import { relTime } from '@/lib/format';
import { useAppStore } from '@/app/store';
import {
  activityToCsv,
  groupActivityByDay,
  KIND_GROUPS,
  kindLabel,
  LEVEL_COLORS,
  type RecentFileEntry,
} from './activityHelpers';

const PAGE_SIZE = 100;

interface ActivityFilters {
  projectId?: string;
  level?: string;
  kind?: string;
  range?: [Dayjs, Dayjs] | null;
}

function filterParams(f: ActivityFilters): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.projectId !== undefined) p.projectId = f.projectId;
  if (f.level !== undefined) p.level = f.level;
  if (f.kind !== undefined) p.kind = f.kind;
  if (f.range !== undefined && f.range !== null) {
    p.since = f.range[0].startOf('day').toISOString();
    p.until = f.range[1].endOf('day').toISOString();
  }
  return p;
}

function projectName(projects: ProjectSummary[], id: string): string {
  const p = projects.find((x) => x.id === id);
  return p !== undefined ? (p.alias ?? p.diskName) : '（项目未登记）';
}

function ActivityRowView({
  e,
  projects,
  onJump,
}: {
  e: ActivityEntry;
  projects: ProjectSummary[];
  onJump: (e: ActivityEntry) => void;
}): React.JSX.Element {
  return (
    <List.Item style={{ cursor: 'pointer', padding: '4px 0' }} onClick={() => onJump(e)}>
      <span style={{ display: 'inline-flex', gap: 8, width: '100%', alignItems: 'center' }}>
        <span
          style={{ flexShrink: 0, fontSize: 12, opacity: 0.6, width: 68 }}
          title={new Date(e.at).toLocaleString('zh-CN')}
        >
          {relTime(e.at)}
        </span>
        <Tag style={{ fontSize: 10, flexShrink: 0, marginInlineEnd: 0 }} color={LEVEL_COLORS[e.level]}>
          {e.level}
        </Tag>
        <Tag style={{ fontSize: 10, flexShrink: 0, marginInlineEnd: 0 }}>{kindLabel(e.kind)}</Tag>
        <span className="tt-ellipsis" style={{ flex: 1, fontSize: 12 }} title={e.targetPath ?? e.kind}>
          {e.targetPath ?? e.kind}
        </span>
        {e.projectId !== null && (
          <span style={{ flexShrink: 0, fontSize: 12, opacity: 0.75 }}>
            {projectName(projects, e.projectId)}
          </span>
        )}
        <span style={{ flexShrink: 0, fontSize: 12, opacity: 0.55 }}>{e.actor}</span>
      </span>
    </List.Item>
  );
}

function FilterBar({
  projects,
  filters,
  onChange,
}: {
  projects: ProjectSummary[];
  filters: ActivityFilters;
  onChange: (next: ActivityFilters) => void;
}): React.JSX.Element {
  return (
    <Space wrap style={{ marginBottom: 8 }}>
      <Select
        allowClear
        showSearch
        optionFilterProp="label"
        placeholder="项目"
        style={{ minWidth: 160 }}
        value={filters.projectId}
        onChange={(v) => onChange({ ...filters, projectId: v })}
        options={projects.map((p) => ({ value: p.id, label: p.alias ?? p.diskName }))}
      />
      <Select
        allowClear
        placeholder="级别"
        style={{ minWidth: 90 }}
        value={filters.level}
        onChange={(v) => onChange({ ...filters, level: v })}
        options={[
          { value: 'L1', label: 'L1' },
          { value: 'L2', label: 'L2' },
          { value: 'L3', label: 'L3' },
        ]}
      />
      <Select
        allowClear
        placeholder="类型"
        style={{ minWidth: 110 }}
        value={filters.kind}
        onChange={(v) => onChange({ ...filters, kind: v })}
        options={KIND_GROUPS.map((g) => ({ value: g.prefix, label: g.label }))}
      />
      <DatePicker.RangePicker
        value={filters.range ?? null}
        onChange={(range) => onChange({ ...filters, range: range as [Dayjs, Dayjs] | null })}
        allowEmpty={[true, true]}
      />
    </Space>
  );
}

function EmptyHint({ text }: { text: string }): React.JSX.Element {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} />;
}

/** 最近查看（FR-13.8）：recent_files 聚合 + 收藏置顶（settings 键 recent_pins）。 */
function RecentTab({ projects }: { projects: ProjectSummary[] }): React.JSX.Element {
  const openTab = useAppStore((s) => s.openTab);
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<string | undefined>(undefined);
  const { data: recents } = useQuery({
    queryKey: ['recent-files', scope],
    queryFn: () =>
      api.get<RecentFileEntry[]>('/api/recent', {
        type: 'files',
        limit: '200',
        ...(scope !== undefined ? { projectId: scope } : {}),
      }),
  });
  const { data: pinsData } = useQuery({
    queryKey: ['recent-pins'],
    queryFn: () => api.get<{ pins: string[] }>('/api/recent/pins'),
  });
  const pins = useMemo(() => pinsData?.pins ?? [], [pinsData]);
  const togglePin = useMutation({
    mutationFn: (key: string) =>
      api.put('/api/recent/pins', {
        pins: pins.includes(key) ? pins.filter((x) => x !== key) : [...pins, key],
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recent-pins'] });
    },
  });
  const sorted = useMemo(() => {
    const l = [...(recents ?? [])];
    // 收藏置顶（按收藏数组顺序），其余按打开时间倒序
    l.sort((a, b) => {
      const pa = pins.indexOf(`${a.projectId}|${a.path}`);
      const pb = pins.indexOf(`${b.projectId}|${b.path}`);
      const na = pa < 0 ? Number.MAX_SAFE_INTEGER : pa;
      const nb = pb < 0 ? Number.MAX_SAFE_INTEGER : pb;
      if (na !== nb) return na - nb;
      return String(b.openedAt).localeCompare(String(a.openedAt));
    });
    return l;
  }, [recents, pins]);
  const openFile = (r: RecentFileEntry): void => {
    openTab(
      { kind: 'project', projectId: r.projectId, targetPath: r.path, subTab: 'files', scroll: 0 },
      projectName(projects, r.projectId),
    );
  };
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="全部项目"
          style={{ minWidth: 180 }}
          value={scope}
          onChange={(v) => setScope(v)}
          options={projects.map((p) => ({ value: p.id, label: p.alias ?? p.diskName }))}
        />
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
          文件与项目内文档的打开记录（星标置顶）
        </span>
      </div>
      {sorted.length === 0 ? (
        <EmptyHint text="还没有打开记录；打开任意文件或文档后出现在这里" />
      ) : (
        <List
          size="small"
          dataSource={sorted}
          rowKey={(r) => `${r.projectId}|${r.path}`}
          renderItem={(r) => {
            const key = `${r.projectId}|${r.path}`;
            const pinned = pins.includes(key);
            return (
              <List.Item style={{ cursor: 'pointer', padding: '4px 0' }} onClick={() => openFile(r)}>
                <span style={{ display: 'inline-flex', gap: 8, width: '100%', alignItems: 'center' }}>
                  <Button
                    size="small"
                    type="text"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      togglePin.mutate(key);
                    }}
                    icon={pinned ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
                  />
                  <span className="tt-ellipsis" style={{ flex: 1, fontSize: 12 }} title={r.path}>
                    {r.path}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: 12, opacity: 0.75 }}>
                    {projectName(projects, r.projectId)}
                  </span>
                  <span
                    style={{ flexShrink: 0, fontSize: 12, opacity: 0.55 }}
                    title={`打开 ${r.openCount} 次`}
                  >
                    ×{r.openCount}
                  </span>
                  <span
                    style={{ flexShrink: 0, fontSize: 12, opacity: 0.6, width: 68 }}
                    title={new Date(r.openedAt).toLocaleString('zh-CN')}
                  >
                    {relTime(r.openedAt)}
                  </span>
                </span>
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );
}

export function ActivityPage(): React.JSX.Element {
  const openTab = useAppStore((s) => s.openTab);
  const [filters, setFilters] = useState<ActivityFilters>({});
  const { data: projects } = useQuery({
    queryKey: ['projects', 'activity'],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects', { status: 'active' }),
  });
  const list = projects ?? [];

  const q = useInfiniteQuery({
    queryKey: ['activity', filters],
    queryFn: ({ pageParam }) =>
      api.get<ActivityEntry[]>('/api/activity', {
        limit: String(PAGE_SIZE),
        offset: String(pageParam),
        ...filterParams(filters),
      }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, pg) => n + pg.length, 0);
      return last.length < PAGE_SIZE ? undefined : loaded;
    },
  });
  const rows = useMemo(() => (q.data?.pages ?? []).flat(), [q.data]);
  const days = useMemo(() => groupActivityByDay(rows), [rows]);

  const jump = (e: ActivityEntry): void => {
    if (e.projectId === null) {
      // 全局动作按 kind 落对应页；其余（如 open.external 的库级动作）无目标可跳，如实不动
      if (e.kind.startsWith('trash.')) {
        openTab({ kind: 'trash', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '回收站');
      } else if (
        e.kind.startsWith('settings.') ||
        e.kind.startsWith('library.') ||
        e.kind.startsWith('profile.')
      ) {
        openTab({ kind: 'settings', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '设置');
      }
      return;
    }
    const title = projectName(list, e.projectId);
    if (e.kind.startsWith('git.')) {
      openTab({ kind: 'project', projectId: e.projectId, targetPath: null, subTab: 'git', scroll: 0 }, title);
    } else if (e.targetPath !== null) {
      openTab(
        { kind: 'project', projectId: e.projectId, targetPath: e.targetPath, subTab: 'files', scroll: 0 },
        title,
      );
    } else {
      openTab(
        { kind: 'project', projectId: e.projectId, targetPath: null, subTab: 'overview', scroll: 0 },
        title,
      );
    }
  };

  const exportCsv = (): void => {
    const blob = new Blob([activityToCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ttfolio-activity-${dayjs().format('YYYYMMDD-HHmmss')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filterNodes = <FilterBar projects={list} filters={filters} onChange={setFilters} />;

  const recordsTab = (
    <div>
      {filterNodes}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', flex: 1 }}>
          已加载 {rows.length} 条{q.hasNextPage === true ? '（还有更多）' : ''}
        </span>
        <Button
          size="small"
          icon={<DownloadOutlined />}
          disabled={rows.length === 0}
          onClick={exportCsv}
          data-testid="activity-export"
        >
          导出 CSV（当前已加载）
        </Button>
      </div>
      {rows.length === 0 && !q.isLoading ? (
        <EmptyHint text="没有符合条件的活动记录" />
      ) : (
        <List
          size="small"
          dataSource={rows}
          rowKey="id"
          renderItem={(e) => <ActivityRowView e={e} projects={list} onJump={jump} />}
        />
      )}
      {q.hasNextPage === true && (
        <div style={{ marginTop: 8, textAlign: 'center' }}>
          <Button size="small" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            加载更多
          </Button>
        </div>
      )}
    </div>
  );

  const timelineTab = (
    <div>
      {filterNodes}
      {days.length === 0 ? (
        <EmptyHint text="没有符合条件的活动记录" />
      ) : (
        days.map((g) => (
          <div key={g.day} style={{ marginBottom: 12 }} data-testid="activity-day">
            <div style={{ fontSize: 12, opacity: 0.6, margin: '6px 0 2px' }}>{g.day}</div>
            <List
              size="small"
              dataSource={g.items}
              rowKey="id"
              renderItem={(e) => <ActivityRowView e={e} projects={list} onJump={jump} />}
            />
          </div>
        ))
      )}
    </div>
  );

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 16px' }} data-testid="activity-page">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        活动中心
      </Typography.Title>
      <Tabs
        defaultActiveKey="records"
        items={[
          { key: 'records', label: '活动记录', children: recordsTab },
          { key: 'timeline', label: '时间线', children: timelineTab },
          { key: 'recent', label: '最近查看', children: <RecentTab projects={list} /> },
        ]}
      />
    </div>
  );
}
