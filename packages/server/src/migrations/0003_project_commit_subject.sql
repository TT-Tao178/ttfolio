-- 0003：项目表补充「最近提交主题」。
-- 「最近提交」动态流需要 subject；此前只落了 at/author。
-- 迁移纪律（C-34）：只增不改——0001/0002 禁止修改，老库该列为 NULL。
ALTER TABLE projects ADD COLUMN git_last_commit_subject TEXT;
