-- 0010 · 变更流水落库（FR-13.2 v2 / T-111）
--
-- 动态页签的变更流此前只活在组件内存里：切页签即丢、重启即失。本表把每次
-- 变更落库（同一项目同一路径 5 秒内合并为一条并累加 change_count），供
-- 动态页回读与资源仓库 v2 复用。
--
-- 来源三档：watcher（外部编辑器/终端）、api（ttFolio 自身操作）、agent
-- （携 x-ttfolio-actor 的调用）。
-- 保留：热 7 天 + 全库硬上限 20 万行（启动与定时滚动清理）。
--
-- 只增不改（C-34）；id 自增即回读游标（since=seq）。

CREATE TABLE change_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT,
  burst_id TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  first_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  change_count INTEGER NOT NULL DEFAULT 1,
  bytes INTEGER,
  source TEXT NOT NULL
);
CREATE INDEX idx_change_event_project_seq ON change_event(project_id, id DESC);
CREATE INDEX idx_change_event_last_at ON change_event(last_at);
