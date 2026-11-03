/** 项目统计面板（FR-15.3 / T-144，2026-11-03 用户点名 C 组）：
 *  视图 subTab=view:stats，数据 GET /api/stats/overview（现表聚合零迁移）。
 *  刻意不引图表库（零重依赖风格 + 包体积敏感）：CSS 横条 + conic-gradient 环图 +
 *  flex 周柱；悬浮 title 给精确值；如实标注非交互式图表。 */
import { Card, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { api } from '@/lib/api';
import type { StatsOverview } from '@ttfolio/shared';
import { fmtBytes } from '@/lib/format';
import { StateView } from '@/components/StateView';
import { langColor } from '@/theme/tokens';

/** 环图配色（覆盖度两段）：主色=已入集合，灰=未分配 */
const RING_COLORS = ['var(--tt-primary)', 'rgba(128,128,128,0.35)'] as const;

function HBars(props: {
  rows: Array<{ label: string; value: number; display: string; color?: string }>;
  max: number;
}): React.JSX.Element {
  const { rows, max } = props;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            className="tt-ellipsis"
            style={{ width: 110, flexShrink: 0, fontSize: 12, textAlign: 'right' }}
            title={r.label}
          >
            {r.label}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              title={`${r.label}：${r.display}`}
              style={{
                height: 12,
                borderRadius: 6,
                width: `${max > 0 ? Math.max((r.value / max) * 100, 2) : 2}%`,
                background: r.color ?? 'var(--tt-primary)',
                opacity: 0.85,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <span style={{ flexShrink: 0, fontSize: 12, opacity: 0.7, minWidth: 64 }}>{r.display}</span>
        </div>
      ))}
    </div>
  );
}

function Ring(props: { parts: Array<{ label: string; value: number }>; center: string }): React.JSX.Element {
  const { parts, center } = props;
  const total = parts.reduce((s, p) => s + p.value, 0);
  let acc = 0;
  const stops = parts.map((p, i) => {
    const from = total > 0 ? (acc / total) * 100 : 0;
    acc += p.value;
    const to = total > 0 ? (acc / total) * 100 : 0;
    return `${RING_COLORS[i % RING_COLORS.length] ?? 'rgba(128,128,128,0.35)'} ${from}% ${to}%`;
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: '50%',
          background: `conic-gradient(${stops.join(', ')})`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title={parts.map((p) => `${p.label}：${p.value}`).join('，')}
      >
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: 'var(--tt-container-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          {center}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
        {parts.map((p, i) => (
          <span key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: RING_COLORS[i % RING_COLORS.length],
                flexShrink: 0,
              }}
            />
            {p.label}：{p.value}
          </span>
        ))}
      </div>
    </div>
  );
}

export function StatsView(): React.JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: () => api.get<StatsOverview>('/api/stats/overview'),
  });

  const empty = (data?.totalProjects ?? 0) === 0;
  const maxOpen = Math.max(1, ...(data?.openTop ?? []).map((o) => o.openCount));
  const maxWeek = Math.max(1, ...(data?.weeklyCommits ?? []).map((w) => w.count));
  const maxSize = Math.max(1, ...(data?.sizeBuckets ?? []).map((s) => s.count));
  const maxLang = Math.max(1e-9, ...(data?.languages ?? []).map((l) => l.bytes));

  return (
    <div data-testid="stats-view" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          项目统计
        </Typography.Title>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, opacity: 0.55 }}>静态聚合图（悬浮看精确值）</span>
      </div>
      <StateView
        loading={isLoading}
        error={error}
        empty={empty}
        emptyText="还没有登记项目——先在卡片墙添加项目，统计会随数据自动生成"
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Card size="small" title={`语言分布（按字节，共 ${data?.languages.length ?? 0} 项）`}>
            <HBars
              max={maxLang}
              rows={(data?.languages ?? []).map((l) => ({
                label: l.language,
                value: l.bytes,
                display: `${fmtBytes(l.bytes)} · ${Math.round(l.share * 100)}%`,
                color: langColor(l.language) === '#8b949e' ? undefined : langColor(l.language),
              }))}
            />
          </Card>
          <Card size="small" title="打开频率 Top 8">
            <HBars
              max={maxOpen}
              rows={(data?.openTop ?? []).map((o) => ({
                label: o.name,
                value: o.openCount,
                display: `${o.openCount} 次`,
              }))}
            />
          </Card>
          <Card size="small" title="近 28 天提交活跃（涉及项目数 / 周）">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24, height: 120, padding: '0 8px' }}>
              {(data?.weeklyCommits ?? []).map((w) => (
                <div
                  key={w.label}
                  title={`${w.label}：${w.count} 个项目有提交`}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
                >
                  <span style={{ fontSize: 12, opacity: 0.7 }}>{w.count}</span>
                  <div
                    style={{
                      width: '100%',
                      maxWidth: 72,
                      height: `${Math.max((w.count / maxWeek) * 84, 3)}px`,
                      borderRadius: 6,
                      background: 'var(--tt-primary)',
                      opacity: 0.85,
                    }}
                  />
                  <span style={{ fontSize: 11, opacity: 0.6 }}>{w.label}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card size="small" title="体量分布（项目目录实测）">
            <HBars
              max={maxSize}
              rows={(data?.sizeBuckets ?? []).map((s) => ({
                label: s.label,
                value: s.count,
                display: `${s.count} 个`,
              }))}
            />
          </Card>
          <Card size="small" title="组织覆盖度" style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
              <Ring
                center={`${(data?.coverage.total ?? 0) - (data?.coverage.unassigned ?? 0)}/${data?.coverage.total ?? 0}`}
                parts={[
                  {
                    label: '已入集合',
                    value: (data?.coverage.total ?? 0) - (data?.coverage.unassigned ?? 0),
                  },
                  { label: '未分配', value: data?.coverage.unassigned ?? 0 },
                ]}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                <span>登记中项目：{data?.coverage.total ?? 0}</span>
                <span>未入任何集合（见侧栏「未分配」）：{data?.coverage.unassigned ?? 0}</span>
                <span>无标签：{data?.coverage.noTags ?? 0}</span>
                <span>已归档：{data?.coverage.archived ?? 0}</span>
              </div>
            </div>
          </Card>
        </div>
      </StateView>
    </div>
  );
}
