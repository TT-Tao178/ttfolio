<div align="center">

# ttFolio

**本地的项目工作台** · a local project workbench

[简体中文](README.md) | English

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6.svg)](../../releases)
[![Version](https://img.shields.io/badge/version-0.2.12-1677ff.svg)](CHANGELOG.md)

</div>

ttFolio 把硬盘上的项目文件夹登记进同一个界面：浏览代码、查看 Git、管理文档与架构图、全局搜索。

**磁盘是真相，数据库只是索引。** 项目文件原地不动，ttFolio 只在其上提供索引、入口与关系。

## 特性

- **项目登记与分析** —— 粘贴路径 / 文件夹对话框 / 父目录批量登记；自动识别项目类型、语言占比（Linguist 口径）、技术栈与 Git 摘要
- **文件浏览与编辑** —— 懒加载文件树、CodeMirror 6、草稿保护、外部修改检测、保存冲突三选一；UTF-8/BOM/UTF-16/GBK 与 CRLF/LF 原样保持
- **文件操作** —— 右键菜单（复制 / 移动 / 重命名 / 路径复制 / 资源管理器定位）、面包屑逐级定位；删除一律进回收站，可恢复原路径
- **Git** —— 工作区状态、diff、暂存、提交、历史与详情、分支切换；不做 push/pull，不存储凭据
- **文档与架构图** —— Markdown 自动发现与渲染、外部文档挂载、架构图目录内 HTML / 图片 / 文本分栏预览（独立只读端口 + iframe 沙箱）
- **搜索** —— Ctrl+K 命令面板；项目名 / 文件名 / 文件内容三档搜索（SQLite FTS5，中文友好，增量索引）
- **集合 · 标签 · 视图** —— 项目归类与折叠浏览、标签与备注、卡片墙 / 表格视图、失效项目一键重新定位
- **工作台总览** —— KPI 一览、需要关注的项目、聚合语言构成、跨项目最近提交
- **桌面版** —— Electron + NSIS 安装包，进程内服务端，原生文件对话框，内置检查更新

## 界面

![工作台总览](docs/images/overview.png)

![项目文件](docs/images/project-files.png)

![命令面板](docs/images/command-palette.png)

## 下载

从 [Releases](../../releases) 下载 `ttFolio-Setup-x.y.z.exe`。

- Windows 10/11 x64，无需 Node.js 或其他运行环境
- 安装目录自定义（支持中文路径），无需管理员权限
- 数据保存在 `%APPDATA%\ttFolio\`，卸载不删数据
- 安装包未签名：SmartScreen 提示时选择「更多信息 → 仍要运行」；首次启动可能被杀软全量扫描（约 1 分钟），二次启动 4 秒内

## 从源码运行

需要 Node.js ≥ 22。Git 可选（缺失时 Git 页签不可用，其余正常）。

```bash
npm install
npm run dev        # 后端 127.0.0.1:7717 + 前端 localhost:5173
```

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发模式（Vite + Fastify 热重载） |
| `npm run typecheck` | TypeScript 严格检查（shared / server / web 三包） |
| `npm run lint` | ESLint，0 警告容忍 |
| `npm run test` | Vitest 单元与集成测试（真实 SQLite / git 夹具） |
| `npm run build` | 生产构建 |
| `npm run dist:win` | 打包 Windows 安装包（含产物自检） |

> 打包后本机 `node_modules` 中的 better-sqlite3 为 Electron ABI，继续开发前先 `npm rebuild better-sqlite3`。

## 目录结构

```
packages/
  shared/   类型定义、Zod schema、常量（前后端共用）
  server/   Fastify + better-sqlite3
    core/   路径守卫、原子写、git、回收站、分析器、对话框、文件监听
    db/     SQLite 连接、迁移（只增不改 + 自动快照）、仓储层（全部 SQL 收敛于此）
    routes/ REST 接口
  web/      React 18 + Vite + Ant Design 5 + CodeMirror 6
electron/   桌面版主进程（进程内服务端 + 原生对话框桥）
scripts/    开发与构建脚本
```

## 设计原则

- 迁移只增不改；升级前自动生成数据库快照，损坏可自愈
- 所有文件访问经过统一路径守卫：拒绝越界、UNC、符号链接、Windows 保留名
- SSE 推送文件变更；草稿与版本守卫确保不静默覆盖任何修改
- 桌面版服务端进程内运行，无需系统 Node

## 安全与隐私

- 服务只监听 `127.0.0.1`，单机单人，无遥测、无 CDN
- 除用户显式操作（检查更新、打开资源管理器等）外不出网
- 被登记目录除用户操作外零改动；索引库清空不影响项目文件
- 数据与备份：`%APPDATA%\ttFolio\`（每日自动快照 + 手动备份/恢复 + JSON/CSV 导出），可用 `TTFOLIO_DATA_DIR`、`TTFOLIO_PORT` 覆盖

## 边界

明确不做：Git push/pull 与凭据管理、多用户与权限、云同步、目录自动扫描、AI 生成、IDE 能力（编译/调试/LSP）、内嵌终端。ttFolio 定位为项目仓库与工作台，不与 IDE 竞争。

## 路线图

- 按标签过滤的项目视图
- 集合手动排序
- 自动更新（评估中：受下载通道限制，当前为手动检查 + 引导下载）

## 反馈

欢迎提交 [Issue](../../issues) 反馈问题与建议；请附运行版本与复现步骤。

## 许可证

[MIT](LICENSE) © TT-Tao178
