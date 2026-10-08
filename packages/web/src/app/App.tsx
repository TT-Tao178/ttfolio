/** 应用壳（3.1）：顶栏(标签) + 路径条 + 域条/侧栏/内容/详情 + 状态栏；SSE、快捷键、会话恢复。 */
import { Button, Space, Tooltip, Alert, App as AntdApp } from 'antd';
import { PlusOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import React, { useCallback, useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/qc';
import { SettingsProvider, useSettings } from '@/app/settings';
import { useAppStore, serializeSession } from '@/app/store';
import { useCloseTab } from '@/app/useCloseTab';
import { useSse, type SseState } from '@/app/sse';
import { TabBar } from '@/components/TabBar';
import { PathBar } from '@/components/PathBar';
import { StatusBar } from '@/components/StatusBar';
import { DomainRail } from '@/components/DomainRail';
import { PaneSplit } from '@/components/PaneSplit';
import { Sidebar } from '@/components/Sidebar';
import { DetailPanel } from '@/components/DetailPanel';
import { Workbench } from '@/features/workbench/Workbench';
import { ProjectPage } from '@/features/project/ProjectPage';
import { TrashPage } from '@/features/trash/TrashPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { CommandPalette } from '@/features/search/CommandPalette';
import { GitOverview, GitTab } from '@/features/git/GitTab';
import { CommitView } from '@/features/git/CommitView';
import { api } from '@/lib/api';
import { SEMANTIC } from '@/theme/tokens';
import type { HealthInfo, SessionData } from '@ttfolio/shared';

/** 内容区错误边界：某个视图渲染崩溃时只降级本面板并给出提示，绝不卸载整棵应用树。 */
class PaneErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  override render(): React.ReactNode {
    if (this.state.error !== null) {
      return (
        <Alert
          type="error"
          style={{ margin: 16 }}
          message="这个视图渲染出错"
          description={this.state.error.message}
          action={
            <Button size="small" onClick={() => this.setState({ error: null })}>
              重试
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}

function Shell(): React.JSX.Element {
  const { tabs, activeTabId, openTab, paletteOpen, setPalette, updateActiveLocation } = useAppStore();
  const { dark, settings } = useSettings();
  const { message } = AntdApp.useApp();
  const [sseState, setSseState] = useState<SseState>('connecting');
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  // Ctrl+W 与标签 × 同一套关闭逻辑（评审：此前 Ctrl+W 对脏标签静默拦截无反馈）
  const closeTabConfirmed = useCloseTab();
  // 右栏开关必须是响应式选择器：原先在渲染里读 useAppStore.getState().detailVisible，
  // 切换后不会触发重渲染（开关"没反应"）。
  const detailVisible = useAppStore((s) => s.detailVisible);
  const setDetail = useAppStore((s) => s.setDetail);

  const onSseState = useCallback((s: SseState) => setSseState(s), []);
  useSse(onSseState, (e) => {
    if (e.event === 'notice') {
      const lvl = (e.data['level'] as string) ?? 'info';
      const msg = String(e.data['message'] ?? '');
      if (lvl === 'error') void message.error(msg);
      else if (lvl === 'warning') void message.warning(msg);
      else void message.info(msg);
    }
  });

  // 会话恢复（FR-1.4）：启动时 GET /api/session；变更 1s 防抖 PUT
  useEffect(() => {
    void api
      .get<SessionData>('/api/session')
      .then((s) => {
        if (s.tabs.length > 0) {
          useAppStore.getState().syncFromServer(s.tabs as never, s.activeTabId);
        } else {
          openTab({ kind: 'overview', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '工作台');
        }
      })
      .catch(() =>
        openTab({ kind: 'overview', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '工作台'),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tabs.length === 0) return;
    const t = setTimeout(() => {
      void api.put('/api/session', serializeSession(tabs, activeTabId)).catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, [tabs, activeTabId]);

  // 全局快捷键（3.6 / FR-11.4）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      const inInput = (e.target as HTMLElement | null)?.tagName?.match(/INPUT|TEXTAREA/) !== null;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(!paletteOpen);
      } else if (mod && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        const tab = tabs.find((t) => t.id === activeTabId);
        if (tab !== undefined) closeTabConfirmed(tab);
      } else if (mod && e.key === 'Tab') {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const next = tabs[(idx + (e.shiftKey ? -1 : 1) + tabs.length) % Math.max(tabs.length, 1)];
        if (next !== undefined) useAppStore.getState().activateTab(next.id);
      } else if (e.altKey && e.key === 'ArrowLeft') {
        updateActiveLocation({}, false);
        useAppStore.getState().navigate(-1);
      } else if (e.altKey && e.key === 'ArrowRight') {
        useAppStore.getState().navigate(1);
      } else if (mod && e.key.toLowerCase() === 'b') {
        // 右栏开关（与原型一致：Ctrl/⌘+B）
        e.preventDefault();
        setDetail(!useAppStore.getState().detailVisible);
      } else if (mod && e.key === ',') {
        e.preventDefault();
        openTab({ kind: 'settings', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '设置');
      } else if (e.key === '?' && !inInput) {
        void message.info(
          '快捷键：Ctrl+K 面板 · Ctrl+W 关标签 · Ctrl+Tab 切标签 · Alt+←/→ 前进后退 · Ctrl+S 保存 · 1-5 切项目页签 · F2 重命名 · Delete 删除 · Ctrl+, 设置',
        );
      } else if (!inInput && /^[1-5]$/.test(e.key) && activeTab?.kind === 'project') {
        const map = ['overview', 'files', 'git', 'archives', 'docs'];
        const sub = map[Number(e.key) - 1];
        if (sub !== undefined) updateActiveLocation({ subTab: sub }, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    paletteOpen,
    setPalette,
    tabs,
    activeTabId,
    activeTab,
    closeTabConfirmed,
    updateActiveLocation,
    openTab,
    message,
    setDetail,
  ]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶栏：标签 + 搜索/导入/设置（品牌区 logo+名称已去除——与系统窗口标题栏/任务栏重复，第 27 轮）。高度对齐《界面原型-AntD.html》#top = 56px */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          height: 56,
          padding: '0 12px',
          borderBottom: `1px solid ${SEMANTIC.split}`,
        }}
      >
        <Space size={6}>
          <span style={{ fontSize: 12, opacity: 0.6 }}>a local project workbench</span>
        </Space>
        <div style={{ flex: 1, minWidth: 0, marginLeft: 8 }}>
          <TabBar />
        </div>
        <Space size={8}>
          {/* 搜索 pill（对齐原型 3.1）：点击等价 Ctrl+K */}
          <Button
            onClick={() => setPalette(true)}
            data-testid="palette-btn"
            icon={<SearchOutlined />}
            style={{
              width: 300,
              justifyContent: 'flex-start',
              color: SEMANTIC.textTertiary,
              background: SEMANTIC.layoutBg,
              borderColor: SEMANTIC.split,
            }}
          >
            <span style={{ flex: 1, textAlign: 'left', fontSize: 13 }}>搜索项目 / 文件名 / 文件内容</span>
            <span style={{ fontSize: 12, opacity: 0.7 }}>Ctrl K</span>
          </Button>
          <Tooltip title="添加项目（粘贴路径 / 系统对话框 / 父目录批量登记）">
            <Button
              icon={<PlusOutlined />}
              data-testid="top-add-btn"
              onClick={() => {
                openTab(
                  { kind: 'overview', projectId: null, targetPath: null, subTab: null, scroll: 0 },
                  '工作台',
                );
                useAppStore.getState().requestAddProject();
              }}
            >
              导入
            </Button>
          </Tooltip>
          <Tooltip title="设置 (Ctrl+,)">
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() =>
                openTab(
                  { kind: 'settings', projectId: null, targetPath: null, subTab: null, scroll: 0 },
                  '设置',
                )
              }
            />
          </Tooltip>
        </Space>
      </div>

      <PathBar />

      {/* 主体四栏：域条(固定) | 侧栏(可拖) | 内容 | 详情(可拖，可折叠) */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0 }}>
        <DomainRail />
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <PaneSplit
            sizeKey="sidebarWidth"
            defaultSize={232}
            min={160}
            max={420}
            testId="split-sidebar"
            left={
              <div style={{ height: '100%', overflow: 'auto' }}>
                <Sidebar />
              </div>
            }
            right={
              <PaneSplit
                sizeKey="detailWidth"
                defaultSize={320}
                min={220}
                max={560}
                measure="last"
                collapsed={!detailVisible || activeTab === null || activeTab.projectId === null}
                onExpand={() => setDetail(true)}
                collapsible={false}
                testId="split-detail"
                left={
                  <div
                    style={{ height: '100%', minWidth: 0, background: SEMANTIC.layoutBg, overflow: 'hidden' }}
                  >
                    <PaneErrorBoundary>
                      {activeTab === null ? (
                        <div />
                      ) : activeTab.kind === 'overview' ? (
                        <Workbench subTab={activeTab.subTab} />
                      ) : activeTab.kind === 'project' && activeTab.projectId !== null ? (
                        <ProjectPage projectId={activeTab.projectId} subTab={activeTab.subTab} />
                      ) : activeTab.kind === 'trash' ? (
                        <TrashPage />
                      ) : activeTab.kind === 'settings' ? (
                        <SettingsPage anchor={activeTab.subTab} />
                      ) : activeTab.kind === 'git' && activeTab.projectId !== null ? (
                        // 提交历史点开的独立 git 标签：原先没有渲染分支 → 整页空白（用户报障）
                        activeTab.subTab === 'commit' && activeTab.targetPath !== null ? (
                          <CommitView projectId={activeTab.projectId} hash={activeTab.targetPath} />
                        ) : (
                          <GitTab projectId={activeTab.projectId} />
                        )
                      ) : activeTab.subTab === 'git-overview' ? (
                        <GitOverview />
                      ) : (
                        <div />
                      )}
                    </PaneErrorBoundary>
                  </div>
                }
                right={
                  <div style={{ height: '100%', overflow: 'auto' }}>
                    {activeTab !== null && activeTab.projectId !== null && (
                      <DetailPanel projectId={activeTab.projectId} />
                    )}
                  </div>
                }
              />
            }
          />
        </div>
      </div>

      <StatusBar sseState={sseState} />
      <CommandPalette />
      <span
        data-testid="app-theme"
        data-dark={dark ? '1' : '0'}
        data-default-tab={settings.defaultProjectTab}
        hidden
      />
    </div>
  );
}

export function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <Shell />
      </SettingsProvider>
    </QueryClientProvider>
  );
}

export { api };
export type { HealthInfo };
