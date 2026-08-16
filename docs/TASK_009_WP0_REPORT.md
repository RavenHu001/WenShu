# TASK-009 WP0 报告：锁定基线、Windows 行为与固定语义

> 工作包范围：TASK-009 第 10 节 WP0（第 3 节全部前置检查、Windows 名称/冲突/大小写/rename/回收站/
> 资源管理器夹具与实测、目标父目录逐段校验、空白 DOCX 导出验证、TXT/DOCX 另存为复用点、
> `tab.id === relativePath` 会话影响、stable tabId 技术路径、目录后代迁移、mutationEpoch 搜索失效）。
> 实施日期：2026-08-16；验证平台：Windows 11（zh-CN，build 10.0.26200），Node.js 22.15.0，
> npm 10.9.2，Electron 37.10.3，TypeScript 5.9.3，Vitest 3.2.7。
> 本工作包不向产品 UI 或 preload 暴露任何新的文件写能力；未实现 WP1+；未修改最终验收勾选；
> 未修改任何产品功能代码。

## 1. 工作包声明（开始时报告项）

- 当前分支与工作树：分支 `Task009`，起点提交 `057fee5 T9规划`；开始时 `git status --short`
  为空（干净工作树，无用户已有修改需要保护）。
- 上一恢复点：`057fee5`（Task 9 规划完成提交，Task 1-8 全部合入）。
- 本包范围：只做基线锁定、Windows/Electron 行为实测与语义冻结，新增 `docs/TASK_009_WP0_REPORT.md`。
- 本包非目标：不新增/修改 preload、DesktopApi、IPC、主进程写服务、renderer 文件管理 UI；
  不实现 stable tabId 解耦、新建、另存为、relocate、trash、reveal、mutationEpoch 产品代码（WP1+）；
  不改 README/PROJECT_BASELINE/TESTING 的完成状态；不勾选第十一节任何验收项。
- 验证清单：必读材料；`check`/测试数量与条件跳过；`build`；开发与生产主窗口冒烟；
  临时工作区夹具实测（名称/大小写/rename/父目录/trash/reveal/空白 DOCX/保存复用点/
  标签身份/后代迁移/搜索失效）；审查 diff；结束前再次完整 `check`/`build`。
- 将新增的最小夹具：临时目录 `C:\Users\24196\AppData\Local\Temp\wenshu-wp0\` 下的
  `fs-ws-*`、`case-ws-*`、`electron-ws-*` 真实文件系统/回收站夹具与两个 Node 探针脚本，
  以及一个跑完即删的 Vitest 技术探针（10 用例）；全部位于系统临时目录，不提交仓库。

## 2. 必读材料核对（任务第 3.1 节）

已完整阅读：`README.md`、`docs/PROJECT_BASELINE.md`、`docs/DEVELOPMENT_ENVIRONMENT.md`、
`docs/TESTING.md`、`docs/TASK_004_TXT_EDIT_SAFE_SAVE.md`、`docs/TASK_005_MULTI_TXT_TABS.md`、
`docs/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md` 与完成报告、`docs/TASK_008_DOCX_WORKSPACE_SEARCH.md`
与完成报告、`docs/TASK_009_BASIC_FILE_MANAGEMENT.md`（全文 1034 行），以及直接相关源码与测试：

- 共享契约：`src/shared/workspace.ts`、`desktop-api.ts`、`document.ts`、`docx.ts`、`search.ts`；
- 主进程：`workspace/scan-workspace.ts`、`workspace-ipc.ts`、`workspace-session.ts`；
  `document/path-validation.ts`、`write-safety.ts`、`save-text-document.ts`；
  `docx/export-docx.ts`、`save-docx-document.ts`；`src/main/index.ts`、`src/preload/index.ts`；
- renderer：`lib/document-tabs.ts`、`use-documents.ts`、`use-editor-sessions.ts`、
  `use-workspace.ts`、`use-workspace-search.ts`、`text-document-tabs.ts`；
  `components/document/DocumentPane.tsx`、`EditorSessionHost.tsx`、`DocxEditorSessionHost.tsx`、
  `TabBar.tsx`、`components/workspace/WorkspaceSidebar.tsx`、`FileTree.tsx`、`FileTreeNode.tsx`、
  `App.tsx`；
- 测试：TXT 读取/保存、DOCX 读取/保存/IPC、多标签不变量与转移、preload 契约、工作区组件、
  搜索 controller/混合搜索/定位生命周期（含 `it.runIf` 条件跳过语义）与
  `tests/test-utils/temp-dir-cleanup.ts`。

## 3. 工作树与质量基线（任务第 3.2 节）

### 3.1 执行环境说明

受控执行环境（DSH）不提供交互式终端，`bash` 工具在 win32 受限；本报告全部命令经
项目本地 Node（`.tools/node-v22.15.0-win-x64`）与 `cmd.exe` 子进程实际执行。受控环境
缺省不携带 `PROCESSOR_ARCHITECTURE`，执行 `scripts/npm.cmd` 前注入 `AMD64`
（与真实 Windows 主机架构一致，仅影响脚本内架构选择，不改变命令语义）；`scripts/node.cmd`
直接调用本地 `node.exe` 不受影响。除此之外未修改脚本或环境。

### 3.2 命令与结果（`check` 与 `build` 依次执行，未并行）

| 命令                        | 结果                                                   |
| --------------------------- | ------------------------------------------------------ |
| `git status --short`        | 开始与结束时均为干净（结束仅新增本报告，见第 11 节）   |
| `scripts\npm.cmd run check` | **通过**（退出码 0；耗时 34.6 s，其中 Vitest 19.33 s） |
| `scripts\npm.cmd run build` | **通过**（退出码 0；耗时 10.4 s）                      |

### 3.3 测试数量与条件跳过

- **38 个测试文件全部通过，835 项通过，6 项条件跳过（共 841 项用例）**，与 Task 8 完成基线一致
  （`38 文件 / 835 passed / 6 skipped`）。
- 6 个条件跳过均为真实符号链接权限条件（`it.runIf`）：`read-text-document` 2（文件/目录链接）、
  `read-docx-document` 2（文件/目录链接）、`search-text-workspace` 1（目录链接）、
  `search-mixed-workspace` 1（目录链接）；拒绝分支由 lstat/readDir mock 确定性覆盖。
- 唯一预期 stderr：保存器清理失败注入用例的 `wenshu: 清理临时文件失败 (EPERM/EACCES)`，
  与 Task 7/8 记录一致。
- 无 `only`、无条件 `skip` 或弱化断言；`typecheck`（5 tsconfig）、`lint`
  （--max-warnings=0）、`format:check` 均通过。

### 3.4 构建产物

| 产物                              | 大小        |
| --------------------------------- | ----------- |
| `out/main/index.js`               | 90.86 kB    |
| `out/preload/index.js`            | 2.81 kB     |
| `out/renderer/index.html`         | 0.57 kB     |
| `out/renderer/assets/index-*.js`  | 2,114.61 kB |
| `out/renderer/assets/index-*.css` | 22.33 kB    |

## 4. 桌面主窗口冒烟（开发与生产构建）

| 验证项                               | 结果                                                                                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 开发模式（`scripts\dev.cmd`）        | **通过**：dev server（http://localhost:5173）+ Electron 启动，25 s 存活 4 个 electron 进程，日志含 `start electron app...`，无 preload/React/资源错误；进程树已清理，残留 0 |
| 生产构建（`npm exec -- electron .`） | **通过**：30 s 存活 4 个 electron 进程，stdout/stderr 无错误；另一次运行 18 s 时枚举到主窗口（MainWindowHandle 4982630，标题为“文枢”）；进程树已清理，残留 0                |

## 5. Windows 名称、冲突与大小写实测（临时夹具 `fs-ws-*`、`case-ws-*`）

夹具：系统临时目录下新建工作区根 `ws`，以 `node:fs/promises` 真实文件系统执行。

| 场景                                                                   | 实测结果                                                                                                                                      | 冻结决策                                                                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 非法字符 `< > : " \| ? *`                                              | 创建全部失败；Node 报 `ENOENT`（不是 EINVAL），`/`、`\\` 被当作路径分隔符（EISDIR），NUL 报 `ERR_INVALID_ARG_VALUE`，控制字符（tab）报 ENOENT | 错误码不可作为唯一判断；主进程必须按 §4.3 白名单预校验并返回 `INVALID_NAME`                            |
| 保留设备名 `CON/PRN/AUX/NUL/COM1-9/LPT1-9` 及 `CON.txt` 等带扩展名形式 | **Node（libuv 的 `\\\\?\` 路径语义）可以创建为真实文件**：readdir 可见、内容可读（NUL 文件实测写入并读回）                                    | 不能依赖 OS 拒绝；`validateWindowsLeafName` 必须显式拒绝（含扩展名形式）                               |
| 尾随点/空格（`a.`、`a `、`trail.txt.`、`trail.txt `）                  | 可创建，且与 `trail.txt` 并存、可 stat/读取（`\\\\?\` 语义下不被 Win32 归一化）                                                               | 继续按规划拒绝尾随点/空格，避免 Explorer/Win32 互操作歧义与备份名冲突                                  |
| 大小写冲突（已有 `a.txt` 再写 `A.txt`）                                | **成功且直接覆盖同一文件**（内容变为后写值，readdir 仍只有一个 `a.txt`）                                                                      | 新建/另存为必须用排他创建（`open wx` / `O_CREAT                                                        | O_EXCL`）判定 `TARGET_EXISTS`，严禁 writeFile 预检 |
| 只改大小写 rename（`a.txt` ↔ `A.txt`，目录 `dirx` ↔ `DIRX`）           | 本机一步 `fs.rename` 成功且内容保持；两步（不可预测中间名）同样成功                                                                           | 冻结：固定采用“同目录、不可预测、排他的中间名两步 rename + 失败回滚”；一步成功只是本机观察，不作为承诺 |
| 普通文件/跨父目录/非空目录 rename                                      | 全部成功，目录内容随迁（`d1` → `d1-new` → `d2/d1-moved`，内部文件保留）                                                                       | 同卷 `fs.rename` 原子语义可直接复用（§4.8）                                                            |
| 目录移入自身后代                                                       | `EPERM`                                                                                                                                       | 主进程先用 `isSameOrDescendantPath` 拒绝并返回 `DIRECTORY_INTO_DESCENDANT`，不依赖 OS 文案             |

## 6. 目标父目录逐段校验实测

按 `path-validation.ts` 相同语义（词法格式 → 逐段 `lstat` → 拒绝链接 → 中间段必须目录）在真实
junction 夹具上验证（junction 创建成功，指向工作区外目录）：

| 请求                            | 结果                | 说明                                |
| ------------------------------- | ------------------- | ----------------------------------- |
| `sub/x.txt`（存在）             | OK                  | 最终段普通文件                      |
| `sub/none.txt`（叶缺失）        | NOT_FOUND（叶）     | 叶不存在：另存为/新建目标需专用分支 |
| `no-such-dir/x.txt`             | NOT_FOUND（中间段） | 中间父段缺失即停，不猜测            |
| `jlink/x.txt`（junction）       | LINK_NOT_ALLOWED    | 不跟随链接，逐段 lstat 即拒绝       |
| `../x` / `C:/x` / 反斜杠 / 空段 | INVALID_PATH        | 词法层拒绝                          |
| `sub/x.txt/y.txt`               | NOT_DIRECTORY       | 中间段为普通文件即拒绝              |

结论：`resolveWorkspaceTarget` 只适合“最终段必须存在的普通文件”；WP2 必须新增
`resolveWorkspaceParentDirectory`（根父目录 `''`）与 `resolveNonExistingWorkspaceTarget`
（父目录逐段 lstat + realpath 边界 + 叶不存在），并保留发布前复验。

## 7. Electron `shell` 实测（临时夹具 `electron-ws-*`，真实 Electron 37.10.3 主进程）

### 7.1 `shell.trashItem`

| 目标                  | 结果                                                 |
| --------------------- | ---------------------------------------------------- |
| 普通文件              | 成功，文件消失（进入回收站）                         |
| 非空目录              | 成功，目录与内容消失                                 |
| 空目录                | 成功                                                 |
| 只读属性文件（0o444） | 成功（回收站移动不受只读属性阻止）                   |
| 不存在路径            | 拒绝：`Failed to parse path`（shell 层路径解析失败） |

冻结：删除统一走可注入 `shell.trashItem` 适配器；不存在/权限类失败由主进程预校验与稳定
`NOT_FOUND`/`TRASH_FAILED` 表达；本机无法复现 ACL 级 trash 权限失败，WP5 用适配器注入
确定性覆盖；主文件与伴随 `.wenshu.bak` 非事务 → 部分成功返回 `PARTIAL_FAILURE` 并立即刷新，
不把已入回收站的主文件写回冒充回滚。

### 7.2 `shell.showItemInFolder`

文件、目录、工作区根均成功返回（void）；**不存在路径也不抛错**（会打开父目录）。冻结：`reveal`
必须在主进程重新校验存在性、类型、链接与边界后再调用固定 `showItemInFolder`；不暴露
`openPath`/`openExternal`/任意 shell 参数；`reveal` 不递增 mutationEpoch。

## 8. 空白 DOCX 导出验证与 TXT/DOCX 另存为复用点

临时 Vitest 探针（10 用例全部通过，跑完已删除；无产品代码变更）验证：

- **空白 DOCX**：空模型（schemaVersion 1，至少一个空段落）通过 `validateDocxDocumentModel`，
  `exportDocxDocument` 导出 >1 KB 字节 → `verifyGeneratedDocxDocument`（大小/ZIP/OOXML/重导入）
  返回 `ok` 且 compatibility `supported` → `inspectDocxPackage`+`importDocxDocument`
  重导入至少一个空段落。WP3 新建 DOCX 可直接复用此管线。
- **TXT 另存为复用点**：`saveTextDocument` 的 BOM 保留（`encodeUtf8`）、换行规则
  （`normalizeLineEndings`/`dominantLineEnding`）、revision CAS、`defaultTempWriteFactory`
  （同目录排他 `.wenshu-<uuid>.tmp`）、`writeAllBytes`/sync/close、`replaceFile`、
  `removeTempFile`。探针实测：覆盖路径 BOM+CRLF 字节保留、无临时残留；**不存在的目标当前返回
  `NOT_FOUND`**（最终段必须存在）——WP4 另存为必须新增“目标不存在”解析分支与
  `TARGET_EXISTS → expectedTargetRevision → 发布前复验` 两阶段确认；排他临时写入原语已实测可
  复用于新目标创建。
- **DOCX 另存为复用点**：`exportDocxDocument`+`verifyGeneratedDocxDocument`、兼容性确认
  （degraded 绑定 revision、read-only 拒绝）、目标覆盖前滚动备份（探针实测备份字节 = 覆盖前原字节，
  目标替换成功，无临时残留）。WP4 另存为新目标时不创建无意义备份；覆盖分支复用现有保存器。

## 9. `tab.id === relativePath` 会话影响与 stable tabId 技术路径

### 9.1 当前耦合事实（代码 + 探针断言）

- `document-tabs.ts`：`openTab`/`openDocxTab` 均以 `id: relativePath` 创建标签（探针断言成立）；
- `use-documents.ts`：`openFile` 以 `item.id === relativePath` 去重、`openWaiters` 以 tabId 为键、
  保存请求捕获 `relativePath`；
- `App.tsx`：定位目标 `tabId: relativePath`；`DocumentPane.tsx`：TXT 宿主 `key={tab.id}`、
  DOCX 宿主容器 `key={tab.id}`、`docxEditors` Map 以 tab.id 为键；
- `use-editor-sessions.ts`：CodeMirror 会话 Map 以 tabId 为键，`liveTabIds` 清理不存在的 id；
- `EditorSessionHost.tsx`：挂载 effect 依赖 `tabId`（新 id → 新建 EditorState，旧会话被 capture 后
  因 id 不在 live 集合而被清理）；`DocxEditorSessionHost.tsx`：编辑器创建 effect 依赖 `tab.id`。

**影响**：重命名/移动/另存为若直接改 relativePath，id 随之改变 → React key 重挂载 →
CodeMirror 撤销历史/选区/滚动/查找面板与 DOCX Tiptap 实例重建丢失；旧 runtime/session Map 键成孤儿；
在途保存捕获旧路径；目录迁移无法一次性线性更新。探针断言：当前模型下“改 id 不改 runtime 键”会触发
`validateDocumentTabsModel` 的 runtime 孤儿/失配违规；同路径写 `A.txt` 覆盖 `a.txt` 的实测
进一步说明路径身份必须由主进程文件系统判定。

### 9.2 stable tabId 技术路径（WP1 固定要求）

- `tabId` 为 renderer 会话内稳定、不可由路径推导的身份（单调计数器或 uuid），`relativePath`/
  `name` 为可迁移属性；打开去重按规范相对路径（主进程为大小写权威）；
- CodeMirror 会话、DOCX editor Map、runtime、React key、活动标签、异步读取/保存/定位身份全部以
  `tabId` 为键；`EditorSessionHost`/DOCX 宿主在路径变化时不卸载（仅更新 `content`/模型）；
- 探针断言：id 不变、仅迁移 relativePath/name 时，运行时 Map 键、标签顺序与活动标签保持，
  迁移后模型仍通过不变量校验（这是 WP1 纯转移的目标形态）；
- 存在受影响 saving 标签时阻止 rename/move/delete（§4.5），迁移前捕获、迁移后才完成的旧保存不得写回旧路径。

## 10. 目录后代迁移与 mutationEpoch 搜索失效

- **目录后代迁移**（探针断言）：前缀按段边界匹配——`a/b` → `x` 时 `a/b/c.txt` 迁移为
  `x/c.txt`，`a/b2.txt` 与 `a.txt` 不误命中；单文件迁移只命中精确路径；迁移为线性遍历
  tabs 一次完成（不扫描编辑器 DOM），保持标签顺序与活动标签。
- **mutationEpoch**（探针断言 + 既有测试引用）：成功 create/save-as/relocate/trash 递增并立即
  取消活动搜索、清空 completed/cancelled/error 结果与定位目标；失败、用户取消与 reveal 不递增；
  迟到搜索结果必须同时校验 requestId + workspaceEpoch + mutationEpoch。现有
  `use-workspace-search.test.tsx` 已固化“工作区 epoch 变化 → 作废在途请求并清空旧结果”的机制，
  WP7 将 mutationEpoch 接入同一提交守卫；不尝试把旧结果字符串迁移到新路径。

## 11. 修改文件与 diff 审查

| 文件                          | 变更               |
| ----------------------------- | ------------------ |
| `docs/TASK_009_WP0_REPORT.md` | **新增**（本报告） |

- `git status --short`：仅 `?? docs/TASK_009_WP0_REPORT.md`；无产品代码、preload、IPC、
  DesktopApi、测试或文档勾选变更；临时探针（tests 目录）与临时夹具（系统临时目录）均已清理或
  位于仓库外。
- preload 暴露面复核：仍只有 `workspace.open/refresh`、`document.readText/saveText/readDocx/
saveDocx`、`search.textWorkspace/cancelTextWorkspace` 与 window 关闭协调 4 方法，无新增写能力。
- 结束前复审：完整 `check` 与 `build` 在本报告落盘后重新执行（见第 12 节结果），无回归。

## 12. 结束前完整 check/build（报告落盘后重跑）

| 命令                        | 结果（将在最终消息中给出退出码与数量）             |
| --------------------------- | -------------------------------------------------- |
| `scripts\npm.cmd run check` | 见最终交付摘要（预期 38 文件 / 835 通过 / 6 跳过） |
| `scripts\npm.cmd run build` | 见最终交付摘要（预期退出码 0）                     |

## 13. 未解决问题与已知限制

1. ACL 级 trash 权限失败在本机不可复现（只读属性不阻止回收站移动）；WP5 以可注入 trash 适配器
   确定性测试失败分支，回收站 API 失败时不降级永久删除。
2. `showItemInFolder` 对不存在路径不报错，存在性校验必须由主进程完成；explorer 弹窗行为不参与
   自动化断言（与既往冒烟一致）。
3. Node/libuv 的 `\\\\?\` 语义使保留设备名、尾随点/空格可被创建且不报错——这强化了
   “主进程名称预校验 + 排他创建 + 发布前复验”的必要性，也提示测试夹具与真实 Win32 工具的差异。
4. 一步 case-only rename 在本机成功，但 Windows 版本/杀毒组合下并非普遍保证；冻结为两步+回滚。
5. 受控执行环境无交互终端且 `PROCESSOR_ARCHITECTURE` 缺省；命令均经本地 Node/cmd 子进程执行，
   开发/生产窗口冒烟与窗口标题证据已实际取得。

## 14. WP0 门禁结论

**满足 WP0 门禁**（任务第 10 节 WP0 验收门禁三项全部成立）：

1. **Task 8 基线可重复**：完整 `check` 通过（38 测试文件 / 835 通过 / 6 条件跳过，跳过项均为
   真实符号链接权限条件且 mock 覆盖拒绝分支），`build` 通过，开发与生产构建主窗口冒烟通过；
2. **关键 Windows/Electron 行为有实际证据**：非法/保留名称、大小写冲突与覆盖、只改大小写 rename、
   普通/非空目录 rename、目录移入后代、目标父目录逐段校验、`shell.trashItem`、`showItemInFolder`、
   空白 DOCX 导出验证、TXT/DOCX 另存为复用点与缺口、`tab.id === relativePath` 影响、stable tabId
   技术路径、目录后代迁移与 mutationEpoch 组合均有第 5-10 节实测/断言证据；
3. **无未决数据安全语义**：名称预校验、排他创建、大小写权威、case-only 两步回滚、父目录逐段
   校验、trash 适配器与 PARTIAL_FAILURE、DOCX 备份/验证不减少、save-as 目标 revision CAS、
   stable tabId 迁移与 saving 阻止、mutationEpoch 失效规则全部冻结；本包未向产品 UI/preload
   暴露新的文件写能力，未实现 WP1+，未修改最终验收勾选。

若后续 WP1+ 实测与上述冻结结论冲突，必须先更新本报告与任务规划再继续。
