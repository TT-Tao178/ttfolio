/** 媒体页签（FR-13.5 / T-099 + T-113 v2 + v3）：分组网格（react-virtual 行虚拟化）+
 * 灯箱（缩放平移/翻页/幻灯片/连播）+ 缩略图队列 v2（先查存在性索引直接出图，
 * 可视区优先生成两级 WebP；Electron 原生解码优先，失败诚实回退图标）。
 * v3 工具条（用户参考图）：F11 全屏、实时尺寸滑条、网格/双列/单列、统一/原比例。
 * 文件树媒体点击经 mediaFocus 信号直达灯箱。
 * FR-15.4 / T-145（2026-11-03）：主色 12 色桶筛选 + 灯箱「找相似」（aHash 汉明距离），
 * 派生数据渲染层从原图解码链渐进回填落库。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { App, Button, Empty, Segmented, Slider, Spin, Tag, Tooltip } from 'antd';
import {
  AppstoreOutlined,
  BlockOutlined,
  BorderOutlined,
  FileImageOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  SoundOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { api, thumbUrl } from '@/lib/api';
import { fmtBytes } from '@/lib/format';
import { useAppStore } from '@/app/store';
import type { MediaItem, ProjectDetail } from '@ttfolio/shared';
import {
  DEFAULT_MEDIA_VIEW,
  KIND_LABEL,
  MEDIA_SIZE_MAX,
  MEDIA_SIZE_MIN,
  MEDIA_VIEW_KEY,
  groupByFolder,
  layoutGeometry,
  parseMediaView,
  type MediaLayout,
  type MediaViewPrefs,
} from './mediaHelpers';
import { useThumbQueue } from './useThumbQueue';
import { Lightbox } from './Lightbox';
import { AutoScrollControl } from './AutoScrollControl';
import { COLOR_BUCKETS, COLOR_FILTER_THRESHOLD, computeDerivative, hammingDistance } from './mediaDerivative';

type KindFilter = 'all' | 'image' | 'video' | 'audio';

interface Row {
  type: 'header' | 'cells';
  dir: string;
  items?: MediaItem[];
}

function readViewPrefs(): MediaViewPrefs {
  try {
    return parseMediaView(localStorage.getItem(MEDIA_VIEW_KEY));
  } catch {
    return DEFAULT_MEDIA_VIEW;
  }
}

export function MediaTab({ projectId }: { projectId: string }): React.JSX.Element {
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [view, setView] = useState<MediaViewPrefs>(readViewPrefs);
  const [isFull, setIsFull] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // 视图偏好持久化（本地界面偏好，同自动滚动速度口径；不入索引库）
  useEffect(() => {
    try {
      localStorage.setItem(MEDIA_VIEW_KEY, JSON.stringify(view));
    } catch {
      /* 存储不可用不影响浏览 */
    }
  }, [view]);

  // F11 全屏（参考图工具条）：文档级全屏，Electron/浏览器一致
  const toggleFull = (): void => {
    if (document.fullscreenElement !== null) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  };
  useEffect(() => {
    const onFsChange = (): void => setIsFull(document.fullscreenElement !== null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F11') {
        e.preventDefault();
        toggleFull();
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const mediaQuery = useQuery({
    queryKey: ['media', projectId],
    queryFn: () => api.get<MediaItem[]>(`/api/projects/${projectId}/media`),
  });
  // 项目根路径供 Electron 原生解码（与 ProjectPage 共用 ['project'] 缓存）
  const { data: detail } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectDetail>(`/api/projects/${projectId}`),
  });
  const items = useMemo(() => {
    const all = mediaQuery.data ?? [];
    return kindFilter === 'all' ? all : all.filter((m) => m.kind === kindFilter);
  }, [mediaQuery.data, kindFilter]);

  // ---- FR-15.4 / T-145：派生数据渐进回填 + 主色筛选 + 找相似 ----
  const { message } = App.useApp();
  /** 本会话算出的派生数据（叠加在清单上；服务端已落库，刷新后从清单带出） */
  const [derivatives, setDerivatives] = useState<Map<string, MediaItem>>(new Map());
  const mergedItems = useMemo(() => items.map((m) => derivatives.get(m.path) ?? m), [items, derivatives]);
  const inflightRef = useRef<Set<string>>(new Set());
  const failedRef = useRef<Set<string>>(new Set());
  const dirPath = detail?.dirPath ?? '';
  // 渐进回填：清单加载后对无 phash 的图/视频并发 2 起算（音频无画面跳过）；
  // 失败 5 分钟内不再试（与缩略图队列同口径）；算完即 POST 落库 + 叠加本地
  useEffect(() => {
    if (!mediaQuery.isSuccess) return;
    const targets = mergedItems
      .filter(
        (m) =>
          m.phash === null &&
          m.kind !== 'audio' &&
          !inflightRef.current.has(m.path) &&
          !failedRef.current.has(m.path),
      )
      .slice(0, 2);
    for (const item of targets) {
      inflightRef.current.add(item.path);
      void computeDerivative(item, projectId, dirPath)
        .then(async (d) => {
          if (d === null) throw new Error('decode failed');
          await api.post(`/api/projects/${projectId}/media/derivative`, {
            path: item.path,
            phash: d.phash,
            colors: d.colors,
          });
          setDerivatives((prev) =>
            new Map(prev).set(item.path, { ...item, phash: d.phash, colors: d.colors }),
          );
        })
        .catch(() => {
          failedRef.current.add(item.path);
          setTimeout(() => failedRef.current.delete(item.path), 5 * 60_000);
        })
        .finally(() => {
          inflightRef.current.delete(item.path);
          // 触发回填 effect 再评估下一批（state 变化已驱动；失败项走 failedRef 静默）
          setDerivatives((prev) => new Map(prev));
        });
    }
  }, [mergedItems, mediaQuery.isSuccess, projectId, dirPath]);

  // 主色筛选（与类型筛选叠加）：该桶占比 ≥25% 视为主色命中；未回填条目不命中
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  // 找相似模式：基准路径 → 全库汉明距离（≤10 视为相似），网格按距离排序呈现
  const [similar, setSimilar] = useState<{
    base: string;
    baseName: string;
    dist: Map<string, number>;
  } | null>(null);
  const [findingSimilar, setFindingSimilar] = useState(false);

  const shownItems = useMemo(() => {
    let arr = mergedItems;
    if (colorFilter !== null) {
      arr = arr.filter((m) => (m.colors?.[colorFilter] ?? 0) >= COLOR_FILTER_THRESHOLD);
    }
    if (similar !== null) {
      arr = arr
        .filter((m) => similar.dist.has(m.path))
        .sort((x, y) => (similar.dist.get(x.path) ?? 99) - (similar.dist.get(y.path) ?? 99));
    }
    return arr;
  }, [mergedItems, colorFilter, similar]);

  /** 灯箱「找相似」：基准缺 phash 先补算（走同一回填链），再全库比对距离。 */
  const findSimilar = async (base: MediaItem): Promise<void> => {
    setFindingSimilar(true);
    try {
      let basePhash = base.phash;
      if (basePhash === null) {
        const d = await computeDerivative(base, projectId, dirPath);
        if (d === null) throw new Error('decode failed');
        basePhash = d.phash;
        await api.post(`/api/projects/${projectId}/media/derivative`, {
          path: base.path,
          phash: d.phash,
          colors: d.colors,
        });
        setDerivatives((prev) => new Map(prev).set(base.path, { ...base, phash: d.phash, colors: d.colors }));
      }
      const dist = new Map<string, number>();
      for (const m of mergedItems) {
        if (m.path === base.path || m.phash === null) continue;
        const d0 = hammingDistance(basePhash, m.phash);
        if (d0 <= 10) dist.set(m.path, d0);
      }
      if (dist.size === 0) {
        void message.info('未找到相似图（汉明距离 ≤10）——派生数据随浏览渐进回填，稍后再试');
        return;
      }
      setColorFilter(null);
      const baseName = base.path.slice(base.path.lastIndexOf('/') + 1);
      setSimilar({ base: base.path, baseName, dist });
    } catch {
      void message.error('相似检索失败（解码失败）');
    } finally {
      setFindingSimilar(false);
    }
  };

  // 布局几何：滑条/布局/容器宽度变化即时重排（拖动滑条实时生效）
  const geo = useMemo(
    () => layoutGeometry(view.layout, containerWidth, view.size),
    [view.layout, view.size, containerWidth],
  );

  const groups = useMemo(() => groupByFolder(shownItems), [shownItems]);
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const g of groups) {
      out.push({ type: 'header', dir: g.dir });
      for (let i = 0; i < g.items.length; i += geo.columns) {
        out.push({ type: 'cells', dir: g.dir, items: g.items.slice(i, i + geo.columns) });
      }
    }
    return out;
  }, [groups, geo.columns]);

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

  const rowHeight = geo.cellH + 34;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (i) => (rows[i]?.type === 'header' ? 34 : rowHeight),
    overscan: 6,
  });

  // 可视区（含 overscan）优先入队：虚拟化只渲染这些行，滚动即增量补齐
  const virtualRows = virtualizer.getVirtualItems();
  const visiblePaths = useMemo(() => {
    const set = new Set<string>();
    for (const vi of virtualRows) {
      const row = rows[vi.index];
      if (row?.type === 'cells') for (const it of row.items ?? []) set.add(it.path);
    }
    return set;
    // virtualRows 每次滚动都是新数组；用索引串作为稳定依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualRows.map((v) => v.index).join(','), rows]);

  const thumbs = useThumbQueue(projectId, detail?.dirPath ?? '', items, mediaQuery.isSuccess, visiblePaths);

  // 文件树联动：mediaFocus 信号 → 打开对应条目灯箱
  const mediaFocus = useAppStore((s) => s.mediaFocus);
  useEffect(() => {
    if (mediaFocus === null || mediaFocus.projectId !== projectId) return;
    const idx = shownItems.findIndex((m) => m.path === mediaFocus.path);
    if (idx >= 0) setLightboxIndex(idx);
    // eslint 树依赖只按 nonce 触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaFocus?.nonce, projectId, shownItems]);

  const cellIcon = (kind: MediaItem['kind'], size: number): React.JSX.Element => {
    const style = { fontSize: Math.max(20, Math.round(size / 4)), opacity: 0.45 };
    if (kind === 'video') return <VideoCameraOutlined style={style} />;
    if (kind === 'audio') return <SoundOutlined style={style} />;
    return <FileImageOutlined style={style} />;
  };

  const layoutOptions: Array<{ value: MediaLayout; label: React.ReactNode }> = [
    {
      value: 'grid',
      label: (
        <Tooltip title="网格">
          <AppstoreOutlined />
        </Tooltip>
      ),
    },
    {
      value: 'two',
      label: (
        <Tooltip title="双列">
          <BlockOutlined />
        </Tooltip>
      ),
    },
    {
      value: 'one',
      label: (
        <Tooltip title="单列">
          <BorderOutlined />
        </Tooltip>
      ),
    },
  ];

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
      data-testid="media-tab"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          paddingBottom: 8,
          flexWrap: 'wrap',
          rowGap: 6,
        }}
      >
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
        {/* FR-15.4 主色筛选：12 色桶色板（点击切换/再点清除），与类型筛选叠加 */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {COLOR_BUCKETS.map((b) => (
            <Tooltip key={b.id} title={`主色 · ${b.name}`}>
              <button
                type="button"
                onClick={() => setColorFilter((cur) => (cur === b.id ? null : b.id))}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  border: colorFilter === b.id ? '2px solid var(--tt-primary)' : '1px solid var(--tt-border)',
                  background: b.css,
                  cursor: 'pointer',
                  padding: 0,
                }}
                data-testid={`media-color-${b.id}`}
              />
            </Tooltip>
          ))}
        </span>
        {similar !== null && (
          <Tag
            closable
            onClose={() => setSimilar(null)}
            color="processing"
            data-testid="media-similar-banner"
          >
            找相似：与 {similar.baseName}（{similar.dist.size} 张）
          </Tag>
        )}
        <Button
          size="small"
          type="dashed"
          icon={isFull ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
          onClick={toggleFull}
          data-testid="media-fullscreen"
        >
          {isFull ? '退出全屏' : 'F11 全屏'}
        </Button>
        {/* 实时尺寸滑条（参考图）：拖动即改网格单元尺寸，不做防抖 */}
        <Tooltip title={view.layout === 'grid' ? '缩略图大小' : '缩略图大小（网格布局生效）'}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <AppstoreOutlined style={{ opacity: 0.65 }} />
            <Slider
              min={MEDIA_SIZE_MIN}
              max={MEDIA_SIZE_MAX}
              step={4}
              value={view.size}
              disabled={view.layout !== 'grid'}
              onChange={(v) => setView((prev) => ({ ...prev, size: v }))}
              tooltip={{ formatter: (v) => `${v ?? ''}px` }}
              style={{ width: 132, margin: '0 4px' }}
              data-testid="media-size-slider"
            />
          </span>
        </Tooltip>
        <Segmented
          size="small"
          value={view.layout}
          onChange={(v) => setView((prev) => ({ ...prev, layout: v as MediaLayout }))}
          options={layoutOptions.map((o) => ({ value: o.value, label: o.label }))}
          data-testid="media-layout"
        />
        <Segmented
          size="small"
          value={view.fit}
          onChange={(v) => setView((prev) => ({ ...prev, fit: v as MediaViewPrefs['fit'] }))}
          options={[
            { label: '统一', value: 'cover' },
            { label: '原比例', value: 'contain' },
          ]}
          data-testid="media-fit"
        />
        <AutoScrollControl targetRef={containerRef} />
        <span style={{ fontSize: 12, opacity: 0.6 }}>
          {shownItems.length} 个媒体文件
          {mediaQuery.data !== undefined && mediaQuery.data.length > shownItems.length
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
              const fill = view.layout !== 'grid';
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
                    gridTemplateColumns: fill
                      ? `repeat(${geo.columns}, minmax(0, 1fr))`
                      : `repeat(${geo.columns}, ${geo.cellW}px)`,
                    gap: 8,
                  }}
                >
                  {(row.items ?? []).map((it) => {
                    const st = thumbs.states.get(it.path);
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
                          minWidth: 0,
                        }}
                        title={`${it.path}（${KIND_LABEL[it.kind]} · ${fmtBytes(it.bytes)}）`}
                      >
                        <div
                          style={{
                            width: '100%',
                            height: geo.cellH,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(128,128,128,.08)',
                          }}
                        >
                          {st?.g !== undefined ? (
                            <img
                              src={thumbUrl(projectId, st.g, it.mtime)}
                              alt={it.path}
                              loading="lazy"
                              decoding="async"
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: view.fit === 'cover' ? 'cover' : 'contain',
                              }}
                            />
                          ) : st?.status === 'failed' ? (
                            cellIcon(it.kind, geo.cellH)
                          ) : (
                            <Spin size="small" />
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
          index={Math.min(lightboxIndex, Math.max(0, shownItems.length - 1))}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          loop
          thumbs={thumbs.states}
          requestPreview={thumbs.requestPreview}
          onFindSimilar={(item) => void findSimilar(item)}
          findingSimilar={findingSimilar}
        />
      )}
    </div>
  );
}
