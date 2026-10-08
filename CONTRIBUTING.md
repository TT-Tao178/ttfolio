# 贡献指南

感谢关注 ttFolio。当前仓库为个人维护节奏，但欢迎 Issue 与 PR。

## 环境

- Node.js ≥ 22（以 Node 24 验证）
- Git 可选（缺失时 Git 页签不可用，其余正常）
- Windows 10/11（桌面版打包仅支持 Windows；源码模式理论上跨平台）

## 开发流程

```bash
npm install
npm run dev        # 后端 127.0.0.1:7717 + 前端 localhost:5173
```

提交前请通过全部本地门禁（本项目无 CI，门禁靠自觉执行）：

| 命令 | 要求 |
| --- | --- |
| `npm run typecheck` | 零错误 |
| `npm run lint` | 零警告（`--max-warnings 0`） |
| `npm test` | 全部通过 |
| `npm run format:check` | 通过 |

## 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，正文用中文说明三件事：

1. **为什么**改（背景/问题）；
2. **影响面**（动了哪些模块、可能波及什么）；
3. **验证**（跑了什么门禁/手测了什么）。

```
feat(web): 一句话标题（祈使句，不加句号）

为什么：…
影响面：…
验证：…

Refs: 相关 issue 或提交
```

`feat` / `fix` / `refactor` / `docs` / `chore` / `test` / `style` 类型；一次提交只做一件事。

## PR 要求

- 门禁四项全绿；
- 说明手测内容（本项目无 e2e 门禁，界面行为靠人工验证）；
- 涉及数据库时：迁移只增不改，升级路径必须经过自动快照；
- 涉及文件访问时：必须走既有 PathGuard，禁止绕过。

## 已知边界

贡献前请阅读 README 的「边界」一节——push/pull、多用户、云同步、IDE 能力等
属于明确不做范围，相关 PR 不会被接受；改动前先开 Issue 对齐方向。
