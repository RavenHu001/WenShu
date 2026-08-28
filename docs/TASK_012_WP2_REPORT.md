# TASK-012 WP2 报告：应用身份、版本、图标与 About

> 记录日期：2026-08-28；前序恢复点：`0bc1d4b`（WP1：更新至最新 Electron）。

## 完成内容

- `package.json.version` 固定为 `0.1.0-alpha.1`；`productName` 为 `文枢`，并在
  `wenshu` 身份字段中固定 `appId=io.github.ravenhu001.wenshu` 与
  `executableName=WenShu`。
- 新增 `app-metadata.config.ts`：构建时只读取提交中的 `package.json`，向 main、preload
  和 renderer 注入同一组固定身份常量。版本不读取用户环境变量。
- main 在创建窗口前设置 Windows AppUserModelID，窗口标题改由固定 product name 提供。
- preload 的既有只读 `runtime` 快照只新增 `appVersion`；没有新增 IPC 通道、参数、路径、
  process、文件系统或通用调用能力。
- About 显示 Alpha 标识、产品版本、平台和 Electron 版本。

## 自动证据

| 项目        | 实测结果                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| 定向测试    | 4 个文件、36 项通过：身份版本形状、About 展示、preload runtime 精确形状与冻结对象。                     |
| 全量 Vitest | 70 个测试文件、1178 passed、0 failed、10 条件 skipped。跳过均为既有 Windows symlink/junction 权限用例。 |
| `check`     | 退出码 0。                                                                                              |
| `build`     | 退出码 0；main 155.17 kB、preload 4.30 kB、renderer JS 2,264.13 kB。                                    |
| 生产启动    | 隔离 userData 下启动 4 个 Electron 进程，无启动错误，随后清理。                                         |

构建产物已静态核对包含 `0.1.0-alpha.1`、`io.github.ravenhu001.wenshu`、`文枢` 与
`WenShu`。About 的组件测试覆盖版本、Alpha、平台与 Electron 版本；自动隐藏窗口对话框采集未形成
可用完成证据，不能代替项目所有者的可见 About 人工核对。

## 图标与门禁

仓库没有可证明为项目原创、经所有者确认且可用于发布的品牌图标。现有功能 SVG 和 Task 11 视觉基线
截图不具有可追溯的品牌授权，未被用作 ICO，也没有从网络下载或自行选定新品牌图标。

因此，版本、身份、About 与 runtime 协议部分通过；**WP2 整体门禁未通过**，唯一阻塞是所有者确认的
品牌图标及其多分辨率 Windows ICO。得到权利来源和设计确认后，需新增 `build/` 资源、ICO 尺寸/格式
测试，并完成可见生产 About 人工核对；在此之前不进入 WP3。
