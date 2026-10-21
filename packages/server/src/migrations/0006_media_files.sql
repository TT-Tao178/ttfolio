-- 0006 · 多媒体库（FR-13.5 / T-099）
--
-- 项目内图片/音视频资源索引：分析器按扩展名扫描入表，媒体页签网格浏览、
-- 灯箱与播放器伺服用。w/h/duration 为预留列（前端解码探测，本版不回写）。
--
-- 存储边界：只记路径与元数据，绝不复制媒体本体（磁盘真相原则）；缩略图
-- 存数据目录 thumbs/<projectId>/（渲染层生成、服务端校验落盘）。
--
-- 只增不改（C-34）。

CREATE TABLE media_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  mtime TEXT,
  w INTEGER,
  h INTEGER,
  duration_ms INTEGER
);
CREATE UNIQUE INDEX idx_media_project_path ON media_files(project_id, path);
CREATE INDEX idx_media_project_kind ON media_files(project_id, kind, path);
