# TASK-008：工作区 DOCX 正文搜索与富文本结果定位

## 任务状态

> **状态：已完成（2026-08-15，WP0 至 WP7 逐包实施、逐包验收；完成后代码审计发现的两项中等问题已修复并补充回归测试，详见 [TASK-008 完成报告](./TASK_008_COMPLETION_REPORT.md)）。**
>
> 规划日期：2026-08-15。执行从 WP0 开始，逐包完成、逐包验收；在第十一节全部验收项满足后才标记完成。
>
> 本任务建立在 Task 6 的工作区 TXT 搜索与结果定位、Task 7 的 DOCX 结构化模型与富文本编辑闭环之上。Task 1 至 Task 7 的既有行为均为回归基线。

## 一、任务目的

将现有工作区搜索从“只搜索普通 UTF-8 TXT”扩展为“在一次查询中搜索工作区内已保存的 TXT 与基础 DOCX 正文”，并让 DOCX 结果能够安全地：

1. 打开或激活唯一 DOCX 标签；
2. 校验搜索时磁盘 revision 是否仍有效；
3. 校验当前实时 DOCX 正文投影中的匹配范围与匹配文本；
4. 将正文投影偏移映射为 ProseMirror 公开文档位置；
5. 设置富文本选区、滚动到可视区域并聚焦；
6. 在任何过期、结构变化或映射失败情况下只显示非破坏性提示，不错误定位、不修改正文。

本任务不另建第二套搜索界面，不把 DOCX 当作 UTF-8 TXT，也不直接搜索 OOXML、Mammoth HTML 或编辑器 DOM。搜索正文的唯一语义来源是 Task 7 已验证的 `DocxDocumentModel`。

## 二、完成后的用户体验

Task 8 完成后，用户应能：

- 在现有搜索侧栏输入一次普通文字查询，同时搜索当前工作区磁盘上已保存的 TXT 与 DOCX；
- 保持 Task 6 的大小写开关、开始、取消、连续提交、分组结果、统计与截断提示；
- 在结果文件分组中看见明确的 TXT / DOCX 类型标识；
- 点击 TXT 结果，继续使用现有 CodeMirror 安全定位流程；
- 点击 DOCX 结果，打开或激活唯一 DOCX 标签，并在匹配仍有效时选中富文本、滚动和聚焦；
- 在未打开、已打开、loading、dirty、read-only、degraded 等 DOCX 状态下得到确定行为；
- 在 DOCX 被外部修改、当前正文结构改变、匹配范围失效或标签生命周期变化时看到“搜索结果已过期”，而不是跳到猜测位置；
- 搜索 read-only / degraded 文档中已经进入结构化模型的正文，同时继续看到原有兼容性提示；
- 明确知道工作区搜索针对磁盘已保存快照，不包含尚未保存的编辑；
- 明确知道图片、表格、页眉页脚、批注、修订等未进入结构化模型的内容不在搜索承诺内。

## 三、执行前置检查

### 3.1 必读材料

实施前必须阅读并核对：

- `README.md`；
- `docs/PROJECT_BASELINE.md`；
- `docs/TESTING.md`；
- `docs/TASK_006_TXT_SEARCH_FIND_REPLACE.md`；
- `docs/TASK_006_COMPLETION_REPORT.md`；
- `docs/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md`；
- `docs/TASK_007_COMPLETION_REPORT.md`；
- `src/shared/search.ts`；
- `src/main/search/match-text.ts`；
- `src/main/search/search-text-workspace.ts`；
- `src/main/search/search-ipc.ts`；
- `src/shared/docx.ts`；
- `src/shared/docx-convert.ts`；
- `src/main/docx/read-docx-document.ts`；
- `src/renderer/lib/use-workspace-search.ts`；
- `src/renderer/lib/use-documents.ts`；
- `src/renderer/components/document/EditorSessionHost.tsx`；
- `src/renderer/components/document/DocxEditorSessionHost.tsx`；
- `src/renderer/components/document/DocumentPane.tsx`；
- `src/renderer/App.tsx`。

### 3.2 工作树与质量基线

WP0 开始时必须：

1. 确认当前分支和工作树状态，保护已有修改；
2. 运行 `npm run check`；
3. 运行 `npm run build`；
4. 记录测试文件数、通过数、条件跳过数与跳过原因；
5. 确认开发模式和生产构建至少能启动到主窗口；
6. 确认 Task 6 的 TXT 搜索、取消、结果定位及 Task 7 的 DOCX 打开、编辑、保存、兼容性提示均无回归。

基线失败时先归因和修复基线，不得把既有失败混入 Task 8。

### 3.3 WP0 必须完成的技术验证

WP0 必须用最小夹具验证并记录：

- DOCX 模型投影与 Tiptap/ProseMirror 文档的文本块顺序完全一致；
- 普通段落、标题、空段落、marks 跨 run、项目符号列表、编号列表和嵌套列表均可稳定映射；
- JavaScript UTF-16 偏移与 ProseMirror 文本位置对中文、emoji 和组合字符保持一致；
- `setTextSelection`、`scrollIntoView` 和 `focus` 可通过 Tiptap/ProseMirror 公开 API 完成，不读取私有 DOM；
- read-only 编辑器可以显示选区并滚动，且不会因此获得编辑能力；
- 接近 20 MiB DOCX 的单文件读取期间取消仍满足“已开始读取可完成、结果不再提交”的现有协作式语义；
- DOCX 并发 2、全部文件读取并发 4 时，主进程内存和界面响应可接受。

若任一结论不成立，必须先更新本规划中的固定决策与风险，再进入 WP1。

## 四、固定产品与协议决策

### 4.1 一个搜索入口覆盖 TXT 与 DOCX

- 现有工作区搜索侧栏继续作为唯一入口；
- 一次查询默认同时搜索普通 `.txt` 与普通 `.docx`，不增加默认关闭的隐藏选项；
- TXT 查询、匹配、预览、排序和定位语义保持 Task 6 不变；
- DOCX 使用单独的受控读取和正文投影，不复用 `readTextDocument`；
- 结果按规范工作区相对路径自然排序，不因文件类型或并发完成顺序改变；
- 同一路径只产生一个文件分组，同一路径只打开一个标签。

### 4.2 数据来源与兼容性范围

- 工作区搜索只针对磁盘已保存快照，不搜索 dirty 标签中的未保存内容；
- TXT 继续以剥离 BOM 后的严格 UTF-8 正文为搜索文本；
- DOCX 通过现有 `readDocxDocument` 完成路径、类型、大小、ZIP/OOXML、资源预算、revision 与模型导入；
- DOCX 搜索文本只来自成功导入的 `DocxDocumentModel`；
- `supported`、`degraded` 与 `read-only` 文档均可搜索已经进入模型的正文；
- 损坏、加密、伪装、超限、无法读取或无法导入的 DOCX 按单文件错误隔离并计入跳过统计；
- 0 字节 DOCX 占位文件视为空白文档，无匹配且不报错；
- 不搜索未进入模型的图片替代文本、表格内容、页眉页脚、脚注尾注、批注、修订删除内容、字段、嵌入对象或宏；
- 搜索不会触发保存、兼容性确认、自动保存、重新读取或备份创建。

### 4.3 DOCX 规范正文投影

新增纯函数，将 `DocxDocumentModel` 投影为确定性的可搜索正文和文本块映射。规则固定为：

1. 按文档顺序深度优先遍历模型；
2. 普通段落与标题各形成一个文本块；
3. 列表块自身不产生文字，列表内段落/标题按深度优先顺序形成文本块；
4. 单个文本块内容为全部 run 的 `text` 原样连接，marks、字号、颜色、对齐、标题等级与列表序号不进入搜索文本；
5. 相邻文本块之间插入恰好一个人工 `\n`；
6. 空段落仍保留为空文本块和相邻分隔边界，确保模型顺序与编辑器文本块序号一致；
7. 不在文档开头或结尾额外插入换行；
8. 投影偏移使用 UTF-16 code unit，与 JavaScript 字符串和 ProseMirror 文本位置一致；
9. 投影结果携带仅供进程内映射使用的文本块序号、投影 `from/to` 与块正文，不把模型、路径或 ProseMirror 节点跨 IPC；
10. 投影函数不依赖 Electron、Node.js、Mammoth、Tiptap、ProseMirror、DOM 或文件系统。

查询请求仍拒绝换行，因此匹配不会跨越人工文本块分隔符。run 边界不是搜索边界：被粗体、斜体或其他 marks 拆开的连续文字可以正常匹配。

### 4.4 查询、匹配与预览语义

- 继续使用 Task 6 的 1 至 256 UTF-16 单元单行 literal 查询；
- 继续支持大小写敏感开关，不支持用户正则表达式；
- 大小写不敏感仍只折叠 ASCII 字母，不改变原文偏移；
- 匹配不重叠，单文件内按 `from` 升序；
- DOCX 的 `from/to` 以完整规范正文投影为基准；
- DOCX 的行列以正文投影为基准，从 1 开始；界面应表述为“提取正文中的行/列”，不冒充 Word 页面坐标；
- 预览继续为单行安全文本片段，由 React 文本节点渲染；
- 查询、完整正文、模型、原始 OOXML 与匹配内容不得进入日志。

### 4.5 固定资源上限

Task 8 固定采用：

| 项目                      |                 上限 |
| ------------------------- | -------------------: |
| 查询长度                  | 256 UTF-16 code unit |
| 单次 TXT + DOCX 总候选数  |                 1000 |
| 其中 DOCX 候选数          |                  200 |
| 单个 TXT 大小             |           复用 5 MiB |
| 单个 DOCX 压缩大小        |          复用 20 MiB |
| 单个 DOCX 模型与 ZIP 预算 | 复用 Task 7 全部上限 |
| 单文件返回匹配数          |                  200 |
| 单次返回匹配总数          |                 2000 |
| 单条预览长度              | 160 UTF-16 code unit |
| 全部候选读取并发          |                    4 |
| 其中 DOCX 同时读取/导入   |                    2 |

- 1000 是 TXT 与 DOCX 合计候选预算，不是每种文件各 1000；
- 200 DOCX 上限用于控制 ZIP 检查、导入和模型内存压力；
- 新增截断原因 `docx-file-limit`；
- 截断原因优先级固定为：`file-limit` > `docx-file-limit` > `total-matches-limit` > `matches-per-file-limit`；
- 达到预算返回明确截断状态，不把预算排除项计为读取失败；
- 不为 Task 8 引入数据库、持久索引、worker thread、子进程或后台常驻服务；
- 若 WP0 实测证明上述并发不可接受，只能收紧并发，不能无证据提高资源上限。

### 4.6 共享契约的兼容演进

继续保留 `WorkspaceTextSearchRequest`、`WorkspaceTextSearchResult` 与 `search.textWorkspace` 命名。“Text”在 Task 8 起表示各受支持文档的规范可搜索文本，而不是只表示 `.txt` 扩展名。避免仅为命名进行全链路重写。

`WorkspaceTextSearchFileResult` 新增必填判别字段：

```ts
type WorkspaceSearchDocumentKind = 'txt' | 'docx';

interface WorkspaceTextSearchFileResult {
  readonly kind: WorkspaceSearchDocumentKind;
  readonly relativePath: string;
  readonly revision: string;
  readonly matches: readonly WorkspaceTextSearchMatch[];
  readonly truncated: boolean;
}
```

其余匹配字段保持兼容：

- TXT `from/to` 仍指向原 TXT 正文；
- DOCX `from/to` 指向规范 DOCX 正文投影；
- `kind` 由主进程受控候选分类产生，renderer 不从展示文案猜测；
- 请求不增加工作区根、扩展名列表、glob、解析选项、并发数或资源预算；
- preload 继续暴露固定开始/取消方法，不新增通用 IPC。

### 4.7 候选遍历、读取与取消

- 遍历继续从主进程 `workspace-session` 获取当前根；
- 目录遍历不跟随符号链接、junction 或其他重解析点；
- 候选只包括大小写不敏感的普通 `.txt` 与 `.docx`；
- 候选由全局相对路径自然顺序优先队列驱动，确保先取全局排序的前 1000 个再应用确定性预算，不得让子目录的深度优先遍历提前耗尽预算；
- TXT 复用 `readTextDocument`，DOCX 复用 `readDocxDocument`；
- 全部文件池并发不超过 4，同时处于 DOCX 读取/导入阶段的不超过 2；
- 新搜索先取消旧搜索，同一窗口同时最多一个活动搜索；
- 取消在目录批次、条目、读取前后、正文投影和匹配循环检查；
- 已经开始的 TXT/DOCX 单文件读取可以完成，但取消后结果不得提交；
- 窗口销毁、工作区切换、组件卸载与更新请求都必须作废旧任务；
- 根不可读导致整体失败，子目录与单文件失败隔离；
- 搜索全过程只读，不创建备份、临时文件、索引或缓存。

### 4.8 DOCX 结果定位与二次验证

定位请求必须至少绑定：

- 唯一 `locateId`；
- 工作区 epoch；
- 搜索 `requestId`；
- 文件 `kind`；
- 规范相对路径；
- 搜索时磁盘 `revision`；
- 投影 `from/to`；
- 实际 `matchedText`。

点击 DOCX 结果后的固定流程：

1. 确认点击项仍属于当前 completed 搜索结果；
2. 调用通用 `openFile` 打开或激活唯一标签，loading 时等待读取稳定；
3. 校验返回标签确为 DOCX，且具有成功快照和模型；
4. 校验标签磁盘基线 revision 与搜索结果 revision 完全一致；
5. 对标签当前实时模型重新生成规范正文投影；
6. 校验 `from/to` 在范围内且投影片段精确等于 `matchedText`；
7. 将带 `locateId` 的目标下发给目标 DOCX 编辑器宿主；
8. 宿主从当前 ProseMirror 文档的公开节点 API 生成同规则文本块投影；
9. 再次校验投影全文/目标片段与范围，防止 App 校验后到 effect 执行前发生编辑；
10. 匹配必须完整位于一个真实文本块内；映射为该文本块公开 ProseMirror 内容起点加块内 UTF-16 偏移；
11. 使用公开命令设置选区、滚动和聚焦；
12. 宿主通过 `locateId` 回报 applied 或 stale，App 只接收当前定位请求的回报；
13. 同一定位目标只应用一次，普通 rerender、标签切换或模型等价回写不得重复抢焦点。

完成后审计进一步固定：点击参数必须是当前 completed 结果中的原始文件分组与匹配对象；定位等待 DOCX 读取或宿主回报时，若提交新搜索、取消搜索或替换 completed `requestId`，必须立即作废旧定位，即使工作区 epoch 未变也不得应用旧选区或迟到提示。

任何步骤失败都不得猜测最近文本、按块序号强行跳转、清除 dirty、修改正文或触发保存。只激活标签并显示非破坏性过期提示。

### 4.9 dirty、格式变化与兼容性状态

- dirty DOCX 不一律拒绝定位；
- 当前投影在原 `from/to` 仍精确等于 `matchedText` 时允许定位；
- 在匹配之前插入/删除正文导致偏移变化时，即使别处存在同名文本也必须判为过期；
- 只改变 marks、字号、颜色或对齐而正文投影不变时允许定位；
- 改变列表/段落结构但投影与文本块映射不再一致时判为过期；
- read-only 文档允许选择、滚动和复制，不因此开放编辑；
- degraded 文档搜索和定位不等于确认编辑兼容性，原确认门禁保持不变；
- 外部程序只修改格式也会改变 DOCX 原始字节 revision，因此旧磁盘搜索结果先按 revision 判为过期。

### 4.10 UI 与可访问性

- 搜索输入说明更新为“搜索工作区中已保存的 TXT 和 DOCX 正文”；
- 结果分组显示可访问的 TXT / DOCX 类型标签；
- 统计继续显示扫描、命中文件、匹配、跳过与截断；
- DOCX 结果的行列明确属于提取正文，不显示虚构页码；
- 无工作区、搜索中、取消、无结果、错误和截断状态保持 Task 6 语义；
- 搜索侧栏明确提示未保存修改不参与工作区搜索；
- 复杂 DOCX 的结果不声称覆盖未支持内容；
- 当前文件查找替换仍只支持 TXT；活动 DOCX 时必须显示不可用说明或禁用入口，不能出现点击无响应的假可用状态；
- 不使用 `dangerouslySetInnerHTML`，不从展示字符串解析结构化字段。

### 4.11 依赖与状态管理

- 预计不新增生产依赖；
- 复用现有 Mammoth、JSZip、Tiptap/ProseMirror、匹配器与搜索 controller；
- 不引入 Zustand、Redux、数据库、索引库、搜索二进制或通用任务框架；
- 若确需新增依赖，必须在对应工作包开始前记录版本、用途、许可证、包体积与不使用现有能力的原因。

## 五、状态模型与必须保持的不变量

### 5.1 搜索状态

继续使用 Task 6 的 idle / searching / completed / cancelled / error 状态与：

- 当前输入值；
- 已提交查询；
- 大小写选项；
- 当前 requestId；
- 发起时工作区 epoch；
- 完成结果与统计；
- 当前定位请求；
- 非破坏性过期提示。

结果文件增加 `kind`，定位目标增加 `locateId` 与文件类型。

### 5.2 必须保持的不变量

1. 同一窗口同一时刻最多一个活动工作区搜索；
2. 同一路径在单次结果中最多一个分组；
3. 单个分组的 `kind` 与主进程受控读取分支一致；
4. 同一路径只对应一个标签；
5. TXT 既有查询、匹配、排序、定位与过期语义不变；
6. DOCX 搜索文本只来自合法 `DocxDocumentModel`；
7. DOCX 查询不跨人工文本块分隔符；
8. marks 不改变投影偏移，文本与结构顺序决定偏移；
9. 搜索结果只代表磁盘 revision，不代表未保存编辑；
10. 定位必须同时通过工作区、请求、标签、类型、revision、范围和匹配文本校验；
11. DOCX 宿主必须在实际选区变更前完成第二次实时投影校验；
12. 过期定位不修改正文、不清除 dirty、不触发保存或重读；
13. read-only / degraded 搜索不得改变原编辑与保存门禁；
14. 取消结果不携带部分 completed 结果；
15. 搜索不写工作区，不留下 `.wenshu-*`、索引或缓存文件；
16. renderer 不能提交根路径、绝对路径、解析策略或资源上限。

### 5.3 异步提交条件

搜索结果提交必须满足：

- controller 仍挂载；
- requestId 仍是当前请求；
- 工作区 epoch 未变化；
- 主进程任务仍属于发送窗口；
- 请求未取消；
- 结果形状通过受控协议。

定位结果提交必须满足：

- locateId 仍是最新定位；
- 工作区 epoch 未变化；
- 搜索 requestId 仍对应当前完成结果；
- 标签仍存在且路径、类型一致；
- 读取已稳定；
- revision、范围和匹配文本仍有效；
- 宿主回报对应同一 locateId。

## 六、模块与文件职责建议

### 6.1 DOCX 搜索正文投影

建议新增 `src/shared/docx-search-text.ts`：

- `projectDocxModelSearchText(model)`；
- 规范投影文本与文本块段映射类型；
- 深度优先遍历和人工换行规则；
- 纯运行时、无框架依赖；
- 输入模型合法性由调用方保证，开发断言可复用模型校验；
- 单元测试覆盖模型结构、UTF-16、空块、marks 与列表。

不要把搜索投影塞进导入器、导出器或 React 组件。

### 6.2 主进程混合文档搜索器

扩展 `src/main/search/search-text-workspace.ts`，或在不复制遍历逻辑的前提下拆分小型候选读取器：

- 候选分类为 TXT / DOCX；
- TXT 分支复用 `readTextDocument`；
- DOCX 分支复用 `readDocxDocument` 和正文投影；
- 统一调用现有 literal matcher；
- 实现总候选 1000、DOCX 200、总并发 4、DOCX 并发 2；
- 保持稳定排序、统计、错误隔离与协作式取消；
- 返回带 `kind` 的分组；
- 不保留完整 DOCX 模型到最终结果；
- 不注册新通用 IPC。

### 6.3 共享搜索契约、IPC 与 preload

扩展：

- `src/shared/search.ts`：文件 kind、新截断原因、更新后的注释与校验；
- `src/main/search/search-ipc.ts`：保持现有任务身份和取消模型；
- `src/shared/desktop-api.ts`：只更新“搜索规范正文”的说明；
- `src/preload/index.ts`：保持固定 `textWorkspace` / `cancelTextWorkspace` 形状。

请求形状不变，因此不得新增文件类型、根路径或解析选项参数。

### 6.4 renderer 搜索 controller 与结果界面

扩展：

- `use-workspace-search.ts`：接受带 kind 的结果，保持 epoch 与迟到结果防护；
- `SearchResults.tsx`：显示类型标识和 DOCX 提取正文位置；
- `SearchSidebar.tsx`：更新范围说明、未保存提示和当前文档能力状态；
- 相关样式：只增加必要的类型标签与提示，不重做搜索侧栏。

### 6.5 通用结果打开与定位协调

扩展 `App.tsx`：

- 结果点击从 TXT 专用 `openTextFile` 改为通用 `openFile`；
- 校验搜索结果 kind 与实际标签类型一致；
- TXT 使用当前实时 content 校验；
- DOCX 使用规范正文投影校验；
- 统一创建带 locateId 的定位目标；
- 接收宿主 applied / stale 回报；
- 新定位、工作区切换、标签关闭或组件卸载作废旧目标。

若逻辑继续增长，应把“打开 → 校验 → 下发定位”提取到独立 renderer helper/hook，避免继续扩大 `App.tsx`。

### 6.6 TXT 与 DOCX 编辑器宿主

- `EditorSessionHost.tsx`：保持 CodeMirror 定位行为，迁移到统一 locateId/outcome 协议；
- `DocxEditorSessionHost.tsx`：新增 ProseMirror 公共节点投影、二次校验、位置映射、选区、滚动与聚焦；
- `DocumentPane.tsx`：按活动标签 kind 只把目标传给匹配的宿主；
- 不让 `DocumentPane` 直接读取 CodeMirror/Tiptap 私有状态；
- 不操作 `.ProseMirror` DOM、浏览器 Range 或内部未公开字段。

## 七、Electron 与安全边界

### 7.1 renderer 可用能力

renderer 继续只能：

- 提交固定查询、大小写开关和 requestId；
- 提交固定取消 requestId；
- 接收规范相对路径、文件 kind、revision、匹配、统计和稳定错误；
- 通过既有 `document.readDocx(relativePath)` 打开搜索结果；
- 在内存中的编辑器会话内使用公开选择与滚动 API。

### 7.2 禁止扩大能力

renderer 不得提交或获得：

- 工作区根或绝对路径；
- glob、任意扩展名、编码、ZIP/XML 选项；
- 文件读取并发、大小或解压预算；
- 原始 DOCX 字节、OOXML、未清洗 HTML、Buffer、ZIP 条目或句柄；
- shell 命令、外部程序、网络 URL；
- 通用 IPC invoke、通用文件系统或通用任务取消接口；
- 强制忽略 revision、跳过兼容性或猜测定位的开关。

### 7.3 必须保持的安全属性

- `nodeIntegration: false`、`contextIsolation: true`、sandbox 保持不变；
- 工作区根只来自主进程会话；
- 候选读取每次重新校验路径、逐段链接、真实路径、普通文件与扩展名；
- DOCX 继续作为不可信 ZIP 处理，所有预算保持生效；
- 不访问外部关系、不执行宏、脚本、字段或嵌入对象；
- 日志和错误不泄漏查询、正文、模型、绝对路径、原始异常或调用栈；
- 搜索只读，不写备份、临时文件、索引或缓存；
- 旧工作区、旧请求和旧定位结果不得进入新会话。

## 八、测试要求

### 8.1 Task 1 至 Task 7 全量回归

- 全部现有 typecheck、lint、format、Vitest 和 build 必须通过；
- TXT 工作区搜索结果、统计、取消、截断和定位测试不得弱化；
- DOCX 读取、兼容性、编辑、保存、备份、多标签与生命周期测试不得弱化；
- 不得通过删除断言、扩大超时、无条件 skip 或捕获后忽略错误来制造通过。

### 8.2 DOCX 正文投影纯测试

至少覆盖：

- 空模型、单段、多段与空段；
- 标题 1-3；
- run 拼接与跨 marks 查询；
- 字号、颜色、粗体、斜体、下划线不改变投影；
- 项目符号、编号与嵌套列表深度优先顺序；
- 人工换行恰好一个，开头结尾无额外换行；
- 查询不跨块；
- 中文、英文、emoji、组合字符与 UTF-16 范围；
- run 内原生换行；
- 最大合法模型附近的线性遍历与预算；
- 模型投影与由同一模型生成的 Tiptap/ProseMirror 文本块投影一致。

### 8.3 主进程混合搜索测试

至少覆盖：

- 纯 TXT、纯 DOCX、混合工作区与空工作区；
- 大小写扩展名；
- supported、degraded、read-only、0 字节 DOCX；
- 损坏、加密、伪装、超限、导入失败和读取中消失；
- 不搜索不支持内容，搜索已进入模型的正文；
- TXT 与 DOCX 结果统一自然排序；
- 同一查询在段落、标题、marks、列表中命中；
- 总候选 1000 与 DOCX 候选 200；
- 单文件 200、总匹配 2000 与截断优先级；
- 总并发不超过 4、DOCX 并发不超过 2；
- 搜索前、遍历中、读取前后、投影中和匹配中取消；
- 新搜索取消旧搜索、工作区切换取消、窗口销毁清理；
- 根错误整体失败，子目录/单文件错误隔离；
- 符号链接/junction 不跟随，真实链接测试允许按环境条件跳过但必须有 mock 确定性覆盖；
- 搜索不创建或修改任何文件。

### 8.4 契约、IPC 与 preload 测试

- 请求精确键校验保持 Task 6 行为；
- 多余根路径、文件类型、glob、预算或解析字段继续被拒绝；
- 文件结果 kind 只接受 `txt` / `docx`；
- 新截断原因运行时与类型契约一致；
- IPC 从当前主进程工作区会话取根；
- 同窗口唯一活动任务、跨窗口隔离和未知取消安全；
- preload 不暴露 ipcRenderer 或通用通道；
- structured clone 数据不含模型、Buffer、Error、函数或类实例。

### 8.5 搜索 controller 与组件测试

- 一次查询展示 TXT 与 DOCX 分组；
- 类型标识、路径、提取正文行列、预览和高亮可访问；
- 统计和截断信息准确；
- 无工作区不发请求；
- searching、cancelled、empty、error 状态稳定；
- 连续提交只显示最新结果；
- 工作区切换清空旧结果；
- 未保存正文提示明确；
- 活动 DOCX 时当前文件查找替换显示不可用，不出现假可用按钮；
- 所有正文/预览用文本节点渲染。

### 8.6 DOCX 打开与定位测试

至少覆盖：

- 点击未打开 DOCX：创建唯一标签，读取后定位；
- 点击已打开 DOCX：只激活原标签；
- 点击 loading DOCX：等待原读取，不创建第二标签；
- 同名不同路径与 TXT/DOCX 混合标签；
- 普通段落、标题、跨 mark run、列表与嵌套列表位置；
- 中文、emoji 与 UTF-16 偏移；
- read-only 可以定位但不可编辑；
- degraded 未确认也可定位，且不自动确认；
- dirty 但原投影片段未变时定位成功且 dirty 保留；
- 仅格式变化且投影未变时定位成功；
- 匹配前正文插入/删除、结构变化、范围越界或文本不符时过期；
- 外部修改导致 revision 不同；
- read-error、标签关闭、工作区切换、新定位覆盖旧定位；
- App 校验后、宿主应用前再次编辑时由宿主二次校验拒绝；
- 同一 locateId 只应用一次；
- stale/applied 迟到回报不覆盖最新定位状态；
- 定位不进入撤销历史、不修改模型、不触发保存。

### 8.7 手工桌面与性能冒烟

至少在 Windows 开发模式与生产构建各完成一次：

- 包含 TXT、普通 DOCX、WPS DOCX、read-only、degraded、损坏 DOCX 的混合工作区搜索；
- 中文、英文、emoji、大小写开关；
- 查询、取消、连续提交和无结果；
- 未打开/已打开/loading/dirty/read-only/degraded DOCX 结果点击；
- 段落、标题、格式跨 run、项目符号、编号和嵌套列表定位；
- 外部 Office 修改后的旧结果过期；
- 搜索中切换工作区和关闭窗口；
- 接近 1000 总文件、其中接近 200 DOCX 的性能观察；
- 记录扫描耗时、峰值内存观察、取消响应和界面可用性；
- 控制台与终端无未处理异常；
- 工作区无新增备份、索引、缓存或临时残留。

## 九、明确不在本任务范围内

- 当前 DOCX 内查找、替换或查找面板；
- 工作区替换、批量替换或搜索结果直接写盘；
- dirty 标签未保存正文与磁盘搜索结果合并；
- 正则表达式、whole-word、模糊、拼音、语义或 AI 搜索；
- 按文件类型、路径、标题等级或兼容性筛选；
- 持久全文索引、SQLite、倒排索引或后台监听；
- 图片 OCR、图片替代文本、表格、页眉页脚、批注、修订、脚注、字段、公式或嵌入对象搜索；
- Word 页码、版面坐标或完整 Office 布局定位；
- DOCX 新建、另存为、重命名、移动、删除；
- 自动保存、文件系统监听、最近工作区、标签恢复和搜索历史；
- 标签拖拽、固定、分屏或批量关闭；
- Markdown、PDF 或其他新文件类型；
- 通用文件处理器、插件系统或 AI/Agent 能力。

## 十、工作包与执行顺序

每次只实施一个工作包。当前包门禁失败时不得进入下一包。

### WP0：锁定基线、投影语义与技术验证

- 完成第三节全部前置检查；
- 记录 check、build、测试数与条件跳过；
- 建立段落、标题、marks、列表、read-only、degraded 和大文件夹具；
- 验证模型投影与 ProseMirror 映射；
- 验证 read-only 定位和并发/取消假设；
- 冻结第四节全部协议和预算。

验收门禁：Task 7 基线可重复通过；投影与公开 API 技术验证有记录；无未决语义。

### WP1：DOCX 正文投影与共享契约

- 新增纯 DOCX 搜索正文投影模块；
- 扩展搜索文件 kind 与截断原因；
- 更新运行时校验与注释；
- 完成第 8.2、8.4 节的纯契约测试；
- 尚不修改真实遍历或 UI。

验收门禁：投影确定、线性、有界、无框架依赖；TXT 契约无回归；完整 check/build 通过。

### WP2：主进程混合文档搜索

- 扩展候选为 TXT + DOCX；
- 复用两类受控读取器；
- 接入 DOCX 正文投影与现有 matcher；
- 实现总候选、DOCX 候选和双层并发上限；
- 完成错误隔离、取消、统计、排序和截断；
- 增加第 8.3 节测试；
- 尚不改 renderer 定位。

验收门禁：不越界、不跟随链接、不写文件；混合结果确定；并发和取消可验证；完整 check/build 通过。

### WP3：IPC、preload、controller 与搜索侧栏

- 更新共享 DesktopApi 说明和 IPC 结果校验；
- 保持固定请求/取消 API；
- renderer 接受带 kind 的混合结果；
- 更新搜索范围说明、类型标识、统计与当前 DOCX 查找不可用状态；
- 增加第 8.4、8.5 节测试。

验收门禁：renderer 权限不扩大；一次查询正确展示两类文件；TXT 搜索 UI 无回归；完整 check/build 通过。

### WP4：通用结果打开与 DOCX 富文本定位

- 结果打开入口改用通用 `openFile`；
- 建立统一 locateId/outcome 协议；
- 实现 App 的类型、revision 与实时投影校验；
- 实现 DocxEditorSessionHost 的公开节点投影、二次校验和选区映射；
- 保持 CodeMirror 定位语义；
- 增加第 8.6 节测试。

验收门禁：TXT/DOCX 均形成“打开/激活 → 验证 → 定位”闭环；过期不误定位；完整 check/build 通过。

### WP5：生命周期、兼容性与混合场景回归

- 覆盖 loading、dirty、saving、read-only、degraded、read-error；
- 覆盖工作区切换、标签关闭、新定位、窗口关闭和迟到回报；
- 覆盖格式变化、结构变化和外部修改；
- 回归保存、未保存保护、搜索取消和多标签会话隔离；
- 补齐遗漏的组件与状态测试。

验收门禁：所有异步身份不变量可测试；搜索不改变编辑/保存门禁；完整 check/build 通过。

### WP6：性能观察、桌面冒烟与风险收敛

- 执行第 8.7 节开发和生产构建冒烟；
- 记录普通混合工作区和接近上限工作区性能；
- 检查 DOCX 并发、内存、取消响应和主界面可用性；
- 用 Word/WPS 外部修改验证 revision 过期；
- 只根据证据修正实现，不在此包扩大产品范围。

验收门禁：性能与取消达到可用水平；无数据写入和临时残留；风险有明确结论。

### WP7：整体验收、文档与完成报告

- 运行完整 check 和 build；
- 执行最终桌面手工清单；
- 更新 README、项目基线、测试指南与项目结构；
- 将 Roadmap 中 Task 8 标记完成；
- 新增 `TASK_008_COMPLETION_REPORT.md`；
- 记录实际协议、预算、投影、定位、测试、性能、外部 Office 验证和已知限制；
- 仅在第十一节全部满足后把本文件状态改为已完成。

验收门禁：文档与行为一致；所有自动和手工验收有证据；无开放的 P0/P1 数据安全问题。

## 十一、最终验收标准

> 以下条件全部满足，Task 8 已标记为完成（2026-08-15，见 [TASK-008 完成报告](./TASK_008_COMPLETION_REPORT.md)）。
>
> 2026-08-15 完成后复核：已针对“新搜索未作废旧定位”和“总候选预算早于全局排序”补充修复与回归测试，验收勾选结论保持有效。

### 11.1 搜索范围与结果

- [x] 一次查询同时搜索工作区已保存 TXT 与 DOCX；
- [x] TXT 既有匹配语义完全保持；
- [x] DOCX 段落、标题、marks 与列表正文可搜索；
- [x] DOCX 不支持内容不被错误承诺；
- [x] supported、degraded、read-only 行为确定；
- [x] 0 字节、损坏、加密、超限和失败文件正确处理；
- [x] 文件排序、分组、统计、预览与类型标识准确；
- [x] 未保存正文不参与搜索且 UI 有明确提示。

### 11.2 投影与定位

- [x] DOCX 正文投影规则有纯测试并与编辑器投影一致；
- [x] UTF-16、中文、emoji、空段与嵌套列表映射正确；
- [x] 未打开、已打开和 loading DOCX 只产生唯一标签；
- [x] revision、范围、文本和宿主二次校验全部生效；
- [x] dirty 文本未影响原范围时可定位；
- [x] 仅格式变化时可定位；
- [x] 文本/结构/外部 revision 变化时只提示过期；
- [x] read-only 可定位但不可编辑；
- [x] degraded 定位不自动确认兼容性；
- [x] 选区、滚动与焦点只使用公开 API；
- [x] 同一目标只应用一次，迟到回报不污染新状态；
- [x] 定位不修改正文、不制造 dirty、不进入撤销历史。

### 11.3 取消、预算与性能

- [x] 总候选 1000、DOCX 200、单文件 200、总匹配 2000 生效；
- [x] 总并发不超过 4、DOCX 并发不超过 2；
- [x] 截断原因与优先级准确；
- [x] 新搜索取消旧搜索；
- [x] 工作区切换、窗口销毁和组件卸载清理任务；
- [x] 取消不提交部分 completed 结果；
- [x] 接近上限的混合工作区不冻结主界面；
- [x] 性能和取消响应有实际记录。

### 11.4 Electron 与数据安全

- [x] renderer 不能传入根路径、绝对路径、glob、解析选项或预算；
- [x] 不跟随符号链接/junction；
- [x] TXT/DOCX 候选均复用受控读取与 revision；
- [x] DOCX ZIP/OOXML 全部资源预算保持；
- [x] 不访问外部资源、不执行宏或嵌入内容；
- [x] IPC 与日志不泄漏正文、模型、路径或原始异常；
- [x] 搜索全过程不创建、修改、删除或重命名文件；
- [x] 工作区无索引、缓存、备份或临时残留；
- [x] Electron 隔离和 sandbox 基线不变。

### 11.5 质量与文档

- [x] Task 1 至 Task 7 全量回归通过；
- [x] 新增投影、混合搜索、契约、IPC、组件和定位测试；
- [x] 没有无条件 skip、only 或弱化断言；
- [x] typecheck、lint、format、test、check、build 全部通过；
- [x] 开发模式与生产构建桌面冒烟通过；
- [x] Word/WPS 外部修改过期路径完成验证；
- [x] README、项目基线、测试指南和项目结构同步；
- [x] 完成报告包含可核对证据；
- [x] 已知限制与实际行为一致。

## 十二、失败处理与决策规则

- 投影语义不明确：停止实现，先用最小模型和编辑器夹具冻结规则；
- 模型投影与 ProseMirror 顺序不一致：不得按近似文本搜索猜测，先修正转换或映射；
- 单个 DOCX 读取不可取消：允许已开始读取完成，但完成后必须检查取消并丢弃；
- 主进程响应明显变差：先降低 DOCX 并发并记录数据，不立即引入 worker 或索引；
- DOCX 不支持内容未进入模型：不临时解析原始 XML扩大搜索承诺；
- dirty 结果无法精确映射：判为过期，不搜索最近同名文本；
- read-only 无法稳定聚焦：允许保持选区和滚动，以不开放编辑为优先，并在完成报告记录；
- 新依赖才可解决：先提交依赖评估，未经说明不增加；
- 基线测试失败：先归因，不将其标为 Task 8 新失败或直接跳过；
- 安全与便利冲突：优先工作区边界、资源预算、revision 和非破坏性失败。

## 十三、执行提示模板

每个工作包建议使用以下固定提示，只替换工作包编号和内容：

> 阅读 `README.md`、`docs/PROJECT_BASELINE.md`、`docs/DEVELOPMENT_ENVIRONMENT.md`、`docs/TESTING.md`、`docs/TASK_006_TXT_SEARCH_FIND_REPLACE.md`、`docs/TASK_006_COMPLETION_REPORT.md`、`docs/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md`、`docs/TASK_007_COMPLETION_REPORT.md`、`docs/TASK_008_DOCX_WORKSPACE_SEARCH.md` 以及与当前工作包直接相关的源码和测试。只实现 TASK-008 的 WPx，不提前实现后续工作包，不进行无关重构，不添加 DOCX 当前文件查找替换、工作区替换、正则/模糊/语义搜索、持久索引、数据库、自动保存、新建/另存为、文件管理或 AI。DOCX 搜索正文的唯一语义来源是 Task 7 的 `DocxDocumentModel`，通过规范正文投影和文本块映射生成搜索文本，不把 DOCX 当作 UTF-8 TXT，也不直接搜索 OOXML、Mammoth HTML 或编辑器 DOM；结果定位必须通过 kind、revision、范围与匹配文本的双重校验，并使用 ProseMirror 公开 API 设置选区、滚动和聚焦，任何过期或映射失败都只显示非破坏性提示、不错误定位、不修改正文；根路径只能来自主进程工作区会话；所有读取必须遵守路径、链接、资源预算、候选上限、双层并发、协作式取消与过期语义。搜索全过程只读，不创建备份、临时文件、索引或缓存。不得削弱 TXT、多标签、DOCX 编辑保存、搜索定位、Electron sandbox 或未保存保护。修改后运行当前工作包要求的测试、完整 `check` 和 `build`。最终报告修改文件、关键决策、命令结果、夹具/兼容性证据、未解决问题和是否满足当前工作包门禁。

执行规则：

- 一次对话只完成一个工作包；
- 先读当前工作包直接相关的文件和测试，不重复扫描无关依赖；
- 不覆盖用户已有修改；
- 每个工作包完成后审查 diff 并保留可审计的 Git 恢复点；
- WP0 冻结投影规则、协议和预算，不向产品 UI 暴露 DOCX 搜索能力；
- WP1 后复核投影确定性、UTF-16 偏移、空块/marks/列表映射和 TXT 契约回归；
- WP2 后复核候选分类、双层并发、协作式取消、错误隔离和搜索只读性；
- WP3 后复核 renderer 权限不扩大、类型标识和搜索侧栏语义；
- WP4 后复核 kind/revision/范围/文本校验、宿主二次校验和过期不误定位；
- WP5 后复核 loading/dirty/saving/read-only/degraded 生命周期与编辑保存门禁；
- WP6 后复核性能、内存、取消响应和临时残留；
- 只有 WP7 可以编写完成报告、勾选最终验收项并将状态改为`已完成`。

每个工作包开始时记录：

- 当前分支与工作树；
- 上一包提交或恢复点；
- 本包范围与明确非目标；
- 将修改的文件；
- 将新增或更新的测试；
- 本包验收命令；
- 风险与回滚方式。

每个工作包完成时记录：

- 实际改动；
- 与规划差异；
- 自动检查结果；
- 手工验证结果；
- 剩余限制；
- 是否满足进入下一包的门禁。

## 十四、交付物

任务完成时应交付：

1. DOCX 规范正文投影与文本块映射纯模块；
2. 带 TXT/DOCX kind 的共享搜索结果契约；
3. 混合候选遍历、DOCX 受控读取与有界并发；
4. 复用的 literal matcher、统计、取消与截断；
5. 同一搜索侧栏中的 TXT/DOCX 分组结果；
6. 通用结果打开与统一 locateId/outcome 协议；
7. DOCX revision、实时投影与宿主二次校验；
8. ProseMirror 公开位置映射、选区、滚动与聚焦；
9. 投影、遍历、预算、取消、IPC、组件、生命周期和定位测试；
10. 更新后的 README、项目基线、测试指南和项目结构；
11. `TASK_008_COMPLETION_REPORT.md`，至少记录：
    - 实现摘要和关键文件；
    - DOCX 投影规则与不支持内容边界；
    - 契约兼容策略和资源上限；
    - 混合遍历、并发、取消与错误隔离；
    - revision、dirty、二次校验和过期定位；
    - Electron/IPC 安全边界；
    - 自动检查、桌面冒烟与外部 Office 证据；
    - 接近上限工作区的性能观察；
    - 已知限制及是否满足全部验收标准。

## 十五、完成后的下一任务入口

Task 8 完成后，优先建议规划“基础文件管理闭环”：新建 TXT/DOCX/文件夹、另存为、重命名、移动、删除与在资源管理器中显示。该任务必须单独设计目标路径校验、冲突、覆盖确认、未保存标签迁移、搜索结果失效和可恢复删除。

当前 DOCX 内查找替换可与文件管理任务比较用户价值后单独排期，但不得在 Task 8 中顺带实现。
