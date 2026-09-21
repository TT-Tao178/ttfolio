-- 0001_init：初始库结构（字段名与第六节 DDL 一致，只增不改）
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  alias TEXT,
  dir_path TEXT NOT NULL,
  dir_path_key TEXT NOT NULL UNIQUE,
  disk_name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'unknown',
  type_source TEXT NOT NULL DEFAULT 'analyzed',
  primary_language TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  tech_stack TEXT NOT NULL DEFAULT '[]',
  has_docs INTEGER NOT NULL DEFAULT 0,
  has_arch INTEGER NOT NULL DEFAULT 0,
  default_arch_dir TEXT NOT NULL DEFAULT '架构图',
  git_is_repo INTEGER NOT NULL DEFAULT 0,
  git_branch TEXT,
  git_dirty INTEGER NOT NULL DEFAULT 0,
  git_untracked INTEGER NOT NULL DEFAULT 0,
  git_last_commit_at TEXT,
  git_last_commit_author TEXT,
  git_head_short TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  is_pinned INTEGER NOT NULL DEFAULT 0,
  open_count INTEGER NOT NULL DEFAULT 0,
  last_opened_at TEXT,
  notes TEXT,
  path_ok INTEGER NOT NULL DEFAULT 1,
  path_checked_at TEXT,
  analyzed_at TEXT,
  analyze_ms INTEGER,
  analyze_partial INTEGER NOT NULL DEFAULT 0,
  analyze_error TEXT,
  owner_id TEXT,
  rev INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_projects_list ON projects(deleted_at, status, is_pinned DESC, last_opened_at DESC);
CREATE INDEX idx_projects_recent ON projects(deleted_at, last_opened_at DESC);

CREATE TABLE language_stats (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  file_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, language)
);

CREATE TABLE analysis_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER,
  scanned_files INTEGER,
  scanned_bytes INTEGER,
  duration_ms INTEGER,
  error TEXT
);
CREATE INDEX idx_analysis_runs ON analysis_runs(project_id, started_at DESC);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT,
  sort_order REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE collection_members (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sort_order REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, project_id)
);
CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT);
CREATE TABLE project_tags (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, tag_id)
);

CREATE TABLE doc_roots (
  id TEXT PRIMARY KEY,
  label TEXT,
  path TEXT NOT NULL,
  path_key TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE project_paths (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  path_key TEXT NOT NULL,
  label TEXT,
  source TEXT NOT NULL,
  root_id TEXT REFERENCES doc_roots(id) ON DELETE SET NULL,
  exists_ok INTEGER NOT NULL DEFAULT 1,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, path_key)
);

CREATE TABLE archives (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT,
  dir_path TEXT NOT NULL,
  dir_path_key TEXT NOT NULL,
  entry_rel TEXT,
  entry_source TEXT NOT NULL DEFAULT 'list',
  html_count INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  last_viewed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, dir_path_key)
);

CREATE TABLE todos (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT,
  due_on TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  sort_order REAL NOT NULL DEFAULT 0,
  actor TEXT NOT NULL DEFAULT 'human',
  source TEXT,
  created_at TEXT NOT NULL,
  done_at TEXT,
  deleted_at TEXT
);
CREATE INDEX idx_todos ON todos(project_id, deleted_at, done, sort_order);

CREATE TABLE editor_drafts (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  project_id TEXT,
  mount_id TEXT,
  path_key TEXT NOT NULL,
  content TEXT NOT NULL,
  base_mtime TEXT,
  base_size INTEGER,
  base_hash TEXT,
  encoding TEXT,
  eol TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (scope, path_key)
);

CREATE TABLE trash (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  origin_path TEXT NOT NULL,
  origin_project_path TEXT,
  trash_rel_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT NOT NULL
);
CREATE INDEX idx_trash ON trash(deleted_at DESC);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE session_tabs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sort_order REAL NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  project_id TEXT,
  target_path TEXT,
  sub_tab TEXT,
  title_snapshot TEXT,
  scroll_json TEXT,
  nav_history_json TEXT,
  nav_index INTEGER NOT NULL DEFAULT -1,
  is_pinned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_session_tabs ON session_tabs(session_id, sort_order);

CREATE TABLE recent_files (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  open_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (project_id, path)
);

CREATE VIRTUAL TABLE content_fts USING fts5(
  project_id UNINDEXED,
  rel_path UNINDEXED,
  body,
  tokenize = 'trigram'
);
CREATE TABLE content_index_state (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path_key TEXT NOT NULL,
  mtime TEXT,
  size INTEGER,
  indexed_at TEXT NOT NULL,
  PRIMARY KEY (project_id, path_key)
);

CREATE TABLE ignore_rules (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'global',
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'hide',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE command_templates (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  executable TEXT NOT NULL,
  args_json TEXT NOT NULL DEFAULT '["{path}"]',
  shell INTEGER NOT NULL DEFAULT 0,
  needs_confirm INTEGER NOT NULL DEFAULT 1,
  platforms TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order REAL NOT NULL DEFAULT 0
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
CREATE TABLE search_history (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  level TEXT NOT NULL,
  project_id TEXT,
  target_path TEXT,
  detail_json TEXT,
  actor TEXT NOT NULL DEFAULT 'local'
);
CREATE INDEX idx_activity ON activity_log(at DESC);

-- 内置忽略规则
INSERT INTO ignore_rules (id, scope, pattern, mode, is_builtin, enabled) VALUES
  ('bi_node_modules','global','node_modules','hide',1,1),
  ('bi_git','global','.git','hide',1,1),
  ('bi_svn','global','.svn','hide',1,1),
  ('bi_hg','global','.hg','hide',1,1),
  ('bi_vendor','global','vendor','hide',1,1),
  ('bi_pods','global','Pods','hide',1,1),
  ('bi_venv','global','.venv','hide',1,1),
  ('bi_venv2','global','venv','hide',1,1),
  ('bi_env_dir','global','env','hide',1,1),
  ('bi_pycache','global','__pycache__','hide',1,1),
  ('bi_pytest','global','.pytest_cache','hide',1,1),
  ('bi_mypy','global','.mypy_cache','hide',1,1),
  ('bi_ruff','global','.ruff_cache','hide',1,1),
  ('bi_gradle','global','.gradle','hide',1,1),
  ('bi_cargo_home','global','.cargo','hide',1,1),
  ('bi_dist','global','dist','hide',1,1),
  ('bi_build','global','build','hide',1,1),
  ('bi_out','global','out','hide',1,1),
  ('bi_output','global','output','hide',1,1),
  ('bi_target','global','target','hide',1,1),
  ('bi_bin','global','bin','hide',1,1),
  ('bi_obj','global','obj','hide',1,1),
  ('bi_next','global','.next','hide',1,1),
  ('bi_nuxt','global','.nuxt','hide',1,1),
  ('bi_sveltekit','global','.svelte-kit','hide',1,1),
  ('bi_turbo','global','.turbo','hide',1,1),
  ('bi_parcel','global','.parcel-cache','hide',1,1),
  ('bi_coverage','global','coverage','hide',1,1),
  ('bi_release','global','release','hide',1,1),
  ('bi_derived','global','DerivedData','hide',1,1),
  ('bi_idea','global','.idea','hide',1,1),
  ('bi_vscode','global','.vscode','hide',1,1),
  ('bi_vs','global','.vs','hide',1,1),
  ('bi_dsstore','global','.DS_Store','hide',1,1),
  ('bi_thumbs','global','Thumbs.db','hide',1,1),
  ('bi_log','global','*.log','hide',1,1),
  ('bi_tmp_file','global','*.tmp','hide',1,1),
  ('bi_tmp_dir','global','tmp','hide',1,1),
  ('bi_temp_dir','global','temp','hide',1,1),
  ('bi_sensitive_env','global','.env*','analyze_only',1,1),
  ('bi_sensitive_pem','global','*.pem','analyze_only',1,1),
  ('bi_sensitive_key','global','*.key','analyze_only',1,1),
  ('bi_sensitive_pfx','global','*.pfx','analyze_only',1,1),
  ('bi_sensitive_keystore','global','*.keystore','analyze_only',1,1),
  ('bi_sensitive_idrsa','global','id_rsa*','analyze_only',1,1),
  ('bi_sensitive_npmrc','global','.npmrc','analyze_only',1,1),
  ('bi_sensitive_netrc','global','.netrc','analyze_only',1,1),
  ('bi_sensitive_aws','global','.aws','analyze_only',1,1),
  ('bi_sensitive_ssh','global','.ssh','analyze_only',1,1),
  ('bi_sensitive_credentials','global','credentials*','analyze_only',1,1),
  ('bi_sensitive_secrets','global','secrets*','analyze_only',1,1);

-- 内置命令模板（FR-10.3：executable + args 数组 + 占位符）
INSERT INTO command_templates (id, label, executable, args_json, shell, needs_confirm, platforms, is_builtin, enabled, sort_order) VALUES
  ('bt_explorer','在资源管理器中显示','explorer','["/select,","{path}"]',0,0,'win32',1,1,0),
  ('bt_terminal','在此打开终端','wt','["-d","{path}"]',0,1,'win32',1,1,1);

-- 默认设置
INSERT INTO settings (key, value, updated_at) VALUES
  ('theme','light',datetime('now')),
  ('density','middle',datetime('now')),
  ('watch_enabled','1',datetime('now')),
  ('watch_stability_ms','300',datetime('now')),
  ('auto_save','0',datetime('now')),
  ('trash_retention_days','30',datetime('now')),
  ('default_arch_dir_name','架构图',datetime('now')),
  ('card_sort','last_opened',datetime('now')),
  ('show_ignored','0',datetime('now')),
  ('default_project_tab','files',datetime('now'));

-- 默认会话
INSERT INTO sessions (id, name, is_active, created_at, updated_at) VALUES
  ('default','默认会话',1,datetime('now'),datetime('now'));
