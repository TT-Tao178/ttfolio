-- 0014：清理已移除登记项目的残留组织归属（2026-11-03 行为反转配套）
-- 背景：旧实现移除登记只写 deleted_at，collection_members / project_tags 成员行
-- 保留（当时意图「同路径再登记归属可恢复」）。用户拍板反转：移除登记即清归属，
-- 再导入落回公共池，不再自动回到上次的集合/标签。
-- softDeleteProject 已改为即时清理；本迁移一次性清掉存量软删项目的残留成员行
-- （这些行在界面上不可见，但同路径复活时会连带把旧归属冒出来）。
-- 只删成员行，projects 行保留——软删语义不变，同路径仍可原地复活找回别名/备注/头像。
DELETE FROM collection_members WHERE project_id IN
  (SELECT id FROM projects WHERE deleted_at IS NOT NULL);
DELETE FROM project_tags WHERE project_id IN
  (SELECT id FROM projects WHERE deleted_at IS NOT NULL);
