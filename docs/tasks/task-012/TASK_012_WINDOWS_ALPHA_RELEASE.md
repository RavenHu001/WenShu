# TASK-012：Windows Alpha 发布工程

简体中文 | [English](./TASK_012_WINDOWS_ALPHA_RELEASE.en.md)

[任务档案](../README.md) · [文档中心](../../README.md)

## 任务状态

> **状态：当前范围 33/33 项通过；MIT 源码发布准备完成；Windows 10 x64 未签名内部 Alpha 工程完成。**
>
> 规划日期：2026-08-27；范围修订：2026-09-08、2026-09-10。Task 1 至 Task 11 已完成产品核心闭环、安全文件写入、
> Windows 人工终验和桌面外壳收尾。Task 12 当前公开交付物固定为 GitHub 上的 MIT 源码；Windows 10
> x64 portable/NSIS 是未签名内部实验产物，不作为公开下载。Windows 11 验收、Microsoft Artifact
> Signing + GitHub OIDC、可信发布者和公开二进制均移到未来可选工作，不是当前 Task 12 完成门禁。

实施时可直接使用配套的 [TASK-012 开发执行提示词](./TASK_012_DEVELOPMENT_PROMPT.md)。

## 一、任务目的

把当前“可从源码开发和构建的 Windows Pre-alpha”转换为两项边界清楚的交付：可在 GitHub 公开的
MIT 源码，以及可从固定 Git 提交重复构建、可审计并在理论上兼容 Windows 10 x64 的未签名内部 Alpha
工程。Windows 10 实机验证按 2026-09-10 所有者决定留到后续开发阶段。本任务不公开 Windows 二进制，
也不声称 Windows 10/11 实机支持、可信发布者或 SmartScreen 声誉已经完成。

本任务不以“`electron-builder` 退出码为 0”为完成标志，而要同时闭环：

1. 把已结束官方支持的 Electron 37 迁移到受支持的稳定系列；
2. 固定应用身份、版本、图标、安装与产物命名；
3. 只打包产品运行所需文件，不泄漏源码目录、测试夹具、日志、环境文件或截图用户数据；
4. 生成 Windows x64 便携版和当前用户 NSIS 安装版；
5. 建立包内容、ASAR、Electron fuses、启动、安装、升级和卸载的验证门禁；
6. 建立 Windows CI、未签名状态验证、SHA-256、内部 Draft 演练和可追溯证据；
7. 保持 Task 1–11 的路径安全、保存冲突、DOCX 备份、回收站、未保存保护和 IPC 边界。

## 二、完成后的用户与维护者体验

### 2.1 源码用户与内部测试者

- 源码用户可以在 GitHub 获取 MIT 授权的源码、许可证、第三方声明和构建说明；
- 内部测试者可以使用文件名、版本和架构明确的 portable 或安装版，但必须看到“未签名、仅内部实验”的说明；
- 内部产物的 Windows 10 x64 理论兼容性已审计，既有当前用户安装结果不要求管理员权限；实机验证
  留到后续开发阶段，不作 Windows 10/11 已实测支持声明；
- 可在“关于文枢”和 EXE 属性中看到与内部验证记录一致的版本；
- 可用 `SHA256SUMS.txt` 验证内部产物；
- 能清楚看到 Alpha 限制、签名状态、SmartScreen 预期和问题反馈入口；
- 安装、升级或卸载应用不删除、移动或修改用户工作区文档。

### 2.2 维护者

- 从干净 checkout 和锁文件可重复执行 `check → build → package → verify`；
- PR/push 只执行质量门禁，不拿到签名凭据、不发布；
- 标签或手动 release workflow 可从唯一提交生成内部 Draft 产物，但不自动公开；
- 产物列表、文件哈希、Authenticode 状态、自动/手工验收和已知限制都有固定记录。

## 三、执行前置检查

### 3.1 必读材料

WP0 必须完整阅读：

1. `README.md`；
2. `docs/architecture/PROJECT_BASELINE.md`；
3. `docs/development/DEVELOPMENT_ENVIRONMENT.md`；
4. `docs/development/TESTING.md`；
5. `docs/tasks/task-009/TASK_009_COMPLETION_REPORT.md`（文件写入、回收站与 Windows 行为）；
6. `docs/tasks/task-010/TASK_010_COMPLETION_REPORT.md`（当前 DOCX 查找与保存生命周期）；
7. `docs/tasks/task-011/TASK_011_UI_SHELL_INFORMATION_ARCHITECTURE.md`；
8. `docs/tasks/task-011/TASK_011_COMPLETION_REPORT.md`；
9. `package.json`、`package-lock.json`、`.node-version`、`.gitignore`；
10. `electron.vite.config.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/shared/desktop-api.ts`；
11. 全部打包工具、CI、签名、E2E 与版本相关新增文件。

实施时还必须核对与锁定版本一致的 Electron、electron-vite、electron-builder、Playwright、GitHub Actions
和 Microsoft Authenticode 状态验证官方文档，不使用过期博客配置或未验证片段。Artifact Signing 文档
只在未来公开二进制工作启动时重新核对。

### 3.2 当前基线

规划时已确认：

- 当前实际 Electron 为 `37.10.3`，已超出 Electron 最新三个稳定大版本的官方支持策略；
- 当前开发运行时为 Node.js `22.15.0` / npm `10.9.2`，满足 electron-builder v27 的
  Node.js `>=22.12.0` 基线；
- `check`：69 个测试文件，1175 passed / 10 条件跳过；
- `build`：main/preload/renderer 构建成功；
- 当前无 `electron-builder`、`.github/workflows/`、发布图标、LICENSE、CHANGELOG、SECURITY
  或第三方 NOTICE；
- `out/main/index.js` 运行时外部依赖包含 `jszip`、`mammoth`、`docx`；
- renderer 使用的 React、CodeMirror、Tiptap 已进入 renderer bundle，但当前都声明为
  production dependencies，打包时存在重复复制风险；
- `out/.capture-user-data/` 可包含大量 Electron 截图会话数据，必须用包内容白名单防止进入产物；
- 本地验证主机为 Windows x64；原始规划基线包含 Windows 10/11，2026-09-08 修订后当前门禁只要求
  Windows 10 x64，Windows 11 移到未来可选工作；2026-09-10 再将 Windows 10 实机矩阵移到后续开发
  阶段，当前门禁改为理论兼容性审计。

### 3.3 WP0 必须重新实测

- 开始时分支、Git 工作树和用户已有修改；
- 完整 `check`、`build`、开发/生产 Electron 启动冒烟；
- 当日 Electron 支持系列、中间稳定系列最新补丁版和 EOL 日期；
- 待选 Electron 对当前 Windows 10 x64 的支持和 breaking changes；未来 Windows 11 工作启动时再复核；
- electron-builder 待选版本、Node 需求、NSIS/portable、fuses、ASAR integrity 和签名配置形状；
- 当前 production bundle 的外部依赖、许可证、包大小与是否包含 native module；
- Playwright Electron 对待选 Electron 的支持、原生对话框替换方案与 fuse 限制；
- 本地和 GitHub Windows runner 的下载、缓存、权限和发布条件。

### 3.4 实施时的官方参考入口

以下链接是 WP0 的起点，不是对未来版本的永久冻结。实施时必须进入与锁定版本一致的官方文档和迁移说明：

- [Electron 发布时间表与 EOL](https://releases.electronjs.org/schedule)；
- [Electron 当前稳定发布](https://releases.electronjs.org/)；
- [Electron 安全清单](https://www.electronjs.org/docs/latest/tutorial/security)；
- [Electron ASAR Integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)；
- [electron-vite 生产构建](https://electron-vite.org/guide/build)；
- [electron-vite 分发指南](https://electron-vite.org/guide/distribution.html)；
- [electron-builder Windows 配置](https://www.electron.build/docs/win/)；
- [electron-builder NSIS / portable](https://www.electron.build/docs/nsis/)；
- [electron-builder Electron fuses](https://www.electron.build/docs/tutorials/adding-electron-fuses/)；
- [electron-builder Windows 代码签名](https://www.electron.build/docs/features/code-signing/code-signing-win/)；
- [Electron 的 Playwright 测试指南](https://www.electronjs.org/docs/latest/tutorial/automated-testing)；
- [Playwright Electron API](https://playwright.dev/docs/api/class-electron)；
- [GitHub Release 管理](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)；
- [GitHub Artifact Attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)；
- [Microsoft SmartScreen 应用声誉说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)。

## 四、固定产品与发布决策

### 4.1 版本、标签与唯一版本源

- 首个 Alpha 版本固定为 `0.1.0-alpha.1`；
- Git 标签固定为 `v0.1.0-alpha.1`；
- `package.json.version` 是产品版本的唯一人工维护源；
- About、EXE 版本资源、安装器、产物名、Git 标签与 Release 标题必须自动校验一致；
- 发布工作流不得通过临时 CLI 覆盖生成一个与提交中 `package.json` 不一致的版本。

现有 `v0.1.0-alpha.1` 是早于 WP7 许可/NOTICE 变更的历史内部 Draft 标签，不得移动，也不得把当前
HEAD 的本地产物冒充为该标签产物。WP8 对当前 HEAD 重新生成的 portable/NSIS 只作为本地最终验证
产物；如未来要上传新的二进制 Draft 或 Release，必须先由所有者批准新的版本和精确标签。

### 4.2 应用身份与命名

首版固定：

| 属性             | 值                            |
| ---------------- | ----------------------------- |
| `appId`          | `io.github.ravenhu001.wenshu` |
| `productName`    | `文枢`                        |
| executable name  | `WenShu`                      |
| 当前内部目标平台 | Windows 10 x64（理论兼容）    |
| 架构             | x64                           |
| 安装范围         | 当前用户（per-user）          |

`appId` 在首个对外产物后视为持久身份，不得为了修复安装路径或名称问题随意更换。
当前源码公开使用上述项目身份。未来公开二进制前，项目所有者仍需确认发布账户与签名发布者身份。

### 4.3 目标产物

内部工程只生成 Windows x64：

```text
WenShu-0.1.0-alpha.1-win-x64-portable.exe
WenShu-0.1.0-alpha.1-win-x64-setup.exe
SHA256SUMS.txt
THIRD_PARTY_NOTICES.txt
```

- portable 用于无安装的内部实验；
- NSIS 使用当前用户安装，不主动请求管理员权限；
- 首版不生成 ia32、ARM64、MSI、MSIX、AppX、web installer 或多架构合包；
- 产物文件名使用 ASCII，UI 与 Windows 显示名保留“文枢”。

### 4.4 Electron 迁移决策

- 不允许用 Electron 37 生成最终 Alpha 产物；
- WP0 必须选择当日“最新三个稳定系列”中的中间系列最新补丁版；
- 2026-08-27 的规划参考是 Electron 43 最新补丁版，不直接采用刚进入稳定的 44.0.0；
- 最终精确版本必须在 WP0 报告中记录并锁定；
- 如实施时支持窗口已变，先更新本节与 WP0 决策，不机械安装过时版本；
- Electron 大版本迁移和发布打包必须分门禁：迁移回归未通过时不进入打包实现。

### 4.5 当前发布级别与未来可选签名

当前 Task 12 范围固定为：

1. **公开交付**：GitHub 上的 MIT 源码、许可证和项目文档；
2. **内部工程交付**：Windows 10 x64 portable/NSIS，预期 Authenticode 状态为 `NotSigned`，必须明确标记
   “未签名，仅内部实验”，不得作为公开下载；
3. **未来可选工作**：Windows 11 验收、Microsoft Artifact Signing + GitHub OIDC、可信签名验证、
   时间戳、发布者、公开 Pre-release/Release 和公开 Windows 二进制。

当前不建立 Azure 资源、OIDC 联邦凭据或签名 secrets，也不把它们列为 Task 12 阻塞。自签名证书即使
未来用于测试管线，也不能写成“已受 Windows 信任”。只有所有者以后另行批准公开二进制，才启用可信
签名工作，并恢复“包内容 → fuses/ASAR integrity → 签名 → 验签/时间戳/发布者 → SHA-256 → 上传”门禁。

### 4.6 不实现自动更新

- 本任务不引入 `electron-updater`、更新服务、差分包或启动自检更新；
- 内部 Alpha 更新由受控渠道提供新安装器或新便携版；当前不向公众提供二进制更新；
- 签名、appId、版本和 NSIS 安装身份必须为后续更新留下稳定基础，但不在 Task 12 执行网络更新。

## 五、构建、包内容与应用身份不变量

### 5.1 构建阶段分层

```text
source + package-lock
  -> npm ci
  -> typecheck / lint / format:check / vitest
  -> electron-vite build (out/)
  -> electron-builder unpacked
  -> package content audit + packaged smoke
  -> portable / NSIS
  -> fuses / ASAR integrity verification
  -> verify Authenticode is NotSigned (current internal scope)
  -> SHA-256
  -> local/internal workflow artifact or Draft rehearsal
```

当前哈希必须在 `NotSigned` 状态验证之后从最终字节计算，之后不得修改产物。未来可信签名流程必须在
签名和验签完成后计算最终 SHA-256，且不得对已签名文件再做任何修改。

### 5.2 electron-builder 配置

使用独立 `electron-builder.yml`，不把大量发布配置塞入 `package.json`。配置必须：

- 显式指定 `appId`、`productName`、`executableName`、`directories.output` 和 `directories.buildResources`；
- 显式指定 x64 `portable` 与 `nsis` target；
- 使用产物命名模板，包含产品、版本、平台、架构和 target；
- 使用 ASAR，不为了“方便检查”关闭完整性；
- 不启用隐式 publish；发布必须由独立工作流显式执行；
- 配置变更需经 schema 验证或 electron-builder 自带验证，不依赖被静默忽略的未知字段。

### 5.3 包内容白名单

包内容必须从“允许集”出发，不得只在默认广泛包含上叠加几个排除规则。允许集至少包含：

- `out/main/**`；
- `out/preload/**`；
- `out/renderer/**`；
- 打包后运行必须的 `package.json` 元数据；
- 主进程未被 bundle 的必要 production dependencies 及其运行依赖。

必须确定性证明不包含：

- `src/`、`tests/`、`docs/`、`scripts/`、`.git/`、`.github/`、`.agents/`、`.codex/`；
- `.tools/`、`coverage/`、`.vite/`、日志、`*.tsbuildinfo`、`.env*`；
- `docs/visual-baselines/`、DOCX 测试夹具、临时工作区；
- `out/.capture-user-data/` 或任何 Chromium/Electron user-data；
- 签名证书、密码、token、构建机绝对路径或隐私文档。

### 5.4 依赖与包体积

- `jszip`、`mammoth`、`docx` 作为主进程运行外部依赖必须进入产物；
- 已完整打入 renderer bundle 的 React、CodeMirror、Tiptap 等依赖，应根据 electron-vite 产物实测迁移到
  `devDependencies` 或以其他确定方式防止重复；
- 不得仅为减小包体积而把真实运行依赖错误放入 `devDependencies`；
- 必须在打包目录清空后从 `npm ci` 开始复现，不依赖本机幽灵依赖；
- 记录 unpacked、portable、NSIS、`app.asar` 和 `app.asar.unpacked` 大小；
- 如包体积异常增长，必须审计文件列表而不是提高允许上限。

### 5.5 版本与 About

- 应用 UI 显示产品版本和 Alpha 标识，不再只显示泛化“Pre-alpha”；
- 版本值不得从用户可控环境变量取值；
- 开发和打包应用的 About 版本都必须与 `package.json.version` 一致；
- 如为了读取 `app.getVersion()` 增加 IPC，只能增加无参数、只读、精确形状的 runtime info 协议，
  不暴露任意 app/path/process 能力；如采用构建期常量，必须有一致性测试。

## 六、安装、运行时与安全边界

### 6.1 NSIS 固定语义

- 当前用户安装，默认不提权；
- 使用可看见安装步骤的 assisted installer，不使用无反馈的隐式安装作为首个 Alpha 默认；
- 安装位置和快捷方式不得写入用户工作区；
- 覆盖安装或升级使用同一 appId 和安装身份；
- 卸载只移除应用与安装器自己的资源，不删除任意外部 TXT/DOCX 工作区；
- 用户数据目录是否保留必须有明确、可测试语义；当前无会话恢复，不得宣称保留工作区会话。

### 6.2 Portable 固定语义

- portable 不安装快捷方式、不注册文件关联、不要求管理员权限；
- portable 不承诺“所有运行状态都保存在 EXE 旁”；Chromium userData 语义必须按实测记录；
- 便携版和安装版对工作区文件的读写、备份、冲突和回收站语义必须一致。

### 6.3 ASAR 与 Electron fuses

在候选 Electron 与 electron-builder 上验证后，至少固定：

- `runAsNode: false`；
- `enableNodeOptionsEnvironmentVariable: false`；
- `enableEmbeddedAsarIntegrityValidation: true`；
- `onlyLoadAppFromAsar: true`；
- 对其他 fuse 逐项记录“开/关/保留默认”的产品依据，不拷贝不匹配本项目的模板。

`enableNodeCliInspectArguments` 需与 Playwright Electron 连接方式联合验证。最终发布产物优先关闭；
如关闭导致 Playwright 无法驱动最终二进制，必须分离“可驱动 unpacked E2E”与“加固最终产物黑盒冒烟”，
不得为了测试便利默认弱化公开产物。

当前 renderer 使用 `BrowserWindow.loadFile()`，因此不得未经验证直接关闭所有 file-protocol 相关 fuse。
从 `file://` 迁移到自定义协议可以另行规划，不为了追求清单上的“全开/全关”而破坏生产启动。

### 6.4 现有安全基线不得回退

- `nodeIntegration: false`；
- `contextIsolation: true`；
- `sandbox: true`；
- 拒绝网页权限请求、新窗口与非预期导航；
- preload 仅暴露固定窄 API，不暴露 `ipcRenderer`、`process`、路径、shell 或通用 invoke；
- 主进程 IPC 继续验证 sender、精确参数形状和工作区边界；
- 不在打包或发布脚本中增加通用文件系统、PowerShell 或外部 URL 调用入口；
- 日志不记录正文、查询、替换内容、绝对用户路径、证书、token 或签名命令行密码。

### 6.5 签名顺序与凭据

- 当前顺序为：包内容固定 → fuses/ASAR integrity → 确认 portable/NSIS 均为 `NotSigned` → SHA-256；
- 当前 `win.sign: false` 是有意的内部范围，不配置 Azure/OIDC、证书或发布者占位值；
- 未来批准公开二进制时，优先评估 Microsoft Artifact Signing + GitHub OIDC，并只使用
  electron-builder v27 当时支持的 `win.sign` 形状，不复活已删除字段；
- 未来密钥材料和密码只存在受控证书存储、云签名身份或 GitHub Environments/Secrets；
- fork/PR 工作流不得获得签名凭据；
- 每个 EXE 都必须记录真实 Authenticode 状态；当前预期是 `NotSigned`、无发布者、无时间戳；
- 已签名不等于 SmartScreen 立即无提示，README/Release Notes 不得宣称无法保证的声誉结果。

## 七、CI、产物与 GitHub Release

### 7.1 PR/push CI

新增 `.github/workflows/ci.yml`，至少：

- 在 `windows-latest` 或 WP0 锁定的 Windows runner 上运行；
- 使用与 `.node-version` 一致的精确 Node.js 版本；
- 使用 `npm ci`，不在 CI 中执行会修改锁文件的 install；
- 运行 `check`、`build` 和不需要签名凭据的 Electron E2E；
- npm 缓存只缓存下载内容，不把 `node_modules/`、`out/` 或打包目录当成可信输入跨提交恢复；
- 默认 `permissions: contents: read`；
- 不发布、不签名、不使用生产凭据。

### 7.2 发布工作流

新增 `.github/workflows/release.yml`，固定：

- 只由手动 `workflow_dispatch` 或与 `package.json.version` 匹配的 `v*` 标签触发；
- 从标签指向的唯一提交重新 `npm ci`、`check`、`build`、package 和 verify；
- 未来公开发布/签名步骤才使用 GitHub Environment、OIDC 和人工批准；当前不接入这些权限；
- 权限按 job 最小化；只有上传 Draft Release 的 job 可获得 `contents: write`；
- 签名与未签名产物不得使用相同文件名混在同一发布中；
- 生成 `SHA256SUMS.txt`并在上传前从磁盘重新验证；
- 内部 Draft 只用于工作流演练，不自动公开；现有历史 Draft 不因当前源码更新而移动标签或替换附件；
- 工作流不自动把 Draft 改为公开 Release；当前范围明确禁止公开二进制。

### 7.3 第三方 Action 与依赖安全

- 优先使用 GitHub 官方 `checkout`、`setup-node`、`upload-artifact`、`attest`等 Action；
- 发布工作流应用完整 commit SHA 锁定第三方 Action，并用注释保留人类可读版本；
- 任何新 Action 需记录权限、维护者、版本、用途和替代方案；
- 如仓库与 GitHub 计划支持，对公开二进制生成 artifact attestation；如不支持，在完成报告中明确记录，
  不伪造 provenance 成功。

### 7.4 Release Notes

内部 Alpha 记录必须包含：

- 版本、精确提交 SHA、构建日期、Windows 与架构；如使用标签，必须与提交严格一致；
- portable 与 NSIS 的用途和安装/卸载步骤；
- 签名发布者或“未签名内部 Alpha”的显著说明；
- SHA-256 验证方法；
- 核心能力与已知限制；
- 本地文档存储、无遥测/无自动更新的当前边界；
- 问题反馈入口与提交日志时的隐私提醒；
- 降级方式：下载先前产物，不回滚、替换或删除用户工作区文档。

## 八、测试与验收要求

### 8.1 Task 1 至 Task 11 全量回归

每个会改变 Electron、electron-vite、依赖分类、主入口、preload、BrowserWindow、CSP、IPC 或产物布局的工作包都必须：

- 运行相关定向测试；
- 运行完整 `typecheck`、`lint`、`format:check`、`test`、`check`、`build`；
- 记录测试文件数、passed、failed、skipped 及跳过原因；
- 不删除、放宽或无条件跳过 Task 1–11 的安全与生命周期断言。

### 8.2 运行时迁移测试

- 开发模式和生产 `loadFile()` 都能显示主窗口；
- `app.isPackaged` 分支正确；
- BrowserWindow 安全选项和权限拒绝不变；
- 中文输入、剪贴板、原生对话框、回收站、资源管理器显示正常；
- TXT/DOCX 读取、保存、备份、冲突、外部占用和 WPS/Word 往返无回归；
- Electron 与 Node 运行时版本在 About 中正确，不暴露构建机路径。

### 8.3 包内容审计测试

新增可在本地和 CI 重复的脚本，至少断言：

- 应用入口、renderer HTML/CSS/JS 和主进程外部依赖存在；
- 包含的 `package.json` 名称、版本和 main 入口正确；
- 禁止目录和文件类型均不存在；
- 无 `.env`、PEM/PFX/P12、token 模式、测试正文、用户路径与 `.capture-user-data`；
- ASAR 可解析、完整性元数据存在，禁止文件未藏入 `app.asar.unpacked`；
- portable/NSIS 文件名、版本、架构和大小在合理范围；
- 发布产物的 SHA-256 与 `SHA256SUMS.txt` 完全一致。

### 8.4 Playwright Electron E2E

使用专用 `tests/e2e/` 和隔离的临时工作区/用户数据目录，覆盖：

- 启动应用并等待主窗口；
- 用主进程可控替换模拟 `dialog.showOpenDialog()`，不用坐标点击操作系统对话框；
- 打开临时工作区、打开 TXT、编辑、保存、重新读取并核对磁盘字节；
- 打开基础 DOCX、修改、保存，核对有效 OOXML 与备份；
- dirty 关闭取消/放弃与 saving 阻止；
- About 产品版本、Electron 版本和 Alpha 标识；
- 窗口和主进程无未处理异常、无正文/绝对路径日志；
- 测试结束后无 Electron 残留进程、无临时工作区残留。

Playwright Electron 对原生对话框和某些加固 fuse 有明确限制。对最终加固产物无法稳定驱动的项目，
必须由包内容/fuse 自动检查、黑盒启动冒烟与 Windows 人工验收共同覆盖，不得伪造“最终二进制已完整 E2E”。

### 8.5 最终产物黑盒冒烟

对 unpacked、portable 和 NSIS 安装结果分别验证：

- 真实产物 EXE 启动并稳定存活；
- 主窗口标题、进程名、图标、About 版本正确；
- 不依赖项目 `.tools/`、全局 Node.js、npm 或源码目录；
- 使用独立 userData 后终止，无崩溃、弹出主进程 JavaScript 错误或残留进程；
- 移走源码仓库或在临时目录中仍可运行；
- 最终产物与被验签/计算哈希的文件是同一份字节。

### 8.6 Windows 安装、升级与卸载

2026-09-10，所有者将 Windows 10 x64 实机矩阵移到后续开发阶段；当前门禁改为最终包理论向下兼容
审计。下列既有人工/自动结果继续作为安装与数据安全证据，但不得冒充 Windows 10 实机验证。Windows
11 矩阵同样属于未来可选工作，未执行时不得作 Windows 11 支持声明：

- 便携版从普通目录、中文目录、包含空格的目录启动；
- NSIS 安装不要求管理员，安装路径、开始菜单和卸载入口正确；
- 同版本重装与测试用 `alpha.0-test → alpha.1` 覆盖安装保持稳定 appId；
- 安装前建立的外部工作区在安装、升级、卸载后的字节和目录结构均不变；
- 安装版和便携版分别完成 TXT/DOCX 打开、编辑、保存、备份、冲突和回收站恢复；
- 使用 WPS 或 Word 与发布产物完成基础 DOCX 双向往返；
- 卸载后无应用进程、快捷方式和安装目录残留（按 NSIS 固定语义允许的 userData 除外）；
- 记录 Defender、SmartScreen 和 Authenticode 实际状态，不将本机无提示外推为所有用户无提示；
  Smart App Control 只在未来 Windows 11 矩阵中记录。

### 8.7 签名、哈希与来源

- 当前 portable/NSIS 必须逐个验证为 `NotSigned`，且文档不得声称可信发布者或时间戳；
- 最终 SHA-256 只能在包内容、fuses/ASAR integrity 和 `NotSigned` 状态确认之后生成；
- 哈希生成后不再修改 EXE；
- `SHA256SUMS.txt` 从最终产物生成，本地和下载后复验一致；
- 如内部工作流生成 artifact attestation，验证其指向正确仓库、workflow、commit 和产物；不支持时如实记录；
- 未来公开二进制才要求签名前后字节变化、可信 Authenticode、时间戳和 publisher 精确匹配，并在签名后
  生成 SHA-256；Artifact Signing/OIDC 未配置不是当前阻塞。

### 8.8 许可证、NOTICE 与隐私

- 项目所有者已选择 MIT License，版权行为 `Copyright (c) 2026 Jinxi Hu`；
- 生成与锁文件一致的第三方依赖、版本和许可证清单；
- 对要求保留版权/NOTICE 的依赖完成产物携带方式审查；
- 不把单次 `npm ls` 输出伪装成法律审计；手工例外和未解决项需记录；
- Release Notes 明确当前无遥测、无自动上传正文、无自动更新；
- 用户提交问题时不应附带隐私文档、绝对路径或未脱敏日志。

## 九、明确不在本任务范围内

- Windows 11 验收或支持声明；
- Microsoft Artifact Signing + GitHub OIDC、其他可信签名后端和公开 Windows 二进制；
- 自动更新、差分更新、强制更新或更新服务；
- Microsoft Store、MSIX、MSI、AppX、Squirrel 或 web installer；
- ARM64、ia32、通用多架构安装包；
- macOS、Linux 打包、签名或发布；
- `.txt` / `.docx` 文件关联、双击打开、自定义 URL 协议或右键 Shell 扩展；
- 崩溃收集、遥测、用户行为分析或远程日志；
- 文件系统监听、会话恢复、自动保存、设置、主题或新编辑功能；
- 变更 Task 9 文件写入/回收站语义、Task 10 查找替换语义或 Task 11 信息架构；
- 品牌注册、商标法律意见、商业许可定价或官网；
- 承诺完整 Word 无损往返或企业级部署支持。

## 十、工作包与执行顺序

必须按 WP0 至 WP8 顺序执行。每包先通过定向测试和本包门禁，再进入下一包；
不得在运行时迁移未稳定时同时调试 NSIS、签名和 CI。

### WP0：锁定基线、运行时、身份与发布语义

- 执行第三节全部前置检查；
- 锁定 Electron、electron-builder、Playwright 及 GitHub Action 版本；
- 确认 appId、版本、x64、portable/NSIS、per-user、`NotSigned` 与 MIT 源码公开边界；
- 建立依赖/许可证、bundle、包体积、启动和 Windows 基线；
- 新增 `docs/tasks/task-012/TASK_012_WP0_REPORT.md`。

门禁：无未决的应用身份、版本、架构、打包目标、运行时或当前源码公开/内部二进制边界。

### WP1：Electron 受支持运行时迁移

- 单独升级 Electron 及与构建必须的直接兼容依赖；
- 根据官方 breaking changes 最小修复主进程/preload/renderer 兼容；
- 执行全量自动门禁、开发/生产启动、Windows 原生能力与 WPS/Word 冒烟；
- 不引入打包配置或发布 UI 以外的新产品功能。

门禁：Task 1–11 基线在受支持 Electron 上全部恢复；任何安全或文件数据回归都阻止进入 WP2。

### WP2：应用身份、版本、图标与 About

- 新增发布图标与 `build/` 资源结构；
- 固定包元数据、appId、product/executable name 与版本映射；
- About 显示产品版本和 Alpha 标识；
- 增加版本一致性、图标存在性和元数据测试；
- 加入项目所有者已选择的 MIT License（Copyright 2026 Jinxi Hu）。

门禁：开发与构建 About、package version 和发布配置身份一致；图标来源和权利可追溯。

### WP3：electron-builder、产物白名单与依赖收敛

- 新增 electron-builder 精确依赖、`electron-builder.yml` 和本地 package 脚本；
- 先生成 unpacked 产物，完成包内容白名单与运行依赖收敛；
- 新增包内容审计脚本和禁止文件测试；
- 再生成 x64 portable 和 per-user NSIS；
- 记录产物大小、文件列表和依赖组成。

门禁：三类产物均可启动；必要依赖完整；禁止目录、隐私数据和开发工具不进入产物。

### WP4：ASAR、fuses、包验证与 Electron E2E

- 启用并验证 ASAR integrity 与适合本项目的 Electron fuses；
- 实现可驱动 unpacked 构建的 Playwright Electron E2E；
- 实现最终加固产物的黑盒启动、fuse 读取、包完整性与进程清理验证；
- 覆盖 TXT/DOCX、保存/备份、dirty 关闭与 About 版本的最小 E2E；
- 不为 E2E 暴露产品内通用 test IPC 或任意路径能力。

门禁：自动 E2E 与最终产物冒烟边界有真实记录；加固产物可启动，且不通过关闭安全门禁换取测试通过。

### WP5：Windows 安装、升级、卸载与真实文档验收

- 执行 8.5、8.6 的 unpacked/portable/NSIS 矩阵；
- 使用隐私安全的临时工作区验证中文/空格路径、回收站、外部占用和 WPS/Word；
- 验证安装/覆盖安装/卸载不修改外部工作区；
- 记录启动时间、安装耗时、产物大小、进程残留和 SmartScreen/Defender 实际行为。

门禁：Windows 10 x64 安装生命周期与 Task 1–11 核心文档操作均通过；任何丢失或修改用户工作区的行为都是停止发布级问题。Windows 11 不纳入当前门禁，也不得宣称已支持。

该门禁是 WP5 当时的历史计划。2026-09-10 所有者将 Windows 10 实机矩阵移到后续开发阶段；WP8 不回写
伪造 WP5 证据，改以第 11.3 当前理论兼容性门禁收尾。

### WP6：Windows CI、发布工作流与来源证据

- 实现 PR/push CI 和独立 release workflow；
- 完成版本/标签一致性、干净构建、产物上传、SHA-256 与 Draft Pre-release；
- 对 Action 版本、权限、缓存和产物保留策略进行审计；
- 条件允许时增加 artifact attestation；
- 使用无签名测试版验证完整 CI 结构，不在未批准情况下发布。

门禁：release workflow 能从版本匹配的精确标签重复生成内部 Draft 产物；PR 不能访问签名或发布权限。历史标签不得移动，当前 HEAD 不要求创建新标签。

### WP7：签名边界、许可证与 Alpha 发布文档

- 落实所有者的当前未签名内部范围，不接收或配置明文凭据；
- 验证 portable/NSIS 均为 `NotSigned`，再生成最终哈希并复验；
- 生成项目许可证、`THIRD_PARTY_NOTICES.txt`、`CHANGELOG.md`、`SECURITY.md` 和 Alpha 发布说明；
- 记录历史 Draft 的精确标签/提交边界，不移动标签，不把当前 HEAD 产物冒充为旧标签产物；
- 把 Artifact Signing + GitHub OIDC 和公开二进制明确留作未来可选工作。

门禁：未签名状态、许可证、源码公开与二进制不公开的每个声明都有可核对证据；凭据未进入仓库、日志或产物。

### WP8：整体验收、范围核对、文档与完成报告

- 审查 WP0–WP7 全部提交、产物、测试、Windows 证据、Authenticode 状态、哈希、许可证和 CI；
- 从干净 checkout 实际执行最终 `check`、`build`、package、verify 与发布演练；
- 检查 `.only`、无条件 `.skip`、超时放宽、弱化断言、密钥/绝对路径/隐私泄漏和产物污染；
- 根据证据决定“MIT 源码发布准备完成；Windows 10 x64 未签名内部 Alpha 工程完成”或保留真实阻塞；
- 更新 README、PROJECT_BASELINE、DEVELOPMENT_ENVIRONMENT、TESTING 和 Roadmap；
- 新增 `docs/tasks/task-012/TASK_012_COMPLETION_REPORT.md`，记录精确版本、产物、命令、`NotSigned`、哈希、CI、Windows 10 矩阵、限制与发布结论。

门禁：第十一节当前范围的所有勾选均有自动测试、包审计、理论兼容性、既有人工结果、未签名/哈希/
来源证据作为依据；未来 Windows 10 实机矩阵、Windows 11、签名与公开二进制不伪装成已完成，也不
阻塞当前结论。

## 十一、最终验收标准

任何勾选都必须有实际证据，不得根据配置文件“看起来正确”直接勾选。

### 11.1 运行时与回归

- [x] 最终产物使用发布时仍受 Electron 官方支持的精确稳定版；
- [x] Electron 迁移后 Task 1–11 全部自动测试、`check` 与 `build` 通过；
- [x] 开发、生产构建、unpacked、portable 与 NSIS 安装结果均可启动；
- [x] BrowserWindow、preload、IPC、权限、导航与 sandbox 安全基线无回退；
- [x] TXT/DOCX、备份、冲突、回收站、未保存保护和 WPS/Word 往返无回归。

### 11.2 身份、打包与产物

- [x] appId、productName、executable name、版本、About 和 EXE 一致；如使用标签/Draft，其 commit 与版本严格匹配；
- [x] 图标清晰、来源可追溯，在文件、任务栏、安装器和卸载入口中正确；
- [x] 可重复生成命名固定的 Windows x64 portable 和 NSIS 产物；
- [x] 产物包含完整运行依赖，不依赖源码仓库、`.tools/`、全局 Node.js 或 npm；
- [x] 包内容白名单自动验证，无源码目录、测试、日志、`.env`、凭据、隐私夹具或 userData；
- [x] ASAR、integrity 和所有固定 fuses 已从最终产物实际读取并验证；
- [x] 产物大小、文件组成、`app.asar.unpacked` 与依赖重复有审计记录。

### 11.3 安装、升级与卸载

- [x] 最终 portable/NSIS 的 Windows 10 x64 理论兼容性审计通过；实机验证留到后续开发阶段且未作已验证声明；Windows 11 未作支持声明；
- [x] per-user NSIS 默认不要求管理员，安装、重装/升级和卸载语义明确；
- [x] 中文路径、空格路径、普通用户目录和开始菜单入口验收通过；
- [x] 安装、升级、卸载和便携版切换都不修改或删除外部工作区；
- [x] 退出/卸载后无非预期 Electron 进程、快捷方式或安装目录残留；
- [x] Defender、SmartScreen 和 Authenticode 实际行为已记录；Smart App Control 留待 Windows 11 可选矩阵，文案不过度承诺。

### 11.4 CI、签名、哈希与发布

- [x] PR/push CI 从干净 checkout 运行 `npm ci`、`check`、`build` 和定义的 E2E；
- [x] PR/fork 无签名、Release write 或其他生产凭据权限；
- [x] release workflow 校验标签、版本和 commit，重新构建而不复用未知来源产物；
- [x] 内部产物记录包含精确 commit、SHA-256、`NotSigned` 状态、系统要求、已知限制和验证说明；如使用 Draft，内容与精确标签一致；
- [x] portable/NSIS 均验证为 `NotSigned`，且没有可信发布者、时间戳或公开二进制声明；
- [x] SHA-256 在最终 `NotSigned` 状态确认后生成，并在后续复验中一致；
- [x] 如条件支持 artifact attestation，其来源验证成功；如不支持，已记录真实原因；
- [x] 当前未创建或公开 Windows 二进制 Release；历史内部 Draft 未被错误更新或公开。

### 11.5 许可证、文档与质量

- [x] 项目自身许可证已由项目所有者选择并正确附带；
- [x] 第三方依赖、版本、许可证和 NOTICE 与锁文件/产物一致；
- [x] `README`、`PROJECT_BASELINE`、`DEVELOPMENT_ENVIRONMENT`、`TESTING`、`CHANGELOG`、`SECURITY` 与实际 Alpha 一致；
- [x] 不宣称未实现的自动更新、遥测、会话恢复、文件关联或多平台支持；
- [x] 无 `.only`、无新增无条件 `.skip`、无弱化断言、无超时掩盖、无凭据/隐私/绝对路径泄漏；
- [x] `TASK_012_WP0_REPORT.md` 与 `TASK_012_COMPLETION_REPORT.md` 包含可复核的命令、版本、产物、测试、Windows、签名与发布证据；
- [x] 最终结论使用“MIT 源码发布准备完成；Windows 10 x64 未签名内部 Alpha 工程完成”或记录真实阻塞，并明确没有公开 Alpha 二进制。

## 十二、失败处理与决策规则

- 待选 Electron 官方已不支持：不打包，重新选择并更新 WP0 决策；
- Electron 迁移破坏 Task 1–11 语义：停在 WP1，先修复或更换受支持系列；
- 打包后缺少模块：不用广泛 `**/*` 规则规避，先定位外部化依赖与白名单；
- 包中出现禁止文件或 userData：视为发布阻断，废弃该产物并修复规则/测试；
- fuse/ASAR integrity 导致生产无法启动：先核对官方版本和项目 file/load 语义，不盲目关闭全部加固；
- Playwright 无法驱动加固 EXE：保留可驱动 unpacked E2E，对最终产物使用黑盒冒烟和人工清单，明确限制；
- 后续 Windows 10 实机验证失败：停止 Windows 10 实测支持声明并修复，不回写伪造当前理论审计；Windows 11 未验证时保持“不作支持声明”；
- 安装/卸载碰触外部工作区：立即停止发布，保留现场且不再重试破坏性流程；
- Artifact Signing/OIDC 未配置：不是当前阻塞；保持 `NotSigned` 和内部范围，未经新授权不得公开二进制；
- SmartScreen 仍提示：核对签名与发布者后如实记录，不通过自签名、更改证书或误导文案规避；
- CI 产物与本地不同：核对 commit、锁文件、Node/Electron/builder 版本、环境和包列表，不随意接受差异；
- MIT/NOTICE 不一致或缺失：阻止源码发布准备完成结论，先修复并重新审计。

## 十三、真正执行开发时的共同规则

1. 每个 WP 开始前报告当前分支、工作树、上一恢复点、用户修改、本包范围与验证清单；
2. 先读完本任务、WP0 报告、上一 WP 产物和直接相关代码/测试；
3. 对 Electron、builder、Playwright、GitHub Actions、签名等可变工具只使用当日官方文档；
4. 任何新依赖都先记录精确版本、许可证、维护状态、下载体积、产物影响、安全面和替代方案；
5. 运行时升级、打包、E2E、CI、签名和文档分包实施，不跨包提前宣布最终成功；
6. 每包先跑定向测试，再跑完整 `check` / `build`；包相关 WP 还必须跑 package / verify；
7. 所有临时工作区、userData、证书和发布产物使用独立、已核对目录，不对仓库根执行递归删除；
8. 不修改、删除或提交用户无关变更；
9. 不记录正文、绝对用户路径、签名凭据或隐私夹具；
10. 只有证据齐全时才勾选第十一节；当前范围的外部证据缺失要明确保留未完成状态，未来 Azure/OIDC
    或 Windows 11 条件不写成当前阻塞。

## 十四、交付物

### 必须新增或完成

- `docs/tasks/task-012/TASK_012_WP0_REPORT.md`；
- `docs/tasks/task-012/TASK_012_COMPLETION_REPORT.md`；
- `electron-builder.yml`；
- `build/icon.ico` 及必要、权利可追溯的 Windows 构建资源；
- `.github/workflows/ci.yml`；
- `.github/workflows/release.yml`；
- package/verify/SHA-256/Authenticode 状态验证相关脚本；
- Playwright Electron E2E 配置与测试；
- `CHANGELOG.md`；
- `SECURITY.md`；
- MIT `LICENSE`（Copyright 2026 Jinxi Hu）；
- `THIRD_PARTY_NOTICES.txt`；
- 本地 x64 portable、NSIS、`SHA256SUMS.txt` 和内部验证记录；历史 Draft 仅作为既有 workflow 证据；
- README、PROJECT_BASELINE、DEVELOPMENT_ENVIRONMENT、TESTING 与 Roadmap 更新。

### 允许修改

- `package.json` / `package-lock.json`；
- `.gitignore`；
- `src/main/index.ts`、`src/preload/index.ts`、`src/shared/desktop-api.ts`、About 组件与相关测试；
- 与 Electron 迁移直接相关的最小产品代码；
- 构建、包审计、E2E、CI、签名与发布文档。

## 十五、完成后的下一任务入口

Task 12 完成后，建议优先从以下方向单独规划，不在本任务扩张：

1. Windows 11 x64 安装、升级、卸载、文档语义与安全策略矩阵；
2. 如所有者决定公开 Windows 二进制，再接入 Microsoft Artifact Signing + GitHub OIDC、可信验签、
   时间戳、publisher、签名后 SHA-256 和显式批准的 GitHub Pre-release；
3. 文件系统监听、外部变化提示与安全刷新；
4. 工作区/标签会话恢复、基础设置与主题；
5. Alpha 发布后的手动更新体验和后续自动更新威胁模型；
6. Windows ARM64 原生构建与单独验收；
7. 根据真实反馈修复发布阻断问题，而不预先扩张功能。
