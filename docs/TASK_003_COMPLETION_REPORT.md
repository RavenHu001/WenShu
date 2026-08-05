# TASK-003 完成报告

> 实现完成日期：2026-08-02；最终手工验收日期：2026-08-02；验证平台：Windows，Node.js 22.x，npm 10.9.2。自动验收（check/build/测试）由开发 Agent 完成；桌面手工界面验收按第 8.4 节清单由项目所有者执行并全部通过，自动化可覆盖的部分已由 Agent 冒烟验证。

## 1. 实现摘要

实现了"文件树选择 TXT → 受控 IPC 读取 → 中央只读单标签显示"的完整产品纵向切片，贯通以下链路：

```text
React 文件树选择 TXT 相对路径
  -> 受限 preload API document.readText(relativePath)
  -> 固定 document:read-text IPC 通道
  -> 主进程读取当前工作区状态（会话模块）
  -> 路径、类型、符号链接、大小与 UTF-8 校验
  -> 可序列化的只读文档快照
  -> React 中央区域单标签显示
```

按工作包顺序实施（WP0 基线 → WP1 契约/会话/读取器 → WP2 IPC/preload → WP3 文件树选择 → WP4 中央文档区与竞态 → WP5 验收与文档），每个工作包均通过各自门禁后再进入下一包。

## 2. 新增和修改的关键文件

### 新增文件

| 文件                                                        | 用途                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/shared/document.ts`                                    | 文档共享契约：快照、10 种稳定错误码、结果联合类型、5 MiB 常量               |
| `src/main/workspace/workspace-session.ts`                   | 主进程单一工作区会话状态（get/set 根路径）                                  |
| `src/main/document/read-text-document.ts`                   | 工作区边界内异步 UTF-8 TXT 读取器（13 步校验 + 适配器注入）                 |
| `src/main/document/document-ipc.ts`                         | 固定 `document:read-text` IPC 处理器（参数数量/类型校验、根路径捕获、幂等） |
| `src/renderer/lib/use-text-document.ts`                     | 单文档状态 hook（welcome/loading/loaded/error + 请求编号竞态）              |
| `src/renderer/components/document/DocumentPane.tsx`         | 中央文档区四状态渲染                                                        |
| `src/renderer/components/document/ReadonlyTextDocument.tsx` | 只读 textarea 正文视图                                                      |
| `tests/document/read-text-document.test.ts`                 | 读取器安全分支测试（34 用例）                                               |
| `tests/document/components.test.tsx`                        | App 级界面行为与竞态测试（14 用例）                                         |
| `tests/preload/contract.test.ts`                            | preload 窄接口契约测试（8 用例）                                            |
| `docs/TASK_003_COMPLETION_REPORT.md`                        | 本报告                                                                      |

### 修改文件

| 文件                                                                             | 变更                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/shared/desktop-api.ts`                                                      | `DesktopApi` 新增 `document.readText`                        |
| `src/shared/workspace.ts`                                                        | 调整 `relativePath` 契约说明（唯一受控读取例外）             |
| `src/main/index.ts`                                                              | 注册 document IPC（+2 行）                                   |
| `src/main/workspace/workspace-ipc.ts`                                            | 工作区根路径改由会话模块持有                                 |
| `src/preload/index.ts`                                                           | 新增 `document.readText` 闭包映射                            |
| `src/renderer/App.tsx`                                                           | 文档状态接入、工作区切换失效、中央区替换为 DocumentPane      |
| `src/renderer/components/workspace/{FileTree,FileTreeNode,WorkspaceSidebar}.tsx` | TXT 节点按钮化、选中态、选择回调、`onWorkspaceSelected` 通知 |
| `src/renderer/styles/app.css`                                                    | 选中高亮与文档区样式（+76 行）                               |
| `tests/workspace/components.test.tsx`                                            | 适配新 props + 8 个选择行为用例                              |
| `tsconfig.test.json`                                                             | include 新增 `src/main/document`、`src/preload/index.ts`     |
| `README.md` / `docs/TESTING.md`                                                  | 更新当前能力与验收步骤                                       |
| `docs/TASK_003_TXT_READONLY.md`                                                  | 状态改为已完成并勾选全部验收项                               |

## 3. 数据契约、路径校验与安全边界

### 跨进程类型

```
TextDocumentSnapshot → ReadTextDocumentResult（loaded | error）
TextDocumentErrorCode（10 种稳定错误码）   MAX_TXT_FILE_BYTES = 5 MiB
```

所有字段 readonly、可序列化；不传递 Error、Buffer、句柄、Stats、函数或类实例。

### 主进程校验顺序（read-text-document.ts）

1. 工作区已打开（根路径非空且绝对）→ 2. 相对路径格式（非空、`/` 分隔、无空段/`.`/`..`/`\`/`\0`/`:`盘符形式）→ 3. 扩展名大小写不敏感 `.txt` → 4. 根路径解析候选 → 5. `path.relative` 词法逃逸检查 → 6. 逐段 `lstat`（拒绝任一层符号链接/junction，中间段必须目录、最终段必须普通文件）→ 7-8. 根与候选 `realpath` 后再次边界检查 → 9. 读取前大小检查（≤5 MiB）→ 10-11. 有界读取（最多 5 MiB+1 字节）并复检实际长度 → 12. `TextDecoder` fatal 严格 UTF-8 → 13. 去 BOM 后返回快照。

### 安全边界保持

| 约束                                                                  | 状态                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------- |
| `nodeIntegration: false` / `contextIsolation: true` / `sandbox: true` | 未修改                                                  |
| preload 仅新增 `document.readText(relativePath)` 一个闭包函数         | 无 `ipcRenderer`、通用 invoke、任意路径、编码或选项参数 |
| IPC 入口验证参数数量与类型；不接受根路径/绝对路径/编码/大小选项       | 是                                                      |
| 渲染进程不直接导入 Node.js/Electron/文件系统模块                      | 是                                                      |
| 读取只使用只读 API（`lstat`、`realpath`、`open('r')` 有界读取）       | 无任何写入、创建、重命名、删除或权限修改调用            |
| 正文不写入日志                                                        | 是                                                      |
| 跨进程结果不含原始异常、Buffer、文件句柄或调用栈                      | 是（有测试断言）                                        |

## 4. 新增依赖及选择原因

**无。** TASK-003 全部工作包未新增任何生产或开发依赖，全部使用现有 React、Vitest、React Testing Library、TypeScript 能力。

## 5. 实际执行的自动检查和结果

| 命令                        | 结果                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `typecheck`（5 tsconfig）   | **通过**                                                                                               |
| `lint`（--max-warnings=0）  | **通过**                                                                                               |
| `format:check`              | **通过**                                                                                               |
| `test`（6 files, 90 tests） | **通过** — 运行时 2 + 扫描器 11 + 读取器 34(2 条件跳过) + preload 契约 8 + 工作区组件 21 + 文档组件 14 |
| `check`                     | **通过**                                                                                               |
| `build`                     | **通过** — main 11.54 kB, preload 1.00 kB, renderer 572.34 kB                                          |

### 各工作包门禁

| 工作包 | 门禁                                                  | 结果               |
| ------ | ----------------------------------------------------- | ------------------ |
| WP0    | 基线记录、范围无歧义                                  | 通过               |
| WP1    | 读取器测试 + check + build；未注册 IPC、未改界面      | 通过（31+2 跳过）  |
| WP2    | 仅固定通道；无通用 IPC/任意路径 API；check + build    | 通过（契约测试 8） |
| WP3    | 树只报告 TXT 用户选择；Task 2 行为保持；check + build | 通过（+8 用例）    |
| WP4    | 组件测试覆盖 8.3；无编辑/多标签/保存；check + build   | 通过（+14 用例）   |
| WP5    | 第十一节全部满足                                      | 见第 8 节          |

## 6. 桌面冒烟验证记录

| 验证项                                           | 结果 | 验证方式                                                           |
| ------------------------------------------------ | ---- | ------------------------------------------------------------------ |
| 开发环境启动                                     | 通过 | `.\scripts\dev.cmd` 启动，进程存活 >25s，无崩溃后手动结束          |
| 生产构建启动                                     | 通过 | `.\scripts\npm.cmd exec -- electron .` 加载 `out/` 构建，存活 >25s |
| 打开含多层目录的工作区                           | 通过 | 项目所有者手工验收（2026-08-02）                                   |
| 打开根目录 UTF-8 TXT，中央显示加载状态与只读标签 | 通过 | 项目所有者手工验收                                                 |
| 展开子目录并打开嵌套 TXT                         | 通过 | 项目所有者手工验收                                                 |
| 中文、多行、空 TXT 与 BOM 行为正确               | 通过 | 项目所有者手工验收                                                 |
| 连续快速选择两个 TXT，最终显示最后选择的文件     | 通过 | 项目所有者手工验收                                                 |
| 非 TXT 文件、目录、符号链接不读取正文            | 通过 | 项目所有者手工验收                                                 |
| 外部删除后点击 TXT 显示错误且不崩溃              | 通过 | 项目所有者手工验收                                                 |
| 打开超过 5 MiB 或非法 UTF-8 文件时看到明确提示   | 通过 | 项目所有者手工验收                                                 |
| 刷新工作区后当前只读正文保持可见                 | 通过 | 项目所有者手工验收                                                 |
| 成功切换工作区后旧正文清除；取消切换时旧正文保留 | 通过 | 项目所有者手工验收                                                 |
| 正文不可编辑，开发者控制台无未处理异常           | 通过 | 项目所有者手工验收                                                 |
| 应用没有创建、修改或删除测试文件                 | 通过 | 项目所有者手工验收                                                 |

## 7. 已知限制

1. **TOCTOU**：对本地进程恶意并发替换文件导致的 OS 级竞态，本任务只要求尽量缩小校验与读取窗口并保证只读，未实现平台原生句柄级防竞态方案（按任务第 6.2 节允许范围）。
2. **符号链接测试条件性**：本机无符号链接创建权限，2 个真实 symlink/junction 用例以条件跳过（`it.runIf`）；拒绝分支已有 lstat mock 用例确定性覆盖，建议在启用开发者模式的环境补跑。
3. **单文档单标签**：再次选择 TXT 直接替换，无标签数组、无关闭按钮、无未保存标记（任务明确范围）。
4. **文件删除后仍显示快照**：刷新后文件被删除时，当前只读正文作为最后一次成功快照保留，重新选择时才报错（任务第 4.4 节规定语义）。
5. **无恢复状态**：关闭应用后文档与工作区状态丢失（后续任务范围）。
6. **preload/IPC 契约测试基于 mock**：真实 Electron 桥接行为由桌面冒烟与后续 E2E 设施验证（任务允许范围内）。

## 8. 最终验收标准核查

任务文档第十一节 11.1（13 项功能验收）、11.2（11 项安全验收）、11.3（14 项质量验收）全部满足并已在 `TASK_003_TXT_READONLY.md` 勾选。其中：

- 自动验收项（typecheck/lint/format:check/test/check/build、读取器与界面测试、Task 2 回归）：全部由命令实际执行通过；
- 桌面冒烟项：开发/生产构建关键路径由 Agent 启动验证，第 8.4 节 13 项手工清单由项目所有者于 2026-08-02 全部执行并通过；
- README 与 TESTING.md 已与实际能力同步更新。

## 9. 任务状态与后续入口

**TASK-003 状态：已完成。**

下一任务已规划为 [TASK-004：单 TXT 基础编辑与安全保存](./TASK_004_TXT_EDIT_SAFE_SAVE.md)。该任务延续小型纵向切片：在当前单 TXT 只读文档基础上加入基础编辑状态与显式保存，采用“写入同目录临时文件 → 刷盘 → 关闭 → 安全替换”的保存流程，保证失败时不丢失原文件或未保存内容，并设计修改状态、保存快捷键、保存失败语义与外部文件变化冲突。仍不同时加入多标签页、工作区搜索或 DOCX。
