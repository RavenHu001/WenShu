# TASK-012 WP6 报告：Windows CI、发布工作流与来源证据

简体中文 | [English](./TASK_012_WP6_REPORT.en.md)

[任务档案](../README.md) · [文档中心](../../README.md)

> 记录日期：2026-09-06；分支：`TASK-12`；范围仅为 WP6。远程 CI、tag workflow、Draft
> Pre-release 与下载后 SHA-256 已实际验收；没有进入 WP7。

## 1. 本包变更

- 新增 `.github/workflows/ci.yml`：Windows `windows-2025` 上从 `.node-version` 读取精确
  Node `22.15.0`，运行 `npm ci`、`npm run build`、`npm run check` 与既有的 Playwright
  Electron E2E。构建须先于完整 check：后者包含 E2E，E2E 需要 `out/` 的生产入口。
- 新增 `.github/workflows/release.yml`：仅接受 `v*` push tag 或带必填 tag 输入的
  `workflow_dispatch`。它检出指定 tag 后以实际 `package.json.version` 严格校验
  `v<version>`，记录被构建 commit，并重新执行干净安装、check、E2E、打包、包审计和
  SHA-256 校验；不复用未知来源的上传文件。
- release 的 build job 只读且仅在仓库变量 `ENABLE_ARTIFACT_ATTESTATION == 'true'` 时使用
  GitHub attestation。`draft-release` job 是唯一的 `contents: write` job，位于
  `alpha-release` Environment。WP7 如获签名授权，应在该受保护 job 内、上传前接入签名服务。
- 新增 `tests/workflow-config.test.ts`，防止 CI 写权限、非 npm 缓存、未锁定 Action、标签/
  版本校验、Draft 语义或发布前哈希校验被意外移除。

## 1.1 2026-09-05：首次 GitHub CI 失败与修复

首次远程 CI 结果有两类失败，均未显示产品功能断言错误：

- `npm run check` 在 `npm run build` 之前执行。`check` 包含完整 Vitest，进而启动
  Electron E2E；干净 GitHub runner 尚无 `out/main/index.js` 等 production entrypoint，故四个
  E2E 都在 `electron.launch()` 阶段以“系统找不到指定路径”退出。
- 2000 项 DOCX 全部替换测试在 GitHub Windows 的四个 fork 与 jsdom/Electron 工作负载竞争时超过
  默认 5 秒；该测试在本机及 CI 模拟下并非逻辑失败。

修复不延长任何测试超时，也不跳过 E2E：CI/release 均改为先 build 后 check；`CI=true` 时 Vitest
仍使用隔离的 fork pool，但上限从 4 调为 2，降低争抢。工作流 guardrail test 同时断言 build 必须
先于 check。该并发控制使用 Vitest 支持的 fork worker 配置，而非放宽质量阈值。

## 1.2 2026-09-06：Draft 发布 job 的仓库定位修复

真实 tag workflow 中，`Rebuild and verify release artifacts`、artifact 下载和 SHA-256 复验均已
成功；`draft-release` 在第一条 `gh release view` 失败，错误为 `not a git repository`。该 job 有意
不 checkout 源码，GitHub CLI 因而无法从工作目录推断默认仓库。

修复为对 `gh release view` 与 `gh release create` 显式传入
`--repo $env:GITHUB_REPOSITORY`，因此不必扩大 job 内容或检出源码；同时加入 `--verify-tag`，禁止
GitHub CLI 在 tag 缺失时从默认分支创建一个新 tag。guardrail test 覆盖这两个参数。修复后仍须重新
运行 release workflow；此前失败运行没有创建 Release。

## 1.3 2026-09-06：远程发布演练成功与 Environment 例外

修复后的 `Build internal Alpha draft #3` 以 `workflow_dispatch` 成功运行：`Rebuild and verify
release artifacts` 和 `Upload approved Draft pre-release` 都完成，workflow 上传了一个内部 artifact。
GitHub Release 页面确认 `文枢 v0.1.0-alpha.1` 为 **Draft**，包含 `SHA256SUMS.txt`、portable EXE、
NSIS EXE 与 blockmap；Release note 标明未签名内部 Alpha 和对应 source commit。项目所有者已下载
EXE 并确认 SHA-256 与 `SHA256SUMS.txt` 一致。

项目所有者在 `alpha-release` Environment 页面确认当前账户/仓库没有 `Required reviewers` 配置项，
并明确决定 WP6 不以改变仓库可见性、购买/迁移计划或伪造审批作为前提。此项被记录为外部账户能力例外：
Draft 仍不公开，且 workflow 的最小权限与仅 Draft 行为不变；它不能被描述为已进行 GitHub 人工
Environment 审批。

## 2. 权限、缓存与 Action 来源

全局 release 默认 `permissions: {}`；显式权限未列出即为 none，符合 GitHub 的
[workflow permissions 语义](https://docs.github.com/actions/reference/workflows-and-actions/workflow-syntax#defining-access-for-the-github_token-scopes)。
CI 显式仅 `contents: read`，不会得到签名、OIDC、attestation 或 Release 写权限。
`setup-node` 使用 `cache: npm` 和 `package-manager-cache: false`：只缓存 npm 下载缓存，
不缓存 `node_modules`、`out/` 或 release 产物。

| Action            | 固定 SHA / 人类版本                                 | 用途                                       | 所需权限                                                                | 维护者 / 替代方案                                             |
| ----------------- | --------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| checkout          | `08c6903cd8c0fde910a37f88322edcfb5dd907a8` / v5.0.0 | 检出 PR、分支或精确 tag                    | `contents: read`                                                        | GitHub；可用原生 git，但会失去官方 Action 的标准认证处理。    |
| setup-node        | `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` / v6.4.0 | 读取 `.node-version`、缓存 npm 下载        | `contents: read`                                                        | GitHub；可手工安装 Node，但不提供维护的缓存集成。             |
| upload-artifact   | `ea165f8d65b6e75b540449e92b4886f43607fa02` / v4.6.2 | 在 build 与受保护发布 job 间传递已校验文件 | 无额外 `GITHUB_TOKEN` 写权限                                            | GitHub；可改用外部对象存储，但会扩大凭据面。                  |
| download-artifact | `634f93cb2916e3fdff6788551b99b062d0335ce0` / v5.0.0 | 只下载本 workflow 命名的已验证 artifact    | 无额外 `GITHUB_TOKEN` 写权限                                            | GitHub；可用 GitHub CLI 下载，但没有更小的权限面优势。        |
| attest            | `a1948c3f048ba23858d222213b7c278aabede763` / v4.1.1 | 条件生成二进制来源证明                     | build job 的 `contents: read`、`id-token: write`、`attestations: write` | GitHub；在不具资格的仓库保持禁用并记录，而非伪造 provenance。 |

完整 SHA 由上述官方 Action 仓库 release/tag 解析，并由工作流测试逐一检查为 40 位十六进制。
`setup-node` 的缓存行为见其 [官方文档](https://github.com/actions/setup-node#caching-global-packages-data)；
artifact attestation 所需权限及仓库资格见 [GitHub 官方说明](https://docs.github.com/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)。

## 3. 发布与来源控制

release job 只从当前 tag 检出的 commit 重建；版本不从环境变量读取。tag、版本和动态产物名的关系为：

```text
v0.1.0-alpha.1 -> package.json 0.1.0-alpha.1
                 -> WenShu-0.1.0-alpha.1-portable-x64.exe
                 -> WenShu-0.1.0-alpha.1-setup-x64.exe
```

打包后先从 EXE 实际字节生成 `SHA256SUMS.txt`，再逐项重新计算验证；上传后在
`draft-release` job 再验证一次，才允许 `gh release create --draft --prerelease`。已存在同名
Release 会失败而非覆盖；工作流没有把 Draft 改为公开的命令。Draft 说明会标记“未签名内部 Alpha”、
写入 source commit 并提示校验哈希。

当前账户/仓库未提供 `alpha-release` 的 Required reviewers，项目所有者已接受第 1.3 节的外部例外。
tag protection 的远程配置状态未在本报告的证据中确认。attestation 保持默认关闭：只有所有者确认仓库
具备资格并显式设置仓库变量后才执行。没有 attestation 生成或验证证据，不能把配置当作成功证明。

## 4. 本地实际验证

使用 Node `v22.15.0` / npm `10.9.2` 和锁文件执行。干净安装首次受受限执行环境的 npm 缓存/
网络限制影响；在获准后以项目锁文件完成 `npm ci`。Electron 二进制安装也使用已授权的大陆镜像恢复
锁定的 `electron@43.4.1`，未修改 package 或 lock。

| 命令 / 检查                                    | 实际结果                                                                                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run tests/workflow-config.test.ts` | 1 文件、3 tests 通过。                                                                                                                                                                              |
| Prettier 对两份 YAML 和工作流测试              | 通过。                                                                                                                                                                                              |
| `npm run check`                                | 74 个测试文件通过，1188 passed、10 个既有条件 skipped、0 failed；其中 Electron E2E 4/4 通过。                                                                                                       |
| `npm run build`                                | 通过；main 155.17 kB、preload 4.30 kB、renderer JS 2,264.13 kB。                                                                                                                                    |
| `npm run package:win`                          | 通过：electron-builder 26.15.3、Electron 43.4.1、portable 和 per-user NSIS x64 均生成，随后 package audit 通过。                                                                                    |
| release SHA 演练                               | 通过；实际生成并复验 `SHA256SUMS.txt`。portable 为 `64f61d0de5022a699cfa968626f9aac455820a147c3b0828214f80e83db2139d`，NSIS 为 `49f61ad5485a4ac63972f838717277169ca89047fa8e42238e8346da139109f1`。 |
| 修复后的 CI 等价序列（`CI=true`）              | `npm run build` → `npm run check`：74 个测试文件通过，1188 passed、10 skipped；随后独立 Electron E2E 4/4 通过。2000 项 DOCX 全部替换定向测试通过（约 0.65 s），没有修改其 5 s 超时。                |

本次 package audit 读取到 x64（PE machine `0x8664`）；unpacked 387,603,274 B、`app.asar`
12,440,474 B、`app.asar.unpacked` 748,156 B；portable 94,238,793 B、NSIS 94,537,990 B。
主进程真实外部依赖仍为 `docx`、`jszip`、`mammoth`，包审计通过。

## 5. 未执行项与 WP6 门禁结论

首次远程 CI 的失败已完成最小修复；修复后的 CI、tag workflow、artifact upload、Draft Release 和
下载后 SHA-256 均有真实成功证据。没有 GitHub Environment 人工审批或 artifact attestation 成功证据：
前者适用项目所有者接受的账户能力例外，后者未启用且资格未知。

**WP6 的本地实现与可重复构建门禁通过。** PR/push CI 的最小权限、精确 Node、干净安装、仅 npm
下载缓存、Action SHA 锁定、release tag/version/commit 校验、重建/包审计、哈希和仅 Draft 的语义均有
自动或本地实际证据。

**WP6 的可用远程执行门禁通过，并保留明确限制。** 远程 CI、tag/version/commit 重建、包审计、
SHA-256、Draft 和下载复验均通过；Release 未公开。`alpha-release` 的 Required reviewers 因当前账户/
仓库能力不可用而按项目所有者决定跳过，不能宣称发生过独立 GitHub 审批。tag protection 仍应由所有者在
GitHub Settings 中确认；attestation 只有在资格确认后才可作为额外来源证据启用。本包不进入 WP7。
