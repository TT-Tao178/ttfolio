/** 动态页签（FR-13.2 v2 / T-111）：变更流水落库可回读；左栏按 burst 分组 + 来源徽标，
 *  右栏跟随最新 / 当前内容 / 与基线差异（基线 = 手动「设基线」时的 git HEAD）。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Empty, Segmented, Switch, Tag, Tooltip } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  VerticalAlignBottomOutlined,
} from '@ant-design/icons';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { api } from '@/lib/api';
import type { FileContent, GitDiff, GitLogEntry, ProjectDetail } from '@ttfolio/shared';
import { cmTheme, cmHighlight } from '@/theme/codemirror';
import { langExtension } from '@/features/files/langExt';
import { ImagePreview } from '@/features/files/ImagePreview';
import { DiffView } from '@/features/git/DiffView';
import { useSettings } from '@/app/settings';
import { useSettingsDark } from '@/features/files/useDark';
import { SEMANTIC } from '@/theme/tokens';
import { useLiveEvents, type ChangeEventInfo, type ChangeSource } from './liveStore';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];
/** 「正在写入」窗口：最后一次变更在该窗口内时当前文件短轮询刷新。 */
const WRITING_WINDOW_MS = 10_000;

const SOURCE_META: Record<ChangeSource, { label: string; color: string | undefined }> = {
  watcher: { label: '外部', color: 'default' },
  api: { label: '本应用', color: 'processing' },
  agent: { label: 'agent', color: 'purple' },
  other: { label: '外部', color: 'default' },
};

function extOf(p: string): string {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

function splitPath(p: string): { dir: string; base: string } {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? { dir: p.slice(0, idx + 1), base: p.slice(idx + 1) } : { dir: '', base: p };
}

/** 完整相对路径：目录段灰显、过长时从左侧截断（保住文件名），文件名加重——
 *  与文件树的路径观感一致（用户反馈：动态页要能看清改的是哪个文件）。 */
function LivePath({ path, style }: { path: string; style?: React.CSSProperties }): React.JSX.Element {
  const { dir, base } = splitPath(path);
  return (
    <span className="tt-mono tt-live-path" style={style} title={path}>
      {dir !== '' && <span className="tt-live-dir">{dir}</span>}
      <span className="tt-live-base">{base}</span>
    </span>
  );
}

interface Burst {
  burstId: string;
  items: ChangeEventInfo[];
  lastAt: string;
}

/** 连续同 burstId 的事件归一组（升序输入）。 */
export function groupBursts(events: ChangeEventInfo[]): Burst[] {
  const out: Burst[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last !== undefined && last.burstId === e.burstId) {
      last.items.push(e);
      last.lastAt = e.lastAt;
    } else {
      out.push({ burstId: e.burstId, items: [e], lastAt: e.lastAt });
    }
  }
  return out;
}

export function AgentLiveTab({ projectId }: { projectId: string }): React.JSX.Element {
  const dark = useSettingsDark();
  const { message } = App.useApp();
  const { data: p } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectDetail>(`/api/projects/${projectId}`),
  });
  const isRepo = p?.gitIsRepo === true;

  const events = useLiveEvents(projectId);
  const bursts = useMemo(() => groupBursts(events), [events]);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'content' | 'diff'>('content');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => (selectedSeq === null ? null : (events.find((e) => e.seq === selectedSeq) ?? null)),
    [events, selectedSeq],
  );
  const latest = events[events.length - 1] ?? null;

  // 跟随最新：贴着底部，新事件到达自动滚到底（手动点条目即钉住，不再抢焦点）
  useEffect(() => {
    if (!follow) return;
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [follow, events.length]);

  // 跟随时自动打开最新变更的文件（用户需求：点开动态页就能旁观 agent 干活）——
  // 右栏查看器自动选中最新事件；「正在写入」窗口内 250ms 短轮询让内容持续刷新。
  // 点条目即钉住（follow=false 停止抢焦点），重新打开开关即跳回最新。
  useEffect(() => {
    if (!follow) return;
    const cand = events[events.length - 1];
    if (cand === undefined) return;
    setSelectedSeq((cur) => (cur === cand.seq ? cur : cand.seq));
  }, [follow, events]);

  const setBaselineToHead = (): void => {
    if (!isRepo) {
      void message.info('非 git 项目：可看当前内容，无法建立 diff 基线');
      return;
    }
    void api
      .get<GitLogEntry[]>(`/api/git/${projectId}/log?limit=1`)
      .then((log) => {
        const head = log[0]?.hash ?? null;
        setBaseline(head);
        void message.success(head === null ? '仓库还没有提交，暂无基线' : `基线已设为 ${head.slice(0, 7)}`);
      })
      .catch(() => void message.error('读取 git HEAD 失败'));
  };

  // 正在写入：当前文件最近变更在 10 秒窗口内 → 250ms 轮询刷新（其余走事件）
  const writing =
    selected !== null &&
    Date.now() - Date.parse(selected.lastAt) < WRITING_WINDOW_MS &&
    selected.kind !== 'delete';

  const fileQuery = useQuery({
    queryKey: ['agent-live-file', projectId, selected?.path ?? ''],
    queryFn: () =>
      api.get<FileContent>(
        `/api/fs/file?projectId=${projectId}&path=${encodeURIComponent(selected?.path ?? '')}`,
      ),
    enabled: selected !== null && selected.kind !== 'delete' && viewMode === 'content',
    refetchInterval: writing ? 250 : false,
  });
  const diffQuery = useQuery({
    queryKey: ['agent-live-diff', projectId, selected?.path ?? '', baseline],
    queryFn: () =>
      api.get<GitDiff>(
        `/api/git/${projectId}/diff?path=${encodeURIComponent(selected?.path ?? '')}&ref=${baseline ?? ''}`,
      ),
    enabled: selected !== null && isRepo && baseline !== null && viewMode === 'diff',
  });

  const kindIcon = (e: ChangeEventInfo): React.JSX.Element => {
    if (e.kind === 'create') return <PlusOutlined style={{ color: '#52c41a' }} />;
    if (e.kind === 'delete') return <DeleteOutlined style={{ color: '#ff4d4f' }} />;
    return <EditOutlined style={{ color: '#1677ff' }} />;
  };
  const kindText = (e: ChangeEventInfo): string =>
    e.kind === 'create' ? '新增' : e.kind === 'delete' ? '删除' : '修改';
  const diffAvailable = isRepo && baseline !== null;

  return (
    <div style={{ display: 'flex', gap: 8, height: '100%', minHeight: 0 }} data-testid="agent-live">
      {/* 左：变更流水（库内回读 + 实时追加） */}
      <div
        style={{
          width: 400,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          border: SEMANTIC.border,
          borderRadius: 8,
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderBottom: SEMANTIC.border,
          }}
        >
          <Button
            size="small"
            icon={<PlayCircleOutlined />}
            onClick={setBaselineToHead}
            disabled={!isRepo}
            data-testid="agent-live-baseline"
          >
            设基线
          </Button>
          <span style={{ fontSize: 12, opacity: 0.65 }}>{events.length} 条 · 已落库（保留 7 天）</span>
          <span style={{ flex: 1 }} />
          <Tooltip title="跟随最新：自动滚动到最新变更并打开对应文件（点条目即钉住）">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <VerticalAlignBottomOutlined />
              <Switch
                size="small"
                checked={follow}
                onChange={(v) => setFollow(v)}
                data-testid="agent-live-follow"
              />
            </span>
          </Tooltip>
        </div>
        <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {events.length === 0 ? (
            <div style={{ padding: 24 }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无变更：外部编辑器/终端改文件、或在 ttFolio 里新建改名删除后，都会记录在这里"
              />
            </div>
          ) : (
            <div data-testid="agent-live-stream">
              {bursts.map((b) => {
                const first = b.items[0];
                const src = SOURCE_META[first?.source ?? 'other'];
                return (
                  <div key={b.burstId} style={{ borderBottom: '1px solid rgba(128,128,128,0.12)' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 10px',
                        fontSize: 11,
                        opacity: 0.6,
                      }}
                    >
                      <span>{timeOf(b.lastAt)}</span>
                      <Tag style={{ fontSize: 10, marginInlineEnd: 0 }} color={src.color}>
                        {src.label}
                      </Tag>
                      <span>{b.items.length} 个文件</span>
                    </div>
                    {b.items.map((e) => (
                      <div
                        key={e.seq}
                        onClick={() => {
                          setSelectedSeq(e.seq);
                          setViewMode('content');
                          setFollow(false);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '4px 10px 4px 18px',
                          fontSize: 12,
                          cursor: 'pointer',
                          background: selectedSeq === e.seq ? SEMANTIC.primaryBg : undefined,
                        }}
                      >
                        <Tooltip title={kindText(e)}>{kindIcon(e)}</Tooltip>
                        <LivePath path={e.path} style={{ flex: 1 }} />
                        {e.changeCount > 1 && (
                          <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>×{e.changeCount}</Tag>
                        )}
                        <span style={{ opacity: 0.55, fontVariantNumeric: 'tabular-nums' }}>
                          {timeOf(e.lastAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 右：内容查看器 */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          border: SEMANTIC.border,
          borderRadius: 8,
          minHeight: 0,
        }}
      >
        {selected === null ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                latest === null ? '等待文件变更' : '打开「跟随最新」自动旁观文件变化，或点左侧条目查看'
              }
            />
            {latest !== null && (
              <Button
                size="small"
                onClick={() => {
                  setSelectedSeq(latest.seq);
                  setFollow(true);
                }}
              >
                看最新一条
              </Button>
            )}
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '6px 10px',
                borderBottom: SEMANTIC.border,
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  overflow: 'hidden',
                  minWidth: 0,
                  fontSize: 12,
                }}
              >
                {kindIcon(selected)}
                <LivePath path={selected.path} />
              </span>
              {writing && (
                <Tag color="processing" style={{ fontSize: 10 }}>
                  正在写入…
                </Tag>
              )}
              <span style={{ flex: 1 }} />
              <Segmented
                size="small"
                value={viewMode}
                onChange={(v) => setViewMode(v as 'content' | 'diff')}
                options={
                  diffAvailable
                    ? [
                        { label: '当前内容', value: 'content' },
                        { label: '与基线 diff', value: 'diff' },
                      ]
                    : [{ label: '当前内容', value: 'content' }]
                }
              />
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {viewMode === 'diff' && diffAvailable ? (
                diffQuery.isLoading ? (
                  <div style={{ padding: 16, opacity: 0.6, fontSize: 12 }}>加载 diff…</div>
                ) : diffQuery.data !== undefined ? (
                  <DiffView patch={diffQuery.data.patch} truncated={diffQuery.data.truncated} />
                ) : (
                  <div style={{ padding: 16, opacity: 0.6, fontSize: 12 }}>
                    暂无 diff（基线之后无改动，或取差异失败）
                  </div>
                )
              ) : viewMode === 'diff' ? (
                <Alert
                  style={{ margin: 16 }}
                  type="info"
                  showIcon
                  message="需要 git 仓库与基线"
                  description="点上方「设基线」以当前 git HEAD 为 diff 基线；非 git 项目只能查看当前内容。"
                />
              ) : selected.kind === 'delete' ? (
                <Alert
                  style={{ margin: 16 }}
                  type="warning"
                  showIcon
                  message="该文件已被删除（墓碑）"
                  description={diffAvailable ? '可切到「与基线 diff」查看删除前后的差异。' : undefined}
                />
              ) : (
                <LiveFileView projectId={projectId} entry={selected} query={fileQuery} dark={dark} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LiveFileView({
  projectId,
  entry,
  query,
  dark,
}: {
  projectId: string;
  entry: ChangeEventInfo;
  query: { isLoading: boolean; data?: FileContent };
  dark: boolean;
}): React.JSX.Element {
  if (query.isLoading) return <div style={{ padding: 16, opacity: 0.6, fontSize: 12 }}>加载内容…</div>;
  const fc = query.data;
  if (fc === undefined) {
    return (
      <div style={{ padding: 16, opacity: 0.6, fontSize: 12 }}>
        暂无内容（文件可能刚被再次改动，稍候自动刷新）
      </div>
    );
  }
  if (fc.isBinary) {
    if (IMAGE_EXT.includes(extOf(entry.path))) {
      return <ImagePreview projectId={projectId} path={entry.path} />;
    }
    return (
      <Alert
        style={{ margin: 16 }}
        type="info"
        showIcon
        message="二进制文件不支持内嵌预览"
        description="可在「文件」页签用外部程序打开。"
      />
    );
  }
  return (
    <>
      {fc.truncated && (
        <Alert type="warning" message="文件过大，仅显示前一部分" style={{ margin: '8px 10px 0' }} />
      )}
      <ReadOnlyCode path={entry.path} content={fc.content} dark={dark} />
    </>
  );
}

/** 只读 CodeMirror 视图：与编辑器共用 cmTheme/cmHighlight 与语言包（FR-13.4 一致性）。 */
function ReadOnlyCode({
  path,
  content,
  dark,
}: {
  path: string;
  content: string;
  dark: boolean;
}): React.JSX.Element {
  const { settings } = useSettings();
  const scheme = settings.syntaxScheme;
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hostRef.current === null) return undefined;
    const view = new EditorView({
      doc: content,
      extensions: [
        langExtension(path),
        cmTheme(dark),
        cmHighlight(dark, scheme),
        EditorView.lineWrapping,
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
      ],
      parent: hostRef.current,
    });
    return () => view.destroy();
  }, [path, content, dark, scheme]);
  return (
    <div
      ref={hostRef}
      className="tt-mono"
      style={{ height: '100%', overflow: 'auto', fontSize: 12 }}
      data-testid="agent-live-code"
    />
  );
}
