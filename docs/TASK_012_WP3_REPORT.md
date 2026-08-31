# TASK-012 WP3 报告：electron-builder、产物白名单与依赖收敛

> 记录日期：2026-08-31；前序恢复点：`7179e2e`（WP2：发布包 ICO 图标）。
>
> 本报告记录 WP3 的实际构建结果。portable 和 NSIS 尚未生成，因此本 WP 的发布门禁未通过；没有进入 WP4。

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

unpacked 审计的实际尺寸为：`win-unpacked` 387,495,662 B、`resources/app.asar` 12,440,474 B、
`app.asar.unpacked` 748,156 B。ASAR 的 `node_modules` 清单为 `docx`、`jszip`、`mammoth` 及其间接依赖；
`jszip` 的需要解包文件物理位于 `app.asar.unpacked`，审计报告明确标为 ASAR 索引的 unpacked 模块，未计为额外
应用依赖副本。检查到的主进程直接外部 import 恰为 `docx`、`jszip`、`mammoth`，PE machine 为 `0x8664`。

## portable/NSIS 阻塞

`package:win` 已成功完成 clean build、unpacked 阶段和 portable 的 7-Zip 输入压缩（中间
`wenshu-desktop-0.1.0-alpha.1-x64.nsis.7z` 为 93,824,316 B），但压缩结束后没有启动 `makensis`，也没有产生
portable 或 NSIS `.exe`。当时只剩本项目的三个 Node builder 进程处于无网络连接的等待状态，已在核对完整命令行后
精确停止，未触及其他进程。

根因进一步缩小为项目缓存缺少 `nsis-resources-3.4.1` 插件资源：缓存中的 NSIS `makensis.exe` 与 7-Zip 均可
独立输出版本，然而 builder 在压缩后请求该缺失官方资源时无输出等待。没有将中间 `.nsis.7z` 当成产物，也没有使用
未经授权的 electron-builder 二进制镜像或手工伪造缓存。因而以下项均没有完成：portable/NSIS 产物、`package:verify
-- --mode=win`、portable 启动烟测、安装包启动/安装后烟测。

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

**WP3 门禁：未通过。** unpacked 产物、白名单、依赖收敛、自动审计和无源码依赖启动均有实测证据；但可分发的
portable/NSIS、Windows 完整产物审计和三类产物启动烟测仍缺失。需先在允许取得 `nsis-resources-3.4.1` 官方工具资源的
环境中完成 `npm run package:win`、`npm run package:verify -- --mode=win` 及两类剩余烟测，才可进入 WP4。
