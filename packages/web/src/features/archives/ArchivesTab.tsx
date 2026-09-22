/** 架构图页签（FR-7.x）：登记/图集列表/入口/内嵌 iframe（独立端口）/变更提示/只读约束。 */
import { Alert, App, Button, List, Modal, Space, Tag, Tooltip } from 'antd';
import { ApartmentOutlined, FileAddOutlined, FullscreenOutlined, ReloadOutlined } from '@ant-design/icons';
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError, archUrl } from '@/lib/api';
import type { ArchiveInfo } from '@ttfolio/shared';
import { fmtBytes, relTime } from '@/lib/format';
import { StateView } from '@/components/StateView';
import { SEMANTIC } from '@/theme/tokens';

export function ArchivesTab({ projectId }: { projectId: string }): React.JSX.Element {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [viewing, setViewing] = useState<{ info: ArchiveInfo; rel: string } | null>(null);
  const [regOpen, setRegOpen] = useState(false);
  const [regPath, setRegPath] = useState('');

  const { data: archives, isLoading, error } = useQuery({
    queryKey: ['archives', projectId],
    queryFn: () => api.get<ArchiveInfo[]>(`/api/projects/${projectId}/archives`)
  });

  const entryOf = (a: ArchiveInfo): string | null => {
    if (a.entryRel !== null && a.entryRel !== '') return a.entryRel;
    return null;
  };

  const register = (): void => {
    void api
      .post(`/api/projects/${projectId}/archives`, { projectId, dirPath: regPath })
      .then(() => {
        void message.success('已登记架构图目录');
        void queryClient.invalidateQueries({ queryKey: ['archives', projectId] });
        setRegOpen(false);
        setRegPath('');
      })
      .catch((e: unknown) => void message.error(e instanceof ApiClientError ? e.message : '登记失败'));
  };

  return (
    <div style={{ height: '100%', overflow: 'auto' }} data-testid="archives-tab">
      <StateView
        loading={isLoading}
        error={error}
        empty={(archives ?? []).length === 0}
        emptyText="还没有登记架构图目录"
        emptyAction={{ label: '登记目录', onClick: () => setRegOpen(true) }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(archives ?? []).map((a) => {
            const entry = entryOf(a);
            return (
              <div key={a.id} style={{ border: `1px solid ${SEMANTIC.split}`, borderRadius: 8, padding: 12 }}>
                {a.changed && (
                  <Alert type="info" showIcon message="架构图已更新（文件数或入口内容有变化）" style={{ marginBottom: 8 }} />
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <ApartmentOutlined />
                  <strong className="tt-ellipsis" style={{ maxWidth: 320 }}>{a.label ?? a.dirPath}</strong>
                  {a.isDefault && <Tag color="blue">默认</Tag>}
                  <Tag>{a.entrySource === 'index_html' ? '入口 index.html' : a.entrySource === 'manual' ? '手动指定入口' : '图集列表'}</Tag>
                  {a.changed && <Tag color="warning">有更新</Tag>}
                </div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                  入口：{entry ?? '（无，见下方图集列表）'} · {a.htmlCount} 个 HTML · {fmtBytes(a.totalBytes)} · 最近修改：{relTime(a.lastSeenAt)}
                  {a.lastViewedAt !== null && ` · 上次查看：${relTime(a.lastViewedAt)}`}
                </div>
                <Space style={{ marginTop: 8 }} size={4}>
                  {entry !== null ? (
                    <Button size="small" type="primary" data-testid="open-archive-btn" onClick={() => {
                      setViewing({ info: a, rel: entry });
                      void api.post(`/api/archives/${a.id}/viewed`);
                    }}>
                      打开查看
                    </Button>
                  ) : (
                    <Button size="small" type="primary" disabled={a.htmlFiles.length === 0} onClick={() => {
                      const first = a.htmlFiles[0];
                      if (first !== undefined) setViewing({ info: a, rel: first.rel });
                    }}>
                      查看图集
                    </Button>
                  )}
                  {entry !== null && entrySourceCanReset(a) && (
                    <Button size="small" onClick={() => void api.patch(`/api/archives/${a.id}`, { entryRel: '' }).then(() => queryClient.invalidateQueries({ queryKey: ['archives', projectId] }))}>
                      改为图集列表
                    </Button>
                  )}
                  <Button size="small" icon={<ReloadOutlined />} onClick={() => queryClient.invalidateQueries({ queryKey: ['archives', projectId] })} />
                  <Tooltip title="复制目录路径">
                    <Button size="small" onClick={() => { void navigator.clipboard.writeText(a.dirPath); void message.success('已复制'); }} />
                  </Tooltip>
                </Space>
                {a.sourceJsonFiles.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12 }}>
                    源文件（只读）：
                    {a.sourceJsonFiles.map((f) => (
                      <Tag key={f} className="tt-mono" onClick={() => setViewing({ info: a, rel: f })} style={{ cursor: 'pointer' }}>{f}</Tag>
                    ))}
                  </div>
                )}
                {entry === null && a.htmlFiles.length > 0 && (
                  <List
                    size="small"
                    style={{ marginTop: 8 }}
                    header={<span style={{ fontSize: 12 }}>图集列表（按修改时间倒序，前端渲染，不落盘）</span>}
                    dataSource={a.htmlFiles}
                    renderItem={(f) => (
                      <List.Item
                        style={{ padding: '2px 0', cursor: 'pointer' }}
                        onClick={() => {
                          setViewing({ info: a, rel: f.rel });
                          void api.post(`/api/archives/${a.id}/viewed`);
                        }}
                      >
                        <span className="tt-mono" style={{ fontSize: 12 }}>{f.rel}</span>
                        {f.hasSourceJson && <Tag color="purple">源文件</Tag>}
                        <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.6 }}>{relTime(f.mtime)}</span>
                      </List.Item>
                    )}
                  />
                )}
              </div>
            );
          })}
          <div>
            <Button icon={<FileAddOutlined />} onClick={() => setRegOpen(true)}>登记架构图目录</Button>
          </div>
          <Alert
            type="info"
            message="架构图由外部工具（如 archify）生成"
            description="ttFolio 只负责登记目录与查看（内嵌只读静态代理），绝不生成架构图、绝不写入该目录、不在目录中落任何临时文件。产物为自包含 HTML 时离线可看；若引用了外部资源（CDN），离线环境会显示不全。"
          />
        </div>
      </StateView>
      <Modal
        title="登记架构图目录"
        open={regOpen}
        onCancel={() => setRegOpen(false)}
        onOk={register}
        okText="登记"
        cancelText="取消"
      >
        <Space.Compact style={{ width: '100%' }}>
          <input
            id="archive-dir-input"
            value={regPath}
            onChange={(e) => setRegPath(e.target.value)}
            placeholder="目录绝对路径（默认项目内 架构图/ 会自动登记）"
            style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: `1px solid ${SEMANTIC.border}` }}
          />
          <Button onClick={() => void api.post('/api/dialogs/pick-folder').then((r) => {
            const p = (r as { paths: string[] }).paths[0];
            if (p !== undefined) setRegPath(p);
          })}>选择…</Button>
        </Space.Compact>
      </Modal>
      <Modal
        title={viewing !== null ? `架构图：${viewing.rel}` : ''}
        open={viewing !== null}
        onCancel={() => setViewing(null)}
        footer={[
          <Button key="new" onClick={() => viewing !== null && window.open(archUrl(projectId, viewing.info.id, viewing.rel), '_blank')}>新窗口打开</Button>,
          <Button key="full" icon={<FullscreenOutlined />} onClick={() => viewing !== null && window.open(archUrl(projectId, viewing.info.id, viewing.rel), '_blank')}>全屏</Button>,
          <Button key="copy" onClick={() => viewing !== null && void navigator.clipboard.writeText(viewing.info.dirPath)}>复制路径</Button>,
          <Button key="close" type="primary" onClick={() => setViewing(null)}>关闭</Button>
        ]}
        width="90vw"
        style={{ top: 24 }}
        styles={{ body: { height: '70vh', padding: 0 } }}
        data-testid="archive-viewer"
      >
        {viewing !== null && (
          <iframe
            src={archUrl(projectId, viewing.info.id, viewing.rel)}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            style={{ width: '100%', height: '100%', border: 'none' }}
            title="architecture-viewer"
          />
        )}
      </Modal>
    </div>
  );
}

function entrySourceCanReset(a: ArchiveInfo): boolean {
  return a.entrySource !== 'list';
}
