# PLAN · 第 33 轮：工程补强（第三轮审查处置）

> 起草：2026-10-08 · 状态：**待用户批准，未入库**
> 依据：第三轮审查报告（2026-10-08，0.2.12 已推送状态）。
> 执行原则（沿用既定工作方式）：小步提交、Conventional Commits 中文正文、
> 每步真实退出码门禁（typecheck / lint / vitest）、不跑 e2e（用户手测）、
> 探针如触碰用户数据必须复原核对、出包必走 dist:win 全链路、
> 出包后 `npm rebuild better-sqlite3` 翻回 Node ABI。

---

## 0. 总览

| # | 事项 | 类型 | 优先级 | 需用户点头 | 提交数 |
| --- | --- | --- | --- | --- | --- |
| M1 | 删除未使用的 @fastify/static（消除 high 漏洞） | 依赖 | P0 | 否 | 1 |
| M2 | KNOWN-GAPS 三条决策入册（Token 明文 / i18n 不做 / e2e 冻结） | 文档 | P1 | 否 | 1 |
| M3 | 补 tag v0.2.5~v0.2.12 + 删 3 个规划性脏 tag | Git | P1 | **是**（删远端 tag） | 0（纯 Git 操作） |
| M4 | Release 备忘稿（0.2.5~0.2.12 八份 notes 供浏览器建页拖资产） | 文档 | P1 | 否（资产仍需你拖） | 1 |
| M5 | web 纯函数测试（store / parseSubTab / semverNewer） | 测试 | P1 | 否 | 2 |
| M6 | npm run format script（prettier 接线） | 工程 | P2 | 否 | 1 |
| M7 | npm audit 入 dist:win 前置门禁 | 工程 | P2 | 否 | 1 |
| M8 | Electron 窗口尺寸/位置/最大化状态记忆 | 功能 | P2 | 否 | 1 |
| M9 | 渲染层未捕获异常落盘 + 主进程崩溃兜底 | 功能 | P2 | 否 | 1 |
| M10 | 迁移 0004：collection_members(project_id) 索引 | 数据库 | P3 | 否 | 1 |
| M11 | 社区文件（CONTRIBUTING / SECURITY.md / issue+PR 模板） | 文档 | P3 | 否 | 1 |
| M12 | README 截图 | 文档 | P3 | 否（探针截图） | 1 |
| M13 | 磁盘与仓库卫生（tmp 目录 / test-results / HANDOVER-legacy.md） | 卫生 | P3 | **是** | 1 |
| R | 升版 0.2.12 → 0.2.13 + dist:win + 台账 + 推送 | 发布 | — | 否 | 3 |

依赖关系：M7 依赖 M1（先删掉现有 high，门禁才能绿）；M4 依赖 M3（Release 页对应 tag）。
其余相互独立，可按序执行。

---

## M1 · 删除未使用的 @fastify/static（P0）

### 背景与事实核准（含对前次评审的纠正）

- `npm audit --omit=dev` 报 **high**：`@fastify/static ≤10.1.1`，四条通告
  （路径穿越 / 编码分隔符绕过路由守卫 / 非规范 URL 绕过鉴权 / 目录列表路径穿越）。
- **第二轮流评审的表述有误**：该包并非"服务静态前端与 7817 端口的组件"——
  全仓核查（grep 全部 ts/mjs/cjs，排除 node_modules 与 dist）**零处 import**：
  - Web 前端静态服务：`packages/server/src/app.ts:143,166` 手写 `readFileSync` + MIME 表；
  - 7817 用户内容：`packages/server/src/static/userContent.ts:84,117` PathGuard + `fsp.readFile`；
  - `npm ls @fastify/static`：仅 `packages/server/package.json:13` 声明 `"^8.0.1"`，装 8.3.0，无人引用。
- 结论：**死依赖**。攻击面实际为零（代码从未注册进 Fastify），但审计持续报 high，
  且按第二轮评审的"升级到 10.1.5"方案要做破坏性升级与回归——都是不必要的成本。

### 改动清单

1. `packages/server/package.json`：删除 `"@fastify/static": "^8.0.1"` 一行。
2. 根目录执行 `npm install`（刷新 package-lock.json）。

### 不做什么

- 不升级到 10.1.5（无使用即无升级价值）；不顺手清理其他依赖（保持单一目的提交）。

### 风险与回滚

- 风险：理论为零（无引用）。唯一连带是打包体积微降与 lockfile diff。
- 回滚：`git revert` 单提交即恢复。

### 验证

- `npm ls @fastify/static` → empty；
- `npm audit --omit=dev` → **0 漏洞**（应彻底清零，这是本项的验收标准）；
- 门禁三绿；dev 起服务后首页与 7817（任一项目 /arch 资源）正常返回。

### 提交草案

```
chore(deps): 移除未使用的 @fastify/static——消除 high 级审计漏洞

为什么：npm audit 报 @fastify/static ≤10.1.1 四条 high 通告；全仓核查
该依赖零处 import（前端静态由 app.ts 手写 readFile 服务、7817 用户内容
由 userContent.ts 的 PathGuard 服务），系早期遗留的死依赖。删除即消除
漏洞，无需第二轮评审误判的"破坏性升级 + 回归"方案（该误判在此纠正）。

影响面：仅 packages/server/package.json 一行 + lockfile；运行时零影响。
验证：npm audit --omit=dev 0 漏洞；门禁三绿；dev 冒烟首页/7817 正常。
```

---

## M2 · KNOWN-GAPS 三条决策入册（P1）

### 背景

第三轮审查 A2 / E14 / C7 三个点属于"有意取舍"而非缺口——按 M-3/C-49 原则
（不打折的绝不写，写下的必须说明缺什么/为什么/怎么补），应从口头决策变成文档资产，
防止后续会话把它们当新问题重复提出。

### 改动清单（docs/internal/KNOWN-GAPS.md，仅文档）

1. **Token 明文存储**（新条目 #10，或并入"环境限制"节）：
   - 缺：`settings.github_token` 为 SQLite 明文（settings 表），未用 Windows 凭据管理器。
   - 为什么不现在做：本地单机单用户威胁模型下，能读 `%APPDATA%` 的人不需要这个 Token；
     引入 keytar/DPAPI 增加原生依赖与打包复杂度，收益不成比例。
   - 补法（若仓库转公开或引入多用户）：keytar 存取，settings 只留"已配置"标记。
2. **i18n 明确不做**：在"明确不做"节补一句——界面中文硬编码是当前产品定位
   （个人工作台）的有意决策，README 已双语；若未来面向国际用户再引入 i18n 框架。
3. **e2e 冻结资产**：在"环境限制"节补记——tests/e2e 三份 spec 因"不跑 e2e"政策
   长期未运行，选择器已随 UI 演进漂移，**视为冻结资产**；解冻前置条件＝跑通并修复
   或重写，建议放在 1.0 之前的整备轮。

### 验证 / 提交

文档改动；提交 `docs(internal): KNOWN-GAPS 入册三条决策——Token 明文取舍 / i18n 不做 / e2e 冻结`。

---

## M3 · tag 补齐与清理（P1，需点头）

### 事实核准

- 现有 tag 止于 v0.2.4；v0.2.5~v0.2.12 共 **8 个版本无 tag**。
- 升版提交哈希（`git log --grep="版本升至"` 逐条核对）：

| tag | 提交 |
| --- | --- |
| v0.2.5 | e81319d |
| v0.2.6 | 3469dfb |
| v0.2.7 | a0be03f |
| v0.2.8 | 0a13d99 |
| v0.2.9 | 0d3ecad |
| v0.2.10 | 48c38bd |
| v0.2.11 | 06d26fb |
| v0.2.12 | ed92c47 |

- 规划性脏 tag 三个：`v0.1.0-p0`、`v0.3.0-p2`、`v1.0.0`（Web 阶段里程碑占位，
  与桌面版版本线无关，误导 `git tag` 阅读）。

### 操作清单（纯 Git，无代码提交）

```bash
git tag v0.2.5 e81319d && git tag v0.2.6 3469dfb && git tag v0.2.7 a0be03f \
  && git tag v0.2.8 0a13d99 && git tag v0.2.9 0d3ecad && git tag v0.2.10 48c38bd \
  && git tag v0.2.11 06d26fb && git tag v0.2.12 ed92c47
git push origin v0.2.5 v0.2.6 v0.2.7 v0.2.8 v0.2.9 v0.2.10 v0.2.11 v0.2.12
# 删脏 tag（本地 + 远端；远端删除不可逆，需你点头）
git tag -d v0.1.0-p0 v0.3.0-p2 v1.0.0
git push origin :refs/tags/v0.1.0-p0 :refs/tags/v0.3.0-p2 :refs/tags/v1.0.0
```

### 风险

- 新增 tag：零风险（只加不改）。
- 删脏 tag：远端操作不可逆；这三个 tag 无 Release/CI 挂靠，删除仅影响引用。
  **执行前单独再向你确认一次。**

### 验证

`git ls-remote --tags origin | grep -c "v0.2"` → 13（v0.2.1~v0.2.13 最终应为 13，
本轮后 12）；GitHub 仓库 Tags 页八个新 tag 可见。

---

## M4 · Release 备忘稿（P1）

### 背景与约束

- uploads.github.com 受网络限制 → 资产只能你浏览器拖（既定事实）。
- api.github.com 正常但 Release 页创建需要 Token 前台注入（后台取 token 401，记忆在案），
  且你已有手动建页习惯 → **分工：我出内容稿，你建页拖资产**。
- 「检查更新」功能（0.2.12）依赖 `releases/latest`——当前 GitHub 最新停在 v0.2.4，
  功能数据面为空；本项完成 + 资产上传后，链路才真正闭环。

### 改动清单

1. 新建 `docs/internal/RELEASE-NOTES-0.2.5~0.2.12.md`：八个小节，每节＝
   版本号 + 一行标题 + 3~6 条要点（素材取自 CHANGELOG 对应节，不新造内容）+
   安装包文件名（`dist-electron/` 实名核对）。
2. 文档头部写清拖传操作顺序：建 Draft → 贴对应小节 → 拖 exe → Publish（可一次全建）。

### 验证 / 提交

- 验收＝你按稿在 GitHub 建齐 8 个 Release 并挂资产；之后本机 0.2.12 点
  「检查更新」应显示"已是最新（v0.2.12）"——顺带完成该功能的端到端验证。
- 提交：`docs(internal): 0.2.5~0.2.12 Release 备忘稿（浏览器建页拖资产用）`。

---

## M5 · web 纯函数测试（P1）

### 背景与事实核准

- 62 条测试全在 server；web 包零测试。第三轮补丁加的逻辑（closedTabs 栈、
  moveTab 固定区钳制、semverNewer）与历史 bug 高发区（tabKey 标识、
  sameLocation 压栈、parseSubTab）全无覆盖。
- vitest 现状：`vitest.config.ts` `include: ['packages/**/*.test.ts']` ——
  路径已覆盖 web，但 store.ts 用了 `@/` 别名，**需补 alias** 才能在 node 环境导入。

### 改动清单（两个提交）

**提交 1（抽纯函数，行为零变化）：**

1. `packages/web/src/features/workbench/parseSubTab.ts`（新）：把 `parseSubTab`
   从 Workbench.tsx 原样搬出；Workbench.tsx 改为 `export { parseSubTab } from './parseSubTab'`
   兼容既有 import（e2e/其他组件引用不破）。
2. `packages/shared/src/semver.ts`（新）：把 `semverNewer` 从 system.ts 搬到 shared
   （前后端都可能用）；system.ts 引用之。函数体不动。

**提交 2（测试本体）：**

3. `vitest.config.ts` 加 `resolve.alias`（`@` → `packages/web/src`）。
4. `packages/web/src/app/store.test.ts`（新），用例清单：
   - tabKey：overview 按subTab 区分（工作台总览 vs 最近打开不同标签）；project 不含
     targetPath（打开文件后点卡片**不**开新标签——历史"标签爆炸"回归锚点）；
   - openTab：同 key 复用并同步位置；不同 key 新开；
   - updateActiveLocation：完整位置比较压栈（文件页→Git 页→后退回放——历史
     "跨页签不压栈"回归锚点）；sameLocation 不重复压栈；history 上限 100；
   - closeTab：脏标签返回 id 拦截（不进 closedTabs）；正常关闭进栈、上限 10；
   - reopenLastClosed：弹出重开、栈空 no-op；
   - moveTab：固定区钳制（非固定拖不进 [0,pinCount)、固定不出固定区）、越界 no-op；
   - parseNavHistory：脏 JSON / 空历史回落单点；navIndex 越界钳制；
   - serializeSession：navHistoryJson 截断至 30 的往返一致性。
5. `packages/web/src/features/workbench/parseSubTab.test.ts`（新）：null/view:recent/
   view:my-*（dirty/nodocs/noarch/unanalyzed/stale/archived）/col: 前缀（**集合过滤
   修复 4823f5d 的回归锚点**）/JSON 分支 / 非法 JSON 回落。
6. `packages/shared/src/semver.test.ts`（新）：v 前缀、两段/三段、进位
   （0.2.9 < 0.2.10——parseInt 数值比较回归锚点）、预发布后缀忽略、非法输入。

### 不做什么

- 不测 React 组件渲染（不引 jsdom/@testing-library——成本与收益不匹配，本轮聚焦纯逻辑）；
- 不为凑覆盖率写镜像实现的断言。

### 风险与回滚

- 抽函数是搬移不是改写；typecheck 保证引用完整。回滚 revert 两个提交即可。

### 验证

门禁三绿，且 `npm test` 总数从 62 上升（预计 +25~35 条）。

---

## M6 · format script 接线（P2）

### 改动清单

1. 根 `package.json` scripts 加：`"format": "prettier --write \"packages/*/src/**/*.{ts,tsx}\" \"scripts/**/*.mjs\" \"electron/**/*.cjs\""`、
   `"format:check": "prettier --check ..."`（同参）。
2. 首跑 `npm run format`，格式化 diff **单独成一个提交**（若产生 diff），与 script 添加分开。
3. `lint` 脚本不动（eslint-config-prettier 已在链上，无规则冲突）。

### 不做什么

- 不加 husky / lint-staged / commitlint（第二轮评审已议：与中文正文提交习惯不匹配，
  hook 链留给用户未来决定）。

### 验证

`npm run format:check` 通过；门禁三绿；格式化提交后 `git diff` 仅空白/引号类变化。

---

## M7 · audit 入 dist:win 前置门禁（P2，依赖 M1）

### 改动清单

1. 根 `package.json` scripts 加：
   `"audit:prod": "npm audit --omit=dev --audit-level=high"`
2. `"dist:win"` 改为：
   `"npm run audit:prod && npm run build && npm run build:server && electron-rebuild -f -w better-sqlite3 && electron-builder --win nsis && node scripts/verify-dist-electron.mjs"`
   ——审计放最前：有 high 时 **fail fast**，不浪费几分钟构建后才发现。

### 设计说明（为什么是 hard gate）

- high 级即阻断：本产品安全叙事（本地优先/不出网）依赖供应链干净；
- 若未来出现"有通告无修复版"的死锁：临时降级 `--audit-level=critical` 并在
  KNOWN-GAPS 记录，**不允许静默去掉该步**。

### 验证

本地 `npm run audit:prod` 退出码 0（M1 之后）；临时 `npm i` 一个已知漏洞包验证
非零退出后再还原（可选，做的话用临时目录不碰主 node_modules——**不做**，避免
无谓的依赖树扰动，逻辑由 npm audit 自身保证）。

---

## M8 · 窗口状态记忆（P2）

### 事实核准

`electron/main.cjs:123-131`：BrowserWindow 写死 `width:1440, height:900`，
无 bounds/maximized 持久化；userData 已随 TTFOLIO_DATA_DIR 隔离
（`app.setPath('userData', ...)`，main.cjs:22-23），窗口状态文件放 userData 天然跟随隔离。

### 改动清单（仅 electron/main.cjs）

1. 新增 `loadWindowState()` / `saveWindowState(win)`：
   - 文件：`path.join(app.getPath('userData'), 'window-state.json')`；
   - 字段：`{ x, y, width, height, maximized }`；
   - 读取防御：JSON 解析失败/字段非法 → 回落默认 1440×900 并居中
     （`screen.getPrimaryDisplay().workArea` 计算）；
   - **上屏校验**：恢复的 bounds 必须与 `screen.getAllDisplays()` 任一 workArea 有交集，
     否则回落默认（防拔掉外接屏后窗口恢复到不存在的坐标——经典坑）；
   - 尺寸下限：width ≥ 960、height ≥ 600。
2. 创建 BrowserWindow 改用恢复值；`win.on('close')` 时保存（最大化时保存
   `maximized:true` 且 bounds 存还原尺寸——用 `win.getNormalBounds()`）。
3. 二实例聚焦（已有 `requestSingleInstanceLock` 分支）不动。

### 验证

手测（装包后）：改窗口大小/位置 → 关闭 → 重开应还原；最大化关闭重开应仍最大化并还原；
外接屏场景无法自动验证，代码路径由上屏校验兜底。dev 下可用 `TTFOLIO_DATA_DIR` 隔离冒烟。

### 提交草案

```
feat(electron): 记忆窗口尺寸/位置/最大化状态

为什么：窗口每次启动写死 1440×900（main.cjs），正规桌面应用应记住
上次状态；状态文件放 userData，随 TTFOLIO_DATA_DIR 隔离同步。

影响面：仅 electron/main.cjs——loadWindowState/saveWindowState +
上屏校验（防外接屏拔除后窗口恢复到不存在的坐标）+ 尺寸下限；
脏文件回落默认并居中。二实例逻辑不动。

验证：门禁三绿；改大小/位置/最大化 → 重启还原；隔离目录冒烟。
```

---

## M9 · 崩溃兜底（P2）

### 背景

渲染进程未捕获异常目前去向不明——白屏时用户与日志均无从诊断。本地优先应用
不上报远端，但要落盘并能被「打开日志」看到。

### 改动清单（两个文件）

1. **web 侧**（`packages/web/src/app/App.tsx` Shell 挂载一次）：
   - `window.addEventListener('error')` + `'unhandledrejection'` →
     `POST /api/log/client`（body: `{ message, stack?, source? }`，节流：同 10 秒
     同消息只发一次，防错误风暴打爆日志）。
2. **server 侧**（`packages/server/src/routes/system.ts`）：
   - `POST /api/log/client-error`：Zod 校验（message ≤ 2000 字符）→ `ctx.logger.warn`
     （pino 既有滚动策略 7×10MB）+ `logActivity(kind:'client.error', level:'L2')`；
     返回 200 no-op，**不抛错**（日志通道自身绝不能成为新错误源）。
3. **main 进程**（`electron/main.cjs`）：
   - `app.on('render-process-gone', ...)` → 追加一行到
     `path.join(app.getPath('userData'), 'renderer-crash.log')`（含 reason/exitCode/时间）；
   - 不弹窗（保持静默落盘，诊断走日志）。

### 不做什么

- 不做 CrashPad/Sentry 远端上报（明确不做清单）；不做 UI 内的错误浮层
  （既有的 PaneErrorBoundary 已覆盖组件级）。

### 验证

dev 手测：控制台手动 `throw` / `Promise.reject` → `logs/ttfolio.log` 出现
`client.error` 记录；「打开日志」可见。主进程分支代码审查为主（render-process-gone
难以安全人工触发，不强行制造崩溃）。

---

## M10 · 迁移 0004：collection_members 索引（P3）

### 事实核准

- `0001_init.sql:77`：`PRIMARY KEY (collection_id, project_id)` ——collection 侧查询
  有索引；但 `projectsRepo.ts:117` 的 `WHERE project_id IN (...)`（加载每个项目的
  所属集合，ProjectSummary 必经路径）无 project_id 侧索引 → 全表扫描。
- 当前规模（集合×项目，百行级）无感知；正规做法补索引，一条迁移的事。

### 改动清单

1. `packages/server/src/migrations/0004_collection_member_project_idx.sql`（新）：
   ```sql
   -- 0004：collection_members 的 project_id 侧索引（加载项目所属集合的查询路径）
   CREATE INDEX IF NOT EXISTS idx_collection_members_project
     ON collection_members(project_id);
   ```
2. 无需改 repo 代码（索引自动生效）；迁移机制自动执行（启动时按序跑未应用的）。

### 验证

- `npm run migrate`（或 dev 启动）后 `PRAGMA index_list(collection_members)` 含新索引；
- 集合功能手测回归（侧栏折叠/归属弹窗/集合视图）；
- 真实库操作前**自动快照**由既有迁移机制保证（迁移前 VACUUM INTO），无需额外动作。

---

## M11 · 社区文件（P3）

### 改动清单（全部新增，零代码）

1. `CONTRIBUTING.md`：环境要求（Node ≥22 / Git 可选 / Windows）、五条命令门禁表、
   Conventional Commits + 中文正文（为什么/影响面/验证）的提交规范、PR 流程
   （门禁绿 + 手测说明）、**明确不加 CI** 的现状说明（本地门禁为准）。
2. `SECURITY.md`：报告渠道（私有 Issue）、响应承诺口径（个人项目，尽力而为）、
   支持版本（最新 tag）、本地威胁模型简述（127.0.0.1 单机/不出网/PathGuard）。
3. `.github/ISSUE_TEMPLATE/bug_report.md`（版本/复现步骤/日志位置）与
   `feature_request.md`；`.github/PULL_REQUEST_TEMPLATE.md`（为什么/影响面/验证三栏，
   对齐提交正文格式）。
4. **不含任何 workflow**（CI 不加，既定决策）。

### 验证

GitHub 侧建 Issue 时模板自动出现（推送后你侧可见）。

---

## M12 · README 截图（P3）

### 方案

1. dev 起（隔离数据目录）+ 探针（Playwright，`.tmp-test/probe/` 既有方法论）截三张：
   ① 工作台总览（KPI+卡片）② 项目页·文件树+编辑器分栏 ③ Ctrl+K 命令面板。
   浅色主题、窗口 1440×900、无真实项目数据（隔离目录注册 2-3 个演示项目——
   **探库自建临时项目目录在系统临时区，用后删净**）。
2. 存 `docs/images/overview.png / project-files.png / command-palette.png`
   （压缩到 ≤300KB/张）；README.md 与 README.en.md 的 Download 节后插
   `## 界面` 一节三图（英文版同图不重复存）。

### 风险

截图含本机路径/项目名——统一用演示项目（`demo-web` / `demo-api` 之类命名）规避，
截后人工核对再入库。

---

## M13 · 磁盘与仓库卫生（P3，需点头）

| 目标 | 现状 | 处置 | 需点头 |
| --- | --- | --- | --- |
| `dist-electron-tmp`~`tmp6` 六目录 | 杀软/残留进程曾锁 | 尝试 `rm -rf`；仍锁则列出持锁进程（handle.exe 无则跳过）留待手动 | 否（纯磁盘） |
| `test-results/` | Playwright 残留 | 删（已被 ignore） | 否 |
| 根目录 `HANDOVER-legacy.md` | 未跟踪游离文件 | **你此前说勿动**——给两个选项：a) `git mv` 进 docs/internal/ 归档 b) 删除 | **是** |

处置结果（删了几个/剩几个谁锁着）写入本轮台账；不产生代码提交（除非 HANDOVER-legacy.md
选 a，则一个 `chore(repo)` 提交）。

---

## R · 发布收口（0.2.13）

1. 版本提交：根 package.json + `packages/server/src/index.ts` 两处 → 0.2.13。
2. `dist:win` 全链路（现在含 M7 的 audit 前置）；EBUSY 如期而至则按既定流程
   换全新 `dist-electron-tmp7` 输出目录 + `VERIFY_DIST` 自检 + 安装包移回。
3. 出包后 `npm rebuild better-sqlite3` 翻回 Node ABI + vitest 复绿。
4. 台账：PROGRESS 追记第 33 轮、HANDOVER 版本口径滚动（24 个安装包）、KNOWN-GAPS
   若 M7 门禁在出包时首次实战也如实记。
5. `git push`（含 M11 社区文件与 M12 截图）。
6. **手测清单**（装 0.2.13）：窗口状态记忆（改大小/位置/最大化→重启还原）；
   崩溃落盘（开发者工具里 `setTimeout(()=>{throw 1})` → 打开日志见 client.error）；
   集合功能回归；「检查更新」在你建完 Release 后应报"已是最新 v0.2.13"。

---

## 明确不做（本轮范围外，沿用既有决策）

- CI / commitlint / husky；electron-updater 全自动更新；Sentry 类远端上报；
  macOS/Linux 支持；按标签过滤视图（KNOWN-GAPS #8）；集合手动排序（#9）；
  @fastify/static 升级替代方案（M1 直接删除，无升级）。

## 执行顺序与提交序列（预计 14 个提交 + 2 个 Git 操作 + 发布 3 个）

```
M1  chore(deps):     移除未使用的 @fastify/static
M2  docs(internal):  KNOWN-GAPS 入册三条决策
M3  （Git 操作：补 8 tag 推送；删 3 脏 tag 待点头）
M4  docs(internal):  Release 备忘稿 0.2.5~0.2.12
M5  refactor(web/shared): parseSubTab/semverNewer 抽纯函数（行为零变化）
    test(web,shared): store/parseSubTab/semver 纯函数测试
M6  chore:           format script + 格式化 diff（两个提交）
M7  chore:           audit:prod 入 dist:win 前置门禁
M8  feat(electron):  窗口状态记忆
M9  feat(web,server): 渲染层异常落盘 + 主进程崩溃兜底
M10 feat(db):        迁移 0004 collection_members 索引
M11 docs:            CONTRIBUTING/SECURITY/模板
M12 docs:            README 截图
M13 chore(repo):     卫生清理（HANDOVER-legacy.md 处置待点头）
R   chore(release):  0.2.13 + dist:win + docs(internal) 台账 + push
```

每步门禁（真实退出码）：`npm run typecheck && npm run lint && npm test`；
涉服务端行为的项（M9）加隔离目录 dev 冒烟；涉数据行为零（M10 只加索引，迁移前自动快照）。
