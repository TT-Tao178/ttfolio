/** 浏览器式标签条（FR-1.2/1.3）：dnd-kit 拖动排序、复用/关闭/固定、未保存提示、失效标红。 */
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { App as AntdApp, Dropdown } from 'antd';
import {
  CloseOutlined,
  PushpinOutlined,
  FileTextOutlined,
  FolderOutlined,
  SearchOutlined,
  SettingOutlined,
  DeleteOutlined,
  PictureOutlined,
  BookOutlined,
  AppstoreOutlined,
  BranchesOutlined,
} from '@ant-design/icons';
import React, { useEffect, useRef } from 'react';
import { useAppStore, type Tab } from '@/app/store';
import { useCloseTab } from '@/app/useCloseTab';
import { SEMANTIC } from '@/theme/tokens';

function kindIcon(t: Tab): React.JSX.Element {
  switch (t.kind) {
    case 'project':
      return <FolderOutlined />;
    case 'file':
      return <FileTextOutlined />;
    case 'git':
      return <BranchesOutlined />;
    case 'archive':
      return <AppstoreOutlined />;
    case 'doc':
      return <BookOutlined />;
    case 'image':
      return <PictureOutlined />;
    case 'search':
      return <SearchOutlined />;
    case 'settings':
      return <SettingOutlined />;
    case 'trash':
      return <DeleteOutlined />;
    default:
      return <FileTextOutlined />;
  }
}

function SortableTab({
  tab,
  active,
  onActivate,
  onClose,
}: {
  tab: Tab;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  });
  return (
    <div
      ref={setNodeRef}
      data-active={active ? '1' : '0'}
      style={
        {
          transform: CSS.Transform.toString(transform),
          transition,
          zIndex: isDragging ? 10 : 1,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 8px 0 12px',
          height: 34,
          borderRadius: 8,
          cursor: 'pointer',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          background: active ? SEMANTIC.primaryBg : 'transparent',
          border: active ? `1px solid ${SEMANTIC.primaryBorder}` : '1px solid transparent',
          color: tab.invalid !== null ? SEMANTIC.error : 'inherit',
          maxWidth: 200,
          // 顶栏根容器是窗口拖拽区（第 89 轮）：标签必须显式 no-drag，
          // 否则点击/右键菜单/拖动排序/中键关闭全被拖拽区吞掉
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties
      }
      onClick={onActivate}
      onAuxClick={(e) => {
        if (e.button === 1) onClose();
      }}
      {...attributes}
      {...listeners}
    >
      {kindIcon(tab)}
      <span className="tt-ellipsis" style={{ flex: 1 }} data-testid="tab-title">
        {tab.isPinned ? <PushpinOutlined style={{ marginRight: 4 }} /> : null}
        {tab.title}
        {tab.invalid !== null ? ' ⚠' : ''}
      </span>
      <CloseOutlined
        style={{ fontSize: 10, padding: 3, borderRadius: 4 }}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
    </div>
  );
}

export function TabBar(): React.JSX.Element {
  // 体检 P2：全量订阅使编辑器每次键入（dirty 变化）都重渲染整条标签栏及所有订阅组件；
  // 拆为按字段选择订阅后，键入只波及真正依赖 dirty 的组件
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activateTab = useAppStore((s) => s.activateTab);
  const moveTab = useAppStore((s) => s.moveTab);
  const togglePin = useAppStore((s) => s.togglePin);
  const dirty = useAppStore((s) => s.dirty);
  const closedTabs = useAppStore((s) => s.closedTabs);
  const reopenLastClosed = useAppStore((s) => s.reopenLastClosed);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const { message } = AntdApp.useApp();
  // 关闭逻辑抽到 useCloseTab 共享（× / Ctrl+W / 右键菜单同一套未保存确认）
  const closeTabConfirmed = useCloseTab();

  /** 批量关闭（关闭其他/右侧/全部）：固定标签保留；含未保存改动的跳过并提示数量 */
  const closeMany = (pred: (t: Tab, index: number) => boolean): void => {
    let skipped = 0;
    tabs.forEach((t, index) => {
      if (t.isPinned || !pred(t, index)) return;
      const key = t.projectId !== null && t.targetPath !== null ? `${t.projectId}|${t.targetPath}` : null;
      if (key !== null && dirty.has(key)) {
        skipped++;
        return;
      }
      useAppStore.getState().closeTab(t.id);
    });
    if (skipped > 0) void message.info(`${skipped} 个含未保存改动的标签未关闭`);
  };

  const onDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e;
    if (over === null || active.id === over.id) return;
    const from = tabs.findIndex((t) => t.id === active.id);
    const to = tabs.findIndex((t) => t.id === over.id);
    moveTab(from, to);
  };

  // 标签多到超出宽度时会被静默裁掉（实测 6 个标签 1429px 内容塞在 676px 容器里、
  // overflow-x:hidden，右侧标签既看不见也点不到）。改成可横向滚动 + 激活标签自动滚入视野。
  const barRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const bar = barRef.current;
    if (bar === null) return;
    const active = bar.querySelector<HTMLElement>('[data-active="1"]');
    if (active !== null) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId, tabs.length]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
        <div
          ref={barRef}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flex: 1,
            minWidth: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
          }}
          data-testid="tab-bar"
        >
          {tabs.map((tab) => (
            <Dropdown
              key={tab.id}
              trigger={['contextMenu']}
              menu={{
                items: [
                  {
                    key: 'reopen',
                    label: '恢复已关闭标签',
                    disabled: closedTabs.length === 0,
                    onClick: () => reopenLastClosed(),
                  },
                  { type: 'divider' as const },
                  {
                    key: 'pin',
                    label: tab.isPinned ? '取消固定' : '固定标签',
                    onClick: () => togglePin(tab.id),
                  },
                  { key: 'close', label: '关闭', onClick: () => closeTabConfirmed(tab) },
                  { type: 'divider' as const },
                  {
                    key: 'closeOthers',
                    label: '关闭其他标签（保留固定）',
                    onClick: () => closeMany((t) => t.id !== tab.id),
                  },
                  {
                    key: 'closeRight',
                    label: '关闭右侧标签',
                    onClick: () => {
                      const idx = tabs.findIndex((t) => t.id === tab.id);
                      closeMany((t, i) => i > idx);
                    },
                  },
                  {
                    key: 'closeAll',
                    label: '关闭全部标签（保留固定）',
                    onClick: () => closeMany(() => true),
                  },
                ],
              }}
            >
              <div style={{ display: 'inline-flex' }}>
                <SortableTab
                  tab={tab}
                  active={tab.id === activeTabId}
                  onActivate={() => activateTab(tab.id)}
                  onClose={() => closeTabConfirmed(tab)}
                />
              </div>
            </Dropdown>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
