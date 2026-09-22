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
}

export interface ProjectDetail extends ProjectSummary {
  defaultArchDir: string;
  mounts: MountInfo[];
  archives: ArchiveInfo[];
  todoOpenCount: number;
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
  truncated: boolean;
  patch: string;
  additions: number;
  deletions: number;
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
  | 'trash';

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
  uptime: number;
  dataDir: string;
  trashDir: string;
  backupDir: string;
  logDir: string;
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
