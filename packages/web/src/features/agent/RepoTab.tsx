/** 资源仓库页签（FR-13.3 v2 / T-112）：①记录控制+首启确认+项目速览 ②会话时间线
 * （自动/手动、摘要来源、修改文件清单、可选快照「与首次变更对比」）③精华摘要。 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Collapse,
  Descriptions,
  Empty,
  Modal,
  Form,
  Input,
  Spin,
  Tag,
  Timeline,
  App,
} from 'antd';
import { CaretRightOutlined, PauseOutlined, EditOutlined, DiffOutlined } from '@ant-design/icons';
import { api, ApiClientError } from '@/lib/api';
import type { AgentRepoMode, AgentRepoSession, AgentRepoSessionFile, ProjectDetail } from '@ttfolio/shared';
import { relTime } from '@/lib/format';
import { typeLabel } from '@/components/DetailPanel';
import { SEMANTIC } from '@/theme/tokens';
import { useSettings } from '@/app/settings';
import { alignLines } from '@/features/compare/compareShared';

interface SessionsResponse {
  enabled: boolean;
  mode: AgentRepoMode;
  globalMode: 'on' | 'off';
  active: AgentRepoSession | null;
  sessions: AgentRepoSession[];
}

export function RepoTab({ projectId }: { projectId: string }): React.JSX.Element {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { settings, setSetting } = useSettings();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AgentRepoSession | null>(null);
  const [snapshotView, setSnapshotView] = useState<{ file: AgentRepoSessionFile } | null>(null);

  const { data: p } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectDetail>(`/api/projects/${projectId}`),
  });
  const sessionsQuery = useQuery({
    queryKey: ['agent-sessions', projectId],
    queryFn: () => api.get<SessionsResponse>(`/api/agent/projects/${projectId}/sessions`),
  });
  const filesQuery = useQuery({
    queryKey: ['agent-session-files', expandedId],
    queryFn: () => api.get<AgentRepoSessionFile[]>(`/api/agent/sessions/${expandedId ?? ''}/files`),
    enabled: expandedId !== null,
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['agent-sessions', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['agent-session-files'] });
  };

  const startMut = useMutation({
    mutationFn: () => api.post(`/api/agent/projects/${projectId}/sessions`, {}),
    onSuccess: () => {
      void message.success('已开始记录：文件变更将沉淀进本次会话');
      refresh();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '开启失败'),
  });
  const modeMut = useMutation({
    mutationFn: (mode: AgentRepoMode | null) => api.patch(`/api/agent/projects/${projectId}/mode`, { mode }),
    onSuccess: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      void message.success('记录设置已保存');
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '保存失败'),
  });
  const stopMut = useMutation({
    mutationFn: (sessionId: string) => api.post(`/api/agent/sessions/${sessionId}/stop`, {}),
    onSuccess: () => {
      void message.success('已结束记录');
      refresh();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '结束失败'),
  });

  const active = sessionsQuery.data?.active ?? null;
  const sessions = sessionsQuery.data?.sessions ?? [];
  const enabled = sessionsQuery.data?.enabled ?? false;
  const mode = sessionsQuery.data?.mode ?? 'follow';

  return (
    <div style={{ height: '100%', overflow: 'auto', paddingRight: 4 }} data-testid="agent-repo">
      {/* 首次进入确认（FR-13.3 v2：一次性，此后新项目自动继承） */}
      {settings.agentRepoConfirmed !== true && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="资源仓库默认记录：确认一次即可"
          description="开启后，文件变更会按编辑会话自动沉淀（只记路径、时间与计数，不复制内容；可选快照默认关）。会话空闲 15 分钟或跨天自动结束，并生成一份不含 AI 的自动摘要。"
          action={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  setSetting('agentRepoMode', 'on');
                  setSetting('agentRepoConfirmed', true);
                }}
                data-testid="repo-confirm-on"
              >
                开启记录
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setSetting('agentRepoMode', 'off');
                  setSetting('agentRepoConfirmed', true);
                }}
                data-testid="repo-confirm-off"
              >
                暂时关闭
              </Button>
              <Button size="small" type="text" onClick={() => setSetting('agentRepoConfirmed', true)}>
                稍后决定
              </Button>
            </div>
          }
        />
      )}
      {/* ① 记录控制 + 项目速览 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          border: `1px solid ${SEMANTIC.border}`,
          borderRadius: 8,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        {active === null ? (
          <>
            <Button
              size="small"
              type="primary"
              icon={<CaretRightOutlined />}
              loading={startMut.isPending}
              onClick={() => startMut.mutate()}
              data-testid="repo-start"
            >
              手动开始一段
            </Button>
            <span style={{ fontSize: 12, opacity: 0.65 }}>
              {enabled
                ? '记录已开启：下一次文件变更会自动开一段会话；也可手动开始'
                : '当前关闭：到「概览 → 项目属性 → 资源仓库」改为跟随全局/强制开'}
            </span>
          </>
        ) : (
          <>
            <Button
              size="small"
              danger
              icon={<PauseOutlined />}
              loading={stopMut.isPending}
              onClick={() => stopMut.mutate(active.id)}
              data-testid="repo-stop"
            >
              结束本段（里程碑）
            </Button>
            <span style={{ fontSize: 12, opacity: 0.65 }}>
              {active.auto === true ? '自动记录中' : '记录中'} · 开始于 {relTime(active.startedAt)} · 已记录{' '}
              {active.fileCount} 个文件
            </span>
            <span style={{ flex: 1 }} />
            <Tag style={{ fontSize: 10 }}>
              模式：{mode === 'follow' ? '跟随全局' : mode === 'on' ? '强制开' : '强制关'}
            </Tag>
            {mode !== 'follow' && (
              <Button size="small" type="text" onClick={() => modeMut.mutate(null)}>
                恢复跟随全局
              </Button>
            )}
          </>
        )}
      </div>
      {p !== undefined && (
        <Descriptions title="项目速览" column={2} size="small" bordered style={{ marginBottom: 16 }}>
          <Descriptions.Item label="项目">{p.alias ?? p.diskName}</Descriptions.Item>
          <Descriptions.Item label="类型">{typeLabel(p.type)}</Descriptions.Item>
          <Descriptions.Item label="主语言">{p.primaryLanguage ?? '未分析'}</Descriptions.Item>
          <Descriptions.Item label="Git">
            {p.gitIsRepo ? `${p.gitBranch ?? '—'}${p.gitDirty ? '（有未提交改动）' : ''}` : '非 git 仓库'}
          </Descriptions.Item>
          <Descriptions.Item label="标签">{p.tags.length === 0 ? '—' : p.tags.join('、')}</Descriptions.Item>
          <Descriptions.Item label="备注">{p.notes ?? '—'}</Descriptions.Item>
        </Descriptions>
      )}

      {/* ② 会话时间线 + ③ 精华摘要 */}
      {sessionsQuery.isLoading ? (
        <Spin />
      ) : sessions.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有会话：点上方「开始记录」沉淀第一段编辑会话"
        />
      ) : (
        <Timeline
          items={sessions.map((s) => ({
            color: s.endedAt === null ? 'green' : 'gray',
            children: (
              <div style={{ paddingBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong>{s.title ?? '未命名会话'}</strong>
                  {s.auto === true && <Tag color="cyan">自动</Tag>}
                  {s.summarySource === 'auto' && <Tag color="default">摘要·自动</Tag>}
                  {s.summarySource === 'user' && <Tag color="blue">摘要·手动</Tag>}
                  {s.summarySource === 'agent' && <Tag color="purple">摘要·agent</Tag>}
                  {s.actor !== null && s.actor !== 'local' && <Tag color="purple">{s.actor}</Tag>}
                  <span style={{ fontSize: 12, opacity: 0.65 }}>
                    {relTime(s.startedAt)}
                    {s.endedAt === null ? ' · 进行中' : ` → ${relTime(s.endedAt)}`} · {s.fileCount} 个文件
                  </span>
                  <span style={{ flex: 1 }} />
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => setEditing(s)}
                    data-testid={`repo-edit-${s.id}`}
                  >
                    标题 / 精华
                  </Button>
                </div>
                {s.summary !== null && (
                  <div
                    style={{
                      fontSize: 12,
                      marginTop: 6,
                      padding: '6px 10px',
                      background: SEMANTIC.containerBg,
                      borderRadius: 6,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {s.summary}
                  </div>
                )}
                <Collapse
                  ghost
                  size="small"
                  style={{ marginTop: 4 }}
                  items={[
                    {
                      key: s.id,
                      label: `修改文件清单（${s.fileCount}）`,
                      children:
                        expandedId === s.id ? (
                          filesQuery.isLoading ? (
                            <Spin size="small" />
                          ) : (filesQuery.data ?? []).length === 0 ? (
                            <span style={{ fontSize: 12, opacity: 0.6 }}>该会话没有记录到文件变更</span>
                          ) : (
                            <div>
                              {(filesQuery.data ?? []).map((f) => (
                                <div
                                  key={f.path}
                                  className="tt-mono"
                                  style={{ fontSize: 12, display: 'flex', gap: 8, padding: '2px 0' }}
                                >
                                  <span
                                    style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}
                                    title={f.path}
                                  >
                                    {f.path}
                                  </span>
                                  <span style={{ opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>
                                    ×{f.changeCount} · {relTime(f.lastSeenAt)}
                                  </span>
                                  {f.firstSha !== null &&
                                    f.firstSha !== undefined &&
                                    f.latestSha !== null &&
                                    f.latestSha !== undefined &&
                                    f.firstSha !== f.latestSha && (
                                      <Button
                                        size="small"
                                        type="link"
                                        icon={<DiffOutlined />}
                                        style={{ padding: 0, height: 'auto' }}
                                        onClick={() => setSnapshotView({ file: f })}
                                      >
                                        与首次变更对比
                                      </Button>
                                    )}
                                </div>
                              ))}
                            </div>
                          )
                        ) : null,
                    },
                  ]}
                  onChange={(keys) => setExpandedId(keys.length > 0 ? s.id : null)}
                  activeKey={expandedId === s.id ? [s.id] : []}
                />
              </div>
            ),
          }))}
        />
      )}

      <EditSessionModal
        session={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />
      {snapshotView !== null && (
        <SnapshotDiffModal
          projectId={projectId}
          file={snapshotView.file}
          onClose={() => setSnapshotView(null)}
        />
      )}
    </div>
  );
}

/** 可选快照层对比（FR-13.3 v2）：会话内首次变更 vs 最新快照（非 git 项目也能看改动）。 */
function SnapshotDiffModal({
  projectId,
  file,
  onClose,
}: {
  projectId: string;
  file: AgentRepoSessionFile;
  onClose: () => void;
}): React.JSX.Element {
  const firstSha = file.firstSha ?? '';
  const latestSha = file.latestSha ?? '';
  const first = useQuery({
    queryKey: ['agent-snapshot', projectId, firstSha],
    queryFn: () => api.get<{ content: string }>(`/api/agent/snapshots/${projectId}/${firstSha}`),
  });
  const latest = useQuery({
    queryKey: ['agent-snapshot', projectId, latestSha],
    queryFn: () => api.get<{ content: string }>(`/api/agent/snapshots/${projectId}/${latestSha}`),
  });
  const rows =
    first.data !== undefined && latest.data !== undefined
      ? alignLines(first.data.content.split('\n'), latest.data.content.split('\n'))
      : null;
  return (
    <Modal
      title={`与首次变更对比：${file.path}`}
      open
      onCancel={onClose}
      footer={null}
      width={880}
      data-testid="repo-snapshot-diff"
    >
      <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
        左 = 本会话首次变更后 · 右 = 最近一次（内容寻址快照，存于索引数据目录，不写项目目录）
      </div>
      {first.isLoading || latest.isLoading ? (
        <Spin />
      ) : rows === null ? (
        <Alert type="warning" message="快照读取失败（可能已过期清理）" />
      ) : (
        <div
          className="tt-mono"
          style={{ fontSize: 12, lineHeight: 1.5, maxHeight: '60vh', overflow: 'auto' }}
        >
          {rows.rows.map((r, i) => {
            const cls = !r.same
              ? r.right === null
                ? 'tt-diff-del'
                : r.left === null
                  ? 'tt-diff-add'
                  : 'tt-diff-chg'
              : '';
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                <div
                  className={cls}
                  style={{ padding: '0 6px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                >
                  {r.left ?? ' '}
                </div>
                <div
                  className={cls}
                  style={{
                    padding: '0 6px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    borderInlineStart: `1px solid ${SEMANTIC.split}`,
                  }}
                >
                  {r.right ?? ' '}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function EditSessionModal({
  session,
  onClose,
  onSaved,
}: {
  session: AgentRepoSession | null;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const { message } = App.useApp();
  const patch = useMutation({
    mutationFn: (body: { title?: string; summary?: string }) =>
      api.patch(`/api/agent/sessions/${session?.id ?? ''}`, body),
    onSuccess: () => {
      void message.success('已保存');
      onSaved();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '保存失败'),
  });
  return (
    <Modal
      title="编辑会话标题与精华摘要"
      open={session !== null}
      destroyOnClose
      onCancel={onClose}
      confirmLoading={patch.isPending}
      onOk={() => {
        const sid = session?.id ?? '';
        const title = (document.getElementById(`repo-title-${sid}`) as HTMLInputElement | null)?.value;
        const summary = (document.getElementById(`repo-summary-${sid}`) as HTMLTextAreaElement | null)?.value;
        const body: { title?: string; summary?: string } = {};
        if (title !== undefined && title !== (session?.title ?? '')) body.title = title;
        if (summary !== undefined && summary !== (session?.summary ?? '')) body.summary = summary;
        if (Object.keys(body).length === 0) {
          onClose();
          return;
        }
        patch.mutate(body);
      }}
      okText="保存"
    >
      <Form layout="vertical">
        <Form.Item label="标题（可给这段会话起个名字）">
          <Input
            id={session === null ? '' : `repo-title-${session.id}`}
            defaultValue={session?.title ?? ''}
            maxLength={200}
            placeholder="如：重构登录模块"
          />
        </Form.Item>
        <Form.Item label="精华摘要（本次做了什么；agent 也可经接口写入）">
          <Input.TextArea
            id={session === null ? '' : `repo-summary-${session.id}`}
            defaultValue={session?.summary ?? ''}
            rows={5}
            maxLength={8000}
            placeholder="如：修改了 src/a.ts 与 src/b.ts，新增登录校验逻辑"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
