/** 插件贡献 → 命令项（FR-14.1 / T-101）：声明式命令在面板里直接执行。 */
import { api } from '@/lib/api';
import type { CommandDef } from '@/features/command/registry';

export interface PluginAction {
  type: 'openTab' | 'message' | 'run';
  tab?: 'files' | 'git' | 'docs' | 'archives' | 'overview' | 'media';
  text?: string;
}

export interface PluginContribution {
  pluginId: string;
  pluginName: string;
  command: { id: string; title: string; category: string | null; action: PluginAction };
}

export function toCommandDefs(list: PluginContribution[]): CommandDef[] {
  return list.map((pc) => ({
    id: `plugin.${pc.pluginId}.${pc.command.id}`,
    title: pc.command.title,
    category: '插件',
    run: async (ctx) => {
      const action = pc.command.action;
      if (action.type === 'message') {
        ctx.message.info(action.text ?? pc.pluginName);
        return;
      }
      if (action.type === 'openTab') {
        if (ctx.activeProjectId === null) {
          ctx.message.info('该插件命令需要先打开一个项目');
          return;
        }
        ctx.store.openTab(
          {
            kind: 'project',
            projectId: ctx.activeProjectId,
            targetPath: null,
            subTab: action.tab ?? 'overview',
            scroll: 0,
          },
          ctx.activeProjectName ?? pc.pluginName,
        );
        return;
      }
      const r = await api.post<{ ok: boolean; output: string[]; error: string | null }>(
        `/api/plugins/${pc.pluginId}/run`,
        {},
      );
      if (r.ok) ctx.message.success(`${pc.pluginName}：执行完成（${r.output.length} 行输出）`);
      else ctx.message.error(`${pc.pluginName}：${r.error ?? '执行失败'}`);
    },
    needsProject: pc.command.action.type === 'openTab',
  }));
}
