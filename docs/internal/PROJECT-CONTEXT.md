# PROJECT-CONTEXT（ttFolio 项目上下文契约）

> 本文件是给**任何新 AI 对话 / 新工程师**的交接开场白：复制全文粘贴即可接手项目。
> 生成：2026-09-22，对应提交 63eee24 / 标签 v1.0.0。

---

## 你的角色

你是接手 **ttFolio（tt项目仓库）** 的资深全栈工程师。这是一个已完成 v1.0.0、verify 全绿的可运行项目，你的任务是在此基础上继续开发。动手前必须先读完本契约与第二节点名的文件，遵守全部硬约束。

## 一、这是什么项目（一句话）

**本地项目工作台**：把硬盘上散落的项目文件夹登记成"项目卡片"，在一处浏览、打开、看源码、管 Git、看架构图、找文档。**磁盘是真相，数据库只是索引**——除用户显式操作外，被登记目录零改动。

- 代码仓库：`D:\<工作区>\code\ttfolio\`（npm workspaces：packages/shared、server、web）
- 规格文档（权威，冲突时以约束文档为准）：`D:\<工作区>\设计文档\ttFolio设计文档\` 下的 4 个文件（设计文档 88 条 FR / 开发约束 C-01~C-62 / 开发规范 / AntD 界面原型）
- 仓库内文档：`README.md`（怎么跑）、`DELIVERY-REPORT.md`（v1.0.0 交付全貌）、`docs/adr/`（3 篇关键决策）、`DECISIONS.md`（历史决策台账）、`KNOWN-GAPS.md`（7 条打折项，**别当 bug 修**）、`PROGRESS.md`（FR 台账）

## 二、动手前先读（按此顺序）

1. `D:\<工作区>\code\ttfolio\README.md` —— 架构、命令、数据目录
2. `DELIVERY-REPORT.md` —— 全部设计要点与红线自查的真实验证方式
3. `docs/adr/0001..0003` —— PathGuard / 保存冲突 / AntD token 三大决策的背景与后果
4. `DECISIONS.md` + `KNOWN-GAPS.md` —— 什么是有意为之、什么是已知缺口
5. 改哪个模块前，读该目录下源码（约 12.7k 行，结构清晰）

## 三、技术栈（锁定，不许换）

TypeScript strict（+noUncheckedIndexedAccess+exactOptionalPropertyTypes，禁 any/@ts-ignore/非空断言）· Node ≥22 实际跑 24 · Fastify 5 · better-sqlite3（WAL 单写者）· chokidar · pino · React 18 + Vite 5 · Ant Design 5（ConfigProvider token，默认浅色）· CodeMirror 6（@uiw/react-codemirror 封装）· TanStack Query + Zustand · Vitest + Playwright · zod v3（shared，前后端共用）· iconv-lite（GBK）· 运行时用 tsx 直跑 TS 源（`npm start` = `tsx packages/server/src/index.ts`，server 的 build 仅 noEmit 类型检查，前端产物才是 vite dist）。

## 四、架构与代码边界（EN-7..EN-10，越界即违规）

```
shared(src/index.ts 导出 errors/constants/types/schemas)
  ↑ 依赖方向单向：web→shared、server→shared，shared 不依赖任何包（以源码形式被消费）
server/src/
  core/   pathGuard(唯一路径关口) fsx(原子写/编码) git trash backup search watcher tasks sse
          dialogs openExternal exec(唯一 spawn 点) ignore analyzer/ ulid errors logger actor scanner(预留)
  db/     index(LibraryStore 单写连接) migrate(user_version+VACUUM INTO 快照, 只增不改)
          repo/*(全部 SQL 收敛于此) sql.ts(better-sqlite3 严格泛型的集中断言层——新查询一律走它)
  routes/ 统一 {ok,data}|{ok:false,error:{code,message,detail?}} 信封；错误码必须取 shared/errors.ts 枚举
  static/ userContent.ts 用户内容独立端口(应用+100)只读代理
web/src/  app/(壳/设置/SSE/store) components/ features/(workbench project files git archives docs
          search trash settings todos) theme/(唯一 hex 色值处) lib/(api/actions/format)
```

## 五、硬约束红线（违反任何一条=事故，全文见约束文档 C-01~C-62）

1. **磁盘是真相**：分析/浏览/搜索零写盘；写用户文件必须"同目录临时文件+fsync+rename"原子替换
2. **PathGuard 唯一关口**：resolve → 拒绝保留名/ADS/UNC/尾随点空格 → realpath → `path.relative` 判包含；**全 server 禁 `.startsWith(`**（含字符串前缀判断一律 `indexOf===0` 或 path.relative，ESLint+verify 机械检查双重拦截）；白名单=项目目录+该项目挂载+该项目架构图目录
3. **删除必进回收站**（trash/<ulid>/ + 库记原路径）；L3 操作二次确认(confirm 字段，缺则 400 CONFIRM_REQUIRED)+审计日志 activity_log；"改别名(L1)"与"改磁盘名(L3)"是两个入口
4. **永不丢字**：保存前 mtime+size+sha256 三元组校验，不一致 409 MTIME_CONFLICT 三选一，绝不静默覆盖；草稿 1s 防抖落 editor_drafts；编码(UTF-8/BOM/UTF-16/GBK)与换行(CRLF/LF)原样保持
5. **不出网**：仅监听 127.0.0.1，/api/* 校验 token(X-TTFOLIO-TOKEN 头/页面注入 window.__TTFOLIO_TOKEN__)+Host；用户内容(架构图 HTML/图片)走独立端口 + iframe sandbox；敏感文件(.env*/.pem/.key/id_rsa* 等)不进内容索引但**不从文件树隐藏**
6. **SSE 精确失效**（禁轮询整表）；长任务异步+进度+可取消+部分成功有状态（tasks.ts）
7. **Git 只做本地**：porcelain=v2 -z 解析、commit -F - 经 stdin、绝不 push/pull/fetch、无凭据；core/git.ts 内连这些字样都被机械检查禁止（数组追加用 appendEntry 而非 .push(）
8. **范围外不做**：多用户/自动扫描/生成架构图/IDE 能力/任务协作/云同步——只维护预留位（core/terminal/、core/scanner.ts、owner_id/actor 字段），不要"顺手实现"
9. **界面**：AntD token 单源（hex 只许出现在 web/src/theme/ 内，组件取色用 SEMANTIC 常量；AntD 按钮两字自动空格已关 button.autoInsertSpace=false）；默认浅色；每个数据区三态；写操作乐观更新+失败回滚
10. **web 禁 localStorage 存业务数据**（唯一例外：主题首帧缓存，代码带 TT-THEME-CACHE 注释）；src 内禁 console.*（server 用 pino，CLI 用 process.stdout.write）

## 六、当前状态（2026-09-22，v1.0.0）

- 88/88 FR 完成（7 条最小可用实现见 KNOWN-GAPS）；verify 6/6 全绿：typecheck / lint / vitest 48 条 / build / e2e 4 条 / 机械检查 11 条 0 命中
- Git：main 分支，Conventional Commits，标签 v0.1.0-p0 / v0.2.0-p1 / v0.3.0-p2 / v1.0.0，工作区干净；**绝不 push/remote**
- 数据目录 `%APPDATA%\ttFolio\`（library.db + backups/trash/thumbs/logs/runtime.json）；测试/夹具只进 `.tmp-test/`（已 gitignore）

## 七、常用命令

```bash
npm run dev      # server(tsx watch:7717) + vite(5173)，开发用
npm run build && npm start   # 生产：vite dist 托管于 7717
npm run verify   # 全量门禁：typecheck+lint+vitest+build+e2e+机械检查（提交前必绿）
npm run test:e2e # 单独跑 Playwright（scripts/e2e-server.mjs 会先清空测试数据目录，幂等）
npm run doctor   # 数据自检报告
```

## 八、已知坑（前人踩过，别再踩）

- better-sqlite3 的 TS 泛型极严格：**不要**直接 `db.prepare<...>`，用 `db/sql.ts` 的 getAll/getOne/run
- e2e 必须走 `scripts/e2e-server.mjs` 启动（先清 `.tmp-test/e2e-data`），否则上一轮的失效卡片会让用例假失败
- Windows 下 npm/npx 是 .cmd：scripts/*.mjs 里 spawn 必须 shell:true（仅限 scripts/，packages 内仍禁）
- analyzer/runner 的任务闭包里 taskId 取 `taskCtx.taskId`（曾因引用外层未初始化变量 TDZ 崩溃）
- FTS5 trigram 查询词 <3 字符无结果，用 `ftsMatchExpr` 包 phrase
- 修改接口/表结构：先改 shared schema/迁移（只增不改），再改 repo，同步设计文档（DOC-2）

## 九、工作方式

每完成一个内聚模块：`npm run verify` 全绿 → Conventional Commits 提交（英文 type + 中文说明，正文写为什么/影响面/如何验证）→ 更新 PROGRESS.md。不确定的决策：选最简单、最少依赖、最符合第五节红线的方案，并记入 DECISIONS.md。发现规格与实现冲突：以约束文档为准，先改文档再改代码。
