-- 0018：媒体派生数据——主色占比 + 感知哈希（FR-15.4 / T-145，2026-11-03 用户点名 C 组）
-- 只增不改：ALTER ADD 两列。派生数据由渲染层从既有缩略图（@g 级）计算后经
-- POST /api/projects/:projectId/media/derivative 落库（渐进回填，算过的跳过）；
-- 全部落索引库，绝不写项目目录。
ALTER TABLE media_files ADD COLUMN colors_json TEXT;
ALTER TABLE media_files ADD COLUMN phash TEXT;
