# ADR-0003 视觉体系：AntD 5 Design Token 单源下发

日期：2026-09-21 ｜ 状态：已采纳

## 背景
约束 C-50/C-51：视觉必须走 AntD token、默认浅色、语义色只用于语义；机械检查 M10 禁止 theme 目录之外出现 hex 色值。

## 备选方案
1. 各组件自管样式 —— 必然散落硬编码，深色模式不可持续（否决）。
2. CSS variables 自建主题层再映射 AntD —— 多一层间接，维护两套（否决）。
3. ConfigProvider 单点下发 token + 算法切换（采纳）。

## 决定
- `web/src/theme/tokens.ts` 是唯一定义色值处：主色 #1677ff、语义三色、圆角 6/8/4；theme 目录外的 hex 由机械检查拦截。
- 默认 defaultAlgorithm（浅色）；深色 = darkAlgorithm；跟随系统 = matchMedia 监听。密度 = componentSize 三档。
- 语义规则：未提交改动=warning、干净=success、危险=error、选中/主操作=primary。
- 例外一：GitHub 语言色（数据语义色）存放 tokens.ts（theme 目录内），不算破坏视觉体系。
- 例外二：CodeMirror 自绘主题（codemirror.ts，theme 目录内），配色取 AntD 底色与语义色。
- 例外三：主题选择用 localStorage 缓存首帧（带 TT-THEME-CACHE 注释，C-29 允许的纯 UI 例外）；业务数据一律走 API 落库。
- antd Button 关闭两字自动插空格（button.autoInsertSpace=false），保证文案与测试断言一致。

## 后果
- 正面：换主题 = 换算法，组件零改动；机械检查可自动守护。
- 代价：个别 AntD 默认行为（按钮空格）被关闭，与"裸 AntD"有极小偏差，已在 DECISIONS.md 记录。
