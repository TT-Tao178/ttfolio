# 第二十六轮改动规划（评审稿，未实施）

> 三项需求：① 面包屑逐级可点回上级；② 架构图软件内直接查看（文档页风格）；③ 文件树右键菜单
> （复制 / 移动 / 在资源管理器中打开 / 复制相对路径 / 复制绝对路径）。
> 本文仅为规划，**一行代码未动**。批准后按「小步提交法」逐项实施。

---

## 零、总原则（先说不改什么——防"改坏"）

| 不动的东西 | 原因 |
| --- | --- |
| 数据库 schema | 本轮无迁移，user_version 保持 3 |
| PathGuard / 项目白名单 / 7817 只读端口 | 安全红线；复制/移动/打开全部走**既有**受守卫接口，一个新开口子都不开 |
| iframe sandbox 属性 | 架构图查看沿用现有 `allow-scripts allow-same-origin allow-popups allow-forms` |
| 现有顶部按钮（新建/重命名/删除） | 右键菜单只做用户点名的 5 项，不动既有入口 |
| 移动/复制长任务进度条（KNOWN-GAPS #1） | 维持现状（同步执行）；本轮只加入口，不改任务化 |
| 探针纪律 | 复制/移动类探针一律 `page.route` 拦截、断言请求体，**绝不真写盘**；收口跑 `inspect-data.mjs` 零残留 |

发布：版本 0.1.8 → **0.1.9**，出包走 `dist:win` 全链路（自检 7 项全绿），旧包保留。

---

## 一、面包屑逐级可点（现状取证 → 方案）

### 现状取证（本轮实测）

- **功能其实已在**（第 7/19 轮实现）：重跑 `verify-round19.mjs` 通过——点「文件」清 targetPath 关编辑器、点项目名回项目概览、历史栈可退。
- **真实痛点是"看不出能点"**（本轮新探针 `round26-crumb-style.mjs` 实测）：所有可点段渲染为
  灰色 `SPAN`（`rgba(0,0,0,0.45)`）、`cursor:auto`——和无事发生的纯文本一模一样，用户自然"没办法点击"。
- **中间目录段与文件名段确实不可点**（第 19 轮有意保留的纯文本）。

### 方案

1. **视觉可供性**（`PathBar.tsx` buildCrumbs）：可点段（工作台 / 项目名 / 子页签）渲染为主题色
   + `cursor:pointer` + hover 下划线（antd Breadcrumb 的 item.title 用 `<a>` 无 href 或 className 实现）。
   用户主诉"点项目名/文件回上级"由这一条直接解决。
2. **中间目录段可点**（分叉点 1，见文末）：
   - **方案 a（推荐）**：点目录段 = 关编辑器 + 文件树定位（展开到该目录、选中、滚动可见）。
     不改 targetPath 语义，零风险。
   - 方案 b：允许 targetPath 指向目录并在右侧显示"目录概览"——语义大改（历史栈/会话恢复/编辑器分流全要跟着动），不建议本轮做。
3. 文件名段（最后一段）保持纯文本：它就是当前位置，无处可去。

**影响面**：`PathBar.tsx`（视觉）+ `FilesTab.tsx`（树定位，若选方案 a）。后端零改动。
**验证**：探针 verify-round26a——断言可点段样式（pointer/主题色）；点「文件」编辑器关、点项目名到概览、点目录段树节点被选中且高亮。

---

## 二、架构图软件内直接查看（文档页风格）

### 现状取证（本轮读码）

- ArchivesTab 现为「目录卡片 + 图集列表 + Modal 弹窗 iframe」；**图集列表只收 `.html/.htm`**
  （`computeArchiveMeta`，analyzer/index.ts:355）。
- 你挂载的架构图目录里若是 **PNG/SVG 等图片文件 → 列表为空、连入口都没有**，界面只剩几张"文件信息卡"——
  这正是"只是显示一些文件"的根因。
- `archUrl()` 走 7817 内容端口 + token query，`<img>` 标签同样可用，**图片直读不需要任何后端改动**。

### 方案（对齐 DocsTab 的左列表右预览布局）

1. **server（只增字段）**：`computeArchiveMeta` 增加图片收集（png/jpg/jpeg/gif/webp/svg/bmp，
   复用 `ArchiveEntryFile` 结构）；`ArchiveMeta`/`ArchiveInfo` 新增 `imageFiles` 字段；`archives.ts`
   路由把 `meta.imageFiles` 传入 `toArchiveInfo`。`htmlFiles` 原样保留（零兼容风险）。
2. **web（ArchivesTab 重构为常驻分栏）**：
   - 左：文件列表（HTML 与图片合并，按修改时间倒序，类型 Tag 区分；保留"入口识别"标记）；
   - 右：查看区——HTML → iframe（sandbox 不动）；图片 → `<img src={archUrl(...)}>` 居中自适应缩放；
   - 顶部：刷新 / 新窗口打开 / 复制路径；
   - 保留：登记目录弹窗、changed 更新提示、"改为图集列表"入口；
   - 进入页签默认自动打开第一项（分叉点 3，见文末）。
3. 弹窗查看模式移除（被常驻分栏取代），"新窗口打开"保留。

**影响面**：`analyzer/index.ts`（只增）、`shared/types.ts`（只增）、`archives.ts` 路由（传参）、
`ArchivesTab.tsx`（重构）。**不碰** 7817 静态服务与 iframe 策略。
**验证**：探针 verify-round26b——route 合成含 `imageFiles` 的 ArchiveInfo：左列表出现图片项、
点击后右侧 `<img>` 的 src 指向 `/arch/...`、HTML 项仍走 iframe；另用你挂载的真实架构图目录只读目测。

---

## 三、文件树右键菜单（5 项）

### 现状取证（本轮读码——三个接口全部已存在，后端几乎零改动）

| 菜单项 | 后端现状 | 缺什么 |
| --- | --- | --- |
| 复制 | `fs/move` 的 `mode:'copy'` **已支持**（含目录递归、冲突 skip/ask） | 前端入口 + 目标选择弹窗 |
| 移动 | `fs/move` 的 `mode:'move'` 已支持（目录入子目录校验也有） | 同上 |
| 在资源管理器中打开 | `/api/open` 的 schema **已有可选 `path`**；`openExplorer` 用 `explorer /select,路径`（文件=定位选中，目录=打开） | 前端从未传过 `path`——只在前端补参数 |
| 复制相对路径 | — | 纯前端 clipboard（节点 relPath） |
| 复制绝对路径 | — | 纯前端（项目 dirPath 从 react-query 缓存里已有 ProjectDetail 拿，不新增请求） |

### 方案

1. `toAntdTree` 的节点 title 包 `Dropdown trigger={['contextMenu']}`（antd 官方路径，即 KNOWN-GAPS #2 的既定补法）；目录与文件菜单同款（5 项对目录同样成立）。
2. 新组件 `MoveCopyModal`：选目标目录（粘贴路径 + pick-folder 系统对话框，复用 RelocateModal 交互模式），模式 move/copy 复用一个弹窗；成功后刷新树并提示。
3. 冲突策略固定 `onConflict:'ask'` 的前端预检：目标已存在时后端报错 → 弹窗里给「覆盖 / 跳过」选择（对应 skip；覆盖=overwrite——**查后端**：move 路由 onConflict 只实现 skip/ask，overwrite 未实现，本轮前端只提供「跳过/取消」，覆盖留后续，菜单文案写清楚）。
4. 菜单就不加用户没点名的东西（重命名/删除仍在顶部按钮，后续要加随时能加）。

**影响面**：`FilesTab.tsx` + 新 `MoveCopyModal.tsx`。**后端零改动**。
**风险与纪律**：移动/复制是真实写盘操作——探针必须 route 拦截 `POST /api/fs/move` 断言请求体（mode/items/targetDir 正确），绝不真发；真实复制/移动由你手测。大目录同步执行的已知缺口维持（进度条不在本轮）。
**验证**：探针 verify-round26c——右键树节点菜单 5 项齐全；点「复制到…」填目标 → 拦截到的请求体 `{mode:'copy',items:[rel],targetDir}` 正确；「在资源管理器中打开」拦截 `/api/open` 请求体含 `path`；两个复制路径项断言剪贴板内容。

---

## 四、实施与提交拆分（小步提交法，约 10 个提交）

| # | 提交 | 内容 |
| --- | --- | --- |
| 1 | fix(web) | 面包屑可点段视觉可供性（主题色/pointer/hover） |
| 2 | feat(web) | 面包屑目录段点击 → 树定位（分叉点 1 选 a 时） |
| 3 | feat(server,shared) | 架构图扫描收集图片文件（imageFiles，只增字段） |
| 4 | feat(web) | ArchivesTab 常驻分栏查看（图片 img + HTML iframe） |
| 5 | feat(web) | MoveCopyModal 移动/复制目标选择弹窗 |
| 6 | feat(web) | 文件树右键菜单 5 项接线 |
| 7-8 | test/chore | 探针入档（.tmp-test 不进库，此为本地验证）+ 版本 0.1.9 |
| 9-10 | docs | PROGRESS/HANDOVER 收口 + push |

每步中间树跑 typecheck；三项各自完成后跑全量门禁；最后 dist:win 出包 + inspect-data 零残留。

---

## 五、分叉点（请拍板，默认按推荐执行）

| # | 问题 | 选项 |
| --- | --- | --- |
| 1 | 面包屑点**目录段**的行为 | **a. 关编辑器+树定位到该目录（推荐，零风险）** / b. 目录也可作为右侧内容（大改，后续） |
| 2 | 「复制」的语义 | **a. 复制到指定目录（弹窗选目标，与"移动"对称，推荐）** / b. 同目录一键副本"xxx - 副本.ext" |
| 3 | 进入架构图页签是否自动打开第一个文件 | **a. 自动打开（推荐，"直接查看"）** / b. 空态等用户点 |
| 4 | 右键菜单范围 | **a. 仅文件树（推荐）** / b. 文件名搜索结果列表也顺带同款 |
