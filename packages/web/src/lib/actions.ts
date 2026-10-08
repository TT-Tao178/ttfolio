/** 统一 Action 注册表（C-55 / UI-9）：命令面板与快捷键共用一份定义。 */
import type { App as AntdApp } from 'antd';

export type ActionLevel = 'L0' | 'L1' | 'L2' | 'L3';

export interface ActionCtx {
  message: ReturnType<(typeof AntdApp)['useApp']>['message'];
  modal: ReturnType<(typeof AntdApp)['useApp']>['modal'];
}

export interface Action {
  id: string;
  title: string;
  group: string;
  keys?: string;
  level: ActionLevel;
  when?: () => boolean;
  danger?: { explain: string; confirmText?: string };
  run: (ctx: ActionCtx) => void | Promise<void>;
}

const registry = new Map<string, Action>();

export function registerActions(actions: Action[]): void {
  for (const a of actions) registry.set(a.id, a);
}

export function allActions(): Action[] {
  return [...registry.values()];
}

export function findAction(id: string): Action | undefined {
  return registry.get(id);
}

export function actionsByKeys(key: string): Action | undefined {
  return registry.get(key);
}
