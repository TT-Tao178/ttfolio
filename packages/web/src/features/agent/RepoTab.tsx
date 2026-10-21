/** 资源仓库页签（FR-13.3 / T-097）：三段式——①记录控制+项目速览 ②会话时间线
 * （时间段 + 修改文件清单，可展开）③精华摘要（用户手填或 agent 经接口写入，可编辑）。
 * 仅当项目属性「启用资源仓库」开启时由 ProjectPage 渲染；关闭开关页签消失、数据保留。 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Collapse, Descriptions, Empty, Modal, Form, Input, Spin, Tag, Timeline, App } from 'antd';
import { CaretRightOutlined, PauseOutlined, EditOutlined } from '@ant-design/icons';
import { api, ApiClientError } from '@/lib/api';
import type { AgentRepoSession, AgentRepoSessionFile, ProjectDetail } from '@ttfolio/shared';
import { relTime } from '@/lib/format';
import { typeLabel } from '@/components/DetailPanel';
import { SEMANTIC } from '@/theme/tokens';

interface SessionsResponse {
  enabled: boolean;
  active: AgentRepoSession | null;
  sessions: AgentRepoSession[];
}

export function RepoTab({ projectId }: { projectId: string }): React.JSX.Element {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AgentRepoSession | null>(null);

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

  return (
    <div style={{ height: '100%', overflow: 'auto', paddingRight: 4 }} data-testid="agent-repo">
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
              开始记录
            </Button>
            <span style={{ fontSize: 12, opacity: 0.65 }}>
              开启后，本项目文件的每次变更（含 agent/外部编辑）按会话沉淀路径与时间，不复制内容。
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
              结束记录
            </Button>
            <span style={{ fontSize: 12, opacity: 0.65 }}>
              记录中 · 开始于 {relTime(active.startedAt)} · 已记录 {active.fileCount} 个文件
            </span>
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
    </div>
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
