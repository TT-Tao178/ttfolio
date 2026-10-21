/**
 * 插件清单校验（FR-14.1 / T-101）。
 *
 * 分期：T0 声明式（JSON 清单贡献命令/信息卡，零代码）；T1 脚本（本地目录
 * Node 脚本，宿主注入受控 API 子集，不提供文件系统句柄）。T2（进程外沙箱）
 * 不在本版承诺范围内。
 */
import { z } from 'zod';

/** 可申请的权限（白名单；清单里写别的直接拒绝）。 */
export const PLUGIN_PERMISSIONS = [
  'projects.read', // 读项目元数据（名称/类型/规模/标签）
  'analysis.trigger', // 触发项目重新分析
  'panel.output', // 向插件页输出日志
  'commands.contribute', // 贡献命令（进命令面板）
] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('openTab'),
    tab: z.enum(['files', 'git', 'docs', 'archives', 'overview', 'media']),
  }),
  z.object({ type: z.literal('message'), text: z.string().min(1).max(500) }),
  z.object({ type: z.literal('run') }),
]);

const commandSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(80),
  category: z.string().max(20).optional(),
  action: actionSchema,
});

const cardSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(80),
  /** 数字来源：只允许宿主提供的只读统计（不给任意查询） */
  source: z.enum(['projects.count', 'projects.archived', 'analysis.failed']),
});

export const pluginManifestSchema = z.object({
  id: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, 'id 只能用小写字母/数字/点/下划线/连字符'),
  name: z.string().min(1).max(60),
  version: z.string().min(1).max(20),
  author: z.string().max(60).optional(),
  description: z.string().max(500).optional(),
  kind: z.enum(['declarative', 'script']),
  permissions: z.array(z.enum(PLUGIN_PERMISSIONS)).default([]),
  contributes: z
    .object({
      commands: z.array(commandSchema).max(20).default([]),
      cards: z.array(cardSchema).max(10).default([]),
    })
    .default({ commands: [], cards: [] }),
  /** 脚本插件：相对插件目录的入口文件（必须落在目录内） */
  main: z.string().max(200).optional(),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  author: string | null;
  kind: 'declarative' | 'script';
  enabled: boolean;
  builtin: boolean;
  installedAt: string;
  dirPath: string | null;
  description: string | null;
  permissions: PluginPermission[];
  commands: Array<{
    id: string;
    title: string;
    category: string | null;
    action: z.infer<typeof actionSchema>;
  }>;
  cards: Array<{ id: string; title: string; source: string }>;
}

/** 校验结果：成功给规范化清单，失败给可读原因（不抛异常，路由层转 400）。 */
export function validateManifest(
  raw: unknown,
): { ok: true; manifest: PluginManifest } | { ok: false; error: string } {
  const parsed = pluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `清单不合法：${first?.path.join('.') ?? ''} ${first?.message ?? ''}` };
  }
  const m = parsed.data;
  if (m.kind === 'script' && (m.main === undefined || m.main === '')) {
    return { ok: false, error: '脚本插件必须声明 main（入口文件）' };
  }
  const ids = new Set<string>();
  for (const c of m.contributes.commands) {
    if (ids.has(c.id)) return { ok: false, error: `命令 id 重复：${c.id}` };
    ids.add(c.id);
  }
  return { ok: true, manifest: m };
}

/** main 必须是插件目录内的相对路径（绝对路径/含 .. 段一律拒绝；调用方另做 realpath 复核）。 */
export function isSafeMainPath(main: string): boolean {
  if (main === '' || /^[a-zA-Z]:/.test(main)) return false;
  // 绝对路径（/x 或 \x）与任何 .. 段都拒绝：只允许目录内相对路径
  if (/^[\\/]/.test(main)) return false;
  return !main.split(/[\\/]/).includes('..');
}
