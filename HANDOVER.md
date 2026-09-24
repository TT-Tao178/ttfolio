# HANDOVER · ttFolio 交接须知（给下一个会话/下一个 Agent）

> 本文件是本轮会话收口时写的**唯一入口**。先读本文件，再读 `PROGRESS.md`（台账）、
> `DECISIONS.md`（决策）、`KNOWN-GAPS.md`（已知打折项）、`README.md`（运行方式）。
> 规格权威顺序：`设计文档/ttFolio设计文档/ttFolio开发约束.md`（C-01..C-62）> 设计文档 > 开发规范 > 实现提示词。

## 0. 一句话与路径

- 产品：**ttFolio · tt项目仓库（a local project workbench）**——本地优先的项目工作台（不是 Jira 式 PM）。
- 代码：`D:\Workspace-1\code\ttfolio`（npm workspaces：`packages/shared|server|web`）
- 文档：`D:\Workspace-1\设计文档\ttFolio设计文档\`（设计文档/约束/规范/实现提示词/GLM 开工提示词/AntD 原型/ASCII 原型/对比页/契约模板）

## 1. 用户明确要求的工作方式（务必遵守）

1. **不跑 e2e**（`npm run test:e2e` / `npm run verify`）——由用户手测。可跑 `typecheck` / `lint` / `test`（vitest）。
2. **每次改动前先评估影响面与连带风险**（"改一个变量可能全体都变"）；提交信息里写清"影响面"。
3. **全程 git 管理**（Conventional Commits + 中文正文：为什么/影响面/验证 + `Refs:`）。
4. **不要动用户的真实数据**：索引库在 `%APPDATA%\ttFolio`。若用探针改过东西（设置/草稿/临时文件/忽略规则），
   **必须复原并核对**；临时文件走"移入回收站 → 彻底删除（`?confirm=1`）"路径，做到零残留。
5. 界面观感以《ttFolio界面原型-AntD.html》为基线，默认**浅色**主题。

## 2. 服务启动（本轮收口时已全部停止）

```powershell
cd D:\Workspace-1\code\ttfolio
npm run dev          # 同时起 Vite(5173) 与后端(7717)；用户内容只读端口 7817
```
- 开发入口：http://localhost:5173 ／ 生产构建入口：http://127.0.0.1:7717
- 两者都验证过可用；`vite.config.ts` 已显式绑 `127.0.0.1`（原先只绑 IPv6 `::1`，手输 127.0.0.1:5173 会连不上）。
- token 持久化在 `<数据目录>/token`，重启服务不会让已打开页面 401。

## 3. 当前状态

- 最新提交：524632e（README 重写 + MIT）；其上依次是 0.1.5 小窗口叠卡修复 /
  0.1.4 窗口适配与刷新反馈 / 0.1.3 总览四模块（含迁移 0003）/ 0.1.2 Git 加载更多 /
  0.1.1 前端尚未构建修复 / ABI 收包修复（精确哈希看 `git log --oneline -8`）
- 桌面版版本 **0.1.5**；`dist-electron/` 下有 Setup-0.1.0 ~ 0.1.5 六个安装包，
  **旧包一律不删**；出包必走 `npm run dist:win` 全链路（verify-dist-electron
  自检 7 项全绿才算数，绕过 dist:win 曾被自检真实拦截过一次）
- 远程已配好：`https://github.com/TT-Tao178/ttfolio.git`（私有），直接 git push
- 门禁：`npm run typecheck` ✅ / `npm run lint`（`--max-warnings 0`）✅ /
  `npm test` **61 条** ✅
- 数据库 user_version=**3**（0003：projects 加 git_last_commit_subject，只增不改）
- 第二十一/二十二轮（0.1.1~0.1.5）台账已在 `PROGRESS.md` 顶部补记；总览布局
  0.1.3→0.1.5 的演进线看该文「第二十二轮」小节
- e2e：**按用户要求未跑**，交给用户手测

## 4. 用户报障 4 类：已修且已实测（证据摘要）

| 报障 | 根因 | 证据 |
| --- | --- | --- |
| ① 左侧设置面板为空 | `Sidebar` 无 `settings` 分支 | 侧栏菜单项 **0 → 8**，点分组可滚动定位 |
| ① 设置里功能不能用 | `setSetting` 不更新 react-query 缓存 → 受控控件读旧值、改完弹回；4 个设置键无消费方 | 主题/密度即时生效且刷新后保持；密度按钮 32→24→40；`autoSave`/`cardSort`/`showIgnored`/`defaultProjectTab` 均已接线 |
| ① 导出 JSON/CSV 点了没反应 | `window.open('/api/export/...')` 带不了鉴权头 → **必然 401** | 改为带 token 取回 + blob 下载；实测下载到 1439B JSON / 244B CSV |
| ① 架构图目录名输入框不对 | `defaultValue` 只在挂载时读一次 + 仅回车保存 | 改受控；外部改服务端值刷新后显示新值；失焦即写库 |
| ① 界面 UI 显示不正确 | 背景全透明（深色下"面板深、底白"）；标签条溢出被静默裁掉；外壳尺寸/字号与原型不一致 | 令牌改 CSS 变量（深浅两套）；实测 56/40/776/28、域条 56/40×40、侧栏 232、右栏 320、正文 14px |
| ② 点文件夹报 EISDIR | `onSelect` 只用 `!key.endsWith('/')` 判目录 → 目录被当文件读；且懒加载子节点从未回写 `treeData` | 点目录**零次** `/api/fs/file` 调用、不进编辑器；展开后节点 1→22；后端目录读写返回 `400 IS_DIRECTORY` |
| ② 前进/后退/刷新有问题 | `openFile` 是死代码（从不写历史）；`syncFromServer` 把 history 置空；**`updateActiveLocation` 用 `tabKey` 判断导航变化** → 跨页签不压栈；「刷新」会冲掉未保存内容 | 打开文件后后退/前进可用；跨页签 files→Git→后退→**files**→前进→**Git**；刷新后缓冲内容与未保存圆点保留 |
| ③ 更改主题有 bug | 缓存不更新（同上）+ localStorage **永久压过**服务端值 | 浅色 `rgb(245,245,245)` ↔ 深色 `rgb(20,20,20)`，无需刷新；「跟随系统」随系统色实时切换 |
| ④ 设置要实时生效 | 同上 + 依赖项未刷新 | 忽略项开关：立即写库 + 触发 `showIgnored=1` 树请求，节点 20→23（无需刷新） |

另修：草稿恢复时机（`draftReady` 判定 + `isFetchedAfterMount` + `staleTime:0`）、项目标签标识含 `targetPath`
导致的**标签爆炸**（曾滚出 21 个同名标签）、侧栏视图标题字面量 `recent/pinned`、标签条横向溢出、
新建文件恒落项目根、`vite` watcher 被原子写临时目录打挂（EBUSY，加 `watch.ignored`）。

## 5. 未完成 / 待确认（下一步候选）

> 第十二轮遗留的 ①②③ 已修完并经用户过目；本轮（第十三轮）按用户点名完成三项，
> 同样**先等用户手测，再定后续优先级**。

1. ~~面包屑不显示当前打开的文件~~ ✅ 第十二轮已修
2. ~~刷新后恢复的活动标签可疑~~ ✅ 第十二轮已修
3. ~~FR-11.6「打开日志」按钮缺失~~ ✅ 第十二轮已补
4. ~~总览项目卡片 + 分页~~ ✅ 第十三轮已修（等手测）
5. ~~添加项目系统对话框不显示~~ ✅ 第十三轮已修——注意：Win11 前台锁是 OS 行为，
   服务端尽力抢焦点 + 前端即时提示（含 Alt+Tab 指引）兜底，手测时若对话框仍被浏览器
   挡住，按提示 Alt+Tab 可找到（等手测确认体验是否可接受）
6. ~~设置页只占一小部分~~ ✅ 第十三轮已改为卡片栅格（等手测）
7. 原型剩余观感差异（中低优先级）：卡片悬浮快捷操作、右键仅"…"图标可用。
8. `KNOWN-GAPS.md` 里的 7 项体验打折项。
9. 待用户决定：`%APPDATA%\ttFolio\trash\` 下有 6 个**空目录**（DB 0 行、界面 0 条，来自更早会话），
   是否要清掉（清空回收站只删 `trash/` 内容，不碰项目文件）。

## 6. 环境陷阱（本轮排查最耗时，务必记住）

**编辑工具以 ReplaceFile 方式落盘，而 ReplaceFile 对读方不是原子的**：Vite 可能在改名瞬间读到**半截文件**
（函数声明在文件末尾）并缓存转换结果 → 浏览器拿到"有调用、没有声明"的模块，报
`xxx is not defined`，行为像"代码改了不生效"。**处置：重启 dev server**，别去改代码。
判断方法：
```powershell
$src = (curl.exe -s "http://localhost:5173/src/app/store.ts") -join "`n"
$src -match 'function sameLocation'   # 若为 False 而源码里有 → 就是这个问题
```

## 7. 测试资产（探针脚本，均在 `.tmp-test/probe/`，已被 .gitignore 忽略）

| 脚本 | 用途 |
| --- | --- |
| `svc-check.mjs` | 两个入口是否渲染、有无控制台报错、外壳高度 |
| `svc-geometry.mjs` | 分栏真实像素宽度、标签标题、状态栏 |
| `verify-abc.mjs` / `verify-bc.mjs` | 刷新不丢内容、后退前进往返、草稿恢复（含清理） |
| `verify-refresh-safety.mjs` | 「刷新」是否冲掉未保存内容（数据丢失级断言） |
| `verify-autosave.mjs` | 自动保存端到端（含服务端值断言与清理） |
| `verify-settings-io.mjs` | 导出下载（download 事件）+ 架构图目录名跟随服务端 |
| `verify-round4.mjs` | 6 域侧栏、跟随系统主题、忽略项跨页实时、跨页签前进后退 |
| `verify-round5.mjs` | 重载后历史栈、面包屑内容、未保存关闭标签拦截 |
| `verify-round6.mjs` | 面包屑文件名 + 会话 activeTabId（抓 PUT 体 vs GET 值 vs 刷新后活动标签） |
| `verify-round7.mjs` | 面包屑逐级点击（点项目名回概览并关编辑器、后退还原、点工作台不改标签名） |
| `verify-round8.mjs` | 刷新还原（活动标签/面包屑/编辑器）+ 未保存关标签拦截 + 草稿清理 |
| `verify-round9.mjs` | FR-11.6「打开日志」（`page.route` 拦截，不真弹资源管理器）+ 白名单反向校验 |
| `verify-round13.mjs` | 第十三轮：总览项目卡片分页（route 注入 25 个假项目、不写库）/ 系统对话框即时反馈 / 设置页 8 卡栅格与锚点定位 |
| `verify-round14.mjs` | 第十四轮：设置页五卡统一 320px + 无 FR 字样 / 别名与原名同显（route 注入假项目，不写库） |
| `verify-round15.mjs` | 第十五轮：外部修改警告收敛（route 伪造 fs/file 版本）/ 侧栏视图项移除 / 挂载多选（拦截 pick-file 与 mounts）；结尾自动清理探针草稿 |
| `verify-round16.mjs` | 第十六轮：文档大纲点击定位（route 合成 md）/ 设置页全宽卡片核对 |
| `verify-round17.mjs` | 第十八轮：全量重分析前后语言占比对比（只读扫描） |
| `verify-round19.mjs` | 第十九轮：面包屑子页签点击跳转、后退还原、标签数不变 |
| `verify-round20.mjs` | 第二十轮：总览收敛 / 提交详情 / 历史下拉 / 自动打开首文件 |
| `verify-round21.mjs` | 0.1.2：Git 加载更多——keepPreviousData 不闪空、滚动位置保持、末尾判定 |
| `verify-round22.mjs` | 0.1.3：总览四模块真实数据 + route 注入 25 假项目翻页分页器防漂移 |
| `verify-round23.mjs` | 0.1.4：minHeight 随窗口宽度失效清零、回第 1 页重新校准、刷新 spin |
| `verify-round24.mjs` | 0.1.5：小窗口提交卡与卡片栅格零重叠、大窗垫片贴底 |
| `dialog-topmost.mjs` | Win32 前台焦点前后对照（按 PID 抓对话框 + 测出现耗时 + GetForegroundWindow；会在桌面短暂闪对话框） |
| `restore-active-tab.mjs` / `check-active-tab.mjs` | 收尾把活动标签点回第一个 / 只读核对服务端会话活动标签 |
| `diag-reopen.mjs` | 树节点“反选”诊断：后退后再点同一个文件编辑器不打开 |
| `inspect-data.mjs` | **只读**巡检数据残留（草稿/设置/忽略规则/回收站/会话标签），复核用 |
| `audit-ui.mjs` | 深浅两色 × 7 屏巡检（溢出/压扁/漏令牌/控制台） |
| `compare-shell*.mjs` | 与 AntD 原型逐项度量对比 |
| `REPORT-*.md` | 早期子代理的探查报告（打开项目排查 / UI 差异） |

跑法：`node .tmp-test/probe/<脚本>.mjs`（需先 `npm run dev`）。探针读文本一律用 `evaluate`
（CodeMirror 的 `.cm-content` 用 `innerText` 会超时）。
**注意**：探针会真的调 `/api/open`，要验证"打开日志/打开方式"类动作时请像 `verify-round9.mjs`
那样用 `page.route` 拦掉，否则会在用户桌面弹出资源管理器窗口。

## 8. 用户数据边界（第十三轮收口时已用 `inspect-data.mjs` 只读复核）

- 设置：`theme=light / density=middle / showIgnored=关 / autoSave=关 / watch=开 / archDir=架构图 / defaultProjectTab=files`
- 草稿表 **0 条**；回收站 DB **0 条**；项目目录无探针文件；忽略规则**无被禁用项**
- 用户会话标签：**9 个**（第十二轮收口时 12 个，减少的 3 个是用户手测期间自己关闭的；
  第十三轮探针只复用既有标签、未新增；分页验证用 route 注入假数据，未写库）；
  活动标签已还原为第一个「工作台」
- `%APPDATA%\ttFolio\trash\` 下有 **6 个空目录**（DB 0 行 → 界面显示 0 条），来自更早会话，等用户决定是否清

## 9. 关键决策索引（详见 `DECISIONS.md`）

工作台分屏（总览 vs 卡片墙）/ 面板尺寸持久化到 `ui_layout_json`（不走 localStorage，C-29）/
`PaneSplit` 封装 Splitter 的四个坑 / `pretest:e2e` 强制先构建 / vite 显式绑 127.0.0.1 /
颜色令牌走 CSS 变量（`SEMANTIC` 改指 `var(--tt-*)`，15 个引用点零改动）/ token 持久化到 `<dataDir>/token` /
会话活动标签落 `sessions.active_tab_id`（迁移 0002 补列，不用 settings 旁的旁路存储）/
「打开日志」走 `/api/open {target:'logs'}` 的**独立分支**而非放宽项目白名单。
