/** 文档页签（FR-6.x）：项目内文档 + 挂载 + Markdown 阅读编辑 + 大纲 + 原文切换。 */
import { Alert, App, Button, Empty, Input, List, Modal, Segmented, Space, Spin, Tag, Tree } from 'antd';
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import MarkdownPreview from './MarkdownPreview';
import { OfficePreview } from './OfficePreview';
import { relTime } from '@/lib/format';
import { PaneSplit } from '@/components/PaneSplit';
import { SEMANTIC } from '@/theme/tokens';

interface DocItem {
  path: string;
  mountId: string | null;
  source: 'project' | 'mount';
  label: string;
  existsOk: boolean;
  refs: number;
}

export function DocsTab({ projectId }: { projectId: string }): React.JSX.Element {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<DocItem | null>(null);
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [mountOpen, setMountOpen] = useState(false);
  const [mountPath, setMountPath] = useState('');
  const [pickingFile, setPickingFile] = useState(false);

  const { data } = useQuery({
    queryKey: ['docs', projectId],
    queryFn: () => api.get<{ docs: DocItem[] }>(`/api/projects/${projectId}/docs`),
  });
  const { data: mounts } = useQuery({
    queryKey: ['mounts', projectId],
    queryFn: () =>
      api.get<Array<{ id: string; path: string; label: string | null; source: string; existsOk: boolean }>>(
        `/api/projects/${projectId}/mounts`,
      ),
  });

  // 预览文档（第 40 轮：Word/PDF/Excel）不走文本接口——二进制文件经编码检测会损坏，
  // 由 OfficePreview 走 /api/docs/raw 二进制通道；编辑模式对其禁用（只读）。
  const isPreviewable = selected !== null && /\.(docx|pdf|xlsx|xls|csv)$/i.test(selected.path);
  const content = useQuery({
    queryKey: ['doc-content', projectId, selected?.path, selected?.mountId],
    queryFn: () =>
      api.get<{ content: string; mtime: string; size: number; hash: string; encoding: string; eol: string }>(
        '/api/docs/content',
        { projectId, path: selected?.path ?? '', mountId: selected?.mountId ?? '' },
      ),
    enabled: selected !== null && mode === 'read' && !isPreviewable,
  });

  const outline = useMemo(() => {
    const lines = (content.data?.content ?? '').split('\n');
    return lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /^#{1,4}\s/.test(l))
      .map(({ l, i }) => ({
        level: (l.match(/^#+/) ?? ['#'])[0].length,
        text: l.replace(/^#+\s*/, ''),
        line: i,
      }));
  }, [content.data]);

  // 大纲跳转：大纲条目按内容顺序生成，与渲染出的 h1-h4 的 DOM 顺序一一对应，
  // 按索引取标题元素 scrollIntoView（由预览滚动容器承接）
  const previewRef = React.useRef<HTMLDivElement | null>(null);
  const scrollToHeading = (index: number): void => {
    const headings = previewRef.current?.querySelectorAll('.tt-md h1, .tt-md h2, .tt-md h3, .tt-md h4');
    headings?.[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const saveDoc = useMutation({
    mutationFn: (body: unknown) => api.put('/api/docs/content', body),
    onSuccess: () => {
      void message.success('文档已保存');
      void queryClient.invalidateQueries({ queryKey: ['doc-content', projectId] });
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '保存失败'),
  });

  return (
    <div style={{ height: '100%', overflow: 'hidden' }}>
      <PaneSplit
        sizeKey="docsListWidth"
        defaultSize={300}
        min={200}
        max={640}
        testId="split-docs-list"
        left={
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              paddingRight: 8,
              overflow: 'auto',
            }}
          >
            <Button size="small" onClick={() => setMountOpen(true)}>
              挂载外部文档（L1）
            </Button>
            {(mounts ?? []).filter((m) => !m.existsOk).length > 0 && (
              <Alert type="warning" message="有挂载路径失效，已标灰" />
            )}
            <List
              size="small"
              header={<strong>项目内文档</strong>}
              dataSource={(data?.docs ?? []).filter((d) => d.source === 'project')}
              renderItem={(d) => (
                <List.Item
                  style={{ padding: '2px 0', cursor: 'pointer' }}
                  onClick={() => {
                    setSelected(d);
                    setMode('read');
                  }}
                >
                  <span className="tt-ellipsis tt-mono" style={{ fontSize: 12, flex: 1 }}>
                    {d.path}
                  </span>
                  {d.refs > 1 && <Tag style={{ fontSize: 10 }}>被 {d.refs} 个项目引用</Tag>}
                </List.Item>
              )}
            />
            <List
              size="small"
              header={<strong>外部挂载（自动匹配 / 手动）</strong>}
              dataSource={(data?.docs ?? []).filter((d) => d.source === 'mount')}
              locale={{ emptyText: '无挂载' }}
              renderItem={(d) => (
                <List.Item
                  style={{
                    padding: '2px 0',
                    cursor: d.existsOk ? 'pointer' : 'not-allowed',
                    opacity: d.existsOk ? 1 : 0.45,
                  }}
                  onClick={() => {
                    if (d.existsOk) {
                      setSelected(d);
                      setMode('read');
                    } else void message.warning('路径不存在：可重新定位或解绑（文档根页可操作）');
                  }}
                >
                  <span className="tt-ellipsis" style={{ fontSize: 12, flex: 1 }}>
                    {d.label}
                  </span>
                  {d.mountId === null ? <Tag>项目内</Tag> : <Tag color="blue">挂载</Tag>}
                </List.Item>
              )}
            />
          </div>
        }
        right={
          <div
            style={{
              height: '100%',
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            {selected === null ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="选择左侧文档阅读"
                style={{ marginTop: 64 }}
              />
            ) : (
              <>
                <Space style={{ marginBottom: 6 }}>
                  <span className="tt-ellipsis tt-mono" style={{ fontSize: 12, maxWidth: 420 }}>
                    {selected.label}
                  </span>
                  {content.data !== undefined && <Tag>{relTime(content.data.mtime)}</Tag>}
                  <Segmented
                    options={[
                      { label: '阅读', value: 'read' },
                      { label: '编辑', value: 'edit', disabled: isPreviewable },
                    ]}
                    value={isPreviewable ? 'read' : mode}
                    onChange={(v) => setMode(v as 'read' | 'edit')}
                  />
                  {isPreviewable && <span style={{ fontSize: 12, opacity: 0.55 }}>只读预览格式</span>}
                  {mode === 'edit' && (
                    <DocEditor
                      projectId={projectId}
                      item={selected}
                      onSave={(c, b) =>
                        saveDoc.mutate({
                          projectId,
                          path: selected.path,
                          mountId: selected.mountId ?? undefined,
                          content: c,
                          ...b,
                        })
                      }
                    />
                  )}
                </Space>
                {outline.length > 0 && (
                  <Tree
                    style={{ marginBottom: 6, maxHeight: 140, overflow: 'auto' }}
                    treeData={outline.map((o, i) => ({
                      key: `${o.line}`,
                      title: (
                        <span style={{ cursor: 'pointer' }} onClick={() => scrollToHeading(i)}>
                          {'　'.repeat(o.level - 1)}
                          {o.text}
                        </span>
                      ),
                    }))}
                    defaultExpandedKeys={[]}
                    selectable={false}
                  />
                )}
                {content.isLoading ? (
                  <Spin style={{ margin: '48px auto', display: 'block' }} />
                ) : mode === 'read' && isPreviewable ? (
                  <div
                    style={{
                      flex: 1,
                      overflow: 'auto',
                      background: SEMANTIC.layoutBg,
                      borderRadius: 8,
                      padding: 16,
                    }}
                    data-testid="office-preview"
                  >
                    <OfficePreview projectId={projectId} path={selected.path} mountId={selected.mountId} />
                  </div>
                ) : mode === 'read' ? (
                  <div
                    ref={previewRef}
                    style={{
                      flex: 1,
                      overflow: 'auto',
                      background: SEMANTIC.layoutBg,
                      borderRadius: 8,
                      padding: 16,
                    }}
                  >
                    <MarkdownPreview
                      content={content.data?.content ?? ''}
                      projectId={projectId}
                      mountId={selected.mountId}
                      basePath={selected.path}
                    />
                  </div>
                ) : (
                  <DocEditorInline
                    projectId={projectId}
                    item={selected}
                    onSave={(c, b) =>
                      saveDoc.mutate({
                        projectId,
                        path: selected.path,
                        mountId: selected.mountId ?? undefined,
                        content: c,
                        ...b,
                      })
                    }
                  />
                )}
              </>
            )}
          </div>
        }
      />
      <Modal
        title="挂载外部文档（任意文件夹或单文件）"
        open={mountOpen}
        onCancel={() => setMountOpen(false)}
        onOk={() => {
          // 支持一次挂载多个路径（每行一个）：系统对话框可多选文件
          const paths = mountPath
            .split(/\r?\n/)
            .map((s) => s.trim().replace(/^"|"$/g, ''))
            .filter((s) => s !== '');
          if (paths.length === 0) {
            void message.warning('请先填写或选择要挂载的路径');
            return;
          }
          void (async () => {
            let ok = 0;
            const failed: string[] = [];
            for (const p of paths) {
              try {
                await api.post(`/api/projects/${projectId}/mounts`, { path: p });
                ok += 1;
              } catch (e) {
                failed.push(`${p}：${e instanceof ApiClientError ? e.message : '挂载失败'}`);
              }
            }
            if (ok > 0) {
              void message.success(`已挂载 ${ok} 个路径`);
              setMountOpen(false);
              setMountPath('');
              void queryClient.invalidateQueries({ queryKey: ['mounts', projectId] });
              void queryClient.invalidateQueries({ queryKey: ['docs', projectId] });
            }
            for (const f of failed) void message.error(f, 6);
          })();
        }}
      >
        <Space.Compact style={{ width: '100%', marginBottom: 8, display: 'flex' }}>
          <Input.TextArea
            rows={2}
            value={mountPath}
            onChange={(e) => setMountPath(e.target.value)}
            placeholder="文件夹或 md 文件的绝对路径（可多行，每行一个）"
          />
          <Button
            loading={pickingFile}
            onClick={() => {
              void (async () => {
                setPickingFile(true);
                try {
                  // 对话框由服务端弹出，必须立刻给提示（后台进程弹窗可能被浏览器窗口挡住，Alt+Tab 可找到）
                  void message.info('正在弹出系统对话框；若被其他窗口挡住，请按 Alt+Tab 查看', 5);
                  const r = await api.post<{ paths: string[] }>('/api/dialogs/pick-file');
                  if (r.paths.length > 0)
                    setMountPath((prev) =>
                      prev === '' ? r.paths.join('\n') : `${prev}\n${r.paths.join('\n')}`,
                    );
                  else void message.info('未选择文件');
                } catch {
                  void message.error('打开系统对话框失败，请手动粘贴路径');
                } finally {
                  setPickingFile(false);
                }
              })();
            }}
          >
            选择文件…
          </Button>
        </Space.Compact>
        <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 0 }}>
          「选择文件…」支持一次多选；选中的会追加到输入框，确认后逐个挂载。也可以直接粘贴路径，每行一个。
        </p>
      </Modal>
    </div>
  );
}

interface EditBase {
  baseMtime: string;
  baseSize: number;
  baseHash: string;
}

function DocEditorInline({
  projectId,
  item,
  onSave,
}: {
  projectId: string;
  item: DocItem;
  onSave: (content: string, base: EditBase) => void;
}): React.JSX.Element {
  const { data } = useQuery({
    queryKey: ['doc-content', projectId, item.path, item.mountId],
    queryFn: () =>
      api.get<{ content: string; mtime: string; size: number; hash: string }>('/api/docs/content', {
        projectId,
        path: item.path,
        mountId: item.mountId ?? '',
      }),
    enabled: item !== null,
  });
  const [text, setText] = useState<string | null>(null);
  const value = text ?? data?.content ?? '';
  return (
    <Input.TextArea
      className="tt-mono"
      style={{ flex: 1, fontSize: 13, minHeight: 320 }}
      value={value}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (data !== undefined && text !== null)
          onSave(text, { baseMtime: data.mtime, baseSize: data.size, baseHash: data.hash });
      }}
    />
  );
}

function DocEditor({
  onSave,
  item,
}: {
  projectId: string;
  item: DocItem;
  onSave: (content: string, base: EditBase) => void;
}): React.JSX.Element {
  void onSave;
  void item;
  return <span style={{ fontSize: 12, opacity: 0.6 }}>编辑后失焦即保存（含冲突校验）</span>;
}
