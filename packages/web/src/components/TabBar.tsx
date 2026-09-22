/** 浏览器式标签条（FR-1.2/1.3）：dnd-kit 拖动排序、复用/关闭/固定、未保存提示、失效标红。 */
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Dropdown, Modal } from 'antd';
import {
  CloseOutlined, PushpinOutlined, FileTextOutlined, FolderOutlined, SearchOutlined,
  SettingOutlined, DeleteOutlined, PictureOutlined, BookOutlined, AppstoreOutlined, BranchesOutlined
} from '@ant-design/icons';
import React from 'react';
import { useAppStore, type Tab } from '@/app/store';
import { SEMANTIC } from '@/theme/tokens';

function kindIcon(t: Tab): React.JSX.Element {
  switch (t.kind) {
    case 'project': return <FolderOutlined />;
    case 'file': return <FileTextOutlined />;
    case 'git': return <BranchesOutlined />;
    case 'archive': return <AppstoreOutlined />;
    case 'doc': return <BookOutlined />;
    case 'image': return <PictureOutlined />;
    case 'search': return <SearchOutlined />;
    case 'settings': return <SettingOutlined />;
    case 'trash': return <DeleteOutlined />;
    default: return <FileTextOutlined />;
  }
}

function SortableTab({ tab, active, onActivate, onClose }: {
  tab: Tab; active: boolean; onActivate: () => void; onClose: () => void;
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : 1,
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 8px 0 12px', height: 34, borderRadius: 8, cursor: 'pointer',
        userSelect: 'none', whiteSpace: 'nowrap',
        background: active ? SEMANTIC.primaryBg : 'transparent',
        border: active ? `1px solid ${SEMANTIC.primaryBorder}` : '1px solid transparent',
        color: tab.invalid !== null ? SEMANTIC.error : 'inherit',
        maxWidth: 200
      }}
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
  const { tabs, activeTabId, activateTab, closeTab, moveTab, togglePin, dirty } = useAppStore();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [modal, contextHolder] = Modal.useModal();

  const onClose = (tab: Tab): void => {
    const dirtyKey = tab.projectId !== null && tab.targetPath !== null ? `${tab.projectId}|${tab.targetPath}` : null;
    if (dirtyKey !== null && dirty.has(dirtyKey)) {
      void modal.confirm({
        title: '标签内有未保存的改动',
        content: '关闭前请先保存（Ctrl+S），或放弃改动。',
        okText: '放弃改动并关闭',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => {
          useAppStore.getState().clearDirty(dirtyKey);
          closeTab(tab.id);
        }
      });
      return;
    }
    closeTab(tab.id);
  };

  const onDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e;
    if (over === null || active.id === over.id) return;
    const from = tabs.findIndex((t) => t.id === active.id);
    const to = tabs.findIndex((t) => t.id === over.id);
    moveTab(from, to);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, overflow: 'hidden' }} data-testid="tab-bar">
          {tabs.map((tab) => (
            <Dropdown
              key={tab.id}
              trigger={['contextMenu']}
              menu={{
                items: [
                  { key: 'pin', label: tab.isPinned ? '取消固定' : '固定标签', onClick: () => togglePin(tab.id) },
                  { key: 'close', label: '关闭', onClick: () => onClose(tab) }
                ]
              }}
            >
              <div style={{ display: 'inline-flex' }}>
                <SortableTab
                  tab={tab}
                  active={tab.id === activeTabId}
                  onActivate={() => activateTab(tab.id)}
                  onClose={() => onClose(tab)}
                />
              </div>
            </Dropdown>
          ))}
        </div>
      </SortableContext>
      {contextHolder}
    </DndContext>
  );
}
