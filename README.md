# ttFolio · TT项目管理工作台

**简体中文** | [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6.svg)](https://github.com/TT-Tao178/ttfolio/releases)
[![Version](https://img.shields.io/badge/version-0.2.4-1677ff.svg)](CHANGELOG.md)

一个**本地优先**的项目工作台：把硬盘上的项目文件夹登记进来，在同一个界面里浏览源码、查看 Git、
管理文档与架构图、执行全局搜索。

**磁盘是真相，数据库只是索引。** 项目文件原地不动，ttFolio 只在其上提供索引、入口与关系。

- 纯本地运行：单机单人，服务只监听 `127.0.0.1`，无遥测、无 CDN、运行期不出网
- 除用户显式操作外，被登记目录零改动；删除一律先进回收站且可按原路径恢复
- 索引库启动前自动快照，损坏可自愈；清空索引库不会删除任何项目文件

## 功能特性

- **项目登记**：粘贴路径（多行 / 引号 / `\\?\` 前缀）、系统文件夹对话框、父目录批量登记
- **自动分析**：项目类型识别（前端 / 后端 / 前后端分离 / 微服务 / 素材仓库等）、按字节统计的语言占比
  （对齐 GitHub Linguist 口径，90+ 语言与 Makefile / Dockerfile / .env 等文件名识别）、技术栈标签、Git 摘要
- **文件浏览与编辑**：懒加载文件树、CodeMirror 6 编辑器、草稿保护（强杀进程不丢字）、外部修改检测、
  保存冲突三选一（对比 / 放弃本地 / 覆盖磁盘）、编码与换行符原样保持（UTF-8/BOM/UTF-16/GBK、CRLF/LF）
- **文件操作**：右键菜单（复制到… / 移动到… / 在资源管理器中打开 / 复制相对与绝对路径）、
  面包屑逐级点击定位（点目录段自动展开文件树到该处）
- **Git**：工作区状态、diff、暂存、提交、提交历史与提交详情、分支切换；不做 push/pull，不存储凭据
- **文档**：项目内 Markdown 自动发现、挂载外部文档（多选）、目录大纲跳转、渲染阅读
- **架构图**：登记架构图目录，页签内直接查看——HTML / 图片 / 文本（md/json）三类文件常驻分栏预览，
  独立只读端口访问，iframe 沙箱隔离
- **搜索**：命令面板（Ctrl+K）与全局搜索——项目名 / 文件名 / 文件内容（SQLite FTS5，中文友好，增量索引）
- **工作台总览**：项目卡片、需要关注的项目、聚合语言构成、跨项目最近提交
- **失效项目闭环**：目录被移动/删除后一键重新定位（双入口）或移除登记（二次确认）
- **回收站**：删除先进回收站，可恢复到原路径；彻底删除需二次确认
- **桌面版**：Electron 打包的 Windows 安装包（NSIS）、TT 品牌图标、系统原生文件对话框

## 安装

### 桌面版（推荐）

从 [Releases](../../releases) 页面下载 `ttFolio-Setup-x.y.z.exe`：

- 支持 Windows 10/11 x64，无需安装 Node.js 或其他运行环境
- 安装时可自定义安装目录（中文路径可用），不需要管理员权限
- 数据保存在 `%APPDATA%\ttFolio\`，卸载软件不会删除数据
- 安装包未做代码签名，首次运行时 Windows SmartScreen 会提示，选择「更多信息 → 仍要运行」即可

### 从源码运行

需要 Node.js ≥ 22（以 Node 24 验证）。Git 为可选依赖，未安装时 Git 页签不可用，其余功能正常。

```bash
npm install
npm run dev
```

开发模式会同时启动后端（`127.0.0.1:7717`）与前端（`localhost:5173`），打开 `http://localhost:5173` 使用。

## 构建桌面版

```bash
npm run dist:win
```

产物为 `dist-electron/` 下的 NSIS 安装包（`ttFolio-Setup-x.y.z.exe`）。构建脚本自动完成 Web 前端打包、
服务端 esbuild 打包、better-sqlite3 的 Electron ABI 重编译、产物自检（node_modules 完整性、前端产物、
真实启动冒烟，7 项全绿才算成功）。

注意：打包会消耗几分钟，且打包后本机 `node_modules` 中的 better-sqlite3 为 Electron ABI，
继续本地开发前需先执行 `npm rebuild better-sqlite3`。

## 开发

```bash
npm run typecheck   # TypeScript 严格检查（shared / server / web 三包）
npm run lint        # ESLint，0 警告容忍
npm run test        # Vitest 单元与集成测试（真实 SQLite 与 git 夹具）
npm run build       # 生产构建
```

提交遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，
提交正文说明修改原因、影响面与验证方式。

### 目录结构

```
packages/
  shared/   类型定义、Zod schema、常量（前后端共用）
  server/   Fastify + better-sqlite3
    core/   路径守卫、原子写、git、回收站、分析器、对话框、文件监听等
    db/     SQLite 连接、迁移（只增不改 + 自动快照）、仓储层（全部 SQL 收敛于此）
    routes/ 全部 REST 接口
  web/      React 18 + Vite + Ant Design 5 + CodeMirror 6
electron/   桌面版主进程（进程内服务端 + 原生对话框桥）
scripts/    开发与构建脚本
```

### 关键设计

- 迁移只增不改，启动时自动执行，升级前自动生成数据库快照
- 所有文件访问经过统一的路径守卫：拒绝越界路径、UNC、符号链接、Windows 保留名等
- 服务端与前端通过 SSE 推送文件变更，编辑器的草稿与版本守卫保证不静默覆盖任何修改
- 桌面版服务端进程内运行（不需要系统 Node），文件选择走 Electron 原生对话框

## 数据与备份

- 数据目录：`%APPDATA%\ttFolio\`，包含 `library.db`、`backups/`、`trash/`、`logs/` 等
- 启动时距上次备份超过 24 小时会自动备份（`VACUUM INTO` + 完整性检查）
- 手动备份、从备份恢复、导出项目清单（JSON / CSV）在「设置 → 数据与备份」
- 可通过环境变量 `TTFOLIO_DATA_DIR`、`TTFOLIO_PORT` 覆盖默认行为

## 常见问题

**打包后跑 `npm run dev` / `npm test` 报 better-sqlite3 版本错误？**
打包会把本机 node_modules 切到 Electron ABI。先停掉开发进程，执行
`npm rebuild better-sqlite3` 切回 Node ABI 即可；服务端启动预检发现 ABI 不匹配时
会干净退出，不会触碰索引库。

**开发模式页面请求全部失败（ECONNREFUSED）？**
桌面版运行时会把 `%APPDATA%\ttFolio\runtime.json` 里的 port 写成它自己探测的端口，
而 Vite 代理读取该文件。把 port 改回 `7717` 后重启 `npm run dev` 即可。

**安装包首次启动特别慢？**
未签名的安装包首次运行会被杀毒软件全量扫描（可能 60 秒以上），二次启动通常 4 秒内。
SmartScreen 提示请选「更多信息 → 仍要运行」。

**改了前端代码但界面没变化？**
Vite 可能缓存了半截模块（编辑器原子写对读方不是原子的）。重启 dev server 即可，
不要继续改代码排查。

**数据丢了怎么办？**
索引库只是索引——磁盘上的项目文件原地不动，重新登记/重新分析即可恢复。
`%APPDATA%\ttFolio\backups\` 下有自动快照（每次迁移前 + 每日）。

## 许可证

[MIT](LICENSE) © TT-Tao178
