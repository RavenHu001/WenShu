# TASK-012 完成报告：Windows Alpha 发布工程

> WP8 验收日期：2026-09-09。本文记录实际执行结果；历史 WP0–WP7 报告保持原样，
> 不把后来的范围决定或本轮结果追写成历史事实。

## 1. 结论

WP8 的代码审计、构建、打包、产物检查和文档收尾已经执行，但 Task 12 **尚未达到**预期的
“MIT 源码发布准备完成；Windows 10 x64 未签名内部 Alpha 工程完成”。第十一节 33 项中
26 项有足够证据并已勾选，7 项保留。当前没有获准或执行公开 Windows 二进制发布。

真实阻塞是：

1. 当前主机内核为 `10.0.26200.9445`。Windows 产品名兼容接口虽返回“Windows 10 Home”，
   但 build 26200 属于 Windows 11 25H2，故本轮 portable/NSIS 结果不能充当 Windows 10 证据；
2. 没有在真实 Windows 10 x64 普通用户会话中对**最终** Electron 43.6.0 产物重跑安装、覆盖安装、
   卸载、中文/空格路径、残留和安全产品行为；
3. 当前仓库的 artifact attestation 资格/启用状态无法从远程核实，不能把“未知”写成“不支持”。

2026-09-08 的所有者范围修订已经替代历史报告中的三个旧门禁：Windows 11 验收、可信签名、公开
Windows 二进制均是未来可选工作，不是上述当前阻塞。WP5 因缺 Windows 11、WP7 因缺可信签名而给出的
旧“不通过”结论仍作为当时记录保留，但不再沿用为当前失败原因。

## 2. 范围、基线与工作树

- 分支：`main`；开始时 `main...origin/main` 且工作树干净；未发现用户修改。
- WP8 开始基准：`0a474b92e73c9d9bb0bcfcf8b4a96ce2d7a61ab5`；当前精确产品提交及
  `origin/main`：`98b05b416bd00ce21cc465cea8be66ea02a90236`。
- 远程标签：`v0.1.0-alpha.1` → `0a474b92e73c9d9bb0bcfcf8b4a96ce2d7a61ab5`（WP8 中以
  `git ls-remote` 只读确认）；本地未刷新的同名 ref 仍指向 `c073f1fbb4b2bef3370d0e9b10d21d74de974d87`。
  本轮未 fetch、移动或改写标签，也未覆盖既有 Draft。
- 当前版本：`0.1.0-alpha.1`；`appId` 为 `io.github.ravenhu001.wenshu`；产品名“文枢”；
  可执行文件名 `WenShu`。
- 工具链：Node.js `22.15.0`、npm `10.9.2`、Electron `43.6.0`、electron-vite `4.0.1`、
  electron-builder `27.0.0-alpha.8`、Playwright `1.62.1`。
- Electron 43.6.0 内置运行时：Chromium `150.0.7871.250`、Node.js `24.20.0`、V8
  `15.0.245.31`（Electron 官方 release metadata；构建 Node 与内置 Node 不混用）。
- 最终锁文件 SHA-256：`DCDDD42A75BF1FC07D6D12622559726197D5918BDCFB26399C4BA5CEED92ADE8`。
- 执行助手没有 push、tag、GitHub Release、签名、证书、OIDC 或 Windows 11 支持工作；项目所有者随后
  将 WP8 产品提交 `98b05b4` push 到 `main` 并提供成功 CI 截图。

本轮验收发现并修复两个 Task 12 范围内问题：Electron 43 中线不是当日最新补丁，已精确升级
`43.4.1 → 43.6.0`；builder 会从 Git remote 推断更新源并在包外写入 `resources/app-update.yml`，
现显式设置 `publish: null` 并把该文件纳入包审计禁止项。包审计同时验证 `app.asar.unpacked`
中的每个文件在 ASAR 索引中有对应项。没有新增产品功能。

## 3. 干净安装与命令记录

首次命令从上述干净基准和提交中的 `package-lock.json` 开始；Electron 补丁升级后，后续最终门禁从
更新后的锁文件重新干净安装。失败尝试也保留：

| 命令/动作                                        | 退出码 | 实际结果                                                            |
| ------------------------------------------------ | -----: | ------------------------------------------------------------------- |
| `npm ci`（系统 npm cache）                       |      1 | npm 10.9.2 报 `Exit handler never called`，日志目录也不可写         |
| `npm ci --cache .tools/npm-cache`（受控环境）    |   中断 | Electron 下载等待无进展，人工中断，不计通过                         |
| 同命令，临时 `ELECTRON_MIRROR`，普通用户网络会话 |      0 | 559 packages；仅有 3 个已知传递依赖 deprecated 警告                 |
| Electron 升级后的首次 `npm ci`                   |   中断 | Electron 运行时下载无进展，人工中断                                 |
| 升级后干净 `npm ci`，临时镜像                    |      0 | 559 packages；锁文件安装成功                                        |
| `npm run notices:generate`                       |      0 | 103 个第三方包；Electron 更新为 43.6.0                              |
| `npm run typecheck`                              |      0 | 5 个 tsconfig 全部通过                                              |
| `npm run lint`                                   |      0 | `--max-warnings=0`                                                  |
| `npm run format:check`                           |      0 | 全部文件符合 Prettier                                               |
| `npm test`                                       |      0 | 73 个测试文件，1184 通过，10 条件跳过，0 失败                       |
| `npm run check`                                  |      0 | 类型、lint、格式、NOTICE 和完整普通测试全部通过                     |
| `npm run build`                                  |      0 | main 155.17 kB；preload 4.30 kB；renderer JS 2264.13 kB             |
| 首次最终 `npm run package:dir`                   |      1 | 干净安装后 Electron dist 不存在，正确阻断                           |
| `npx install-electron --no`（临时镜像）          |      0 | 安装并实测 Electron `v43.6.0`                                       |
| `npm run package:dir`（重试）                    |      0 | unpacked 生成并自动审计通过                                         |
| `npm run package:win`                            |      0 | portable/NSIS 生成并自动审计通过                                    |
| `npm run package:verify -- --mode=win`           |      0 | 最终包内容、架构、ASAR 和依赖审计通过                               |
| `npm run test:e2e`                               |      0 | 1 文件、4 用例全部通过；前后残留进程均为 0                          |
| `npm run release:manifest:unsigned`              |      0 | 先验证 `NotSigned`，再生成两项 SHA-256 清单                         |
| `npm run release:verify:unsigned`                |      0 | 两个 EXE 状态与哈希复验一致                                         |
| release workflow 本地 dry-run                    |      0 | 版本/标签/manifest 结构通过；检测到历史标签不指向当前基准并拒绝冒充 |

10 个条件跳过全部是本机权限能力探测后的真实 symlink/junction 用例：read text 2、read DOCX 2、
workspace search 2、resolve 1、relocate 1、trash 1、reveal 1；相同拒绝分支有 mock 适配器确定性覆盖。
仓库没有 `.only` 或无条件 `.skip`，未新增或放宽超时。

开发态第一次在受控沙箱内退出码 1，Chromium 报 GPU/cache 权限失败；加入独立 userData 与
`--disable-gpu` 后仍为退出码 1。在普通用户桌面会话执行同一开发命令后，实际观察到 4 个 Electron
进程和标题为“文枢”的主窗口，`Ctrl+C` 后残留 0，临时 userData 已删除。生产构建由 E2E 使用
`electron .` 启动；unpacked、portable 和安装结果另经黑盒进程/窗口检查。

## 4. 最终产物、签名与哈希

这些文件来自随后形成 `98b05b416bd00ce21cc465cea8be66ea02a90236` 的 WP8 产品输入，只供本地
验收，不对应历史标签或 Draft。提交后复核确认当前相对该提交的差异只有文档、release workflow Action
升级及其测试；`package.json`、锁文件、builder 配置、包审计、LICENSE/NOTICE、源码和构建资源均与
该提交一致：

| 文件                                    |        字节 | SHA-256                                                            | Authenticode          |
| --------------------------------------- | ----------: | ------------------------------------------------------------------ | --------------------- |
| `WenShu-0.1.0-alpha.1-portable-x64.exe` | 104,083,530 | `7e4845bd05c93d43c59cb9fe792d739d92935cdd385a5b63f447421af017e91f` | `NotSigned`，无时间戳 |
| `WenShu-0.1.0-alpha.1-setup-x64.exe`    | 104,390,327 | `3f43e84e1935e4e77b7c75088395914cd4408e41d3cc36af24341ad63b215c2d` | `NotSigned`，无时间戳 |

`SHA256SUMS.txt` 恰有上述两项；生成顺序是先确认 `NotSigned`，后写清单，再重新读取文件、签名状态和
哈希验证。两者 PE machine 均为 `0x8664`（x64）。不得将哈希解释为发布者身份或可信签名。

unpacked 总大小 391,191,778 字节；`app.asar` 12,603,302 字节、1021 个索引项；
`app.asar.unpacked` 748,156 字节、51 个文件，0 个未索引文件；完整 unpacked 树 128 个文件，
禁止项 0。包内 LICENSE、`THIRD_PARTY_NOTICES.txt`、产品 package metadata、main/preload/renderer 和
运行依赖均存在；源码目录、测试、日志、环境文件、凭据、隐私夹具、userData 和 `app-update.yml`
均不存在。脱离源码仓库复制后可启动；移除 `app.asar` 的破坏性副本退出码 1 且无残留，证明没有
回退到外部源码。

从最终 unpacked 读取的 fuses：RunAsNode disabled、NODE_OPTIONS disabled、Node CLI inspect
disabled、ASAR integrity enabled、only-load-app-from-ASAR enabled；cookie encryption、
browser-specific V8 snapshot disabled，file-protocol extra privileges enabled。与 Task 12 固定策略一致。

## 5. Electron E2E 与黑盒结果

Electron E2E 4 项：启动/About 身份与版本；TXT 精确字节打开保存；DOCX 生成、保存和 `.wenshu.bak`
有效；dirty 标签关闭时取消保护。E2E 前后 Electron/WenShu 匹配进程均为 0。

在当前主机的普通用户会话中，本轮最终文件还完成了以下自动黑盒检查，但因主机实际是 Windows 11
25H2，**这些结果不计入 Windows 10 门禁**：

- portable 从独立中文加空格路径启动：4 个进程、1 个“文枢”窗口，退出后残留 0；
- NSIS 首次安装退出码 0，默认 per-user 安装目录和开始菜单“文枢”快捷方式存在；
- 安装版启动为 4 个进程、1 个“文枢”窗口；同版本覆盖安装退出码 0；
- 卸载退出码 0，安装目录和快捷方式消失；外部合成工作区 manifest/hash 前后完全一致；
- unpacked 脱离仓库启动为 4 个进程、1 个“文枢”窗口；全部临时目录清理，最终残留 0。

本机 Microsoft 365 Word `16.0.20326.20132` 能打开合成 DOCX 并读到预期文字，但文档被报告为
只读，`Save` 不可用；`SaveAs2` 尝试挂起后已中断并清理 Word 进程。WPS 未安装。没有把这些失败/缺失
写成当次 Office 往返通过。项目所有者随后明确确认可以沿用真正构筑这些功能时的 Word/WPS、备份、
冲突、回收站与完整文件生命周期人工验收；结合当前 1184 项自动回归和最终 E2E，11.1.5 因此记为
通过，不再作为当前阻塞。

Defender 状态查询返回 Access Denied；组策略 SmartScreen 查询没有可用值；本地生成文件没有
Zone.Identifier，所以没有触发下载声誉路径。两个 EXE 的 `NotSigned` 是确定证据；Defender/SmartScreen
是否放行不是。本轮未测试或声明 Windows 11 Smart App Control 支持。

WP5 曾记录“Windows 10 Home version 2009”和所有者手动通过，但没有 OS build；本轮发现同一产品名
接口与 `10.0.26200.9445` 内核冲突。因此旧报告仍保留为历史证据，却不足以证明最终 43.6.0 产物已在
Windows 10 build 19045 普通用户环境通过。

## 6. CI、来源和发布边界

CI/release workflow 静态审计通过：Action 使用完整 commit SHA；PR/push job 只有 `contents: read`，
不获得签名或 Release write；Draft job 单独获得 `contents: write`；没有签名凭据；release 路径会从
触发提交重新安装、检查、构建、打包和验证，不复用 `node_modules`、`out` 或未知二进制。

本地 dry-run 确认 package version 期望标签为 `v0.1.0-alpha.1`；当时本地未刷新的标签仍指向
`c073f1f...`，因此本地演练正确拒绝继续。用户随后提供 WP8 前 GitHub Actions 截图：
`Build internal Alpha draft #6` 由 tag push 触发，ref 显示 `v0.1.0-alpha.1`、commit `0a474b9`，
状态 Success、总耗时 9 分 47 秒、1 个 artifact；“Rebuild and verify release artifacts”用时
9 分 12 秒，“Upload approved Draft pre-release”用时 27 秒，均为绿色。`git ls-remote` 又只读确认
远程标签当前确实指向完整 SHA `0a474b92e73c9d9bb0bcfcf8b4a96ce2d7a61ab5`。

截图同时显示 2 条 annotations；可见的一条指出旧 `actions/upload-artifact@v4.6.2` 以 Node.js 20
为目标、由 GitHub 强制运行在 Node.js 24。WP8 据 GitHub 官方 release metadata 将上传 Action 更新为
`actions/upload-artifact@v6.0.0`（`b7c566a...`），将同一传递链的下载 Action 更新为
`actions/download-artifact@v8.0.1`（`3e5f45b...`），二者均锁定完整 SHA、默认使用 Node.js 24；
workflow 定向测试通过。截图没有展开第二条 annotation，因此不推测其文字。

该截图与仓库中 `0a474b9` 的 `release.yml` 对照后，能证明当时从 tag checkout 执行了 `npm ci`、
Electron runtime 安装、build、check、Electron E2E、package、`NotSigned` 和 SHA-256 工作流。但它发生
在 WP8 之前，不包含本轮 Electron 43.6.0、`publish: null` 和包审计修复。

用户随后提供新上传后的独立 `Continuous integration #11` 截图：main push commit `98b05b4`，
Status Success，总耗时 5 分 46 秒；唯一 “Check, build, and Electron E2E” job 用时 5 分 43 秒并为
绿色。本地 HEAD 与 `origin/main` 均解析为完整 SHA
`98b05b416bd00ce21cc465cea8be66ea02a90236`。该提交包含 Electron 43.6.0、`publish: null`、新包审计、
NOTICE 和 WP8 初版报告，因此 11.4.1 关闭。提交后再次执行 package audit、两个 EXE SHA-256 与
`NotSigned` 复验均一致，且打包输入相对该提交无差异，因此 11.4.4 也关闭。之后的 Action Node 24
升级仍是未提交的 workflow/测试变化，不改变这两个本地产物的输入或哈希。

REST workflow-runs 查询仍返回 HTTP 404，本机没有 `gh`，attestation 是否实际运行也无法从截图判断。
当前未执行任何外部写操作；公开 Windows 二进制授权仍为“否”。

## 7. 许可证、依赖和文档

- `LICENSE` 是所有者选择的 MIT License，Copyright 2026 Jinxi Hu；package metadata 为 MIT。
- `THIRD_PARTY_NOTICES.txt` 从当前锁文件和打包运行时根重新生成并复验，共 103 个包；最终 ASAR
  内含同一 LICENSE/NOTICE。沿用 WP7 已披露的上游限制：`dingbat-to-unicode@1.0.1`、
  `duck@0.1.12`、`xmlbuilder@11.0.1` 的 npm 包中没有独立许可证正文文件，NOTICE 保留 registry
  metadata 的许可证标识和项目链接；这不是法律意见。
- README、PROJECT_BASELINE、DEVELOPMENT_ENVIRONMENT、TESTING、CHANGELOG、SECURITY 和本报告已
  对齐当前受支持 Electron、未签名、无更新源、Windows 10 目标与真实保留项。
- 没有发现凭据、证书私钥、真实正文、userData 或绝对用户路径进入跟踪文件/产物。报告只使用通用
  路径描述，不记录实际用户名路径。

## 8. 33 项验收映射

| ID     | 状态 | 主要依据或保留原因                                                          |
| ------ | ---- | --------------------------------------------------------------------------- |
| 11.1.1 | 通过 | Electron 43.6.0；当日官方 stable/release schedule 复核；最终 EXE/ASAR 实读  |
| 11.1.2 | 通过 | 73 文件、1184 通过、10 条件跳过；check/build 均为 0                         |
| 11.1.3 | 通过 | 开发、生产 E2E、unpacked、portable、installed 均实际出现窗口                |
| 11.1.4 | 通过 | 安全配置、契约测试、E2E 和 fuse 实读                                        |
| 11.1.5 | 通过 | 所有者确认沿用既有人工验收；当前完整回归与 E2E 覆盖核心语义                 |
| 11.2.1 | 通过 | package metadata、About、窗口、EXE 和审计报告一致；未冒充旧标签             |
| 11.2.2 | 通过 | WP2 图标来源/人工证据；最终安装文件、快捷方式资源存在                       |
| 11.2.3 | 通过 | package:dir/package:win/verify 实际成功且命名固定                           |
| 11.2.4 | 通过 | detached unpacked 启动；无源码/Node/npm 依赖                                |
| 11.2.5 | 通过 | ASAR 和完整 unpacked 双层禁止项审计，0 命中                                 |
| 11.2.6 | 通过 | 最终 ASAR 索引、integrity 和 fuse wire 实读                                 |
| 11.2.7 | 通过 | 字节、文件数、unpacked 依赖和重复项已记录                                   |
| 11.3.1 | 保留 | 当前 kernel build 26200 是 Windows 11；最终包无 Windows 10 实测             |
| 11.3.2 | 保留 | 当前包只在非目标 OS 自动验证；历史 WP5 不是最终 runtime                     |
| 11.3.3 | 保留 | 同上；中文/空格路径当前结果不冒充 Windows 10                                |
| 11.3.4 | 保留 | 外部工作区当前 hash 通过，但目标 Windows 10 最终包证据缺失                  |
| 11.3.5 | 保留 | 当前残留为 0，但目标 Windows 10 最终包证据缺失                              |
| 11.3.6 | 保留 | Authenticode 已确定；目标 Windows 10 Defender/SmartScreen 行为未取得        |
| 11.4.1 | 通过 | main push `98b05b4` 的 Continuous integration #11 成功，唯一 CI job 绿色    |
| 11.4.2 | 通过 | workflow 权限和 Action SHA 静态审计，历史 WP6 远程证据                      |
| 11.4.3 | 通过 | workflow 结构、测试和本地拒绝旧标签 dry-run                                 |
| 11.4.4 | 通过 | 打包输入与 `98b05b4` 一致；哈希、NotSigned、限制及复验记录完整              |
| 11.4.5 | 通过 | 两个最终 EXE 均实测 NotSigned/无时间戳                                      |
| 11.4.6 | 通过 | 签名检查后生成 manifest，再复验完全一致                                     |
| 11.4.7 | 保留 | 远程资格未知，不能把未知写成不支持                                          |
| 11.4.8 | 通过 | 未执行外部写；旧 tag 未移动；历史 Draft 边界有 WP6/WP7 记录                 |
| 11.5.1 | 通过 | 所有者 MIT 决定、LICENSE/package/ASAR 实读                                  |
| 11.5.2 | 通过 | 锁文件生成 103 包 NOTICE，notices:check 和 ASAR 实读                        |
| 11.5.3 | 通过 | 指定文档逐项更新并通过格式检查                                              |
| 11.5.4 | 通过 | 文档明确无 updater/telemetry/session restore/file association/multiplatform |
| 11.5.5 | 通过 | 静态扫描、全部测试和超时审计；10 项均为条件能力探测                         |
| 11.5.6 | 通过 | WP0 与本报告含命令、版本、包、Windows、签名、哈希和 CI 边界                 |
| 11.5.7 | 通过 | 本报告保留真实阻塞并明确没有公开 Alpha 二进制                               |

## 9. 解除保留项的最小后续动作

这些是当前 Task 12 收尾，不是未来 Windows 11/签名/公开发布扩张：

1. 在可明确证明为 Windows 10 x64 build 19045 的普通用户主机上，对该精确提交产物执行第 11.3
   安装、覆盖安装、卸载、路径、外部工作区、安全产品和残留矩阵；
2. 读取仓库 artifact attestation 的实际可用性，能用则验证，不能用则记录平台返回的真实原因；
3. 重跑 `NotSigned → SHA-256 → verify` 并更新本报告。仍不得移动旧标签、公开二进制或开始签名。

## 10. 当日官方参考

- Electron [release schedule](https://releases.electronjs.org/schedule) 与
  [stable releases](https://releases.electronjs.org/?channel=stable)：2026-09-09 核对受支持线和
  Electron 43 的最新稳定补丁；
- electron-builder [publish documentation](https://www.electron.build/publish/)：核对 repository
  自动探测、update metadata 与显式发布边界；
- Microsoft [Windows 11 release information](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information)：
  核对 OS build 26200 属于 Windows 11 25H2；
- GitHub [REST workflow runs](https://docs.github.com/en/rest/actions/workflow-runs) 与
  [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)：
  核对远程 run 查询和最小权限语义。
