# TASK-009 完成报告：基础文件管理闭环

简体中文 | [English](./TASK_009_COMPLETION_REPORT.en.md)

[任务档案](../README.md) · [文档中心](../../README.md)

> 实施日期：2026-08-16（WP0-WP8）；验证平台：Windows 11（zh-CN，build 10.0.26200），
> Node.js 22.15.0，npm 10.9.2，Electron 37.10.3，TypeScript 5.9.3，Vitest 3.2.7。
> WP0-WP7 逐包实施、逐包验收；WP8 整体验收、文档同步与完成报告。自动验收
> （typecheck/lint/format:check/全部测试/check/build）、开发与生产构建桌面冒烟、
> 回收站恢复与外部占用实测、Windows 文件系统行为实测由开发 Agent 完成；
> 任务第九节手工界面清单与 WP7 手工功能测试由项目所有者执行并通过
> （用户确认"手动功能测试已通过"；WP7 修复"重命名/新建不保留或补全扩展名"）。

## 1. 实现摘要

按工作包顺序（WP0 锁定基线、Windows 行为与固定语义 → WP1 stable tabId 与纯路径迁移
状态机 → WP2 共享契约、名称校验与源/目标路径安全 → WP3 新建、资源管理器显示与固定 IPC →
WP4 TXT/DOCX 另存为与 revision 覆盖确认 → WP5 重命名、移动、伴随备份与回收站删除 →
WP6 文件管理 controller、文件树与对话框 UI → WP7 生命周期、搜索失效、Windows 冒烟与
风险收敛 → WP8 整体验收、文档与完成报告）完成了从"只读文件树"到"工作区内基础文件管理
闭环"的交付：

```text
工作区文件树（TXT/DOCX/文件夹/普通文件/目录）
  -> 固定窄 IPC（create-entry / relocate / trash / reveal / save-text-as / save-docx-as）
  -> 主进程源/目标逐段校验（不跟随 symlink/junction、realpath 边界、大小写权威）
  -> 按窗口串行的写操作队列 + 发布前复验（排他创建、目标不存在、源类型未变）
  -> 新建 TXT/DOCX/文件夹；另存为两阶段覆盖确认（TARGET_EXISTS → expectedTargetRevision CAS）
  -> 重命名/移动（含 Windows case-only 两步中间名 + 回滚；DOCX 伴随 .wenshu.bak 迁移）
  -> 删除到 Windows 回收站（shell.trashItem，禁止永久删除降级）
  -> 成功 mutation 刷新工作区并递增 mutationEpoch：取消活动搜索、清空结果与定位
  -> stable tabId 标签原地迁移（单文件精确 / 目录段边界前缀），编辑器会话与 dirty/saving 保持
```

## 2. 新增与修改的关键文件

### 新增文件

| 文件                                                          | 用途                                                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/file-management.ts`                               | 文件管理共享契约：固定请求/结果形状、稳定错误码与文案、Windows 叶名称校验、路径纯函数（case-only、same/descendant、internal name） |
| `src/main/workspace/resolve-workspace-entry.ts`               | 源/目标解析：逐段 lstat/realpath、链接拒绝、根父目录 `''`、不存在目标解析与发布前复验                                              |
| `src/main/workspace/create-workspace-entry.ts`                | TXT/DOCX/文件夹排他新建：空模型 DOCX 导出验证、同目录排他临时文件、不覆盖发布                                                      |
| `src/main/workspace/relocate-workspace-entry.ts`              | 重命名/移动：case-only 两步中间名与回滚、目录 same/descendant 拒绝、DOCX 伴随备份迁移/回滚/PARTIAL_FAILURE                         |
| `src/main/workspace/trash-workspace-entry.ts`                 | 删除到回收站：可注入 `shell.trashItem` 适配器、主文件与伴随备份非事务 PARTIAL_FAILURE                                              |
| `src/main/workspace/reveal-workspace-entry.ts`                | 在资源管理器中显示：重新校验后固定 `showItemInFolder`，不开放通用 shell                                                            |
| `src/main/workspace/mutation-coordinator.ts`                  | 按窗口串行写操作队列（同一窗口同一时刻最多一个写操作）                                                                             |
| `src/main/workspace/file-management-ipc.ts`                   | 固定 IPC：`workspace:create-entry` / `relocate` / `trash` / `reveal`，精确形状校验                                                 |
| `src/main/document/save-text-document-as.ts`                  | TXT 另存为服务：BOM/换行复用、两阶段覆盖、排他创建/安全替换                                                                        |
| `src/main/docx/save-docx-document-as.ts`                      | DOCX 另存为服务：兼容性确认、导出验证、目标滚动备份、两阶段覆盖                                                                    |
| `src/renderer/lib/use-file-management.ts`                     | 文件管理 controller：mutationId 状态机、输入/目标选择/确认、成功副作用与 mutationEpoch 通知                                        |
| `src/renderer/components/workspace/FileManagementToolbar.tsx` | 操作栏（新建/重命名/移动/删除/reveal/另存为）与消息横幅                                                                            |
| `src/renderer/components/workspace/FileManagementDialogs.tsx` | 名称输入、目录选择、覆盖确认、删除确认、partial failure 对话框                                                                     |
| `tests/file-management/contract.test.ts`                      | 共享契约测试（22）：请求/结果形状、稳定错误、Windows 名称、路径词法                                                                |
| `tests/file-management/resolve-workspace-entry.test.ts`       | 解析器测试（13，1 条件跳过）：父目录逐段、链接拒绝、大小写冲突、realpath 边界                                                      |
| `tests/workspace/create-workspace-entry.test.ts`              | 新建服务测试（13）：排他、临时文件管线、DOCX 验证、父目录竞态、清理                                                                |
| `tests/workspace/relocate-workspace-entry.test.ts`            | 重命名/移动测试（15，1 条件跳过）：case-only、后代拒绝、伴随备份、回滚、partial failure                                            |
| `tests/workspace/trash-workspace-entry.test.ts`               | 删除测试（7，1 条件跳过）：trashItem 适配器、备份伴随、dirty/saving 结果                                                           |
| `tests/workspace/reveal-workspace-entry.test.ts`              | reveal 测试（5，1 条件跳过）：存在性/类型/链接校验、shell 调用一次                                                                 |
| `tests/workspace/mutation-coordinator.test.ts`                | 写操作串行测试（4）                                                                                                                |
| `tests/workspace/file-management-ipc.test.ts`                 | 固定 IPC 测试（10）：形状拒绝、根路径、NO_WORKSPACE、串行                                                                          |
| `tests/document/save-text-document-as.test.ts`                | TXT 另存为测试（10）：BOM/换行、两阶段、目标不存在/存在、CAS                                                                       |
| `tests/docx/save-docx-document-as.test.ts`                    | DOCX 另存为测试（9）：兼容性、导出验证、备份、覆盖 CAS                                                                             |
| `tests/document/save-as-ipc.test.ts`                          | 另存为 IPC 测试（5）                                                                                                               |
| `tests/document/tab-path-migration.test.ts`                   | 纯路径迁移状态机测试（22）：单文件/目录段边界迁移、save-as 完成、批量关闭、不变量                                                  |
| `tests/document/save-as-controller.test.tsx`                  | saveAsTab controller 测试（7）：成功迁移、继续编辑、TARGET_OPEN、两阶段、失败保留                                                  |
| `tests/workspace/relocate-trash-controller.test.tsx`          | relocate/trash controller 测试：标签迁移/关闭、saving 阻止                                                                         |
| `tests/workspace/file-management-ui.test.tsx`                 | WP6/WP7 UI 集成测试（22）：选择/展开、新建/重命名/删除流程、扩展名补全、mutationEpoch 通知                                         |
| `tests/workspace/mutation-epoch-lifecycle.test.tsx`           | WP7 App 级集成测试（7）：mutation 成功清空搜索/定位，失败/取消/reveal 保留，手工刷新                                               |
| `docs/tasks/task-009/TASK_009_WP0_REPORT.md`                  | WP0 基线、Windows 行为实测与冻结决策                                                                                               |
| `docs/tasks/task-009/TASK_009_COMPLETION_REPORT.md`           | 本报告                                                                                                                             |

### 修改文件

| 文件                                                                                                            | 变更                                                                                                     |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/renderer/lib/document-tabs.ts`                                                                             | stable tabId 与 relativePath 解耦、路径迁移/批量关闭/save-as 完成纯状态转移、不变量校验                  |
| `src/renderer/lib/use-documents.ts`                                                                             | openFile 按稳定 tabId、saveAsTab 两阶段编排、commitRelocateResult/commitTrashResult、invalidateWorkspace |
| `src/renderer/lib/use-workspace.ts`                                                                             | 新增 `mutationEpoch` 与 `notifyMutationCommitted`；`refreshWorkspace` 返回是否成功替换快照               |
| `src/renderer/lib/use-workspace-search.ts`                                                                      | mutationEpoch 接入提交守卫：变化即取消在途搜索并清空全部旧结果；迟到结果三重校验                         |
| `src/renderer/App.tsx`                                                                                          | 接线 mutationEpoch、手工刷新包装（成功才作废）、mutationEpoch 变化清空定位/提示、文件管理对话框组合      |
| `src/renderer/components/workspace/FileTree.tsx` / `FileTreeNode.tsx`                                           | 条目独立选择、目录展开受控、TXT/DOCX 可打开、目录与其他文件仅可选择                                      |
| `src/renderer/components/workspace/WorkspaceSidebar.tsx`                                                        | 文件管理操作栏接入、刷新回调类型放宽                                                                     |
| `src/preload/index.ts` / `src/shared/desktop-api.ts`                                                            | 固定 `createText/createDocx/createDirectory/reveal/relocate/trash/saveTextAs/saveDocxAs`                 |
| `src/main/index.ts`                                                                                             | 注册文件管理/另存为 IPC                                                                                  |
| `tests/document/document-tabs.test.ts`、`tests/preload/contract.test.ts`、`tests/document/docx-editor.test.tsx` | 既有契约/状态测试适配 stable tabId 与新能力                                                              |

## 3. 固定产品范围与明确非目标

- 范围：工作区内新建 TXT/基础 DOCX/文件夹；TXT/DOCX 另存为（两阶段覆盖确认）；普通文件与
  目录重命名/移动（含 Windows case-only）；删除到 Windows 回收站；在资源管理器中显示；
  成功后标签安全迁移、dirty/saving 保持；旧搜索结果与在途定位失效。
- 非目标（不在 Task 9 实现）：复制粘贴、批量操作、拖拽、永久删除、跨工作区/跨盘操作、
  文件系统监听与自动刷新、untitled 内存文档、通用 Save As 对话框、`force`/`overwrite`/
  `skipValidation` 等危险开关、任意 shell 能力。

## 4. Windows 名称、路径、link、边界与 case-only 规则

（实测证据见 `docs/tasks/task-009/TASK_009_WP0_REPORT.md` 第 5-6 节，均以真实文件系统夹具验证）

- 非法字符 `< > : " / \ | ? *` 与控制字符：主进程白名单预校验返回 `INVALID_NAME`，不依赖 OS 错误码；
- 保留设备名 `CON/PRN/AUX/NUL/COM1-9/LPT1-9`（含扩展名形式）：Node `\\?\` 语义可真实创建，
  因此 `validateWindowsLeafName` 显式拒绝；
- 尾随点/空格：拒绝，避免 Explorer/Win32 互操作歧义与备份名冲突；
- 大小写冲突：新建/另存为用排他创建判定 `TARGET_EXISTS`，严禁 writeFile 预检（实测直接覆盖）；
- case-only rename：冻结为"同目录、不可预测、排他中间名两步 rename + 任一步失败回滚；
  回滚失败 → `PARTIAL_FAILURE`"（一步 rename 本机成功但非普遍保证）；
- 目标父目录从工作区根逐段 lstat（根父目录 `''` 显式支持），拒绝任一 symlink/junction，
  中间/最终父段必须普通目录，随后 realpath 边界检查；叶不存在走专用不存在目标解析；
- 目录不能移动到自身或任一后代（段边界 `isSameOrDescendantPath`，OS 依赖 EPERM 不可靠）；
- 内部恢复/临时名称（`.wenshu.bak`、`.wenshu-*`）不允许作为管理目标，不在文件树暴露。

## 5. stable tabId、目录后代迁移与编辑器会话

- tabId 为 renderer 会话内稳定、不可由路径推导的身份（单调计数器）；relativePath/name 为可迁移
  属性；打开去重仍按规范相对路径（主进程为大小写权威）；
- 单文件迁移只命中精确路径；目录迁移按段边界前缀一次性线性更新全部后代标签（`a/b` → `x` 时
  `a/b/c.txt` 迁移为 `x/c.txt`，`a/b2.txt` 与 `a.txt` 不误命中），不扫描编辑器 DOM；
- TXT 的 CodeMirror `EditorState`、选区、滚动、撤销历史、查找面板与查询保持；DOCX 的
  Tiptap/ProseMirror 实例、选区、滚动、撤销历史与工具栏绑定保持；标签顺序、活动标签、
  dirty、saving、editRevision、读取/保存请求身份全部保持（`tests/document/tab-path-migration.test.ts`
  与 WP1 既有测试断言）；
- 迁移前捕获、迁移后才完成的旧保存不得写回旧路径：存在受影响 saving 标签时 relocate/trash
  被阻止（controller 与主进程双侧），迁移后保存只写新路径（`migrateTabPath` 后 `completeSave` 测试）。

## 6. 新建与另存为

- TXT 新建：0 字节合法无 BOM UTF-8，同目录排他临时文件写入 → sync → close → 发布前复验
  （目标仍不存在）→ 同文件系统 rename 发布；任一步失败尽力清理临时文件；
- DOCX 新建：版本正确空白模型（至少一个空段落）→ 导出 → 大小/ZIP/OOXML/重导入验证 →
  同一临时文件管线发布；验证失败 `VERIFICATION_FAILED`，目标不变；
- 文件夹：非递归单级 mkdir（EEXIST → `TARGET_EXISTS`），不隐式创建父目录；
- 三类新建均不覆盖、不自动改名、不自动加数字后缀；冲突由用户明确修正；
- TXT 另存为：复用 BOM 保留、换行规则、混合换行确认与安全替换；新目标排他创建；
- DOCX 另存为：复用兼容性确认（degraded 绑定 revision，read-only 拒绝）、导出与产物验证；
  覆盖前为目标创建滚动备份（内容 = 替换前原字节），备份失败目标不变；新目标不创建无意义备份；
- 两阶段覆盖：目标存在时第一次只返回 `TARGET_EXISTS` 与受控目标 revision，不写盘；确认后
  第二次请求必须携带 `expectedTargetRevision`，发布前再次比较，变化返回 `CONFLICT` 重新确认；
  不接受 `overwrite: true` / `force: true`；
- 另存为成功后源文件保持不变，当前标签原地迁移到目标路径（stable tabId 不变）；保存期间
  继续编辑则迁移后保持 dirty；失败时标签仍指向源路径且正文/模型不丢失；
- 目标已由另一标签打开时 renderer 不发请求（`TARGET_OPEN` 产品状态）。

## 7. DOCX 目标/伴随备份策略

- 另存为覆盖：`<目标>.wenshu.bak` 为目标替换前原字节的滚动备份；备份失败目标不变；
- 重命名/移动单 DOCX：如 `<源>.wenshu.bak` 存在则伴随迁移到 `<目标>.wenshu.bak`；目标备份
  已存在 → 操作前 `TARGET_EXISTS`；伴随迁移失败 → 尝试回滚主文件，回滚成功返回
  `BACKUP_FAILED`（目标未修改），回滚失败返回 `PARTIAL_FAILURE`；
- 目录重命名/移动/删除自然携带目录内备份，不单独枚举或暴露；
- 单 DOCX 删除时主文件与伴随备份都送入回收站（非事务；部分成功返回 `PARTIAL_FAILURE`，
  立即刷新，不把已入回收站的主文件写回原位置冒充回滚）。

## 8. relocate、trash、回滚与 partial failure

- relocate：同路径字符串完全相同为安全无操作；同卷 rename 原子语义（不先复制再删除）；
  发布前复验源类型未变、目标仍不存在；case-only 两步 + 回滚（见第 4 节）；
- trash：统一可注入 `shell.trashItem` 适配器，严禁 unlink/rm/rmdir 降级；删除根/link/other/
  内部文件拒绝；主进程成功前不关闭标签；文件删除关闭对应标签、目录删除关闭全部后代标签；
- partial failure：返回稳定错误 + 强制刷新 + 保留可诊断信息（不含绝对路径/正文）；renderer
  显示"操作部分完成"对话框并禁止假定原/目标路径状态；
- 写操作串行：同一窗口同一时刻最多一个文件管理写操作（`mutation-coordinator`），另存为与
  普通保存服从目标标签 `saveInFlight`。

## 9. 工作区刷新、选择/展开与搜索失效（mutationEpoch）

- 所有成功 create/save-as/relocate/trash 触发工作区重新扫描并递增 `mutationEpoch`
  （`use-workspace.notifyMutationCommitted`）；partial failure（磁盘已部分改变）同样递增；
- mutationEpoch 变化：取消活动搜索、清空 completed/cancelled/error 结果、清空定位目标与
  过期提示（`use-workspace-search` 提交守卫 + App effect）；迟到搜索结果必须同时校验
  requestId + workspaceEpoch + mutationEpoch 三重身份；
- 失败、用户取消、reveal 不递增：有效搜索结果保持（App 集成测试逐一断言）；
- 手工刷新成功替换快照也作废搜索结果；刷新失败保留原快照，不错误失效；
- 选择/展开状态：成功后选择迁移到新路径，删除后清空选择；目录展开集合按段边界迁移；
  不把旧结果字符串替换为新路径（内容、revision、范围可能同时变化）。

## 10. Electron / IPC / preload 安全边界

- `nodeIntegration: false`、`contextIsolation: true`、sandbox 保持；preload 只暴露固定
  方法集合（workspace 8 个 + document 6 个 + search 2 个 + window 关闭协调），不暴露
  ipcRenderer/通用 invoke/任意通道；
- 请求形状精确校验：多余字段、错误类型、未知判别值一律 `INVALID_REQUEST`；renderer 不能提交
  根路径、绝对路径、盘符、UNC、临时/备份路径、shell 参数或 `force`/`overwrite`/`skipValidation`
  危险开关；工作区根只来自主进程 `workspace-session`，处理器绑定发送窗口；
- 主进程写路径全部：源/目标逐段 lstat/realpath（拒绝 symlink/junction）、realpath 边界、
  排他临时文件（同目录、`wx`、sync、close）、发布前复验、不覆盖发布；失败尽力清理临时文件；
- 删除不调用任何永久删除 API；`rm(tempPath, { force: true })` 仅用于临时文件清理；
- 跨进程结果只含稳定 code/message 与规范相对路径；日志不泄漏正文、模型、绝对路径、
  临时名、原始异常或调用栈（契约测试断言 JSON 序列化）；
- IPC 通道清单（17 个 handle，全部固定）：workspace 6（open/refresh/create-entry/relocate/
  trash/reveal）、document 4（read-text/save-text/read-docx/save-docx）、save-as 2、
  search 2、window 3。

## 11. 自动检查与最终测试基线

| 命令                        | 结果                                     |
| --------------------------- | ---------------------------------------- |
| `typecheck`（5 tsconfig）   | **通过**（每个工作包）                   |
| `lint`（--max-warnings=0）  | **通过**（0 warning）                    |
| `format:check`              | **通过**（Windows 检出环境行尾策略固定） |
| `test`（54 文件 1026 用例） | **通过**：1016 passed / 10 skipped       |
| `check`                     | **通过**（退出码 0）                     |
| `build`                     | **通过**（退出码 0）                     |

- 10 个条件跳过全部为真实符号链接/junction 权限条件（`it.runIf`，Windows 受限环境不能创建
  真实链接）：read-text-document 2、read-docx-document 2、search-text-workspace 1、
  search-mixed-workspace 1、resolve-workspace-entry 1、relocate-workspace-entry 1、
  trash-workspace-entry 1、reveal-workspace-entry 1；拒绝分支均由 mock 适配器确定性覆盖；
- Task 1 至 Task 8 全部既有测试原样执行并通过；无 `only`、无条件 `skip` 或弱化断言；
- 唯一预期 stderr：保存器/新建清理失败注入用例的 `wenshu: 清理临时文件失败 (EACCES/EPERM)`；
- WP7 修复：重命名/新建不自动保留/补全扩展名（§4.3 契约要求 TXT `.txt`、DOCX `.docx`，
  大小写不敏感）——renderer 提交前自动补全应有扩展名、拒绝跨类型改名
  （`TYPE_CHANGE_NOT_ALLOWED`），普通文件/目录不强制；提交 `1586ec6`。

## 12. Windows 开发/生产构建冒烟与实测证据

| 验证项                               | 结果                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 开发模式（`scripts\dev.cmd`）        | 4 个 electron 进程存活 ≥26 s，主窗口标题「文枢」，日志无 error/Uncaught/failed，清理后残留 0                                                                                                            |
| 生产构建（`npm exec -- electron .`） | 4 个 electron 进程存活 ≥26 s，主窗口标题「文枢」，日志无错误，清理后残留 0                                                                                                                              |
| 回收站恢复（WP8 实测）               | 临时文件经 `SendToRecycleBin` 进入回收站 → Shell `R&estore` 动词恢复成功，内容完好；应用删除路径统一走可注入 `shell.trashItem`（WP0 实测：普通文件/非空目录/空目录/只读属性均成功，不存在路径稳定拒绝） |
| 外部占用（WP8 实测）                 | `FileShare.None` 独占句柄阻止另一进程写入（"文件正由另一进程使用"）；应用保存器对 EACCES/EPERM 映射为稳定 `ACCESS_DENIED`/`WRITE_FAILED`（适配器注入测试确定性覆盖），不降级、不覆盖                    |
| case-only rename（WP0 实测）         | 一步 `fs.rename` 本机成功且内容保持；冻结为两步中间名 + 回滚（自动化测试覆盖两步失败与回滚失败 → `PARTIAL_FAILURE`）                                                                                    |
| 临时残留                             | 仓库与测试夹具无 `.wenshu-*` 临时文件残留；备份位置符合规则（`<目标>.wenshu.bak` 或 `<源>.wenshu.bak` 伴随）                                                                                            |
| 搜索失效（WP7 实测 + App 集成测试）  | completed 搜索 + 删除/新建成功 → 结果清空回 idle；失败/取消/reveal → 结果保留；searching 中 mutation → 在途请求被取消                                                                                   |
| Electron 暴露面（审查）              | 17 个固定 IPC 通道与 preload 方法一一对应；无通用 invoke、无 ipcRenderer 泄漏、无绝对路径请求字段                                                                                                       |

- WP0 另以真实夹具验证：非法/保留名称、尾随点空格、大小写冲突覆盖、父目录逐段校验、
  非空目录 rename、目录移入后代拒绝、空白 DOCX 导出验证（详见 `TASK_009_WP0_REPORT.md`）。

## 13. 性能观察（一次性观察，非基准门禁）

| 场景                                       | 结果                                                    |
| ------------------------------------------ | ------------------------------------------------------- |
| 文件管理 UI 操作（新建/重命名/删除确认流） | 交互即时（毫秒级 IPC 往返；主进程写操作串行队列无积压） |
| 工作区刷新（成功 mutation 后）             | 与既有扫描一致（小工作区 <10 ms 量级，未引入额外开销）  |
| 全量测试                                   | 54 文件约 23-24 s（与 Task 8 基线同量级）               |
| 生产构建                                   | 约 2 s（renderer 2,173 kB）                             |

## 14. 已知限制

1. 受控执行环境无交互式 GUI：需要人工点击的冒烟项（真实新建/另存为/回收站还原/Word 外部
   占用/资源管理器弹窗等）以 App 级集成测试、文件系统实测与启动冒烟覆盖；任务第九节手工
   界面清单由项目所有者执行并通过（用户确认"手动功能测试已通过"）。
2. 回收站恢复与外部占用证据取自 Windows Shell/文件系统层实测（应用删除统一走
   `shell.trashItem`，其失败分支由适配器注入测试确定性覆盖）。
3. 一步 case-only rename 本机成功但非普遍保证，冻结为两步 + 回滚；两步失败回滚失败时返回
   `PARTIAL_FAILURE` 并强制刷新，不做路径猜测。
4. 本任务不提供文件系统监听；外部变化需手动刷新（刷新成功会作废搜索结果）。
5. 重命名/移动/删除只作用于当前工作区；不支持跨工作区、跨盘或批量操作。

## 15. 是否满足 Task 9 全部验收标准

- 任务文档第十一节 11.1-11.5 全部验收项（共 40 项）已逐项核对并勾选为 `[x]`：每项均有
  对应自动化测试、WP0 实测证据或本报告记录的手工/Shell 实测证据，无凭推测勾选项；
- `check` 与 `build` 依次通过（退出码 0）；开发与生产 Windows 冒烟通过；无未解决的数据
  丢失、越界写入或永久删除问题；
- 本任务状态已改为「已完成」，README / PROJECT_BASELINE / TESTING / 项目结构同步更新。

**结论：Task 9 全部验收标准满足。**
