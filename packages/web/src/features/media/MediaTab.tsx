/** 媒体页签（FR-13.5 / T-099）：分组网格（@tanstack/react-virtual 行虚拟化）+
 * 灯箱（缩放平移/翻页/幻灯片/连播）+ 缩略图懒生成队列（渲染层 canvas，
 * 服务端落盘，失败诚实回退图标）。文件树媒体点击经 mediaFocus 信号直达灯箱。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button, Empty, Segmented, Spin } from 'antd';
import { VideoCameraOutlined, SoundOutlined, FileImageOutlined } from '@ant-design/icons';
import { api, thumbUrl } from '@/lib/api';
import { fmtBytes } from '@/lib/format';
import { useAppStore } from '@/app/store';
import type { MediaItem } from '@ttfolio/shared';
import { DENSITY_PX, KIND_LABEL, columnsFor, groupByFolder, type DensityKey } from './mediaHelpers';
import { useThumbQueue } from './useThumbQueue';
import { Lightbox } from './Lightbox';

type KindFilter = 'all' | 'image' | 'video' | 'audio';

interface Row {
  type: 'header' | 'cells';
  dir: string;
  items?: MediaItem[];
}

export function MediaTab({ projectId }: { projectId: string }): React.JSX.Element {
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [density, setDensity] = useState<DensityKey>('cozy');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const mediaQuery = useQuery({
    queryKey: ['media', projectId],
    queryFn: () => api.get<MediaItem[]>(`/api/projects/${projectId}/media`),
  });
  const items = useMemo(() => {
    const all = mediaQuery.data ?? [];
    return kindFilter === 'all' ? all : all.filter((m) => m.kind === kindFilter);
  }, [mediaQuery.data, kindFilter]);

  const groups = useMemo(() => groupByFolder(items), [items]);
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const g of groups) {
      out.push({ type: 'header', dir: g.dir });
      const cols = Math.max(1, columnsFor(containerWidth, DENSITY_PX[density]));
      for (let i = 0; i < g.items.length; i += cols) {
        out.push({ type: 'cells', dir: g.dir, items: g.items.slice(i, i + cols) });
      }
    }
    return out;
  }, [groups, containerWidth, density]);

  // 容器宽度（列数与虚拟化行高依赖它）
  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowHeight = DENSITY_PX[density] + 30;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (i) => (rows[i]?.type === 'header' ? 34 : rowHeight),
    overscan: 6,
  });

  const thumbs = useThumbQueue(projectId, items, mediaQuery.isSuccess);

  // 文件树联动：mediaFocus 信号 → 打开对应条目灯箱
  const mediaFocus = useAppStore((s) => s.mediaFocus);
  useEffect(() => {
    if (mediaFocus === null || mediaFocus.projectId !== projectId) return;
    const idx = items.findIndex((m) => m.path === mediaFocus.path);
    if (idx >= 0) setLightboxIndex(idx);
    // eslint 树依赖只按 nonce 触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaFocus?.nonce, projectId, items]);

  const cellIcon = (kind: MediaItem['kind']): React.JSX.Element => {
    if (kind === 'video') return <VideoCameraOutlined style={{ fontSize: 32, opacity: 0.45 }} />;
    if (kind === 'audio') return <SoundOutlined style={{ fontSize: 32, opacity: 0.45 }} />;
    return <FileImageOutlined style={{ fontSize: 32, opacity: 0.45 }} />;
  };

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
      data-testid="media-tab"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 8 }}>
        <Segmented
          size="small"
          value={kindFilter}
          onChange={(v) => setKindFilter(v as KindFilter)}
          options={[
            { label: '全部', value: 'all' },
            { label: '图片', value: 'image' },
            { label: '视频', value: 'video' },
            { label: '音频', value: 'audio' },
          ]}
        />
        <Segmented
          size="small"
          value={density}
          onChange={(v) => setDensity(v as DensityKey)}
          options={[
            { label: '紧凑', value: 'compact' },
            { label: '标准', value: 'cozy' },
            { label: '大图', value: 'large' },
          ]}
        />
        <span style={{ fontSize: 12, opacity: 0.6 }}>
          {items.length} 个媒体文件
          {mediaQuery.data !== undefined && mediaQuery.data.length > items.length
            ? `（共 ${mediaQuery.data.length}）`
            : ''}
        </span>
        <span style={{ flex: 1 }} />
        <Button
          size="small"
          onClick={() => {
            void api.post(`/api/projects/${projectId}/analyze`);
          }}
        >
          重新分析
        </Button>
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 4 }}>
        {mediaQuery.isLoading ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: 32 }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="未发现媒体文件（图/音/视频）——刚放入的文件点「重新分析」后出现"
            />
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              if (row === undefined) return null;
              if (row.type === 'header') {
                return (
                  <div
                    key={vi.key}
                    ref={virtualizer.measureElement}
                    data-index={vi.index}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${vi.start}px)`,
                      fontSize: 12,
                      opacity: 0.65,
                      padding: '8px 2px 4px',
                    }}
                  >
                    {row.dir === '' ? '（根目录）' : row.dir}
                  </div>
                );
              }
              const cell = DENSITY_PX[density];
              const cols = Math.max(1, columnsFor(containerWidth, cell));
              return (
                <div
                  key={vi.key}
                  ref={virtualizer.measureElement}
                  data-index={vi.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vi.start}px)`,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${cols}, ${cell}px)`,
                    gap: 8,
                  }}
                >
                  {(row.items ?? []).map((it) => {
                    const st = thumbs.get(it.path);
                    const flatIndex = items.indexOf(it);
                    return (
                      <button
                        key={it.path}
                        type="button"
                        onClick={() => setLightboxIndex(flatIndex >= 0 ? flatIndex : 0)}
                        style={{
                          cursor: 'pointer',
                          border: `1px solid var(--tt-border)`,
                          borderRadius: 8,
                          padding: 0,
                          background: 'transparent',
                          textAlign: 'left',
                          overflow: 'hidden',
                        }}
                        title={`${it.path}（${KIND_LABEL[it.kind]} · ${fmtBytes(it.bytes)}）`}
                      >
                        <div
                          style={{
                            width: cell,
                            height: cell,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(128,128,128,.08)',
                          }}
                        >
                          {st === undefined || st.status === 'idle' || st.status === 'loading' ? (
                            <Spin size="small" />
                          ) : st.status === 'ready' && st.name !== undefined ? (
                            <img
                              src={thumbUrl(projectId, st.name)}
                              alt={it.path}
                              loading="lazy"
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            cellIcon(it.kind)
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            padding: '4px 6px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {it.path.slice(it.path.lastIndexOf('/') + 1)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {lightboxIndex !== null && (
        <Lightbox
          projectId={projectId}
          items={items}
          index={Math.min(lightboxIndex, Math.max(0, items.length - 1))}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          loop
        />
      )}
    </div>
  );
}
