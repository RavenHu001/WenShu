# TASK-012 WP4 报告：ASAR、fuses、包验证与 Electron E2E

> 记录日期：2026-09-01；本报告为进行中记录。未进入 WP5。

## 已完成的 fuses 实测

electron-builder `26.15.3` 不接受当前文档中新增的 `electronFuses` schema，故没有叠加两种方案；改用官方
`@electron/fuses@1.8.0` 的单一 `afterPack` 钩子。`@electron/fuses read --app release/win-unpacked/WenShu.exe`
读取到：

| Fuse | 最终值 | 理由 |
| --- | --- | --- |
| RunAsNode | Disabled | 应用不使用 `ELECTRON_RUN_AS_NODE` 或 `process.fork()`。 |
| EnableCookieEncryption | Disabled | 不使用 Chromium cookie 身份状态；避免把既有 userData 单向迁移。 |
| EnableNodeOptionsEnvironmentVariable | Disabled | 生产运行不接受 `NODE_OPTIONS` / 额外 CA 注入。 |
| EnableNodeCliInspectArguments | Disabled | 最终产物不接受 inspect；E2E 需使用未加固构建。 |
| EnableEmbeddedAsarIntegrityValidation | Enabled | Windows Electron 43 支持，builder 已嵌入 ASAR integrity。 |
| OnlyLoadAppFromAsar | Enabled | 阻止 `app/` 与 default app 回退旁加载。 |
| LoadBrowserProcessSpecificV8Snapshot | Disabled | 未交付自定义 V8 snapshot，保留默认启动路径。 |
| GrantFileProtocolExtraPrivileges | Enabled | renderer 当前以 `loadFile()` / `file://` 加载，不能盲目关闭。 |
| 第九个未命名 V1 wire 位 | Enabled（保留默认） | `@electron/fuses@1.8.0` 不暴露该 Electron 43 wire 项，故不翻转。 |

`package:dir`、ASAR 内容审计和最终 EXE fuse 读取均已通过。`@playwright/test@1.62.1` 已作为精确 dev dependency
安装并更新 lock。

## 尚未完成的 WP4 门禁

- 在独立副本上完成篡改/缺失 `app.asar` 的拒绝启动实测；
- 新增并运行隔离的 Playwright Electron E2E（对话框替换、TXT/DOCX 保存与备份、dirty 关闭、About、清理）；
- 明确 E2E 的可驱动 unpacked 与最终加固产物黑盒边界；
- 重跑最终 package:win、三类烟测、完整 check，并审查临时目录/进程残留。

因此 **WP4 门禁尚未通过**，不得进入 WP5。
