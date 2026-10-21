-- 0008 · 后台任务历史（FR-13.11 / T-108）
--
-- TaskManager 此前跑完即清、重启即丢——「昨天那次索引为什么失败」无从查起。
-- 本表按任务生命周期落一行（开始插入、结束更新状态与耗时），保留 30 天，
-- 启动时滚动清理。状态：running / done / error / cancelled。
--
-- 只增不改（C-34）。

CREATE TABLE task_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  done INTEGER,
  total INTEGER,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX idx_task_runs_started ON task_runs(started_at DESC);
