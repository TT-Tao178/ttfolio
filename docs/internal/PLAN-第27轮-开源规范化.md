# 开源规范化改造规划（评审稿，未实施）

> 四项需求：① 对照正规可上线开源项目找差距；② 打包名改为 ttFolio；③ README 重写（中英切换）；
> ④ GitHub 上传内容合规审计。
> 本文仅为体检结论与实施方案，**一行代码未动**。批准并拍板分叉点后实施。

---

## 一、体检总表：与正规可上线开源项目的差距

### 已达标（不必动）

| 项 | 现状 |
| --- | --- |
| 许可证 | MIT，GitHub 已自动识别 ✓ |
| 变更日志 | CHANGELOG.md，Keep a Changelog 格式，已补齐 0.1.6~0.2.1 ✓ |
| 工程配置 | .gitignore/.editorconfig/.gitattributes/.prettierrc/.eslintrc 齐 ✓ |
| 质量门禁 | typecheck + lint(0 警告) + 62 条测试 + 出包自检 7 项 ✓ |
| 分支模型 | 单 main 分支，与远程同步，无杂乱分支 ✓ |

### A 级差距（上线前必须补）

1. **GitHub Releases = 0**——4 个 tag 全是 Web 阶段旧里程碑（v0.1.0-p0/v0.2.0-p1/v0.3.0-p2/v1.0.0），
   与桌面版 0.1.x~0.2.x 完全脱节；README 里 [Releases](../../releases) 链接指向空页面。
   桌面应用的正规分发方式 = Release 挂安装包（14 个 Setup exe 全躺在本地，用户无处下载）。
2. **package.json 元数据缺失**——`author`/`license`/`repository`/`bugs`/`homepage`/`keywords` 全空
   （electron-builder 一直在警告 "author is missed" → 安装版 exe 属性的 Publisher 为空）；
   description 还带着旧品牌「tt项目仓库」。
3. **README 单语**——无中英切换；品牌标题与描述里「TT项目管理工作台/tt项目仓库/ttFolio」三个叫法混用。
4. **仓库元数据贫瘠**——topics 空（GitHub 搜索可发现性为零）、homepage 空；description 是中文口语
   （「一个方便本地项目直观管理的工作台」）。

### B 级差距（应该有，按需取舍）

5. 无 `.github/` 目录：无 CI、无 Issue 模板、无 PR 模板（你此前明确「这次不加 CI」——列差距，做不做你定）。
6. 无 CONTRIBUTING.md / SECURITY.md / CODE_OF_CONDUCT.md。
7. README 无界面截图（正规桌面项目 README 首屏通常有截图或 GIF；我可以用探针自动截几张放 `docs/screenshots/`）。

### C 级（内部决策项，私有仓 vs 开源仓）

8. **内部交接文档与开源文档混在根目录**：HANDOVER / PROGRESS / DECISIONS / KNOWN-GAPS / PLAN-第26轮 /
   DELIVERY-REPORT / PROJECT-CONTEXT 共 7 份。私有仓没问题；一旦开源，它们要么移入 `docs/internal/`，
   要么从历史中清除（见下条）。
9. **敏感信息在 tracked 文件里**（私有可接受，开源前必须清理）：
   - 真实路径 `D:\<工作区>/2`、用户名 `<用户名>`：HANDOVER / PROGRESS / DELIVERY-REPORT / PROJECT-CONTEXT / playwright.config.ts（e2e 数据目录默认值）
   - 你的真实项目名（爱莉希雅png、B站热门分析、杂-一些可爱的表情等）：HANDOVER / PROGRESS 的台账记录
   - 1 条提交信息含真实路径（ab0e3f3 正文）
   - 处置建议（分叉点 3）：playwright.config.ts 的默认值改为相对路径（必做、无风险）；
     交接文档本轮**移入 docs/internal/** 并在 README 不引用（开源时可整目录从新历史剔除或仅保留脱敏版）。
10. **DELIVERY-REPORT.md / PROJECT-CONTEXT.md 已过时**（v1.0.0 时代产物，内容被 PROGRESS 取代）——
    建议移入 docs/internal/ 或直接删除（历史里永远可找回，删除零风险）。

---

## 二、改名 ttFolio：影响面分析（分叉点 1）

改名涉及四层，逐层影响：

| 层 | 现值 | 改动影响 | 建议 |
| --- | --- | --- | --- |
| artifactName（安装包文件名） | `TT项目管理工作台-Setup-0.2.3.exe` | 只影响新包文件名；**纯 ASCII 顺带消除中文文件名在脚本/终端的编码隐患** | 改 `ttFolio-Setup-${version}.${ext}` |
| productName（exe 名/快捷方式名/窗口标题/任务栏名/卸载列表名） | `TT项目管理工作台` | 桌面快捷方式、任务栏、窗口标题、控制面板卸载项全部变「ttFolio」；**升级安装时 NSIS 视为同一应用**（appId 不变即可） | 见分叉 |
| appId | `com.tttao.ttfolio` | **绝不改**——改了会被当成另一个应用，旧版卸载残留、升级链断裂 | 不动 |
| UI 顶栏品牌 | logo「TT」+「ttFolio」+ 副标题「TT项目管理工作台」 | 界面内文案，与安装包名无关 | 本轮不动（已与 ttFolio 一致） |

- **方案 a（最小）**：只改 artifactName → 安装包叫 `ttFolio-Setup-0.2.4.exe`，装完后快捷方式仍叫「TT项目管理工作台」。
- **方案 b（推荐，品牌统一）**：artifactName + productName + shortcutName 全改 ttFolio——桌面图标、任务栏、
  卸载列表、安装包文件名全部统一为 ttFolio，与 UI 顶栏品牌（ttFolio）完全一致，符合正规开源项目命名规范
  （英文品牌、ASCII、仓库名一致）。appId 不动，覆盖安装升级无感。

## 三、README 重写：中英切换方案（分叉点 2）

- **方案 1（国际惯例，推荐）**：`README.md` = 英文主体；顶部语言切换行 `[English | 简体中文](README.zh-CN.md)`；
  中文全文在 `README.zh-CN.md`（同样有反向切换链接）。GitHub/搜索引擎默认展示英文，符合「可上线开源」定位。
- **方案 2（中文优先）**：`README.md` 中文 + `README.en.md` 英文。适合受众以中文用户为主。
- 不建议单文件双语（滚动冗长、维护时两段容易失同步）。

重写内容结构（两语言同构）：徽章行（License/version，无 CI 不放假徽章）→ 一句话简介 + 截图（可选）→
特性 → 安装（Release 下载 / 源码）→ 构建打包 → 开发与测试 → 数据与备份说明 → 路线图（引 KNOWN-GAPS 脱敏版或 CHANGELOG）→
贡献指引（可选）→ License。品牌全文统一 **ttFolio**；描述用 package.json 新 description（分叉 1 若选 b 则完全一致）。

## 四、GitHub 上传内容合规审计明细

- **tracked 共 158 个文件**，逐类核对：源码/配置/文档/图标全部应tracked；`dist-electron`、`node_modules`、
  `.tmp-test` 均未上传 ✓；无密钥/token/凭据类内容 ✓（token 只存在于本地 runtime.json，已 gitignore）。
- 问题文件 7+2：见 C 级 8/9/10 条（内部文档位置 + 敏感信息 + 2 份过时文档）。
- 仓库设置：description 中文口语（建议改英文一句话 + 可留中文双句）、topics 建议
  `electron` `windows` `local-first` `project-management` `workbench` `code-editor`、homepage 可留空或指向未来文档站。

## 五、实施计划（小步提交，约 9~11 个提交；版本 0.2.4）

| # | 提交 | 内容 |
| --- | --- | --- |
| 1 | chore(repo) | package.json 补全 author/license/repository/bugs/homepage/keywords + 新 description |
| 2 | fix(test) | playwright.config.ts 默认 e2e 目录改相对路径（去本机绝对路径） |
| 3 | docs(repo) | DELIVERY-REPORT/PROJECT-CONTEXT 移入 docs/internal/（或删，按分叉 3） |
| 4 | docs(repo) | HANDOVER/PROGRESS/DECISIONS/KNOWN-GAPS/PLAN 移入 docs/internal/（按分叉 3） |
| 5 | feat(desktop) | 改名 ttFolio（artifactName；productName/shortcutName 按分叉 1） |
| 6 | docs(readme) | README.md 英文版重写 |
| 7 | docs(readme) | README.zh-CN.md 中文版（或交换，按分叉 2） |
| 8 | chore(release) | 版本 0.2.4 + dist:win 出包（新名安装包）+ 自检 |
| 9 | docs | 收口台账（注意：出包前 git status 确认无未提交改动——上轮教训） |
| 10 | 发布（非提交） | 打 tag v0.2.4 → GitHub Release 挂 ttFolio-Setup-0.2.4.exe（按分叉 4）+ 仓库 topics/description 更新 |
| 11 | 截图（可选） | 探针自动截 3~4 张界面图入 docs/screenshots/，README 引用 |

红线不变：不动 packages 源码逻辑、不动 appId、不动数据库、探针零残留、旧安装包保留。

## 六、分叉点汇总（请拍板）

| # | 问题 | 选项 |
| --- | --- | --- |
| 1 | 改名范围 | **a. artifactName+productName+shortcutName 全改 ttFolio（推荐，品牌统一）** / b. 只改安装包文件名 |
| 2 | README 主语言 | **a. 英文主 + 中文切换（推荐，符合国际开源惯例）** / b. 中文主 + 英文切换 |
| 3 | 内部文档处置 | **a. 移入 docs/internal/（推荐，保留历史又分区）** / b. 留根目录不动 / c. 删除过时两份+移其余 |
| 4 | GitHub Release | **a. 打 tag v0.2.4 + Release 挂新安装包 + 更新 topics/description（推荐）** / b. 本轮不发布 Release |
| 5 | README 截图 | a. 要（探针自动截图）/ **b. 本轮不要（推荐，先文字版）** |
