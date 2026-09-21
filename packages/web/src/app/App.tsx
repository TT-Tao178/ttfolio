/** 应用壳（3.1）：顶栏(标签) + 路径条 + 域条/侧栏/内容/详情 + 状态栏；SSE、快捷键、会话恢复。 */
import { Avatar, Button, Space, Tooltip, App as AntdApp } from 'antd';
import { PlusOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import React, { useCallback, useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/qc';
import { SettingsProvider, useSettings } from '@/app/settings';
import { useAppStore, serializeSession } from '@/app/store';
import { useSse, type SseState } from '@/app/sse';
import { TabBar } from '@/components/TabBar';
import { PathBar } from '@/components/PathBar';
import { StatusBar } from '@/components/StatusBar';
import { DomainRail } from '@/components/DomainRail';
import { Sidebar } from '@/components/Sidebar';
import { DetailPanel } from '@/components/DetailPanel';
import { Workbench } from '@/features/workbench/Workbench';
import { ProjectPage } from '@/features/project/ProjectPage';
import { TrashPage } from '@/features/trash/TrashPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { CommandPalette } from '@/features/search/CommandPalette';
import { GitOverview } from '@/features/git/GitTab';
import { api } from '@/lib/api';
import type { HealthInfo, SessionData } from '@ttfolio/shared';

function Shell(): React.JSX.Element {
  const { tabs, activeTabId, openTab, closeTab, paletteOpen, setPalette, updateActiveLocation } = useAppStore();
  const { dark, settings } = useSettings();
  const { message } = AntdApp.useApp();
  const [sseState, setSseState] = useState<SseState>('connecting');
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

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
      .catch(() => openTab({ kind: 'overview', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '工作台'));
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
        if (activeTabId !== null) closeTab(activeTabId);
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
      } else if (mod && e.key === ',') {
        e.preventDefault();
        openTab({ kind: 'settings', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '设置');
      } else if (e.key === '?' && !inInput) {
        void message.info('快捷键：Ctrl+K 面板 · Ctrl+W 关标签 · Ctrl+Tab 切标签 · Alt+←/→ 前进后退 · Ctrl+S 保存 · 1-5 切项目页签 · F2 重命名 · Delete 删除 · Ctrl+, 设置');
      } else if (!inInput && /^[1-5]$/.test(e.key) && activeTab?.kind === 'project') {
        const map = ['overview', 'files', 'git', 'archives', 'docs'];
        const sub = map[Number(e.key) - 1];
        if (sub !== undefined) updateActiveLocation({ subTab: sub }, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, setPalette, tabs, activeTabId, activeTab, closeTab, updateActiveLocation, openTab, message]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶栏：LOGO + 标签 + 搜索/导入/设置 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: '1px solid rgba(128,128,128,.15)' }}>
        <Space size={6}>
          <Avatar shape="square" size={26} style={{ background: '#1677ff', fontWeight: 700 }}>tf</Avatar>
          <strong>ttFolio</strong>
          <span style={{ fontSize: 12, opacity: 0.6 }}>tt项目仓库 · a local project workbench</span>
        </Space>
        <div style={{ flex: 1, minWidth: 0, marginLeft: 8 }}>
          <TabBar />
        </div>
        <Space size={2}>
          <Tooltip title="搜索与命令面板 (Ctrl+K)">
            <Button type="text" icon={<SearchOutlined />} onClick={() => setPalette(true)} data-testid="palette-btn" />
          </Tooltip>
          <Tooltip title="添加项目">
            <Button type="text" icon={<PlusOutlined />} onClick={() => openTab({ kind: 'overview', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '工作台')} />
          </Tooltip>
          <Tooltip title="设置 (Ctrl+,)">
            <Button type="text" icon={<SettingOutlined />} onClick={() => openTab({ kind: 'settings', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '设置')} />
          </Tooltip>
        </Space>
      </div>

      <PathBar />

      {/* 主体四栏 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <DomainRail />
        <div style={{ width: 220, borderRight: '1px solid rgba(128,128,128,.15)', overflow: 'auto' }}>
          <Sidebar />
        </div>
        <div style={{ flex: 1, minWidth: 0, background: dark ? 'transparent' : '#f5f5f5', overflow: 'hidden' }}>
          {activeTab === null ? (
            <div />
          ) : activeTab.kind === 'overview' ? (
            <Workbench subTab={activeTab.subTab} />
          ) : activeTab.kind === 'project' && activeTab.projectId !== null ? (
            <ProjectPage projectId={activeTab.projectId} subTab={activeTab.subTab} />
          ) : activeTab.kind === 'trash' ? (
            <TrashPage />
          ) : activeTab.kind === 'settings' ? (
            <SettingsPage />
          ) : activeTab.subTab === 'git-overview' ? (
            <GitOverview />
          ) : activeTab.kind === 'git' && activeTab.targetPath !== null && activeTab.projectId !== null ? (
            <div />
          ) : (
            <div />
          )}
        </div>
        {useAppStore.getState().detailVisible && activeTab !== null && activeTab.projectId !== null && (
          <div style={{ width: 280, borderLeft: '1px solid rgba(128,128,128,.15)', overflow: 'auto' }}>
            <DetailPanel projectId={activeTab.projectId} />
          </div>
        )}
      </div>

      <StatusBar sseState={sseState} />
      <CommandPalette />
      <span data-testid="app-theme" data-dark={dark ? '1' : '0'} data-default-tab={settings.defaultProjectTab} hidden />
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
