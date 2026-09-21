# ttFolio · tt项目仓库

> a local project workbench —— 把硬盘上的项目文件夹登记进来，在一处浏览、打开、看源码、管 Git、看架构图、找文档。
> **磁盘是真相，数据库只是索引**：项目文件原地不动，ttFolio 只在其上加一层"索引 + 入口 + 关系"。

## 这是什么

ttFolio 是一个**纯本地**的项目工作台（单机单人，无网络依赖）：

- **登记项目**：系统对话框 / 粘贴路径（多行、引号、`\?\` 前缀）/ 父目录批量登记
- **自动分析**：类型识别（前端/后端/前后端分离/微服务…）、按字节语言占比（top8+Other）、技术栈标签、Git 摘要、文档/架构图探测
- **文件浏览与编辑**：懒加载文件树、CodeMirror 6 编辑器、原子写 + mtime/size/hash 冲突三选一、草稿保护（永不丢字）、编码与换行原样保持（UTF-8/BOM/UTF-16/GBK、CRLF/LF）
- **Git**：状态（porcelain=v2 -z 解析，中文/空格/重命名安全）/ diff / 暂存 / 提交（stdin）/ 历史 / 切分支；**绝不 push/pull、不存凭据**
- **架构图**：登记目录、入口识别（index.html → 手动 → 图集列表）、独立端口只读静态代理 + iframe sandbox
- **文档库**：项目内 md 自动发现、全局文档根按名模糊匹配（可解绑进黑名单）、手动挂载、Markdown 渲染
- **搜索**：命令面板（Ctrl+K）三档结果——项目 / 文件名 / 文件内容（FTS5 trigram，中文友好，按需增量索引）
- **回收站**：删除一律进回收站（可恢复原路径），彻底删除与清空需 L3 二次确认
- **轻量清单**：项目内可勾选清单，跨项目汇总

## 环境要求

- **Node.js >= 22**（开发时使用 Node 24 验证）
- **git**（可选；未安装时 Git 页签显示引导，其余功能可用）
- Windows 10/11（主）；macOS / Linux 理论可跑（对话框实现已覆盖）

## 快速开始

```bash
npm ci          # 或 npm install
npm run dev     # 同时起 server(tsx watch, 127.0.0.1:7717) 与 vite(5173)
```

打开终端打印的地址（开发 `http://localhost:5173`；生产 `npm run build && npm start` 后 `http://127.0.0.1:7717`）。
端口被占用自动 +1 递增（最多 20 次），实际端口写入数据目录 `runtime.json`。

- **数据目录**：`%APPDATA%\ttFolio\`（Windows）——含 `library.db`、`backups/`、`trash/`、`thumbs/`、`logs/`、`runtime.json`
- 可用环境变量 `TTFOLIO_DATA_DIR`、`TTFOLIO_PORT` 覆盖

## 数据与备份

- **自动备份**：启动时距上次备份 >24h 自动 `VACUUM INTO backups/library-YYYYMMDD-HHmm.db` 并做完整性检查；保留最近 10 份 + 每周 1 份
- **手动备份 / 从备份恢复**：设置 → 数据与备份
- **恢复索引**：删掉 `library.db` 后重新登记并分析，卡片数据等价（仅丢别名/备注/清单等手写内容，所以先备份）
- **清空索引库**：设置 → 数据与备份（L3 打字确认；**绝不删除项目文件**）
- **导出**：项目清单 CSV / JSON

## 测试与质量门禁

```bash
npm run typecheck   # 三包 tsc --noEmit，0 error
npm run lint        # ESLint（禁 console/any/startsWith 路径判断等），0 error
npm run test        # Vitest 单元+集成（真实 SQLite + 真实 git 夹具）
npm run build       # shared/server 类型检查 + web vite 构建
npm run test:e2e    # Playwright 4 条主流程（自动拉起受管 server:7733）
npm run verify      # 一键以上全部 + 11 条 grep 级机械检查
npm run doctor      # 数据自检报告（库完整性/失效路径/挂载/回收站/索引）
npm run migrate     # 手动执行迁移（启动时也会自动执行）
```

## 目录结构

```
ttfolio/
├─ scripts/            # dev / verify / migrate / doctor
├─ docs/adr/           # 关键决策记录
├─ tests/e2e/          # Playwright 主流程
└─ packages/
   ├─ shared/          # 类型、Zod schema、错误码枚举、常量（前后端共用，不依赖任何包）
   ├─ server/          # Fastify + better-sqlite3
   │  └─ src/
   │     ├─ core/      # pathGuard(唯一路径关口) fsx(原子写) git trash drafts watcher search backup tasks sse dialogs analyzer …
   │     ├─ db/        # 单写连接 + 迁移(只增不改+快照) + repo/*（全部 SQL 收敛于此）
   │     ├─ routes/    # /api/* 全部接口（统一 {ok,data} 信封 + 错误码枚举）
   │     └─ static/    # 用户内容独立端口（+100）只读代理
   └─ web/             # React 18 + Vite + AntD 5（ConfigProvider token，默认浅色）+ CodeMirror 6
```

## 安全边界（重要）

- 服务只监听 `127.0.0.1`；所有接口校验本机 token（页面自动注入）与 Host 头
- 除用户显式 L2/L3 操作外，被登记目录**零改动**；删除必进回收站；L3 操作写审计日志
- 架构图 HTML / 原始文件由**独立端口**（应用端口 +100）只读提供，iframe sandbox 隔离
- 无遥测、无 CDN、运行期不出网
