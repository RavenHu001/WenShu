# TASK-012：Windows Alpha 发布工程

## 任务状态

> **状态：待实施。**
>
> 规划日期：2026-08-27。Task 1 至 Task 11 已完成产品核心闭环、安全文件写入、
> Windows 人工终验和桌面外壳收尾。当前工程可以在开发环境和 `out/` 生产构建中运行，
> 但尚无受支持的发布运行时、Windows 安装包/便携包、稳定应用身份、签名管线、
> 发布 CI、产物审计和可追溯的 Alpha 发布流程。

实施时可直接使用配套的 [TASK-012 开发执行提示词](./TASK_012_DEVELOPMENT_PROMPT.md)。

## 一、任务目的

把当前“可从源码开发和构建的 Windows Pre-alpha”转换为“可从固定 Git 提交重复构建、
可安装/便携运行、可验证来源和完整性、可以向受控测试者交付的 Windows x64 Alpha”。

本任务不以“`electron-builder` 退出码为 0”为完成标志，而要同时闭环：

1. 把已结束官方支持的 Electron 37 迁移到受支持的稳定系列；
2. 固定应用身份、版本、图标、安装与产物命名；
3. 只打包产品运行所需文件，不泄漏源码目录、测试夹具、日志、环境文件或截图用户数据；
4. 生成 Windows x64 便携版和当前用户 NSIS 安装版；
5. 建立包内容、ASAR、Electron fuses、启动、安装、升级和卸载的验证门禁；
6. 建立 Windows CI、签名接入点、SHA-256、GitHub Draft Pre-release 和发布证据；
7. 保持 Task 1–11 的路径安全、保存冲突、DOCX 备份、回收站、未保存保护和 IPC 边界。

## 二、完成后的用户与维护者体验

### 2.1 Alpha 测试者

- 可以下载文件名、版本和架构明确的便携版或安装版；
- 可以在 Windows 10/11 x64 普通用户下运行，当前用户安装不要求管理员权限；
- 可在“关于文枢”和 EXE 属性中看到与发布页一致的版本；
- 可用 `SHA256SUMS.txt` 验证下载产物；
- 能清楚看到 Alpha 限制、签名状态、SmartScreen 预期和问题反馈入口；
- 安装、升级或卸载应用不删除、移动或修改用户工作区文档。

### 2.2 维护者

- 从干净 checkout 和锁文件可重复执行 `check → build → package → verify`；
- PR/push 只执行质量门禁，不拿到签名凭据、不发布；
- 标签或手动发布工作流从唯一提交生成可审计产物；
- 产物列表、文件哈希、签名验证、自动/手工验收和已知限制都有固定记录。

## 三、执行前置检查

### 3.1 必读材料

WP0 必须完整阅读：

1. `README.md`；
2. `docs/PROJECT_BASELINE.md`；
3. `docs/DEVELOPMENT_ENVIRONMENT.md`；
4. `docs/TESTING.md`；
5. `docs/TASK_009_COMPLETION_REPORT.md`（文件写入、回收站与 Windows 行为）；
6. `docs/TASK_010_COMPLETION_REPORT.md`（当前 DOCX 查找与保存生命周期）；
7. `docs/TASK_011_UI_SHELL_INFORMATION_ARCHITECTURE.md`；
8. `docs/TASK_011_COMPLETION_REPORT.md`；
9. `package.json`、`package-lock.json`、`.node-version`、`.gitignore`；
10. `electron.vite.config.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/shared/desktop-api.ts`；
11. 全部打包工具、CI、签名、E2E 与版本相关新增文件。

实施时还必须核对与锁定版本一致的 Electron、electron-vite、electron-builder、
Playwright、GitHub Actions 和 Microsoft Windows 签名官方文档，不使用过期博客配置或未验证片段。

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
- 本地验证主机为 Windows x64，项目基线为 Windows 10/11、64 位优先。

### 3.3 WP0 必须重新实测

- 开始时分支、Git 工作树和用户已有修改；
- 完整 `check`、`build`、开发/生产 Electron 启动冒烟；
- 当日 Electron 支持系列、中间稳定系列最新补丁版和 EOL 日期；
- 待选 Electron 对 Windows 10/11 x64 的支持和 breaking changes；
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

### 4.2 应用身份与命名

首版固定：

| 属性            | 值                            |
| --------------- | ----------------------------- |
| `appId`         | `io.github.ravenhu001.wenshu` |
| `productName`   | `文枢`                        |
| executable name | `WenShu`                      |
| 主平台          | Windows 10 / Windows 11       |
| 架构            | x64                           |
| 安装范围        | 当前用户（per-user）          |

`appId` 在首个对外产物后视为持久身份，不得为了修复安装路径或名称问题随意更换。
对外发布前，项目所有者仍需确认“文枢 / WenShu”名称、发布账户与签名发布者身份。

### 4.3 目标产物

只生成 Windows x64：

```text
WenShu-0.1.0-alpha.1-win-x64-portable.exe
WenShu-0.1.0-alpha.1-win-x64-setup.exe
SHA256SUMS.txt
THIRD_PARTY_NOTICES.txt
```

- portable 用于无安装的受控 Alpha 试用；
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

### 4.5 签名与发布级别

区分两个里程碑：

1. **内部 Alpha 工程门禁**：可使用未签名产物验证打包、安装和功能，但必须明确标记“未签名，仅受控测试”；
2. **公开 Alpha 发布门禁**：使用受信任 Authenticode 身份签名并验签后才能发布。

自签名证书只用于测试签名流程，不写成“已受 Windows 信任”。如项目所有者尚无可用的受信任签名身份，
可完成内部 Alpha 工程门禁并创建 Draft Release，但 Task 12 不得标记为“公开 Alpha 已发布”。

### 4.6 不实现自动更新

- 本任务不引入 `electron-updater`、更新服务、差分包或启动自检更新；
- Alpha 更新由用户下载新安装器或新便携版；
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
  -> code signing (public release only)
  -> signature verification
  -> SHA-256
  -> Draft GitHub Pre-release
  -> manual release approval
```

不得对已签名文件再做任何修改；SHA-256 必须从最终已签名字节计算。

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

- 签名顺序为：包内容固定 → fuses/ASAR integrity → Authenticode 签名 → 验签 → SHA-256；
- 优先接入 Microsoft Artifact Signing 或受信任 OV/EV 证书的 CI 安全方式；
- 签名方式只通过 electron-builder v27 当前支持的 `win.sign` 形状配置，不使用已删除的旧字段；
- 密钥材料和密码只存在受控证书存储、云签名身份或 GitHub Environments/Secrets；
- fork/PR 工作流不得获得签名凭据；
- 每个 EXE 都必须记录验签结果、发布者与时间戳状态；
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
- 使用 GitHub Environment 对公开发布/签名步骤进行人工批准；
- 权限按 job 最小化；只有上传 Draft Release 的 job 可获得 `contents: write`；
- 签名与未签名产物不得使用相同文件名混在同一发布中；
- 生成 `SHA256SUMS.txt`并在上传前从磁盘重新验证；
- 先创建 Draft GitHub Pre-release，所有产物、哈希、签名和人工验收完整后才发布；
- 工作流不自动把 Draft 改为公开 Release，最终公开操作由项目所有者确认。

### 7.3 第三方 Action 与依赖安全

- 优先使用 GitHub 官方 `checkout`、`setup-node`、`upload-artifact`、`attest`等 Action；
- 发布工作流应用完整 commit SHA 锁定第三方 Action，并用注释保留人类可读版本；
- 任何新 Action 需记录权限、维护者、版本、用途和替代方案；
- 如仓库与 GitHub 计划支持，对公开二进制生成 artifact attestation；如不支持，在完成报告中明确记录，
  不伪造 provenance 成功。

### 7.4 Release Notes

首个 Alpha 必须包含：

- 版本、标签、提交 SHA、构建日期、Windows 与架构；
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

至少在 Windows 10 x64 和 Windows 11 x64 普通用户下验收：

- 便携版从普通目录、中文目录、包含空格的目录启动；
- NSIS 安装不要求管理员，安装路径、开始菜单和卸载入口正确；
- 同版本重装与测试用 `alpha.0-test → alpha.1` 覆盖安装保持稳定 appId；
- 安装前建立的外部工作区在安装、升级、卸载后的字节和目录结构均不变；
- 安装版和便携版分别完成 TXT/DOCX 打开、编辑、保存、备份、冲突和回收站恢复；
- 使用 WPS 或 Word 与发布产物完成基础 DOCX 双向往返；
- 卸载后无应用进程、快捷方式和安装目录残留（按 NSIS 固定语义允许的 userData 除外）；
- 记录 Defender、SmartScreen、Smart App Control 和 Authenticode 实际状态，不将本机无提示外推为所有用户无提示。

### 8.7 签名、哈希与来源

- 签名前产物和签名后产物字节必须不同；
- 签名后每个 EXE 的 Authenticode 验证成功，发布者与预期身份一致；
- 时间戳存在且在验证时可用；
- 签名后不再修改 EXE；
- `SHA256SUMS.txt` 从最终产物生成，本地和下载后复验一致；
- 如生成 artifact attestation，验证其指向正确仓库、workflow、commit 和产物；
- 任何签名/来源能力因账户、计划或身份验证无法使用时，完成报告必须写明真实阻塞和当前里程碑。

### 8.8 许可证、NOTICE 与隐私

- 项目所有者明确项目自身许可证，不由开发 Agent 默认选择开源或商业授权；
- 生成与锁文件一致的第三方依赖、版本和许可证清单；
- 对要求保留版权/NOTICE 的依赖完成产物携带方式审查；
- 不把单次 `npm ls` 输出伪装成法律审计；手工例外和未解决项需记录；
- Release Notes 明确当前无遥测、无自动上传正文、无自动更新；
- 用户提交问题时不应附带隐私文档、绝对路径或未脱敏日志。

## 九、明确不在本任务范围内

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
- 确认 appId、版本、x64、portable/NSIS、per-user、签名级别和许可证决策点；
- 建立依赖/许可证、bundle、包体积、启动和 Windows 基线；
- 新增 `docs/TASK_012_WP0_REPORT.md`。

门禁：无未决的应用身份、版本、架构、打包目标、运行时或公开发布签名条件。

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
- 项目许可证的最终文本只根据项目所有者选择加入。

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

门禁：Windows 10/11 x64 安装生命周期与 Task 1–11 核心文档操作均通过；任何丢失或修改用户工作区的行为都是停止发布级问题。

### WP6：Windows CI、发布工作流与来源证据

- 实现 PR/push CI 和独立 release workflow；
- 完成版本/标签一致性、干净构建、产物上传、SHA-256 与 Draft Pre-release；
- 对 Action 版本、权限、缓存和产物保留策略进行审计；
- 条件允许时增加 artifact attestation；
- 使用无签名测试版验证完整 CI 结构，不在未批准情况下发布。

门禁：从干净 Git 标签可重复生成与本地语义一致的 Draft 产物；PR 不能访问签名或发布权限。

### WP7：签名接入、许可证与 Alpha 发布文档

- 接入项目所有者选定的 Authenticode 方案，不接收明文凭据；
- 验证 portable/NSIS 签名、时间戳、发布者、签名后哈希与下载复验；
- 生成项目许可证、`THIRD_PARTY_NOTICES.txt`、`CHANGELOG.md`、`SECURITY.md` 和 Alpha 发布说明；
- 创建带完整说明的 Draft GitHub Pre-release；
- 如无受信任签名身份，保持 Draft/内部 Alpha 状态并记录真实阻塞，不伪造公开发布成功。

门禁：签名、许可证和公开发布的每个声明都有可核对证据；凭据未进入仓库、日志或产物。

### WP8：整体验收、发布决策、文档与完成报告

- 审查 WP0–WP7 全部提交、产物、测试、Windows 证据、签名、哈希、许可证和 CI；
- 从干净 checkout 实际执行最终 `check`、`build`、package、verify 与发布演练；
- 检查 `.only`、无条件 `.skip`、超时放宽、弱化断言、密钥/绝对路径/隐私泄漏和产物污染；
- 根据证据决定“内部 Alpha 工程完成”或“公开 Alpha 已发布”，不混淆两者；
- 更新 README、PROJECT_BASELINE、DEVELOPMENT_ENVIRONMENT、TESTING 和 Roadmap；
- 新增 `docs/TASK_012_COMPLETION_REPORT.md`，记录精确版本、产物、命令、签名、哈希、CI、Windows 矩阵、限制与发布结论。

门禁：第十一节所有勾选均有自动测试、包审计、Windows 人工证据、签名/来源证据或明确的外部阻塞作为依据。

## 十一、最终验收标准

任何勾选都必须有实际证据，不得根据配置文件“看起来正确”直接勾选。

### 11.1 运行时与回归

- [ ] 最终产物使用发布时仍受 Electron 官方支持的精确稳定版；
- [ ] Electron 迁移后 Task 1–11 全部自动测试、`check` 与 `build` 通过；
- [ ] 开发、生产构建、unpacked、portable 与 NSIS 安装结果均可启动；
- [ ] BrowserWindow、preload、IPC、权限、导航与 sandbox 安全基线无回退；
- [ ] TXT/DOCX、备份、冲突、回收站、未保存保护和 WPS/Word 往返无回归。

### 11.2 身份、打包与产物

- [ ] appId、productName、executable name、版本、标签、About、EXE 和 Release 一致；
- [ ] 图标清晰、来源可追溯，在文件、任务栏、安装器和卸载入口中正确；
- [ ] 可重复生成命名固定的 Windows x64 portable 和 NSIS 产物；
- [ ] 产物包含完整运行依赖，不依赖源码仓库、`.tools/`、全局 Node.js 或 npm；
- [ ] 包内容白名单自动验证，无源码目录、测试、日志、`.env`、凭据、隐私夹具或 userData；
- [ ] ASAR、integrity 和所有固定 fuses 已从最终产物实际读取并验证；
- [ ] 产物大小、文件组成、`app.asar.unpacked` 与依赖重复有审计记录。

### 11.3 安装、升级与卸载

- [ ] Windows 10 x64 和 Windows 11 x64 普通用户下安装/便携运行通过；
- [ ] per-user NSIS 默认不要求管理员，安装、重装/升级和卸载语义明确；
- [ ] 中文路径、空格路径、普通用户目录和开始菜单入口验收通过；
- [ ] 安装、升级、卸载和便携版切换都不修改或删除外部工作区；
- [ ] 退出/卸载后无非预期 Electron 进程、快捷方式或安装目录残留；
- [ ] Defender、SmartScreen/Smart App Control 和 Authenticode 实际行为已记录，发布文案不过度承诺。

### 11.4 CI、签名、哈希与发布

- [ ] PR/push CI 从干净 checkout 运行 `npm ci`、`check`、`build` 和定义的 E2E；
- [ ] PR/fork 无签名、Release write 或其他生产凭据权限；
- [ ] release workflow 校验标签、版本和 commit，重新构建而不复用未知来源产物；
- [ ] Draft Pre-release 包含完整产物、SHA-256、签名状态、系统要求、已知限制和验证说明；
- [ ] 公开 Alpha 的每个 EXE 均用预期发布者签名、带时间戳并验签成功；
- [ ] SHA-256 在签名后生成，上传前与下载后复验均一致；
- [ ] 如条件支持 artifact attestation，其来源验证成功；如不支持，已记录真实原因；
- [ ] 公开 Release 必须由项目所有者在最终产物和证据齐备后显式批准。

### 11.5 许可证、文档与质量

- [ ] 项目自身许可证已由项目所有者选择并正确附带；
- [ ] 第三方依赖、版本、许可证和 NOTICE 与锁文件/产物一致；
- [ ] `README`、`PROJECT_BASELINE`、`DEVELOPMENT_ENVIRONMENT`、`TESTING`、`CHANGELOG`、`SECURITY` 与实际 Alpha 一致；
- [ ] 不宣称未实现的自动更新、遥测、会话恢复、文件关联或多平台支持；
- [ ] 无 `.only`、无新增无条件 `.skip`、无弱化断言、无超时掩盖、无凭据/隐私/绝对路径泄漏；
- [ ] `TASK_012_WP0_REPORT.md` 与 `TASK_012_COMPLETION_REPORT.md` 包含可复核的命令、版本、产物、测试、Windows、签名与发布证据；
- [ ] 最终结论明确区分“内部 Alpha 工程完成”和“公开 Alpha 已发布”。

## 十二、失败处理与决策规则

- 待选 Electron 官方已不支持：不打包，重新选择并更新 WP0 决策；
- Electron 迁移破坏 Task 1–11 语义：停在 WP1，先修复或更换受支持系列；
- 打包后缺少模块：不用广泛 `**/*` 规则规避，先定位外部化依赖与白名单；
- 包中出现禁止文件或 userData：视为发布阻断，废弃该产物并修复规则/测试；
- fuse/ASAR integrity 导致生产无法启动：先核对官方版本和项目 file/load 语义，不盲目关闭全部加固；
- Playwright 无法驱动加固 EXE：保留可驱动 unpacked E2E，对最终产物使用黑盒冒烟和人工清单，明确限制；
- Windows 10 与 Windows 11 行为不一致：不用单机成功替代矩阵，先界定支持范围或修复；
- 安装/卸载碰触外部工作区：立即停止发布，保留现场且不再重试破坏性流程；
- 签名凭据不可用：可完成内部 Alpha 工程，但不发布或宣称公开 Alpha 完成；
- SmartScreen 仍提示：核对签名与发布者后如实记录，不通过自签名、更改证书或误导文案规避；
- CI 产物与本地不同：核对 commit、锁文件、Node/Electron/builder 版本、环境和包列表，不随意接受差异；
- 项目许可证尚未决定：不由 Agent 代替项目所有者选择，公开 Release 保持 Draft。

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
10. 只有证据齐全时才勾选第十一节；外部账户/身份阻塞要明确保留未完成状态。

## 十四、交付物

### 必须新增或完成

- `docs/TASK_012_WP0_REPORT.md`；
- `docs/TASK_012_COMPLETION_REPORT.md`；
- `electron-builder.yml`；
- `build/icon.ico` 及必要、权利可追溯的 Windows 构建资源；
- `.github/workflows/ci.yml`；
- `.github/workflows/release.yml`；
- package/verify/SHA-256/签名验证相关脚本；
- Playwright Electron E2E 配置与测试；
- `CHANGELOG.md`；
- `SECURITY.md`；
- 项目所有者选定的 LICENSE 或明确的权利保留文件；
- `THIRD_PARTY_NOTICES.txt`；
- x64 portable、NSIS、`SHA256SUMS.txt` 和 Draft Pre-release；
- README、PROJECT_BASELINE、DEVELOPMENT_ENVIRONMENT、TESTING 与 Roadmap 更新。

### 允许修改

- `package.json` / `package-lock.json`；
- `.gitignore`；
- `src/main/index.ts`、`src/preload/index.ts`、`src/shared/desktop-api.ts`、About 组件与相关测试；
- 与 Electron 迁移直接相关的最小产品代码；
- 构建、包审计、E2E、CI、签名与发布文档。

## 十五、完成后的下一任务入口

Task 12 完成后，建议优先从以下方向单独规划，不在本任务扩张：

1. 文件系统监听、外部变化提示与安全刷新；
2. 工作区/标签会话恢复、基础设置与主题；
3. Alpha 发布后的手动更新体验和后续自动更新威胁模型；
4. Windows ARM64 原生构建与单独验收；
5. 根据 Alpha 真实反馈修复发布阻断问题，而不预先扩张功能。
