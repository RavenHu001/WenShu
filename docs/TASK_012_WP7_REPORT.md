# TASK-012 WP7 报告：签名接入、许可证与 Alpha 发布文档

> 记录日期：2026-09-07；分支：`main`；起始提交：
> `2d84bc111e9c3aea01b8c7c580c24c942170a490`。本报告只覆盖 WP7，不进入 WP8。

## 1. 结论与真实发布级别

**当前发布级别仍是未签名内部 Alpha / Draft，不能公开。WP7 正式门禁未通过。**

安全的本地工程、第三方 NOTICE、变更记录、安全策略、Alpha Release Notes、v27 配置迁移、未签名
验签/最终哈希和 Draft workflow 加固已经完成。所有者现已选择 Microsoft Artifact Signing + GitHub
OIDC，以及 MIT License（Copyright 2026 Jinxi Hu）；根目录许可证和项目元数据已经落地。Azure 身份
验证和签名资源尚未建立，因此没有写入伪造的 publisher、PFX、Azure 配置值或凭据，也没有把现有
Draft 转为公开 Pre-release。

远程 `Build internal Alpha draft` action 和 Draft 的成功证据来自 WP6 报告及本次所有者说明。本会话
未安装 GitHub CLI，未修改远程 Release。现有 `v0.1.0-alpha.1` 指向
`c073f1fbb4b2bef3370d0e9b10d21d74de974d87`，而本包起始 HEAD 已是后续提交；现有 Draft 因而不含
WP7 文件和 v27 产物。不能移动既有标签或把当前 HEAD 产物冒充为该标签产物。后续需要在 WP8 之前由
所有者决定保留旧内部 Draft，还是提升版本并创建新标签；本包未擅自 tag、push 或发布。

## 2. electron-builder v27 与签名边界

2026-09-07 核对 npm 和官方文档时，稳定 `latest` 仍是 v26，v27 最新为预发布
`27.0.0-alpha.8`。因 WP7 明确要求使用当前 v27 `win.sign` 形状，本包将 builder 精确升级并锁定到
该版本，同时完成下列迁移：

- 删除 v27 已移除的 `asar: true` sentinel，使用 `asar: {}`；
- 删除 v27 已移除的 `win.signExecutable`，当前真实状态使用 `win.sign: false`；
- builder CLI 包装器改用 v27 的 `electron-builder/cli.js`；
- `migrate-schema --dry-run` 确认配置已是 v27 形状；未引入旧 `signtoolOptions`、
  `azureSignOptions` 或其他删除字段。

官方来源：

- [electron-builder v27 Windows signing](https://www.electron.build/docs/features/code-signing/code-signing-win/)
- [electron-builder v27 breaking changes](https://www.electron.build/docs/migration/v27-breaking-changes/)
- [Microsoft Artifact Signing integrations](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)
- [Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)
- [Authenticode timestamping](https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures)
- [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)

`scripts/verify-windows-release.ps1` 对 portable 与 NSIS 逐个工作：内部模式要求 `NotSigned`；可信模式
要求 `Valid`、精确匹配的证书 subject 和存在时间戳证书，然后才生成/复验 SHA-256。workflow 当前
固定调用内部模式，因此意外混入签名文件会失败。选定真实后端后，必须把 `win.sign` 替换为 v27 的
单一 discriminated union，并把 workflow 门禁改为 `Trusted`；不能只改发布文案。

已选 Artifact Signing + GitHub OIDC，因为私钥不落地。落地真实签名前仍需 Azure 付费账户、Public
Trust 身份验证、endpoint、account/profile 名、publisher subject 和最小
`Artifact Signing Certificate Profile Signer` 角色。当前没有读取或打印任何凭据。

## 3. 固定构建顺序与产物证据

实际顺序为：允许集包内容 → ASAR integrity/fuses → 明确禁用签名 → `NotSigned` 验证 → 最终
SHA-256 → 本地黑盒运行。EXE 在最终哈希后只被读取/执行，没有修改。

| 项目       | 字节        | Authenticode | 时间戳 | 最终 SHA-256                                                       |
| ---------- | ----------- | ------------ | ------ | ------------------------------------------------------------------ |
| portable   | 103,523,141 | `NotSigned`  | 无     | `9844ee5110918928575999c274161d906a32748fbc10fc5f29f0c1492b847dc3` |
| NSIS setup | 103,829,941 | `NotSigned`  | 无     | `8ad601192eff646a377c1c39962438d933da9df3cef6f636c9689e76969dc088` |

包审计读取 x64 PE machine `0x8664`；unpacked 387,691,896 B、`app.asar` 12,603,336 B、
`app.asar.unpacked` 748,156 B。主进程外部 import 仍只有 `docx`、`jszip`、`mammoth`。
`THIRD_PARTY_NOTICES.txt` 已进入 `app.asar`，Electron 的 `LICENSE.electron.txt` 和
`LICENSES.chromium.html` 仍位于最终运行目录。

最终 EXE 的 fuse 实读值未回退：RunAsNode、Node options、Node CLI inspect、browser-specific V8
snapshot 均 Disabled；embedded ASAR integrity 与 OnlyLoadAppFromAsar Enabled；当前 `loadFile()`
所需的 file protocol privileges Enabled。portable 最终黑盒烟测产生 4 个隔离进程并保持运行，NSIS
安装器保持运行；只停止本次创建的进程，临时 userData 已核对位于系统 TEMP 后清理。没有重复 WP5 的
真实安装/卸载矩阵。

## 4. 第三方许可证与 NOTICE 审计

新增生成器从完整 `package-lock.json` 和 clean `node_modules` 解析实际依赖图，并覆盖主进程运行依赖
与 renderer 明确 bundle roots；它排除 build/test/lint/package-only 工具。生成的清单有 103 个随
产品运行或被 bundle 的 npm 包，包含精确版本、锁文件许可证表达式、仓库和包内全部
LICENSE/NOTICE/COPYING 文本。每次 `check` 都以 `--check` 阻止清单过期。

人工例外：`dingbat-to-unicode@1.0.1`（BSD-2-Clause）、`hash.js@1.1.7`（MIT）和
`isarray@1.0.0`（MIT）在发布的 npm 包中只有许可证元数据，没有独立许可文本；清单保留这一缺口，
公开分发前须从对应上游 tag/commit 确认版权与精确文本。Electron/Chromium 的嵌套第三方声明由最终
运行目录中的两个官方许可文件携带。本审计是工程清单，不是完整法律意见。

项目自身现采用 MIT License，版权人为 Jinxi Hu，年份为 2026。MIT 文本与 `package.json` SPDX 标识
一致；这不改变第三方组件各自的许可证，也不把工程清单伪装成法律意见。现有标签早于许可提交，需由
新的精确标签承载 LICENSE、NOTICE 和最终签名产物。

## 5. 文档与 workflow

- `CHANGELOG.md` 记录首个 Alpha 能力和真实签名/发布状态；
- `LICENSE` 采用标准 MIT 文本并随应用包和 Draft 附件分发；
- `SECURITY.md` 说明私下报告、最小合成复现、日志/路径/文档隐私和手动更新边界；
- `docs/releases/v0.1.0-alpha.1.md` 说明系统/架构、portable/NSIS、SHA-256、核心能力、限制、
  本地文档语义、无自动更新/无遥测、反馈隐私和不碰工作区的降级方式；
- release workflow 会携带 NOTICE 和 Release Notes，并用 `--notes-file` 创建 Draft；当前不会公开，
  也不会把未签名产物误标为可信签名。
- 预期分发渠道只有 GitHub 源码仓库和 GitHub Releases；不计划 Microsoft Store 上架，也无自动更新。

## 6. 实际命令与结果

| 命令 / 检查                                                           | 结果                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install --save-dev --save-exact electron-builder@27.0.0-alpha.8` | 成功；lock 由 npm 更新。                                                                                                                          |
| `electron-builder migrate-schema -c electron-builder.yml --dry-run`   | 配置已是 v27，无需迁移。                                                                                                                          |
| `npm ci`                                                              | 成功；clean 安装 559 个包。                                                                                                                       |
| clean 后首次 `npm run check`                                          | 71 文件/1174 tests 已通过；2 个套件因 Electron 二进制未安装在收集阶段失败。按 workflow 运行 `npx install-electron --no` 后重跑。                  |
| 最终 `npm run check`                                                  | 73 文件通过；1184 passed、10 skipped、0 failed。10 个均为既有 symlink/junction 权限条件跳过。typecheck、lint、Prettier、NOTICE freshness 全通过。 |
| `npm run build`                                                       | 通过；main 155.17 kB、preload 4.30 kB、renderer HTML 0.57 kB、CSS 53.24 kB、JS 2,264.13 kB。                                                      |
| `npm run test:e2e`                                                    | 1 文件、4/4 通过：启动/About、TXT 字节保存、DOCX/备份、dirty 关闭。                                                                               |
| `npm run package:dir`                                                 | v27 成功；ASAR、NOTICE、x64、依赖和包内容审计通过。                                                                                               |
| `npm run package:win`                                                 | clean 依赖树最终成功；portable/NSIS 均生成。受限网络首次无法下载 v27 工具集，获准从官方源下载校验后缓存复跑成功。                                 |
| `npm run package:verify -- --mode=win`                                | 通过；禁止路径/凭据/userData、运行依赖、x64、ASAR 与 notices 均通过。                                                                             |
| `npm run release:manifest:unsigned`                                   | 两个 EXE 均 `NotSigned`、无时间戳；生成并复验最终 SHA-256。                                                                                       |
| 最终 portable/NSIS 黑盒启动 + 哈希复验                                | 通过；进程清理后哈希仍与 manifest 一致。                                                                                                          |

## 7. 凭据、路径与隐私审查

仓库只出现公开配置键名和占位说明，没有凭据值、PFX、证书 base64、private key、GitHub/Azure token
或未脱敏日志。配置与文档未加入绝对用户路径；release 产物和 package audit 保持在已忽略的
`release/`。没有修改 Task 1–11 产品代码或用户工作区。

## 8. 阻塞与门禁

1. Authenticode 方案已经选定，但 Azure Public Trust 身份验证、Artifact Signing 资源和精确 publisher
   subject 尚未完成；实际签名级别仍为无签名，不能运行可信验签/时间戳测试。
2. MIT 项目许可证已经落地；三个 npm 包缺失独立许可文本的上游证据仍应在公开前补齐。
3. 现有 Alpha 标签早于 WP7，本地最终产物没有与可上传的新精确标签绑定；未获授权创建/推送新标签，
   也不应移动已用标签。
4. WP5 的 Windows 11 x64 矩阵仍是前序阻塞；WP7 不伪造补齐。
5. v27 当前是 alpha 预发布；虽然本地门禁通过，公开候选仍应在 WP8 决策时评估是锁定该精确预发布、
   等待稳定 v27，还是由所有者明确接受风险。

因此，**许可门禁已满足，签名门禁尚未满足；状态必须保持“内部 Alpha/Draft，公开发布阻塞”**。
下一步是完成 Azure/OIDC 外部条件并运行可信签名验证；本包不进入 WP8。
