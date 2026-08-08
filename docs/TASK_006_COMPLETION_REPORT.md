# TASK-006 完成报告

> 实现完成日期：2026-08-08；最终手工验收日期：2026-08-08；验证平台：Windows 11，Node.js 22.15.0，npm 10.9.2，Electron 37.x。
> WP0-WP7 逐包实施、逐包验收；自动验收（typecheck/lint/format:check/全部测试/check/build）、开发与生产构建桌面冒烟与性能观察由开发 Agent 完成；
> 第 8.7 节手工界面清单由项目所有者于 2026-08-08 执行并全部通过（自动化可覆盖的部分同时由组件测试与 Agent 冒烟验证）。

## 1. 实现摘要

按工作包顺序（WP0 基线锁定与语义冻结 → WP1 共享契约与纯匹配器 → WP2 主进程安全搜索器 → WP3 固定 IPC、preload 与搜索 controller → WP4 工作区状态提取、活动栏与搜索侧栏 → WP5 搜索结果打开、激活与安全定位 → WP6 当前文件查找替换 → WP7 整体验收、性能观察与文档）完成了 TXT 查找与搜索闭环：

```text
当前活动 TXT 的实时正文
  -> Ctrl+F / Ctrl+H 查找与替换面板（大小写、上一个/下一个、替换当前项/全部替换）
  -> 替换进入撤销历史、正常产生 dirty 并继续显式安全保存
  -> 查找面板、查询、选区和历史按标签隔离，随会话缓存恢复与清理

工作区磁盘上已保存的普通 UTF-8 TXT
  -> 活动栏"搜索" / Ctrl+Shift+F 打开搜索侧栏
  -> 主进程受控异步遍历（不跟随符号链接）、固定并发 4、候选 1000 / 单文件 200 / 总匹配 2000 上限
  -> 协作式取消、按发送窗口与 requestId 的任务管理、单文件错误隔离
  -> 按文件分组返回相对路径、1-based 行列、安全片段、revision 与统计
  -> 点击结果打开或激活唯一标签，读取完成后在 revision 与正文范围仍有效时选中、滚动并聚焦
  -> 任何过期情况只显示"搜索结果已过期"，不错误定位、不修改正文
```

## 2. 新增和修改的关键文件

### 新增文件

| 文件                                               | 用途                                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/search.ts`                             | 搜索契约与冻结常量：请求/取消/匹配/文件分组/统计/错误/结果联合类型；256/1000/200/2000/160/4 上限；请求运行时校验纯函数                       |
| `src/main/search/match-text.ts`                    | 纯匹配器：literal 匹配 + ASCII-only 大小写折叠、UTF-16 范围、1-based 行列、160 预览窗口、单文件 200 与总 2000 预算、自然排序分组、协作式让出 |
| `src/main/search/search-text-workspace.ts`         | 主进程安全搜索器：异步遍历、候选预算、稳定排序、并发 4 有界读取、复用受控 `readTextDocument`、取消/工作区变化检查、错误隔离与统计            |
| `src/main/search/search-ipc.ts`                    | 固定 `search:text-workspace` / `search:cancel-text-workspace` 通道；按 webContents id + requestId 管理任务；新搜索取消旧搜索；窗口销毁清理   |
| `src/renderer/lib/use-workspace.ts`                | 工作区共享 controller：打开/刷新/错误状态与 epoch（成功切换 +1），供文档失效与搜索共用                                                       |
| `src/renderer/lib/use-workspace-search.ts`         | 搜索 controller：单调 requestId、searching 唯一活动句柄、挂载/epoch/requestId 三重迟到结果防护、主动取消、epoch 变化作废                     |
| `src/renderer/components/search/SearchSidebar.tsx` | 搜索侧栏：输入草稿、大小写选项、搜索/取消、状态/统计/截断、无工作区空状态、磁盘快照提示                                                      |
| `src/renderer/components/search/SearchResults.tsx` | 分组结果：相对路径、1:列 行列、安全文本节点高亮、`onMatchActivate` 定位入口                                                                  |
| `docs/TASK_006_WP0_REPORT.md`                      | WP0 基线、语义冻结与测试规划记录                                                                                                             |
| `docs/TASK_006_COMPLETION_REPORT.md`               | 本报告                                                                                                                                       |

### 修改文件

| 文件                                                                                                      | 变更                                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/main/index.ts`                                                                                       | 注册搜索 IPC                                                                                                                |
| `src/preload/index.ts` / `src/shared/desktop-api.ts`                                                      | 新增 `search.textWorkspace` / `search.cancelTextWorkspace` 窄接口                                                           |
| `src/renderer/App.tsx`                                                                                    | 活动栏真实按钮（文件/搜索切换、设置占位）、`Ctrl+Shift+F`、工作区/搜索/定位编排、过期提示横幅                               |
| `src/renderer/components/workspace/WorkspaceSidebar.tsx`                                                  | 重构为纯展示组件（状态由 useWorkspace 注入）                                                                                |
| `src/renderer/components/document/EditorSessionHost.tsx`                                                  | `@codemirror/search` 扩展与 keymap（`Mod-f`/`Mod-h`/`F3` 等）；搜索结果定位目标应用（选区+滚动+聚焦，单次应用守卫）         |
| `src/renderer/components/document/DocumentPane.tsx`                                                       | 定位目标下发（绑定 tabId）与"搜索结果已过期"横幅                                                                            |
| `src/renderer/lib/use-text-documents.ts`                                                                  | `openTextFile` 返回读取完成 Promise（open-waiters 按 tabId 结算，关闭/失效为 null）                                         |
| `src/renderer/lib/text-document-tabs.ts` / `use-editor-sessions.ts`                                       | 仅注释级调整（未变语义）                                                                                                    |
| `src/renderer/styles/app.css`                                                                             | 活动按钮、搜索侧栏、过期横幅样式                                                                                            |
| `package.json` / `package-lock.json`                                                                      | 新增直接依赖 `@codemirror/search@^6.7.1`（选择理由：任务第 4.2 节建议的直接依赖，提供面板/命令/每状态查询隔离，无全局状态） |
| `tsconfig.test.json`                                                                                      | 增加 `src/main/search/**/*.ts`                                                                                              |
| `tests/document/read-text-document.test.ts`                                                               | 符号链接探测改为有界（超时按"环境不支持"处理，DEVELOPMENT_ENVIRONMENT.md 处置规则；不删断言）                               |
| `README.md` / `docs/PROJECT_BASELINE.md` / `docs/TESTING.md` / `docs/TASK_006_TXT_SEARCH_FIND_REPLACE.md` | 实际能力、基线与任务状态同步（WP7）                                                                                         |

### 测试文件（新增 7 个，修改 3 个）

`tests/search/search-contract.test.ts`（14）· `match-text.test.ts`（42）· `search-text-workspace.test.ts`（25）· `search-ipc.test.ts`（26）· `use-workspace-search.test.tsx`（14）· `search-sidebar.test.tsx`（13）· `result-locate.test.tsx`（11）· `tests/document/find-replace.test.tsx`（8）；修改 `tests/preload/contract.test.ts`（16）、`tests/workspace/components.test.tsx`（22）、`tests/document/read-text-document.test.ts`。

## 3. 查询语义、固定上限与结果模型

- 查询：1-256 个 UTF-16 code unit 单行字符串，拒绝空串、换行与 `\0`；首版仅 literal 匹配 + ASCII-only 大小写折叠（折叠不改变长度，返回原文实际范围与文本）；匹配不重叠、按 from 升序；`\r\n`/`\n`/独立 `\r` 均为一个换行边界；行/列从 1 开始。
- 固定上限：候选 TXT 1000、单文件匹配 200、总匹配 2000、单条预览 160、文件读取并发 4、查询 256；截断原因枚举 `file-limit` / `matches-per-file-limit` / `total-matches-limit`，到达上限返回 `truncated: true` 与原因，不静默丢弃。
- 结果模型：`WorkspaceTextSearchRequest{requestId,query,caseSensitive}`、`Match{from,to,line,column,matchedText,preview,previewMatchFrom/To}`、`FileResult{relativePath,revision,matches,truncated}`、统计 `{scannedFiles,matchedFiles,totalMatches,skippedFiles}`；最终结果以 `completed` / `cancelled` / `error` 判别联合返回；文件按规范相对路径自然排序，与并发完成顺序无关；`matchedFiles`/`totalMatches` 与实际返回结果一致。

## 4. 遍历、符号链接、受控读取与错误隔离

- 搜索根只来自主进程 `workspace-session`，请求不携带根或绝对路径；处理器开始时捕获根快照，`shouldStop` 组合"取消标志或工作区根变化"。
- 遍历不跟随符号链接/junction（`isSymbolicLink` 先于 `isDirectory` 判断，与 scan-workspace 的目录优先分类刻意不同）；每个目录内按名称自然排序，候选预算截断可确定复现。
- 候选只取普通 `.txt`（扩展名大小写不敏感）；读取复用 `readTextDocument` 完整受控校验（相对路径格式、逐段 lstat、真实路径边界、普通文件、5 MiB、有界读取、严格 UTF-8、SHA-256 revision），不因目录扫描已见而跳过。
- 错误隔离：根目录不可读 → 整体 `SEARCH_FAILED`（固定消息，不含路径）；子目录与单文件错误（NOT_FOUND/ACCESS_DENIED/TOO_LARGE/INVALID_UTF8/NOT_FILE/OUTSIDE_WORKSPACE/UNSUPPORTED_TYPE）计入 `skippedFiles` 继续。
- 全程只读 API，不写工作区、不建索引/缓存/临时文件。

## 5. 并发、取消、工作区 epoch 与迟到结果

- 固定并发 4（有界池，测试用门闩验证 maxInFlight 恒 ≤4）；候选按相对路径排序后读取，完成顺序不影响最终排序。
- 取消为协作式：`shouldStop` 在目录批次、每条目、读取前后与匹配循环内检查（matcher 的 `shouldYield`）；已开始的受控读取可完成但其结果不提交；取消不是错误，绝不把部分结果标记 completed；取消未知/他窗请求安全无操作。
- 主进程任务管理：`Map<webContentsId, {requestId, cancelled}>`；同一窗口同时最多一个活动搜索，新搜索先取消旧搜索；窗口 `destroyed` 清理任务引用；搜索完成在 finally 释放引用且不误删被替换的任务。
- renderer 双重校验：搜索 controller 提交结果前必须 挂载 ∧ 工作区 epoch 未变 ∧ requestId 仍为当前活动请求；`searching` 状态必有唯一活动 requestId，非 searching 不保留任务句柄；工作区成功切换清空旧结果并取消在途请求。
- 结果定位提交前必须：标签仍存在、相对路径一致、定位请求 ID 仍为该标签最新（全局最新定位 ID 作废旧请求）、已加载正文、revision 与正文范围通过校验。

## 6. 结果 revision、dirty 与过期定位规则

- 定位绑定：定位 ID + 工作区 epoch + 搜索 requestId + 规范相对路径 + revision + from/to + 实际匹配文本；点击时从当前已完成结果捕获，异步完成时校验"epoch 未变且仍是最新定位"。
- 规则：打开或激活唯一标签（loading 等待读取完成，不建第二标签）→ read-error 保留错误状态只提示 → 磁盘基线 revision 一致 → 范围落在实时正文内且 `slice(from,to)===matchedText` → 下发定位目标，编辑器宿主设置选区、`EditorView.scrollIntoView` 并聚焦（同一目标只应用一次，rerender 不重复抢焦点）。
- 过期情形（只显示非破坏性横幅，可关闭）：read-error、revision 不一致（外部修改）、越界或正文不匹配（含 dirty 后范围变化）；dirty 但原范围仍一致时允许定位且不清除 dirty。
- 定位只改变选区，不产生撤销历史步骤、不改正文、不触发保存或重新读取。

## 7. CodeMirror 查找替换与每标签状态策略

- 直接依赖 `@codemirror/search`（6.7.1）：`search()` 扩展 + `searchKeymap` + 自定义 `Mod-h`（打开面板并聚焦替换输入——CodeMirror 面板同时含查找/替换界面，无公开 replace 命令，只操作面板公开 DOM）。
- 替换经普通编辑事务进入撤销历史（replaceNext 只替换与查询匹配的当前选区；replaceAll 单次事务、单次撤销）；查找不改正文、不制造 dirty。
- 面板开关、查询、大小写、当前匹配与选区保存在 EditorState，随会话缓存按 tabId 天然隔离；关闭标签/工作区失效随会话清理；外部正文替换重建状态时查找状态随之清除。
- 正则/whole-word 面板选项保留在当前文件内，不扩展为工作区搜索协议。

## 8. Electron / IPC 边界与新增依赖

- `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true` 保持不变；preload 只新增两个固定搜索方法，不暴露 `ipcRenderer`/通用 invoke。
- 搜索请求入口校验精确键集合（拒绝 workspaceRoot/absolutePath/glob/encoding/上限/并发/通道等多余字段）；主进程不执行用户正则或 shell 命令。
- 跨进程结果只含稳定 code/数量/可展示消息；查询、命中正文、绝对路径、原始异常不进入日志或跨进程错误（测试断言 JSON 序列化不含路径与内部消息）。
- 新增依赖仅 `@codemirror/search@^6.7.1`（锁文件已更新）；未引入 ripgrep、数据库、Zustand 或搜索服务。

## 9. 实际执行的自动检查与结果

| 命令                       | 结果                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `typecheck`（5 tsconfig）  | **通过**                                                                                  |
| `lint`（--max-warnings=0） | **通过**（0 warning）                                                                     |
| `format:check`             | **通过**（Windows 检出环境，行尾策略固定）                                                |
| `test`（19 文件 464 用例） | **通过**：461 passed / 3 skipped（真实 symlink 权限条件跳过，mock 拒绝覆盖保持）          |
| `check`                    | **通过**（退出码 0）                                                                      |
| `build`                    | **通过**（退出码 0）：main 38.69 kB、preload 2.41 kB、renderer 1,239.94 kB + CSS 15.81 kB |

测试分布：运行时 2 · 扫描器 11 · 读取器 49 · 保存器 51 · 读取/保存 IPC 33 · preload 契约 16 · 窗口关闭 8 · 工作区组件 22 · 标签不变量 23 · 标签转移 32 · 多标签组件 64 · 搜索契约 14 · 匹配器 42 · 搜索器 25 · 搜索 IPC 26 · 搜索 controller 14 · 搜索侧栏 13 · 结果定位 11 · 查找替换 8。`check` 与 `build` 未并行运行；唯一预期 stderr 为保存器测试的 EACCES 清理日志与定位用例的 React 19 `act` 开发模式提示（去重一次，非业务失败）。

## 10. Windows 开发和生产构建冒烟证据

| 验证项                                                   | 结果                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 开发模式启动（`.\scripts\dev.cmd`，输出重定向捕获）      | **通过**：dev server + Electron 启动，30s 存活（4 进程），日志含 main/preload 构建与 "start electron app..."，无 preload/React/资源错误                                                                                                                                                                                                                                                                                                           |
| 生产构建启动（`npm exec -- electron .`，输出重定向捕获） | **通过**：加载 `out/` 构建，25s 存活（4 进程），日志为空无错误                                                                                                                                                                                                                                                                                                                                                                                    |
| 第 8.7 节手工清单                                        | **全部通过**：项目所有者于 2026-08-08 逐项完成手工验收（Ctrl+F/Ctrl+H 查找替换与保存、多标签查找隔离、活动栏切换不丢状态、中文/英文/emoji 搜索、无结果/取消/连续提交/结果上限、单文件失败隔离、未打开/已打开/同名不同路径/loading 结果点击、外部修改与编辑后旧结果只提示过期、搜索中切换工作区、接近 1000 文件可用性与取消响应、控制台与终端无异常/无泄漏日志、工作区无缓存索引临时文件、开发与生产构建冒烟）；自动化组件测试同时覆盖可自动化项目 |

## 11. 接近 1000 文件的性能观察

临时观察脚本（真实文件系统 + 生产搜索器路径，观察后已删除）2026-08-08 实测：

| 场景                                                                 | 结果                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 200 个 TXT 工作区搜索（12 行 × 200 文件，查询 "world" 大小写不敏感） | **32.8 ms**；扫描 200、命中 167 文件、2000 匹配（触发总匹配上限截断）                                        |
| 1000 个 TXT 工作区搜索（500 根目录 + 500 子目录，相同查询）          | **66.2 ms**；扫描 1000、命中 167 文件、2000 匹配、`truncated: true`（total-matches-limit，符合固定上限设计） |
| 取消响应（1000 文件搜索开始 30 ms 后置停止标志）                     | **3 ms** 内返回 `cancelled`（自搜索启动约 33 ms）                                                            |

界面可用性：主进程遍历/读取/匹配全程异步且有界，搜索不阻塞事件循环；取消为协作式且检查点密集（目录批次/条目/读取前后/匹配循环），实测响应即时。接近 1000 文件的人工界面操作验收按任务第 8.7 节清单由项目所有者于 2026-08-08 执行并全部通过。

## 12. 已知限制

1. 非 ASCII 大小写折叠不实现（WP0 冻结：只折叠 ASCII 字母，保证偏移不变）；
2. 预览窗口可能截断代理对（emoji），仅影响展示，权威范围始终是 from/to；
3. 真实符号链接用例按本机权限条件跳过（拒绝分支由 lstat/readDir mock 确定性覆盖）；
4. JSDOM 无法可靠断言滚动数值，滚动定位由边界测试 + 手工验收覆盖；
5. 定位用例存在一条 React 19 `act` 开发模式提示（stderr 噪声，断言全部确定性通过）；
6. 首版性能为一次性观察而非基准门禁；若未来工作区规模显著增长，先测量各阶段再调整（任务 4.5 决策）。

## 13. 是否满足全部验收标准

TASK-006 第十一节 11.1（8 项）、11.2（7 项）、11.3（8 项）、11.4（8 项）、11.5（8 项）全部满足并已在任务文档勾选。自动验收项全部由命令实际执行通过；开发与生产构建冒烟与性能观察由 Agent 完成；第 8.7 节手工清单由项目所有者于 2026-08-08 执行并全部通过（可自动化部分同时由组件测试与 Agent 冒烟覆盖）。

## 14. 任务状态与后续入口

**TASK-006 状态：已完成。**

下一任务建议实现"基础 DOCX 阅读、编辑与安全保存"：单独设计 DOCX 导入/导出中间模型、受支持格式范围、兼容性降级、保存前备份或恢复点、临时写入与安全替换，不复用 TXT 搜索任务隐式扩大文件类型处理权限。
