-- 0017：集合父子层级（FR-15.1 / T-142，2026-11-03 用户点名 C 组）
-- 背景：集合原为平表；用户需要嵌套组织（如 主力→归档待清）。
-- 只增不改：ALTER ADD parent_id，外键 ON DELETE SET NULL——父行被硬删时
-- 子集合自动提升顶层（删除集合语义仍是「只拆归属不删项目」，不级联删）。
-- 深度 ≤3 与防环由服务层写入校验（本迁移只管结构）。
ALTER TABLE collections ADD COLUMN parent_id TEXT REFERENCES collections (id) ON DELETE SET NULL;
CREATE INDEX idx_collections_parent ON collections (parent_id);
