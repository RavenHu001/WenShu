# TASK-012 WP0 报告：基线、运行时、身份与发布语义

简体中文 | [English](./TASK_012_WP0_REPORT.en.md)

[任务档案](../README.md) · [文档中心](../../README.md)

> 记录日期：2026-08-28；分支：`TASK-12`；基线提交：`fc6309fcf3668905cd2c05f867049601e6abe061`。
>
> 本包仅完成调查、实测、版本锁定与本报告；没有修改产品代码、依赖、锁文件、打包配置、标签或 Release。

## 1. 范围与起始状态

已完整阅读 Task 12 主提示词、Task 12 规划及其 3.1 节所列材料（README、项目/环境/测试基线、
Task 9–11 报告与 Task 11 信息架构、package/lock、构建配置、main/preload/shared API），并审阅
直接相关的启动、截图与运行时测试文件。仓库没有适用的 `AGENTS.md`。

开始和结束时工作树均为干净状态；没有用户修改需要保护。当前 Electron 安全基线未变：
`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`，preload 只暴露固定形状的
Desktop API。

当前仓库没有 `electron-builder`、Playwright、打包配置、`.github/workflows/`、发布图标、项目
LICENSE、CHANGELOG、SECURITY 或第三方 NOTICE 文件。`package.json` 当前版本仍是 `0.1.0`；
这是 WP2 才能改动的产品元数据，WP0 不提前改写。

## 2. 实测基线

### 2.1 命令与结果

| 命令                                                                      | 实测结果                                                                                                                                     |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `.\scripts\npm.cmd run check`                                             | 退出码 0；69 个测试文件通过，1175 passed、10 skipped、0 failed；typecheck、lint（0 warning）和 Prettier 均通过。                             |
| `.\scripts\npm.cmd run build`                                             | 退出码 0；main 154,951 B、preload 4,103 B、renderer HTML 约 0.57 kB、CSS 53.24 kB、JS 2,263.67 kB。                                          |
| `.\scripts\dev.cmd -- --user-data-dir=<isolated-temp>`                    | 在可运行 Windows 会话中成功：Vite loopback server ready、main/preload 构建成功、Electron 启动；观测到 4 个本次 Electron 进程，终止后残留 0。 |
| `.\scripts\npm.cmd exec -- electron . -- --user-data-dir=<isolated-temp>` | 在可运行 Windows 会话中成功：观测到 4 个本次 Electron 进程，终止后残留 0。                                                                   |

开发和生产烟测都使用新建的系统临时 userData 目录，结束时只清理经过路径校验的临时目录；没有触及
工作区文件或已有的 `out/` 数据。受限执行沙箱曾因 GPU 子进程依赖与缓存权限而在窗口出现前退出；
这是环境限制而不是绿色证据，故以上表中的 Windows 会话实测才作为本包烟测证据。

10 个 skipped 都是既有、条件化的 symlink/junction 权限用例：TXT 读取 2、DOCX 读取 2、TXT
搜索 1、混合搜索 1、工作区解析 1、移动 1、回收站 1、资源管理器显示 1。相应拒绝路径仍由 mock
覆盖；本包没有增加 skip、timeout 或弱化断言。

本机为 Windows `10.0.26200.9168`、AMD64、64 位操作系统。它只能构成一个 Windows 主机证据，
不能替代 WP5 的 Windows 10/11 普通用户安装、升级、卸载和 Office/WPS 矩阵。

### 2.2 当前解析版本与依赖事实

| 项目               | `package.json` 声明                       | lock / 实际解析版本 | WP0 判断                                              |
| ------------------ | ----------------------------------------- | ------------------- | ----------------------------------------------------- |
| Node.js            | `.node-version` 为 `22.15.0`；`>=22.12.0` | `v22.15.0`          | 固定，满足后续 builder v26/v27 的 Node 22.12 基线。   |
| npm                | `packageManager: npm@10.9.2`              | `10.9.2`            | 固定。                                                |
| Electron           | `^37.2.0`                                 | `37.10.3`           | 已于 2026-01-13 EOL；不得生成 Alpha。                 |
| electron-vite      | `^4.0.0`                                  | `4.0.1`             | WP1 保持，除非 Electron 43 迁移有官方或实测兼容证据。 |
| Vite               | `^7.0.0`                                  | `7.3.6`             | 当前 build 成功；不在 WP1 顺手升级。                  |
| Vitest             | `^3.2.4`                                  | `3.2.7`             | 当前 69 文件基线；不在 WP1 顺手升级。                 |
| electron-builder   | 未安装                                    | 未安装              | WP3 计划精确引入 `26.15.3`，不使用 caret。            |
| `@playwright/test` | 未安装                                    | 未安装              | WP4 计划精确引入 `1.62.1`，不使用 caret。             |

`out/main/index.js` 的非 Node/Electron 外部运行时 import 精确为 `jszip@3.10.1`、
`mammoth@1.12.1`、`docx@9.7.1`；它们在 WP3 必须作为主进程运行依赖进入允许集。其直接 package
许可证分别为 `(MIT OR GPL-3.0-or-later)`、BSD-2-Clause、MIT。此为工程清单，不构成法律许可审计。

renderer 已打入单一 Vite asset（2,263.67 kB）的直接库包括 React/React DOM `19.2.7`、CodeMirror
（commands `6.10.4`、search/state `6.7.1`、view `6.43.8`）以及 Tiptap `3.29.2`（core/react/
starter-kit/pm 和当前扩展）。这些直接库均声明 MIT；它们仍列在 production dependencies，因此 WP3
必须用产物与 main/preload import 事实检查是否可安全移动，不能仅凭体积猜测。

扫描得到的 `.node` 文件仅是 dev/build 期的两个 Rollup Windows x64 optional binary
（MSVC、GNU）；`docx`、`jszip`、`mammoth` 三棵主进程运行依赖树中没有 `.node` 或 `.dll`。当前没有
需按 Electron ABI 重建的应用原生模块。

## 3. 当前 out/ 与包内容风险

`out/` 不是发布包，也还没有 `app.asar`、unpacked、portable 或 NSIS 产物。build 本身的
main/preload/renderer 合计约 2,476,530 B；但当前 `out/` 总计 68,752,804 B，其中
`out/.capture-user-data/` 有 130 个文件、66,276,274 B。

该目录含 Chromium/Electron 的 Cache、Code Cache、GPUCache、Cookies、Local Storage、Session
Storage、Network、Preferences、Local State 与 Shared Dictionary。它属于 Task 12 明确禁止的数据，
可能包含会话或隐私信息。WP0 不删除它，也不将其当作产品产物；WP3 必须采用允许集式 files 配置与
自动审计，确定性排除它及 `src/`、`tests/`、`docs/`、`scripts/`、`.tools/`、日志、`.env*`、证书
与其他 userData。此项是进入任何可分发包之前的发布阻断。

## 4. 当日官方来源与锁定决策

所有可变结论只采用下列官方/一级来源，访问日期均为 2026-08-28。

### 4.1 Electron

- [Electron 发布计划与 EOL](https://releases.electronjs.org/schedule)：当前受支持稳定线为
  44（EOL 2027-03-02）、43（EOL 2027-01-05）、42（EOL 2026-10-20）；41 已于 2026-08-25 EOL。
- [Electron 稳定发布记录](https://releases.electronjs.org/release?channel=stable) 与
  [43.4.1 GitHub release](https://github.com/electron/electron/releases/tag/v43.4.1)：中间受支持线的
  最新已发布补丁为 `43.4.1`，故 **WP1 迁移目标锁定为 `electron@43.4.1`**。
- [Electron 43 发布说明与 breaking changes](https://www.electronjs.org/blog/electron-43-0/)：需要复核的
  变化是下载默认打开 Downloads、带 profile 的 nativeImage 像素归一为 sRGB、Linux 无边框窗口圆角及
  WCO 的 Linux 原生标题栏布局、Linux `dialog.showHiddenFiles` 移除。当前代码没有下载、nativeImage、
  无边框/WCO 或该 Linux dialog 选项，且发布目标为 Windows x64；仍必须在 WP1 实测安全窗口、原生
  对话框、回收站、TXT/DOCX 生命周期。

Electron 43.4.1 实测带 Chromium 150.0.7871.224、Node 24.18.1、V8 15.0.245.28 的运行时升级；应用构建 Node 仍由项目本地
`22.15.0` 提供，二者不是同一个运行时。不得以 `^43` 或 `latest` 替代锁定版本。

### 4.2 electron-builder、NSIS、ASAR、fuses 与签名

- [npm 的 electron-builder 稳定发布](https://www.npmjs.com/package/electron-builder)：当日 `latest` 为
  **`26.15.3`**；`27.0.0` 仍是预发布，不能作为“当前稳定版”锁定。
- [Windows 配置 schema](https://www.electron.build/docs/configuration/)、
  [Windows target](https://www.electron.build/docs/win/) 与
  [NSIS/portable](https://www.electron.build/nsis/)：schema 支持 `nsis`、`portable`、`dir` 等目标；WP3
  采用 x64 `portable` 与 assisted、per-user NSIS，不做 web installer、MSI、MSIX、ARM64 或 ia32。
- [v27 迁移说明](https://www.electron.build/docs/migration/whats-new-v27/) 与
  [v27 breaking changes](https://www.electron.build/docs/migration/v27-breaking-changes/)仅作为未来升级资料：
  v27 需要 Node >=22.12 且改为 ESM、schema/工具集行为也有变化。它不是本包拟安装版本；若 WP3 前
  v27 转为稳定，必须重新查证并由一个明确决策替换本报告的 `26.15.3`。
- [Electron fuses 指南](https://www.electron.build/docs/tutorials/adding-electron-fuses/) 与
  [Electron ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)：fuses 必须在
  签名前对最终 EXE 读取验证；ASAR integrity 与现有 `loadFile()` 布局须在 WP4 由真正产物验证，不能
  在 WP0 预设为已启用。
- [Windows 签名配置](https://www.electron.build/docs/features/code-signing/code-signing-win/)：`win.sign`
  可使用 signtool、HSM、PKCS#11 或 Azure，发布者名须与证书 subject 精确一致；签名、时间戳与验签
  必须发生在最终字节和 SHA-256 之前/之后的正确顺序中。

### 4.3 Playwright

- [Playwright Electron API](https://playwright.dev/docs/api/class-electron) 与
  [npm 当前稳定包](https://www.npmjs.com/package/%40playwright/test)：**WP4 目标锁定
  `@playwright/test@1.62.1`**（Apache-2.0）。Electron automation 是 experimental，支持 Electron
  v14+；原生 `dialog` 不会被 Playwright 拦截，测试应在 main process 可控替换 dialog 方法；若把
  `EnableNodeCliInspectArguments` / `nodeCliInspect` fuse 设为 false，Electron launch 会超时。

因此 WP4 必须把可驱动的 unpacked E2E 与最终加固产物的黑盒启动、包/fuse 审计和 Windows 人工验收
分开；不得宣称最终 EXE 被完整 Playwright 驱动。

### 4.4 GitHub Actions 与来源

- [GitHub workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)：
  工作流显式声明任一权限时，未列出的权限均为 none。
- [Artifact Attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)：
  二进制 attestation 需要 `contents: read`、`id-token: write`、`attestations: write`；Free/Pro/Team 的
  私有或 internal 仓库不具资格，需 Enterprise Cloud。是否有资格仍待仓库所有者/计划确认。
- [官方 actions/setup-node 发布](https://github.com/actions/setup-node/releases)、
  [upload-artifact 文档](https://github.com/actions/upload-artifact) 与
  [actions/attest 文档](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)：
  WP6 计划使用精确 tag `actions/checkout@v5.0.0`、`actions/setup-node@v6.4.0`、
  `actions/upload-artifact@v4.6.2`、`actions/attest@v4.1.1`。实现时必须再次从各官方 release 解析为
  完整 40 位 commit SHA，并在 YAML 注释标注上述人类可读版本；PR job 只需 `contents: read`，签名/
  Draft Release job 才可在保护 Environment 审批后取得所需的 `contents: write` 与 signing/OIDC 权限。

### 4.5 Microsoft Authenticode、SmartScreen 与 Smart App Control

- [Microsoft SmartScreen 声誉说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)：
  未签名与自签名二进制都会显示相当于未知的警告；即使可信签名，新文件也可能在声誉积累前提示。
  Artifact Signing（原 Trusted Signing）是非 Store 分发的推荐服务，但仍需要身份验证，且不能保证
  首次下载无 SmartScreen。
- [Authenticode 时间戳](https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures)：
  应使用 SHA-256、RFC 3161 时间戳；没有时间戳，证书到期后签名会失效。
- [Smart App Control 概览](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview)：
  Windows 11 的 Smart App Control 可阻止未知/未签名代码；可信根 CA 的签名是允许信号之一，政策和
  声誉也会影响结果。不得将本机行为外推为所有用户结果。

结论：内部 Alpha 可明确标注未签名并仅做受控测试；**公开 Alpha 必须等待项目所有者确认的、受信任
Authenticode 身份，完成 SHA-256、时间戳与验签后才有资格发布**。本包没有证书、私钥、token 或真实
签名凭据。

## 5. 固定产品与发布语义

下列是 Task 12 已给定的 WP0 决策，尚未写进产品配置，待 WP2/WP3 以测试同步实现：

| 属性                 | 锁定值                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 首个版本 / tag       | `0.1.0-alpha.1` / `v0.1.0-alpha.1`                                                                                                       |
| application identity | `io.github.ravenhu001.wenshu`                                                                                                            |
| 显示名 / EXE 基础名  | `文枢` / `WenShu`                                                                                                                        |
| 平台与架构           | Windows 10 / Windows 11，x64                                                                                                             |
| 产物                 | ASCII `WenShu-0.1.0-alpha.1-win-x64-portable.exe`、`WenShu-0.1.0-alpha.1-win-x64-setup.exe`、`SHA256SUMS.txt`、`THIRD_PARTY_NOTICES.txt` |
| 安装语义             | assisted、当前用户 per-user NSIS；默认不提权                                                                                             |
| 明确非目标           | 自动更新、遥测、文件关联、ia32、ARM64、Store/MSIX/MSI、macOS、Linux                                                                      |
| 发布分级             | 未签名产物仅内部 Alpha；公开 Alpha 需受信任 Authenticode 签名与验签                                                                      |

## 6. 必须由项目所有者决定的真实门禁

1. **项目许可证与权利文本**：仓库没有项目 LICENSE；不得由本包推断开源、source-available 或保留
   权利。第三方依赖和其 transitive NOTICE 也要在 WP7 进行可追溯审计。
2. **品牌与图标**：`文枢 / WenShu` 仍是暂定名称，且当前没有权利可追溯的发布 ICO；所有者需确认
   名称、图标来源与对外发布者身份。
3. **公开签名身份**：没有受信任 Authenticode/Artifact Signing 身份、账户授权、publisher subject 或
   安全凭据入口。自签名不能被描述为受 Windows 信任。
4. **公开发布授权与 GitHub 条件**：未授权创建/push tag、上传或创建/发布 Release；GitHub 仓库可见性、
   计划和 Environment/required-reviewer 设置也未知，故 attestation 与公开 Release 资格未确认。

## 7. 后续验证计划

- **WP1**：仅迁移到 `electron@43.4.1`，再运行 typecheck、lint、format:check、全量 Vitest、check、
  build、开发/生产 Electron 烟测，以及 Windows 原生、TXT/DOCX、备份、冲突、回收站和关闭保护回归。
- **WP2**：在所有者确认名称/图标权利后实现唯一版本源、appId、图标与 About 一致性测试。
- **WP3**：精确安装 `electron-builder@26.15.3`，建立目录白名单，先出 unpacked 再出 portable/NSIS，
  审计包内 `app.asar`、`app.asar.unpacked`、运行时依赖、禁止数据和尺寸。
- **WP4–WP8**：引入锁定的 Playwright Electron E2E、ASAR/fuse 验证、Windows 生命周期矩阵、最小权限
  CI、签名/哈希/attestation、许可证与 Draft Release；所有公开声明均以后续真实证据为准。

## 8. WP0 结论

**技术调查、基线实测与运行时锁定：通过。** 当前 Task 1–11 自动门禁、构建、开发/生产启动和安全
边界都有可复核的基线；Electron 43.4.1 是当日规则要求的中间受支持精确版本。

**Task 12 的正式 WP0 发布门禁：未通过，暂不可进入 WP1。** 原因不是代码回归，而是第 6 节的项目
所有者决策（至少许可证、品牌/图标与对外身份、公开签名身份/授权）尚未确认，且当前 `out/` 已发现
必须由 WP3 白名单阻断的 userData 风险。后者不会阻止受控的 WP1 Electron 迁移实现，但在严格的
“每包门禁后才进入下一包”规则下，只有所有者明确这些决策或明确授权以“内部 Alpha、公开发布仍阻塞”
继续后，才应开启 WP1；无论哪种情况，都不得提前打包、签名或发布。
