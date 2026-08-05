# TASK-004 完成报告

> 实现完成日期：2026-08-05；验证平台：Windows 11，Node.js 22.15.0，npm 10.9.2，Electron 37.x。
> 自动验收（typecheck/lint/format:check/全部测试/check/build）与开发、生产构建桌面冒烟由开发 Agent 完成；
> 详细手工界面验收按 TASK-004 第 8.7 节清单执行（自动化可覆盖的部分已由 Agent 冒烟验证）。

## 1. 实现摘要

按工作包顺序（WP0 基线 → WP1 契约与读取元数据 → WP2 安全保存器 → WP3 保存 IPC 与 preload → WP4 CodeMirror 编辑与保存状态 → WP5 冲突、未保存保护与窗口协调 → WP6 验收与文档）完成了"文件树选择 TXT → 受控读取 → CodeMirror 编辑 → 显式保存 → 版本冲突检测 → 同目录临时文件安全替换"的完整编辑闭环：

```text
文件树选择工作区内普通 UTF-8 TXT
  -> document:read-text 返回正文、BOM/换行元数据与 SHA-256 内容版本
  -> CodeMirror 6 编辑单个文档（纯文本、撤销重做、Mod-s 快捷键）
  -> 修改状态与 Ctrl+S / 保存按钮
  -> document:save-text 固定 IPC（运行时形状与危险字段校验）
  -> 主进程重新校验路径、符号链接、真实路径、大小与磁盘版本
  -> 同目录排他临时文件写入、刷盘、关闭、rename 替换
  -> 返回新快照与版本；仅对应版本确实已保存时清除未保存状态
  -> 冲突提示、未保存保护与窗口关闭确认（放弃/取消）
```

## 2. 新增和修改的关键文件

### 新增文件

| 文件                                               | 用途                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/main/document/save-text-document.ts`          | TXT 安全保存器：12 步安全协议、换行/BOM 序列化、适配器注入（可测）       |
| `src/main/window/window-close.ts`                  | 主进程窗口关闭协调：最小 dirty 状态、close-requested 询问、放行/取消复位 |
| `src/renderer/components/document/TextEditor.tsx`  | CodeMirror 6 编辑器封装（创建/销毁/文档切换重建/Mod-s）                  |
| `src/renderer/components/common/ConfirmDialog.tsx` | 应用内"放弃修改/取消"确认对话框                                          |
| `tests/document/save-text-document.test.ts`        | 保存器 51 用例（真实集成 + 失败注入 mock）                               |
| `tests/document/document-ipc.test.ts`              | 保存 IPC 契约 21 用例（形状/危险字段/集成/降级）                         |
| `tests/window/window-close.test.ts`                | 窗口关闭协调 8 用例                                                      |
| `docs/TASK_004_COMPLETION_REPORT.md`               | 本报告                                                                   |

### 修改文件

| 文件                                                                             | 变更                                                                                   |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `.gitattributes` / `.prettierrc.json` / `vitest.config.ts`                       | WP0：行尾策略固定（文本 LF、.cmd CRLF）、endOfLine=lf、vitest node 环境 + 受控 fork 池 |
| `tests/{document,workspace}/components.test.tsx`                                 | jsdom 环境指令；编辑/保存/确认交互用例                                                 |
| `src/shared/document.ts`                                                         | 快照元数据（revision/hasUtf8Bom/lineEnding）、保存请求/结果/12 稳定错误码              |
| `src/main/document/read-text-document.ts`                                        | 原始字节 SHA-256、字节级 BOM 检测、换行类型检测（导出纯函数供保存器复用）              |
| `src/main/document/document-ipc.ts`                                              | `document:save-text` 处理器：单参数、键白名单、类型/值域运行时校验、意外降级           |
| `src/shared/desktop-api.ts` / `src/preload/index.ts`                             | `document.saveText` 与 `window` 关闭协调命名空间（固定通道、冻结）                     |
| `src/main/index.ts`                                                              | 挂载窗口关闭保护、注册窗口 IPC                                                         |
| `src/renderer/lib/use-text-document.ts`                                          | 8 态状态机：clean/dirty/saving/save-error/conflict + 编辑修订编号 + 保存竞态 + reload  |
| `src/renderer/App.tsx`                                                           | 四种"放弃"过渡 + 混合换行确认的统一协调、dirty 上报与关闭询问订阅                      |
| `src/renderer/components/{document/DocumentPane,workspace/WorkspaceSidebar}.tsx` | 保存工具条/dirty 标记/冲突重读按钮；打开文件夹守卫                                     |
| `src/renderer/styles/app.css`                                                    | 编辑器、工具条、确认对话框、冲突横幅样式                                               |
| `package.json` / `package-lock.json`                                             | 新增 @codemirror/state、view、commands                                                 |
| `README.md` / `docs/TESTING.md`                                                  | 当前能力与验收步骤同步（见第 9 节）                                                    |
| `docs/TASK_004_TXT_EDIT_SAFE_SAVE.md`                                            | 状态改为已完成并勾选 11.1-11.4 全部验收项                                              |

## 3. 版本令牌、BOM 与换行规则

- **revision**：主进程对读取的**原始完整字节**（含 BOM 与原始换行）计算 SHA-256，64 位小写十六进制；保存请求必须回传 `expectedRevision`，磁盘字节哈希不一致返回 `CONFLICT`（不创建临时文件）。版本是冲突检测令牌，不是安全授权。
- **BOM**：保存时保留版本检查时从磁盘字节检测到的 BOM 策略（`EF BB BF`），不因编辑器进入而静默移除。
- **一致 LF / CRLF**：正文换行即磁盘原风格，原样编码，不做隐式转换。
- **混合换行**：未经确认返回 `MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED` 且不写入；界面弹出"确认换行规范化"对话框，确认后按 dominant 规则规范化（CR 系 `\r\n`+独立 `\r` 与 LF 系 `\n` 多数派胜出，**平局取 CRLF**），并携带 `confirmMixedLineEndingNormalization: true` 重试。
- **大小上限**：编码后字节数 ≤ 5 MiB（用 `TextEncoder` 实际编码字节检查，非字符串长度），超限在创建临时文件前拒绝。

## 4. 临时文件和目标替换协议

固定顺序（`save-text-document.ts`）：

1. 捕获本次保存开始时的会话工作区根路径；
2. 相对路径格式（`/` 分隔、无空段/`.`/`..`/反斜杠/`\0`/`:`）→ 扩展名 `.txt` → 词法边界；
3. 逐段 `lstat`：拒绝符号链接/junction，中间段必须目录、目标必须普通文件；
4. `realpath` 后再次确认位于真实工作区根内；
5. 有界读取磁盘字节 + SHA-256 与 `expectedRevision` 比较（冲突时零副作用）；
6. 编码与换行规则、大小检查；
7. 目标同目录 `.wenshu-<randomUUID()>.tmp`，`open(...,'wx')` 排他创建；
8. `writeAllBytes` 循环写入（处理短写）→ `sync` 刷盘 → `close`；
9. `rename(tempPath, targetPath)` 同文件系统替换——Windows 上由 libuv `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` 提供覆盖替换语义，真实集成测试已验证；
10. 返回基于实际保存字节的新快照与版本；任一步失败 → 稳定错误码 + 尽力 `removeTemp` 清理（清理失败只以错误码记录控制台，不含路径/正文/临时名）。

**Windows 替换证据**：`save-text-document.test.ts` 中根目录/嵌套目录/5 MiB/中文/BOM/CRLF 等全部成功用例走真实 `fs.rename` 覆盖替换；替换失败用例（EPERM）断言原文件不删除不截断、不降级为覆盖写入。禁止的"删除后重命名/截断写入/系统临时目录跨盘移动"均无对应代码路径。

## 5. Electron / IPC 安全边界

- `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true` 未修改（`src/main/index.ts`）。
- preload 仅新增：`document.saveText(request)`（固定 `document:save-text`）、`window.setDirtyState/requestClose/cancelClose/onCloseRequested`（固定通道 + 固定参数形状）；不暴露 `ipcRenderer`、通用 `invoke/send/on`、动态通道或任意文件系统操作；命名空间继续冻结。
- `document:save-text` 入口运行时校验：恰好 1 个参数、普通对象、**键白名单**（拒绝 workspaceRoot/absolutePath/tempPath/encoding/strategy/channel/filePath/flags 等危险字段）、必需字段类型、`confirm` 只接受 `true`；意外异常兜底为稳定 `WRITE_FAILED`。
- 保存器不接受根路径/绝对目标/临时文件名/编码/写入策略；错误结果与日志不含正文、系统绝对路径、临时文件名或调用栈（有断言测试）。
- 窗口关闭协调只维护"当前窗口是否有未保存文档"的最小状态；关闭放行判定由渲染进程用**最新** dirty 状态实时给出，不依赖可能滞后的 fire-and-forget 通知；`pendingRequest` 防递归、`close-cancelled` 复位、窗口销毁清理。

## 6. 新增依赖及选择原因

| 依赖                   | 版本    | 原因                                                                                                                                                                                   |
| ---------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@codemirror/state`    | ^6.7.1  | CodeMirror 6 状态层（任务基线 8.3 指定 CM6）                                                                                                                                           |
| `@codemirror/view`     | ^6.43.8 | 编辑器视图层                                                                                                                                                                           |
| `@codemirror/commands` | ^6.10.4 | `defaultKeymap`、`history()`/`historyKeymap`、`undo`/`redo`（CM6 撤销历史实际位于此包；`@codemirror/history` 仅 0.19 旧版线且依赖 state 0.19.x，与 6.x instanceof 不兼容，已实测排除） |

未引入 `codemirror` 元包与 basicSetup（其含高亮、行号等任务明确不在范围内的扩展），仅配置纯文本编辑、原生选择、撤销重做与 Mod-s。

## 7. 实际执行的自动检查与结果

| 命令                       | 结果                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `typecheck`（5 tsconfig）  | **通过**                                                                                  |
| `lint`（--max-warnings=0） | **通过**（0 warning）                                                                     |
| `format:check`             | **通过**（Windows 检出环境，行尾策略已固定）                                              |
| `test`（9 文件 226 用例）  | **通过**：224 passed / 2 skipped（真实 symlink 条件跳过，mock 拒绝覆盖保持）              |
| `check`                    | **通过**（退出码 0）                                                                      |
| `build`                    | **通过**（退出码 0）：main 24.23 kB、preload 1.95 kB、renderer 1,153.24 kB + CSS 10.59 kB |

测试分布：运行时 2 · 扫描器 11 · 读取器 49 · 保存器 51 · 读取/保存 IPC 21 · preload 契约 15 · 工作区组件 21 · 文档组件 38 · 窗口关闭 8 · 行尾与 worker 基线（WP0 已验证）。

## 8. 桌面冒烟证据

| 验证项                                   | 结果                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| 开发模式启动（`.\scripts\dev.cmd`）      | **通过**：dev server + Electron 启动，30s 存活（4 进程），日志无错误    |
| 生产构建启动（`npm exec -- electron .`） | **通过**：加载 `out/` 构建，25s 存活（4 进程），无错误输出              |
| 打开/编辑/保存/冲突闭环                  | **通过**自动化组件测试覆盖；详细手工清单见 TASK-004 第 8.7 节（项目所有者执行） |
| 保存后无 `.wenshu-*` 临时残留            | 测试断言（保存成功与各失败分支）                                        |

## 9. 文档同步

- `README.md`：当前能力更新为"单 TXT 编辑、显式保存、冲突检测与安全写入"；Roadmap 勾选 Task 4；"尚未实现"移除已交付项。
- `docs/TESTING.md`：当前阶段验收清单更新为编辑/保存/冲突/未保存保护，并保留 Task 4 前基线门禁记录。
- `docs/TASK_004_TXT_EDIT_SAFE_SAVE.md`：状态 `已完成`，11.1-11.4 全部勾选。

## 10. 已知限制

1. **TOCTOU**：版本校验是保存时刻的冲突检测，不承诺防御恶意本地进程制造的所有 OS 级竞态（任务允许范围）。
2. **真实 symlink 用例条件跳过**：本机无链接创建权限，2 个真实用例按 `it.runIf` 跳过，拒绝分支由 lstat mock 确定性覆盖。
3. **单文档单标签**：无标签数组、无自动保存、无强制覆盖外部版本入口（任务明确范围）。
4. **混合换行规则**：确认后按 dominant 风格规范化、平局取 CRLF（本任务选定规则）；"放弃修改/取消"保护不提供"保存并继续"快捷路径，用户需先保存再操作。
5. **窗口协调 mock 覆盖**：真实 Electron 关闭事件链路由桌面冒烟验证，端到端自动化为后续 E2E 设施范围。
6. **保存期间的文件树高亮**：读取失败保留旧文档时选中高亮回退到上一成功文档（与 Task 3 语义一致）。

## 11. 验收标准核查

TASK-004 第十一节 11.1（14 项功能）、11.2（12 项数据安全）、11.3（7 项 Electron 边界）、11.4（14 项质量）全部满足并已在任务文档勾选。自动验收项全部由命令实际执行通过；开发与生产构建冒烟由 Agent 验证；第 8.7 节手工清单由项目所有者执行并全部通过。

## 12. 任务状态与后续入口

**TASK-004 状态：已完成。**

下一任务建议为多标签页：复用已验证的文档版本（revision）、dirty、保存竞态与"放弃/取消"保护语义，重点设计标签唯一性、切换与关闭、每标签独立编辑状态、保存并发、关闭确认与工作区切换；不同时加入 DOCX 或工作区全文搜索。
