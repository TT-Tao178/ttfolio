/**
 * 关闭标签的统一入口（评审：此前「关闭逻辑」内联在 TabBar，Ctrl+W 走 store.closeTab
 * 对脏标签静默拦截、无任何反馈——同一动作两种行为）。× 按钮、Ctrl+W、后续批量关闭
 * 共用：有未保存改动先弹确认，确认放弃后清理脏标记再关。
 */
import { App as AntdApp } from 'antd';
import { useAppStore, type Tab } from './store';

export function useCloseTab(): (tab: Tab) => void {
  const { modal } = AntdApp.useApp();
  return (tab: Tab): void => {
    const key = tab.projectId !== null && tab.targetPath !== null ? `${tab.projectId}|${tab.targetPath}` : null;
    if (key !== null && useAppStore.getState().dirty.has(key)) {
      modal.confirm({
        title: '标签内有未保存的改动',
        content: '关闭前请先保存（Ctrl+S），或放弃改动。',
        okText: '放弃改动并关闭',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => {
          useAppStore.getState().clearDirty(key);
          useAppStore.getState().closeTab(tab.id);
        }
      });
      return;
    }
    useAppStore.getState().closeTab(tab.id);
  };
}
