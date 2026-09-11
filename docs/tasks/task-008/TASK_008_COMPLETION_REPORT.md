# TASK-008 完成报告：工作区 DOCX 正文搜索与富文本结果定位

简体中文 | [English](./TASK_008_COMPLETION_REPORT.en.md)

[任务档案](../README.md) · [文档中心](../../README.md)

> 实现完成及完成后审计修复日期：2026-08-15；验证平台：Windows 11，Node.js 22.15.0，npm 10.9.2，
> Electron 37.x，Microsoft Word 16.0（外部 Office 探测环境，COM 写入自动化受本机
> 环境策略限制，详见第 10 节）；WPS Office 本机未安装。
> WP0-WP7 逐包实施、逐包验收；自动验收（typecheck/lint/format:check/全部测试/check/build）、
> 性能观察、开发与生产构建桌面冒烟与外部修改 revision 验证由开发 Agent 完成；
> 第 8.7 节手工界面清单由项目所有者于 2026-08-15 执行并通过（用户确认"手动测试无问题"）。

## 1. 实现摘要

按工作包顺序（WP0 基线锁定与投影/并发技术验证 → WP1 规范正文投影与共享契约 →
WP2 主进程混合文档搜索 → WP3 IPC/preload/controller 与搜索侧栏 → WP4 通用结果打开与
DOCX 富文本定位 → WP5 生命周期、兼容性与混合场景回归 → WP6 性能观察、桌面冒烟与风险
收敛 → WP7 整体验收、文档与完成报告）完成了从"只搜索 TXT"到"一次查询同时搜索 TXT 与
DOCX 正文、点击 DOCX 结果安全定位"的闭环：

```text
工作区磁盘上已保存的普通 TXT 与基础 DOCX
  -> 主进程受控混合遍历（不跟随符号链接），TXT 复用受控读取、DOCX 复用 readDocxDocument
  -> DOCX 搜索正文只来自 DocxDocumentModel 的规范正文投影（深度优先文本块 + 人工 \n）
  -> 全局相对路径自然顺序取前 1000 候选（其中 DOCX 200）、总并发 4（其中 DOCX 2）
  -> 协作式取消与单文件错误隔离
  -> 结果按文件分组携带 kind（txt/docx）、revision、1-based 行列与安全片段
  -> 点击 TXT 结果复用 CodeMirror 安全定位；点击 DOCX 结果打开或激活唯一标签
  -> kind、revision、规范投影范围与匹配文本双重校验 + DOCX 宿主同规则投影二次校验
  -> ProseMirror 公开命令设置选区、滚动与聚焦；任何过期/结构变化/映射失败只提示，不误定位
```

## 2. 新增与修改的关键文件

### 新增文件

| 文件                                                 | 用途                                                                                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/docx-search-text.ts`                     | DOCX 规范正文投影纯模块：深度优先文本块、人工 `\n` 分隔、UTF-16 块映射（`projectDocxModelSearchText` / `joinDocxTextBlocks`），无框架依赖                                        |
| `tests/docx/docx-search-projection.test.ts`          | 投影纯测试（16）：空模型/单段/多段/空段、标题 1-3、跨 marks、列表与嵌套列表、人工换行、UTF-16/emoji/组合字符、最大模型线性遍历                                                   |
| `tests/search/search-mixed-workspace.test.ts`        | 主进程混合搜索测试（26，1 条件跳过）：纯 TXT/纯 DOCX/混合/空工作区、kind 与统一排序、预算与截断优先级、双层并发、取消阶段、真实文件系统混合搜索与只读性                          |
| `tests/search/result-locate-docx.test.tsx`           | DOCX 结果打开与富文本定位测试（12）：未打开/已打开/loading 唯一标签、read-only/degraded/dirty、格式变化、文本/结构/revision 过期、新定位覆盖、定位不改模型                       |
| `tests/document/docx-locate-host.test.tsx`           | DocxEditorSessionHost 定位协议测试（5）：同规则投影二次校验、PM 位置映射、stale 回报、同一目标只应用一次                                                                         |
| `tests/search/result-locate-docx-lifecycle.test.tsx` | WP5 生命周期/兼容性/混合场景回归（16）：read-error/loading 关闭/工作区切换/saving/marks 变化/删除块/degraded 确认/read-only/kind 防御/TXT+DOCX 混合/跨标签隔离/迟到读取/搜索取消 |
| `tests/docx/docx-search-locate-assumptions.test.tsx` | WP0 技术验证（9）：ProseMirror 公开 API 定位、UTF-16/emoji/空段映射、read-only 定位、接近 20 MiB 读取窗口、协作式取消、双层并发池假设                                            |
| `docs/tasks/task-008/TASK_008_WP0_REPORT.md`         | WP0 基线、投影语义冻结、公开 API 与并发/取消假设记录                                                                                                                             |
| `docs/tasks/task-008/TASK_008_COMPLETION_REPORT.md`  | 本报告                                                                                                                                                                           |

### 修改文件

| 文件                                                                                                                                            | 变更                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/shared/search.ts`                                                                                                                          | 文件结果新增必填 `kind` 判别字段（`txt`/`docx`）、新增截断原因 `docx-file-limit`、截断优先级常量、注释同步（"Text" 表示规范可搜索文本）                |
| `src/main/search/search-text-workspace.ts`                                                                                                      | 混合候选分类与受控读取、全局相对路径小顶堆取前 1000 项、DOCX 200 预算、DOCX 投影接入 matcher、双层并发池（总 4 / DOCX 2）与取消检查                    |
| `src/main/search/match-text.ts`                                                                                                                 | 保持纯 matcher 语义，输入从 TXT 正文扩展为 TXT 正文 / DOCX 投影文本（无逻辑改动）                                                                      |
| `src/main/search/search-ipc.ts`                                                                                                                 | 保持请求/取消协议与任务生命周期；结果校验适配 kind 与新截断原因                                                                                        |
| `src/preload/index.ts` / `src/shared/desktop-api.ts`                                                                                            | 保持固定 `textWorkspace` / `cancelTextWorkspace` 形状，只更新说明注释                                                                                  |
| `src/renderer/lib/use-workspace-search.ts`                                                                                                      | 透传带 kind 的混合结果，保持 requestId/epoch/挂载三重防护                                                                                              |
| `src/renderer/components/search/SearchSidebar.tsx`                                                                                              | 搜索范围说明（TXT 与 DOCX 规范正文）、未保存编辑提示、DOCX 提取正文坐标说明、当前 DOCX 时查找替换不可用说明、docx-file-limit 截断文案                  |
| `src/renderer/components/search/SearchResults.tsx`                                                                                              | TXT/DOCX 类型标识（可访问标签）、DOCX 提取正文说明                                                                                                     |
| `src/renderer/App.tsx`                                                                                                                          | 通用 `openFile` 打开结果；定位绑定 epoch + requestId + locateId 并校验结果成员身份；新搜索/取消作废迟到定位；kind、revision、实时投影与匹配文本校验    |
| `src/renderer/components/document/DocxEditorSessionHost.tsx`                                                                                    | 定位目标应用：公开节点 API 生成同规则投影、二次校验、文本块位置映射、`setTextSelection`/`scrollIntoView`/`focus`、applied/stale 回报、单次应用守卫     |
| `src/renderer/components/document/DocumentPane.tsx`                                                                                             | 按活动标签 kind 只把定位目标传给匹配宿主                                                                                                               |
| 共享契约与 IPC/preload 测试                                                                                                                     | `search-contract`（17）、`search-ipc`（27）、`search-sidebar`（17）、`use-workspace-search`（14）、`preload/contract`（18）扩展 kind/截断/混合结果断言 |
| `README.md` / `docs/architecture/PROJECT_BASELINE.md` / `docs/development/TESTING.md` / `docs/tasks/task-008/TASK_008_DOCX_WORKSPACE_SEARCH.md` | 能力、基线、测试指南、任务状态与验收项同步（WP7）                                                                                                      |

## 3. DOCX 规范正文投影规则与不支持内容边界

- 投影规则（任务第 4.3 节全部 10 条，`src/shared/docx-search-text.ts`）：按文档顺序深度优先遍历模型；普通段落与标题各形成一个文本块；列表块自身不产生文字，列表内段落/标题按深度优先形成文本块；单块内容为全部 run 的 `text` 原样连接（marks/字号/颜色/对齐/标题等级/列表序号不进入搜索文本）；相邻文本块之间插入恰好一个人工 `\n`；空段落保留为空文本块；开头结尾不额外插入换行；偏移使用 UTF-16 code unit（与 JS 字符串和 ProseMirror 文本位置一致）；投影只携带文本块序号、投影 from/to 与块正文，不跨 IPC 传递模型或 PM 节点；纯函数不依赖 Electron/Node/Mammoth/Tiptap/PM/DOM/文件系统。
- 查询仍拒绝换行，因此匹配不会跨越人工文本块分隔符；run 边界不是搜索边界（跨 marks 的连续文字可正常匹配）。
- 不支持内容边界：不搜索未进入结构化模型的图片替代文本、表格、页眉页脚、脚注尾注、批注、修订删除内容、字段、公式、嵌入对象或宏；`supported`/`degraded`/`read-only` 均只搜索已进入模型的正文；0 字节 DOCX 占位视为空白文档，无匹配且不报错；损坏、加密、伪装、超限、无法读取或导入失败的 DOCX 按单文件错误隔离并计入跳过统计。

## 4. 契约兼容策略与资源上限

- 保留 `WorkspaceTextSearchRequest` / `WorkspaceTextSearchResult` 与 `search.textWorkspace` 命名（"Text" 表示各受支持文档的规范可搜索文本）；`WorkspaceTextSearchFileResult` 新增必填 `kind: 'txt' | 'docx'`；请求形状完全不变（不增加工作区根、扩展名列表、glob、解析选项、并发或预算字段）；preload 只复用固定开始/取消方法，不新增通用 IPC。
- 资源上限（共享常量，主进程与测试共同引用）：查询 256 UTF-16 code unit；总候选 1000（TXT + DOCX 合计）；其中 DOCX 候选 200；单文件匹配 200；总匹配 2000；单条预览 160；总并发 4；其中 DOCX 并发 2。截断原因优先级固定：`file-limit` > `docx-file-limit` > `total-matches-limit` > `matches-per-file-limit`；预算排除项不计为读取失败。
- 无新增生产依赖（Mammoth/JSZip/Tiptap/ProseMirror/matcher/搜索 controller 全部复用）。

## 5. 混合遍历、双层并发、取消与错误隔离

- 搜索根只来自主进程 `workspace-session`；遍历不跟随符号链接/junction/其他重解析点（`isSymbolicLink` 先于 `isDirectory`）；候选只取大小写不敏感的普通 `.txt`/`.docx`；每个候选读取时仍复用受控读取器重新执行路径/链接/真实路径/大小/类型/revision 校验。
- 候选遍历与双层并发：目录/候选由全局相对路径小顶堆驱动，保证子目录不会在全局排序前耗尽 1000 项预算；全部文件在途不超过 4，其中 DOCX 读取/导入不超过 2，读取完成顺序不影响最终排序。
- 协作式取消：检查点覆盖目录批次、每个条目、读取前后、DOCX 正文投影前后与匹配循环内（matcher `shouldYield`）；已开始的受控读取可以完成但其结果不提交；取消不把部分结果标记为 completed。
- 错误隔离：根目录不可读 → 整体稳定 `SEARCH_FAILED`；子目录与单文件错误（NOT_FOUND/ACCESS_DENIED/TOO_LARGE/INVALID_UTF8/INVALID_DOCX/RESOURCE_LIMIT_EXCEEDED 等）计入 `skippedFiles` 继续；预算排除项不计跳过。
- 搜索全程只读：不调用任何写入/创建/重命名/删除 API，不创建备份、临时文件、索引或缓存（真实文件系统测试断言前后文件清单一致）。

## 6. revision、dirty、二次校验与过期定位

- 定位请求绑定：唯一定位 `locateId` + 工作区 epoch + 搜索 `requestId` + 文件 `kind` + 规范相对路径 + 搜索时磁盘 `revision` + 投影 `from/to` + 实际 `matchedText`；点击分组/匹配还必须属于当前 completed 结果。
- 固定流程（任务第 4.8 节）：点击项必须仍属于当前 completed 搜索结果 → 通用 `openFile` 打开/激活唯一标签（loading 等待原读取、read-error 保留错误状态）→ 每个异步提交点重新校验 epoch + requestId + locateId → kind 与实际标签类型一致 → 标签磁盘基线 revision 与结果完全一致 → 对标签当前实时模型重新生成规范投影并校验 from/to 范围与投影片段精确等于 matchedText → 下发定位目标 → DOCX 宿主从当前 ProseMirror 公开节点 API 生成同规则投影并再次校验 → 匹配完整位于一个真实文本块内 → 映射为文本块内容起点 + 块内 UTF-16 偏移 → 公开命令设置选区/滚动/聚焦 → 宿主回报 applied/stale；新搜索、取消或 completed 结果替换会立即作废旧定位与迟到回报。
- dirty 语义：dirty 但原投影片段精确未变时允许定位且 dirty 保留；匹配前插入/删除正文导致偏移变化时即使别处存在同名文本也判为过期；只改变 marks/字号/颜色/对齐而投影不变时允许定位；改变列表/段落结构使投影与块映射不一致时判为过期；外部程序只改格式也会改变原始字节 revision，旧搜索结果先按 revision 判为过期。
- 任何失败只激活标签并显示非破坏性"搜索结果已过期"提示：不猜测最近文本、不按块序号强行跳转、不清除 dirty、不修改正文、不触发保存或重读；定位不进入撤销历史、不制造 dirty。

## 7. Electron / IPC 安全边界

- `nodeIntegration: false`、`contextIsolation: true`、sandbox 保持不变；preload 只复用固定 `search.textWorkspace` / `search.cancelTextWorkspace`，不暴露 ipcRenderer/通用 invoke。
- renderer 不能提交工作区根、绝对路径、glob、扩展名、编码、ZIP/XML 选项、并发或资源预算；不能获得原始 DOCX 字节、OOXML、未清洗 HTML、Buffer、ZIP 条目或句柄；不能提交 shell 命令、网络 URL 或"忽略 revision/跳过兼容性/猜测定位"开关。
- 主进程每次候选读取重新校验路径、逐段链接、真实路径、普通文件与扩展名；DOCX 继续作为不可信 ZIP 处理（20 MiB、ZIP 条目/解压/关键 XML/模型节点预算全部保持）；不访问外部关系、不执行宏/脚本/字段/嵌入对象。
- 日志与跨进程错误不泄漏查询、命中正文、完整投影、模型、绝对路径、原始异常或调用栈（测试断言 JSON 序列化不含路径与内部消息）。
- 旧工作区、旧请求和旧定位结果不进入新会话（epoch + requestId + locateId 三重作废）。

## 8. 自动检查与最终测试基线

| 命令                       | 结果                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `typecheck`（5 tsconfig）  | **通过**（每个工作包）                                                                   |
| `lint`（--max-warnings=0） | **通过**（0 warning）                                                                    |
| `format:check`             | **通过**（Windows 检出环境行尾策略固定）                                                 |
| `test`（38 文件 841 用例） | **通过**：835 passed / 6 skipped（均为真实符号链接权限条件，拒绝分支由 mock 确定性覆盖） |
| `check`                    | **通过**（退出码 0）                                                                     |
| `build`                    | **通过**（退出码 0）                                                                     |

Task 8 新增/扩展测试：`docx-search-locate-assumptions`（9）· `docx-search-projection`（16）· `search-mixed-workspace`（27，1 条件跳过）· `search-contract`（17）· `search-ipc`（27）· `search-sidebar`（17）· `use-workspace-search`（14）· `result-locate-docx`（12）· `docx-locate-host`（5）· `result-locate-docx-lifecycle`（17）。Task 1 至 Task 7 全部既有测试原样执行并通过；没有无条件 skip、only 或弱化断言；`check` 与 `build` 未并行运行；唯一预期 stderr 为保存器测试的 EACCES/EPERM 清理日志。

一次 WP6 期间的 `check` 出现 junction 清理 `EBUSY`（Windows 索引/杀毒对新 junction 的短时锁定，DEVELOPMENT_ENVIRONMENT.md 已记载；`removeDirWithRetry` 的 10×250ms 有界重试即其既有缓解），重跑即通过，未改测试基础设施。

## 9. 接近上限工作区的性能观察（一次性观察，非基准门禁；临时脚本观察后已删除）

| 场景                                                       | 结果                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| 普通混合工作区（10 TXT + 10 DOCX，sparse 查询）            | **140 ms**；20 文件全部命中                                         |
| 接近上限（800 TXT + 200 DOCX = 1000 候选，查询 `English`） | **1698 ms**：扫描 1000、命中 650 文件、2000 匹配、`file-limit` 截断 |
| 接近上限密集查询（`e` 大小写不敏感）                       | **1551 ms**：触发单文件/总匹配上限，`truncated: true`               |
| 取消响应（30 ms 后置停止标志）                             | **38 ms** 整体返回 `cancelled`（置位后约 8 ms）                     |
| 取消响应（80 ms 后置位，读取在途）                         | **88 ms** 返回 `cancelled`（已开始读取完成、结果不提交）            |
| 内存（搜索前后）                                           | rss −28.6 MB / heapUsed −12.4 MB，无增长信号                        |
| 搜索只读                                                   | 前后文件清单 1001 == 1001，无 `.wenshu`/临时/索引残留               |

主进程遍历/读取/匹配全程异步且有界，接近上限的混合工作区不冻结主界面（开发与生产窗口冒烟期间界面正常、无错误日志）。

## 10. 桌面冒烟与外部 Office 验证

- 开发模式（`dev.cmd` → electron-vite dev）：**通过**。main 89.23 kB / preload 2.81 kB 构建成功，dev server 就绪，"start electron app..."，30 s 存活 4 个 electron 进程，日志无 preload/React/资源错误。
- 生产构建（`npm exec -- electron .`，加载 `out/`）：**通过**。20 s 存活 4 进程，无错误输出；冒烟后进程全部清理。
- 外部 Office 环境探测：Microsoft Word **16.0** 已安装且 COM 可启动，但写入自动化受本机环境策略限制（既有文档以只读方式打开、新建/保存挂起——与 TASK-007 记录的 "Word COM 写入自动化受本机 Protected View/恢复对话框影响" 一致）；WPS Office 本机未安装。
- revision 过期同语义验证（生产主进程路径，临时测试取证后删除）：外部程序把同一路径写为不同内容的合法 DOCX（等价 Word/WPS 重新保存）→ 磁盘 revision `554a5a1a…` → `a714ea07…`（变化），修改后文件仍可被 `readDocxDocument` 导入且 `searchTextWorkspace` 携带新 revision（1 处匹配）；原始字节追加 → SHA-256 `821f1e91…` → `562a944e…`（变化）。renderer 侧"外部修改 → 只提示过期"由 `result-locate-docx.test.tsx` 自动化覆盖。
- 第 8.7 节手工界面清单：项目所有者于 2026-08-15 执行并通过（混合工作区搜索、中文/英文/emoji、取消/连续提交/无结果、未打开/已打开/loading/dirty/read-only/degraded 结果点击、段落/标题/跨 run/列表/嵌套列表定位、外部修改过期、搜索中切换工作区与关闭窗口、接近上限性能与界面可用性、控制台无异常、工作区无残留）。

## 11. 已知限制

1. Word COM 写入自动化被本机环境策略限制（TASK-007 同款），WPS 本机未安装；外部 Office 写入验证采用同语义外部程序修改 + 生产路径取证，renderer 过期路径由自动化测试覆盖；真实 Word/WPS 写入证据需在可交互/已激活的 Office 环境执行。
2. 非 ASCII 大小写折叠不实现（TXT 搜索既有限制，DOCX 一致）；大小写不敏感只折叠 ASCII 字母，偏移不变。
3. 预览窗口可能截断代理对（emoji），仅影响展示，权威范围始终是 `from`/`to`。
4. 真实符号链接用例按本机权限条件跳过（拒绝分支由 lstat/readDir mock 确定性覆盖）。
5. JSDOM 无法可靠断言滚动数值，滚动定位由边界测试 + 手工验收覆盖。
6. `docx@9` core.xml 时间戳非确定（Task 7 既有）；DOCX 搜索基于实际字节 SHA-256 revision，不受影响。
7. junction 清理 `EBUSY` 瞬态闪烁（低频，有界重试缓解，WP6 期间复现一次后重跑通过）。
8. DOCX 搜索承诺边界：图片替代文本、表格、页眉页脚、脚注尾注、批注、修订删除内容、字段、公式、嵌入对象、宏不进入搜索；dirty 标签未保存正文不参与工作区搜索（UI 有明确提示）。
9. 定位只在投影范围精确等于匹配文本时生效；文本/结构/外部 revision 变化判为过期，不搜索"最近的同名文本"。
10. 当前文件查找替换仍只支持 TXT；活动 DOCX 时搜索侧栏显示不可用说明，不出现假可用状态。

## 12. 是否满足全部验收标准

TASK-008 第十一节 11.1（8 项）、11.2（12 项）、11.3（8 项）、11.4（9 项）、11.5（9 项）全部满足并已在任务文档勾选。自动验收项全部由命令实际执行通过；性能观察、开发与生产构建冒烟与外部修改 revision 验证由 Agent 完成；第 8.7 节手工界面清单由项目所有者于 2026-08-15 执行并通过。未加入第九节明确排除的功能（DOCX 当前文件查找替换、工作区替换、正则/模糊/语义搜索、持久索引、数据库、自动保存、新建/另存为、文件管理、AI）。

## 13. 完成后审计修复（2026-08-15）

在首次完成报告后的独立代码复核中发现两项中等问题，均已修复：

1. **旧搜索定位迟到提交**：原实现的异步定位只重新校验工作区 epoch 与 `locateId`，定位等待 loading DOCX 时提交新搜索，旧读取仍可能应用选区。修复后 App 层目标显式携带 `requestId`，点击项必须属于当前 completed 结果，所有异步提交点与宿主回报均校验 epoch + requestId + locateId；新搜索/取消/结果替换会清除旧目标。
2. **总候选预算早于全局排序**：原实现在深度优先遍历收集到 1000 项时即停止，后续的全局排序无法恢复本应更靠前的根目录候选。修复后用相对路径自然顺序小顶堆统一调度目录与候选，展开目录后重新进入全局顺序，保证预算作用于真正的前 1000 个候选，同时不收集无界候选列表。

新增两个回归用例：“loading DOCX 定位期间提交新搜索”与“根文件 + 同前缀子目录合计超过 1000 候选”。定向测试、完整 `check` 与 `build` 均通过，第 12 节验收结论继续成立。

## 14. 任务状态与后续入口

**TASK-008 状态：已完成。**

下一任务已规划为"基础文件管理闭环"（新建 TXT/DOCX/文件夹、另存为、重命名、移动、删除与资源管理器显示），该任务需单独设计目标路径校验、冲突、覆盖确认、未保存标签迁移、搜索结果失效和可恢复删除；当前 DOCX 内查找替换可与文件管理任务比较用户价值后单独排期。
