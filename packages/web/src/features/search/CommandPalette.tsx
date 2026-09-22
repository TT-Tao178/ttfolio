/** 命令面板 + 全局搜索（FR-8.1/8.2/8.4/8.5）：Ctrl+K，三档结果 + 命令项 + 未索引引导。 */
import { Empty, Input, Modal, Segmented, Space, Tag, App } from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SearchResults } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';
import { SEMANTIC } from '@/theme/tokens';

interface CommandItem {
  id: string;
  title: string;
  run: () => void;
}

export function CommandPalette(): React.JSX.Element {
  const { paletteOpen, setPalette, openTab, tabs, activeTabId } = useAppStore();
  const { message } = App.useApp();
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'all' | 'project'>('all');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<InputRef>(null);
  const queryClient = useQueryClient();
  const activeProjectId = tabs.find((t) => t.id === activeTabId)?.projectId ?? null;

  useEffect(() => {
    if (paletteOpen) setTimeout(() => inputRef.current?.focus({ cursor: 'end' } as never), 50);
    else setQ('');
  }, [paletteOpen]);

  const { data: search } = useQuery({
    queryKey: ['palette-search', q, scope, activeProjectId],
    queryFn: () =>
      api.get<SearchResults>('/api/search', {
        q,
        projectId: scope === 'project' && activeProjectId !== null ? activeProjectId : '',
        limit: '8'
      }),
    enabled: paletteOpen && q.trim().length > 0
  });

  const { data: quick } = useQuery({
    queryKey: ['palette-quick', q],
    queryFn: () => api.get<Array<{ projectId: string; name: string; dirPath: string; score: number }>>('/api/search/quick', { q }),
    enabled: paletteOpen
  });

  const commands = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [
      { id: 'cmd.workbench', title: '打开工作台总览', run: () => openTab({ kind: 'overview', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '工作台') },
      { id: 'cmd.add', title: '添加项目', run: () => { openTab({ kind: 'overview', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '工作台'); } },
      { id: 'cmd.settings', title: '打开设置 (Ctrl+,)', run: () => openTab({ kind: 'settings', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '设置') },
      { id: 'cmd.trash', title: '打开回收站', run: () => openTab({ kind: 'trash', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '回收站') },
      { id: 'cmd.git-overview', title: '跨项目 Git 总览', run: () => openTab({ kind: 'search', projectId: null, targetPath: null, subTab: 'git-overview', scroll: 0 }, 'Git 总览') }
    ];
    if (q.trim() !== '') {
      return list.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));
    }
    return list;
  }, [q, openTab]);

  // 合并列表：命令 + 项目 + 文件 + 内容
  const projectHits = (search?.projects ?? []).length > 0 ? search?.projects ?? [] : (q.trim() === '' ? (quick ?? []).map((x) => ({ projectId: x.projectId, name: x.name, alias: null, dirPath: x.dirPath, matched: x.name })) : []);
  const fileHits = search?.files ?? [];
  const contentHits = search?.contents ?? [];

  interface Row { key: string; kind: 'command' | 'project' | 'file' | 'content'; title: React.ReactNode; run: () => void }
  const rows: Row[] = [
    ...commands.map((c) => ({ key: c.id, kind: 'command' as const, title: c.title, run: c.run })),
    ...projectHits.map((p) => ({
      key: `p:${p.projectId}`,
      kind: 'project' as const,
      title: <span>{p.name} <Tag>项目</Tag> <span style={{ opacity: 0.6, fontSize: 12 }}>{p.dirPath}</span></span>,
      run: () => {
        void api.post(`/api/projects/${p.projectId}/open`);
        openTab({ kind: 'project', projectId: p.projectId, targetPath: null, subTab: 'files', scroll: 0 }, p.name);
      }
    })),
    ...fileHits.map((f) => ({
      key: `f:${f.projectId}:${f.relPath}`,
      kind: 'file' as const,
      title: <span><Tag>文件</Tag> <span className="tt-mono" style={{ fontSize: 12 }}>{f.relPath}</span></span>,
      run: () => openTab({ kind: 'project', projectId: f.projectId, targetPath: f.relPath, subTab: 'files', scroll: 0 }, f.name)
    })),
    ...contentHits.map((c, i) => ({
      key: `c:${c.projectId}:${c.relPath}:${i}`,
      kind: 'content' as const,
      title: (
        <span>
          <Tag color="purple">内容</Tag> <span className="tt-mono" style={{ fontSize: 12 }}>{c.relPath}</span>
          <div style={{ fontSize: 12, opacity: 0.75 }} dangerouslySetInnerHTML={{ __html: c.snippet }} />
        </span>
      ),
      run: () => openTab({ kind: 'project', projectId: c.projectId, targetPath: c.relPath, subTab: 'files', scroll: 0 }, c.relPath.split('/').pop() ?? c.relPath)
    }))
  ];

  const buildIndex = useMutation({
    mutationFn: (projectId: string) => api.post('/api/search/index', { projectId }),
    onSuccess: () => {
      void message.info('已开始建立内容索引（可在状态栏查看进度）');
      void queryClient.invalidateQueries({ queryKey: ['index-status'] });
    }
  });

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(Math.min(cursor + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(Math.max(cursor - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[cursor];
      if (row !== undefined) {
        row.run();
        setPalette(false);
      }
    } else if (e.key === 'Escape') {
      setPalette(false);
    }
  };

  return (
    <Modal
      open={paletteOpen}
      onCancel={() => setPalette(false)}
      footer={null}
      closable={false}
      width={640}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ padding: 8 }}>
        <Space direction="vertical" style={{ width: '100%' }} size={6}>
          <Space style={{ width: '100%' }}>
            <Input
              ref={inputRef as never}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="搜索项目 / 文件名 / 文件内容，或输入命令…（↑↓ 选择，回车执行）"
              size="large"
              variant="borderless"
              data-testid="palette-input"
              autoFocus
            />
            <Segmented
              size="small"
              value={scope}
              onChange={(v) => setScope(v as 'all' | 'project')}
              options={[{ label: '全部', value: 'all' }, { label: '当前项目', value: 'project' }]}
            />
          </Space>
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            {rows.length === 0 && q.trim() !== '' && (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无结果" style={{ padding: 24 }} />
            )}
            {(search?.unindexedProjects ?? []).length > 0 && (
              <div style={{ padding: '6px 8px' }}>
                <span style={{ fontSize: 12, marginRight: 8 }}>以下项目尚未建立内容索引：</span>
                {search?.unindexedProjects.slice(0, 5).map((pid) => {
                  const name = projectHits.find((p) => p.projectId === pid)?.name ?? pid;
                  return (
                    <Tag key={pid} color="blue" style={{ cursor: 'pointer' }} onClick={() => buildIndex.mutate(pid)}>
                      {name}：建立索引
                    </Tag>
                  );
                })}
              </div>
            )}
            {rows.map((row, i) => (
              <div
                key={row.key}
                onClick={() => {
                  row.run();
                  setPalette(false);
                }}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: i === cursor ? SEMANTIC.primaryBg : 'transparent'
                }}
                onMouseEnter={() => setCursor(i)}
              >
                {row.title}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, opacity: 0.55, padding: '0 8px 4px' }}>
            Ctrl+K 命令面板 · Ctrl+W 关标签 · Alt+←/→ 后退前进 · 1-5 切项目页签 · ? 快捷键帮助
          </div>
        </Space>
      </div>
    </Modal>
  );
}

type InputRef = { focus: (opts?: unknown) => void };
