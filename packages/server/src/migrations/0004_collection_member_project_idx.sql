-- 0004：collection_members 的 project_id 侧索引（第 33 轮 M10）
-- PRIMARY KEY (collection_id, project_id) 只覆盖 collection 侧查询；
-- projectsRepo.loadExtras 的 WHERE project_id IN (...)（加载每个项目所属集合，
-- ProjectSummary 必经路径）此前为全表扫描。当前规模无感知，正规做法补索引。

CREATE INDEX IF NOT EXISTS idx_collection_members_project
  ON collection_members(project_id);
