# TASK-012 开发执行提示词

> 本文档供负责实施 [TASK-012：Windows Alpha 发布工程](./TASK_012_WINDOWS_ALPHA_RELEASE.md) 的 Codex 或开发 Agent 使用。
> 可以整体使用“主提示词”执行全任务，也可以按 WP0–WP8 逐包复制对应提示词。
> 分包执行时，后续 Agent 必须先阅读主提示词、Task 12 规划、WP0 报告、前序修改和当前 Git 差异。

---

## 一、主提示词

你正在 `WenShu` 仓库中继续开发文枢 Windows 桌面应用。请完整实施 **TASK-012：Windows Alpha 发布工程**，
但必须按 WP0 至 WP8 顺序小步执行，每个工作包经定向验证和本包门禁后才能进入下一包。
不要只生成一个 EXE 就提前结束；最终目标是得到可重复构建、可审计包内容、可安装/便携运行、
可验证签名/哈希/来源、并且不回退 Task 1–11 数据安全与生命周期语义的 Windows x64 Alpha 发布工程。

### 1.1 开始前必须完成

1. 完整阅读以下文件，不得只读标题、摘要或其他 Agent 的转述：
   - `README.md`
   - `docs/PROJECT_BASELINE.md`
   - `docs/DEVELOPMENT_ENVIRONMENT.md`
   - `docs/TESTING.md`
   - `docs/TASK_009_COMPLETION_REPORT.md`
   - `docs/TASK_010_COMPLETION_REPORT.md`
   - `docs/TASK_011_UI_SHELL_INFORMATION_ARCHITECTURE.md`
   - `docs/TASK_011_COMPLETION_REPORT.md`
   - `docs/TASK_012_WINDOWS_ALPHA_RELEASE.md`
   - `package.json`、`package-lock.json`、`.node-version`、`.gitignore`
   - `electron.vite.config.ts`
   - `src/main/index.ts`、`src/preload/index.ts`、`src/shared/desktop-api.ts`
   - 仓库内适用于当前目录的全部 `AGENTS.md`（如果存在）。
2. 检查当前分支和 `git status`。用户已有修改属于用户，不得重置、覆盖、删除或混入无关变更。
3. 阅读全部直接相关源码与测试，确认主进程外部依赖、renderer bundle、preload 边界、
   BrowserWindow 安全配置、runtime info 和现有启动/截图脚本。
4. 在修改任何产品代码或依赖前实际运行：
   - `.\scripts\npm.cmd run check`
   - `.\scripts\npm.cmd run build`
5. 记录测试文件数、passed、failed、skipped 与跳过原因；记录 main/preload/renderer 构建产物大小。
6. 如基线失败，先区分主干问题、环境问题、用户修改或真实回归；不得用弱化断言、新增跳过、
   放大 timeout 或关闭安全配置来制造绿色门禁。

### 1.2 实施时必须重新查证的可变事实

Electron、electron-builder、Playwright、GitHub Actions、Windows 签名和 SmartScreen 规则会变化。实施时必须使用
`docs/TASK_012_WINDOWS_ALPHA_RELEASE.md` 第 3.4 节列出的官方来源重新查证：

- 当日 Electron 最新三个受支持稳定系列和各自 EOL；
- 中间受支持系列的最新补丁版和 breaking changes；
- electron-builder 当前稳定大版本、Node.js 要求、配置 schema、NSIS/portable、fuses 与 `win.sign`；
- Playwright Electron 的支持状态、原生对话框限制和 `nodeCliInspect` 关系；
- GitHub Actions 的当前官方 Action、最小权限、Artifact Attestations 资格；
- Microsoft 当前 Authenticode、Artifact Signing、SmartScreen 与 Smart App Control 说明。

只使用官方文档、官方发布页或一级源。如实施时的受支持窗口与规划文件不同，先更新 Task 12 和 WP0 决策，
不机械安装文档中已过时的精确版本。

### 1.3 固定的产品决策

除非项目所有者在实施开始前明确修改，按以下决策执行：

- 首个 Alpha：`0.1.0-alpha.1`；
- Git 标签：`v0.1.0-alpha.1`；
- `appId`：`io.github.ravenhu001.wenshu`；
- 显示名：`文枢`；
- executable/artifact 基础名：`WenShu`；
- 平台：Windows 10 / Windows 11；
- 架构：x64；
- 产物：portable + per-user NSIS；
- 当前用户安装，默认不提权；
- 不实现自动更新、遥测、文件关联、ARM64、ia32、Store/MSIX/MSI、macOS 或 Linux；
- 不允许使用 Electron 37 生成最终 Alpha；
- 默认选择实施当日最新三个受支持 Electron 系列中的中间系列最新补丁；
- 内部 Alpha 可以未签名验证，公开 Alpha 只能在受信任 Authenticode 签名和验签完成后发布。

### 1.4 不可回退的 Task 1–11 基线

- `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`；
- renderer 不得直接访问 Node.js、文件系统、shell、process 或通用 IPC；
- preload 仅暴露精确形状的窄 API；不暴露 `ipcRenderer`、任意 invoke/on/send、任意路径或命令执行；
- 主进程继续验证 sender、请求精确形状、工作区边界、symlink/junction、realpath 和发布前竞态；
- TXT 保存的 revision、同目录临时写入、sync/close 和安全替换不变；
- DOCX 的中间模型、资源预算、兼容性、产物复验和 `.wenshu.bak` 不变；
- 删除仅进入 Windows 回收站，不增加永久删除降级；
- stable `tabId`、`mutationEpoch`、dirty/saving/conflict/read-only/degraded、关闭保护不变；
- 查找替换、工作区搜索、结果定位和路径迁移不回归；
- 日志不记录正文、查询/替换文本、绝对用户路径、文件句柄、原始 OOXML、证书或 token；
- 安装、升级和卸载不得修改或删除用户外部工作区。

如确实需要改变任何一项，编码前先报告必要性、影响面、数据安全风险、迁移和测试方案，并等待项目所有者确认。

### 1.5 需要项目所有者权限或决策的事项

不得自行推断或伪造以下事项：

- 项目自身许可证（开源许可、source-available、保留全部权利或其他）；
- “文枢 / WenShu”名称、图标和对外发布者身份的最终确认；
- Authenticode 证书、Microsoft Artifact Signing/HSM/证书存储的选择、购买、身份验证和凭据授权；
- 实际创建/push Git 标签、push 代码、创建或发布 GitHub Release；
- 对外公开未签名二进制；
- 修改 Windows 会话级缩放/安全策略或在真实主机安装/卸载可能影响现有应用的产物。

可以在本地完成配置、dry-run、未签名内部 Alpha、测试凭据管线验证和 Draft Release 所需文件。
但没有当前用户请求中的明确授权时，不得 push、tag、上传、创建/发布 Release 或使用真实签名凭据。
需要凭据时不要请求用户在对话中粘贴明文私钥或密码；只能提供安全的本地/云签名配置入口。

### 1.6 工作包顺序

#### WP0：锁定基线、运行时、身份与发布语义

- 重新实测基线和官方版本信息；
- 锁定 Electron、electron-builder、Playwright、GitHub Action 版本；
- 确认应用身份、版本、架构、产物、签名级别和许可证决策点；
- 新增 `docs/TASK_012_WP0_REPORT.md`；
- 本包不修改产品功能、不安装新依赖。

#### WP1：Electron 受支持运行时迁移

- 只做运行时迁移及必要兼容修复；
- 恢复 Task 1–11 全量回归、Windows 原生能力与 WPS/Word 冒烟；
- 未通过时不进入打包。

#### WP2：应用身份、版本、图标与 About

- 固定 `0.1.0-alpha.1`、appId、显示名、可执行文件名和产物命名；
- 增加权利可追溯的多尺寸 Windows ICO；
- About 显示与包元数据一致的产品版本；
- 不为版本读取暴露宽泛 runtime/process 能力。

#### WP3：electron-builder、产物白名单与依赖收敛

- 引入精确 electron-builder 版本和独立配置；
- 先生成 unpacked，后生成 portable/NSIS；
- 建立包内容白名单和禁止文件审计；
- 只保留真实主进程运行依赖，防止 renderer 依赖重复。

#### WP4：ASAR、fuses、包验证与 Electron E2E

- 启用适合当前 `loadFile()` 架构的 ASAR integrity 与 fuses；
- 增加 Playwright Electron E2E；
- 区分可驱动 unpacked E2E 和最终加固产物黑盒冒烟；
- 不增加产品内通用 test IPC。

#### WP5：Windows 安装、升级、卸载与真实文档验收

- 在受控测试目录/主机验证 unpacked、portable、NSIS；
- 覆盖 Windows 10/11 x64、普通用户、中文/空格路径、安装/升级/卸载；
- 使用临时工作区覆盖 TXT/DOCX、备份、冲突、回收站和 WPS/Word；
- 任何工作区数据变化都立即停止发布。

#### WP6：Windows CI、发布工作流与来源证据

- 增加最小权限 PR/push CI 和独立 release workflow；
- 使用 `npm ci`、版本/标签校验、重新构建、SHA-256、Draft Pre-release 结构；
- 签名和发布 job 必须最小权限和人工 Environment 批准；
- 没有用户当前授权时只提交 workflow 与本地验证，不 push/tag/发布。

#### WP7：签名接入、许可证与 Alpha 发布文档

- 只接入项目所有者确认的 Authenticode 方案；
- 不接收、打印或保存明文私钥/密码；
- 负责签名顺序、验签、时间戳、签名后 SHA-256 和下载复验；
- 生成所有者确认的 LICENSE/rights 文件、NOTICE、CHANGELOG、SECURITY 和 Release Notes；
- 如外部条件不齐，保持内部 Alpha/Draft 并记录真实阻塞。

#### WP8：整体验收、发布决策、文档与完成报告

- 从干净 checkout 执行最终 `check`、`build`、package、verify 和发布演练；
- 审计包内容、fuses、签名、哈希、CI、Windows 矩阵、许可证、隐私和已知限制；
- 更新 README、PROJECT_BASELINE、DEVELOPMENT_ENVIRONMENT、TESTING、Roadmap；
- 新增 `docs/TASK_012_COMPLETION_REPORT.md`；
- 明确区分“内部 Alpha 工程完成”和“公开 Alpha 已发布”。

### 1.7 代码、脚本和配置要求

- 使用独立 `electron-builder.yml`，不把大量发布配置堆入 `package.json`；
- 包内容使用白名单，不用“默认全部包含 + 几个排除”代替；
- 明确排除 `src/`、`tests/`、`docs/`、`scripts/`、`.git/`、`.github/`、`.tools/`、`.env*`、日志、测试夹具、
  `out/.capture-user-data/` 和任何 userData；
- 打包依赖必须以 `out/main` 真实外部 import 和干净产物启动为事实来源；
- 只有完整打入 renderer bundle 且不被 main/preload 外部引用的依赖才能移到 `devDependencies`；
- 禁止使用本机幽灵依赖；必须在干净 `npm ci` 环境复现；
- 测试和包审计脚本必须使用隔离临时目录，安全校验目标后再清理；
- 不对工作区根、用户主目录或未解析变量执行递归删除；
- PowerShell 脚本使用 `-LiteralPath` 处理来自变量的路径，删除/移动前验证解析绝对路径仍位于专用临时或产物目录；
- GitHub workflow 使用最小权限，发布 job 与 PR CI 完全分离；
- 发布工作流中第三方 Action 应锁定完整 commit SHA，保留人类可读版本注释；
- 不将证书、密码、token、发布凭据或它们的值写入命令输出、日志、测试夹具、仓库或产物；
- 保持严格 TypeScript，不引入未解释 `any`、宽泛类型断言、`eslint-disable` 或吞异常的 catch；
- 不为了发布方便引入通用命令执行、通用文件系统或任意 URL 能力。

### 1.8 测试与质量门禁

每包先运行定向测试，再根据风险运行：

```powershell
.\scripts\npm.cmd run typecheck
.\scripts\npm.cmd run lint
.\scripts\npm.cmd run format:check
.\scripts\npm.cmd test
.\scripts\npm.cmd run check
.\scripts\npm.cmd run build
```

从 WP3 开始还必须运行当时实际新增的 unpacked/package/verify 命令；从 WP4 开始必须运行 Electron E2E 和最终产物冒烟。

自动测试必须覆盖：

1. 版本、标签、About、包元数据和产物名一致；
2. 包内容白名单、禁止路径、密钥/环境文件/userData 阻断；
3. 主进程外部依赖完整、renderer 依赖无非预期重复；
4. ASAR 可解析、integrity 元数据存在、fuses 从最终 EXE 读取正确；
5. unpacked 与可驱动构建的 Playwright E2E；
6. 最终加固 portable/NSIS 黑盒启动、进程清理和不依赖源码环境；
7. TXT/DOCX 读取、编辑、保存、备份、dirty 关闭与磁盘字节；
8. NSIS/portable 产物名、架构、大小和 SHA-256；
9. 签名后验签、时间戳、发布者和下载后哈希（只在凭据已授权时）；
10. Task 1–11 全量回归。

不得：

- 新增无条件 `.skip`、`.only` 或删除安全/数据断言；
- 用快照代替包内容、进程、文件字节或安装状态断言；
- 用超长 timeout 掩盖残留进程、对话框未处理、Playwright 连接失败或构建死锁；
- 在真实用户文档目录、项目根或未清空的安装目录上执行破坏性测试；
- 用仅存活 10 秒的进程冒烟代替真实打开/保存/安装/卸载验收；
- 伪造无法在当前环境运行的 Windows 10/11、SmartScreen、WPS/Word、签名或 GitHub 发布成功。

### 1.9 工作方式和每包报告

- 先调查再修改，以当前代码、锁文件、官方文档和实测为事实来源；
- 使用可检查的工作计划，同一时刻只有一个工作包处于实施中；
- 每完成一包，先审查 `git diff`、测试和产物，再报告：
  1. 实际修改内容；
  2. 精确新增/修改文件；
  3. 实际执行命令及结果；
  4. 测试数量与跳过原因；
  5. 产物、大小、包内容或 Windows 证据（本包适用时）；
  6. 已知限制、未决问题和下一包入口；
  7. 是否真实满足本包门禁。
- 不擅自执行破坏性 Git 操作，不 push、merge、tag 或发布，除非当前用户请求明确授权；
- 对代码和测试能确定的普通实现问题自行调查修复；
- 只在需要项目许可证、品牌/图标、签名身份、真实发布授权或需要影响用户/系统状态的选择时暂停请求决定；
- 如外部账户或签名条件不具备，继续完成所有安全的本地工程、dry-run 和文档，最后准确报告阻塞；
- 在全部验收完成前不要以“打包成功”或“主要流程已完成”结束 Task 12。

### 1.10 最终交付

完成后必须提供：

1. 受支持 Electron 精确版本、迁移依据与 Task 1–11 回归证据；
2. `electron-builder.yml`、图标/构建资源、本地 package/verify 脚本；
3. Windows x64 unpacked、portable、NSIS 产物及其大小/包内容审计；
4. Playwright Electron E2E、最终加固产物黑盒冒烟、ASAR/fuses 验证；
5. Windows 10/11 x64 安装、升级、卸载、中文/空格路径、回收站、WPS/Word 人工证据；
6. `.github/workflows/ci.yml` 和 `.github/workflows/release.yml`的权限、缓存、产物与发布语义；
7. 签名、时间戳、发布者、SHA-256、attestation 的真实状态；
8. LICENSE/rights 文件、`THIRD_PARTY_NOTICES.txt`、`CHANGELOG.md`、`SECURITY.md` 和 Release Notes；
9. `docs/TASK_012_WP0_REPORT.md` 和 `docs/TASK_012_COMPLETION_REPORT.md`；
10. 更新后的 README、PROJECT_BASELINE、DEVELOPMENT_ENVIRONMENT、TESTING 和 Roadmap；
11. 完整命令结果、测试数、跳过原因、已知限制和未解决问题；
12. 明确最终结论：“内部 Alpha 工程完成”、“公开 Alpha 已发布”或“仍有阻塞”。

最终回复应先说明实际达成的发布级别，再给出关键改动、产物、测试、签名/发布证据、限制和重要文件链接。

---

## 二、分工作包执行提示词

以下提示词适合逐包执行。复制时应将方括号占位符替换为真实值；如无对应内容，填“无”，不得删除基线与授权限制。

### 2.1 WP0 执行提示词

```text
你正在 WenShu 仓库执行 TASK-012 的 WP0：锁定基线、运行时、身份与发布语义。

当前分支：[当前分支]
上一恢复点：[提交 SHA 或“无”]
已知用户修改：[用户修改或“无”]
发布目标：[内部 Alpha / 公开 Alpha / 待所有者确认]
签名条件：[受信任方案 / 仅测试签名 / 暂无]
项目许可决策：[所有者已选择的许可或“待确认”]

先完整阅读 docs/TASK_012_DEVELOPMENT_PROMPT.md 的主提示词、docs/TASK_012_WINDOWS_ALPHA_RELEASE.md，以及其第 3.1 节的全部必读材料。检查全部适用 AGENTS.md 和 git status，保留用户修改。

本包只做调查、实测、固定决策和 WP0 报告；不安装新依赖，不升级 Electron，不新增打包配置，不修改产品功能，不创建标签或 Release。

实际执行 check、build、开发/生产 Electron 启动冒烟并记录数量和产物。检查 package/lock 的实际 Electron、electron-vite、Vite、Vitest、Node/npm 版本，主进程 bundle 外部依赖，renderer 已 bundle 依赖，是否有 native module，out/ 中的禁止数据与当前包体积。

使用 Task 12 第 3.4 节的官方一级源查证当日 Electron 支持窗口、中间受支持系列最新补丁版、breaking changes、electron-builder 当前稳定版与 Node/schema/NSIS/portable/fuses/signing、Playwright Electron 限制、GitHub Actions 和 Microsoft 签名/SmartScreen 规则。锁定精确版本，不只记录宽泛 major 或 caret 范围。

核对 appId=io.github.ravenhu001.wenshu、version=0.1.0-alpha.1、Windows 10/11 x64、portable + per-user NSIS、ASCII 产物名、内部/公开 Alpha 分级。许可证、品牌图标、受信任签名身份或公开发布授权不明时，将它们列为需所有者决定的真实门禁，不自行猜测。

新增 docs/TASK_012_WP0_REPORT.md，记录官方链接、精确版本、基线命令、依赖/许可证、包内容风险、Windows/CI/签名决策、测试计划、已知阻塞和 WP0 是否通过。结束时审查 diff、运行文档格式检查，报告是否可进入 WP1。不要进入 WP1。
```

### 2.2 WP1 执行提示词

```text
你正在 WenShu 仓库执行 TASK-012 的 WP1：Electron 受支持运行时迁移。

当前分支：[当前分支]
上一恢复点：[提交 SHA]
已知用户修改：[用户修改或“无”]
WP0 锁定 Electron 精确版本：[版本]
WP0 直接兼容依赖决策：[决策]

完整阅读主提示词、Task 12 规划、TASK_012_WP0_REPORT.md、待选 Electron 官方 breaking changes、package/lock、main/preload/renderer 入口、所有 Electron IPC/窗口/回收站/对话框相关代码和测试。检查 git status，保留用户修改。

本包只将 Electron 从 37.10.3 迁移到 WP0 锁定的受支持精确版本，并修复官方 breaking changes 导致的最小兼容问题。只在有官方要求或实测证据时升级 electron-vite/Vite/类型工具，不做顺手全量依赖升级。不引入 electron-builder、打包配置、图标、E2E、CI、签名或新产品功能。

使用项目锁文件和官方 npm 包更新依赖；如网络/下载受限，按执行环境规则请求必要批准，不使用非官方镜像或手工修改 lock 伪造安装。

迁移后实际运行 typecheck、lint、format:check、全部 test、check、build、开发 Electron 冒烟和生产构建 Electron 冒烟。手工验证主窗口、中文输入、目录对话框、TXT/DOCX 打开编辑保存、DOCX 备份、外部冲突、回收站、资源管理器显示、dirty/saving 关闭保护和 WPS/Word 基础往返。记录实际 Electron/Chromium/Node 运行时版本和全部测试数。

如 Task 1–11 任何数据安全、IPC、文件管理、保存、备份或关闭语义回归，停在 WP1 修复；不进入打包。结束时审查 diff，报告精确升级、breaking change 处理、自动/手工证据、未解问题和是否满足 WP1 门禁。不要进入 WP2。
```

### 2.3 WP2 执行提示词

```text
你正在 WenShu 仓库执行 TASK-012 的 WP2：应用身份、版本、图标与 About。

当前分支：[当前分支]
上一恢复点：[提交 SHA]
已知用户修改：[用户修改或“无”]
所有者确认的图标来源/设计：[文件/生成说明/待确认]
所有者确认的项目许可决策：[许可/待确认]

完整阅读主提示词、Task 12 规划、WP0 报告、WP1 变更/证据、package/lock、DesktopRuntimeInfo/preload/About 与相关测试。检查 git status 并保留用户修改。

本包将 package.json.version 固定为 0.1.0-alpha.1，为后续 electron-builder 准备 appId=io.github.ravenhu001.wenshu、productName=文枢、executableName=WenShu 和 ASCII 产物命名所需的单一身份源。修改“关于文枢”显示产品版本、Alpha 标识、平台和 Electron 版本。版本不从用户可控环境变量取值。如增加 IPC，只能是无参数、只读、精确形状的 runtime info，不暴露 app/path/process 通用能力；优先使用可测试的单一版本源。

使用项目所有者确认、权利可追溯的原创图标，生成 Windows 多分辨率 ICO 和必要的 build/ 资源结构。不从网络下载不明图标，不把现有功能性 SVG 图标默认冒充品牌图标。如图标设计尚未获得所有者确认，可完成版本和 About，但必须把图标标记为 WP2 门禁，不自行做品牌决策。

新增/更新测试覆盖版本形状、About 展示、只读协议、preload 契约、图标存在和尺寸/格式，并防止版本分叉。本包不安装 electron-builder，不生成安装包，不做 CI/签名。

运行定向测试、完整 check 和 build，启动生产构建核对 About。结束时审查 diff、图标权利来源、版本唯一性和 IPC 面，报告是否满足 WP2 门禁。不要进入 WP3。
```

### 2.4 WP3 执行提示词

```text
你正在 WenShu 仓库执行 TASK-012 的 WP3：electron-builder、产物白名单与依赖收敛。

当前分支：[当前分支]
上一恢复点：[提交 SHA]
已知用户修改：[用户修改或“无”]
WP0 锁定 electron-builder 精确版本：[版本]
当前 Electron 精确版本：[版本]

完整阅读主提示词、Task 12 规划、WP0 报告、WP1/WP2 变更与证据、electron-vite 当前官方分发文档、electron-builder 当前官方 schema/Windows/NSIS/portable 文档、package/lock、electron.vite.config.ts、out/ 产物外部 import 和 .gitignore。检查 git status，保留用户修改。

使用项目 npm 安装 WP0 锁定的精确 electron-builder 开发依赖，更新 lock；不手工修改 lock。新增独立 electron-builder.yml 和命名清楚的 package:dir/package:win/package:verify 等脚本。配置 appId、productName、executableName、buildResources、独立产物输出目录、x64 portable 与 per-user assisted NSIS；本包不接入签名或 publish。

包内容必须使用白名单，只包含 out/main、out/preload、out/renderer、必要 package 元数据和主进程真实外部运行依赖。确定性阻止 src、tests、docs、scripts、.git/.github/.tools/.env*、日志、测试夹具、截图基线、out/.capture-user-data 和任何 userData/凭据。

从 out/main 真实外部 import 确认 jszip、mammoth、docx 及间接依赖必须进入产物。对已完整打入 renderer bundle 的 React/CodeMirror/Tiptap 等依赖逐项确认是否可移到 devDependencies，以干净 npm ci + build + 打包后启动为证据，不只看源码 import 做猜测。

先生成 unpacked 产物，移走源码仓库依赖后启动，确认无缺失模块。新增可重复的包内容审计：验证必要文件、禁止路径/后缀/秘密模式、package main/version、外部依赖、产物架构与大小。再生成 portable 和 NSIS，记录 unpacked/app.asar/app.asar.unpacked/portable/NSIS 大小、文件列表和重复依赖。

清理只能针对已验证为项目专用产物目录的精确路径，不对仓库根、用户目录或未解析变量执行递归删除。

运行定向包审计测试、完整 check/build、package:dir、package:win、package:verify 和三类产物启动冒烟。本包不做 fuses/Playwright/CI/签名。结束时审查产物内容、依赖、禁止数据、大小、diff 和临时残留，报告是否满足 WP3 门禁。不要进入 WP4。
```

### 2.5 WP4 执行提示词

```text
你正在 WenShu 仓库执行 TASK-012 的 WP4：ASAR、fuses、包验证与 Electron E2E。

当前分支：[当前分支]
上一恢复点：[提交 SHA]
已知用户修改：[用户修改或“无”]
WP0 锁定 Playwright 精确版本：[版本]
当前 Electron/electron-builder 精确版本：[版本]

完整阅读主提示词、Task 12 规划、WP0 报告、WP1–WP3 变更/证据、当前 electron-builder fuses/ASAR integrity 官方文档、Electron fuses/security/ASAR 官方文档、Playwright Electron 官方文档、全部打包脚本和窗口/preload/IPC/文档测试。检查 git status，保留用户修改。

对每个 Electron fuse 以本项目实际能力记录开/关/保留默认依据。至少实测 runAsNode=false、enableNodeOptionsEnvironmentVariable=false、enableEmbeddedAsarIntegrityValidation=true、onlyLoadAppFromAsar=true。当前 renderer 使用 loadFile/file://，不得照抄模板盲目关闭 file-protocol 相关能力。对 nodeCliInspect 与 Playwright 的冲突做最小实测：最终产物优先关闭，但不伪造关闭后仍可完整 Playwright 驱动的证据。

使用 electron-builder 当前官方 fuse 集成或有明确理由的官方 @electron/fuses afterPack 方案；不同时叠加两套翻转。开启 ASAR integrity 后从最终 EXE 和 app.asar 实际读取验证，并测试篡改/缺失 ASAR 时拒绝启动的可观察行为，不破坏用户环境。

安装 WP0 锁定的 Playwright 开发依赖。新增专用 tests/e2e 和隔离临时工作区/userData，使用 ElectronApplication.evaluate 替换原生 open/save/message dialog，不用坐标点击 OS 对话框。E2E 覆盖启动、打开工作区、TXT 编辑保存字节、基础 DOCX 保存/有效 OOXML/备份、dirty 关闭保护、About 版本、无未处理异常和进程/临时清理。不为测试在产品 DesktopApi 中暴露通用 test IPC 或任意路径。

如最终加固产物无法被 Playwright 驱动，保留可驱动 unpacked 构建 E2E，并对最终 portable/NSIS 实现黑盒启动、窗口/进程存活、无主进程弹窗、退出清理、fuse 读取、ASAR integrity 和不依赖源码目录的冒烟。在报告中明确自动边界。

运行定向 E2E/包验证、完整 check/build/package/verify 和最终产物冒烟。检查无残留 Electron 进程、无临时工作区/userData、无日志泄漏。结束时报告每个 fuse、ASAR 证据、E2E 覆盖/限制、产物结果和是否满足 WP4 门禁。不要进入 WP5。
```

### 2.6 WP5 执行提示词

```text
你正在 WenShu 仓库执行 TASK-012 的 WP5：Windows 安装、升级、卸载与真实文档验收。

当前分支：[当前分支]
上一恢复点：[提交 SHA]
已知用户修改：[用户修改或“无”]
可用 Windows 验收环境：[Windows 10/11 主机或 VM]
可用 Office 程序：[WPS/Word 及版本]

完整阅读主提示词、Task 12 规划第 8.5/8.6 节、WP0 报告、WP1–WP4 变更/证据、打包配置、包验证/E2E、Task 7/9/11 的 Windows 人工清单和完成报告。检查 git status 并保留用户修改。

本包只做 Windows 真实产物验收和验收发现的 Task 12 范围内修复，不实现 CI、签名、自动更新或新产品功能。使用精确、已验证的临时目录和隐私安全夹具；不在仓库、用户真实文档或宽泛系统目录上执行安装/卸载/删除测试。如需在真实主机安装、卸载、切换 Windows 设置或使用 GUI，按执行环境规则请求必要批准。

分别验证 unpacked、portable 和 per-user NSIS：portable 从普通/中文/空格目录启动；NSIS 普通用户安装不主动提权，安装路径、开始菜单、快捷方式、About 版本和卸载入口正确；同版本重装与 alpha.0-test → alpha.1 安装身份稳定；退出/卸载后无非预期进程、快捷方式或安装目录残留。

在安装前对临时外部工作区生成字节/目录哈希清单，在安装、升级、卸载后复验。然后使用安装版和便携版分别覆盖打开工作区、TXT/DOCX 打开编辑保存、DOCX 备份、外部冲突、只读/degraded、回收站删除恢复、资源管理器显示、dirty/saving 关闭保护和 WPS/Word 双向往返。

在 Windows 10 x64 和 Windows 11 x64 普通用户下重复关键矩阵。记录启动时间、安装/卸载耗时、产物大小、进程残留、Defender、SmartScreen/Smart App Control 和当前 Authenticode 的真实行为。不把单机无警告宣称为所有用户无警告。

任何安装/升级/卸载修改或删除外部工作区、出现不安全提权或破坏 Task 1–11 数据语义时，立即停止发布，保留证据，先修复并重跑受影响矩阵。最后运行完整 check/build/package/verify，审查残留，报告环境、操作、结果、限制和是否满足 WP5 门禁。不要进入 WP6。
```

### 2.7 WP6 执行提示词

```text
你正在 WenShu 仓库执行 TASK-012 的 WP6：Windows CI、发布工作流与来源证据。

当前分支：[当前分支]
上一恢复点：[提交 SHA]
已知用户修改：[用户修改或“无”]
仓库可见性/计划与 attestation 资格：[已确认信息/待查]
当前用户是否授权 push/tag/创建 Draft Release：[是/否]

完整阅读主提示词、Task 12 规划第七节、WP0 报告、WP1–WP5 变更/证据、全部 package/verify/E2E 脚本，以及 GitHub 当前官方 Actions、workflow permissions、dependency caching、release、artifact attestation 文档。检查 git status，保留用户修改。

新增 .github/workflows/ci.yml：在锁定 Windows runner 上使用与 .node-version 一致的精确 Node，npm ci，check，build 和已定义的 Electron E2E。默认 permissions: contents: read，不获取签名凭据，不发布。npm 缓存只缓存下载，不跨提交信任 node_modules/out/打包产物。

新增独立 .github/workflows/release.yml：只由 workflow_dispatch 或与 package version 严格匹配的 v* 标签触发；从标签指向的唯一 commit 重新 npm ci/check/build/package/verify；产物签名接入点和发布 job 使用独立 GitHub Environment 与人工批准；只有发布 job 获得 contents: write；生成 SHA256SUMS.txt，验证后上传 Draft Pre-release，不自动转公开。

优先使用 GitHub 官方 checkout/setup-node/upload-artifact/attest。发布工作流的第三方 Action 使用完整 commit SHA 锁定，旁边注释人类可读版本。记录每个 Action 的用途、权限、维护者和替代方案。仓库/计划支持时增加 artifact attestation；不支持时如实记录。

使用未签名内部测试产物验证 workflow 的本地语义、YAML、命令、路径、权限和产物名。如当前用户未明确授权外部操作，不 push、不创建标签、不启动远程 workflow、不创建 Release；在完成报告中把远程实际执行保留为需授权的验收项。如已授权，仍先核对精确仓库、分支/标签和 Draft 性质，不直接公开发布。

运行本地定向检查、完整 check/build/package/verify/E2E，检查 workflow 无明文凭据、PR 无 write/signing 权限、版本和标签校验不可绕过。结束时报告工作流结构、Action 锁定、权限、缓存、attestation 资格、本地/远程实际证据、未获授权项和是否满足 WP6 门禁。不要进入 WP7。
```

### 2.8 WP7 执行提示词

```text
你正在 WenShu 仓库执行 TASK-012 的 WP7：签名接入、许可证与 Alpha 发布文档。

当前分支：[当前分支]
上一恢复点：[提交 SHA]
已知用户修改：[用户修改或“无”]
所有者确认的签名方案：[Artifact Signing / OV/EV/HSM/仅内部未签名]
所有者确认的项目许可：[许可或 rights 文本]
是否授权创建 Draft Release：[是/否]
是否授权公开 Pre-release：[是/否，默认否]

完整阅读主提示词、Task 12 规划第 4.5/6.5/7.4/8.7/8.8 节、WP0 报告、WP1–WP6 变更/证据、electron-builder 当前 win.sign 官方文档、Microsoft 当前 Authenticode/Artifact Signing/SmartScreen 文档、锁文件与全部 workflow/package 脚本。检查 git status，保留用户修改。

不要向用户请求在对话中粘贴明文私钥、PFX 密码、Azure/GitHub token 或证书 base64。只根据所有者选定的安全存储/云签名方式接入配置名称、环境键名、GitHub Environment 和最小权限，不读出或打印凭据值。使用 electron-builder 当前 v27 win.sign 形状，不复活已删除的旧配置字段。

实现顺序必须是：包内容固定 → fuses/ASAR integrity → Authenticode 签名 → 验签/时间戳/发布者 → 最终 SHA-256 → 上传。对 portable 和 NSIS 逐个验证，不修改已签名文件。自签名只能验证管线，不写成受信任公开签名。已签名仍可能有 SmartScreen 警告，文档不过度承诺。

根据所有者已确认决策增加 LICENSE 或权利保留文件；不自行为项目选择 MIT/Apache/GPL/商业许可。从 package-lock 与最终产物生成第三方依赖、版本、许可证和 NOTICE 清单，审查例外、嵌套许可和需保留声明，不把工具输出伪装成完整法律意见。

新增/完成 THIRD_PARTY_NOTICES.txt、CHANGELOG.md、SECURITY.md 和 Alpha Release Notes；说明系统/架构、portable/NSIS、签名状态、SHA-256 验证、核心能力、已知限制、无自动更新/无遥测、本地文档语义、问题反馈隐私和降级方式。

如当前授权允许，可从精确标签/提交创建 Draft GitHub Pre-release 并上传签名产物、SHA256SUMS.txt 和 NOTICE；没有公开授权时不将 Draft 发布为公开。如签名或许可外部条件不齐，完成安全的本地工程和文档，明确保持“内部 Alpha/Draft，公开发布阻塞”。

运行完整 check/build/package/verify/E2E、签名/验签/哈希检查（已授权时）和包内容复审。审查 Git 与日志无凭据、绝对用户路径或隐私。结束时报告实际签名级别、验签、哈希、许可审计、Draft/公开状态、阻塞和是否满足 WP7 门禁。不要进入 WP8。
```

### 2.9 WP8 执行提示词

```text
你正在 WenShu 仓库执行 TASK-012 的 WP8：整体验收、发布决策、文档与完成报告。

当前分支：[当前分支]
上一恢复点：[提交 SHA]
已知用户修改：[用户修改或“无”]
预期最终级别：[内部 Alpha 工程 / 公开 Alpha]
是否已授权最终公开 Release：[是/否]

完整阅读主提示词、Task 12 规划全文、TASK_012_WP0_REPORT.md、WP1–WP7 全部变更/恢复点/测试/产物/Windows/CI/签名/许可证证据，以及当前 README、PROJECT_BASELINE、DEVELOPMENT_ENVIRONMENT、TESTING、CHANGELOG、SECURITY、LICENSE/rights、NOTICE 和 Release Notes。检查 git status，保留用户修改。

本包不新增产品功能；只修复最终验收发现且属于 Task 12 范围的问题。逐项核对 Task 12 第十一节 33 项验收标准，每个勾选必须有自动测试、包审计、最终产物检查、Windows 人工证据、签名/哈希/来源证据或明确外部阻塞作为依据。不得根据配置文件看起来正确直接勾选。

从干净 checkout 和锁文件实际执行：typecheck、lint、format:check、全部 test、check、build、package:dir、package:win、package:verify、Electron E2E、最终加固产物黑盒冒烟、ASAR/fuse 读取、包内容审计、签名/验签/哈希（适用时）和发布 dry-run。记录每条命令退出码、测试文件/用例/跳过数、产物文件名/字节/哈希/大小和进程残留。

重跑 Windows 10/11 x64 普通用户下的 portable/NSIS 安装、覆盖安装、卸载、中文/空格路径、外部工作区哈希不变、TXT/DOCX/备份/冲突/回收站/WPS/Word 核心矩阵，以及 Defender/SmartScreen/Smart App Control/AuthentiCode 真实状态。不伪造无法在当前环境完成的平台证据。

审查全部发布写路径、清理路径、workflow permissions、Action SHA、缓存、包白名单、app.asar.unpacked、版本/标签、`.only`、无条件 `.skip`、timeout 放宽、弱化断言、凭据/环境文件/绝对路径/隐私泄漏和用户已有修改。

更新 README 当前能力/尚未实现/安装验证/Roadmap/文档/结构，PROJECT_BASELINE 的发布基线，DEVELOPMENT_ENVIRONMENT 的构建/发布区分，TESTING 的 CI/package/E2E/Windows/签名清单，CHANGELOG、SECURITY、LICENSE/rights、NOTICE 和 Release Notes。新增 docs/TASK_012_COMPLETION_REPORT.md，记录精确运行时/工具版本、工作包、关键文件、身份/版本、包白名单/依赖、ASAR/fuses、E2E、产物/大小/哈希、Windows 矩阵、CI/权限/attestation、签名/时间戳/SmartScreen、许可证、限制和最终发布级别。

只有所有内部 Alpha 工程标准都有证据时，才能将 Task 12 记录为“内部 Alpha 工程完成”。只有受信任签名、验签、许可证、最终人工批准和实际公开 Pre-release 都完成时，才能记录“公开 Alpha 已发布”。如存在外部阻塞，保留未勾选项和 Draft/内部状态。

如当前用户没有明确授权 push/tag/Release，不执行这些外部动作。如已授权公开发布，仍必须先把 Draft 产物、签名、哈希、Release Notes 和人工证据提交项目所有者最终核对，不把“开发 Task 授权”解读为“自动对外发布授权”。

结束时给出最终 diff、命令证据、产物链接/路径、签名/哈希、Windows/CI 证据、已知限制、外部阻塞、满足的验收项和最终发布级别。
```

---

## 三、使用建议

- 如希望单个 Agent 从头到尾实施，使用第一节完整主提示词，但仍要求其按 WP0–WP8 分门禁报告；
- 如逐包实施，每次使用第二节对应提示词，并填写当前分支、恢复点、用户修改和所有者决策；
- WP0 应作为独立恢复点；WP1 的 Electron 迁移在打包前独立完成；WP3 先完成 unpacked 再生成安装器；
- WP5 需要真实 Windows 安装/卸载和 WPS/Word 证据，不宜与 CI 配置混在同一巨大修改中；
- WP7 前应由项目所有者明确许可证与签名方案；没有决策时不应由 Agent 自行选择；
- 创建 Git 标签、push、启动远程 release workflow、创建 Draft Release 和公开 Pre-release 是不同权限层级，每一层都应有当前任务的明确授权；
- 任何时候发现包中泄漏凭据/userData、安装/卸载修改外部工作区、签名后文件被再修改或 Electron 已超出支持窗口，都应停止发布并先修复根因。
