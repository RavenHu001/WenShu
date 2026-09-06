# TASK-012 WP4 报告：ASAR、fuses、包验证与 Electron E2E

> 记录日期：2026-09-04；本报告记录 WP4 最终验证。未进入 WP5。

## 已完成的 fuses 实测

electron-builder `26.15.3` 不接受当前文档中新增的 `electronFuses` schema，故没有叠加两种方案；改用官方
`@electron/fuses@1.8.0` 的单一 `afterPack` 钩子。`@electron/fuses read --app release/win-unpacked/WenShu.exe`
读取到：

| Fuse                                  | 最终值              | 理由                                                             |
| ------------------------------------- | ------------------- | ---------------------------------------------------------------- |
| RunAsNode                             | Disabled            | 应用不使用 `ELECTRON_RUN_AS_NODE` 或 `process.fork()`。          |
| EnableCookieEncryption                | Disabled            | 不使用 Chromium cookie 身份状态；避免把既有 userData 单向迁移。  |
| EnableNodeOptionsEnvironmentVariable  | Disabled            | 生产运行不接受 `NODE_OPTIONS` / 额外 CA 注入。                   |
| EnableNodeCliInspectArguments         | Disabled            | 最终产物不接受 inspect；E2E 需使用未加固构建。                   |
| EnableEmbeddedAsarIntegrityValidation | Enabled             | Windows Electron 43 支持，builder 已嵌入 ASAR integrity。        |
| OnlyLoadAppFromAsar                   | Enabled             | 阻止 `app/` 与 default app 回退旁加载。                          |
| LoadBrowserProcessSpecificV8Snapshot  | Disabled            | 未交付自定义 V8 snapshot，保留默认启动路径。                     |
| GrantFileProtocolExtraPrivileges      | Enabled             | renderer 当前以 `loadFile()` / `file://` 加载，不能盲目关闭。    |
| 第九个未命名 V1 wire 位               | Enabled（保留默认） | `@electron/fuses@1.8.0` 不暴露该 Electron 43 wire 项，故不翻转。 |

`package:dir`、`package:win`、ASAR 内容审计和最终 EXE fuse 读取均已通过。`@playwright/test@1.62.1`
已作为精确 dev dependency 安装并更新 lock。

## ASAR integrity 拒绝启动

所有破坏性验证都只针对临时副本：

- 所有者已手动确认篡改 `app.asar` 时拒绝启动；
- 自动复制 `release/win-unpacked` 到唯一临时目录后，删除副本的 `resources/app.asar`。运行副本 EXE
  以退出码 `1` 退出，主窗口句柄为 `0`；最终产物未被修改，临时副本已删除。

## 自动 E2E 与边界

`tests/e2e/electron-smoke.test.ts` 的 4 个隔离 Electron E2E 已通过：

1. 启动、受控目录选择与 About `0.1.0-alpha.1`；
2. TXT 编辑保存后的精确 UTF-8 字节；
3. DOCX 保存后的有效 OOXML 与原文件 `.wenshu.bak`；
4. dirty TXT 关闭确认、取消后内容仍保留。

测试通过 `ElectronApplication.evaluate` 仅替换主进程目录对话框返回值，不向产品 API 增加测试 IPC；每例均使用唯一
workspace/userData 并清理。当前自动化桌面会话中，保留产品 renderer sandbox 会使 Playwright 调试管道关闭渲染进程，故可驱动
unpacked E2E 仅对测试子进程加入 `--no-sandbox` 和 `--disable-gpu`。产品 `BrowserWindow` sandbox 配置和最终 fuses 均未改变，
最终产物以黑盒烟测补足该边界。

## 最终产物与黑盒烟测

`package:verify -- --mode=win` 通过：x64 unpacked `387,603,274 B`、`app.asar` `12,440,474 B`、
`app.asar.unpacked` `748,156 B`、portable `94,238,789 B`、NSIS `94,537,943 B`。外部运行时依赖仅为
`docx`、`jszip`、`mammoth` 及其传递依赖。

- unpacked：启动后存活，主窗口句柄非零，标题为“文枢”；退出后隔离 userData 已清理；
- portable：启动器及 5 个匹配进程存活，实际应用子进程主窗口句柄非零，标题为“文枢”；退出后隔离 userData 已清理；
- NSIS：安装器可启动；再静默安装到唯一临时目录，安装后的 `WenShu.exe` 创建标题为“文枢”的可见主窗口（4 个匹配进程）；
  随后静默卸载，安装目录、userData 和全部 WenShu/Electron 进程均无残留。

最终 EXE 的 fuse 读取与上表一致；黑盒启动期间未出现可检测的额外应用窗口或进程。完整 `npm run check`、生产 `build`、
`package:dir`、`package:win` 与包审计均已实际运行。

**WP4 门禁：通过。** 自动 E2E 的 sandbox 限制和手动篡改 ASAR 的证据边界已明确记录；没有进入 WP5。
