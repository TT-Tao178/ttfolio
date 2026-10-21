-- 0009 · 项目外链收藏（FR-13.12 / T-110）
--
-- 项目属性可挂外部 URL（wiki / 仓库 / 文档站），详情栏与 Markdown 报告展示。
-- JSON 数组 [{label,url}]，上限由路由层校验（≤20 条）。
--
-- 只增不改（C-34）。

ALTER TABLE projects ADD COLUMN external_links_json TEXT;
