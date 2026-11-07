-- 0016：动态规则集合（FR-16.2 / T-133，2026-11-07 用户点名 A 组）
-- 只增不改：collections 加 kind（manual/rule，默认 manual）与 rules_json。
-- 规则集合的成员查询时现算（不落 collection_members 表——磁盘真相/零成员数据）；
-- 规则集合不可父子嵌套（T-142 约束，服务层校验）、不可手动添删成员。
ALTER TABLE collections ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE collections ADD COLUMN rules_json TEXT;
