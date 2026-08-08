# TASK-006 WP0 报告：锁定 Task 5 基线与搜索语义

> 工作包范围：TASK-006 第 10 节 WP0（前置检查、基线记录、语义核对与冻结、测试规划）。
> 实施日期：2026-08-08；验证平台：Windows 11，Node.js 22.15.0，npm 10.9.2，Electron 37.x。
> 本工作包不修改任何产品功能代码；唯一产物是本报告文档。

## 1. 前置检查结果（任务第 3 节）

### 1.1 必读材料（3.1）

已全部阅读：`README.md`、`docs/PROJECT_BASELINE.md`、`docs/DEVELOPMENT_ENVIRONMENT.md`、
`docs/TESTING.md`、`docs/TASK_005_MULTI_TXT_TABS.md`、`docs/TASK_005_COMPLETION_REPORT.md`、
`docs/TASK_006_TXT_SEARCH_FIND_REPLACE.md`，以及全部指定源码：

- `src/main/index.ts`、`src/main/workspace/scan-workspace.ts`、`workspace-ipc.ts`、`workspace-session.ts`；
- `src/main/document/read-text-document.ts`、`document-ipc.ts`；
- `src/preload/index.ts`；
- `src/shared/desktop-api.ts`、`document.ts`、`workspace.ts`；
- `src/renderer/App.tsx`、`components/workspace/WorkspaceSidebar.tsx`、
  `components/document/DocumentPane.tsx`、`components/document/EditorSessionHost.tsx`；
- `src/renderer/lib/use-text-documents.ts`、`text-document-tabs.ts`、`use-editor-sessions.ts`；
- 既有测试：`tests/document/`（读取器 49、保存器 51、IPC 33、不变量 23、转移 32、组件 64）、
  `tests/workspace/`（扫描器 11、组件 21）、`tests/preload/contract.test.ts`（13）、
  `tests/window/window-close.test.ts`（8）、`tests/runtime-info.test.ts`（2）。

### 1.2 工作树与质量基线（3.2）

- `git status --short`：**干净**，无未提交的用户修改需要保护；
- 当前分支：`TASK-006工作区TXT搜索与当前文件查找替换`；`TASK_005_COMPLETION_REPORT.md` 在仓库中，
  Task 5 已合并（`5e96885 Merge pull request #5 ...task5多TXT标签页与独立编辑会话`）；
- 完整 `check` 与 `build` 依次执行（未并行），全部通过，退出码 0。

### 1.3 规划基线逐项复验（3.3，本次实测而非引用规划）

| 规划断言                                       | 本次实测                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Task 1-5 完成，main 已含 Task 5                | 通过：工作树干净，Task 5 合并提交在历史中                                                                                                                    |
| 完整 `check` 退出码 0                          | 通过：typecheck（5 tsconfig）+ lint（--max-warnings=0）+ format:check + test 全绿                                                                            |
| 11 个测试文件、305 通过、2 条件跳过            | 通过：11 passed（305 passed / 2 skipped），跳过均为真实符号链接权限条件用例，mock 拒绝分支继续覆盖                                                           |
| 活动栏"文件/搜索/设置"为静态占位               | 通过：`App.tsx` 中 `activityItems` 为静态 `div`，无搜索入口                                                                                                  |
| 工作区状态由 `WorkspaceSidebar` 内部持有       | 通过：`WorkspaceSidebar.tsx` 内部 `useState` 持有 status/workspace/error                                                                                     |
| CodeMirror 未配置查找替换                      | 通过：`EditorSessionHost.createEditorState` 只配置 lineSeparator/history/keymap/lineWrapping/updateListener；`@codemirror/search` 不在 `package.json` 依赖中 |
| `openTextFile` 可打开/激活唯一标签但无定位协议 | 通过：`use-text-documents.ts` 的 `openTextFile(relativePath)` 返回 `void`，无 tabId 回传、无匹配定位输入                                                     |
| preload 无搜索能力、主进程无搜索协议           | 通过：`desktop-api.ts` 只有 runtime/workspace/document/window 四组窄接口；main 无 search 模块                                                                |

## 2. 命令结果（逐项实测）

| 命令                       | 结果                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `typecheck`（5 tsconfig）  | **通过**                                                                                  |
| `lint`（--max-warnings=0） | **通过**（0 warning）                                                                     |
| `format:check`             | **通过**（Windows 检出环境，行尾策略固定）                                                |
| `test`（11 文件 307 用例） | **通过**：305 passed / 2 skipped（真实 symlink 权限条件跳过）                             |
| `check`                    | **通过**（退出码 0）                                                                      |
| `build`                    | **通过**（退出码 0）：main 24.23 kB、preload 1.95 kB、renderer 1,171.75 kB + CSS 11.89 kB |

测试分布：运行时 2 · 扫描器 11 · 读取器 49 · 保存器 51 · 读取/保存 IPC 33 · preload 契约 13 ·
窗口关闭 8 · 工作区组件 21 · 标签不变量 23 · 标签转移 32 · 多标签组件 64。
输出中的唯一预期日志为保存器测试的"wenshu: 清理临时文件失败 (EACCES)"（断言用例的既定日志）。
`check` 与 `build` 未并行运行；`out/` 为 Git 忽略目录。

## 3. 关键源码核对结论

### 3.1 工作区状态（搜索根来源，4.7）

- `workspace-session.ts` 是主进程唯一工作区根来源：`setCurrentWorkspaceRoot` 只在
  `workspace-ipc.ts` 的 `workspace:open` 扫描成功后调用，失败/取消保持原值；
  `document-ipc.ts` 在读取/保存开始时从会话捕获根快照。搜索 IPC（WP3）必须沿用同一模式：
  根路径只从 `getCurrentWorkspaceRoot()` 取得，请求对象不得携带根或绝对路径。
- renderer 只持有 `WorkspaceSnapshot`（含展示用 `rootPath`），无根路径写回能力；
  `WorkspaceSidebar` 无 epoch；renderer 侧 epoch 现由 `useTextDocuments` 的 `epochRef` 表达
  （成功切换时 `invalidateWorkspace` 递增），搜索 controller 将复用同一语义（见本报告冻结项 11）。

### 3.2 受控 TXT 读取（候选文件读取复用，4.7）

- `readTextDocument` 完整执行 13 步校验：相对路径格式、`.txt` 扩展名（大小写不敏感）、
  词法边界、逐段 lstat（拒绝符号链接/junction）、真实路径边界、普通文件、5 MiB、
  有界读取、严格 UTF-8、BOM 剥离、SHA-256 revision（基于含 BOM 与原始换行的完整字节）。
- `ReadTextAdapters` 函数参数注入模式（`lstat`/`realpath`/`readTextBytes`）可直接复用于搜索器测试；
  稳定错误码（`NOT_FOUND`/`ACCESS_DENIED`/`TOO_LARGE`/`INVALID_UTF8` 等）用于跳过统计分类。
- 冻结结论：搜索候选读取复用 `readTextDocument`（或按 WP2 设计提取的等价安全原语），
  不得因目录扫描已看到文件而跳过读取时重新校验；错误码映射保持与读取器一致。

### 3.3 多标签身份（定位目标，4.9）

- `id === relativePath`（`text-document-tabs.ts`），工作区会话内同路径唯一，
  loading/已加载/read-error 态都不重复；`openTab` 打开或激活，已存在只激活不重读；
  同名不同路径可并存。搜索定位的"稳定 tabId"即结果 `relativePath`，打开/激活语义可直接复用。
- 现状缺口（WP5 扩展点）：`openTextFile` 不返回 tabId、不暴露定位输入；
  `EditorSessionHost` 无定位请求消费协议（不能重复抢焦点）。已记录为 WP5 必须解决的接口点。

### 3.4 编辑器会话（查找替换宿主，4.2）

- `useEditorSessions` 按 tabId 缓存 `EditorState`（正文/选区/撤销历史）与滚动快照；
  关闭标签/工作区失效由 liveTabIds 剪枝，DocumentPane 卸载清空。查找面板、查询、选择与历史
  将随缓存状态天然按 tabId 隔离（4.2 的隔离要求具备现成基础）。
- 外部正文替换（重试/冲突重读）重建状态并清空历史；普通切换恢复缓存。当前无查找扩展，
  WP6 在 `createEditorState` 中追加 `@codemirror/search` 扩展与 keymap。

### 3.5 异步结果有效性（搜索结果与定位提交门禁，5.3）

- `asyncResultStillValid`（工作区会话 / 目标标签 / 请求编号三重校验）已被读取与保存结果提交使用；
  `mountedRef` 提供组件卸载防护；epoch 递增使旧工作区全部未完成结果作废。
- 冻结结论：工作区搜索结果提交沿用同一模式（挂载 + epoch + requestId 最新 + 未取消）；
  定位提交追加 4.9 固定规则（标签存在、路径一致、定位请求 ID 最新、已加载正文、revision 与范围校验）。

## 4. 第四节固定决策的冻结记录

下列语义按任务文档第四节冻结，并补充 WP0 消除歧义后的落地规则（WP1-WP6 不得偏离）：

1. **查询**：1-256 个 UTF-16 code unit 的单行字符串；拒绝空字符串、含 `\r`/`\n`（单行约束）、
   含 `\0`、非字符串。长度按 `Array.from` 无法作为准则——统一按 `query.length`（UTF-16 单元数）判定。
2. **匹配**：首版仅 literal 匹配 + 大小写敏感开关，无正则/whole-word；不重叠，按 `from` 升序；
   匹配范围以完整文件正文（BOM 已剥离）的 UTF-16 索引为基准；行号/列号从 1 开始；
   `\r\n`、`\n`、独立 `\r` 均视为一个换行边界（CRLF 只计一次）。
3. **大小写不敏感**（WP0 补充决策）：只折叠 ASCII 字母（A-Z ↔ a-z），折叠不改变 UTF-16 长度，
   保证返回原正文实际范围与文本；非 ASCII 大小写折叠不在首版范围，作为已知限制记录。
4. **预览**：单行上下文，最长 160 UTF-16 code unit；行长 ≤ 160 取整行；
   行超长时窗口起点 `clamp(matchStart - 80, lineStart, lineEnd - 160)`（匹配尽量居中，
   起点不越过行首与行尾-160 边界）；`previewMatchFrom/To` 以 preview 自身为基准，可能因窗口
   截断而小于实际匹配长度，权威范围始终是 `from/to`；预览切分可能截断代理对（emoji），
   仅影响展示不影响定位（已知限制）。
5. **上限常量**（跨进程共享，`src/shared/search.ts`）：查询 256、候选 TXT 1000、单文件匹配 200、
   总匹配 2000、预览 160、读取并发 4。截断原因固定枚举：
   `file-limit` / `matches-per-file-limit` / `total-matches-limit`；到达上限返回
   `truncated: true` + 原因，不静默丢弃。
6. **统计**：`scannedFiles`（实际尝试读取的候选数）、`matchedFiles`、`totalMatches`、
   `skippedFiles`（不可读子目录 + 读取失败候选文件计数）。根目录不可读为本次搜索错误
   （稳定 `NO_WORKSPACE` 之外新增稳定错误码，消息不含绝对路径）；子目录/单文件错误隔离并计入跳过。
7. **请求与取消**：renderer 单调递增 `requestId`（非负安全整数，不得用查询字符串当身份）；
   同一窗口同时最多一个活动搜索，新请求先取消旧请求；preload 只暴露固定
   `search.textWorkspace(request)` / `search.cancelTextWorkspace({requestId})`；
   主进程按发送窗口 + requestId 跟踪，取消未知/他窗请求为安全无操作；取消为协作式，
   已开始的受控单文件读取可完成但其结果不再提交；取消不是错误，不得把部分结果标记 completed。
8. **路径与遍历**：搜索根只来自 `workspace-session`；不跟随符号链接/junction/重解析点；
   候选只取普通 `.txt`（扩展名大小写不敏感）；遍历与读取过程响应取消与工作区变化检查；
   renderer 同时用 requestId + 工作区 epoch 双重校验迟到结果。
9. **结果模型**：按 4.8 建议契约冻结类型形状（`WorkspaceTextSearchRequest`、
   `WorkspaceTextSearchMatch`、`WorkspaceTextSearchFileResult`），最终结果附加
   `status` / `requestId` / `files`（按规范相对路径自然排序，与 `scan-workspace` 的
   `Intl.Collator(numeric)` 排序器一致）/ `statistics` / `truncated` / `truncatedReason` /
   可展示错误。文件结果唯一（每相对路径一个分组）；文件与匹配顺序与并发完成顺序无关。
10. **定位**：绑定定位请求 ID + 工作区 epoch + 搜索 requestId + 规范相对路径 + revision +
    from/to + 实际匹配文本；按 4.9 七条规则执行；dirty 标签只要原范围在实时正文精确匹配即可定位，
    否则只提示过期，不猜测"最近同名文本"、不覆盖正文。
11. **工作区 epoch（WP0 补充决策）**：WP3 的搜索 controller 只接受外部传入的工作区可用性与
    epoch（App 在 `onWorkspaceSelected` 成功路径递增的最小 epoch），不自行持有根路径；
    WP4 提取 `useWorkspace` 共享 controller 后由同一 epoch 同时供文档与搜索使用，不重复计数。
12. **模块落点**：`src/shared/search.ts`（契约/常量，运行时无关）；纯 matcher 落
    `src/main/search/match-text.ts`（WP5 定位校验只需 `content.slice(from,to)` 与匹配文本比较，
    不需要在 renderer 引入 matcher，故不放 shared）；`tsconfig.test.json` 需在 WP1 增加
    `src/main/search/**/*.ts` 包含项（测试文件位于 `tests/search/`）。
13. **依赖**：仅 WP6 新增 `@codemirror/search` 直接依赖并记录锁文件变化；不引入 ripgrep、
    数据库、Zustand、搜索服务或全局状态库。
14. **日志与泄漏**：查询正文、命中正文、绝对路径、原始异常、调用栈、Buffer、文件句柄
    不进入日志或跨进程返回；片段由 React 文本节点渲染，不使用 `dangerouslySetInnerHTML`。

## 5. 测试文件与目录规划（WP1-WP7）

新增目录：`src/main/search/`、`src/renderer/components/search/`、`tests/search/`。

| 工作包 | 计划测试文件                                                                                                                                               | 覆盖第 8 节要求                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| WP1    | `tests/search/match-text.test.ts`、`tests/search/search-contract.test.ts`                                                                                  | 8.2 契约与纯匹配（查询校验、行列、预览、预算、排序稳定性、中文/emoji/CRLF/超长行、大小写） |
| WP2    | `tests/search/search-text-workspace.test.ts`                                                                                                               | 8.3 遍历/安全/取消（边界、符号链接、错误隔离、1000 上限、并发 ≤4、各阶段取消、不泄漏）     |
| WP3    | `tests/search/search-ipc.test.ts`；修改 `tests/preload/contract.test.ts`（搜索窄接口断言）                                                                 | 8.4 IPC/preload 契约与请求身份；controller 竞态随 WP4 组件测试覆盖                         |
| WP4    | 新增 `tests/search/search-sidebar.test.tsx`（jsdom，活动栏/空状态/结果/竞态/侧栏切换）；修改 `tests/workspace/components.test.tsx`（工作区状态所有权回归） | 8.5 侧栏与 controller                                                                      |
| WP5    | 新增 `tests/search/result-locate.test.tsx`（或并入 `tests/document/components.test.tsx`）                                                                  | 8.6 定位（打开/激活、loading 后定位、过期提示、dirty 定位、连续点击）                      |
| WP6    | 修改 `tests/document/components.test.tsx`（查找替换、撤销、dirty、多标签隔离）；修改 `tests/preload/contract.test.ts`（如需）                              | 8.6 当前文件查找替换                                                                       |
| WP7    | 不新增测试文件；执行 8.7 手工冒烟（含接近 1000 TXT 性能工作区）并更新文档                                                                                  | 8.7                                                                                        |

目录与命名规划：matcher 与搜索器按现有"纯函数 + 适配器注入"模式（参照 `scan-workspace.ts`、
`read-text-document.ts`）；搜索器依赖注入适配器以确定性测试并发、取消与错误，不引入 DI 容器；
组件测试用 `// @vitest-environment jsdom` 文件头声明，与 `tests/document/components.test.tsx` 一致。

## 6. 修改文件

| 文件                          | 变更                                           |
| ----------------------------- | ---------------------------------------------- |
| `docs/TASK_006_WP0_REPORT.md` | 本报告（WP0 唯一产物；未修改任何产品功能代码） |

## 7. 未解决问题与已知限制

1. **无阻塞性歧义**：第四节与第 4 节冻结记录消除了全部搜索/定位语义歧义，无未决设计问题。
2. **已知限制（首版可接受，均记录在冻结项）**：非 ASCII 大小写折叠不实现；预览窗口可能
   截断代理对；JSDOM 无法可靠断言滚动数值（沿用 Task 5 处理：边界测试 + 手工验收）。
3. **后续 WP 需注意的既有缺口**（非 WP0 范围）：`openTextFile` 无 tabId/定位返回协议（WP5）；
   renderer 工作区 epoch 需在 WP4 统一所有权（WP3 用 App 最小 epoch 过渡，见冻结项 11）；
   `tsconfig.test.json` 需在 WP1 增加 `src/main/search/**/*.ts`。

## 8. 门禁结论

WP0 验收门禁（任务第 10 节）：**全部满足**。

- Task 5 基线可重复通过：11 文件 / 305 通过 / 2 条件跳过，typecheck、lint、format:check、
  完整 `check`、`build` 依次执行均退出码 0，构建产物与 TASK-005 完成报告一致；
- 搜索与定位语义无未决歧义：第四节决策已冻结（本报告第 4 节），含 WP0 补充决策；
- 工作树已有修改已被识别和保护：`git status --short` 干净，无用户修改，WP0 未触碰产品功能代码。
