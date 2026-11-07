-- 0020：变更流水记录 actor（FR-16.3 / T-134，2026-11-07 用户点名 A 组）
-- 只增不改：change_event 加 actor（发布时取当前链身份，与审计同源；
-- 空串=无身份）。支撑动态页按 actor 筛选与交接单「最近变更」署名。
ALTER TABLE change_event ADD COLUMN actor TEXT NOT NULL DEFAULT '';
