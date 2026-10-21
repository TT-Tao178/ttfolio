/** 动态页签（FR-13.2 / T-096）：左「变更文件流」（fs.changed 实时插入，会话级内存，
 * 窗口上限 500）+ 右「内容查看器」（文本只读 CodeMirror / 图片内嵌预览）。
 * 「记录」开启时以当前 git HEAD 为基线，条目可切「与基线 diff」（复用 diff 路由
 * 的 ref 参数与 DiffView）；非 git 项目诚实只显示当前内容。不新建表、不落库，
 * 刷新即失——持久化沉淀属 T-097 资源仓库。 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Empty, Segmented, Tooltip } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ClearOutlined,
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
import { subscribeSseEvents } from '@/app/sse';
import { SEMANTIC } from '@/theme/tokens';
import { applyFsChanged, changedRelPaths, type LiveEntry } from './liveStream';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];

function extOf(p: string): string {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function timeOf(ms: number): string {
  const d = new Date(ms);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

export function AgentLiveTab({ projectId }: { projectId: string }): React.JSX.Element {
  const dark = useSettingsDark();
  const { message } = App.useApp();
  const { data: p } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectDetail>(`/api/projects/${projectId}`),
  });
  const dirPath = p?.dirPath ?? '';
  const isRepo = p?.gitIsRepo === true;

  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const [selected, setSelected] = useState<LiveEntry | null>(null);
  const [recording, setRecording] = useState(false);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'content' | 'diff'>('content');
  const [refreshTick, setRefreshTick] = useState(0);
  const idRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 订阅 fs.changed：插入文件流 + 正在查看的文件再变更时防抖刷新（500ms）
  useEffect(() => {
    const off = subscribeSseEvents((evt) => {
      if (evt.event !== 'fs.changed') return;
      if (evt.data['projectId'] !== projectId) return;
      setEntries((prev) => applyFsChanged(prev, evt.data, dirPath, Date.now(), () => ++idRef.current));
      setSelected((cur) => {
        if (cur !== null && changedRelPaths(evt.data, dirPath).has(cur.relPath)) {
          if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = setTimeout(() => setRefreshTick((t) => t + 1), 500);
        }
        return cur;
      });
    });
    return () => {
      off();
      if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
    };
  }, [projectId, dirPath]);

  const toggleRecord = (): void => {
    if (recording) {
      setRecording(false);
      setBaseline(null);
      return;
    }
    setRecording(true);
    if (!isRepo) {
      void message.info('非 git 项目：只记录文件流，无法建立 diff 基线');
      return;
    }
    void api
      .get<GitLogEntry[]>(`/api/git/${projectId}/log?limit=1`)
      .then((log) => {
        const head = log[0]?.hash ?? null;
        setBaseline(head);
        if (head === null) void message.info('仓库还没有提交，暂无 diff 基线');
      })
      .catch(() => {
        /* 基线拿不到不影响流记录（诚实降级：diff 不可用） */
      });
  };

  // 当前内容（删除的文件没有「当前」）
  const fileQuery = useQuery({
    queryKey: ['agent-live-file', projectId, selected?.relPath ?? '', refreshTick],
    queryFn: () =>
      api.get<FileContent>(
        `/api/fs/file?projectId=${projectId}&path=${encodeURIComponent(selected?.relPath ?? '')}`,
      ),
    enabled: selected !== null && selected.kind !== 'delete' && viewMode === 'content',
  });
  // 与基线 diff（复用既有 diff 路由的 ref 参数）
  const diffQuery = useQuery({
    queryKey: ['agent-live-diff', projectId, selected?.relPath ?? '', baseline],
    queryFn: () =>
      api.get<GitDiff>(
        `/api/git/${projectId}/diff?path=${encodeURIComponent(selected?.relPath ?? '')}&ref=${baseline ?? ''}`,
      ),
    enabled: selected !== null && isRepo && baseline !== null && viewMode === 'diff',
  });

  const kindIcon = (e: LiveEntry): React.JSX.Element => {
    if (e.kind === 'create') return <PlusOutlined style={{ color: '#52c41a' }} />;
    if (e.kind === 'delete') return <DeleteOutlined style={{ color: '#ff4d4f' }} />;
    return <EditOutlined style={{ color: '#1677ff' }} />;
  };
  const kindText = (e: LiveEntry): string =>
    e.kind === 'create' ? '新增' : e.kind === 'delete' ? '删除' : '修改';
  const diffAvailable = isRepo && baseline !== null;

  return (
    <div style={{ display: 'flex', gap: 8, height: '100%', minHeight: 0 }} data-testid="agent-live">
      {/* 左：变更文件流 */}
      <div
        style={{
          width: 380,
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
            type={recording ? 'primary' : 'default'}
            icon={recording ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={toggleRecord}
            data-testid="agent-live-record"
          >
            {recording ? '记录中' : '记录'}
          </Button>
          <span style={{ fontSize: 12, opacity: 0.65 }}>{entries.length} 条 · 会话级（刷新即清）</span>
          <span style={{ flex: 1 }} />
          <Button
            size="small"
            icon={<ClearOutlined />}
            disabled={entries.length === 0}
            onClick={() => {
              setEntries([]);
              setSelected(null);
            }}
          />
        </div>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {entries.length === 0 ? (
            <div style={{ padding: 24 }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="等待文件变更：在外部编辑器或 agent 改动该项目后，变更会实时出现在这里"
              />
            </div>
          ) : (
            <div data-testid="agent-live-stream">
              {entries.map((e) => (
                <div
                  key={e.id}
                  onClick={() => {
                    setSelected(e);
                    setViewMode('content');
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 10px',
                    fontSize: 12,
                    cursor: 'pointer',
                    background: selected?.id === e.id ? SEMANTIC.primaryBg : undefined,
                  }}
                >
                  <Tooltip title={kindText(e)}>{kindIcon(e)}</Tooltip>
                  <span
                    className="tt-mono"
                    style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={e.relPath}
                  >
                    {e.relPath}
                  </span>
                  {/* actor 预留列（FR-13.2）：fs.changed 暂无来源信息，诚实显示占位 */}
                  <span style={{ opacity: 0.45 }} title="操作来源（预留）">
                    —
                  </span>
                  <span style={{ opacity: 0.55, fontVariantNumeric: 'tabular-nums' }}>{timeOf(e.at)}</span>
                </div>
              ))}
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
              description="点击左侧条目查看文件内容或与基线的差异"
            />
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
                className="tt-mono"
                style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={selected.relPath}
              >
                {kindIcon(selected)} {selected.relPath}
              </span>
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
                  message="需要 git 仓库与已记录的基线"
                  description="点上方「记录」开启记录：将以当前 git HEAD 为 diff 基线；非 git 项目只能查看当前内容。"
                />
              ) : selected.kind === 'delete' ? (
                <Alert
                  style={{ margin: 16 }}
                  type="warning"
                  showIcon
                  message="该文件已被删除"
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
  entry: LiveEntry;
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
    if (IMAGE_EXT.includes(extOf(entry.relPath))) {
      return <ImagePreview projectId={projectId} path={entry.relPath} />;
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
      <ReadOnlyCode path={entry.relPath} content={fc.content} dark={dark} />
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
