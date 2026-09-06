# TASK-012 WP6 报告：Windows CI、发布工作流与来源证据

> 记录日期：2026-09-04；分支：`TASK-12`；范围仅为 WP6。没有 push、创建 tag、触发远程
> workflow、创建 GitHub Release 或进入 WP7。

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
  `alpha-release` Environment；该 Environment 必须由仓库所有者配置 required reviewer。
  WP7 如获签名授权，应在该受保护 job 内、上传前接入签名服务。
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

GitHub Environment 的 reviewer、tag protection、仓库可见性和账户/计划尚未在本包远程核实。
因此 attestation 默认关闭：只有所有者确认仓库具备资格并显式设置仓库变量后才执行。没有证据表明
当前仓库可生成或验证 attestation，不能把配置当作成功证明。

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

已有一次远程 CI 失败证据，并已据此完成上述最小修复；修复版本尚未重新触发远程 CI。没有 tag workflow、
Environment 人工审批、artifact upload/attestation、Draft Release 或下载后哈希复验的成功证据。这些是
远程验收项，不是本地配置可以替代的事实。

**WP6 的本地实现与可重复构建门禁通过。** PR/push CI 的最小权限、精确 Node、干净安装、仅 npm
下载缓存、Action SHA 锁定、release tag/version/commit 校验、重建/包审计、哈希和仅 Draft 的语义均有
自动或本地实际证据。

**WP6 的远程执行门禁待重新验收。** 先将本次修复提交到默认分支，重新触发 CI 并确认绿色；之后才在
精确仓库中确认 `alpha-release` 的人工审批与 tag 保护，推送 `v0.1.0-alpha.1` 指向的 commit 或以相同
tag 输入手动触发，核对 Draft 是未签名内部 Alpha，并下载 artifact/Release 文件复验 SHA-256；如计划允许，
再启用并验证 attestation。未完成前，不得声称已创建 Draft Release 或已获得来源证明，也不进入 WP7。
