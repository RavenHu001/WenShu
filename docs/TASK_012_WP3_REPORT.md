# TASK-012 WP3 报告：electron-builder、产物白名单与依赖收敛

> 记录日期：2026-09-01；前序恢复点：`7179e2e`（WP2：发布包 ICO 图标）。
>
> 本报告记录 WP3 的实际构建结果。所有 WP3 打包与启动门禁均已完成；没有进入 WP4。

## 完成内容

- 通过 npm 安装并在 `package-lock.json` 锁定精确的 `electron-builder@26.15.3`，没有手工编辑 lock。
- 新增独立的 `electron-builder.yml`。它固定 WP2 的 `appId`、`productName`、`executableName`、`build/icon.ico`、
  `release/` 输出目录和 `asar`，只声明 Windows x64 的 portable 与 assisted、per-user NSIS 目标；不配置签名、
  publish、文件关联、MSI/MSIX、ia32 或 ARM64。
- `files` 使用允许集，只含 `out/main/**`、`out/preload/**`、`out/renderer/**` 与 `package.json`。electron-builder
  仅从 production dependencies 递归带入主进程实际外部依赖。审计确定性拒绝源码、测试、文档、脚本、`.git`、
  `.github`、`.tools`、`.env*`、日志、fixtures、visual baselines、`out/.capture-user-data`、userData 与常见凭据命名。
- `out/main` 的真实第三方 import 为 `docx`、`jszip`、`mammoth`，故三者保留在 `dependencies`；React、React DOM、
  CodeMirror 和 Tiptap 均已由 renderer bundle 完整打入，移至 `devDependencies`。该结论以 clean install、构建、
  asar 审计和“隐藏源码 node_modules 后启动”共同验证，而非仅按源码 import 推测。
- 新增 `package:dir`、`package:win`、`package:verify`，以及项目内 builder 缓存启动包装器。`electronDist` 显式复用
  已锁定 `electron@43.4.1` 的 postinstall runtime，避免 builder 再下载另一份 Electron。干净 `npm ci` 时官方源不可达，
  按所有者此前授权临时设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 运行官方 Electron 安装脚本；npm
  包与锁文件没有切换来源，安装脚本完成而未报告 checksum 错误。
- 两个打包脚本均显式传递 `--publish never`，不上传任何 artifact。electron-builder 仍在本地 `release/` 生成
  `latest.yml` 与 NSIS blockmap；它们是未上传的更新描述元数据，不表示接入自动更新或 publish，且整个 `release/`
  目录均被忽略。
- 新增可重复的 `scripts/verify-package.mjs` 与配置测试，检查 package metadata、ASAR 主入口、三项直接运行依赖、
  renderer 依赖不重复进入包、白名单禁止项、x64 PE 机器类型、产物尺寸和最终 artifact 名称。完整文件清单写入被忽略的
  `release/package-audit.json`，便于本地复核而不将产物数据提交到仓库。

## 实测证据

| 项目                        | 实测结果                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 精确版本                    | 构建 Node `22.15.0`、npm `10.9.2`、Electron `43.4.1`、electron-builder `26.15.3`；最终 Electron CLI 输出 `v43.4.1`。                                                                                          |
| clean install               | `npm ci --cache .tools\\npm-cache` 成功，安装 596 个包。受限沙箱的首次尝试因镜像网络 `EACCES` 触发 npm 内部错误；获得网络批准后按同一 lock 成功。                                                             |
| 定向审计测试                | `tests/package-audit-config.test.ts`：2 项通过。                                                                                                                                                              |
| 全量 `check`                | 72 个测试文件通过，1181 passed、10 个既有条件 skipped、0 failed；typecheck、lint、Prettier 均通过。                                                                                                           |
| `build`                     | 退出码 0；main 155.17 kB、preload 4.30 kB、renderer CSS 53.24 kB、renderer JS 2,264.13 kB。                                                                                                                   |
| clean-install `package:dir` | 成功；自动 `package:verify -- --mode=dir` 通过。                                                                                                                                                              |
| unpacked 无源码依赖烟测     | 精确移动 `node_modules` 到项目内临时 stash 后启动 `release/win-unpacked/WenShu.exe`，源依赖目录确已隐藏，8 秒后启动器存活且有 4 个匹配应用进程；随后仅停止这些进程、恢复目录、清理经路径校验的临时 userData。 |
| `package:win`               | 使用所有者授权的 `https://npmmirror.com/mirrors/electron-builder-binaries/` 下载并校验 `nsis-resources-3.4.1` 后成功；自动及单独执行的 `package:verify -- --mode=win` 均通过。                                |
| portable 烟测               | 在隔离临时 userData 下启动 `WenShu-0.1.0-alpha.1-portable-x64.exe`，启动器存活且有 4 个匹配应用进程；随后只终止该批进程并清理临时 userData。                                                                  |
| NSIS 启动烟测               | 不传安装参数启动 `WenShu-0.1.0-alpha.1-setup-x64.exe`，6 秒后安装器进程仍存活（1 个精确匹配进程）；未点击安装，随后关闭该进程。                                                                               |

最后一次 `package:dir` 审计的实际尺寸为：`win-unpacked` 387,495,662 B、`resources/app.asar` 12,440,474 B、
`app.asar.unpacked` 748,156 B。`package:win` 审计时的 `win-unpacked` 为 387,603,274 B；ASAR 与 unpacked
模块尺寸相同。最终 portable 为 94,254,976 B，NSIS setup 为 94,554,175 B，NSIS blockmap 为 101,102 B。ASAR 的
`node_modules` 清单为 `docx`、`jszip`、`mammoth` 及其间接依赖；
`jszip` 的需要解包文件物理位于 `app.asar.unpacked`，审计报告明确标为 ASAR 索引的 unpacked 模块，未计为额外
应用依赖副本。检查到的主进程直接外部 import 恰为 `docx`、`jszip`、`mammoth`，PE machine 为 `0x8664`。

## portable/NSIS 下载恢复

此前阻塞源于缺失的 `nsis-resources-3.4.1` 插件资源。项目所有者在 2026-09-01 明确授权使用大陆镜像后，临时设置
`ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/` 重新执行 `package:win`。
精确资源 URL 返回 HTTP 200，下载文件为 730,800 B；electron-builder 26.15.3 使用其内置 SHA-256
`593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103` 完成校验和解压，随后生成两个 `.exe`。
镜像变量只用于本次构建工具资源下载，未写入项目配置、package manifest 或 lock，也未手工伪造缓存。

## 产物安全结论与门禁

已成功生成的 unpacked 包不含 `src`、`tests`、`docs`、`scripts`、`.git`、`.github`、`.tools`、`.env*`、日志、
测试夹具、截图基线或 `out/.capture-user-data`；也未检出 audit 规则覆盖的凭据文件名模式。没有新增 Task 1–11 的
IPC、文件管理、保存、备份、回收站或关闭语义代码，现有全量测试保持绿色。

使用的资料包括 [electron-vite production build 指南](https://electron-vite.org/guide/build)、
[electron-vite 依赖排错指南](https://electron-vite.org/guide/troubleshooting)、
[electron-builder application contents](https://www.electron.build/docs/contents/)、
[configuration schema](https://www.electron.build/docs/configuration/)、
[Windows targets](https://www.electron.build/docs/win/) 和
[NSIS/portable 指南](https://www.electron.build/nsis/)。

**WP3 门禁：通过。** unpacked、portable、NSIS 的打包、内容审计和启动烟测均有实测证据；白名单与外部依赖已收敛，
没有将源码、测试或用户数据纳入应用包，且打包脚本不上传产物。仍未进入 WP4。
