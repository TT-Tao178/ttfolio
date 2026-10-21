/** Zod schema：所有接口入参的校验定义（API-3 / EN-10），前后端共用。 */
import { z } from 'zod';

export const projectTypeSchema = z.enum([
  'frontend',
  'backend',
  'fullstack',
  'split',
  'monolith',
  'microservice',
  'script',
  'assets',
  'unknown',
]);

// ---------- 系统 ----------
export const settingsPatchSchema = z.record(z.string(), z.unknown());

export const ignoreRuleCreateSchema = z.object({
  scope: z.enum(['global', 'project']).default('global'),
  projectId: z.string().nullish(),
  pattern: z.string().min(1),
  mode: z.enum(['hide', 'analyze_only']).default('hide'),
  enabled: z.boolean().default(true),
});

export const ignoreRuleUpdateSchema = z.object({
  pattern: z.string().min(1).optional(),
  mode: z.enum(['hide', 'analyze_only']).optional(),
  enabled: z.boolean().optional(),
});

export const commandTemplateCreateSchema = z.object({
  label: z.string().min(1),
  executable: z.string().min(1),
  argsJson: z.array(z.string()).min(1),
  needsConfirm: z.boolean().default(true),
  platforms: z.string().nullish(),
  enabled: z.boolean().default(true),
  sortOrder: z.number().default(0),
});

export const commandTemplateUpdateSchema = z.object({
  label: z.string().min(1).optional(),
  executable: z.string().min(1).optional(),
  argsJson: z.array(z.string()).min(1).optional(),
  needsConfirm: z.boolean().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().optional(),
});

export const openExternalSchema = z.object({
  target: z.enum(['explorer', 'terminal', 'template']),
  projectId: z.string(),
  path: z.string().optional(),
  templateId: z.string().optional(),
});

/**
 * FR-11.6「打开日志」：目标是**应用自己的数据目录**（<dataDir>/logs），不属于任何被登记项目，
 * 因此不能复用 openExternalSchema（那个 schema 强制 projectId + 项目内白名单校验）。
 * 这里只接受一个字面量开关，路径由服务端从 ctx.layout 取；`.strict()` 让"多带一个 path 字段"
 * 直接判为参数不合法（zod v3 的 object 默认是**剥掉**未知键而不是报错，不 strict 就变成静默忽略——
 * 可读性上很容易被误读成"客户端能指定路径"）。
 */
export const openLogsSchema = z.object({ target: z.literal('logs') }).strict();

// ---------- 项目 ----------
export const addProjectsSchema = z.union([
  z.object({ paths: z.array(z.string().min(1)).min(1) }),
  z.object({ parentPath: z.string().min(1), children: z.array(z.string().min(1)).min(1) }),
]);

export const projectPatchSchema = z.object({
  rev: z.number().int(),
  alias: z.string().trim().max(100).nullish(),
  type: projectTypeSchema.optional(),
  typeSource: z.enum(['analyzed', 'manual']).optional(),
  notes: z.string().nullish(),
  isPinned: z.boolean().optional(),
  status: z.enum(['active', 'archived']).optional(),
  defaultArchDir: z.string().max(100).optional(),
  /** 资源仓库开关（FR-13.3，默认关；关闭只隐藏页签，数据保留） */
  agentRepoEnabled: z.boolean().optional(),
});

// ---------- Agent 会话（FR-13.3 / T-097） ----------
export const agentSessionPatchSchema = z.object({
  title: z.string().trim().max(200).nullish(),
  summary: z.string().max(8000).nullish(),
});
export const agentSessionSummarySchema = z.object({
  summary: z.string().trim().min(1).max(8000),
});

export const relocateSchema = z.object({ dirPath: z.string().min(1) });

export const renameDiskSchema = z.object({
  newName: z.string().min(1).max(100),
  confirmText: z.string().min(1),
});

export const deleteProjectSchema = z.object({
  mode: z.enum(['unregister', 'delete']).default('unregister'),
  confirm: z.boolean().optional(),
});

export const analyzeBodySchema = z.object({ projectIds: z.array(z.string()).optional() });

export const collectionCreateSchema = z.object({ name: z.string().min(1), note: z.string().nullish() });
export const collectionPatchSchema = z.object({
  name: z.string().min(1).optional(),
  note: z.string().nullish().optional(),
});
/** 集合手动排序（0.3.8 补 KNOWN-GAPS #9）：按传入顺序全量重排 sort_order */
export const collectionReorderSchema = z.object({ ids: z.array(z.string()).min(1) });
export const collectionMembersSchema = z.object({
  projectIds: z.array(z.string()).min(0),
  replace: z.boolean().default(false),
});

// ---------- 文件 ----------
export const fsTreeQuerySchema = z.object({
  projectId: z.string(),
  path: z.string().default(''),
  showIgnored: z.enum(['0', '1', 'true', 'false']).default('false'),
});

export const fsFileQuerySchema = z.object({ projectId: z.string(), path: z.string().min(1) });

export const fsFileSaveSchema = z.object({
  projectId: z.string(),
  path: z.string().min(1),
  content: z.string(),
  baseMtime: z.string().nullish(),
  baseSize: z.number().int().nullish(),
  baseHash: z.string().nullish(),
  encoding: z.string().default('utf8'),
  eol: z.enum(['CRLF', 'LF', 'MIXED']).default('LF'),
  force: z.boolean().default(false),
});

export const fsEntryCreateSchema = z.object({
  projectId: z.string(),
  parentPath: z.string().default(''),
  name: z.string().min(1),
  kind: z.enum(['file', 'dir']),
});

export const fsRenameSchema = z.object({
  projectId: z.string(),
  path: z.string().min(1),
  newName: z.string().min(1),
  confirm: z.boolean().optional(),
});

export const fsMoveSchema = z.object({
  projectId: z.string(),
  items: z.array(z.string()).min(1),
  targetDir: z.string().min(1),
  mode: z.enum(['move', 'copy']).default('move'),
  onConflict: z.enum(['ask', 'skip', 'overwrite']).default('ask'),
  confirm: z.boolean().optional(),
});

export const fsDeleteSchema = z.object({
  projectId: z.string(),
  paths: z.array(z.string()).min(1),
  confirm: z.boolean().optional(),
});

export const fsSearchQuerySchema = z.object({
  projectId: z.string(),
  q: z.string().min(1),
  caseSensitive: z.enum(['0', '1']).default('0'),
  wholeWord: z.enum(['0', '1']).default('0'),
});

export const draftPutSchema = z.object({
  scope: z.enum(['project_file', 'doc', 'other']).default('project_file'),
  projectId: z.string().nullish(),
  mountId: z.string().nullish(),
  pathKey: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
  baseMtime: z.string().nullish(),
  baseSize: z.number().int().nullish(),
  baseHash: z.string().nullish(),
  encoding: z.string().nullish(),
  eol: z.string().nullish(),
});

// ---------- Git ----------
export const gitPathsSchema = z.object({
  paths: z.array(z.string()).optional(),
  all: z.boolean().default(false),
});

export const gitDiscardSchema = z.object({
  paths: z.array(z.string()).min(1),
  confirm: z.boolean().optional(),
});

export const gitCommitSchema = z.object({ message: z.string().min(1) });

export const gitCheckoutSchema = z.object({
  branch: z.string().min(1),
  confirmDirty: z.boolean().default(false),
});

export const gitBranchCreateSchema = z.object({ branch: z.string().min(1) });

// ---------- 文档 / 架构图 ----------
export const docRootCreateSchema = z.object({ path: z.string().min(1), label: z.string().nullish() });

export const mountCreateSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(['dir', 'file']).optional(),
  label: z.string().nullish(),
});

export const mountRelocateSchema = z.object({ path: z.string().min(1) });

export const docsContentQuerySchema = z.object({
  projectId: z.string(),
  path: z.string().min(1),
  mountId: z.string().optional(),
});

export const docsContentPutSchema = z.object({
  projectId: z.string(),
  path: z.string().min(1),
  mountId: z.string().optional(),
  content: z.string(),
  baseMtime: z.string().nullish(),
  baseSize: z.number().int().nullish(),
  baseHash: z.string().nullish(),
  encoding: z.string().default('utf8'),
  eol: z.enum(['CRLF', 'LF', 'MIXED']).default('LF'),
  force: z.boolean().default(false),
});

export const archiveCreateSchema = z.object({
  projectId: z.string(),
  dirPath: z.string().min(1),
  label: z.string().nullish(),
});

export const archivePatchSchema = z.object({
  entryRel: z.string().nullish().optional(),
  isDefault: z.boolean().optional(),
  label: z.string().nullish().optional(),
});

// ---------- 搜索 / 清单 / 会话 ----------
export const todosCreateSchema = z.object({
  projectId: z.string(),
  title: z.string().min(1),
  category: z.string().nullish(),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  sortOrder: z.number().optional(),
});

export const todoPatchSchema = z.object({
  title: z.string().min(1).optional(),
  category: z.string().nullish().optional(),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .optional(),
  done: z.boolean().optional(),
  sortOrder: z.number().optional(),
});

export const sessionPutSchema = z.object({
  tabs: z.array(
    z.object({
      id: z.string(),
      sortOrder: z.number(),
      kind: z.string(),
      projectId: z.string().nullish(),
      targetPath: z.string().nullish(),
      subTab: z.string().nullish(),
      titleSnapshot: z.string().nullish(),
      scrollJson: z.string().nullish(),
      navHistoryJson: z.string().nullish(),
      navIndex: z.number().int().default(-1),
      isPinned: z.boolean().default(false),
    }),
  ),
  activeTabId: z.string().nullish(),
});

export const backupBodySchema = z.object({ confirm: z.boolean().optional() });

export const restoreBodySchema = z.object({
  file: z.string().min(1),
  confirm: z.boolean().optional(),
});

export const libraryResetSchema = z.object({ confirm: z.boolean().optional() });

export const contextContractSchema = z.object({
  writeToProject: z.boolean().default(false),
  fields: z.record(z.string(), z.string()).default({}),
});
