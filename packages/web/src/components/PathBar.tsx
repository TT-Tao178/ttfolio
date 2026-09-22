/** 路径条（FR-1.5）：前进/后退/刷新 + Breadcrumb + 主题/密度/右栏开关。 */
import { Breadcrumb, Button, Dropdown, Space, Tooltip } from 'antd';
import {
  ArrowLeftOutlined, ArrowRightOutlined, ReloadOutlined,
  BgColorsOutlined, ColumnWidthOutlined, BorderRightOutlined
} from '@ant-design/icons';
import React from 'react';
import { navAvailability, useAppStore } from '@/app/store';
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

  const crumbs: Array<{ title: string }> = [];
  if (tab === null || tab.kind === 'overview') {
    crumbs.push({ title: '工作台' });
  } else {
    crumbs.push({ title: '工作台' });
    if (tab.title !== '') crumbs.push({ title: tab.title });
    if (tab.subTab !== null) crumbs.push({ title: subTabLabel(tab.subTab) });
    if (tab.targetPath !== null && tab.kind === 'file') crumbs.push({ title: tab.targetPath.split('/').pop() ?? '' });
  }

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
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: `1px solid ${SEMANTIC.split}` }}>
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
      <Breadcrumb items={crumbs} style={{ flex: 1 }} />
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
