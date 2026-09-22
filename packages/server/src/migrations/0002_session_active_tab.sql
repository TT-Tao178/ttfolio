-- 0002 · 会话记住"当前活动标签"（FR-1.4）
--
-- 背景：前端 PUT /api/session 一直在请求体里带 activeTabId，但 sessions 表没有对应列、
-- getSession() 直接返回 tabs[0].id → 刷新/重启后活动标签永远落回第一个标签（实测：停在项目页
-- 刷新后跳到「工作台」，被当成"保存失败"排查过一轮）。
--
-- 只增不改（C-34）：nullable 列，老库补列后旧数据为 NULL，语义为"未记录，取第一个标签"。
ALTER TABLE sessions ADD COLUMN active_tab_id TEXT;
