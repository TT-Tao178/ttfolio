-- 0015：卡片/列表默认排序从 last_opened 翻为 name（2026-11-03 用户反馈）
-- 背景：默认按「最近打开」排序时，点开一个项目 last_opened_at 即更新，
-- 侧栏项目列表 / 卡片墙 / 未分配成员列表里它会立刻跳到最前——「点击置顶」
-- 的跳动不符合预期，用户拍板去掉。
-- 处理：存量 card_sort='last_opened' 一次性翻为 'name'（显式选择「最近打开」
-- 的能力保留：卡片墙排序器可选手选，「最近打开」视图与继续上次 chips 不受
-- 影响，打开计数仍照常上报）。新装库由 0001 种子 + 本迁移按序执行同样落到 name。
UPDATE settings SET value = 'name', updated_at = datetime('now')
WHERE key = 'card_sort' AND value = 'last_opened';
