-- 0005 · 资源仓库：agent/编辑会话沉淀（FR-13.3 / T-097）
--
-- 背景：T-096「动态」页签是会话级实时流（内存，关了就没）；本迁移给它加
-- 可选的沉淀层——每个项目可开启「资源仓库」，记录各编辑会话的时间段、
-- 修改过的文件清单（首见/末见/次数）与精华摘要。
--
-- 存储边界（磁盘真相原则）：只记文件路径与时间，不快照内容——改动本身
-- 随时可在磁盘/Git 里看到，索引库绝不复制项目数据。
--
-- 只增不改（C-34）：两张新表 + projects 加一列开关（默认 0 关闭，
-- 老库补列后语义即"未启用"，与页签不渲染的行为一致）。

CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT,
  actor TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT
);
CREATE INDEX idx_agent_sessions_project ON agent_sessions(project_id, started_at DESC);

CREATE TABLE agent_session_files (
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  change_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (session_id, path)
);

ALTER TABLE projects ADD COLUMN agent_repo_enabled INTEGER NOT NULL DEFAULT 0;
