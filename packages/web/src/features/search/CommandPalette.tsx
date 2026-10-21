/** 命令面板 + 全局搜索（FR-8.1/8.2/8.4/8.5 / FR-13.6）：
 * 双模式——Ctrl+K 搜索为主；输入 > 前缀或 Ctrl+Shift+P 进入命令模式
 * （分类分组 / 模糊匹配 / MRU 置顶 / 参数化命令内联表单）。
 * 命令清单来自 features/command/registry.ts（单一来源）。 */
import { Empty, Input, Modal, Segmented, Select, Space, Tag, Button, App } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CommandTemplate, ProjectSummary, SearchResults } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';
import { useSettings } from '@/app/settings';
import { useCommandContext } from '@/features/command/useCommandContext';
import { SEMANTIC } from '@/theme/tokens';
import {
  allCommands,
  filterCommands,
  pushMru,
  readMru,
  sortByMru,
  type CommandDef,
} from '@/features/command/registry';

/**
 * FTS snippet 渲染前转义：snippet 是文件内容原文（SQLite snippet() 只加 [ ] 高亮标记），
 * 不转义直接 dangerouslySetInnerHTML 会把文件里的 HTML 当标签执行（评审定级的 P0）；
 * 转义后再把 [ ] 标记转 <mark> 做高亮。文件内容自带的字面方括号也可能被转成 mark，
 * 只是视觉瑕疵无安全问题（浏览器自动闭合未配对标签）。
 */
function escapeSnippet(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return esc.replace(/\[/g, '<mark>').replace(/\]/g, '</mark>');
}

export function CommandPalette(): React.JSX.Element {
  const { paletteOpen, paletteMode, setPalette, openTab, tabs, activeTabId } = useAppStore();
  const { message } = App.useApp();
  const { settings } = useSettings();
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'all' | 'project'>('all');
  const [cursor, setCursor] = useState(0);
  const [argValues, setArgValues] = useState<CommandDef | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const activeProjectId = tabs.find((t) => t.id === activeTabId)?.projectId ?? null;

  // 体检 P2：面板打开文件/内容命中时目标是项目标签——传项目名而非文件名，
  // 避免复用既有项目标签被改名为文件名、再点项目卡又改回（标题来回跳）
  const titleForProject = (pid: string, fallback: string): string =>
    tabs.find((t) => t.kind === 'project' && t.projectId === pid)?.title ??
    projectHits.find((p) => p.projectId === pid)?.name ??
    fallback;

  const mode: 'search' | 'command' = q.startsWith('>') ? 'command' : paletteMode;
  const qEff = mode === 'command' && q.startsWith('>') ? q.slice(1) : q;

  useEffect(() => {
    if (paletteOpen) {
      // 打开时消费 store 的作用域（「在当前项目内搜索」入口置 project，体检 P2）
      setScope(useAppStore.getState().paletteScope);
      setQ(useAppStore.getState().paletteMode === 'command' ? '>' : '');
      setCursor(0);
      setArgValues(null);
      setPicked([]);
    } else setQ('');
  }, [paletteOpen]);

  const { data: search } = useQuery({
    queryKey: ['palette-search', qEff, scope, activeProjectId],
    queryFn: () =>
      api.get<SearchResults>('/api/search', {
        q: qEff,
        projectId: scope === 'project' && activeProjectId !== null ? activeProjectId : '',
        limit: '8',
      }),
    enabled: paletteOpen && mode === 'search' && qEff.trim().length > 0,
  });

  const { data: quick } = useQuery({
    queryKey: ['palette-quick', qEff],
    queryFn: () =>
      api.get<Array<{ projectId: string; name: string; dirPath: string; score: number }>>(
        '/api/search/quick',
        { q: qEff },
      ),
    enabled: paletteOpen && mode === 'search',
  });

  const { data: templates } = useQuery({
    queryKey: ['command-templates'],
    queryFn: () => api.get<CommandTemplate[]>('/api/command-templates'),
    enabled: paletteOpen && mode === 'command',
  });
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects'),
    enabled: paletteOpen && mode === 'command',
  });

  const commandCtx = useCommandContext();

  const commands = useMemo(() => {
    const hasProject = activeProjectId !== null;
    const list = allCommands(templates ?? [], hasProject);
    const mru = readMru();
    return sortByMru(filterCommands(list, mode === 'command' ? qEff : ''), mru);
  }, [templates, activeProjectId, qEff, mode]);

  const runCommand = (cmd: CommandDef, values: { projectIds?: string[] } = {}): void => {
    if (cmd.needsProject && activeProjectId === null) {
      void message.info('该命令需要先打开一个项目');
      return;
    }
    if (cmd.args !== undefined && values.projectIds === undefined) {
      // 参数化命令：展开内联表单，不离开面板
      setArgValues(cmd);
      setPicked(activeProjectId !== null ? [activeProjectId] : []);
      return;
    }
    pushMru(cmd.id);
    try {
      void Promise.resolve(cmd.run(commandCtx, values)).catch((err: unknown) => {
        void message.error(err instanceof Error ? err.message : '命令执行失败');
      });
    } catch (err) {
      void message.error(err instanceof Error ? err.message : '命令执行失败');
      return;
    }
    setPalette(false);
  };

  // 搜索模式的行（命令 + 项目 + 文件 + 内容）
  const projectHits =
    (search?.projects ?? []).length > 0
      ? (search?.projects ?? [])
      : qEff.trim() === ''
        ? (quick ?? []).map((x) => ({
            projectId: x.projectId,
            name: x.name,
            alias: null,
            dirPath: x.dirPath,
            matched: x.name,
          }))
        : [];
  const fileHits = search?.files ?? [];
  const contentHits = search?.contents ?? [];

  interface Row {
    key: string;
    kind: 'command' | 'project' | 'file' | 'content' | 'header';
    title: React.ReactNode;
    run: () => void;
    disabled?: boolean;
  }
  const searchModeCommands = useMemo(
    () => filterCommands(allCommands(templates ?? [], activeProjectId !== null), q),
    [templates, activeProjectId, q],
  );
  const rows: Row[] =
    mode === 'command'
      ? (() => {
          const list: Row[] = [];
          let lastCat = '';
          for (const c of commands) {
            if (c.category !== lastCat) {
              lastCat = c.category;
              list.push({
                key: `h:${c.category}`,
                kind: 'header',
                title: <span style={{ fontSize: 12, opacity: 0.55 }}>{c.category}</span>,
                run: () => {},
              });
            }
            const chord = c.keys !== undefined ? (settings.keybindings[c.id] ?? c.keys) : null;
            list.push({
              key: c.id,
              kind: 'command',
              title: (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span>{c.title}</span>
                  {chord !== null && <Tag style={{ marginLeft: 'auto' }}>{chord}</Tag>}
                  {c.args !== undefined && <Tag color="blue">参数</Tag>}
                  {c.needsProject && activeProjectId === null && <Tag color="default">需项目</Tag>}
                </span>
              ),
              disabled: c.needsProject === true && activeProjectId === null,
              run: () => runCommand(c),
            });
          }
          return list;
        })()
      : [
          ...searchModeCommands.map((c) => ({
            key: c.id,
            kind: 'command' as const,
            title: c.title,
            run: () => runCommand(c),
          })),
          ...projectHits.map((p) => ({
            key: `p:${p.projectId}`,
            kind: 'project' as const,
            title: (
              <span>
                {p.name} <Tag>项目</Tag> <span style={{ opacity: 0.6, fontSize: 12 }}>{p.dirPath}</span>
              </span>
            ),
            run: () => {
              void api.post(`/api/projects/${p.projectId}/open`);
              openTab(
                { kind: 'project', projectId: p.projectId, targetPath: null, subTab: 'files', scroll: 0 },
                p.name,
              );
            },
          })),
          ...fileHits.map((f) => ({
            key: `f:${f.projectId}:${f.relPath}`,
            kind: 'file' as const,
            title: (
              <span>
                <Tag>文件</Tag>{' '}
                <span className="tt-mono" style={{ fontSize: 12 }}>
                  {f.relPath}
                </span>
              </span>
            ),
            run: () =>
              openTab(
                {
                  kind: 'project',
                  projectId: f.projectId,
                  targetPath: f.relPath,
                  subTab: 'files',
                  scroll: 0,
                },
                titleForProject(f.projectId, f.name),
              ),
          })),
          ...contentHits.map((c, i) => ({
            key: `c:${c.projectId}:${c.relPath}:${i}`,
            kind: 'content' as const,
            title: (
              <span>
                <Tag color="purple">内容</Tag>{' '}
                <span className="tt-mono" style={{ fontSize: 12 }}>
                  {c.relPath}
                </span>
                <div
                  style={{ fontSize: 12, opacity: 0.75 }}
                  dangerouslySetInnerHTML={{ __html: escapeSnippet(c.snippet) }}
                />
              </span>
            ),
            run: () =>
              openTab(
                {
                  kind: 'project',
                  projectId: c.projectId,
                  targetPath: c.relPath,
                  subTab: 'files',
                  scroll: 0,
                },
                titleForProject(c.projectId, c.relPath.split('/').pop() ?? c.relPath),
              ),
          })),
        ];
  const selectableRows = rows.filter((r) => r.kind !== 'header' && r.disabled !== true);
  // 光标可能停在分组标题/禁用行上（初始 0 或鼠标），回车与高亮一律落到第一个可选行
  const currentRow = rows[cursor];
  const activeRow =
    currentRow === undefined || currentRow.kind === 'header' || currentRow.disabled === true
      ? selectableRows[0]
      : currentRow;

  const buildIndex = useMutation({
    mutationFn: (projectId: string) => api.post('/api/search/index', { projectId }),
    onSuccess: () => {
      void message.info('已开始建立内容索引（可在状态栏查看进度）');
      void queryClient.invalidateQueries({ queryKey: ['index-status'] });
    },
  });

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (argValues !== null) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setArgValues(null);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const curIdx = selectableRows.findIndex((r) => r.key === rows[cursor]?.key);
      const next = selectableRows[Math.min(curIdx + 1, selectableRows.length - 1)];
      if (next !== undefined) setCursor(rows.indexOf(next));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const curIdx = selectableRows.findIndex((r) => r.key === rows[cursor]?.key);
      const prev = selectableRows[Math.max(curIdx - 1, 0)];
      if (prev !== undefined) setCursor(rows.indexOf(prev));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = activeRow;
      if (row === undefined) return;
      if (row.kind === 'command') {
        row.run();
      } else {
        row.run();
        setPalette(false);
      }
    } else if (e.key === 'Escape') {
      setPalette(false);
    }
  };

  const argProjects = projects ?? [];

  return (
    <Modal
      open={paletteOpen}
      onCancel={() => setPalette(false)}
      footer={null}
      closable={false}
      width={680}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ padding: 8 }}>
        <Space direction="vertical" style={{ width: '100%' }} size={6}>
          <Space style={{ width: '100%' }}>
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(0);
                setArgValues(null);
              }}
              onKeyDown={onKeyDown}
              placeholder={
                mode === 'command'
                  ? '输入命令名筛选（模糊匹配，↑↓ 选择，回车执行）'
                  : '搜索项目 / 文件名 / 文件内容，或输入 > 进入命令模式…'
              }
              size="large"
              variant="borderless"
              data-testid="palette-input"
              autoFocus
            />
            {mode === 'search' ? (
              <Segmented
                size="small"
                value={scope}
                onChange={(v) => setScope(v as 'all' | 'project')}
                options={[
                  { label: '全部', value: 'all' },
                  { label: '当前项目', value: 'project' },
                ]}
              />
            ) : (
              <Tag color="geekblue" data-testid="palette-command-mode">
                命令
              </Tag>
            )}
          </Space>
          {/* 当前没有活动项目时「当前项目」作用域会静默回落为全库搜索——明示，不让用户以为过滤生效 */}
          {mode === 'search' && scope === 'project' && activeProjectId === null && (
            <div style={{ fontSize: 12, opacity: 0.6, padding: '0 8px' }}>
              当前没有打开的项目，正在搜索全部项目
            </div>
          )}
          {argValues !== null && (
            <div
              style={{
                padding: '8px 8px 12px',
                borderTop: `1px solid ${SEMANTIC.split}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
              data-testid="palette-args"
            >
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                {argValues.title} — {argValues.args?.label ?? '选择参数'}
              </div>
              <Select
                mode="multiple"
                size="small"
                style={{ width: '100%' }}
                placeholder="选择项目"
                value={picked}
                onChange={setPicked}
                options={argProjects.map((p) => ({
                  value: p.id,
                  label: p.alias !== null ? `${p.alias}（${p.diskName}）` : p.diskName,
                }))}
              />
              <Space>
                <Button
                  type="primary"
                  size="small"
                  disabled={picked.length === 0}
                  onClick={() => {
                    runCommand(argValues, { projectIds: picked });
                    setArgValues(null);
                  }}
                  data-testid="palette-args-run"
                >
                  执行
                </Button>
                <Button size="small" onClick={() => setArgValues(null)}>
                  取消
                </Button>
              </Space>
            </div>
          )}
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            {rows.length === 0 && qEff.trim() !== '' && (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无结果" style={{ padding: 24 }} />
            )}
            {mode === 'search' && (search?.unindexedProjects ?? []).length > 0 && (
              <div style={{ padding: '6px 8px' }}>
                <span style={{ fontSize: 12, marginRight: 8 }}>以下项目尚未建立内容索引：</span>
                {search?.unindexedProjects.slice(0, 5).map((pid) => {
                  const name = projectHits.find((p) => p.projectId === pid)?.name ?? pid;
                  return (
                    <Tag
                      key={pid}
                      color="blue"
                      style={{ cursor: 'pointer' }}
                      onClick={() => buildIndex.mutate(pid)}
                    >
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
                  if (row.kind === 'header' || row.disabled === true) return;
                  row.run();
                }}
                style={{
                  padding: row.kind === 'header' ? '8px 10px 2px' : '6px 10px',
                  borderRadius: 6,
                  cursor: row.kind === 'header' || row.disabled === true ? 'default' : 'pointer',
                  opacity: row.disabled === true ? 0.45 : 1,
                  background:
                    row.kind !== 'header' && row.key === activeRow?.key ? SEMANTIC.primaryBg : 'transparent',
                }}
                onMouseEnter={() => {
                  if (row.kind !== 'header') setCursor(i);
                }}
                data-testid={`palette-row-${row.kind}`}
              >
                {row.title}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, opacity: 0.55, padding: '0 8px 4px' }}>
            {mode === 'command'
              ? '命令模式：分类分组 · 最近使用置顶 · > 前缀与 Ctrl+Shift+P 均可进入 · Esc 关闭'
              : 'Ctrl+K 搜索 · 输入 > 进入命令模式 · Ctrl+Shift+P 命令模式 · ? 快捷键帮助'}
          </div>
        </Space>
      </div>
    </Modal>
  );
}
