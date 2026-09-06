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
- 新增 `build/icon.png` 和 `build/icon.ico`。ICO 含 16、20、24、32、40、48、64、128、256 像素的
  32 位 RGBA 图层，符合后续 electron-builder 默认的 `build/icon.ico` 资源约定；本包未安装或配置
  electron-builder。

## 自动证据

| 项目        | 实测结果                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| 定向测试    | 4 个文件、35 项通过：身份版本形状、图标尺寸/格式、About 展示、preload runtime 精确形状与冻结对象。      |
| 全量 Vitest | 71 个测试文件、1179 passed、0 failed、10 条件 skipped。跳过均为既有 Windows symlink/junction 权限用例。 |
| `check`     | 退出码 0。                                                                                              |
| `build`     | 退出码 0；main 155.17 kB、preload 4.30 kB、renderer JS 2,264.13 kB。                                    |
| 生产启动    | 隔离 userData 下启动 4 个 Electron 进程，无启动错误，随后清理。                                         |

构建产物已静态核对包含 `0.1.0-alpha.1`、`io.github.ravenhu001.wenshu`、`文枢` 与
`WenShu`。About 的组件测试覆盖版本、Alpha、平台与 Electron 版本；自动隐藏窗口对话框采集未形成
可用完成证据，不能代替项目所有者的可见 About 人工核对。

## 图标权利来源与门禁

项目所有者已于 2026-08-28 明确授权在本 WP2 中自行生成适配风格的原创图标。最终素材使用 OpenAI
内置 ImageGen（`gpt-image-2`）生成，提示词限定为深蓝底、折页文档与朱砂笔划；未从网络下载素材，也
没有把功能 SVG 或视觉基线截图冒充品牌图标。生成 PNG 保留 C2PA 来源元数据，ICO 由该 PNG 无损来源
导出；完整权利来源见 `build/README.md`。

图标尺寸/格式自动测试已覆盖。版本、身份、About、只读 runtime 协议及图标资源均已满足 WP2 自动门禁；
仍需项目所有者完成一次可见生产 About 人工核对，作为人工验收记录。未进入 WP3。
