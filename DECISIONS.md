# DECISIONS

格式：日期 | 决策 | 原因 | 备选方案

- 2026-09-21 | 运行时 Node 使用本机已安装的 v24（engines 声明 >=22） | 环境只有 Node 24.19，better-sqlite3/chokidar/fastify 均支持 | 安装 Node 22（用户环境不可控）
- 2026-09-21 | git 身份仅在本仓库设置 user.name=GLM Agent / agent@local | 按第十六节 A.2 要求，全局身份已存在不动 | 修改全局配置（禁止）
- 2026-09-21 | server 运行统一走 tsx（dev=tsx watch，start=tsx src），build 对 server 执行 noEmit 类型检查、对 web 产出真实 dist | 避免维护 ESM/CJS 双构建产物；tsx 为常规运行时，行为与 node 一致且支持 TS 直跑 | tsc emit + node（需要为 dist 补 .js 后缀解析与 shared 产物接线，复杂度高、收益低）
- 2026-09-21 | shared 包以源码形式被消费（main/types 指向 src/index.ts） | workspaces 软链下 vite/tsx/vitest 都可直接编译 TS 源，开发期改动即时生效 | 维护 shared 的 dist 产物并在开发期 watch
- 2026-09-21 | 鉴权 token 通过 HTTP 头 X-TTFolio-Token 传递；服务端把 token 注入所托管 index.html 的 window.__TTFOLIO_TOKEN__；vite 代理在请求头补 token；SSE 用 ?token= 查询参数（EventSource 无法带自定义头） | 纯浏览器 EventSource 限制 | cookie（易受同源策略与用户内容端口干扰）
- 2026-09-21 | 主题/密度在服务端 settings 表持久化；前端仅在首次绘制前用 localStorage 缓存主题选择（代码内带 TT-THEME-CACHE 注释，符合 C-29 例外） | 避免首帧闪烁；业务数据一律走 API | 仅服务端持久化（首帧闪烁）
- 2026-09-21 | 日志滚动自实现（10MB 单文件 + 保留 7 个），不引入 pino-roll | 减少一个依赖；逻辑 30 行以内 | pino-roll
- 2026-09-21 | CodeMirror 6 通过 @uiw/react-codemirror 封装使用 | 官方推荐的 React 绑定，底层即 CodeMirror 6，满足 C-28 | 手写 @codemirror/state/view 集成（重复造轮子）
- 2026-09-21 | Tailwind 锁定 v3（postcss 管道），仅用于布局工具类 | v3 生态成熟、与 Vite5 兼容稳定 | Tailwind v4（新 CSS 配置体系，收益有限）
- 2026-09-21 | zod 锁定 v3 线 | API 稳定、生态兼容 | zod v4
- 2026-09-21 | e2e 通过“粘贴路径”入口添加项目 | 系统原生对话框无法自动化 | UI 自动化点击系统对话框（不可行）
- 2026-09-21 | 语言占比的 GitHub 语言色表放 packages/web/src/theme/langColors.ts | 机械检查 M10 只豁免 theme 目录，语义上它也是“数据语义色” | 散落在组件内（违反 C-50）
- 2026-09-21 | 内容索引/分析等长任务用单进程内 async 任务管理器（tasks.ts）实现 | 单用户单进程场景，无需任务队列服务 | 引入 bullmq 等外部依赖（违反 C-26）
- 2026-09-21 | 回收站跨盘场景 = 复制+校验+删源；同盘 = rename | 同盘 rename 原子瞬时 | 直接复制（慢且不原子）
- 2026-09-22 | **D-TOKEN：鉴权 token 持久化到 `<dataDir>/token`（0600），启动时优先复用，删除该文件即轮换** | 原实现每次启动随机生成：dev 下 `tsx watch` 改一次后端代码就重启进程并换 token，导致已打开页面、SSE 与 vite 代理头立刻 401（被测出为"界面加载失败：token 无效"）；持久化后重启不再打断会话，也让书签/架构图 URL 有效 | 每次随机（dev 不可用）；把 token 存进 DB settings（启动早期尚不可用）
- 2026-09-22 | dev 模式 API 基址改为同源（`window.__TTFOLIO_API_BASE__ = ''`，走 vite 代理 `/api`），用户内容仍指向独立端口（`__TTFOLIO_CONTENT_BASE__ = http://localhost:<后端端口+100>`） | 原实现在 5173 页面里把 API 直连 `localhost:7717`（跨源）→ 被 CORS 与 Host 校验双重拦截；用户内容端口 5173+100 推断错误 | 给后端加 CORS 放开（削弱 C-09 的 Host/Origin 防线）；把用户内容也走代理（破坏 C-13 的跨源隔离）
- 2026-09-22 | vite 代理 `changeOrigin: true` | 原为 false，会把 `Host: localhost:5173` 透传给服务端，被 Host 白名单拒绝（403 非法 Host 头） | 服务端放宽 Host 白名单（削弱防 DNS rebinding）
- 2026-09-22 | 工作台拆成两屏：`subTab=null` 为总览看板（Dashboard），`view:*`/`col:*` 为卡片墙；overview 的 `subTab` 纳入标签标识（`tabKey`），项目页不纳入 | 原先一个屏既当看板又当卡片墙，点侧栏「最近打开」会复用「工作台总览」标签并停在原屏（表现为"点了没反应"）；拆开后总览回答"哪里需要我"，卡片墙用于筛选浏览 | 单屏加条件渲染（状态耦合、无法并存两个标签）
- 2026-09-22 | 分栏宽度持久化到服务端设置 `ui_layout_json`（非 localStorage） | 遵循 C-29（业务数据一律走 API，仅主题缓存例外）；换浏览器/清缓存后布局仍在 | localStorage（违反 C-29）；不持久化（每次重开都要重拖）
- 2026-09-22 | 面板拖拽统一走 `PaneSplit`（AntD `Splitter` 封装）并规定 `measure='first'\|'last'`：受控 `size` 必须配 `onResize`，容器需有确定宽度，`collapsed` 必须把"持有尺寸的那一侧"归零 | 直接用 Splitter 时会踩四个坑（受控尺寸不更新、内容宽度 0、拖动改错面板、折叠无效），封装后四个页面的拖拽行为一致 | 每个页面各写一遍（重复踩坑）
- 2026-09-22 | `npm run test:e2e` 增加 `pretest:e2e = npm run build` | e2e 服务端静态托管 `packages/web/dist`，单独跑 `test:e2e` 会静默测上一次构建的旧产物——本轮因此误判两轮（同一份用例，旧包全红、新包全绿）；前置构建让"测的必须是当前代码"成为默认行为 | 只写文档提醒（仍会忘）；e2e 改用 vite dev server（与生产静态托管路径不一致，丢失对 dist 的覆盖）
- 2026-09-22 | 会话的"当前活动标签"存进 `sessions.active_tab_id`（迁移 `0002_session_active_tab.sql` 只增列） | FR-1.4 要求恢复"上次标签集合与位置"，而前端 PUT 体里一直带着 activeTabId、服务端却**没有可写的列**（`getSession()` 恒返回 `tabs[0].id`）→ 刷新后活动标签永远落回第一个标签（实测：停在项目页刷新 → 跳到「工作台」）。放在 sessions 表而非 settings，是因为它天然是"每个会话一份"的状态；写库前校验 id 属于本次保存的标签集合，避免存悬空 id | 存进 settings 单键（多会话语义错位）；前端把活动标签编码进标签顺序（会篡改用户排序）
- 2026-09-22 | FR-11.6「打开日志」走 `/api/open {target:'logs'}` 的**独立分支**，路径由服务端 `ctx.layout.logDir` 决定 | 日志目录在应用数据目录下、**不属于任何被登记项目**，硬塞进 `openExternalSchema` 要么得给"非项目路径"开口子（削弱 C-22/C-23 白名单），要么让用户先登记数据目录（荒谬）。独立分支用 `.strict()` 只收字面量开关，客户端无法指定路径；分支必须放在项目白名单分支**之前**（否则会掉进 template 分支要 templateId） | 放宽 `openExternalSchema` 允许无 projectId 的任意绝对路径（安全面扩大）；只显示路径不给按钮（FR-11.6 验收不满足）
- 2026-09-22 | 面包屑里"文件名"按 `targetPath` 的相对路径分段追加，且「工作台 / 项目名」可点 | 原实现只在 `tab.kind === 'file'` 时补文件名，但项目页打开的文件挂在**项目标签**上（`kind:'project'` + `targetPath`）→ 永远不显示当前文件；FR-1.5 同时要求"域 / 项目 / 子路径 可逐级点击"（验收要点就是"点面包屑回到项目根"）。分段展示（而非只显示 basename）是为了同名文件可定位；点项目名会清 `targetPath`（等价于回项目根、关编辑器），点错可用后退还原 | 只补 basename（同名文件分不清）；只为显示不可点（FR-1.5 的 MUST 仍缺）
