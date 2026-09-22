/** 路径条（FR-1.5）：前进/后退/刷新 + Breadcrumb + 主题/密度/右栏开关。 */
import { Breadcrumb, Button, Dropdown, Space, Tooltip } from 'antd';
import {
  ArrowLeftOutlined, ArrowRightOutlined, ReloadOutlined,
  BgColorsOutlined, ColumnWidthOutlined, BorderRightOutlined
} from '@ant-design/icons';
import React from 'react';
import { navAvailability, useAppStore, type Tab, type TabLocation } from '@/app/store';
import { useSettings } from '@/app/settings';
import { useQueryClient } from '@tanstack/react-query';
import { SEMANTIC } from '@/theme/tokens';

export function PathBar(): React.JSX.Element {
  const { activeTabId, navigate, tabs } = useAppStore();
  const { settings, setSetting } = useSettings();
  const queryClient = useQueryClient();
  const tab = tabs.find((t) => t.id === activeTabId) ?? null;
  // 置灰而不是"按了没反应"：无历史可退时按钮必须是禁用态（原实现两个按钮永远可点但无效）
  const nav = navAvailability(tab);

  const crumbs = buildCrumbs(tab);

  const themeMenu = {
    items: [
      { key: 'light', label: '浅色（默认）' },
      { key: 'dark', label: '深色' },
      { key: 'system', label: '跟随系统' }
    ],
    selectable: true,
    selectedKeys: [settings.theme],
    onClick: (e: { key: string }) => setSetting('theme', e.key)
  };
  const densityMenu = {
    items: [
      { key: 'small', label: '紧凑' },
      { key: 'middle', label: '标准' },
      { key: 'large', label: '舒适' }
    ],
    selectable: true,
    selectedKeys: [settings.density],
    onClick: (e: { key: string }) => setSetting('density', e.key)
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 12px', borderBottom: `1px solid ${SEMANTIC.split}` }}>
      <Space.Compact>
        <Tooltip title={nav.back ? '后退 (Alt+←)' : '没有可后退的历史'}>
          <Button size="small" type="text" icon={<ArrowLeftOutlined />} disabled={!nav.back} onClick={() => navigate(-1)} data-testid="nav-back" />
        </Tooltip>
        <Tooltip title={nav.forward ? '前进 (Alt+→)' : '没有可前进的历史'}>
          <Button size="small" type="text" icon={<ArrowRightOutlined />} disabled={!nav.forward} onClick={() => navigate(1)} data-testid="nav-forward" />
        </Tooltip>
        <Tooltip title="刷新视图（重读磁盘内容，不影响未保存的编辑）">
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            data-testid="nav-refresh"
            onClick={() => {
              // 失效全部查询 = 重新拉取所有可见数据；编辑器由 EditorPane 自己做版本判断，
              // 未保存内容不会被覆盖（见 EditorPane 的"版本标识"守卫）。
              void queryClient.invalidateQueries();
            }}
          />
        </Tooltip>
      </Space.Compact>
      <Breadcrumb items={crumbs} style={{ flex: 1 }} data-testid="pathbar-crumbs" />
      <Dropdown menu={themeMenu}>
        <Button size="small" type="text" icon={<BgColorsOutlined />} />
      </Dropdown>
      <Dropdown menu={densityMenu}>
        <Button size="small" type="text" icon={<ColumnWidthOutlined />} />
      </Dropdown>
      <Tooltip title="右栏 (Ctrl+B)">
        <Button
          size="small"
          type="text"
          icon={<BorderRightOutlined />}
          onClick={() => useAppStore.getState().setDetail(!useAppStore.getState().detailVisible)}
        />
      </Tooltip>
    </div>
  );
}

type Crumb = { title: string; onClick?: () => void };

/**
 * 面包屑（FR-1.5：域 / 项目 / 子路径，可逐级点击）。
 *
 * 关键修复（用户报障）：原实现只在 `tab.kind === 'file'` 时补文件名，但项目页打开的文件是挂在
 * **项目标签**上的（`kind === 'project'` + `targetPath`）→ 打开文件后面包屑永远只到「文件」，
 * 看不出当前在看哪个文件。现在凡是有 `targetPath` 就展示相对项目根的子路径，并按 `/` 逐级拆分。
 */
function buildCrumbs(tab: Tab | null): Crumb[] {
  if (tab === null || tab.kind === 'overview') {
    return [{ title: '工作台', onClick: () => goHome() }];
  }
  const crumbs: Crumb[] = [{ title: '工作台', onClick: () => goHome() }];
  if (tab.kind === 'project' && tab.projectId !== null) {
    const projectId = tab.projectId;
    crumbs.push({ title: tab.title === '' ? '项目' : tab.title, onClick: () => openAt({ kind: 'project', projectId, targetPath: null, subTab: 'overview' }) });
    if (tab.subTab !== null) crumbs.push({ title: subTabLabel(tab.subTab) });
  } else {
    if (tab.title !== '') crumbs.push({ title: tab.title });
    if (tab.subTab !== null) crumbs.push({ title: subTabLabel(tab.subTab) });
  }
  // 子路径：把 targetPath 按 / \ 拆成多段，逐段显示（相对项目根，比只显示 basename 更可定位）
  if (tab.targetPath !== null && tab.targetPath !== '') {
    for (const seg of tab.targetPath.split(/[\\/]/).filter((s) => s !== '' && s !== '.')) {
      crumbs.push({ title: seg });
    }
  }
  return crumbs;
}

/** 面包屑"工作台"根：总览标签复用，不存在就新开（与顶栏「导入」按钮同一套语义）。 */
function goHome(): void {
  openAt({ kind: 'overview', projectId: null, targetPath: null, subTab: null });
}

/**
 * 把当前标签导航到某个位置。
 *
 * 用 `openTab` 而不是 `updateActiveLocation`：它带标签复用规则（项目标签的 tabKey 不含
 * targetPath，所以"项目 → 项目/某文件"仍是同一个标签，不会多开同名标签），并会压入历史栈。
 * `targetPath: null` 会被 `updateActiveLocation` 原样写入 →「回到项目根」同时关掉右侧编辑器。
 *
 * 标题按目标位置给：`openTab` 在复用既有标签时会把标题改成传入值，所以这里传当前标签的标题
 * **只在目标仍是同一个项目标签时**成立，否则会把「工作台」标签改叫项目名。
 */
function openAt(loc: Omit<TabLocation, 'scroll'>): void {
  const st = useAppStore.getState();
  const cur = st.tabs.find((t) => t.id === st.activeTabId);
  const title =
    loc.kind === 'overview'
      ? '工作台'
      : loc.kind === 'project' && cur !== undefined && cur.kind === 'project'
        ? cur.title
        : '';
  st.openTab({ ...loc, scroll: 0 }, title);
}

function subTabLabel(sub: string): string {
  switch (sub) {
    case 'overview': return '概览';
    case 'files': return '文件';
    case 'git': return 'Git';
    case 'archives': return '架构图';
    case 'docs': return '文档';
    default: return sub;
  }
}
