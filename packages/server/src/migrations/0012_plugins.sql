-- 0012 · 插件系统（FR-14.1 / T-101）
--
-- 本地优先（断网全功能可用）：插件清单与状态存索引库；声明式插件零代码
-- （只存 JSON），脚本插件记目录路径（脚本本体留在磁盘、不改不复制）。
-- 权限在清单里声明，安装时确认；启停即时生效；插件操作审计 actor=plugin:<id>。
--
-- 只增不改（C-34）。

CREATE TABLE plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  author TEXT,
  kind TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  builtin INTEGER NOT NULL DEFAULT 0,
  installed_at TEXT NOT NULL,
  dir_path TEXT
);
CREATE INDEX idx_plugins_enabled ON plugins(enabled);
