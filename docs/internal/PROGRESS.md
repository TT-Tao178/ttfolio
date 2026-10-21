# PROGRESS

## 第 55 轮：v0.4.0 出包（T-109 + T-105 + T-106 批次随版本发布）

- **版本收口（f518f01）**：0.4.0 三处同轮（package.json / server 版本常量 /
  CHANGELOG）；CHANGELOG 列用户可感知五项（活动中心/未完成清单/Office
  预览/文件对比/架构图变更明细）。用户点名批次版本 0.4.0（非 0.3.13）。
- **出包**：`dist:win` 全链路一次通过（无 audit ECONNRESET、无 EBUSY），
  自检 8 项全绿含 0.4.0 断言；产物 dist-electron/ttFolio-Setup-0.4.0.exe
  （约 150MB）+ blockmap。rebuild better-sqlite3 翻回 Node ABI、门禁复跑
  三绿（205 条）。tag v0.4.0；Release 页资产由用户手动拖传（对照清单已补
  行）。**Release 页创建**：uploads/api 域限制下由脚本或用户手动——本轮经
  API 创建 v0.4.0 Release 页（正文取自 CHANGELOG），资产待拖。
- **手测提醒（随 0.4.0）**：活动中心三页签与收藏、总览未完成清单卡、
  docx/xlsx 打开预览、两文件并排对比、回收站「对比」、架构图变更增减
  清单，以及从 0.3.x 升级安装（迁移 0007 会自动执行）。
- **Release 页**：经 api.github.com 创建（系统 curl.exe 走 Schannel 证书
  ——Node fetch 在本机网络下报 UNABLE_TO_VERIFY_LEAF_SIGNATURE，历史教训
  再应验；token 取自凭据管理器 git credential fill）：
  https://github.com/TT-Tao178/ttfolio/releases/tag/v0.4.0 ，资产由用户
  浏览器手动拖传。
- **tag 时序坑（取证）**：建 Release 时远程尚无 v0.4.0，GitHub 自动在
  当时的远程 main HEAD（ac02e09）上创建了 tag——晚于此的 push 被拒
  （already exists）。已 `push --force` 把远程 tag 重定位到版本提交
  f518f01 并 ls-remote 复核一致。后续先 push tag 再建 Release 页可免此坑。

## 第 54 轮：T-106 统一预览分发器 + 文件对比查看器 + 架构图变更明细（未出包）

> 批内第三条（本批 = T-109 + T-105 + T-106，批后统一出 0.4.0）。

- **规格先收编**：设计文档 4.13 节新增 FR-13.9（三小节 + csv 保留编辑的
  边界修正 + Git 变更列表保持 diff 语义的边界），附新增注记。
- **摸底结论（实现前的取证）**：OfficePreview + GET /api/docs/raw 本就接受
  项目内路径（不带 mountId 走 resolveInProject）——预览缺口只是 FilesTab
  右栏「图片/编辑器」二分没接它；DiffView 为 unified 单栏且服务端 diff 不
  支持任意双文件 → 对比器走纯前端行对齐；回收站无内容读取通道；archives
  变更检测是拉取式标量对比、无清单快照。
- **分发器 + 对比（13e2b7b）**：resolveViewer 纯函数（office=docx/pdf/
  xlsx/xls；csv 刻意保留编辑器防编辑能力回归）→ FilesTab 右栏 Office 白
  名单直连 OfficePreview，文件树/搜索/命令面板/最近查看全部生效；新
  TabKind compare（tabKey 含规格串天然去重、随会话恢复）+ compareShared
  纯函数（规格编解码坏值兜底；公共前后缀裁剪后 LCS 对齐，Uint32Array 上限
  1500²、超限诚实降级平行排列；相邻删/插段配对成修改行）+ CompareView 单
  滚动容器四列网格（行号×两侧天然同步，复用 tt-diff-* 配色 + 新增
  tt-diff-chg，渲染上限 4000 行如实提示）；入口=文件树右键「与其他文件
  对比…」（项目下拉+相对路径）与回收站条目「对比」（原路径前缀匹配登记
  项目）；服务端 TrashService.readEntryFile（严格 isInsideOrEqual 防穿越
  ——lint C-02 拦了 startsWith 首版，改用 pathGuard 助手、文本 ≤5MB、
  嗅探二进制拒绝、孤儿 rel_path 防护同源）+ GET /api/trash/:id/file。
- **架构图变更明细（a6a9c04）**：迁移 0007 archive_view_snapshots（外键
  级联、只增不改，user_version=7）；viewed 端点落 HTML 清单快照；GET
  archives 每项附 viewSnapshot（可选字段，toArchiveInfo 其他调用点零改
  动）；ArchivesTab 变更 Alert 升级「新增 N/移除 M + 对照时间」（每侧前 8
  条，无快照说明本次打开后开始记录）；快照只存索引库，红线 2 不变。
- **验证**：门禁三绿（205 条，本轮新增 14：viewerDispatch 4 +
  compareShared 9 + viewDiff 4 + 集成 3，另 actor.test 适配）；npm run
  build 通过。手测点：文件树打开 docx/xlsx 预览、两文件并排对比与跨项目
  对比、回收站「对比」、架构图变更增减清单。
- **过程小坑**：① recent_files/archive_view_snapshots 都有外键——集成
  测试造数必须先插真实项目/图集行（FK 失败两次）；② LCS 把「旧行→新行」
  判成删+插，配对后处理（pairRuns）才是并排视图的预期语义；③ CompareView
  行号计数初版写进 map 回调作用域恒为 0，提出到外层计数。

## 第 53 轮：T-105 审计与活动中心（活动记录/时间线/最近查看，未出包）

> 批内第二条（第 52 轮 T-109 之后），版本仍 0.3.12，本批批后统一出 0.4.0
> （用户指定批次版本，非 0.3.13）。

- **规格先收编**：设计文档 4.13 节新增 FR-13.8（活动中心三页签 + 数据源 +
  收藏边界 + schema 零新增），附 T-105 新增注记。
- **核对修正一处方案假设**：任务表原方案写「打开动作已记审计（kind 为
  fs.open 等）」——实查不成立（现有 kind 只有 fs.save/open.external 等，
  无打开类审计点）。改用既有 `recent_files` 表作数据源（文件读取一直在
  落，文档内容读取本轮补 `recordRecentFile`，挂载文档路径不在项目根内
  不记），架构图查看不进最近查看（沿用审计 viewed 语义），schema 零新增。
- **服务端（78f3548）**：listActivity 改 opts 签名（limit/offset/
  projectId/actor/level/kind 前缀/kinds 精确集/since/until——until 传
  YYYY-MM-DD 按当日末尾含端），GET /api/activity 透传且 level 白名单；
  GET /api/recent 支持 limit（≤200）与 projectId；新增 GET/PUT
  /api/recent/pins（settings 键 recent_pins，≤200 条、单条 ≤500 字符、
  坏值回落空数组）；docs content 项目内读取补 recordRecentFile；actor.test
  适配新签名；集成测试补过滤/计数/pins 往返锚点。
- **web（33dd6bd）**：侧栏新增「活动」域（域条 FieldTime 图标，单入口，
  TabKind/Domain 补 activity，App 渲染分支与域跟随映射补齐）；ActivityPage
  三页签共用 useInfiniteQuery：活动记录（项目/级别/类型/时间段筛选 + 加载
  更多 + 导出 CSV——BOM UTF-8、按钮文案如实标注「当前已加载」）、时间线
  （按本地日分组回放，共用筛选与行组件）、最近查看（全库/项目内两作用域 +
  星标收藏置顶 + 打开计数/相对时间）；条目点击按 kind 跳转（git→Git 页签/
  带路径→文件/其余→概览/全局类→回收站与设置页）；activityHelpers 纯函数
  5 条单测；dayjs 声明为 web 显式依赖（antd 传递依赖，RangePicker 直用）。
- **验证**：typecheck/lint/test 全绿（188 条，新增 6）；npm run build 通过。
  手测点：活动页四维筛选与 CSV、时间线分组、最近查看收藏置顶、条目跳转、
  打开文档后最近查看出条目。
- **过程小坑**：① recent_files 外键指向 projects，集成测试造数须插真实
  项目行（FOREIGN KEY 失败一次）；② RecentTab 初版嵌在父组件体内会导致
  每次渲染重挂载丢页签内状态——提为顶层组件。

## 第 52 轮：T-109 规格补全三小项（核对 + FR-9.3 跨项目未完成清单落地，未出包）

> 批前基线：main 与远程同步（ac02e09），0.3.12 已发布、门禁三绿（176 条）。
> 本会话起按 T-109 → T-105 → T-106 → T-107 顺序分批实施规划剩余任务，
> 本批批后统一出包。

- **核对结论（三小项里两项其实已闭合——总表记载滞后于代码）**：① FR-11.4
  快捷键改绑已随 T-100 闭合（设置「快捷键」分区注册表驱动改绑 UI，冲突
  检测/恢复默认/至少一个修饰键）；② 命令模板占位符服务端
  renderTemplateArgs 四值齐备（{path}/{file}/{project}/{paths}），仅设置页
  缺语义说明——本轮补一行文案；③ FR-11.1「批量移除登记」确认未实现
  （现仅单项目右键移除），结论入册，随 T-107 批量操作台闭合。
- **FR-9.3 实现（b5c3944）**：新增 todoDigest 纯函数（按项目分组、组间最早
  截止升序且无截止垫底、组内截止升序、上限截断计 hidden）+ Dashboard 底部
  「未完成清单」汇总卡（仅有未完成条目时出现，沿用「最近提交」底部单卡
  惯例——不复刻第 39 轮因跳转乱被移除的旧三卡混排）：逾期截止标红、勾选
  即完成、点项目名跳该项目概览页签；「需要关注」条增「未完成清单」计数，
  点击平滑滚动到卡。集成测试补 listTodos scope=all 锚点（跨项目聚合 /
  includeDone=0 过滤 / 软删项目剔除）。服务端零功能改动，无迁移、无新依赖。
- **文案（0a99891）**：设置→命令模板说明段补占位符语义。
- **验证**：门禁三绿（typecheck / lint 含 format:check / test 182 条，新增
  todoDigest 5 条 + 集成 1 条）。手测点：总览「未完成清单」卡分组/逾期
  标红/勾选完成/点项目名跳转、「需要关注」条滚动定位。
- **台账**：任务总表 T-109 → 规划·已完成（b5c3944 / 0a99891），FR-9.3/
  FR-10.3 实现栏同步；生成脚本 task-report.mjs 的总进度行由硬编码
  「待做 0」改为实算（FR 引用 ⬜ + PLANNED）。规划剩 10 条
  （T-101/102/104~108/110/111/112；另 T-083 为 FR-12.2 的转规划引用）。

## 第 51 轮：媒体工具条（参考图）——实时尺寸滑条/三布局/统一与原比例/F11 全屏 → v0.3.12

- **功能（af3c819）**：按用户参考图补齐媒体查看工具条。mediaHelpers 增
  parseMediaView（坏值回落、size 钳 96–320）与 layoutGeometry（grid 多列
  方形 / two 两列 4:3 / one 单列满宽高度封顶 480）；MediaTab 工具条重做：
  F11 与按钮全屏（文档级，fullscreenchange 同步文案）、尺寸滑条（onChange
  实时生效，仅网格布局可用）、三布局图标分段、统一/原比例（cover/contain）；
  网格按几何渲染（1fr 填充 vs 固定 px），偏好存 localStorage（同自动滚动
  速度口径，不入索引库）。原 density 三档由连续滑条取代（等效能力）。
- **验证**：typecheck/lint/test 全绿（176 条，新增视图偏好与几何 2 条）；
  npm run build 通过；拖动实时性与视觉按用户要求留待手测。
- **出包（0d9bbea）**：0.3.12 三处同轮；`dist:win` 的 audit/build/server/
  electron-rebuild 通过，electron-builder 再次 EBUSY 锁旧 win-unpacked 的
  app.asar（系统扫描占用，与用户已装应用无关）→ 按预案换 `dist-electron-tmp2`
  构建，`VERIFY_DIST` 自检 8 项全绿含 0.3.12 断言，安装包与 blockmap 移回
  dist-electron；tmp2 的 app.asar 释放较慢，后台循环等待后清理。rebuild
  better-sqlite3 翻回、门禁复跑三绿（176 条）。tag v0.3.12 与 main 推送；
  Release 页资产由用户手动拖传（对照清单补行）。

## 第 50 轮：v0.3.11 出包（T-103 + T-114 + T-113 随版本发布）

- **版本收口（c28905e）**：0.3.11 三处同轮；CHANGELOG 按用户可感知变化写
  （个人主页 / 媒体自动滚动 / 缩略图清晰度与缓存）。
- **出包两坑（均按预案过）**：① `audit:prod` 首次失败——npm 审计端点
  ECONNRESET（网络瞬时抖动），单跑三次均 0 漏洞后重跑链路；②
  electron-builder EBUSY 锁旧 `win-unpacked/resources/app.asar`（用户已装
  的 0.3.1 在 E: 盘、与本次无关，未动它）——按预案换全新输出目录
  `dist-electron-tmp1` 构建，`VERIFY_DIST` 自检 8 项全绿含 0.3.11 断言，
  安装包与 blockmap 移回 dist-electron 后删 tmp（app.asar 被系统扫描短暂
  占用，退避重试后删净）。
- **收口**：rebuild better-sqlite3 翻回 Node ABI、门禁复跑三绿（174 条）；
  安装包 ttFolio-Setup-0.3.11.exe 入 dist-electron（包数 10：0.3.2~0.3.11）；
  tag v0.3.11 与 main 已推送，Release 页资产由用户手动拖传（对照清单补行）。

## 第 49 轮：T-113 缩略图管线 v2（清晰度与缓存，用户点名单条实施，未出包）

> 批前基线：另一会话已在本仓库提交 T-114（3915f75 媒体网格自动滚动）并更新
> 任务总表/设计文档 v2 修订；本轮在其之上实现 T-113，三个提交（服务端 /
> web / Electron），每提交门禁三绿。

- **服务端（a36a15d）**：新 core/thumbs.ts——两级命名
  `<sha1(relPath)>@g.webp`（640）/`@p.webp`（1920）、旧版 .png 白名单兼容、
  原子落盘、webp 魔数、按项目统计、2GB 配额按 mtime LRU、移除级联清理、
  启动收敛；routes/media.ts 增 GET thumb-index、POST /thumb/:tier
  （image/webp 原始字节，tier/魔数/体积校验，每 25 次写查一次配额）、
  GET /api/thumbs/stats；app.ts 注册 image/webp buffer 解析器；
  userContent /thumbs 改 ETag（mtime+size）+ If-None-Match 304 + private
  immutable（前端 URL 带源文件 mtime 作版本，避免旧图钉缓存）；项目移除
  级联删缩略图。项目目录零写入不变。
- **web（a0921ae）**：thumbNameOf 两级 + missingItems 纯函数；thumbGen
  （Electron 原生解码优先 / Web 解码兜底；视频取帧 8s→3s；canvas WebP
  q82/q85 二进制直传）；useThumbQueue v2（索引先行命中即出图、可视区+
  overscan 优先生成、滚动增量补、失败 5 分钟 TTL、p 档按需）；MediaTab
  传 dirPath/可视集合，网格 URL 带 mtime；Lightbox 先出 p 档并可切原图；
  useThumbBackfill 挂 App（analyzed 后补建 ≤200/并发 2、状态栏进度可取消）。
  **自查时序坑**：名称（sha1）异步晚于索引到达时命中项不转 ready——索引
  effect 依赖补 names 后修复（否则已缓存条目会永远转圈）。
- **Electron（2f8c924）**：nativeImage 解码 IPC（绝对路径 + 扩展名白名单 +
  ≤80MB + 最长边 64~4096，g 用 PNG/p 用 JPEG(88) 返回 dataURL，异常 null 由
  渲染层兜底）；preload 暴露 thumbDecode。**写码坑**：heredoc 里的 NUL 转义写法被二次转义成真 NUL 字节落盘（Read/静态扫描均判为 binary），改用 Unicode 转义字面量后恢复文本。
- **验收锚点**：thumbs.test 5 条（命名/魔数/落盘索引级联/统计/配额 LRU）、
  media.test 3 条（索引-两级上传-项目目录零写入/非法输入 400/404）、
  mediaHelpers.test 增缺口计划 2 条；门禁 174 条全绿、构建通过。缓存命中
  时延与原生解码清晰度需安装版手测（Web 模式无原生桥）。

## 第 48 轮：T-103 个人主页（本地单人身份卡，用户点名单条实施，未出包）

> 用户手测 0.3.10 前点名实现 T-103。设计文档先收编 FR-13.7（4.13 节），
> 两个提交（服务端数据层 / 前端收口），每提交门禁三绿。

- **服务端（82eb4b2）**：设置两键 profile_name/profile_avatar_path；actor
  默认名机制（setDefaultActorName，currentActor 未进入 agent 上下文时返回
  用户名，启动载入、保存同步——agent 的 x-ttfolio-actor 仍优先）；新
  routes/profile.ts：GET 资料与统计（登记项目数/使用天数/版本）、PATCH
  用户名（trim、30 字、空串清空并回落 local）、头像 PNG dataURL 白名单
  （约 1MB）写数据目录 avatar.png、DELETE 清除；usedDays 自最早审计记录
  起算（无记录按第 1 天，如实口径，不编造安装时间）；userContent 新增只读
  /avatar（query token，no-store）。
- **前端（31f964d）**：侧栏底部账户条（24px 头像+用户名、hover 高亮、点击
  开弹窗、窄于 150px 退化为纯头像圆、首字母主色兜底）；个人主页弹窗（点
  头像选本地图片→canvas 居中裁切缩放 256×256 PNG→上传、用户名输入带计数、
  统计、移除头像、保存后刷新）；Sidebar 改 flex 列布局让菜单区内部滚动、
  账户条常驻；api.avatarUrl。
- **验收锚点**：profile.test.ts 5 条（资料往返、30 字限制、头像校验与落盘、
  actor 同步与 agent 优先、usedDays 口径）；真实浏览器视觉与上传交互留待
  用户手测。

## 第 47 轮：第二批规划任务 T-098~T-100（体验与效率，用户点名分批实施 → v0.3.10）

> 第二批无批内强依赖，按 T-098 → T-099 → T-100 顺序实施；6 个功能提交 +
> 1 个探针修复，每提交门禁三绿。批次末用隔离环境真实 HTTP 探针（23 项）
> 验证迁移升级与新增接口，抓出 2 个契约 bug 并修复。

- **T-098 代码配色三方案（4eec530 / 77812c5）**：设置键 syntax_scheme
  （classic 默认/warm/neon；服务端 GET 投影与 PATCH 白名单统一 isSyntaxScheme
  归一，非法值不落库）；cmHighlight(dark, scheme) 三方案 × 深浅 6 组色板、
  七类 token；classic 深色沿用原观感、neon 浅色自动降饱和；入口两处
  （PathBar 下拉 + 设置外观卡分段与实时预览）；**顺带补上文档代码块高亮**
  ——MarkdownPreview 的 pre 改为只读 CodeMirror（语言 id→扩展名映射），
  编辑器/文档/动态视图/设置预览四处同源。
- **T-099 多媒体库（9d2bb1f / fa6d6c0 / b742335）**：迁移 0006（media_files，
  尺寸时长预留列）；分析器单遍扫描顺带收集（mtime 在 stat 时捕获），事务
  全量重写幂等、文件消失即移除；mediaKindOf 收敛到 shared（前后端同源）；
  userContent /raw 补 HTTP Range（206/Content-Range/Accept-Ranges/416，
  解析抽纯函数）+ 音视频 MIME + 新增 /thumbs；缩略图管线按批准方案走
  **渲染层 canvas 统一生成**（图片解码/视频取中点帧→POST→服务端校验后写
  数据目录 thumbs/，sha1 命名天然无穿越，绝不写项目目录）；MediaTab 分组
  虚拟网格（react-virtual 首次启用）/三档密度/类型筛选、Lightbox（缩放
  平移/翻页/键盘/3s 幻灯片/全屏/音频连播/视频 Range 播放）、文件树媒体
  点击经 store.mediaFocus 直达灯箱。**规划核减**：未引入 nativeImage
  （视频帧根本解不了、且违反数据目录单写者）。
- **T-100 命令中心（fca7bc2 / ed4c4dd）**：注册表单一来源（21 条内置命令、
  11 条可改绑、模板入表、插件贡献点预留）；纯函数模糊匹配/MRU/chord 解析
  与捕获；面板双模式（> 前缀与 Ctrl+Shift+P；分类分组、MRU 置顶、参数化
  命令内联项目多选）；App 全局快捷键改查表、`?` 帮助由注册表生成；
  **FR-11.4 随之闭合**：设置新增「快捷键」分区，逐条改绑（捕获下一个组合、
  必须有修饰键、冲突检测、恢复默认）；Ctrl+K 在面板内仍可关闭面板；
  EditorPane 保存按绑定匹配 + 响应命令广播（仅编辑态且有改动时落盘）。
- **探针（b742335）**：隔离数据目录起真实服务，先手工造 user_version=4 的
  老库再启动，验证 0005/0006 升级、媒体分类、Range 206、缩略图落盘（项目
  目录零改动）、agent manifest/会话/actor 审计、watcher 沉淀、syntax_scheme
  往返与非法兜底、无 token 401——23/23 PASS。**探针抓出并修复**：①缩略图
  端点返回 "projectId/name" 与前端 thumbUrl 二次拼前缀冲突；②/thumbs 的
  projectId 白名单只允许小写 hex，而项目 id 是 ULID（大写）→ 恒 404。
  **探针坑**：Windows 下 shell:true 启动的 tsx 是孙进程，child.kill() 杀不掉，
  残留实例占端口导致第二次探针读到旧服务（表现为"数据全没了"假象）——改
  taskkill /T /F 杀进程树，本轮已实测端口释放。
- **收口**：任务总表生成器把 T-098/099/100 移入 PLANNED_DONE 并重生成
  （规划已完成 6 / 待做 10）；KNOWN-GAPS 仍为三项（无新打折项）。
- **出包**：版本收口 0.3.10 三处同轮（af469c9）；**首次 dist:win 失败在
  electron-rebuild（EPERM unlink better_sqlite3.node）——取证为前几轮探针
  残留的 tsx 服务进程仍持有 .node（不是用户 dev），进程树杀净后一次通过**，
  自检 8 项全绿含 0.3.10 断言；rebuild 翻回 Node ABI、门禁复跑三绿（159 条）；
  安装包 ttFolio-Setup-0.3.10.exe 入 dist-electron（包数 9：0.3.2~0.3.10）；
  tag v0.3.10 与 main 已推送，Release 页资产由用户手动拖传（对照清单补行）。

## 第 46 轮：第一批规划任务 T-095~T-097（Agent 协作三部曲，用户点名分批实施 → v0.3.9）

> 2026-10-21 用户点名「实现 T-095~T-100，分两批：每批测试后打包」。第一批
> T-095/T-096/T-097——批内依赖链 96 用 95 的 actor、97 用 96 的记录管道；
> 设计文档先落 FR-13.1~13.6 收编（4.13 节 + 3.3 页签/快捷键 + 6.2 接口表 +
> 7.2 目录）。批内 9 个提交，每提交门禁三绿。

- **T-095 Agent 发现与受控接口（cd62733 / 20d7f93 / 41cdc32）**：core/actor.ts
  换 FR-12.4 预留点——AsyncLocalStorage + x-ttfolio-actor 头（1~64 字符、
  拒冒充 local，不合法 400 而非静默回落，防审计伪装），logActivity 默认取
  当前链身份 → 全部既有审计点零改动自动带 agent 身份；runtime.json 加 agent
  发现段；新 routes/agent.ts——GET /api/agent/manifest（清单含标签/集合名+
  能力端点表，只列真实端点）+ GET /api/agent/projects/:id/context（复用从
  contract.ts 抽出的 buildContextPacket，头部注入管理声明）；设置→关于新增
  「Agent 接入」区块（curl 示例，路径 D:\demo 占位）。测试 12 条
  （buildApp+inject 走临时数据目录）。
- **T-096 动态页签（a50af14 / 6c9b111）**：**规划核减一处**——「与基线
  diff」服务端已天然支持（0.3.5 引入的 diff ref 参数即 `git diff <ref> --
  path`），不重复建设，补 integration 测试把管道钉死；web 侧 sse.ts 加
  组件级事件总线 subscribeSseEvents（单订阅方异常不拖垮分发）+
  liveStream.ts 纯函数 reducer（路径归一/500 条窗口/kind 归一）+
  AgentLiveTab 双栏（变更文件流 + 只读 CodeMirror/ImagePreview，二进制与
  删除诚实降级），记录=以 HEAD 为基线切 diff（复用 DiffView），查看中文件
  再变更 500ms 防抖刷新；页签/快捷键 6/面包屑接入。
- **T-097 资源仓库（d2a15e1 / 21b04e9 / 0a4d46f）**：迁移 0005
  （agent_sessions/agent_session_files/projects.agent_repo_enabled，只增不
  改）；agentSessionRepo（聚合 upsert：首见/末见/次数；stop 幂等；空串清
  空）；WatcherManager 增 onFlush 可选注入钩子（try/catch 隔离，沉淀层异常
  不影响 SSE 主链路），index.ts 接批量聚合；routes/agent.ts 五个会话端点
  （start/stop/patch/agent POST summary/files，生命周期全落 L1 审计）+ 项目
  PATCH 白名单加 agentRepoEnabled；RepoTab 三段式（记录控制/项目速览/时间线
  +懒加载文件清单+编辑弹窗），概览项目属性加开关（关闭页签消失数据保留）。
- **收口**：任务总表生成器改造——FR-13 域不进 FR 驱动序列（避免与 EXTRA
  T-089~094 编号冲突），新增 PLANNED_DONE 组并重生成（规划 3✅/13⬜，门禁
  计数刷 136，在册缺口刷 3 项）；KNOWN-GAPS 核对无新打折项（T-099 缩略图
  管线拟改渲染层 canvas 统一生成，属第二批决策届时记录）。
- **出包**：版本收口 0.3.9 三处同轮（24fa22b）；dev/tsx/electron 进程检查
  干净后 dist:win 全链路**一次通过**，自检 8 项全绿含 0.3.9 断言；rebuild
  翻回 Node ABI、门禁复跑三绿（136 条）；安装包 ttFolio-Setup-0.3.9.exe 入
  dist-electron（包数 8：0.3.2~0.3.9）；tag v0.3.9 与 main 已推送，Release
  页资产由用户手动拖传（对照清单补行）。

## 第 45 轮：0.3.8 发布——KNOWN-GAPS #4/#9 补全（滚动持久化 + 集合排序，用户点名）

- **T-003 滚动持久化（5abc577 + 71bb511）**：store setActiveTabScroll 写回活动
  标签 scroll（既有 1s 会话防抖自动落库）；syncFromServer 解析 scrollJson 回放；
  新增 useTabScroll hook（滚动 300ms 防抖写回、key 变化回放），接线 Workbench
  （总览/卡片墙）与 ProjectPage 概览页签。**复测揪出补偿失效**：回放时内容未
  撑高 scrollTop 被钳 0，钳位滚动事件经防抖把期望位置降级成 0、补偿回放失效
  ——onScroll 加钳位噪声过滤（内容高度不足以到达期望位置时忽略），补偿回放
  400ms/1000ms 两次拉回（71bb511）。实测：滚 400 → 刷新恢复 400 ✓。
- **T-013 集合排序（666c8c9）**：collectionReorderSchema + POST
  /api/collections/reorder（按 id 顺序单事务全量重排 sort_order，含存在性
  校验）；侧栏集合右键菜单「上移/下移」（首末禁用），交换后全量重排；
  实测 UI 右键下移 B>A>C → B>C>A 侧栏渲染跟随 ✓。
- **收口**：KNOWN-GAPS #4/#9 闭合标注（在册仅剩 #1/#5/#6）；任务总表生成器
  PARTIAL 映射同步修剪并重生成（✅78 🔶3 ⛔7，有效进度 81/81）。
- **出包两连坑均按预案过**：①electron-rebuild 失败＝验收用的 `&` 后台 tsx
  实例残留锁 .node（run_in_background 任务被 TaskStop 杀得掉、shell `&` 的
  杀不掉——按端口清）；②EBUSY 锁旧 asar——tmp1 预案过、自检 8 项全绿含
  0.3.8 断言；rebuild 翻回、门禁复跑三绿。安装包入 dist-electron（7 包
  0.3.2~0.3.8）；tag v0.3.8、Release 页 latest 已验、对照清单补行。

## 第 44+ 轮：用户需求两项——最近提交悬停动画、编辑器默认只读+编辑模式（01322ab）

- **最近提交悬停动画**：Dashboard 动态流行加 tt-commit-row——hover 背景
  淡入（currentColor 7% 低透明，深浅主题自适应）+ translateX(3px) 轻微
  右移，0.18s 过渡；负 margin 抵消 padding 防布局位移（沿 base.css
  面包屑惯例）。
- **编辑器只读+编辑模式（防误改）**：默认只读（CodeMirror editable=
  false），右上角「编辑」按钮进入可改态（橙色「编辑中」Tag + 保存 +
  取消编辑）；保存走原链路（Ctrl+S/按钮，校验不变），保存后保持编辑
  态由用户主动退出；「取消编辑」有未保存修改时确认，退出回磁盘版本
  （草稿防抖已保留 24h，再进编辑提示恢复）；切文件自动退出编辑态；
  只读态不产生草稿写入。
- **验收**：门禁 105 条三绿；隔离实例 headless——只读键入 DOM/磁盘
  零变化、编辑态键入生效、Ctrl+S 落盘一致。**探针坑再+1：改前端必须
  先重建 dist 再跑探针（打到旧构建假象）；探针在旧构建留下的草稿会被
  新构建载入 effect 恢复——出现「内容污染」假象，判断前先清探针草稿。**

## 第 44 轮：0.3.7 发布——用户反馈两项（弹窗说明澄清、码图放大、右栏开关反馈）

- **用户反馈三处（0686322 + d4d6ca3）**：①添加项目弹窗两入口说明重写
  （①添加单个项目/也支持多行批量；②批量登记=选父目录扫描子文件夹）；
  ②赞助码图放大（240→260 容器、图区 190 宽）并换 antd Image 支持点击
  查看全屏大图（imageRender 白底圆角包裹）——**扫码不再困难**；③右栏
  开关「点击没反应」定位＝非项目标签下右栏强制折叠、开关只改内部状态
  无视觉变化（实测项目页下开/关/Ctrl+B 全正常，属反馈缺失非开关损坏）
  ——非项目标签按钮置灰 + Tooltip「右栏详情在打开项目后可用」，Ctrl+B
  同文案 toast。门禁 105 条。
- **出包**：版本三处收口（948acec），dist:win 链头五步**连续第三版一次
  通过**；自检 8 项全绿含版本断言 0.3.7；rebuild 翻回、门禁复跑三绿。
  安装包入 dist-electron（6 包 0.3.2~0.3.7）；tag v0.3.7、Release 页
  latest 已验；对照清单补行。
- 验收截图留档 .tmp-test/audit/ui/（sponsor-big.png=全屏码图、detail-
  disabled.png=置灰态）。

## 第 43 轮：0.3.6 发布——体检修复版出包（20 条缺陷随版本）

- **出包**：版本三处收口（5a5e97c）后 dist:win **链头五步一次通过**
  （0.3.5/0.3.6 连续两版未撞 EBUSY），自检 8 项全绿含版本断言 0.3.6；
  rebuild 翻回 Node ABI、门禁复跑三绿（105 条）。安装包 ttFolio-Setup-
  0.3.6.exe 入 dist-electron（现 5 包 0.3.2~0.3.6）；tag v0.3.6 打在
  版本收口提交并推送；Release 页经 API 创建、latest 验证；对照清单
  已补 v0.3.6 行。
- 内容=第 42++ 轮体检 20 条修复（1 P0 数据安全 + 2 P0 已复核 + 5 P1 +
  13 P2），CHANGELOG 0.3.6 已按对外口径整理（中性表述，未提内部审查
  与网络环境）。
- 待用户：①v0.3.6 资产手动拖；②装 0.3.6 手测（本机 0.3.1 可直接覆盖
  升级）；③社交预览图网页上传仍挂账。

## 第 42++ 轮：体检 20 条缺陷全修——P0/P1/P2 六提交 + 全量复测 48/48 与 10/10

- **用户拍板「都进行修复吧」**，按五批小步提交全部落地（共 6 提交，门禁
  104→105 条）：
  - **批1 P0（19425d0）**：/api/restore 恢复前 close 库、成功重开+integrity
    Check、失败 .before-restore 回滚；basename 防备份文件名逃逸（P2 守卫
    缺口同文件顺手闭合）。EditorPane 保存成功清 ['draft'] 缓存 + hasDraft
    改与 valueRef 比对（草稿打回链路双保险）。
  - **批2 P1 server（ca923ca）**：回收站空 rel_path 孤儿行三处防护（purge
    只删行/restore 报损坏/预览返回空）、EXDEV 失败清行+清半成品；preview
    改走 getTrashRow（恒 null 占位删除，concat 死语句顺修）；六处目录遍历
    跳过目录符号链接（junction 环→同步挂死的根断）；登记/复活/重定位/
    改名后 rewatchProject，忽略规则增删改与监听开关/参数变化 rewatchAll
    （helpers 新增），watcher 计时器存共享 record（unwatch 真正生效）；
    watch_stability_ms/trash_retention_days NaN 兜底。
  - **批3 P1 web（ba05bce）**：GitTab 切分支改真 useRef，GIT_DIRTY 确认后
    重试不再发空分支名（半截重构死代码删除）。
  - **批4 P2 server（18b946e）**：move 自身子目录判断改 isInsideOrEqual
    （裸前缀误拦兄弟目录）；git ref/hash/branch/author 路由层拒绝 - 开头
    （选项注入；charCodeAt 比较，同避 lint C-02 禁用 startsWith——**两次
    被 lint 拦下**，规则防线有效）；doc-roots bind 校验在文档根之内；
    relocate 改走 validateRegistrableRoot 与登记同规；looksBinary 补控制
    字符启发式（高字节不计入防误伤 GBK 中文）。
  - **批5 P2 web（3bad082）**：serializeSession 截断 index 平移（+回归
    锚点，105 条）；空会话持久化（关最后标签刷新不再复活）；fs.changed
    失效 ['file']（外部修改警告恢复工作）；setPalette 支持 scope，「在
    当前项目内搜索」贯通；提交成功才清空信息；别名弹窗 destroyOnClose
    +onError；面板命中传项目名不改标签名；五组件拆按字段订阅（键入
    不再全树重渲染）。
- **全量复测**：隔离实例 API 探针 **48/48**、UI 巡检 **10/10** 零控制台
  错误——修复零回归。复测揪出**探针自身两坑**（已修）：①proj-a 建在
  ttfolio 工作区内，git rev-parse 向上探测到外层仓导致跳过 init（identity
  变成用户全局配置、stage 报 .gitignore 拒绝）——init 判定改显式查 .git；
  ②dirty.txt 在初始提交前写入导致永远是干净 tracked 文件——移到 commit
  后写入。
- 遗留入册：latin-1 等非 UTF-8 非 GBK 文件的「有损回写」残余风险（looks
  Binary 只拦控制字符密集型；完整修法需读时记录 lossy 标志并禁回写，涉及
  接口与前端联动，留后续轮评估）。

## 第 42+ 轮：全面体检——diff 必 500 修复、API 探针 48/48、UI 巡检 10/10（体检轮）

- **用户点名全面体检**（链路 + 功能找缺陷）。三路并行：①静态审查（server 侧与
  web 侧两个子代理）②动态 API 全链路探针（隔离实例）③UI headless 巡检。
- **P1 缺陷修复（7d6f9ea）**：Git 单文件 diff 接口 100% 失败——`core/git.ts`
  numstat 调用把 `diff` 子命令切掉（三元两分支相同且均 slice(1)），`git
  --numstat` 必炸 unknown option；Git 页任意文件差异视图打不开。**自初版
  后端（2026-09-21）即存在**，集成测试未覆盖 diff 通路 + e2e 冻结故长期未
  暴露。修复=传完整参数组；补集成锚点（已暂存/未暂存两分支），102→103 条。
- **动态探针 48/48 全绿**（.tmp-test/audit/api-probe.mjs，隔离实例 7799）：
  鉴权（无/坏 token 401、坏 JSON 400）/项目（登记去重、rev 乐观锁 409）/
  集合（跨集合共存、replace、单删）/文件（版本三元组 baseMtime+baseSize+
  baseHash、过期写 409 且磁盘零改写、路径穿越 ../绝对/UNC 全拒、并发保存
  一 200 一 409）/Git（状态/历史/stage/commit 只含暂存内容）/文档（发现/
  content/raw 白名单与穿越拒绝）/搜索（建索引后中文命中）/导出/设置（凭据
  不回显）/会话（active_tab_id 往返）/稳定性（并发 20、2MB 保存、异常分页）。
- **UI 巡检 10/10 全绿、控制台零错误**：卡片墙/总览/集合视图/文件页/编辑器/
  Git 页/命令面板/设置全分区/深色切换；「支持作者」区块新排版等高对齐验收
  通过（ea8c950，用户点名的免责句删除与两图重排）。
- **体检发现三项，用户拍板「去完成」后全部收口（2026-10-17）**：
  ①P2 交互 → **已修（48bd5d8）**：Shell 挂 useEffect 侧栏域跟随活动标签
  （overview/project/file/trash→projects、git→git、archive→archives、
  doc→docs、search→search、settings→settings；file/image 双来源不映射
  保留手选）。headless 实测点齿轮开设置标签后侧栏即显 8 个设置分区。
  ②P2 语义 → **已修（df1a2a0）**：commit 前以 git diff --cached --quiet
  预检，无暂存抛 NO_STAGED（错误码枚举新增）400 语义文案；集成锚点
  103→104 条，隔离实例实测返回 NO_STAGED。
  ③观察 → **闭案（结论修正）**：命令面板 CommandPalette 已有未索引项目
  引导（「{项目名}：建立索引」Tag 点击即建索引）——体检时探针只测了
  API 层未开面板，观察有误，非缺口。
- **静态审查（server/web 两个子代理，各 10 条，P0/P1 三条已亲自复核属实）**：
  **server P0**：恢复备份 /api/restore 在库连接未关闭时覆盖主库文件且恢复后
  不重开连接（Windows 上轻则 malformed 重则丢数据，routes/system.ts:421）。
  **web P0**：EditorPane 保存成功只删服务端草稿与 ['file'] 缓存、不清
  ['draft'] 缓存——继续编辑保存后，载入 effect 用陈旧草稿对比新磁盘内容
  判 hasDraft=true，把编辑器内容打回保存前草稿版本（二次保存即丢增量，
  EditorPane.tsx:101-177）。**P1 三条**：回收站 trash_rel_path='' 孤儿行
  使 purge/restore 作用整个回收站根（core/trash.ts）；目录遍历跟随
  junction 无环检测可同步挂死服务（core/fsx.ts+搜索/measureTree）；
  GitTab 切分支 GIT_DIRTY 确认后用空分支名重试必败（半截重构死代码
  pendingBranchRef）。**P1 两条**：watcher 仅启动时注册（新登记/复活/
  relocate 项目无监听、忽略规则与开关变更不生效）；回收站预览恒空
  （getTrashRowCompat 恒 null 占位）。**P2 若干**：fs/move 前缀匹配误拦
  兄弟目录、git ref/hash 选项注入（--output=）、三端点绕过 PathGuard
  （trash restore targetDir//api/restore file/doc-roots bind）、relocate
  等绕过 validateRegistrableRoot、looksBinary 死逻辑+GBK 有损回写、
  serializeSession 截断历史 index 未平移、关最后标签不持久化空会话、
  SSE fs.changed 不失效 ['file']（外部修改检测失效）、「在当前项目内
  搜索」不传 scope、store 全量订阅键入全树重渲染、commit 失败清空提交
  信息、别名弹窗 defaultValue 残留+无 onError、命令面板开文件改项目标签名。
  处置：清单交用户排优先级，未擅自开工；总体印象=工程素养高，病灶集中在
  半截重构与「登记入口校验未收敛/生命周期事件不回灌长驻资源」两类。
- **体检工程坑（本轮新入档）**：①探针实例与端口——**杀旧起新必查监听端口
  是否真释放**（TaskStop 后 tsx 子进程残留占 7799，新实例静默 +1 落 7800，
  探针全程打到旧代码实例，「修复无效」假象；清法=Get-NetTCPConnection 按
  端口杀）；②Bash tool 内联 node -e 处理含反引号/模板串的代码必被 bash
  吃掉（本轮四连坑），**补丁一律写 .mjs 文件执行**；③会话恢复使 UI 巡检
  首屏不是卡片墙（探针需先点回工作台总览）；④设置域侧栏须手动切（见 ①），
  巡检定位设置菜单先点 DomainRail 的 div[aria-label=设置]。

## 第 42 轮：0.3.5——集合视图「添加项目」入集修复 + 跨集合归属澄清（已出包）

- **用户报障两现象**：①集合视图点「添加项目」，项目只进公共池、集合里没有；
  ②「项目没办法同时在俩集合」。**取证结论：两现象一个根因**——集合视图复用
  全局登记弹窗（AddProjectModal）但不传集合上下文，登记成功还主动切 view:all，
  集合归属从未建立；用户反复用该入口往两个集合加，每次都只进公共池，②是①
  的衍生观感。**API 层（复合主键 (collection_id,project_id)、members 追加语义）
  与「归属集合…」弹窗（diff 保存）经隔离实例端到端实测均正常**——一个项目
  同时归属多个集合本就是支持的能力。
- **修复（f4e445a）**：AddProjectModal 增可选 collectionId（parseSubTab 的
  collection 参数透传）；登记成功即对新增项目发 members 追加入集；弹窗标题
  「添加项目到「集合名」」；登记后留在集合视图（不再切走，invalidate 即见
  新卡片）；加集失败降级提示可用右键「归属集合…」补加不阻断登记。总览屏
  与 view:all 行为零变化。工具栏按钮与空状态按钮同一 state 一并生效。
- **回归锚点**：integration.test.ts 新增集合成员一条（多集合共存/同集合重复
  加入幂等/归属字段齐全），测试 101→**102 条**。
- **隔离实例探针五坑（本轮全踩齐，下次直接绕开）**：
  ①探针实例必须**从仓库根起**（cwd 相对定位 web/dist），从 packages/server 起
  需 TTFOLIO_WEB_DIST 且值必须 Windows 风格路径（MSYS 的 /d/... Node 解析不出）；
  ②**端口被占自动 +1 静默回退**——残留探针进程占 7799，新实例落 7801，探针
  打的全是死配置旧进程；清法=按监听端口 Get-NetTCPConnection 杀 OwningProcess
  （按 CommandLine 匹配 tsx 会误杀 bash 包装层）；③**heredoc/JSON 传参吃反斜杠**——
  Bash tool 的 command 经 JSON 解码 `\\`→`\`，写入 .mjs 后 JS 再丢一层，登记路径
  变废串（toast 报「目录不存在」肉眼可见路径缩水）——**探针里的 Windows 路径
  一律正斜杠**；④antd Modal 打开动画期 Playwright 判 hidden，waitFor visible
  会超时——用 state:'attached'+waitForTimeout(600)；⑤tsx 子进程杀后仍锁
  library.db（已知坑再验），rm 前按监听端口清进程。
- **0.3.5 出包**：版本三处收口（package.json/server 常量/CHANGELOG，动态徽章
  免维护）；门禁三绿后 1966d58 提交、tag v0.3.5。dist:win 链头五步过，
  **electron-builder 再撞杀软 EBUSY 锁旧 asar（第 8 次）**——tmp1 预案过
  （自检 8 项全绿含版本断言 0.3.5），安装包移回；tmp1 目录本体仍被杀软锁
  残留未删净（无锁源进程，稍后手动删）；rebuild 翻回 Node ABI、门禁复跑三绿
  （102 条）。dist-electron 现 4 包（0.3.2~0.3.5）。
- 上传对照清单补 v0.3.5 行、「成因待查」改闭案口径。

## 第 41 轮：0.3.4 发布——KPI 跳转 + 文档预览随版本出包（已推送）

- 版本收口四处（package.json / server 常量 / CHANGELOG / 动态徽章免维护）；
  门禁三绿（101 条）。
- **出包门禁首次真实拦截：xlsx 0.18.5 两个 high（原型污染/ReDoS）且 npm 侧
  无修复版**（SheetJS 已迁自家 CDN）——audit:prod fail-fast 生效。正确修复：
  依赖改 SheetJS 官方 CDN 直链 tarball（0.20.3，API 兼容零改动），audit 三连
  0 漏洞（8e9eef3）。**教训**：npm「No fix available」≠ 无解，官方 CDN/仓库
  直链是标准出路。
- 出包：链头五步过；electron-builder 再撞杀软 EBUSY 锁旧 asar（tmp4 预案
  过，自检 8 项全绿含版本断言 0.3.4）；rebuild 翻回 Node ABI、门禁复跑三绿。
  安装包 ttFolio-Setup-0.3.4.exe 入 dist-electron。
- **⚠️ 重大状态变化（如实入档）**：本轮 mv 完成后发现 dist-electron 仅剩
  0.3.2/0.3.3/0.3.4 三个安装包——0.1.0~0.3.1 共 25 个旧包在 10-15 之后、
  本轮出包之前已消失（保留最近 3 个的清理模式，非本轮操作所致，成因待查；
  旧包无异地副本——GitHub Release 资产一直未拖）。建议：①查回收站/杀软
  隔离区/其他会话的清理脚本；②资产上传策略改为每发一版立即拖（GitHub 作
  异地副本）。上传资产对照清单已按现存 3 包重写。
- github.com push 域加速器抖动（api 域正常）：main 与 v0.3.4 tag 挂后台
  退避重试中；Release 页待 tag 推达后经 API 创建。→ ✅ 10-17 复核：后台
  重试成功，origin/main=b600591、远程 tag v0.3.4（3f1c45c）与 Release
  latest=v0.3.4 三达（均经 api 域复核）。
- **10-17 收尾清账（历史挂账三项闭环）**：①25 个旧安装包消失成因＝用户本人
  手动清理（非杀软/回收站/清理脚本），悬案闭案；②四个规划性脏 tag（v0.1.0-p0 /
  v0.2.0-p1 / v0.3.0-p2 / v1.0.0）本地+远端已删——删前经 API 复核无任何
  Release 页挂载，删后远端恰 29 个正式 tag；③仓库根 HANDOVER-legacy.md
  已删除（第 12 轮给下个会话的自包含提示词，内容已被本文件第 12 轮小节与
  现行 HANDOVER 覆盖，且含本机真实路径不宜入公开仓）。HANDOVER.md 第 3 节
  加「截至第 34 轮」时效横幅、2b 待拍板条闭环。

## 第 40 轮：文档中心 Word/PDF/Excel 只读预览（d41834b，已推，待出包手测）：文档中心 Word/PDF/Excel 只读预览（d41834b，已推，待出包手测）

- 三格式接入：pdfjs-dist（PDF canvas）、docx-preview（Word 版式）、SheetJS
  （xlsx/xls/csv 表格化），与 Markdown 阅读同为纯本地解析。服务端新增
  /api/docs/raw 二进制通道（content 同款路径守卫 + 扩展白名单 + 50MB 上限
  ——字节保真是前提，文本接口的编码检测会破坏 OOXML 容器）；文档发现扫描
  收录预览格式；前端 OfficePreview 三分流，编辑模式对该类格式禁用。
- **顺修两处既有缺陷**：①文档列表 ×3——docsDirs 大小写变体（docs/Docs/
  DOCS）在 Windows 同目录被重复扫描，冗余循环移除；②静态服务 MIME 表缺
  .mjs → 模块 Worker 严格校验类型致 pdf.js worker 静默挂起（app.ts 补
  text/javascript）。
- 拆包：三库动态 import + manualChunks 独立 preview 组（992KB 仅打开预览时
  加载），vendor 首屏回落 441KB；pdf.worker 独立 chunk。
- 新依赖 3 个（pdfjs-dist 6 / docx-preview 0.4 / xlsx 0.18），prod 审计
  0 漏洞维持。端到端实测：发现 3 条去重、raw 字节保真 + 白名单 400、
  PDF canvas 1 页、docx DOM、xlsx 3 行、编辑灰置。

## 仓库门面同步（2026-10-14，81dd1ef 已推；About 经 API——挂账待办清账）

- **About description/topics 经 API 同步完成**（GCM 凭据 PATCH /repos +
  PUT /topics，回读验证过）——「需网页端手动改」的待办正式清账。description
  与 README 口径一致（local project workbench/本地的项目工作台）；topics
  去 local-first 与误导性 code-editor，换 electron/windows/workbench/
  project-management/git/react/typescript/code-browser/sqlite 九个中性词。
- README 双语特性列表补 0.3.2 两主题与 0.3.1 标签过滤；package.json
  description 同步去 local-first（81dd1ef）。
- **社交预览图**（GitHub 无 API，仅网页可传）：已用 ttfolio-video 素材的
  电红主题总览合成标准尺寸成品
  `D:/Workspace-1/code/ttfolio-video/out/social-preview-1280x640.png`
  （1280×640/205KB，OLED 黑底画布融合），待用户网页上传：
  仓库 Settings → General → Social preview → Edit → 上传该文件。
- 发现 ttfolio-video 介绍视频工程（另一会话产物）：16 张素材含五套主题
  截图与标签过滤界面，成片 out/ttfolio-介绍.mp4（54MB 1080p 字幕烧录）+
  SRT + 旁白文稿；README 视频链接可选项未做（等资产上传时一并决定）。

## 第 39 轮：总览 KPI 卡片可点击跳转（173c827，已推，待出包手测）

- 用户点名 KPI 卡片可点。复用「需要关注」条既有 goView 机制与现成视图：
  今天动过→view:recent、有未提交改动/缺设计文档/缺架构图→my-dirty/
  my-nodocs/my-noarch（点击在当前标签内切视图，侧栏联动与既有跳转一致）；
  项目总数→平滑滚动到本屏项目区锚点；平均分析耗时无对应集合保持静态。
- 五张卡 hoverable（antd 自带悬停描边，六主题兼容）；仅改 Dashboard.tsx
  13+/6-。端到端验证：dirty 卡显示 1→点开恰好 1 个项目；noarch→3 个；
  项目总数滚动 0→294px。
- **测试踩坑入档**：gitDirty 口径=已跟踪文件修改，untracked 新文件不算
  （与卡片「有改动」徽标一致）——首版测试数据造 untracked 文件导致
  KPI=0 误判过滤 bug，改「修改已跟踪文件」后通过。

## 第 38 轮：0.3.3 发布——侧栏别名两行显示修复（1576073，已出包）

- **用户报障「加别名后间距不正常」**：0.1.4 起别名项两行展示，第 34 轮改
  flex 后仍被 antd inline Menu 条目固定 40px 高 / 行高 + overflow hidden 裁剪
  ——别名与原名各显示半截、间距忽大忽小、相对时间不可见。隔离实例
  复现确认（长别名「星辰前端工作台 Pro Max」两行全裁）。
- **修复**：别名项 label 加 tt-proj-2line 标记类，base.css 对带标记条目放开
  高度（auto + 行高 1.35 + padding 5px）——单行项与其余菜单条目零变化；
  四域侧栏共用 projectItems 一并修复。前后截图对比存 .tmp-test/alias-fix/。
- **0.3.3 出包**：首次撞「用户 dev 开着 → tsx watch 锁 .node → rebuild 失败」
  （按规范停 dev 后过）；再撞杀软 EBUSY 锁旧 asar（第三次，按预案 tmp3
  打包 + VERIFY_DIST 自检 8 项全绿 + 移回，28 个安装包）。rebuild 翻回
  Node ABI、门禁复跑三绿（101 条）；tag v0.3.3（245b8ea）+ Release 页建好
  latest=v0.3.3 已验；对照清单已补行。
- **注意**：出包时停了用户开着的 dev（.node 锁）——用户需自行
  `npm run dev` 重启。

## 第 37 轮：0.3.2 发布——赛博朋克 + 极简手绘两主题 & 主题图标更换（已出包）

- **赛博朋克**（cyberpunk）：夜城蓝黑底 #0a0a12 + 霓虹青 #00f0ff 主色 + 品红
  #ff2a6d 警示；青色霓虹光晕（按钮/开关/勾选，hover 增强）+ 选中菜单品红内嵌
  条；darkAlgorithm。与电红主题刻意区分色系。
- **极简手绘**（sketch）：米纸白 #faf7f2 + 炭铅笔 #44403a 主色 + 灰调功能色；
  手绘不等圆角（按钮/卡片/弹窗/标签，经典四角不对称技巧）+ 纸面硬阴影
  （2-3px 偏移 box-shadow）；defaultAlgorithm。data-tt-sketch 为浅色覆写段
  （dark=0），与霓虹段（dark=1）对称。
- 主题系统第 34 轮机制直接扩展：ThemeMode/ResolvedTheme 六值、
  applyThemeVars/antdThemeConfig 五分支、data-tt-cyber/tt-sketch 标记位、
  cachedTheme 白名单、标题栏上报（cyberpunk→dark、sketch→light）与 main.cjs
  白名单同步、两处选择器加项、constants 注释更新。SEMANTIC 消费方零改动。
- **主题入口图标**：BgColorsOutlined → SkinOutlined（「换肤」语义 + title）。
- 验证：门禁三绿（101 条）+ 生产构建过；隔离实例实测两主题标记位生效，
  逐张人工过目截图（霓虹光晕/手绘纸感均达预期）。
- 0.3.2 出包：dist:win 固化链路连续第二次一次过，自检 8 项全绿（版本断言
  ✓ 0.3.2）；tag v0.3.2（125cd55）+ Release 页经 API 建好，latest=v0.3.2 已验；
  出包后 rebuild 翻回 Node ABI、门禁复跑三绿（101 条）；安装包入 dist-electron
  共 27 个，资产待手拖（对照清单已补 v0.3.2 行）。
- 手测入口：路径栏皮肤图标或设置页 Segmented 切「赛博朋克/极简手绘」。

## 卸载功能实测（2026-10-14，用户点名；含一次安装器行为事故与完整恢复）

### 结论：NSIS 卸载器功能完整 ✅

以 0.3.1 安装包在 D:\demo\uninstall-test\app 做隔离静默安装（13s/421MB/180 文件），
再对该安装静默卸载，逐项验证全过：安装目录 180 文件全删（顶层空壳目录为 NSIS
常态）、HKCU/HKLM 卸载键删除、两处快捷方式删除、temp 仅余 ns*.tmp NSIS 常规
小残留（已清）、**%APPDATA%\ttFolio 数据目录全程未碰**（deleteAppDataOnUninstall
默认 false，README「卸载不删数据」承诺实测成立）。

### ⚠️ 事故与恢复（如实入档）

- **触发**：隔离安装用了 `/S /D=...`，但安装器检测到本机 HKLM 既有 0.3.0
  perMachine 安装后**跟随其模式提权执行**——先跑旧版卸载器把 E:\TT Software\
  ttfolio 的 0.3.0 完整卸载，再装进 /D 目录，并接管 HKLM 卸载键与
  Public Desktop/ProgramData 两处快捷方式（本机 UAC 静默提权，全程无弹窗）。
  原以为的「per-user 隔离面（HKCU+用户区）」判断失效。
- **恢复**：确认数据目录完好后，先对 D:\demo 隔离安装完成卸载测试本体，再以
  `ttFolio-Setup-0.3.1.exe /S /allusers /D=E:\TT Software\ttfolio` 重装回原
  目录（NSIS /allusers 强制 perMachine；/D 含空格不可加引号）。恢复后校验：
  HKLM 键 0.3.1 指向 E 盘且 UninstallString 与原始形态一致（含 /allusers）、
  两处快捷方式重建指向 E 盘、180 文件 421MB 与卸载器齐、%APPDATA% 完好。
  用户实际获得 0.3.0→0.3.1 原地升级（数据 schema 零迁移）。
- **次生现象**：安装器静默模式默认执行「完成后运行应用」——00:15 自动启动过
  一次 0.3.1（做了每日备份 library-20261014-0015.db 后已退出，当前无进程）。
- **流程教训**：在本机做安装/卸载类测试前，必须先 reg query 全 hive 探测既有
  安装——electron-builder NSIS 会跟随既有安装模式，**有 perMachine 旧版在场
  时不存在真正的隔离面**；要么先临时卸载真实版、要么换 productName 构建测试包。

### 卸载测试checklist结果

| 项 | 结果 |
| --- | --- |
| 静默安装（/S /D=） | ✅ 13s，文件/主程序/卸载器齐 |
| 静默卸载（/S） | ✅ 9s 提权副本执行，文件/键/快捷方式全清 |
| 数据目录保留 | ✅ 全程未碰，备份机制正常 |
| 升级安装（检测旧版→卸旧装新） | ✅ 意外实测（见事故），行为符合预期 |
| temp 残留 | ns*.tmp ×2~3（NSIS 常态，已尽力清） |

## 第三十六轮：0.3.1 发布——例行检查 A 计划七项（已出包，12 提交已推）

> 来源：例行维护报告圈定 A 计划（低风险高收益组），版本号 0.3.1（+0.0.1）。
> 门禁全程三绿（lint 已含 format:check），测试 99 → 101 条。

### A3 出包链路固化（21ab975 + 81aad18）——本轮最大工程收益

- 新建 scripts/dist-win.mjs 包装：NODE_USE_SYSTEM_CA=1 + npmmirror 双镜像
  固化进链路（外部显式设置不覆盖），六步与旧 dist:win 完全一致，失败真实
  退出码终止。**0.3.1 出包首次实跑即一次过——TLS 失败、EBUSY、手动补 env
  三件套全部消失**（对比 0.3.0：两坑连现 + 手动重跑）。
- 收尾修 DEP0190（shell:true 与 args 数组并用）：win 拼串/其余平台数组直传。

### A1 七天静默重分析（5ec518d，KNOWN-GAPS #3 闭合）

- projectsRepo 新增 needsReanalyze 纯函数（超 7 天；null 不触发——大项目
  全量分析必须显式），open 接口命中即 fire-and-forget 后台重分析。
  集成测试 +1（三分支 + 恰 7 天边界 + 非法串）。

### A2 标签过滤视图（bbe7c81，KNOWN-GAPS #8 闭合）

- 服务端 ListFilters.tagId（子查询与 collectionId 同款）+ GET /api/projects
  收 query.tag + GET /api/tags 附带 projectCount（向后兼容只增字段）；
  前端 parseSubTab 加 tag: 前缀（与 col: 同构，测试 +2）、Workbench 零改动
  （filters 透传）、侧栏 projects 域「标签」分组（名称+计数，点击开卡片墙、
  高亮联动）。侧栏右键刻意不加（最小面）。

### A4 拆包 / A5 版本断言 / A7 tailwind / A6 补丁（81d01a0 / d61ef60 / 32976e2 / 6056912）

- 拆包：manualChunks 按 antd 系 / codemirror 系 / react 核心五包（精确路径，
  泛匹配 react 子串会错分 @tanstack 产生 circular chunk——首版即踩即改）/
  vendor 分五块，2326KB → 最大 953KB，告警消失；生产入口真实冒烟零
  pageerror。
- verify 自检 7→8 项：冒烟 health 的 data.version 与根 package.json 比对，
  0.3.1 出包实跑 ✓（0.3.0 常量漏改事故的固化防线）。
- 移除零使用 tailwind（无 config、零工具类），dev 漏洞 27→23；
  npm update 8 包补丁；npm audit fix 此前 29→27。

### 收口与出包

- 版本五处同步 0.3.1（校验脚本过）；KNOWN-GAPS #3/#8 标闭合入库；
  tag v0.3.1（f89a302）+ Release 页经 API 建好，latest=v0.3.1 已验证；
  出包后 rebuild better-sqlite3 翻回 Node ABI、门禁复跑三绿（101 条）。
- 安装包 ttFolio-Setup-0.3.1.exe 入 dist-electron（26 个）；资产待用户手拖
  （对照清单已含该行——需更新）。
- 待用户手测（0.3.1）：侧栏标签过滤联动、打开过期项目触发静默重分析、
  拆包后各页签加载正常、窗口标题栏/主题回归。

## 例行维护（2026-10-13，三提交 603b0dd/bb6fb8f/efdbc2f 已推）

- **修复**：①prettier 四文件漂移回绿（UpdateCheck 行尾 + Workbench/App/system 历史重排）；
  ②磁盘清出 374MB 构建垃圾（dist-electron-tmp1 杀软锁残骸 + win-unpacked.tmp）；
  ③.tmp-test 29M→2.1M：清 105+37 张历史探针截图（含早期真实项目名）与
  REPORT-*/elec-verify/asar-smoke-data/e2e-data 测试数据残留、filter-repo 时期
  msg-*.md 工作稿与历史日志（探针脚本与 filter-repo 前备份 bundle 保留）。
- **门禁升级（用户拍板）**：lint script 串接 format:check——此后 `npm run lint` =
  ESLint 0 警告 + 全仓 prettier，格式漂移不再静默累积。
- **依赖**：npm audit fix 修 2 个 high（dev 链 29→27）；余 27 个全部需要大版本
  升级——**vitest 5（清 tinypool critical 的路径）peer 要求 vite ≥6**，与现有
  vite 5.4.21 构建链冲突，按小步原则不强升，留待「vite 6 + vitest 5 + 插件链」
  独立升级轮；electron 44.7 / eslint 10 / antd 6 / better-sqlite3 13 等大版本
  同理（electron 与 better-sqlite3 跟下一次出包轮）。prod 链持续 0 漏洞。
- **版本一致性校验脚本化**：五处版本号（package.json / index.ts 常量 / 双语
  README 徽章 / CHANGELOG 头条）node 一行比对——本轮实跑全 0.3.0 一致 ✓。
- 复检绿：门禁三绿（99 条，lint 已含格式）、main==origin/main、tag 双侧一致、
  端口无残留、ABI=Node、latest=v0.3.0。

## 第三十五轮追记：Release 页 25 个补齐 + Latest 修正（API 化，资产留用户手传）

- **v0.2.5~v0.3.0 共 10 个 Release 页经 GitHub API 建齐**（正文取自
  RELEASE-NOTES 备忘稿与 CHANGELOG，标题沿用既有「ttFolio x.y.z」风格），
  仓库累计 25 个 Release 全部无资产（用户浏览器手动拖，与既有约定一致）。
- 凭据来源：本机 Git Credential Manager 的 github.com 存储凭据经
  `git credential fill` 取得（GET /user 200 验证），全程环境变量传递、
  零落盘零打印——「后台取 token 会 401 须前台注入」的老结论被推翻：
  **GCM 凭据可直调 api.github.com 写接口**。
- **v0.2.13 补打 tag**（2ceeeed，惯例 lightweight + chore(release) 提交）
  并推远程——v0.2.13 建页的前置。至此 0.1.0~0.3.0 全版本 tag/Release 双齐。
- **Latest 修正**：GitHub latest 按 created_at 排，v0.2.10 因网络瞬断重试
  最后建成而抢走 Latest 徽章；PATCH release `make_latest:"true"` 修至
  v0.3.0（api.github.com 偶发 000 瞬断，重试即过——本轮共遇 3 次）。
- 检查更新数据面闭环：装 0.3.0 点「检查更新」应显示已最新 v0.3.0；
  备忘稿已标注消费完毕。临时请求体 .tmp-test/rels/ 已删净。

## 第三十五轮：README 重制——四张宣传级截图 + 图片裂图取证（f6e966f，已 push）

> 用户报障：GitHub 上 README 图片打不开、中英文显示问题；要求截图入库并造
> 多语言演示数据重拍宣传图。全程隔离实例（TTFOLIO_DATA_DIR=D:/demo/
> ttfolio-shot-data）+ 8 个演示项目，收尾已删净（dev 按端口清、D:\demo 移除）。

### 裂图取证（结论：仓库侧无问题，访问端网络域级阻断）

- 三张旧图 blob 在 origin/main 完好、README 引用为仓库相对路径、本地文件
  PNG 头正常——仓库侧零缺失。
- 实测对照：github.com / api.github.com 可达，raw.githubusercontent.com 与
  camo.githubusercontent.com 连接失败（curl exit 35/000）——**README 图片经
  camo 域代理渲染，加速器分流规则未覆盖 raw/camo 两域即必然裂图**，仓库侧
  无法绕过（GitHub sanitizer 剥 data: URI）。解法在用户侧：分流规则补
  `raw.githubusercontent.com` + `camo.githubusercontent.com`。
- 顺修两处真问题：README.en.md 版本徽章漏更（0.2.13，与 index.ts 常量同款
  「第二处」教训）；Git 页「身份」栏读全局 git config 会露本机身份——演示
  仓库一律 `git config user.name/email`（local 覆盖）。

### 宣传截图流水线（探针留 .tmp-test/probe/：demo-fixture.sh / demo-seed.mjs / shot-readme-v3.mjs）

- **夹具**：D:\demo 下 8 项目 7 语言（aurora-dashboard TS·React、pulse-admin
  Vue·JS、stratus-api Java·Spring、cascade-ml Python·FastAPI、granite-gateway
  Go、forge-cli Rust、quartz-store C、echo-notify TS·Fastify），git 历史日期
  错开（--allow-empty 补时间线）、aurora/forge 留脏工作区。
- **造数**：POST /api/projects {paths} 批量注册 → analyze 轮询 → 3 集合 →
  6 标签 → 2 固定 → 别名/备注（**备注列名是 notes 不是 note，PATCH 错字段
  会被静默忽略**）→ open 后 better-sqlite3 直改隔离库错开 last_opened_at
  （25分钟~20天+从未打开，侧栏相对时间分桶全上镜）。
- **拍摄**：鉴权头是 `x-ttfolio-token`（不是 Bearer）；会话活动标签持久化
  （重开页面恢复到上次项目页，须先点回总览）；电红主题生效断言
  （data-tt-oled=1 且 --tt-layout-bg=#000000）后再拍——第 34 轮主题代码
  实测无 bug（v2 首拍半失效是恢复 light 的收尾 PATCH 时序问题）。
- **成图四张**：浅色总览（KPI/七色语言条/集合/相对时间）+ 电红三连（文件
  编辑树+CodeMirror+备注、Git 状态+历史、命令面板 FTS 内容命中高亮）。
  两份 README 配图注叙事 + 特性列表补「主题」条目；门禁三绿。

## 第三十四轮：四项体验改进 + 电红色发光主题（0.3.0，已出包待用户手测）

> 用户一次性点名四项需求，先对齐计划后按小步提交实施；版本号按用户指定
> 升至 0.3.0（主题里程碑），打破「每出包 +0.0.1」惯例（CHANGELOG 已注记）。

### ① 检查更新删失实 Token 提示（52474c6）

- 仓库已转公开，设置→关于里「仓库私有，检查更新需要能读取 Token；转公开后
  可留空」已失实，整行删除；文件头注释同步改公开口径。Token 配置入口保留
  （提升 API 限额用）。

### ② 窗口标题栏跟随主题（bcd7755）

- **取证反转**：用户报障「深色主题下状态栏还是白的」——组件层 StatusBar 全走
  CSS 令牌本就正常变色，白色的是 Electron 原生窗口标题栏（主进程从未配置过
  titleBar，Windows 下默认恒白不随页面变）。
- 新增 electron/preload.cjs（sandbox 兼容的 contextBridge 单方法桥），渲染层
  主题变化时上报，主进程按白名单映射切 nativeTheme.themeSource（light→light、
  dark/oled→dark、未知值回 system）；electron-builder files 为 electron/**/*
  自动随包，无需改打包清单。
- 边界说明（已向用户交底）：标题栏呈系统深色（近黑），不是 OLED 纯 #000——
  精确纯黑需 titleBarOverlay 重构窗口拖拽区，风险大本轮不做。

### ③ 侧栏项目「最后打开」相对时间（770f565）

- 取证：projects.last_opened_at 字段与 last_opened 排序早已有（侧栏默认按它排，
  即用户说的「点开自动移顶」），数据链路现成，纯前端展示。
- format.ts 新增 openAgo（<1分钟→1分钟内 / N分钟前 / N小时前 / N天前，
  30 天以上落日期，从未打开不占位；悬浮 title 给精确时刻——保留用户原本想要
  的时间戳信息），now 参数注入便于测试，新增 7 条分桶边界用例（92→99）。
- 刷新双保险：打开项目由 SSE 失效 projects 查询即时刷新（既有）+ 30s 心跳
  覆盖「挂着不动」变档。项目项 label 改 flex 两栏（名称自适应收窄、时间
  不换行），data-project-id 右键委托位置不变，右键菜单零影响。
- 刻意与既有 relTime（「刚刚 / N 分钟前」带空格口径）并存互不影响，详情栏/
  卡片/表格等消费点零改动。

### ④ 电红色发光主题（082efed）

- tokens.ts：ThemeMode 扩为 light/dark/oled/system，新增 ResolvedTheme 三态与
  VARS_OLED（布局底 #000000、容器 #0b0b0d、主色 #ff3b47、功能色借 GitHub Dark
  黑底色系）；themeVarsCss 输出三段变量 + 发光规则（主按钮/开关/勾选红色
  box-shadow 光晕、hover 增强）；applyThemeVars / antdThemeConfig 签名从 dark
  布尔改三态（唯一调用方 settings.tsx 同步改），oled 沿用 darkAlgorithm 派生
  组件色。
- settings.tsx：dark 布尔状态改 resolved 三态（上下文保留 dark 布尔供兼容），
  cachedTheme 接受 oled，标题栏上报 oled→dark；设置页 Segmented 与路径栏主题
  菜单各加「电红色发光」项。
- 服务端零改动（theme 值本就不做枚举校验）；「跟随系统」仍在浅/深间解析、
  不涉及 oled；CSS 变量机制未动，SEMANTIC 15 个引用文件零改动。
- 参考应用的本地安装目录只有 exe（Tauri 前端内嵌不可提取），色板按用户文字
  描述「OLED 黑色主题 + 电光红色发光效果」自定，观感微调属纯色值改动。

### 版本收口与出包（58b8a08 + dist:win 另行验证）

- CHANGELOG 新条目（含版本号例外说明）、README 徽章滚动 0.3.0。
- **dist:win 实战两坑连现，均按既定预案通过**：
  1. electron-builder 下载阶段 TLS 证书校验失败（网络受限环境中间人，HANDOVER
     第 6 节老坑）→ NODE_USE_SYSTEM_CA=1 + npmmirror 双镜像重跑，electron zip
     拉取成功（audit / build / build:server / electron-rebuild 链头四步此前已过）；
  2. packaging 阶段 EBUSY 锁 dist-electron 旧 app.asar（杀软，0.1.5/0.1.9 同款）
     → 输出全新 dist-electron-tmp1 + VERIFY_DIST 指向新目录自检 7 项全绿 +
     安装包移回；dist-electron 共 25 个 exe。dist-electron-tmp1 的 win-unpacked
     asar 仍被杀软锁定暂未删净（无可见锁源进程，不强杀，后续手动删即可）。
- 出包后 npm rebuild better-sqlite3 翻回 Node ABI，门禁复跑三绿。

### 收口补漏：版本常量漏改 + v0.3.0 tag（9002fed）

- 0.3.0 收口提交漏改发布策略要求同步的第二处
  `packages/server/src/index.ts` 的 version 常量（/api/health 与检查更新
  currentVersion 的来源），包内会显示 v0.2.13 且检查更新误报有新版本。
- 起因：用户要求补打 v0.3.0 tag 时顺带澄清——此前会话把 brief 转述成
  「不打 tag」系**误读**，真实约定是「tag 照打，仅 Release 安装包资产不
  程序化上传（用户浏览器手动拖）」。
- 处置：fix 提交补常量（9002fed）→ v0.3.0 tag 移至该提交并强推
  （lightweight 指针修正，Release 未建、无人消费）；按原版本号重打安装包
  替换（0.3.0 从未发布未交付，不占 0.3.1），重打包复用两坑预案
  （TLS 镜像 + 输出 dist-electron-tmp2），自检 7 项全绿，bundle 实查
  `version = "0.3.0"`。
- 教训与备忘：chore(release) 收口必须带 index.ts 常量（历届皆如此，本轮
  漏捡）；verify 自检 7 项不覆盖版本值——冒烟可加 currentVersion 与根
  package.json 的比对断言（后续可选加固）。

### 待用户手测（装 ttFolio-Setup-0.3.0.exe）

1. 深色/OLED 主题下窗口标题栏是否变深色（浏览器模式无原生标题栏，只能装版验）
2. 三主题切换与 OLED 发光观感（不满意属纯色值微调，直接反馈）
3. 侧栏项目右侧相对时间：打开项目立即变「1分钟内」，放置后变「N分钟前」，
   悬浮见精确时刻
4. 设置→关于不再出现 Token 私有仓库提示
5. 回归：窗口尺寸记忆 / 集合 / 各右键菜单（preload 新增理论上零影响，冒烟已过）

## 第二十六轮：面包屑逐级定位 + 架构图内嵌查看 + 文件树右键菜单（0.1.9，已修，待用户手测）

> 三项需求先出规划文档（PLAN-第26轮-交互三件套.md，未随本轮提交）经用户批准后实施；
> 全部按小步提交法拆分，共 9 个功能/修复提交 + 1 个版本提交。

### ① 面包屑逐级可点（57d0a18 + f4914c2）

- **取证反转**：点击功能第 7/19 轮就有且好使（verify-round19 重跑通过），真实痛点是
  **可点段渲染成灰色纯文本**（round26 探针实测 rgba(0,0,0,0.45)+cursor:auto）——没有
  任何「能点」的视觉信号。
- **改动**：可点段（工作台/项目名/子页签）包 `.tt-crumb-link`（主题色内联 + pointer +
  hover 下划线；antd cssinjs 运行时注入会盖过 base.css 类规则，颜色走内联一锤定音）；
  **目录段（除最后一段文件名外）可点**——清 targetPath 回文件列表 + `store.treeLocate`
  定位请求，FilesTab 受控 expandedKeys 逐层懒加载展开并选中（loadChildren 幂等）。
- **实测**：可点段 rgb(22,119,255)+pointer；点目录段后编辑器关闭、树展开到该目录并
  高亮；点「文件」回列表（第 19 轮行为回归通过）。

### ② 架构图软件内直接查看（37fa9ce + d52d180 + ab0e3f3 + b27df63 + 62cb2a2）

- **真实根因**：取证用户真实架构图目录（D:\<工作区>\架构图\ttFolio）——产物共
  25 个文件四类（3 主图 HTML + 3 visual-check HTML + 12 PNG + 7 md/json + json 源），
  而旧扫描只收 .html，图片/文本全被挡在列表外——「只是显示一些文件」由此而来。
- **改动**：扫描新增 imageFiles（png/jpg/jpeg/gif/webp/svg/bmp）与 textFiles
  （md/markdown/txt/json），shared 只增字段、链路带默认参数（contract.ts 等旧调用点
  兼容）；页签重构为 **DocsTab 同款常驻分栏**——左文件列表（三类 Tag + 入口标记 +
  多目录 Select），右预览（HTML→iframe 同 sandbox、图片→img、文本→只读 <pre> 且
  json 格式化）；进入自动打开入口文件；分栏宽度持久化 archListWidth。
- **过程中抓到的真 bug（CORS）**：文本预览最初 fetch 7817 arch 地址被浏览器 CORS
  拦（iframe/img 不受限但 fetch 受限）→ 新增同源只读接口
  `GET /api/archives/:id/file?rel=`，三重只读约束：rel 经 path.relative 不得越出
  登记目录（C-02 口径，项目 lint 禁 startsWith 走 indexOf 等价实现）+ 文本扩展名
  白名单 + 2MB 上限；日志 archive.read_text（L1）。7817 零改动。
- **实测（真实目录，零 mock）**：25 项三类计数 6/12/7 全对；MD 预览 3384 字符真实
  内容（架构分析说明文档）；PNG naturalWidth 加载成功；HTML iframe 正常。

### ③ 文件树右键菜单（ffd11e7 + cced99a）

- **取证**：后端三项能力全部现成——复制=fs/move 的 copy 模式、移动=同接口、
  资源管理器=/api/open 已支持可选 path（explorer /select 可定位选中），后端零改动。
- **改动**：MoveCopyModal（目标目录粘贴 + pick-folder 双入口；后端「目标已存在」
  转「跳过同名项继续」，刻意不做覆盖防误删）；树节点 title 包 Dropdown
  （contextMenu，**弹层挂 body** 与树节点 DOM 物理隔离，防 ProjectCard 式点击串台）；
  5 项菜单——复制到…/移动到…/在资源管理器中打开/复制相对路径/复制绝对路径
  （项目根取共享详情缓存，ref 供菜单闭包读最新值）；目录与文件同款。
- **实测**：五项齐全；fs/move 请求体（mode/items/targetDir）与 /open 请求体
  （含 path）拦截断言全过——**移动/复制全程 route 拦截，零真实写盘**；剪贴板
  相对/绝对路径内容逐一比对正确。

### 门禁与收口

- typecheck / lint（0 警告）/ test 62 条全绿；0.1.9 安装包自检 7 项全绿
  （出包遇杀软 EBUSY 锁旧 asar——按 0.1.5 既定绕过：electron-builder 输出
  dist-electron-tmp + VERIFY_DIST 指向 win-unpacked 自检 + 安装包移回，锁源进程
  未强杀以避免误伤用户可能开着的安装版）；0.1.0~0.1.8 全部保留。
- 探针 verify-round26（route 合成）ROUND26 PASS + round26-real（真实目录零 mock）
  全过；inspect-data 复核 drafts=0、trash=0、忽略规则无禁用。
- **追记（0.1.10）**：0.1.9 出包后落地的面包屑颜色内联修复（9af0b8d）不在包内——
  按「每修一个问题出包 +0.0.1」补出 0.1.10。绕过 EBUSY 直接打包时漏了前置
  electron-rebuild，node-ABI 的 .node 进包被自检启动冒烟当场拦截（0.1.1 教训
  第二次应验）；补 rebuild 后重打包自检 7 项全绿。教训固化：**绕过 dist:win 时
  electron-rebuild 必须手动补**。

### 检查优化轮（0.2.1，d6addf5）

- **移动/复制后整树强制重读**：自查发现树是懒加载本地 state，移动/复制成功后
  invalidate 根查询清不掉已展开子层——已移走的文件仍显示。MoveCopyModal 增加成功
  回调 onDone，FilesTab 清空 expandedKeys + refetch（树收起后展开到的一定是新结构）；
  同模式的重命名/删除为既有行为本轮不动。
- **CHANGELOG 补记**：桌面版 0.1.6~0.1.10 六个版本的变更记录补齐，0.2.1 条目随发布
  写入（版本线说明同步当前 0.2.1）。
- **回归**：round26 探针全过（过程中修正探针两处测试工程问题——菜单点击需以真实
  用户节奏 dispatch，Playwright 三事件连发会与 React mousedown 重渲染竞争；该结论
  已写入探针注释，产品代码无此问题）。门禁三绿；inspect-data 零残留。

### 样式反馈修复轮（0.2.2，b1016f4 + 0d6fe9c）

- **面包屑按用户反馈定稿**：去品牌色回归默认文字色（color:inherit 抗
  cssinjs 注入）、去 hover 下划线、hover 改 currentColor 8% 浅背景块
  （color-mix，深浅主题自动适配）；手型光标保留。实测默认色
  rgba(0,0,0,0.45) 与分隔符一致、hover 背景 rgba(0,0,0,0.06)。
- **文件树布局还原**：右键热区的 inline-block;width:100% 内联块破坏节点
  排版（用户反馈「文件名那一栏乱了」）——git 历史核查确认该实验性改动
  **从未进入版本库**（一直是未提交的工作区状态），移除后工作区与 HEAD
  一致、无 diff 可提交；**0.2.1 安装包构建时含此未提交改动，故出 0.2.2**
  让安装包与用户确认的效果一致。右键菜单功能不变（右键文件名文字弹出）。
- 实测：span 恢复 inline、节点 24px 正常单行、icon 与文字同行；截图
  目视文件树排版整齐；inspect-data 零残留。

### 右键可用性修复轮（0.2.3，8831a86）

- **用户实测 0.2.2 右键文件无菜单**——推翻上一轮「仅测试工具时序问题」的结论，
  真实机器复现证明产品确不可用。取证定位两个失效路径：①Dropdown 包在 title 文字
  span 上，右键落点在行内空白/文字外时事件不经过 span；②右键 mousedown 引发树
  重渲染，React 合成事件（挂 root 容器）与渲染存在时序竞争。
- **重构**：节点 title 只带 data-path 标记（零额外 DOM）；右键由 document 级原生
  contextmenu 监听统一处理（不经过 React 调度，任何渲染状态下稳定触发）——closest
  data-path、行内空白回退该行节点；命中后弹出固定定位受控菜单（antd Menu，五项
  与交互不变）。配套：点击其它处/窗口失焦自动关闭；剪贴板写入补失败兜底提示。
- **实测**：真实 Playwright 右键五落点连续验证（package.json/LICENSE/README.md
  文字 + packages/scripts 行内空白）全部弹出；round26 全量回归 PASS（文本预览 mock
  修正为同源接口拦截）；门禁三绿；inspect-data 零残留。
- **环境教训（如实记录）**：多轮 shell 后台起的 dev 残留 9 个 tsx watch 进程——
  端口清理只杀监听子进程，watch 父进程加载着 better-sqlite3 的 .node 导致
  electron-rebuild EPERM 连败两次；按命令行过滤 ttfolio 相关 node 进程全清后
  一次通过。出包前置检查应含「ttfolio 相关 node 进程清零」。

## 第二十七轮：开源规范化改造（0.2.4，7 个提交）

> 体检结论与实施方案见 PLAN-第27轮-开源规范化.md；四项分叉经用户拍板：
> 只改安装包文件名 / 中文主 README / 内部文档移 docs/internal / Release+topics。

- **体检**（对照正规可上线开源项目）：达标 5 项（MIT/CHANGELOG/工程配置/门禁/分支）；
  A 级差距 4 项——GitHub Releases 为 0（4 个 tag 全是 Web 阶段旧里程碑）、package.json
  六个元数据字段缺失（author 缺失致 exe Publisher 空）、README 单语且品牌三叫法混用、
  仓库 topics/homepage 空；B 级无 CI/模板/截图（CI 用户此前明确不加）；C 级敏感信息
  （真实路径/项目名在 5 个 tracked 文件 + 1 条提交信息）与根目录 7 份内部文档混杂。
- **提交**：ba6f26e 元数据补全（author=TT-Tao178/license=MIT/repository/bugs/homepage/
  keywords/英文 description）；7cc682f playwright e2e 目录改相对解析（去本机绝对路径，
  amend 修正 ../ 层级）；6f47e95 七份内部文档 git mv 入 docs/internal/（根目录只留
  开源门面）；c6965e9 artifactName 改 ttFolio-Setup（productName/shortcutName/appId
  按拍板不动）；be7609d README 中文主重写（语言切换行+三徽章+品牌统一+新包名）；
  34a0c16 README.en.md 英文同构；f1b0571 userData 随数据目录隔离。
- **过程事故（已修）**：0.2.4 首次自检「启动冒烟失败」——取证为用户开着的安装版
  （4 进程）持单实例锁，冒烟实例启动即退出码 0；此前多次冒烟通过只是碰巧用户未开
  应用。修法：TTFOLIO_DATA_DIR 隔离时 setPath('userData') 同步隔离，锁随数据目录
  分离；重打包后 7 项全绿（带着在用安装版通过——自检从此不依赖用户关应用）。
  另：杀软 EBUSY 锁旧 asar 第四次出现，绕过流程已熟（换全新输出目录）。
- **出包**：ttFolio-Setup-0.2.4.exe（首个 ASCII 新名安装包）自检 7 项全绿；
  0.1.0~0.2.3 共 14 个旧包全部保留（现 15 个）。
- **发布**：tag v0.2.4 + GitHub Release 挂安装包 + topics/description 更新（首个
  桌面版 Release，README 的 Releases 链接自此有效）。

### 顶栏品牌区去除轮（0.2.5，bbf905a + 135ea2f）

- **用户反馈**：窗口内顶栏的品牌图标与名称和系统窗口标题栏/任务栏
  （0.2.3 起为 TT 品牌图标 + 名称）重复。
- **改动**：移除顶栏 Avatar logo 与 ttFolio 名字，保留副标题说明文字；
  清理未使用的 Avatar 导入。窗口标题栏/任务栏的品牌展示不受影响。
- **实测**：探针 DOM 断言（顶栏 0 个 TT Avatar、0 个 strong、副标题在）
  + 截图目视；门禁三绿；inspect-data 零残留；0.2.5 自检 7 项全绿
  （EBUSY 第五次——按既定流程换全新输出目录 tmp3 通过）。
- **发布**：ttFolio-Setup-0.2.5.exe（16 个安装包全保留）。

### 图片查看器与副标题精简轮（0.2.6，550c210 + 4406350 + ea5c24a）

- **副标题精简**：顶栏说明只保留 a local project workbench（「TT项目管理工作台」
  字样仍与窗口标题栏重复，用户点名去掉）。
- **图片预览升级为缩放查看器**：项目文件的图片此前只有一张原始尺寸 img——重写
  ImagePreview：工具栏（文件名/像素尺寸/−·百分比·＋/适应窗口/1:1/复制相对路径/
  新窗口打开原图）、缩放 10%~800%（按钮 + Ctrl+滚轮原生监听）、>200% 像素化渲染、
  棋盘格背景（透明 PNG 可见）、换图自动重置。数据通道不变（/raw 只读代理）。
- **实测**：真实 PNG（round27-topbar.png 1600×950）——尺寸标注正确、放大两下
  144%、适应窗口回落；截图目视工具栏与棋盘格；顶栏副标题断言通过；门禁三绿；
  inspect-data 零残留；0.2.6 自检 7 项全绿（EBUSY 换全新输出目录 tmp4 通过——
  tmp2/tmp3 残留 asar 锁未释放，目录留在磁盘可稍后手动删）。
- **发布**：ttFolio-Setup-0.2.6.exe（17 个安装包全保留）。

### 树缩略图轮（0.2.7，03bf806 + 18cf5eb）

- **用户两项反馈**：①文件树图片文件名旁要显示缩略图（强调「别改乱」）；
  ②右键菜单在软件里仍不弹。
- **缩略图**：icon 槽方案——图片文件的树节点 icon 槽渲染 16×16 缩略图
  （/raw 只读代理 + loading=lazy + onError 静默回退），复用既有 icon 槽位
  布局零影响；探针实测 .tmp-test 下 5 张 PNG 缩略图 16×16 渲染、naturalWidth
  加载成功、行高 24px 不变；右键菜单回归通过。
- **右键「仍不弹」的判定**：0.2.3 的修复（document 级监听）在 dev 浏览器
  五落点验证稳定弹出；生产 Electron 验证因测试数据问题（登记响应 ok 但
  elec-verify 库 0 行——原因未定位，已记录待查）未能完成闭环。**用户报告
  的「不弹」极大概率来自 0.2.3 之前的旧安装包**（0.2.3 起才含修复）——
  请装 0.2.7 实测；若仍不弹，按右键具体位置取证。
- **发布**：ttFolio-Setup-0.2.7.exe（18 个安装包全保留）。
- **追记**：用户装 0.2.7 实测确认**文件树右键菜单能弹**（0.2.3 起的修复在安装版生效），
  第 27 轮遗留第 1 条闭案。

### 卡片右键 + 集合归属轮（0.2.7 工作区 3 个提交，待用户手测后升版出包）

- **用户两项反馈**：①文件右键菜单出来了，但**项目卡片右键没有菜单**；
  ②新建了集合做分类，**项目移不进去/不方便移**。
- **取证反转（集合）**：后端 `/api/collections/:id/members`（追加/全量替换双语义）
  与 `ProjectSummary.collections` 字段早在首轮就有，但**前端零调用**——集合成员维护
  根本没有 UI（设置页只能建/删集合本身）。「移不进去」不是交互绕，是能力缺失。
- **连带真 bug（e657ec9）**：侧栏点集合打开 `col:<id>` 卡片墙时 parseSubTab 只返回
  status，没传 `collection` 查询参数——集合视图显示的是**全部项目**。一行修复。
- **项目卡片右键菜单（ab9a6f0）**：文件树 0.2.3 同款「受控固定定位菜单 + document 级
  关闭监听」搬进 ProjectCard——卡片任意位置右键弹出；菜单 items 抽纯数据 +
  handleMenuAction 统一分发，「…」图标 Dropdown 与受控菜单共用一份定义，「…」触发
  收窄为纯点击避免两种右键并存；卡片 onClick 增加 project-ctx-menu 容器排除防菜单项
  点击冒泡误开项目；贴边收口（右留 232 / 下留 520）。
- **归属集合弹窗（20aba06）**：新增 CollectionPickerModal——勾选列表（勾选态=当前
  所属，取打开瞬间快照）+ 底部快捷新建（创建即勾选）+ 无集合空态跳设置页；保存只对
  有变化的集合发请求（加入=追加语义 replace:false；移出=全量替换 replace:true 减去
  本项目——移除无专门接口）；完成刷新 projects/collections 两路缓存（卡片归属、
  侧栏集合计数同步）。菜单入口「归属集合…」放「固定」之后；弹窗条件渲染 +
  key=项目 id 防缓存串台。
- **实测**：typecheck / lint（0 警告）/ test 62 条全绿；界面行为交用户手测
  （手测要点见提交信息）。
- **发布（0.2.8）**：版本提交 ff3dc1a 后走 dist:win 全链路——build/rebuild 一次过，
  packaging 阶段 EBUSY 第 6 次（杀软锁旧 win-unpacked 的 app.asar，unlink 失败），
  按既定流程换全新输出目录 dist-electron-tmp5 出包 + VERIFY_DIST 指向其 win-unpacked
  自检 7 项全绿（含真实启动冒烟 health 200），安装包与 blockmap 移回 dist-electron
  （共 19 个，旧包一律保留）。

### 侧栏项目右键菜单轮（0.2.9，756c327 + 5540ec6）

- **用户纠正**：「项目那里右键没有菜单」指的是**左侧栏项目列表**——第 28 轮做的是
  总览/卡片墙的项目卡片，侧栏项目条目右键仍是浏览器默认菜单。
- **改动**：文件树/项目卡片同款定稿模式搬进 Sidebar——document 级 contextmenu 委托
  + 受控固定定位菜单；项目条目 label 带 data-project-id，行内空白回退
  closest('.ant-menu-item') 内查找；菜单 8 项（打开项目/文件页/Git/归属集合…/固定/
  复制路径/资源管理器/重新分析）；projects/git/archives/docs 四域项目列表共用同一
  label，右键处处可用。
- **ABI 双态实录（已知坑再次应验）**：0.2.8 出包的 electron-rebuild 把
  better-sqlite3 翻到 Electron ABI，门禁 vitest 集成测试随之报 NODE_MODULE_VERSION
  不匹配——`npm rebuild better-sqlite3` 翻回 Node ABI 后 62 条复绿，与代码改动无关；
  随后出 0.2.9 时 dist:win 会自行再翻回 Electron ABI，无需人工干预。
- **实测**：typecheck / lint（0 警告）/ test 62 条全绿；界面行为交用户手测。
- **发布（0.2.9）**：dist:win packaging 阶段 EBUSY 第 7 次（同一位置同一锁源），
  换 dist-electron-tmp6 出包 + 自检 7 项全绿（含真实启动冒烟），安装包与 blockmap
  移回 dist-electron（共 20 个，旧包一律保留）。

### 侧栏集合折叠列表轮（0.2.10，da235d1 + 1051b64）

- **用户需求**：加入集合的项目要在左侧栏直接可见，且列表可打开/关闭。
- **改动**：集合项从平面条目改为 antd 子菜单（收起为默认态）——点集合名=原生
  展开/收起（不再直接开标签）；子项首位「打开集合视图」保留原卡片墙入口
  （colview: 前缀）；成员项目单行省略展示，可直接点开 files 页签（colproj: 前缀），
  且带 data-project-id——右键整套菜单（含归属集合…）对集合内成员同样可用。
  成员取 projects 查询交集，已删除/已归档项目自动不出现。展开态不持久化
  （切域后复位，当前可接受）。
- **实测**：typecheck / lint（0 警告）/ test 62 条全绿；界面行为交用户手测。
- **发布（0.2.10）**：dist:win 全链路**一次过**（EBUSY 首次未出现），自检 7 项全绿，
  dist-electron 共 21 个安装包；出包后照例 `npm rebuild better-sqlite3` 翻回
  Node ABI（62 条复绿）再交还用户 dev。

### 第三十一轮：全项目评审与 remediation（0.2.11，20 个提交）

> 用户要求对项目做全面评审（点击不一致/设计不合理/bug/缺失设计），评审完毕
> 文字报告过目后一次性处置全部问题；流程=计划→评审核实→执行，细粒度提交。

- **评审报告要点**（已单独成文交用户）：1 个安全级问题（命令面板 snippet XSS）、
  4 个"后端就绪前端断头"死功能（文件重命名/标签/备注/归档）、9 类点击不一致、
  若干确认标准不统一与文案失实。KNOWN-GAPS #2（树右键菜单）就此闭合、#7 文案
  矛盾修正，新增 #8（按标签过滤视图）/#9（集合手动排序）两个延期项。
- **P0**：0e71ddf snippet 转义+[ ]→\<mark\>；7e38f8d 删集合/清超期回收站补确认。
- **P1**：62ab9ca 文件重命名/删除入口（树右键+F2/Delete 实装，RenameModal 从死代码
  复活）；a0acfc1 搜索目录结果可点（treeLocate 通道）；e714855 卡片「打开文件页」
  强制 files；f6bd496 三处失实文案/命令（拖拽提示/cmd.add/作用域回落说明）；
  27aede9 侧栏补 /open 计数 + selected 高亮重算（四域映射，删无操作 replace）。
- **P2**：44d5c07 项目菜单抽 projectMenu 共享模块 + 表格视图操作列/行右键补齐
  （卡片与表格从此共用一份菜单定义）；32ce253 卡片集合徽标（最多 2 个+溢出计数）；
  17c0c77 集合移出改专用 DELETE /api/collections/:id/members/:projectId（弃快照
  全量替换）+ 弹窗新建竞态修复（createdCols 本地并入保存 diff）；d775d03 标签栏
  菜单扩 7 项（恢复已关闭/关闭其他/右侧/全部，closedTabs 栈 + moveTab 固定区钳制
  + useCloseTab 共享 hook）；96e3f81 Ctrl+W 关脏标签补确认 + 四处右键菜单
  Esc/滚动关闭（仅 Esc，避免吞菜单键盘导航）。
- **P3**：162b32c 归档/取消归档入口（useArchiveProject + 卡片墙工具栏「已归档」
  按钮——归档找回入口，已归档侧栏项按用户此前要求不加回）；6c2bda6「今天动过」
  本地时区；e3b6d48 回收站恢复指定目录（后端 targetDir/TRASH_PATH_TAKEN 本就
  支持，前端接 pick-folder 重试）；7ff78d9 详情栏标签+备注编辑（标签按名 diff、
  删除经 id 映射；备注失焦保存）；279c5c1 集合管理（CollectionEditModal 重命名/
  备注 + 设置卡行式布局 + 侧栏集合右键 4 项菜单，ctx 扩展双类型）。
- **过程事故（已修）**：①gitignore `trash/` 无根锚定误伤 features/trash 源码目录
  （TrashPage.tsx 因先跟踪才幸免）——5c29977 加根锚定；②门禁管道 `| tail` 吞掉
  typecheck 退出码，ArchiveOutlined（不存在的图标）带着编译错误进了 6067abe——
  改 InboxOutlined 后 amend 为 162b32c，此后门禁一律真实退出码判定。
- **延期（入 KNOWN-GAPS #8/#9）**：按标签过滤视图（ListFilters 需加 tag 参数）；
  集合手动排序（PATCH 需加 sort_order）。
- **实测**：每个提交 typecheck/lint/test 真实退出码 0（62 条全绿）；界面行为交
  用户装包手测。

### 检查更新轮（0.2.12，0d65188 + bfafb77 + 67331a0 + e69e9d5）

- **需求**：用户要「手动从 GitHub 检查更新」。评审 C10 的轻方案：完整 electron-updater
  需走 github.com 下载域（网络受限环境拦截，不可行），退为「查 Releases 元数据
  （api.github.com，api 域正常）+ 一键打开下载页 + 手动下载」，与现行手动拖传
  Release 资产的惯例一致。
- **后端（0d65188/67331a0/e69e9d5）**：shared 常量 GITHUB_REPO/GITHUB_RELEASES_URL
  + SETTING_KEYS.githubToken；openExternal.openUrlInBrowser（仅 https，rundll32）；
  system 路由四端点——status（版本/Token 是否已设置，不回显本体）/token（宽松校验
  ghp_/gho_/github_pat_ 前缀，空串清除；**刻意不进 PATCH settings 通用通道**，
  杜绝 GET /api/settings 回显密钥）/check（8s 超时查 releases/latest，语义化版本
  比较，404 双情形文案）/open-release（L1 日志）。
- **前端（bfafb77）**：UpdateCheck 组件挂「关于」卡——当前版本 + 检查更新
  （新版本/已最新/无 Release 三态 + 安装包资产缺失提示）+ 打开下载页 + Token
  配置（Password 输入，tokenSet 状态 Tag）。
- **过程取证（本轮最有价值的发现）**：冒烟时 fetch 直连 api.github.com 报
  **UNABLE_TO_VERIFY_LEAF_SIGNATURE**——本地网络环境对 github 域做 TLS 中间人（出包
  NODE_USE_SYSTEM_CA=1 的根因同源）；同 URL curl 直连 404/0.6s 正常（系统证书库
  信任本地网络环境 CA）。而打包版 server 进程内跑在 Electron 里，NODE_USE_SYSTEM_CA
  启动期 env 注入不可靠 → **代码级回退**：fetch 异常一律回退系统 curl.exe
  （Schannel 走系统证书库；-w 附加状态码；C-21 executable+args 口径）。
- **冒烟（隔离数据目录 TTFOLIO_DATA_DIR，零触碰真实数据）**：status→tokenSet:false；
  token 格式坏值→400；存假 Token→tokenSet:true；check 假 Token→PERMISSION_DENIED
  （curl 回退真实走通）；清 Token→tokenSet:false；check 无 Token→404 分支双情形
  文案。收口按 CommandLine 清 3 个 dev 进程 + 删冒烟目录零残留。
- **实测**：typecheck/lint/test 真实退出码 0；「检查更新」全链路待用户装包配
  Token 手测（前端三态 UI）。

### 第三十三轮：工程补强（0.2.13，14 个提交 + 8 tag）

> 按用户批准的 PLAN-第33轮-工程补强.md 执行（该文档本轮入库）。M3 删脏 tag、
> M13 HANDOVER-legacy.md 处置两项按约定留待用户单独确认。

- **M1（677061c）**：删除未使用的 @fastify/static——第二份评审误判其为静态服务
  组件，本轮核准全仓零引用（前端 app.ts 手写 readFile、7817 走 userContent.ts
  PathGuard），删除即消除四条 high 通告，audit 清零。
- **M2（90666f1）**：KNOWN-GAPS 入册三条决策——Token 明文取舍（#10）/ i18n
  明确不做 / e2e 冻结资产。
- **M3**：补 tag v0.2.5~v0.2.12（哈希逐条核准）并推送；删 v0.1.0-p0/v0.3.0-p2/
  v1.0.0 三个脏 tag 待用户确认（远端删除不可逆）。
- **M4（01a2b95）**：Release 备忘稿 0.2.5~0.2.12（Title/Notes/安装包名，浏览器
  建页拖资产用）；拖传完成后「检查更新」数据面闭环。
- **M5（925d1eb + 1851d02）**：parseSubTab / semverNewer 抽纯函数 + 三份测试
  30 条（store 全家桶 / parseSubTab 全分支 / semver 进位与脏输入）——
  62→92 条，一次全绿。
- **M6（b867260 + 2580e96）**：format/format:check script 接线 + 全仓 prettier
  规范化（110 文件，纯格式，门禁全绿可证行为不变）。
- **M7（204660d）**：audit:prod 入 dist:win 链头（high 即 fail-fast）——本轮
  dist:win 首次实战通过。
- **M8（c8fa2f9）**：窗口状态记忆（userData/window-state.json + 上屏校验 +
  最大化还原 + 尺寸下限）。
- **M9（7598ebb）**：渲染层异常落盘（前端监听 → POST /api/log/client-error →
  pino + 活动 L2，10 秒节流、静默 200）+ 主进程 render-process-gone 追加
  renderer-crash.log。
- **M10（5f11cd6）**：迁移 0004——collection_members(project_id) 索引；隔离
  目录实测 user_version 3→4、索引就位。
- **M11（f9fa873）**：CONTRIBUTING / SECURITY / issue×2 与 PR 模板。
- **M12（d665773）**：README 三张界面截图（隔离目录 + 演示项目 demo-web/
  demo-api + 探针 shot-readme.mjs；逐张目检，无真实路径泄漏；演示数据零残留）。
- **M13**：dist-electron-tmp~tmp6 六目录与 test-results 清空（杀软本次未锁）；
  HANDOVER-legacy.md 处置待用户选择（归档 or 删除）。
- **发布（2ceeeed 起）**：0.2.13 dist:win 连续第四次一次过——audit:prod 前置
  首次实战、自检 7 项全绿、24 个安装包；出包后 better-sqlite3 翻回 Node ABI
  （92 条复绿）。

## 第二十四轮：失效项目的「重新定位 + 移除登记」闭环（0.1.8，已修，待用户手测）

- **用户报障**：目录被移动/删除后只提示「项目目录失效：杂-一些可爱的表情」，没有
  重新定位的办法，也没有失效项目删除入口。
- **取证**：后端 `relocate`/`DELETE ?mode=unregister` 接口与失效 Tag 早在 P0/第十九轮
  就有，缺的是**入口与体验**——重新定位藏在详情页且只收粘贴路径；卡片菜单的移除
  点击即执行无确认；总览/卡片层无任何操作入口。
- **改动（5 个小步提交 + 版本提交，按用户小步提交法拆分）**：
  - `d756982` RelocateModal 共用组件：粘贴路径 + 系统目录对话框双入口（与添加项目同模式）；
  - `d4f3a9d` 卡片菜单新增「重新定位到新目录…」首项；两个移除动作改 modal.confirm
    二次确认；失效时禁用「移除并删除文件」（目录不存在无法进回收站）与资源管理器/
    终端/重新分析；标题以「目录失效」Tag 强化可见性；
  - `8c9b072` **修一个存量交互 bug**：卡片 onClick 会收到 Dropdown 菜单项（弹层挂卡片内）
    与 Modal 弹窗按钮（React 合成事件沿组件树冒泡）两类「不是点卡片」的点击，顺带
    触发 onOpen 切页、把弹窗面板卸载——双重排除后点菜单/弹窗不再切页（该 bug 影响
    所有卡片菜单项，非本轮新增代码独有）；
  - `a379e4e` 详情失效页新增「选择目录…」（pick-folder 回填）与「移除登记…」（确认后
    DELETE ?mode=unregister 并自动关闭失效标签）；
  - `9749bb0` 补仓储链路用例（检测→定位→移除，此前零覆盖，61→62 条）。
- **排查中顺带确认的两个测试性坑（已记入探针注释）**：route 的 glob `*` 不跨 `/`
  （列表/子路径要分别注册，否则详情 404 触发面板降级、卡片被卸载，干扰判断）；
  testid 不能放在 `<Modal>` 上（落在零高 `.ant-modal-root`，visible 判定恒 false）。
- **实测（verify-round25，route 合成失效项目，零写库）**：ROUND25 PASS——卡片红边 +
  目录失效 Tag + 菜单首项；粘贴定位 POST 体正确；pick-folder 回填输入框；详情页
  四控件齐全；移除登记确认后发出 mode=unregister 并自动关标签；0 控制台错误。
  门禁三绿（typecheck/lint/test 62 条）；dist:win 出 0.1.8 自检 7 项全绿；inspect-data
  复核 drafts=0、trash=0、忽略规则无禁用；0.1.0~0.1.7 全部保留。
- **过程教训（如实记录）**：出包时 electron-rebuild 失败一次——dev 服务未停、node
  进程锁住 better-sqlite3 的 .node 文件（HANDOVER 陷阱 1 的现场重演），停 dev 后
  一次通过。

## 第二十三轮：TT 品牌图标落地桌面版（0.1.6，已修，待用户手测）

- **用户需求**：左上角蓝白色 TT（界面方形 Avatar：`tt-primary` #1677ff 底 + 白色粗体字）
  要成为安装后的桌面图标——此前 exe/安装包/快捷方式一直是 Electron 默认图标。
- **改动（74a323b）**：
  - `electron/build/icon.svg` 作为图标**单一真源**：按 26px 头像等比放大（圆角 4px→40、
    字号约 0.52 倍边长、微收字距），改 logo 只改这一个文件；
  - `scripts/make-icon.mjs`：无头 Chromium 矢量渲染 16/24/32/48/64/128/256 七个尺寸，
    按 PNG-in-ICO 规范零依赖拼装 `icon.ico`（重生成：`node scripts/make-icon.mjs`）；
  - `electron-builder.yml` 显式 `win.icon`；版本 0.1.5→0.1.6；
  - `.gitignore` 的 `build/` 根锚定为 `/build/`——旧规则误伤 `electron/build`
    （buildResources 源资产目录，非构建产物）。
- **出包网络事故（如实记录）**：本次 electron-builder 在 packaging 阶段反复挂死
  （zip 100% 后等待 600s 超时）。取证：GitHub releases/download 路径被网络受限环境返回
  400，卡的是 electron zip 的 **SHASUMS256.txt 校验文件**（zip 本体有缓存）。
  处置：从 npmmirror 手动取 SHASUMS 放入 `%LOCALAPPDATA%\electron\Cache\<hash>\`，
  并以 `NODE_USE_SYSTEM_CA=1` + `ELECTRON_MIRROR`/`ELECTRON_BUILDER_BINARIES_MIRROR`
  指向 npmmirror 重跑，一次通过。已写入 HANDOVER 环境陷阱。
- **实测**：门禁三绿；dist:win 全链路自检 7 项全绿；ExtractAssociatedIcon 实抽
  win-unpacked exe 与 Setup-0.1.6.exe 图标均为蓝底白 TT、与界面 logo 一致；
  0.1.0~0.1.5 旧包全部保留。

### 迭代① 圆角加大 + 去除四角白底，版本 0.1.7（c71bbe0）

- **用户反馈**：圆角设计好、要更大；图标四角露出白底。
- **根因**：make-icon.mjs 的 Playwright 截图未开 `omitBackground`，透明背景被
  默认填白 → 圆角四角带白。
- **修法**：截图加 `omitBackground: true`（四角保留 alpha=0）；圆角 rx 40→60
  （约 23% 边长，桌面图标惯例档位）。
- **实测**：新 ico 256 位图四角 A=0、中心 A=255 且 RGB=#1677ff；门禁三绿；
  dist:win 自检 7 项全绿；从 0.1.7 exe 实抽图标四角 A=0 中心 A=255。
  0.1.0~0.1.6 全部保留。

## 第二十一轮：桌面版启动两连修 + Git「加载更多」修复（0.1.1~0.1.2，补记）

> 本节为后续收口时补记，证据取自各提交正文与当时的探针/自检输出。
> 安装包 0.1.0~0.1.5 全部保留于 `dist-electron/`。

### ① 安装版启动报 Cannot find module 'better-sqlite3'（fix 0d26248）

- **根因**：依赖声明在 packages/server（workspaces 子包），根 package.json 无
  dependencies；electron-builder 按根声明收包 → 收集为空；files: 里手写
  `node_modules/**` 又被其专用管道忽略。冒烟没抓到是因为从项目目录跑
  electron.exe，require 向上命中了开发用 node_modules。
- **修法**：根 package.json 显式声明 better-sqlite3/bindings/file-uri-to-path 为
  生产依赖；新增 `scripts/verify-dist-electron.mjs` 出包自检（asar 内断言三件套 +
  unpacked 必须有 .node + 打包版 Electron 完整启动冒烟）；移除 dist:win 多余的
  electron-rebuild（electron-builder 本会自动按 electron ABI 重编译）。
- **验证**：重出包自检全过；win-unpacked GUI 冒烟 health 200、真实数据加载正常。

### ② 安装版打开提示「前端尚未构建」，版本升至 0.1.1（fix 0619c36）

- **根因**：服务端只从 `process.cwd()` 定位 packages/web/dist，安装版 cwd 是
  安装目录、且前端产物根本没进 asar（electron-builder files 漏收）。
- **修法**：webDist 候选首位支持 `TTFOLIO_WEB_DIST` 环境变量；Electron 主进程注入
  该变量指向 asar 内 dist；files 收 `packages/web/dist/**`；产物自检新增
  index.html 断言，启动冒烟改走真实 GUI 路径（health 200 + 页面非占位文案）。
- **教训（自检拦下一次事故）**：曾绕过 dist:win 直接跑 electron-builder，漏了
  前置 ABI 重建，把 node-ABI 的 .node 打进包——自检启动冒烟当场拦截；另 npx
  会解析到缓存旧包，必须用项目本地 node_modules/.bin。
- **验证**：自检 7 项全绿；0.1.0 旧安装包保留未删。

### ③ Git「加载更多」点击闪空跳顶，版本升至 0.1.2（fix 2049f51）

- **根因（三件叠加）**：limit 变化 → queryKey 变化 → data 先变 undefined
  （列表闪空、页面高度骤减把滚动钳回顶部）；antd List 无 rowKey 整列重建；
  提交总数不足 limit 时按钮点了也拉不到更多（纯无用功）。
- **修法**：useQuery 加 `placeholderData: keepPreviousData`（拉取期间保留旧数据）；
  List 设 `rowKey=hash`（前 50 条 DOM 复用、新条目追加）；返回条数 < limit 视为
  已到末尾——按钮消失，改显「已加载全部 N 条提交」，加载中按钮 loading。
- **实测**（verify-round21 探针，route 合成 60/30 条提交，零真实 git 调用）：
  点击后 60 条含「提交 60」、滚动位置 600→600 严格保持；合成 30 条时按钮消失、
  提示到位。门禁三绿；0.1.2 安装包自检 7 项全绿。

## 第二十二轮：总览四模块 + 窗口适配三连修（0.1.3~0.1.5，补记）

> 本节为后续收口时补记。总览从「KPI + 卡片」扩为四模块，并围绕窗口宽度
> 连修三轮；迁移 0003（projects.git_last_commit_subject，只增不改）随 0.1.3 落地。

### ① 总览新增四个模块 + 分页器防漂移，版本升至 0.1.3（feat 66978bd）

- **为什么**：用户反馈总览下半部分太空（卡片只有两行），翻到内容不满的页时
  分页器「共 N 个项目」会被往上顶。经用户确认四模块全做。
- **新模块**（数据全部来自既有分析，无需额外扫描）：
  「继续上次」最近打开 6 个项目 chips 一键直达；「需要关注」行动条
  （未提交改动/缺文档/缺架构图/未分析，计数>0 才显示，点击跳卡片墙视图）；
  「语言构成」跨项目字节聚合的 GitHub 风格色条 + 图例（top6+其他）；
  「最近提交」跨项目倒序 8 条动态流（点行跳 Git 页签）。
  为此新增迁移 0003、git 摘要与分析器落库提交主题、shared 类型扩展；
  已全量重分析落库。
- **分页器防漂移**：总览改 flex column + 项目区 flex:1，并以第 1 页卡片栅格
  实际高度锁定 grid minHeight——任何一页分页器位置恒定（实测 25 假项目翻
  三页文档 y 恒 1171）。该锁定在 0.1.4/0.1.5 又经两轮收紧（见下）。
- **实测**：verify-round22 真实数据四模块全过；迁移 0003 自动执行、快照生成、
  项目完好；门禁三绿；0.1.3 安装包自检 7 项全绿。

### ② 窗口适配失效 + 刷新按钮无反馈，版本升至 0.1.4（fix 9900466）

- **根因**：①的 minHeight 锁定不随窗口宽度失效——放大窗口后列数变多、内容
  变矮，仍锁旧高值 → 大片空白；刷新按钮点了没有任何可见反馈，感知是「跟没用一样」。
- **修法**：高度锁定收紧到「产生它的窗口宽度」——监听 resize，宽度一变立即清零
  （宁可暂时退化为跟随内容，也绝不锁旧宽度的高值），回第 1 页按新列数重新校准；
  刷新按钮点击后图标 spin 600ms + Tooltip 文案更新。
- **实测**：verify-round23——1280 宽翻三页分页器恒 1241；切 1920 后第 3 页
  minHeight 立即清零、回第 1 页校准 557 与内容贴合；门禁三绿；0.1.4 自检全绿。

### ③ 小窗口下「最近提交」叠到项目卡片上，版本升至 0.1.5（fix 2afe957）

- **根因**：项目区 wrapper 用 flex:1——小窗口时 flex 盒被压到远小于内容，
  溢出内容不被后续兄弟避让，「最近提交」按压缩后的盒高排布、叠进卡片区域。
- **修法**：弹性从 wrapper 挪到独立垫片——项目区改顺流布局（高度=锁定高度+内容，
  永不重叠），「最近提交」卡前插 flex:1 垫片：内容不满一屏吃掉剩余空间推到底部，
  超屏自动收缩为 0。分页器 margin-top 从 auto 改固定 12。
- **实测**：verify-round24——1280×620 小窗翻三页提交卡 top(1285) 恒在
  grid bottom(1237) 之下零重叠；1440×1000 大窗垫片生效。门禁三绿；0.1.5 自检全绿。
- **出包环境教训**：electron-builder 替换 app.asar 遭杀软实时扫描 EBUSY——
  绕过 = 输出到临时目录出包、自检通过后移回（自检脚本支持 VERIFY_DIST 指定
  待检目录）；安装包首次启动 60s+ 也是杀软首扫，二次启动 4s 内。

## 第二十轮：总览收敛 + 提交详情 + 历史下拉 + 自动打开首文件 + Electron 桌面版（已修，待用户手测）

### ① 总览移除三张卡（a0c5fc9）② 提交详情视图（f436b0e）③ 历史下拉（b169795）④ 自动打开首文件（bc9c048）

| # | 用户反馈 | 根因 | 改动 | 探针实测（verify-round20，合成数据） |
| --- | --- | --- | --- | --- |
| 1 | 总览三张卡莫名其妙、跳转乱 | 需要处理/跨项目清单跳的是已删的侧栏视图；最近打开与项目卡片重复 | 总览收敛为「KPI + 项目卡片分页」，三卡与相关死代码移除 | 总览无三卡文案，KPI/卡片正常 |
| 2 | 提交历史点开是空的 | 点提交 openTab 出 kind:'git' 标签，App 壳没有该标签的渲染分支 → 空 div | 新增 CommitView（元信息+文件列表+patch，接口本就有）；App 壳补渲染分支；加 PaneErrorBoundary（视图崩溃只降级本面板） | 点提交 → commit-view 含文件列表与 patch |
| 3 | 前进/后退莫名其妙 | 纯按钮，不知道会去哪 | 按钮包历史下拉（最近 15 条，「● 当前」置灰，可读位置摘要），点条目直达；单击/快捷键/置灰不变 | 下拉出现「● 当前：nav-demo · 文件 · README.md」+ 目标条目 |
| 4 | 项目点进去默认是空的 | 打开项目只落「文件」页签不打开文件 | 三个打开入口设置 pendingAutoOpenProject 标记，FilesTab 消费：自动选中第一个文本文件；面包屑「文件」回列表不触发（保持第十九轮行为） | 打开项目 → 编辑器自动打开 README.md；回列表后不回弹 |

### ⑤ Electron 桌面版（6d5dbed，产物 dist-electron/TT项目管理工作台-Setup-0.1.0.exe）

- **先想清楚的问题**（用户点名要求）：
  1. **spawn PowerShell 弹窗 = 杀软误报高危** → 换成原生对话框桥：主进程起 127.0.0.1+随机
     token 的 HTTP 桥，server /api/dialogs/* 检测 `TTFOLIO_DIALOG_BRIDGE_*` 即转发给
     `dialog.showOpenDialog`；Web 模式不设桥变量、仍走 PowerShell，双模式并存。
  2. **本地端口 + 子进程会被部分企业策略拦** → 服务端改为**进程内**运行（esbuild 打成
     main.cjs 被 Electron 主进程 require），不再 spawn node 子进程；只监听 127.0.0.1、
     端口运行时探测。git/资源管理器/终端的 spawn 是本地工作台本质功能，保留（有策略的
     环境下这些仍可能被拦，文档已注明）。
  3. **中文路径**：NSIS Unicode 安装器 + 可改安装目录；数据目录 %APPDATA%（中文用户名 OK）；
     spawn 参数一律数组不受中文空格影响；删掉 PowerShell 后连带消掉 GBK 编码坑。
  4. **卸载**：NSIS per-user 免管理员；卸载只删程序目录，**不删 %APPDATA%\ttFolio 数据**。
  5. **better-sqlite3 ABI**：electron-builder 前先 electron-rebuild（本机 MSVC 可用，已实测
     Electron 下读写正常）；产物 asarUnpack 分发。
  6. **未签名**：首次运行有 SmartScreen 提示，「更多信息→仍要运行」即可。
- **冒烟实测**：Electron 启动 → health 200（port 探测、projectCount=13 真实数据）→
  窗口加载页面标题正确；对话框桥链路待用户手测（点「选择文件…」应弹原生对话框）。
- **本轮教训（已修）**：electron ABI 与 node ABI 切换后跑错运行时，曾触发"库损坏自愈"
  把真实 library.db 改名走——已恢复数据，并把自愈条件收窄为"SQLite 真损坏"，
  native 模块加载失败现在干净退出且不触碰库文件（index.ts）。

## 第十九轮：面包屑子页签可点击（已修，待用户手测）

- **用户反馈**：在工作台/项目/文件/子路径 下点「文件」回不去文件列表页。
- **改动（9ce721c）**：项目标签的子页签段（文件/Git/架构图/文档）从纯文本改为可点击——
  跳到对应子页签并清 targetPath（关闭编辑器）；点项目名仍跳项目概览；同位置重复点击
  不压历史栈。文件树的中间目录段保持纯文本（目录无编辑器语义）。
- **实测**（verify-round19，route 伪造 fs/file）：打开文件 → 点「文件」面包屑 → 编辑器
  关闭、路径段清空、标签数不变；后退 → 编辑器与面包屑还原；点项目名 → 概览；0 报错。
- 顺带核实：面包屑显示「TT项目管理工作台」是用户给 ttfolio 项目起的别名（非 bug）；
  会话现为 2 个标签（用户手测自行清理），探针只复用未新增。

## 第十八轮：语言识别扩展至 GitHub Linguist 口径（已修）

- **用户问题**：项目上的「素材仓库/未识别/纯前端」怎么判定的？语言占比为什么比 GitHub 单薄？
- **判定口径（typeDetect，未改）**：微服务 → 前后端分离 → 单体 → 纯前端（前端框架依赖或
  index.html+package.json）→ 后端 → 脚本（脚本字节≥40%）→ 素材仓库（媒体字节≥80%）→ 未识别；
  手动改类型优先。
- **本轮改动（d4c9e0a）**：语言映射 ~50 → ~90 扩展名 + **按文件名识别**（Makefile/Dockerfile/
  CMakeLists.txt/Rakefile/Gemfile/Vagrantfile/Procfile/.env*）；前端色表补全至 90 个 GitHub
  官方语言色；新增单测（61 条全绿）。
- **实测**：对 11 个已登记项目全量重分析（只读扫描），3 个项目新识别出 Dockerfile 占比，
  其余按新口径重算；verify-round17.mjs 前后对比留档。

## 第十七轮：顶栏品牌文案调整（已修）

- 左上角 logo 字样 `tf` → **TT**；副标题 `tt项目仓库 · a local project workbench` →
  **TT项目管理工作台 · a local project workbench**（仅 App.tsx 两行文案）。
- 实测：探针读顶栏 logo="TT"、tagline 全文正确；r17-logo.png 目视核对；门禁三绿；dist 已重建。

## 第十六轮：文档大纲点击跳转 + 设置页全部卡片占满（已修，待用户手测）

### ① 文档大纲支持点击定位（feat 5bc0386）

- **改动**：DocsTab 预览容器加 ref；大纲条目（按内容顺序提取 h1-h4）与渲染 DOM 中的
  h1-h4 顺序一一对应，点击第 i 条平滑滚动到第 i 个标题。
- **实测**（route 合成带 6 个标题的 md，零真实读取）：大纲 6 条；点第 4 条后预览滚动
  2099px、目标标题进入可视区；r16-outline-jump.png 目视核对。

### ② 设置页全部卡片占满内容区（feat 30a9b47）

- **改动**：应"所有选项卡片都像数据与备份/关于那样占满"的要求，栅格改单列 flex，
  8 张分组卡等宽占满；移除上一轮的固定 320 卡体（恢复自然高度）；锚点 id 与 testid 不变。
- **实测**：8 张卡宽度全部 1110（容器 1142−内边距）；卡体自然高度
  （templates=130/watch=56/data=409/about=175）；r16-settings-full.png 目视核对。

### 门禁与数据

- typecheck / lint / test 60 条全绿；dist 已重建，verify-build7717 通过。
- 探针全程 route 合成数据，未写库。（探针教训：playwright glob 的 `*` 不跨 `/`，
  `**/api/projects*` 匹配不到 `/api/projects/:id`，子路径要用 `**/api/projects/**`。）

## 第十五轮：编辑器外部修改提示收敛 + 侧栏视图项移除 + 挂载文档多选（已修，待用户手测）

### ① 「文件已在磁盘上被外部修改」只在有未保存改动时出现（fix 2dceb8c）

- **根因**：干净状态下磁盘变化本就由载入 effect 静默整块重载（无内容可丢），但另有一个
  effect 在 `file.mtime !== base.mtime` 时置警告，与静默重载叠加 → 打开/刷新时就弹警告。
- **修法**：删除该干净状态警告 effect。现在警告只在「本地有未保存改动 + 磁盘版本变化」时
  出现（提供 重新加载/忽略）；保存冲突仍由后端 409 → 三选一弹窗兜底（红线 4 不变）。
- **实测**（route 伪造 fs/file 版本，零磁盘写入）：干净刷新 → 内容静默更新 0 警告；
  有未保存圆点时磁盘变化 → 警告出现且改动保留；重新加载 → 警告消失、载入新版本。

### ② 侧栏项目域移除 7 个「我的视图」入口（feat d1d4518）

- 移除：已固定/有未提交改动/缺文档/缺架构图/未分析/30 天没打开/已归档；保留：工作台总览、
  最近打开、集合、项目列表。视图本身保留——工作台总览「需要处理」卡片仍可跳到对应卡片墙。
- **实测**：侧栏 7 项全部消失、保留项与 12 个项目项正常。

### ③ 挂载外部文档支持多选文件（feat 21c4634）

- 弹窗新增「选择文件…」（pick-file 多选 + 即时提示/Alt+Tab 指引/loading）；输入框改多行
  TextArea；确认后按行逐个挂载，成功提示「已挂载 N 个路径」，失败逐条报错不影响其余。
- **实测**（拦截 pick-file 与 mounts，零真实挂载）：选 2 个文件 → 输入框两行 → 恰好 2 个
  POST 路径逐个正确 + 成功提示。

### 门禁与数据

- typecheck / lint / test 60 条全绿；dist 已重建，verify-build7717 通过。
- 数据零残留：探针打字产生的草稿已按 pathKey 删除，inspect-data 复核 drafts=0、trash=0、
  设置全默认、忽略规则无禁用。

## 第十四轮：设置页统一卡片 + 界面去 FR 编号 + 别名与原名同显（已修，待用户手测）

### ① 设置页前五张分组卡统一尺寸 + 移除 FR 编号（feat e96e5cf）

- **改动**：外观/数据源与根目录/集合（工作集）/忽略规则/命令模板五张卡卡体固定 320px
  （内容多的内部滚动），五张完全等大；文件监听与保存/数据与备份/关于保持自然高度。
  sections.ts 标题与设置页两处内联文案去掉 FR-x.x（规格映射移入 sections.ts 头注释，
  代码内仍可对照）。
- **实测**：探针量五卡卡体均 320（watch=88/data=380/about=175 原样）；设置页渲染文本
  0 处 "FR-"；r14-settings.png 目视核对。

### ② 别名与原始名同时展示（feat 083f066）

- **改动**：ProjectCard 起了别名时卡体首行显示「原名 \<diskName\>」；侧栏项目列表两行展示
  （上=别名、下=原名小字等宽）。未起别名不重复显示；标签标题逻辑不变。
- **实测**：route 注入 2 带 1 不带别名的假项目（不写库）——卡片标题含别名+别名 Tag、
  卡体含「原名 proj-0x」；侧栏项两行、无别名项仅原名；r14-alias-card.png 目视核对。

### 门禁与数据

- typecheck / lint / test 60 条全绿；dist 已重建并 verify-build7717 通过（7717 同步）。
- 本轮探针 `verify-round14.mjs` 全程 route 注入假数据，未写库；设置/草稿/忽略规则未动。

## 第十三轮：总览项目卡片分页 + 系统对话框修复 + 设置页卡片栅格（已修，待用户手测）

> 用户三点输入：① 总览要放**导入的项目卡片**（不是导入按钮卡片，初版理解偏了已返工）并做好分页；
> ② 添加项目点「系统对话框选择」不显示、加不了项目；③ 设置页只占页面一小部分、不好看。

### ① 工作台总览新增「项目」卡片栅格 + 分页（feat d6d785e）

- **改动**：KPI 行下新增「项目」区，复用卡片墙同款 `ProjectCard`（打开/固定/重新分析动作一致，
  排序跟随设置 `cardSort`）；纯客户端分页：每页 12 个、`hideOnSinglePage`、列表变短自动回退页码。
- **影响面**：新增 `ProjectCard.tsx`（从 Workbench 原样抽出——Workbench 已引用 Dashboard，
  反向 import 会循环依赖）；`Dashboard.tsx` 加分区；`Workbench.tsx` 仅搬移，卡片墙行为不变。
  服务端零改动。

| 探针断言（verify-round13，route 注入 25 个假项目，不写库） | 实测 |
| --- | --- |
| 每页卡片数 / 分页器 | 12 张 ✓ /「共 25 个项目」1·2·3 三页 ✓ |
| 翻到第 2 页 | 活动页=2，首卡 proj-01→**proj-13**，内容真变化 ✓ |
| 撤掉注入（真实数据 1 个项目） | 1 张卡、分页自动隐藏（hideOnSinglePage）✓ |

### ② 「系统对话框选择…」点了没反应（fix 260b3ac）

- **根因（实测定位，三层都排过）**：不是 PowerShell 慢——对话框 **~300ms 即创建成功**
  （dialog-topmost.mjs 按子进程 PID 抓窗口）；不是策略拦截——WinForms 加载正常。
  真因是**服务进程是后台进程、没有前台激活权限**：Windows 把对话框压在活动窗口（浏览器）
  后面且不闪任务栏，用户看到的就是"没反应"。又实测 TopMost owner、屏幕外 owner+Activate、
  AttachThreadInput 三种 Win32 修法在本机（Win11 26200）**都拿不回前台焦点**——OS 级前台锁。
- **修法（两层）**：服务端 `dialogs.ts` 弹框前创建屏幕外 owner 并 AttachThreadInput 抢前台
  （在允许的场景下带焦点弹出，无效时无害）；前端点击**立即** message.info（含「被挡住请按
  Alt+Tab 查看」指引，5s）+ 按钮 loading + 取消提示「未选择目录」+ 失败提示——体验层兜底
  是本机保证有效的部分。四处调用点（添加项目×2 / 架构图登记 / 设置页添加文档根）统一。
  路由与 `/api/open` 白名单零改动。

| 探针断言 | 修复前 | 修复后（实测，route 拦截延迟 900ms 不真弹窗） |
| --- | --- | --- |
| 点击后 400ms 内有提示 | 无任何反馈 | 「正在弹出系统对话框…」立即出现 ✓ |
| 按钮 loading 态 | 无 | ant-btn-loading ✓，响应后复位 ✓ |
| 用户取消（空路径） | 静默 | 「未选择目录」提示 ✓ |
| 旧命令 vs 新命令（服务端直测） | 对话框出现时前台非对话框（复现） | 对话框照常出现（焦点随 OS 策略） |

### ③ 设置页改为分组卡片栅格（feat 7a298bf）

- **根因**：原实现是 `maxWidth: 860` 的单列 Divider 流，宽窗口下右侧大片留白；原型基线本就是
  响应式卡片栅格 + 页头。
- **改动**：页头（设置 + 说明）+ 8 个分组改 `repeat(auto-fit,minmax(380px,1fr))` 卡片栅格，
  「数据与备份」「关于」占满整行。**全部锚点 id（set-\<key\>）与 testid 原样保留**——侧栏
  点击滚动定位、第十二轮手测点全部不受影响。`sections.ts` / `Sidebar` / 服务端零改动。
- **实测**：8 张分组卡、锚点/testid 零缺失、栅格占满可用宽度（1140 容器下 1110，修复前约
  828）、点侧栏「数据与备份」滚动定位有效；r13-settings.png 目视核对；控制台 0 报错。

### 门禁与验证

- `npm run typecheck` ✅ / `npm run lint`（--max-warnings 0）✅ / `npm test` **60 条** ✅
  （三个提交各自树上均通过；Workbench 按 hunk 拆分提交时对中间树单独跑过 typecheck/lint）
- 探针：`verify-round13.mjs`（①②③ 全量）、`dialog-topmost.mjs`（② 的 Win32 前后对照，
  会短暂在桌面闪对话框，各 ~4s）、`verify-build7717.mjs`（dist 重建后 7717 入口渲染正常）
- dist 已重建，生产入口 127.0.0.1:7717 同步带上本轮修复

### 数据零残留复核（inspect-data.mjs 只读巡检）

- 草稿 0 条 / 回收站 DB 0 条 / 设置全默认（theme=light、density=middle、auto_save=0、
  show_ignored=0、default_project_tab=files、default_arch_dir_name=架构图）/ 忽略规则无被禁用项
- 会话标签 **9 个**（比第十二轮收口时的 12 个少 3 个：是用户手测期间自己关闭的，本轮探针
  只复用既有标签、未新增；分页验证用的是 route 注入的假数据，未写库）；活动标签已还原为
  第一个「工作台」
- `%APPDATA%\ttFolio\trash\` 的 6 个空目录维持原状，仍等用户决定

## 第十二轮：面包屑文件名 + 会话活动标签 + FR-11.6 打开日志（已修，待用户手测）

> 本轮接手自 `HANDOVER.md` 的"未完成 / 待确认"清单。用户明确要求：改动前先定计划与影响面；
> 非必要不开子代理；不跑 e2e（由用户手测）；跑 typecheck / lint / test + 探针实测。

### ① 路径条面包屑不显示当前打开的文件（已修）

- **根因**：`PathBar` 只在 `tab.kind === 'file'` 时补文件名，而项目页打开的文件挂的是
  **项目标签**（`kind === 'project'` + `targetPath`）→ 条件永远不成立，面包屑只到「文件」。
- **修法**：`buildCrumbs()` 只要 `targetPath` 非空就按 `/ \` 拆成多段追加（相对项目根，比只显示
  basename 更可定位）；顺带补上 FR-1.5 要求的「可逐级点击」——「工作台」与「项目名」可点，
  点项目名 = 回到项目概览并清掉 `targetPath`（关闭右侧编辑器）。
- **影响面**：仅 `components/PathBar.tsx`。`openAt` 走 `openTab`（带标签复用规则）所以不会多开
  同名标签；点错层级可用后退还原（历史栈照常压栈）。

| 探针断言 | 修复前 | 修复后（实测） |
| --- | --- | --- |
| 打开 `package.json` 后的面包屑 | `工作台 / bili-hot-radar / 文件` | `工作台 / bili-hot-radar / 文件 / package.json` ✓ |
| 点项目名 | —（不可点） | 回到概览、`editor-pane` 消失、**标签数不变（12）** ✓ |
| 再按后退 | — | 回到该文件，面包屑与编辑器一起还原 ✓ |
| 点「工作台」 | — | 活动标签是「工作台」且**没有被改名成项目名**（12 个标签标题逐一核对）✓ |

### ② 刷新后活动标签从「项目页」变成「工作台」（已查清并修）

- **根因（服务端）**：`sessions` 表**根本没有 active_tab_id 列**，`getSession()` 恒
  `activeTabId: tabs[0]?.id ?? null`。前端 PUT 体里一直带着 activeTabId，服务端**收下即丢**。
  实测：活动标签 `tab-…79UK`（项目页）→ PUT 体 `activeTabId: tab-…79UK` → GET 回来
  `activeTabId: tab-…T9ET1F`（第一个标签「工作台」）→ 刷新后落在工作台。
- **修法**：新增迁移 `0002_session_active_tab.sql`（`ALTER TABLE sessions ADD COLUMN active_tab_id TEXT`，
  只增不改、老库 NULL）+ `sessionRepo` 读写（写入前校验该 id 在本次保存的标签集合里，避免存悬空 id）+
  `store.syncFromServer` 兜底（id 不存在时回落第一个标签，绝不把 `activeTabId` 设成悬空值）。
- **影响面**：DB 迁移（升 version 1→2）+ 会话仓储 + 恢复逻辑。已确认启动自动迁移成功、
  升级前快照已生成（`pre-migration-v1-*.db`）；旧库因为该列为 NULL 仍回落第一个标签，行为不变。

| 断言 | 修复前 | 修复后（实测） |
| --- | --- | --- |
| PUT 体 activeTabId vs 当时活动标签 | 一致 | 一致 ✓ |
| GET 回来的 activeTabId | 恒 = 第一个标签 | = 上次活动标签（`tab-…79UK`）✓ |
| 刷新后活动标签 / 编辑器 | 工作台 / 无 | **项目页 / 仍是 package.json** ✓ |
| 刷新后面包屑 + 后退 | 只剩「工作台」 | 含文件名；后退回到"未打开文件"✓ |

### ③ 顺带修掉回归中新发现的一个"点了没反应"（`FilesTab`）

- **现象**：后退回到"未打开文件"后，再点**同一个文件**没有任何反应（编辑器不再打开），
  必须改点别的文件才能恢复。
- **根因**：antd `Tree` 对已选中节点会"反选"，`onSelect` 收到空数组 → 原实现 `if (typeof key !== 'string') return` 直接吞掉。
- **修法**：反选时读当前 `selectedPath` 作为目标；文件仍照常打开，目录才真正清掉选中高亮。

### ④ FR-11.6「打开日志」按钮（按用户选择补上）

- 新增 `openLogsSchema`（字面量 `{ target: 'logs' }` + `.strict()`）与 `/api/open` 的**独立分支**：
  路径由服务端 `ctx.layout.logDir` 决定，客户端无法指定任意路径；**放在项目白名单分支之前**
  （否则 `target:'logs'` 会掉进 template 分支去要 templateId）。设置页「日志目录」旁加按钮。
- 实测：`page.route` 拦截 → 请求体恰为 `{"target":"logs"}`、成功提示出现；反向校验
  `{target:'explorer', projectId:'nope', path:'../../'}` 仍返回 404「项目不存在」（白名单未放松）。

### 门禁与验证

- `npm run typecheck` ✅ / `npm run lint`（`--max-warnings 0`）✅ / `npm test` **60 条** ✅（新增 5 条：
  会话 activeTabId 往返 / 悬空 id / null / 空标签集合 + 打开日志入参白名单）
- 探针：`verify-round6.mjs`（①②）、`verify-round7.mjs`（面包屑逐级点击）、
  `verify-round8.mjs`（刷新还原 + 未保存关标签拦截 + 草稿清理）、`verify-round9.mjs`（打开日志）、
  `diag-reopen.mjs`（反选诊断）；回归 `verify-round4.mjs`（6 域侧栏/主题/忽略项/跨页签前进后退）全通过
- **按用户要求未跑 e2e**，交给用户手测。

### 数据零残留复核（只读巡检 `.tmp-test/probe/inspect-data.mjs`）

- 草稿表 **0 条**；`settings` 全部为默认值（theme=light / density=middle / auto_save=0 /
  show_ignored=0 / default_project_tab=files / default_arch_dir_name=架构图）；忽略规则**无被禁用项**；
  回收站 DB **0 条**；会话 12 个标签（探针未新增标签）。
- 说明：`%APPDATA%\ttFolio\trash\` 下有 6 个**空目录**（DB 行数为 0，界面显示 0 条），
  时间戳为上一轮会话，非本轮产生；本轮未动。

## 🔻 上一轮会话收口（交接入口：`HANDOVER.md`）

- 上一轮最新提交：`54c9b54`；本轮在其上追加三个提交（`fix(web,server): 面包屑补当前文件名、会话记住活动标签` →
  `feat(web,server): 补 FR-11.6「打开日志」按钮` → `docs(handover): 收口第十二轮台账`，用 `git log --oneline` 看当前值）
- 已修且已实测：用户报障 4 类（设置域空 / 设置功能不可用含导出 401 / 界面观感与原型对齐 /
  文件夹 EISDIR / 前进后退刷新 / 主题 / 实时生效）+ 自查发现的草稿恢复、标签爆炸等回归
- 当时未完成：① 面包屑（**本轮已修**）② 刷新后活动标签（**本轮已查清并修**）
  ③ FR-11.6「打开日志」（**本轮已补**）④ 原型剩余中低优先级观感差异 ⑤ KNOWN-GAPS 7 项
- 环境陷阱：编辑工具 ReplaceFile 落盘对读方非原子 → Vite 可能缓存**半截模块**（表现为"代码改了不生效"）
  → **重启 dev server**（判断脚本见 `HANDOVER.md` 第 6 节）
- 重启服务：`cd D:\<工作区>\code\ttfolio; npm run dev`（开发入口 http://localhost:5173）

## 当前阶段：第十二轮修复已交付，等待用户手测（本轮不跑 e2e，由用户手测）

## 第十一轮补充 4：前进/后退跨页签 + 6 域侧栏 + 跟随系统主题 + 忽略项跨页实时生效

| 检查项 | 修复前 | 修复后（实测） |
| --- | --- | --- |
| 项目内页签的前进/后退 | files → Git → **后退仍停在 Git**（错位） | files → Git → 后退 → **files** → 前进 → **Git** ✓ |
| 6 个域的左侧栏内容 | 只验过「项目」「设置」 | 项目 10 / Git 2 / 架构图 1 / 文档 1 / 搜索 2 / 设置 8，**无空侧栏** ✓ |
| 主题「跟随系统」 | 未验 | 系统深色 → `data-tt-dark=1`；系统浅色 → `0`（随系统实时切换）✓ |
| 忽略项开关的跨页实时生效 | 未验 | 切换后立即写库，并触发带 `showIgnored=1` 的树请求；树节点 20 → 23，**无需刷新** ✓ |

前进/后退的根因：`updateActiveLocation` 用 `tabKey`（标签标识，项目标签刻意不含 subTab/targetPath）
判断"导航是否变化" → 换页签被当成没变化、不压历史栈。已新增 `sameLocation()` 比较**完整位置**。

**环境陷阱（本轮排查耗时最多，务必记下）**：编辑工具以 ReplaceFile 方式落盘，而 ReplaceFile 对读方
**不是原子的** —— Vite 在改名瞬间读到**半截文件**（函数声明在文件末尾）并缓存转换结果，于是浏览器
拿到"有调用、没有声明"的模块，报 `sameLocation is not defined`，行为表现得像"代码改了不生效"。
**处置：重启 dev server**（本次已重启并核对送出内容完整）。同类现象此前也出现过（设置页缺新 testid）。

## 第十一轮补充 3：把设置页每个控件过一遍（"里面功能不能用"的系统排查）

不再抽查，而是逐控件核对"是否显示服务端值 / 是否能写回服务端"，查出两处确凿不可用：

| 控件 | 问题 | 实测证据 | 修复 |
| --- | --- | --- | --- |
| 导出 JSON / CSV | 必然 401：`window.open('/api/export/...')` **带不了 x-ttfolio-token 头**，而 query token 只对 SSE 放行 | 不带 token → 401；`?token=` → 401；带请求头 → 200 | 新增 `lib/api.ts: downloadWithToken()`（带 token 取内容 → blob → 本地保存，文件名取 content-disposition）；**不动服务端鉴权闸门**以免扩大安全面 | 
| 默认架构图目录名 | 显示与保存都不对：`defaultValue` 只在挂载时读一次（设置是异步到达的），且仅 onPressEnter 保存，失焦即丢 | 外部改服务端值 + 刷新后输入框仍显示占位值 | 抽成受控组件 `ArchDirInput`，跟服务端值同步，onBlur / Enter 均提交 |

实测通过：导出 JSON → `ttfolio-projects.json`（1439 字节）；导出 CSV → `ttfolio-projects.csv`（244 字节，BOM+中文表头）；
架构图目录名外部改值刷新后显示新值（`架构图-external`），键入+失焦写回（`架构图-typed`），已复原为 `架构图`。

顺带确认：`Input` 与 `Switch`/`InputNumber` 一样不透传 `data-testid`（故用 span 承载）；
用户内容端口（7817）接受 query token，所以文档图片与架构图 iframe 正常（主端口的 `/raw` 只认请求头，但代码统一走内容端口）。

## 第十一轮补充 2：与静态原型逐项对齐 + 自动保存实测（含我自己踩的 3 个坑）

### 对齐《ttFolio界面原型-AntD.html》（把"界面不一样"变成可测量）
在 1440×900 下实测原型再量实现，逐项对齐：

| 项 | 原型 | 修复前 | 现在 |
| --- | --- | --- | --- |
| 顶栏 / 路径条 / 主体 / 状态栏 高 | 56 / 40 / 776 / 28 | 47 / 37 / 790 / 26 | 56 / 40 / 776 / 28 |
| 域条宽 / 项尺寸 | 56 / 40×40 | 45 / 36×36 | 56 / 40×40 |
| 侧栏 / 右栏 默认宽 | 232 / 320 | 220 / 280 | 232 / 320 |
| 正文基准字号 | 14px | body 16px（自绘文字比控件大一号） | 14px |

状态栏条目也对齐原型：本地模式·仅 127.0.0.1 / 索引库 / 项目数 / **最近分析** / **文件监听 开·关**
（为此 `/api/health` 新增 `lastAnalyzeAt`）。

### 自动保存（FR-11.2）实测通过
此前只是"接线完成"，本轮实测：打开开关 → UI true 且**服务端 autoSave=true** → 输入 → 未保存圆点亮 →
停止输入 2s 后自动落盘（1 次 `PUT /api/fs/file` 200，磁盘内容 = 输入内容）→ 圆点熄灭 → 开关复原为关。

### 我自己踩的 3 个坑（都造成过对用户数据的副作用，已全部复原）
1. **探针用 `.ant-switch` 下标定位"自动保存"，实际点到第 2 条忽略规则 `*.keystore`**（设置页前面有 51 条
   忽略规则的开关）。第一次探针失败时在清理前就抛异常 → 该规则被留成禁用。已 PATCH 复原为启用，
   并核对"全部内置规则均已启用"。**修法：给设置控件补 testid**（`set-theme/set-density/set-default-tab/
   set-watch/set-watch-stability/set-autosave`；AntD 的 Switch/InputNumber 不透传 data-testid，故用 span 承载）。
2. 探针在用户项目里建过临时文件（`autosave-probe.tmp/.md`、`autosave-diag.md`）→ 全部走"移入回收站 + 彻底删除"清理，
   回收站现为 0、项目目录无残留。
3. 探针给这些临时路径留下了草稿（其中一条在文件删除后成了孤儿草稿）→ 已按 pathKey 逐条删除。
   另：上一条里"磁盘内容断言失败"其实是**残留草稿污染**（打开文件时先恢复了旧草稿，自动保存写的是旧内容），
   不是功能缺陷——加预清理后断言通过。

## 第十一轮补充：交付前自查又抓到 4 个问题（全部已修，附运行时证据）

用户在报障里明确"代码改一处可能牵连全局"，因此交付前对**上一轮的修复本身**做了运行时验证，结果抓到 4 个问题：

| # | 问题（含来源） | 根因 | 运行时证据 |
| --- | --- | --- | --- |
| 1 | 点「刷新」会不会丢未保存内容（上轮修复的**验证缺口**） | 上轮只做了代码推理，没有实测 | 实测：输入后缓冲 320 字符含标记 + 未保存圆点 → 点刷新 → 仍 320 字符含标记、圆点仍亮 ✓ 不丢 |
| 2 | **后退→前进回来，未保存内容在编辑器里消失**（我上轮修复引入） | 载入 effect 用 `draftReady = draft !== undefined` 判断"草稿是否就绪"，而组件重新挂载时 `draft` 先是**缓存的旧值（常见 null）**，于是第一轮就把 `draftApplied` 标 true，真正取回草稿的那轮被 early-return 跳过 | 网络监听证实：前进时 `GET /api/drafts` 确实返回了含标记的草稿，但编辑器停在磁盘内容且圆点熄灭；改用 `isFetchedAfterMount` 判定后 → `markAfterForward=true`、dirty=1 ✓ |
| 3 | 草稿查询被 15s `staleTime` 缓存住 → 重新挂载不重取 | 全局 `staleTime: 15000` 对"草稿"这种时效性强的数据不适用 | 该查询改为 `staleTime: 0 + refetchOnMount: 'always'`；整页刷新后草稿恢复（内容+圆点+提示）实测通过 ✓ |
| 4 | **同名项目标签滚出 21 个**（我上轮修复引入） | 上轮让文件页把 `targetPath` 写进项目标签，而 `tabKey` 把 `targetPath` 算进标签标识 → 打开过文件后再点项目卡就变成新标签 | `tabKey` 对 `kind='project'` 只按 `kind+projectId` 标识（`file`/`git` 等"一个路径一个标签"的 kind 保留 targetPath）→ 实测重开项目标签数不增、编辑器复位 ✓ |

另：已用 UI 关闭按钮清理探针在用户会话里留下的重复标签（34 → 12，同名重复 0）。

## 第十一轮：用户报障 4 类（复现 → 根因 → 修复 → 实测证据）

| # | 用户报障（原话） | 根因 | 修复 | 实测证据 |
| --- | --- | --- | --- | --- |
| 1 | 「左侧设置里面是空的，啥都没有」 | `Sidebar` 没有 settings 分支 → `domain=settings` 时 items 恒为空 | 设置章节抽到 `features/settings/sections.ts` 单一来源，侧栏 8 个分组可点并滚动定位；域条点「设置」会自动激活/打开设置页 | 侧栏菜单项 **0 → 8**，点「数据与备份」滚到 `#set-data`（top 464，视口内） |
| 1 | 「右上设置能打开但功能不能用」 | `setSetting` 只 PATCH、不更新 react-query 缓存 → 受控控件读旧值，改完立刻弹回；另有 4 个设置键（`auto_save`/`card_sort`/`show_ignored`/`default_project_tab`）**无任何消费方** | 改乐观写缓存 + 立即生效 + 成功后按需失效 / 失败回滚提示；4 个死键接到 EditorPane 自动保存、Workbench 排序默认值、FilesTab 忽略项、打开项目落点 | 开关点击后不回弹且刷新后保持；密度 32→24→40→32 即时生效 |
| 1 | 「界面 UI 显示不正确」 | 实测 `html/body/#root/.ant-app` 背景全为 `rgba(0,0,0,0)`：应用没有底色，深色下"面板深、底白"；标签条 1429px 内容挤在 676px 容器且 `overflow-x:hidden`，右侧标签静默消失 | tokens 引入 CSS 变量 + 深浅两套值（`SEMANTIC` 改指 `var(--tt-*)`，15 个引用点零改动），根元素切 `data-tt-dark`；标签条改横向滚动 + 激活标签滚入视野 | 浅色 `rgb(245,245,245)` ↔ 深色 `rgb(20,20,20)`；文字 `rgba(255,255,255,.85)` |
| 3 | 「设置里更改主题有 bug」 | 除上述缓存问题外，主题 effect 让 localStorage **永久压过**服务端值 → 改主题永远无效 | 服务端值为准，localStorage 仅首帧兜底（TT-THEME-CACHE）；`system` 挂 matchMedia；首帧脚本兼容跟随系统 | 深/浅切换无需刷新即生效、分段控件不回弹、可切回、刷新后保持 |
| 2 | 「点开项目文件夹提示文件系统错误：EISDIR」 | `onSelect` 只用 `!key.endsWith('/')` 判目录，而目录 key 是 `n.path`（不以 `/` 结尾）→ 目录被送进编辑器读文件；同时懒加载子节点只写 react-query 缓存、**从未回写 treeData**，rc-tree 拿不到 children | 按节点 kind 分流（目录只选中并作为"新建"落点）；`loadChildren` 合并子节点进 treeData；后端把目录读写映射为 `IS_DIRECTORY`（400）纵深防御 | 点目录**零次** `/api/fs/file` 调用、不进编辑器、无报错；展开后节点 1→22；后端直连目录 → `400 {"code":"IS_DIRECTORY"}` |
| 2 | 「左上角前进/后退/刷新有问题」 | `openFile` 是死代码（`void openFile;`）→ 选文件从不写历史；`syncFromServer` 恢复会话时把 history 置空、index 置 -1（FR-1.3 未实现）；「刷新」`invalidateQueries()` 会让编辑器 `setValue(磁盘内容)` 并 `setDirty(false)`，**静默冲掉未保存内容** | 编辑器打开哪个文件由标签 `targetPath` 驱动；选中文件即写历史；服务端历史一并恢复；无历史时按钮置灰。EditorPane 改为按"版本标识 + 草稿是否已处理"守卫，有未保存改动只提示不覆盖 | 打开 `.env` 后前进/后退可用、后退回到未打开状态；草稿恢复后保留未保存圆点 |

（连带修复：新建文件/文件夹原先恒落项目根 → 现在按选中目录决定；侧栏「最近打开/已固定」标签标题曾显示字面量 `recent`/`pinned`；vite dev 增加 `watch.ignored`——原子写工具的临时目录会让 Vite watcher 抛 EBUSY 并整进程退出，本轮实测打挂过一次 dev 服务。）

## 已完成（每行：FR 编号 | 一句话 | 实现文件 | 验证方式）

（随实现逐条更新）

## 第十轮：用户报障 4 项（复现 → 根因 → 修复 → 证据）

| # | 用户报障（原话） | 根因 | 修复 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | 「进入 ui 下面那个什么框占的内容太多了，界面不好看」 | AntD `<App>` 容器没有高度，应用只占视口 596/900px，内容被压缩后底部留白 | `settings.tsx` 给 `<App>` 加 `height:100%`；各页 flex 链补 `minHeight:0` | 探针量测 app 高度 900/900，工作台/项目页无溢出 |
| 2 | 「页面做的太僵硬了，好多东西的窗口大小没办法拖动」 | 侧栏/文件树/Git 变更列表/文档列表/右栏全部为固定宽度，无双栏拖拽 | 新增 `PaneSplit.tsx`（AntD `Splitter` 封装）+ `usePaneSize`（尺寸持久化） | 拖拽实测：侧栏 220→320→420、文件树 300→390、右栏 286→539；重载后持久化 `{"sidebarWidth":420,"detailWidth":537}` |
| 3 | 「有的文件夹项目导入后根本点不开」 | 四类根因：登记与打开校验不对称（保留名/UNC 被拒但未提示）、junction 被当普通文件、文件树懒加载错误被吞、无空态；另所有业务错误 HTTP 200 且闸门字段泄漏 | `pathGuard.validateRegistrableRoot` 给出可操作提示、`fsx.listEntries` 识别符号链接/junction、`FilesTab` 错误提示 + `failedPaths` 标红 + 空态、`app.ts` preSerialization 把闸门字段映射为真实 HTTP 状态并剥离 | 服务端 16 条断言 + 前端 4 态 + 单测 7 条（总 27）全过；软删除行可复活重新登记，不再 UNIQUE 冲突 |
| 4 | 「界面跟你给的静态页面不太一样」 | 实现与《界面原型-AntD.html》在信息架构与观感上有差距：缺工作台总览屏、缺项目页五页签、搜索为普通输入框、裸色值散落 | 新增 `Dashboard.tsx`（6 KPI + 最近打开 + 需要处理 + 跨项目清单）、项目页五页签、搜索 pill（300px/等价 Ctrl+K）、`SEMANTIC` 令牌扩展并去硬编码（15 个文件） | 探针：搜索 pill 300px、导入弹窗可开、6 个 KPI、5 个页签可点、app 高度 900/900、控制台 0 报错 |

遗留（未做，均中低优先级）：卡片悬浮快捷操作、右键仅"…"图标可用、状态栏缺"最近分析/文件监听"、正文 16px 与透明底未令牌化。

## 进行中

（无。第十轮已收口：verify 全绿、修复已提交 `40f1768`。）

## 下一步（3 条以内）

1. 按《界面原型-AntD.html》补齐上表"遗留"4 项观感差异（中低优先级，需用户确认是否要做）
2. 主人自测：真实项目登记 → 五页签 → Git 提交 → 回收站往返
3. 视需要把 PaneSplit 的宽度上限/最小值暴露到设置页（当前为固定 160–420 / 220–560）

## 阻塞与已知缺口（同步 KNOWN-GAPS.md）

- KNOWN-GAPS.md 记录 7 项体验打折项（均有最小可用实现）；范围外能力只留扩展位，不算缺口

## 最近一次 verify 结果（时间 + 通过/失败项）

- 2026-09-22 13:5x —— npm run verify：通过 6 / 失败 0 / 跳过 0
  - typecheck PASS(5.6s) / lint PASS(2.4s) / vitest PASS(2.8s) / build PASS(10.4s) / e2e 4 条 PASS(27.3s) / 机械检查 11 条 0 命中 PASS
  - e2e 明细：main-flow 7.0s ・ session-recovery 草稿 7.2s ・ 会话恢复 5.6s ・ trash-restore 4.1s
  - 说明：`npm run test:e2e` 现在会先自动构建（pretest:e2e），避免测到旧 dist
- 2026-09-22 02:45 —— npm run verify：通过 6 / 失败 0
  - typecheck PASS(4.1s) / lint PASS(1.7s) / vitest 48 条 PASS(2.0s) / build PASS(7.9s) / e2e 4 条 PASS(25.2s) / 机械检查 11 条 0 命中 PASS

## 最近提交（git log --oneline -10 的输出）

```
e9db591 docs(progress): 补齐第十轮修复台账、决策与变更记录
40f1768 fix(web): 总览屏补添加项目入口与登记后跳转；e2e 强制先构建
baced7f feat(web): 对齐 AntD 原型（搜索 pill / 项目页五页签 / 工作台 KPI 看板）+ 裸色值令牌化
b70e273 fix(server,web): 修复"导入后点不开"的 4 类根因 + 错误响应契约 + 移除登记后无法重新登记
546fa78 feat(web): 可拖拽分栏（侧栏 / 文件树 / Git 变更列表 / 文档列表 / 右栏详情）
7532f6d fix(web): 修复设置项从未被服务端拉取（initialData + staleTime 跳过首次请求）
4daab8e test(e2e): Playwright 四条主流程全绿；关闭 antd 按钮两字自动空格
ddf954d chore(repo): 强化 .gitignore——分组注释明确上传边界
6342e36 fix(git): 修正 porcelain=v2 解析——XY 为单字段、2 行路径索引为 9
d62f488 fix(web): 修复 URL 构造缺 origin、无 body POST 的 Content-Type 与 token 注入占位符
e2442af feat(web): 实现完整前端——应用壳/标签会话/工作台/项目页五页签/回收站/设置/命令面板
```

## 已打标签（git tag -n 的输出）

```
v0.1.0-p0  P0 地基：工程化脚手架、质量门禁 verify.mjs、进度台账
v0.2.0-p1  P1 看家能力：完整后端（PathGuard/原子写/回收站/Git/分析器/内容索引/SSE）
v0.3.0-p2  P2 档案与检索：完整前端（工作台/五页签/回收站/设置/命令面板）
v1.0.0     全量 FR 实现 + verify 全绿 + e2e 四条主流程
```

---

# 功能清单（第十三节全文，完成一条勾一条）

【P0 地基】
- [x] FR-1.1 索引库初始化（首次启动自动建库跑迁移，不要求注册/联网）
- [x] FR-1.2 浏览器式标签（新开/复用/关闭/固定/拖动排序，关闭前提示未保存）
- [x] FR-1.3 前进后退（标签内路径历史栈，恢复页签与滚动位置）
- [x] FR-1.4 会话恢复（重启恢复标签集合；失效路径标红并可重新定位）
- [x] FR-1.5 路径条与面包屑
- [x] FR-1.6 状态栏（索引库路径与体积、项目数、最近分析、长任务进度、实时连接）
- [x] FR-2.1 添加项目（系统对话框 / 粘贴路径（多行、引号、\\?\ 前缀）/ 父目录批量登记 / 拖拽）
- [x] FR-2.2 拖拽降级（浏览器拿不到绝对路径 → 同名定位 + 用户确认 + 推荐用对话框）
- [x] FR-2.3 别名（只写库，卡片显示别名标记，可查看真实目录名）
- [x] FR-2.5 移除项目（“仅移除登记”与“移除并删除文件”两个操作，文案与颜色区分）
- [x] FR-2.6 项目属性（别名、类型可覆盖、标签、集合、备注、固定、归档）
- [x] FR-2.8 最近打开（记录时间与次数，可切换按最近提交排序）
- [x] FR-2.9 路径失效检测与重新定位
- [x] FR-2.10 项目右键菜单（按状态禁用不可用项）
- [x] FR-11.1 数据源与根目录设置（批量移除登记、文档根、默认架构图目录名、忽略规则、重建索引）

【P1 看家能力】
- [x] FR-3.1 分析触发（添加时自动一次 + 手动/批量重新分析；不做后台常驻扫描）
- [x] FR-3.2 语言占比（按字节，top8 + Other）
- [x] FR-3.3 类型识别（可被手动覆盖）
- [x] FR-3.4 技术栈标签（限制数量与长度）
- [x] FR-3.5 Git 摘要（分支/脏/未跟踪/最近提交；只读命令）
- [x] FR-3.6 文档与架构图存在性探测
- [x] FR-3.7 忽略规则（内置默认 + 可增删，hide/analyze_only 两种模式）
- [x] FR-3.8 分析失败与降级（部分成功 + 原因 + 重试）
- [x] FR-3.9 分析结果可见性（时间、文件数、体积、耗时）
- [x] FR-4.1 文件树（懒加载 + 忽略项开关 + Git 状态标记）
- [x] FR-4.2 打开文件（文本/图片/PDF/二进制与超大文件分流降级）
- [x] FR-4.3 编辑与保存（未保存圆点、Ctrl+S、mtime+size+hash 冲突三选一、保持编码与换行、默认不做自动保存）
- [x] FR-4.4 草稿保护（崩溃/刷新恢复，切标签/关窗口提示）
- [x] FR-4.8 外部修改检测（Watcher 命中已打开文件 → 提示重新加载/对比/忽略）
- [x] FR-5.1 Git 状态（分支、上游提示、未暂存/已暂存/未跟踪/冲突分组）
- [x] FR-5.2 单文件 diff（unified + 行级高亮、二进制提示、大 diff 截断）
- [x] FR-5.3 暂存/取消暂存/放弃改动（放弃为 L3，二次确认）
- [x] FR-5.4 提交（多行信息、经 stdin、显示结果、绝不自动 push）
- [x] FR-5.5 提交历史与某次提交的 diff（只读）
- [x] FR-5.6 分支列表/切换/新建（脏工作区先警告）
- [x] FR-5.7 Git 降级（无 git / 非仓库 / merge 中 / 超大仓库）
- [x] FR-5.8 Git 安全边界（无 push/pull/远程/凭据，身份用全局 config）
- [x] FR-11.2 文件监听开关与参数

【P2 档案与检索】
- [x] FR-4.5 新建文件/文件夹（校验非法字符与保留名）
- [x] FR-4.6 重命名/删除（文件改名 L2、目录改名 L3、删除进回收站 + 二次确认）
- [x] FR-4.7 移动/复制（跨盘 = 复制+校验+删源，进度与取消，冲突询问）
- [x] FR-4.9 回收站（列表/预览/恢复/彻底删除/清空，保留策略）
- [x] FR-4.10 项目内文件名搜索（大小写、全字匹配开关）
- [x] FR-4.11 我的视图（有未提交改动/缺文档/缺架构图/未分析/30天没打开/已归档 + 自定义筛选）
- [x] FR-6.1 项目内文档（README/docs/设计文档/根下 md，可阅读可编辑）
- [x] FR-6.2 全局文档根 + 一层子目录名模糊匹配（自动匹配/待确认/未匹配，可解绑并进黑名单）
- [x] FR-6.3 手动挂载任意文件夹或单文件
- [x] FR-6.4 文档阅读（Markdown 渲染、大纲、原文切换、相对图片经代理显示）
- [x] FR-6.5 文档编辑（与文件同一套冲突与草稿规则）
- [x] FR-6.6 文档纳入全局搜索 + 项目内文档搜索
- [x] FR-6.7 匹配去重与多项目引用标注
- [x] FR-6.8 挂载路径失效处理（标灰 + 重新定位 + 解绑）
- [x] FR-7.1 架构图目录登记（默认项目内“架构图/”，可多个、可任意位置）
- [x] FR-7.2 入口识别（手动指定 → index.html → 全部 html 图集列表；可设默认入口）
- [x] FR-7.3 内嵌查看（独立端口静态代理、只读、新窗口/全屏/复制路径）
- [x] FR-7.4 图集元数据（入口、文件数、大小、最后修改、来源、上次查看时间）
- [x] FR-7.5 旁挂 .architecture.json 标注为源文件并可只读查看
- [x] FR-7.6 缺失引导（说明由外部工具生成、提供登记入口、绝不自动调 AI）
- [x] FR-7.7 变更提示（文件数或入口 mtime 变化 → “架构图已更新”）
- [x] FR-7.8 只读约束（不修改、不写入任何文件，含不落盘临时页）
- [x] FR-8.1 命令面板（Ctrl+K，输入即搜，方向键+回车执行，含命令项）
- [x] FR-8.2 三档结果（项目 / 文件名 / 文件内容，可分别折叠）
- [x] FR-8.3 内容索引（按需构建、按项目缓存、增量、进度可取消、白名单与大小上限）
- [x] FR-8.4 作用域与过滤（全部/当前项目/指定项目/文档库 + 过滤语法）
- [x] FR-8.5 空结果引导（未索引项目给“建立索引”的下一步）

【P3 打磨与扩展位】
- [x] FR-2.4 磁盘改名（藏在“更多 → 高级”，L3，打字确认 + 审计 + 自动重新分析）
- [x] FR-2.7 集合（工作集）管理与成员
- [x] FR-5.9 跨项目 Git 总览
- [x] FR-9.1 轻量清单（新增/勾选/分类/排序/删除/完成项折叠）
- [x] FR-9.2 不做协作（无分配/流程/审批/甘特/报表/通知）
- [x] FR-9.3 跨项目清单汇总（工作台总览）
- [x] FR-9.4 清单预留 actor/source 字段（当前只写 human）
- [x] FR-10.1 系统内打开为默认动作
- [x] FR-10.2 外部打开（资源管理器 / 在此打开终端 / 用模板打开），执行前确认
- [x] FR-10.3 命令模板（可执行文件 + 参数数组 + 占位符 {path}/{file}/{project}/{paths}，shell:false，禁止任意 shell 输入框）
- [x] FR-10.4 复制路径（项目/文件/相对路径/暂存相对路径）
- [x] FR-10.5 打开方式可扩展（加模板即可接新 IDE，不硬编码）
- [x] FR-11.3 外观（AntD 浅色默认 / 深色 / 跟随系统 + 密度三档 + 卡片列数自适应）
- [x] FR-11.4 快捷键表与可修改
- [x] FR-11.5 数据与备份（显示路径与体积、立即备份、从备份恢复、导出 CSV/JSON、清空索引库并说明不删项目文件）
- [x] FR-11.6 关于（版本、端口、模式、日志目录、打开日志）
- [x] FR-12.1 Agent 交接（导出《项目上下文契约》文件 + 复制上下文包）
- [x] FR-12.2 内嵌终端：只留布局槽位与模块目录，不实现
- [x] FR-12.3 工作集多根打开：只留集合成员与 {paths} 占位符，不实现
- [x] FR-12.4 多用户：只留 owner_id/actor 字段与“当前 actor”注入点，不做登录权限
- [x] FR-12.5 多工作区：连接层留“按工作区切换数据库”的抽象，不做界面
- [x] FR-12.6 目录自动扫描：只留配置字段与扫描器接口签名，不实现
- [x] FR-12.7 架构图生成：不实现，只在界面上说明由外部工具生成

## 七大验收红线自查

| # | 红线 | 结论 | 验证方式 |
| --- | --- | --- | --- |
| 1 | 文件接口读写不出白名单 | ✅ | pathGuard.test.ts 越界集（../、绝对路径、符号链接、UNC、ADS、保留名）全过；冒烟 `..\..\package.json` → 400 PATH_OUT_OF_SCOPE |
| 2 | 非用户操作登记目录零改动 | ✅ | integration.test.ts：浏览/建索引/查询前后文件哈希清单完全一致 |
| 3 | 删除可从回收站恢复且一致 | ✅ | 集成：movePath 往返内容一致；e2e trash-restore：删除→回收站→恢复→磁盘字节一致 |
| 4 | 强杀后草稿仍在；冲突由用户选 | ✅ | e2e session-recovery：编辑→草稿落库→刷新→DRAFT-99 恢复；冒烟：错误基线保存 → 409 MTIME_CONFLICT 附磁盘版本，绝不静默覆盖 |
| 5 | 分析/查看不改仓库状态；提交只含暂存 | ✅ | integration：git status --porcelain=v2 前后一致；e2e main-flow：git show --name-only HEAD 仅 notes.md |
| 6 | 断网全功能可用 | ✅ | 机械检查 M4（CDN/在线字体）0 命中；依赖全部本地打包；服务仅监听 127.0.0.1 |
| 7 | 删库重建卡片数据等价 | ✅ | 迁移幂等测试 + 分析幂等测试（两次分析除时间字段全等）；冒烟环境即从空库重建全流程 |
