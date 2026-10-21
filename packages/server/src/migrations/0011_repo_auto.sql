-- 0011 · 资源仓库默认记录与自动摘要（FR-13.3 v2 / T-112）
--
-- ① 会话自动化：auto=1 表示由变更事件自动开启（空闲 15 分钟 / 跨自然日 /
--    退出时自动结束）；start_head 存会话起点 git HEAD（摘要算 ±行用）。
-- ② 摘要来源三分：auto（会话结束时按规则生成，不调 AI）/ user（用户编辑后
--    不再被自动覆盖）/ agent（agent 经接口写入）。
-- ③ 项目三态开关：agent_repo_mode = follow（跟随全局，NULL）| on | off；
--    旧的 agent_repo_enabled 保留兼容（写入 mode 时同步）。
-- ④ 可选快照层（默认关）：文件行记首末快照 sha（内容寻址存数据目录，
--    绝不写项目目录）。
--
-- 只增不改（C-34）。

ALTER TABLE agent_sessions ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_sessions ADD COLUMN summary_source TEXT;
ALTER TABLE agent_sessions ADD COLUMN start_head TEXT;

ALTER TABLE agent_session_files ADD COLUMN first_sha TEXT;
ALTER TABLE agent_session_files ADD COLUMN latest_sha TEXT;

ALTER TABLE projects ADD COLUMN agent_repo_mode TEXT;
