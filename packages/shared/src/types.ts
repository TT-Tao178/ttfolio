/** 领域类型（API 出参形状，前后端共用）。字段名与第六节 DDL 对齐。 */

export type ProjectType =
  | 'frontend'
  | 'backend'
  | 'fullstack'
  | 'split'
  | 'monolith'
  | 'microservice'
  | 'script'
  | 'assets'
  | 'unknown';

export type ProjectStatus = 'active' | 'archived';

export interface LanguageStat {
  language: string;
  bytes: number;
  fileCount: number;
  percent: number;
}

export interface ProjectSummary {
  id: string;
  alias: string | null;
  dirPath: string;
  diskName: string;
  type: ProjectType;
  typeSource: 'analyzed' | 'manual';
  primaryLanguage: string | null;
  fileCount: number;
  sizeBytes: number;
  techStack: string[];
  hasDocs: boolean;
  hasArch: boolean;
  gitIsRepo: boolean;
  gitBranch: string | null;
  gitDirty: boolean;
  gitUntracked: number;
  gitLastCommitAt: string | null;
  gitLastCommitAuthor: string | null;
  gitLastCommitSubject: string | null;
  gitHeadShort: string | null;
  status: ProjectStatus;
  isPinned: boolean;
  openCount: number;
  lastOpenedAt: string | null;
  notes: string | null;
  pathOk: boolean;
  analyzedAt: string | null;
  analyzeMs: number | null;
  analyzePartial: boolean;
  analyzeError: string | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
  languages: LanguageStat[];
  tags: string[];
  collections: string[];
  /** 项目外链收藏（FR-13.12 / T-110，迁移 0009）：wiki / 仓库 / 文档站 */
  externalLinks: Array<{ label: string; url: string }>;
  /** 项目头像（可选功能 2026-10-29）：存在 avatars/<id>.png 时为 true；
   *  avatarV = 文件 mtime（缓存穿透参数），URL 由前端经用户内容端口拼装 */
  hasAvatar?: boolean;
  avatarV?: number;
}

export interface ExternalLink {
  label: string;
  url: string;
}

export interface ProjectDetail extends ProjectSummary {
  defaultArchDir: string;
  mounts: MountInfo[];
  archives: ArchiveInfo[];
  todoOpenCount: number;
  /** 资源仓库有效开关（FR-13.3 v2：项目三态 × 全局模式求值） */
  agentRepoEnabled: boolean;
  /** 项目三态（follow 跟随全局） */
  agentRepoMode: AgentRepoMode;
  /** 全局记录模式 */
  globalRepoMode: 'on' | 'off';
}

export interface MountInfo {
  id: string;
  kind: 'dir' | 'file';
  path: string;
  label: string | null;
  source: 'auto_root' | 'manual';
  existsOk: boolean;
  lastCheckedAt: string | null;
}

export interface ArchiveInfo {
  id: string;
  label: string | null;
  dirPath: string;
  entryRel: string | null;
  entrySource: 'index_html' | 'manual' | 'list';
  htmlCount: number;
  totalBytes: number;
  isDefault: boolean;
  lastSeenAt: string | null;
  lastViewedAt: string | null;
  changed: boolean;
  htmlFiles: ArchiveEntryFile[];
  /** 图片文件（第 26 轮）：架构图目录常见产物，页签内直接预览 */
  imageFiles: ArchiveEntryFile[];
  /** 文本类文件（第 26 轮）：md/txt/json 说明与源文件，只读文本预览 */
  textFiles: ArchiveEntryFile[];
  /** 上次查看快照（FR-13.9 ③ / T-106c，迁移 0007）：变更提示据此给出文件增减明细；无记录为 null */
  viewSnapshot?: { viewedAt: string; files: string[] } | null;
  sourceJsonFiles: string[];
}

export interface ArchiveEntryFile {
  rel: string;
  mtime: string;
  size: number;
  hasSourceJson: boolean;
}

/** 文件树节点 */
export interface TreeNode {
  name: string;
  path: string; // 相对项目根
  kind: 'dir' | 'file';
  size?: number;
  mtime?: string;
  gitState?: 'modified' | 'added' | 'untracked' | 'deleted' | 'conflicted' | 'renamed';
  ignored?: boolean;
  /** 符号链接 / junction（kind 表示"链接目标的类型"） */
  symlink?: boolean;
  /** 链接目标：dir/file/unknown（unknown = 断裂或不可访问） */
  linkTarget?: 'dir' | 'file' | 'unknown';
  /** 链接指向项目目录之外：前端应灰显并给出原因，而不是让用户点了才报错 */
  linkOutside?: boolean;
}

/** 文件树响应：nodes 为空时用 hiddenCount 区分"目录为空"与"内容被忽略规则隐藏" */
export interface TreeResponse {
  path: string;
  nodes: TreeNode[];
  /** 被忽略规则过滤掉的条目数（showIgnored=0 时统计） */
  hiddenCount?: number;
}

export interface FileContent {
  projectId: string;
  path: string;
  absPath: string;
  content: string;
  encoding: 'utf8' | 'utf8-bom' | 'utf16le' | 'utf16be' | 'gbk';
  eol: 'CRLF' | 'LF' | 'MIXED';
  mtime: string;
  size: number;
  hash: string;
  truncated: boolean;
  isBinary: boolean;
  tooLarge: boolean;
  readonlyFs?: boolean;
}

export interface SaveResult {
  mtime: string;
  size: number;
  hash: string;
}

export interface DiskVersionInfo {
  mtime: string;
  size: number;
  hash: string;
  content?: string;
  encoding: FileContent['encoding'];
  eol: FileContent['eol'];
}

/** Git */
export interface GitStatusEntry {
  path: string;
  origPath?: string;
  state: 'staged' | 'unstaged' | 'untracked' | 'conflicted';
  x: string;
  y: string;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  upstreamHint: string | null;
  staged: GitStatusEntry[];
  unstaged: GitStatusEntry[];
  untracked: GitStatusEntry[];
  conflicted: GitStatusEntry[];
  inProgress: 'merge' | 'rebase' | null;
  identity: { name: string; email: string } | null;
  truncated: boolean;
  detached: boolean;
}

export interface GitLogEntry {
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitDiff {
  path: string;
  binary: boolean;
  /** 兼容字段：= hasMore 或超长单行字符兜底截断（第 63 轮起主用 hasMore/totalLines） */
  truncated: boolean;
  patch: string;
  additions: number;
  deletions: number;
  /** 分块懒加载（FR-5.2 / KNOWN-GAPS #6）：完整 patch 总行数 */
  totalLines?: number;
  /** 本响应起始行号 */
  offset?: number;
  /** 后续是否还有行 */
  hasMore?: boolean;
}

export interface GitBranch {
  name: string;
  current: boolean;
  headShort: string | null;
  subject: string | null;
}

export interface GitOverviewItem {
  projectId: string;
  name: string;
  isRepo: boolean;
  branch: string | null;
  dirty: boolean;
  untracked: number;
  lastCommitAt: string | null;
  pathOk: boolean;
}

/** 搜索 */
export interface SearchHitProject {
  projectId: string;
  name: string;
  alias: string | null;
  dirPath: string;
  matched: string;
}

export interface SearchHitFile {
  projectId: string;
  name: string;
  relPath: string;
}

export interface SearchHitContent {
  projectId: string;
  relPath: string;
  snippet: string;
}

export interface SearchResults {
  projects: SearchHitProject[];
  files: SearchHitFile[];
  contents: SearchHitContent[];
  indexedProjects: string[];
  unindexedProjects: string[];
}

/** 长任务 */
export interface TaskInfo {
  taskId: string;
  kind: 'analyze' | 'index' | 'move-copy' | 'trash-empty';
  title: string;
  done: number;
  total: number;
  status: 'running' | 'done' | 'cancelled' | 'error';
  error?: string;
  partial?: boolean;
  /** 所属项目（move-copy 等任务可选携带，SSE 载荷与状态栏共用） */
  projectId?: string;
  startedAt: string;
  finishedAt?: string;
}

/** SSE 事件载荷 */
export type SseEventName =
  | 'hello'
  | 'analysis.progress'
  | 'project.analyzed'
  | 'project.updated'
  | 'fs.changed'
  | 'git.changed'
  | 'search.index.progress'
  | 'trash.changed'
  /** 通用任务进度（move-copy / trash-empty 等非分析/索引任务，FR-4.7） */
  | 'task.progress'
  /** 插件启停/安装变化（FR-14.1） */
  | 'plugin.changed'
  /** 脚本插件输出行（FR-14.1） */
  | 'plugin.output'
  | 'notice';

export interface SseEvent {
  id: number;
  event: SseEventName;
  data: Record<string, unknown>;
}

/** 会话（标签恢复） */
export type TabKind =
  | 'overview'
  | 'project'
  | 'file'
  | 'image'
  | 'doc'
  | 'archive'
  | 'git'
  | 'search'
  | 'settings'
  | 'trash'
  | 'activity'
  | 'compare'
  | 'doclib'
  | 'plugins';

export interface SessionTab {
  id: string;
  sortOrder: number;
  kind: TabKind;
  projectId: string | null;
  targetPath: string | null;
  subTab: string | null;
  titleSnapshot: string | null;
  scrollJson: string | null;
  navHistoryJson: string | null;
  navIndex: number;
  isPinned: boolean;
}

export interface SessionData {
  tabs: SessionTab[];
  activeTabId: string | null;
}

/** 健康检查 */
export interface HealthInfo {
  version: string;
  port: number;
  userContentPort: number;
  mode: string;
  dbPath: string;
  dbSize: number;
  projectCount: number;
  /** 最近一次分析时间（ISO）；从未分析时为 null。状态栏「最近分析」用 */
  lastAnalyzeAt: string | null;
  uptime: number;
  dataDir: string;
  trashDir: string;
  backupDir: string;
  logDir: string;
}

/** Agent 发现清单（FR-13.1，T-095） */
export interface AgentManifestProject {
  id: string;
  /** 别名优先；无别名用磁盘目录名 */
  name: string;
  alias: string | null;
  diskName: string;
  dirPath: string;
  tags: string[];
  /** 集合名（非 id，外部可直接阅读） */
  collections: string[];
}

export interface AgentManifest {
  service: 'ttFolio';
  version: string;
  protocolVersion: number;
  apiBase: string;
  /** 能力名 → 端点模板（{id}/{path} 占位） */
  capabilities: Record<string, string>;
  projects: AgentManifestProject[];
}

/** 媒体索引条目（FR-13.5，T-099）。w/h/durationMs 预留（前端探测，本版不回写）。 */
import type { MediaKind } from './media.js';
export interface MediaItem {
  path: string;
  kind: MediaKind;
  bytes: number;
  mtime: string | null;
  w: number | null;
  h: number | null;
  durationMs: number | null;
}

/** 资源仓库会话（FR-13.3，T-097）。endedAt 为 null 表示记录中。 */
export interface AgentRepoSession {
  id: string;
  projectId: string;
  title: string | null;
  actor: string | null;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
  /** 摘要来源（FR-13.3 v2）：auto 自动生成 / user 用户编辑过 / agent 由 agent 写入 */
  summarySource?: 'auto' | 'user' | 'agent' | null;
  /** 自动开启的会话（空闲 15 分钟 / 跨自然日 / 退出时自动结束） */
  auto?: boolean;
  startHead?: string | null;
  fileCount: number;
}

/** 会话修改过的文件：首见/末见/次数即天然时间段（只记路径，不快照内容）。 */
export interface AgentRepoSessionFile {
  path: string;
  firstSeenAt: string;
  lastSeenAt: string;
  changeCount: number;
  /** 可选快照层（默认关）：首/末快照内容寻址 sha 与大小 */
  firstSha?: string | null;
  latestSha?: string | null;
  bytes?: number | null;
}

/** 项目资源仓库记录开关三态（FR-13.3 v2）：follow 跟随全局 */
export type AgentRepoMode = 'follow' | 'on' | 'off';

/** 个人主页（FR-13.7，T-103）：本地单人身份卡。 */
export interface ProfileInfo {
  name: string | null;
  hasAvatar: boolean;
  projectCount: number;
  usedDays: number;
  version: string;
}

/** 忽略规则 */
export interface IgnoreRule {
  id: string;
  scope: 'global' | 'project';
  projectId: string | null;
  pattern: string;
  mode: 'hide' | 'analyze_only';
  isBuiltin: boolean;
  enabled: boolean;
}

/** 命令模板（FR-10.3） */
export interface CommandTemplate {
  id: string;
  label: string;
  executable: string;
  argsJson: string[];
  shell: boolean;
  needsConfirm: boolean;
  platforms: string | null;
  isBuiltin: boolean;
  enabled: boolean;
  sortOrder: number;
}

/** 文档根与匹配（FR-6.2） */
export interface DocRoot {
  id: string;
  label: string | null;
  path: string;
  enabled: boolean;
  createdAt: string;
}

export interface DocRootMatch {
  dirName: string;
  path: string;
  score: number;
  projectId: string | null;
  projectName: string;
  status: 'matched' | 'pending' | 'ambiguous' | 'unmatched' | 'blacklisted';
}

/** 回收站条目 */
export interface TrashItem {
  id: string;
  projectId: string | null;
  originPath: string;
  kind: 'file' | 'dir';
  sizeBytes: number;
  deletedAt: string;
  name: string;
}

/** 清单 */
export interface TodoItem {
  id: string;
  projectId: string;
  title: string;
  category: string | null;
  dueOn: string | null;
  done: boolean;
  sortOrder: number;
  actor: string;
  source: string | null;
  createdAt: string;
  doneAt: string | null;
}

/** 集合 */
export interface CollectionInfo {
  id: string;
  name: string;
  note: string | null;
  memberCount: number;
  projectIds: string[];
}

/** 自定义「我的视图」（FR-4.11 / KNOWN-GAPS #5）：存 settings.custom_views_json。 */
export interface CustomView {
  id: string;
  name: string;
  /** 卡片墙过滤参数（parseSubTab JSON 分支同构；键白名单见 CUSTOM_VIEW_FILTER_KEYS） */
  filters: Record<string, string>;
  createdAt: string;
}

/** 活动日志 */
export interface ActivityEntry {
  id: number;
  at: string;
  kind: string;
  level: string;
  projectId: string | null;
  targetPath: string | null;
  detail: unknown;
  actor: string;
}

export interface FsNodeInfo {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  size: number;
  mtime: string;
}
