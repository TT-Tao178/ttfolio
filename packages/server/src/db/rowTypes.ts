/** 数据库行类型（TS-5：API 出参必须显式映射，不复用 Row）。 */
export interface ProjectRow {
  id: string;
  alias: string | null;
  dir_path: string;
  dir_path_key: string;
  disk_name: string;
  type: string;
  type_source: string;
  primary_language: string | null;
  file_count: number;
  size_bytes: number;
  tech_stack: string;
  has_docs: number;
  has_arch: number;
  default_arch_dir: string;
  git_is_repo: number;
  git_branch: string | null;
  git_dirty: number;
  git_untracked: number;
  git_last_commit_at: string | null;
  git_last_commit_author: string | null;
  git_last_commit_subject: string | null;
  git_head_short: string | null;
  status: string;
  is_pinned: number;
  open_count: number;
  last_opened_at: string | null;
  notes: string | null;
  path_ok: number;
  path_checked_at: string | null;
  analyzed_at: string | null;
  analyze_ms: number | null;
  analyze_partial: number;
  analyze_error: string | null;
  owner_id: string | null;
  /** 0005 迁移新增：资源仓库开关（FR-13.3，默认 0 关闭）。 */
  agent_repo_enabled: number;
  /** 0009 迁移新增：项目外链收藏（FR-13.12 / T-110），JSON 数组 [{label,url}]。 */
  external_links_json: string | null;
  rev: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface LanguageStatRow {
  project_id: string;
  language: string;
  bytes: number;
  file_count: number;
}

export interface CollectionRow {
  id: string;
  name: string;
  note: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TagRow {
  id: string;
  name: string;
  color: string | null;
}

export interface DocRootRow {
  id: string;
  label: string | null;
  path: string;
  path_key: string;
  enabled: number;
  created_at: string;
}

export interface ProjectPathRow {
  id: string;
  project_id: string;
  kind: string;
  path: string;
  path_key: string;
  label: string | null;
  source: string;
  root_id: string | null;
  exists_ok: number;
  last_checked_at: string | null;
  created_at: string;
}

export interface ArchiveRow {
  id: string;
  project_id: string;
  label: string | null;
  dir_path: string;
  dir_path_key: string;
  entry_rel: string | null;
  entry_source: string;
  html_count: number;
  total_bytes: number;
  is_default: number;
  last_seen_at: string | null;
  last_viewed_at: string | null;
  created_at: string;
}

export interface TodoRow {
  id: string;
  project_id: string;
  title: string;
  category: string | null;
  due_on: string | null;
  done: number;
  sort_order: number;
  actor: string;
  source: string | null;
  created_at: string;
  done_at: string | null;
  deleted_at: string | null;
}

export interface DraftRow {
  id: string;
  scope: string;
  project_id: string | null;
  mount_id: string | null;
  path_key: string;
  content: string;
  base_mtime: string | null;
  base_size: number | null;
  base_hash: string | null;
  encoding: string | null;
  eol: string | null;
  updated_at: string;
}

export interface TrashRow {
  id: string;
  project_id: string | null;
  origin_path: string;
  origin_project_path: string | null;
  trash_rel_path: string;
  kind: string;
  size_bytes: number;
  deleted_at: string;
}

export interface SessionTabRow {
  id: string;
  session_id: string;
  sort_order: number;
  kind: string;
  project_id: string | null;
  target_path: string | null;
  sub_tab: string | null;
  title_snapshot: string | null;
  scroll_json: string | null;
  nav_history_json: string | null;
  nav_index: number;
  is_pinned: number;
}

export interface SessionRow {
  id: string;
  name: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  /** 0002 迁移新增：上次关闭/刷新时处于活动状态的标签 id（老库为 NULL）。 */
  active_tab_id: string | null;
}

export interface IgnoreRuleRow {
  id: string;
  scope: string;
  project_id: string | null;
  pattern: string;
  mode: string;
  is_builtin: number;
  enabled: number;
}

export interface CommandTemplateRow {
  id: string;
  label: string;
  executable: string;
  args_json: string;
  shell: number;
  needs_confirm: number;
  platforms: string | null;
  is_builtin: number;
  enabled: number;
  sort_order: number;
}

export interface ActivityRow {
  id: number;
  at: string;
  kind: string;
  level: string;
  project_id: string | null;
  target_path: string | null;
  detail_json: string | null;
  actor: string;
}

/** 资源仓库会话（0005 迁移 / FR-13.3）。ended_at 为 NULL 表示记录中。 */
export interface AgentSessionRow {
  id: string;
  project_id: string;
  title: string | null;
  actor: string | null;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
}

/** 会话修改过的文件（首见/末见/次数即天然时间段；只记路径不快照内容）。 */
export interface AgentSessionFileRow {
  session_id: string;
  path: string;
  first_seen_at: string;
  last_seen_at: string;
  change_count: number;
}

/** 媒体索引（0006 迁移 / FR-13.5；w/h/duration 预留）。 */
export interface MediaFileRow {
  id: string;
  project_id: string;
  path: string;
  kind: string;
  bytes: number;
  mtime: string | null;
  w: number | null;
  h: number | null;
  duration_ms: number | null;
}
