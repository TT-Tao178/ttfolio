-- 0007 · 架构图查看快照（FR-13.9 ③ / T-106c）
--
-- 打开图集时落「上次查看」的 HTML 清单，变更提示据此给出「上次查看 → 现在」
-- 的文件增减明细（此前只有文件数/字节/入口 mtime 三个标量，看不出改了哪些）。
--
-- 快照存索引库、绝不写图集目录（红线 2：非用户操作零改动）；
-- 图集删除经外键级联清理。只增不改（C-34）。

CREATE TABLE archive_view_snapshots (
  archive_id TEXT PRIMARY KEY REFERENCES archives(id) ON DELETE CASCADE,
  viewed_at TEXT NOT NULL,
  html_files_json TEXT NOT NULL
);
