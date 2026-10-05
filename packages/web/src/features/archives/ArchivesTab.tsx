/**
 * 架构图页签（FR-7.x）：登记 / 常驻分栏查看（左文件列表 + 右预览）/ 变更提示 / 只读约束。
 *
 * 第 26 轮重构（用户报障「架构图只是显示一些文件，要能直接在软件里查看」）：
 * - 旧版是「目录卡片 + Modal 弹窗 iframe」，且图集列表只收 .html——目录里是图片时列表为空，
 *   界面只剩几张信息卡，没有任何查看入口；
 * - 新版对齐文档页（DocsTab）的常驻分栏：左侧文件列表（HTML + 图片合并、入口/类型标记），
 *   右侧直接预览——HTML 走 iframe（sandbox 与旧版一致），图片走 <img>（archUrl 同为
 *   7817 只读端口 + token，无后端改动）；进入页签自动打开入口（无入口则第一个文件）。
 * 红线不变：ttFolio 只登记与只读查看，绝不写入架构图目录、不在其中落任何临时文件。
 */
import { Alert, App, Button, Empty, Input, List, Modal, Select, Space, Tag, Tooltip } from 'antd';
import { ApartmentOutlined, FileAddOutlined, FullscreenOutlined, ReloadOutlined } from '@ant-design/icons';
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError, archUrl } from '@/lib/api';
import type { ArchiveInfo } from '@ttfolio/shared';
import { fmtBytes, relTime } from '@/lib/format';
import { StateView } from '@/components/StateView';
import { PaneSplit } from '@/components/PaneSplit';
import { SEMANTIC } from '@/theme/tokens';

interface ArchFile {
  rel: string;
  mtime: string;
  size: number;
  kind: 'html' | 'image' | 'text';
  hasSourceJson: boolean;
}

export function ArchivesTab({ projectId }: { projectId: string }): React.JSX.Element {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [regOpen, setRegOpen] = useState(false);
  const [regPath, setRegPath] = useState('');
  /** 当前查看的 archive 目录与文件（多目录时用 Select 切换） */
  const [archId, setArchId] = useState<string | null>(null);
  const [selectedRel, setSelectedRel] = useState<string | null>(null);

  const { data: archives, isLoading, error } = useQuery({
    queryKey: ['archives', projectId],
    queryFn: () => api.get<ArchiveInfo[]>(`/api/projects/${projectId}/archives`)
  });

  const current: ArchiveInfo | null = useMemo(() => {
    const list = archives ?? [];
    if (list.length === 0) return null;
    return list.find((a) => a.id === archId) ?? list[0] ?? null;
  }, [archives, archId]);

  // HTML + 图片 + 文本合并成一份文件列表（按修改时间倒序）
  const files: ArchFile[] = useMemo(() => {
    if (current === null) return [];
    const all: ArchFile[] = [
      ...current.htmlFiles.map((f) => ({ ...f, kind: 'html' as const })),
      ...current.imageFiles.map((f) => ({ ...f, kind: 'image' as const, hasSourceJson: false })),
      ...current.textFiles.map((f) => ({ ...f, kind: 'text' as const, hasSourceJson: false }))
    ];
    return all.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  }, [current]);

  const selected = files.find((f) => f.rel === selectedRel) ?? null;

  // 文本类文件的只读内容：走 7817 arch 通道 fetch（架构图目录可能不在项目白名单内，
  // 不能用 /api/fs/file）；json 尝试格式化，其余原样
  const [textContent, setTextContent] = useState<string | null>(null);
  useEffect(() => {
    if (current === null || selected === null || selected.kind !== 'text') {
      setTextContent(null);
      return;
    }
    let cancelled = false;
    void fetch(archUrl(projectId, current.id, selected.rel))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((raw) => {
        if (cancelled) return;
        if (selected.rel.toLowerCase().endsWith('.json')) {
          try {
            raw = JSON.stringify(JSON.parse(raw), null, 2);
          } catch { /* 非 JSON 内容原样展示 */ }
        }
        setTextContent(raw);
      })
      .catch((e: unknown) => {
        if (!cancelled) setTextContent(`读取失败：${e instanceof Error ? e.message : '未知错误'}`);
      });
    return () => {
      cancelled = true;
    };
  }, [current, selected, projectId]);

  // 进入页签 / 切换目录后自动打开：入口优先（无入口取第一个文件）——贴合「直接查看」
  useEffect(() => {
    if (current === null || selected !== null) return;
    const entry = current.entryRel !== null && current.entryRel !== '' ? current.entryRel : null;
    const pick = entry ?? files[0]?.rel ?? null;
    if (pick !== null) setSelectedRel(pick);
  }, [current, files, selected]);

  const switchArchive = (id: string): void => {
    setArchId(id);
    setSelectedRel(null);
  };

  const openFile = (f: ArchFile): void => {
    setSelectedRel(f.rel);
    if (f.kind === 'html') void api.post(`/api/archives/${current?.id ?? ''}/viewed`).catch(() => {});
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

  const preview = (): React.JSX.Element => {
    if (current === null || selected === null) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择左侧文件查看" style={{ marginTop: 64 }} />;
    }
    const url = archUrl(projectId, current.id, selected.rel);
    if (selected.kind === 'image') {
      return (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: SEMANTIC.layoutBg, borderRadius: 8, padding: 12, overflow: 'auto' }}>
          <img src={url} alt={selected.rel} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} data-testid="archive-image" />
        </div>
      );
    }
    if (selected.kind === 'text') {
      return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
          <div style={{ fontSize: 12, opacity: 0.6 }}>只读文本预览（{fmtBytes(selected.size)}）</div>
          <pre
            data-testid="archive-text"
            className="tt-mono"
            style={{ flex: 1, overflow: 'auto', background: SEMANTIC.layoutBg, borderRadius: 8, padding: 12, margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >{textContent ?? '加载中…'}</pre>
        </div>
      );
    }
    return (
      <iframe
        src={url}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8, background: SEMANTIC.layoutBg }}
        title="architecture-viewer"
      />
    );
  };

  const fileList = (): React.JSX.Element => (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 8 }}>
      {(archives ?? []).length > 1 && (
        <Select value={current?.id} onChange={switchArchive} size="small" options={(archives ?? []).map((a) => ({ value: a.id, label: a.label ?? a.dirPath }))} />
      )}
      {current !== null && current.changed && <Alert type="info" showIcon message="架构图已更新（文件数或入口内容有变化）" style={{ padding: '4px 12px' }} />}
      <div style={{ fontSize: 12, opacity: 0.75 }}>
        {current?.label ?? current?.dirPath} · 入口：{current?.entryRel ?? '（无）'}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }} data-testid="archive-file-list">
        {files.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="目录里没有可查看的文件（支持 HTML 与图片）" />
        ) : (
          <List
            size="small"
            dataSource={files}
            renderItem={(f) => (
              <List.Item
                style={{
                  padding: '3px 6px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  background: selectedRel === f.rel ? SEMANTIC.primaryBg : undefined
                }}
                onClick={() => openFile(f)}
                data-testid="archive-file-item"
              >
                <span className="tt-ellipsis" style={{ flex: 1, fontSize: 12 }} title={f.rel}>
                  {f.rel.includes('/') ? f.rel.slice(f.rel.lastIndexOf('/') + 1) : f.rel}
                </span>
                {current?.entryRel === f.rel && <Tag color="blue" style={{ marginRight: 0 }}>入口</Tag>}
                <Tag style={{ marginRight: 0 }} color={f.kind === "html" ? "green" : f.kind === "image" ? "purple" : "geekblue"}>{f.kind === "html" ? "HTML" : f.kind === "image" ? "图片" : "文本"}</Tag>
                <span style={{ fontSize: 11, opacity: 0.55 }}>{relTime(f.mtime)}</span>
              </List.Item>
            )}
          />
        )}
      </div>
    </div>
  );

  return (
    <div style={{ height: '100%', overflow: 'hidden' }} data-testid="archives-tab">
      <StateView
        loading={isLoading}
        error={error}
        empty={(archives ?? []).length === 0}
        emptyText="还没有登记架构图目录"
        emptyAction={{ label: '登记目录', onClick: () => setRegOpen(true) }}
      >
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 8 }}>
          <Space size={4} wrap>
            <ApartmentOutlined />
            <strong>架构图</strong>
            {current !== null && <Tag>{current.htmlCount} HTML · {(current.imageFiles ?? []).length} 图片 · {fmtBytes(current.totalBytes)}</Tag>}
            {current !== null && current.isDefault && <Tag color="blue">默认</Tag>}
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => queryClient.invalidateQueries({ queryKey: ['archives', projectId] })}
              title="重新扫描目录"
            />
            {current !== null && selected !== null && (
              <Tooltip title="在新窗口打开（全屏查看）">
                <Button
                  size="small"
                  icon={<FullscreenOutlined />}
                  onClick={() => current !== null && selected !== null && window.open(archUrl(projectId, current.id, selected.rel), '_blank')}
                />
              </Tooltip>
            )}
            {current !== null && (
              <Tooltip title="复制目录路径">
                <Button size="small" onClick={() => { void navigator.clipboard.writeText(current.dirPath); void message.success('已复制'); }} />
              </Tooltip>
            )}
            <Button size="small" icon={<FileAddOutlined />} onClick={() => setRegOpen(true)}>登记目录</Button>
            {current !== null && current.entryRel !== null && current.entryRel !== '' && current.entrySource !== 'list' && (
              <Button
                size="small"
                onClick={() => void api.patch(`/api/archives/${current.id}`, { entryRel: '' }).then(() => queryClient.invalidateQueries({ queryKey: ['archives', projectId] }))}
              >
                改为图集列表
              </Button>
            )}
          </Space>
          <div style={{ flex: 1, minHeight: 0 }}>
            <PaneSplit
              sizeKey="archListWidth"
              defaultSize={340}
              min={220}
              max={640}
              testId="split-arch"
              left={fileList()}
              right={preview()}
            />
          </div>
          <Alert
            type="info"
            style={{ padding: '4px 12px' }}
            message="架构图由外部工具（如 archify）生成，此处只读查看"
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
          <Input
            value={regPath}
            onChange={(e) => setRegPath(e.target.value)}
            placeholder="目录绝对路径（默认项目内 架构图/ 会自动登记）"
          />
          <Button onClick={() => {
            void message.info('正在弹出系统对话框；若被其他窗口挡住，请按 Alt+Tab 查看', 5);
            void api.post('/api/dialogs/pick-folder').then((r) => {
              const list = (r as { paths: string[] }).paths;
              const first = list[0];
              if (first !== undefined) setRegPath(first);
            }).catch(() => { void message.error('打开系统对话框失败，请手动粘贴路径'); });
          }}>选择…</Button>
        </Space.Compact>
      </Modal>
    </div>
  );
}
