# TASK-011 WP0 报告：界面基线、事件模型与风险冻结

简体中文 | [English](./TASK_011_WP0_REPORT.en.md)

[任务档案](../README.md) · [文档中心](../../README.md)

> 执行日期：2026-08-22；分支：`TASK-011`；起始提交：`5eea921`；工作树：干净。
> 平台：Windows / PowerShell；Node.js、Electron 与依赖版本以当前锁文件为准。

## 1. 必读材料与代码核对

已完整阅读 Task 11 开发提示词要求的 README、项目基线、未来 UI 计划、Task 9/10 规划与完成报告、Task 11 规划和测试指南；仓库中未发现适用于当前目录的 `AGENTS.md`。

已核对 renderer 的 App、工作区/文件树/文件管理对话框、标签/编辑器/DOCX 工具栏、搜索组件及对应 controller；核对共享工作区、文件管理与 DesktopApi 契约；核对 preload 固定映射、主进程文件管理 IPC 与 relocate 服务；核对 Task 9/10 的 controller、组件、稳定 tabId、路径迁移、搜索失效和生命周期测试。

冻结结论：Task 11 不新增文件系统 IPC，不改变 preload/DesktopApi 集合；右键、键盘与拖拽全部汇入既有 `useFileManagement` / `useDocuments` 流程，主进程继续最终裁决路径、链接、revision、备份和发布安全。

## 2. 修改前质量基线

| 命令                          | 结果                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `.\scripts\npm.cmd run check` | 通过；62 个测试文件；1133 passed / 10 skipped；退出码 0                                         |
| `.\scripts\npm.cmd run build` | 通过；main 154.91 kB、preload 4.10 kB、renderer CSS 27.84 kB、renderer JS 2,206.54 kB；退出码 0 |

10 个跳过项均为既有的真实 symlink/junction 权限条件；拒绝分支已有 mock 适配器覆盖。测试中的三条 stderr 为既有失败注入用例对临时文件清理失败的预期记录。未发现需要弱化断言、扩大 timeout 或新增跳过的基线问题。

## 3. 修改前页面与状态矩阵

| 区域       | 当前状态                                                 | Task 11 冻结目标                                                          |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| 顶部       | Electron 英文默认菜单与 renderer 中文占位菜单同时存在    | 主进程移除默认菜单；renderer 提供唯一中文、真实命令、可键盘操作的应用菜单 |
| 活动栏     | `文 / 搜 / 设` 单字占位；设置为 disabled                 | 项目内 SVG 图标；文件/搜索有 tooltip 与无障碍名称；不展示伪可用设置入口   |
| 工作区侧栏 | 固定 238 px；底部文件管理按钮墙挤压文件树                | 180–420 px 可调；折叠/恢复；操作由树上下文菜单、键盘和拖拽承载            |
| 文件树     | 字母类型图标；展开与管理选择已有独立状态                 | SVG 图标、长路径省略、深层横向滚动；右键/Shift+F10/菜单键；内部移动       |
| 标签与状态 | 活动状态主要为顶部细线；dirty 仅圆点；保存状态占较宽文本 | 活动背景、dirty/saving/error 组合状态、可访问名称；紧凑文档状态           |
| DOCX       | 全宽编辑表面；工具栏单行挤压                             | 居中有限宽画布；分组工具栏；窄窗口固定溢出策略                            |
| TXT        | 全高 CodeMirror                                          | 保持全高，不模拟纸张                                                      |
| 搜索       | 工作区/当前查找功能完整但控件层级不统一                  | 共享输入/按钮/状态语言；文件→匹配层级；片段优先                           |
| 反馈       | 成功与错误均在侧栏工具条附近横幅显示                     | 成功为限时可关闭 toast；错误/冲突/部分完成保持可追溯                      |
| 状态栏     | 高饱和主色；长期显示 Electron 版本                       | 低权重状态栏；运行时版本移入“关于”对话框                                  |

必须持续覆盖的状态：空、loading、活动、管理选择、hover、focus-visible、dirty、saving、save-error、conflict、read-only、degraded、搜索截断、成功 toast、持久错误、确认、拖拽允许/禁止/pending。

## 4. 固定尺寸与视觉证据策略

- 固定窗口：`1280×820` 与最小窗口 `900×600`。
- Windows 人工矩阵：显示缩放 100% / 125% / 150%，文本缩放 200%，高对比度、减少动画。
- 自动化环境没有现成可靠的 Electron 像素对比基座。Task 11 不把 jsdom 样式类断言伪装成真实截图通过；改用确定性组件/布局行为测试，并在 WP5 提供真实 Electron 空工作区截图（若 capturePage 可稳定运行）和完整可复现人工截图步骤。无法自动化的工作区内容状态必须明确标为人工待核对。

## 5. 菜单技术选择与事件模型

采用 renderer 内可测试、可访问的菜单，主进程通过 `Menu.setApplicationMenu(null)` 移除 Electron 默认菜单。理由：

1. 中文菜单与产品状态（active tab、saving、工作区可用性）可直接派生；
2. 方向键、Enter、Escape、焦点圈定和恢复可由组件行为测试确定验证；
3. 不需要增加通用 menu IPC，也不扩大 preload 权限；
4. 文件树上下文菜单可复用相同菜单基础组件和固定命令描述。

事件模型：菜单以稳定 command id 和可选的规范 `relativePath` 目标描述；打开时捕获触发元素；关闭原因包括命令、Escape、外部 pointer、窗口 blur、目标卸载、工作区 epoch 变化；关闭后仅在元素仍连接时恢复焦点。全局监听只在菜单打开期间注册并在 effect cleanup 移除。

## 6. 文件树键盘与命令能力

- `Enter`：普通 TXT/DOCX 打开；目录展开/折叠。
- `F2`：普通文件/目录进入既有重命名对话框。
- `Delete`：普通文件/目录进入既有回收站确认。
- `Shift+F10` / `ContextMenu`：为当前稳定条目打开上下文菜单。
- `F5`：经 App 手工刷新入口刷新；成功才推进 mutationEpoch。
- `Ctrl+Shift+S`：经既有 save-as controller；不绕过 loaded/read-only/saving 门禁。
- `Escape`：按优先级关闭菜单、取消拖拽或退出当前非模态交互；编辑器内既有 Escape 语义不被窗口监听抢占。

## 7. 拖拽状态机

```text
idle
  -> dragging(sourcePath, sourceKind, workspaceEpoch)
       -> target(allowed | noop | forbidden, targetDirectory)
       -> Escape / dragend / unmount / workspace change -> idle
       -> drop allowed -> pending(mutationId, captured source/target/epoch)
            -> succeeded -> relocate 提交 + tab 路径迁移 + mutationEpoch + toast -> idle
            -> rejected/error -> 稳定持久错误 -> idle
            -> late result (epoch/path/operation mismatch) -> ignore + refresh if disk may have changed
```

即时纯判断只覆盖：普通 file/directory、saving、拖到当前位置、目录到自身/后代、工作区快照同名冲突和目标类型。主进程 `relocate` 继续最终裁决链接、realpath、外部竞态、目标存在、伴随备份与 partial failure。pending 期间禁止重复 drop。`DataTransfer` 只携带应用内 MIME 与规范相对路径，不接受 Windows Explorer 文件列表，不记录绝对路径或正文。

## 8. 风险与缓解

| 风险                          | 缓解                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| 菜单/快捷键绕过 saving 或确认 | 命令只调用既有 controller；菜单能力由纯函数派生，controller 与主进程仍防御          |
| 拖拽使用过期路径或工作区      | 捕获 workspaceEpoch + source path；drop 前复验快照；结果提交前复验 epoch/mutationId |
| 目录后代判断错误              | 复用段边界纯函数；`a/b` 不命中 `a/b2`；主进程再次裁决                               |
| 侧栏拖动泄漏全局监听          | pointermove/up 仅拖动期间注册，卸载与 blur 清理；宽度 clamp 纯函数单测              |
| DOCX 工具栏溢出隐藏可达命令   | 固定分组与“更多格式”菜单，所有隐藏命令保持键盘/名称/真实行为                        |
| 大范围 CSS 回归               | 先 token/common，再 shell/workspace/document/search 分包迁移；每包定向测试          |
| 截图环境不可靠                | 不伪造像素通过；保留尺寸、缩放、页面状态和人工结果栏                                |

## 9. WP0 门禁结论

修改前基线可重复通过；Task 9/10 安全与生命周期语义已映射；菜单实现、全局事件清理、拖拽状态机、视觉状态矩阵与验收策略无未决基线变更。WP0 门禁满足，可以进入 WP1。
