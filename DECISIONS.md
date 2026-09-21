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
