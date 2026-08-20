# TASK-010：当前 DOCX 内查找与替换

## 任务状态

> **状态：已完成（2026-08-20）。**
>
> WP0 至 WP7 已全部完成并逐包验收（见 [TASK-010 完成报告](./TASK_010_COMPLETION_REPORT.md) 与 [WP0 报告](./TASK_010_WP0_REPORT.md)）；第十一节全部验收项（45 项）已逐项核对并勾选。完整 `check`（62 测试文件 / 1133 通过 / 10 条件跳过，均为真实符号链接/junction 权限条件）与 `build` 依次通过（退出码 0）；开发模式与生产构建 Windows 冒烟通过；任务第八节手工界面验收清单由项目所有者执行并通过。
>
> 本任务建立在 Task 6 的 TXT 当前文件查找替换、Task 7 的 DOCX 结构化编辑与安全保存、Task 8 的 DOCX 规范正文投影与 ProseMirror 定位、Task 9 的稳定 `tabId` 与文件管理闭环之上。Task 1 至 Task 9 的既有行为全部属于回归基线。

## 一、任务目的

补齐当前 DOCX 文档内的查找与替换，使 TXT 与 DOCX 在“当前文件”搜索入口上形成完整闭环。用户应能在当前活动 DOCX 的实时编辑内容中查找普通文字、导航和高亮匹配，并在文档允许编辑时安全地替换当前项或全部匹配。

本任务重点解决以下问题：

1. 当前“查找与替换”侧栏只对 TXT 可用，活动 DOCX 会显示不可用提示；
2. Task 8 已能把 DOCX 规范正文范围映射为 ProseMirror 位置，但尚无当前文档搜索会话、匹配装饰和替换事务；
3. DOCX 匹配可能跨越多个具有不同 marks 的 run，替换必须有确定的格式继承规则；
4. 全部替换必须进入一次撤销历史、遵守模型资源预算，不得发生部分替换；
5. read-only、degraded、saving、dirty、外部重读、多标签和文件路径迁移必须保持确定行为；
6. 新能力不得绕过现有 DOCX 模型、兼容性确认、安全保存、备份与冲突保护。

本任务不新增主进程文件能力，不搜索磁盘快照，不直接解析 OOXML、Mammoth HTML 或编辑器 DOM。当前 DOCX 查找的唯一事实来源是活动 Tiptap/ProseMirror 编辑器的实时文档，规范文本语义继续复用 Task 8 的文本块投影规则。

## 二、完成后的用户体验

Task 10 完成后，用户应能：

- 在活动 DOCX 中按 `Ctrl+F` 打开现有搜索侧栏的“查找与替换”视图并聚焦查找输入；
- 按 `Ctrl+H` 打开同一视图并聚焦替换输入；不可替换的 DOCX 仍可查找，但替换控件明确禁用并说明原因；
- 输入普通单行文字，立即搜索当前 DOCX 的实时内容，包括尚未保存的修改；
- 切换“区分大小写”，使用 Enter / Shift+Enter、F3 / Shift+F3 或按钮导航上一个和下一个匹配；
- 看见“当前序号 / 匹配数”、无匹配和结果过多提示；
- 在正文中看见全部匹配高亮，并用更明显的样式区分当前匹配；
- 匹配普通段落、标题、跨 run marks 的连续文字、项目符号列表、编号列表、嵌套列表、中文和 emoji；
- 定位时选中当前匹配、滚动到可视区域并聚焦编辑器；
- 对允许编辑的 DOCX 替换当前项或全部匹配，替换后正常显示 dirty；
- 将一次“全部替换”作为一个撤销步骤恢复，并可重做；
- 使用现有保存按钮或 `Ctrl+S` 保存替换结果，继续获得 revision 冲突、滚动备份、产物验证与安全替换保护；
- 在 read-only DOCX 中正常查找但不能替换；
- 在 degraded DOCX 中查找无需确认，替换必须先完成绑定当前 revision 的兼容性确认；
- 在多个 TXT/DOCX 标签间切换时保留每个标签自己的查询、选项、当前匹配与编辑历史；
- 在标签重命名、移动或另存为后继续保留查找会话，不因路径变化重建编辑器；
- 在当前内容变化、外部重读或匹配失效时得到安全重算，不跳转到猜测位置、不修改错误范围。

## 三、执行前置检查

### 3.1 必读材料

实施前必须完整阅读并核对：

- `README.md`；
- `docs/PROJECT_BASELINE.md`；
- `docs/DEVELOPMENT_ENVIRONMENT.md`；
- `docs/TESTING.md`；
- `docs/TASK_006_TXT_SEARCH_FIND_REPLACE.md`；
- `docs/TASK_006_COMPLETION_REPORT.md`；
- `docs/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md`；
- `docs/TASK_007_COMPLETION_REPORT.md`；
- `docs/TASK_008_DOCX_WORKSPACE_SEARCH.md`；
- `docs/TASK_008_COMPLETION_REPORT.md`；
- `docs/TASK_009_BASIC_FILE_MANAGEMENT.md`；
- `docs/TASK_009_COMPLETION_REPORT.md`；
- `src/shared/docx.ts`；
- `src/shared/docx-convert.ts`；
- `src/shared/docx-search-text.ts`；
- `src/main/search/match-text.ts`，仅用于比较既有 literal matcher 语义，不把主进程搜索器直接引入 renderer；
- `src/renderer/lib/document-tabs.ts`；
- `src/renderer/lib/use-documents.ts`；
- `src/renderer/lib/use-editor-sessions.ts`；
- `src/renderer/components/document/EditorSessionHost.tsx`；
- `src/renderer/components/document/DocxEditorSessionHost.tsx`；
- `src/renderer/components/document/DocumentPane.tsx`；
- `src/renderer/components/search/SearchSidebar.tsx`；
- `src/renderer/App.tsx`；
- `tests/document/find-replace.test.tsx`；
- `tests/document/docx-editor.test.tsx`；
- `tests/document/docx-locate-host.test.tsx`；
- `tests/docx/docx-search-projection.test.ts`；
- `tests/search/result-locate-docx.test.tsx`；
- Task 9 新增的路径迁移、save-as、mutation epoch 与生命周期测试。

### 3.2 工作树与质量基线

WP0 开始时必须：

1. 报告当前分支、HEAD、工作树状态和用户已有修改；
2. 运行完整 `npm run check`；
3. 运行 `npm run build`；
4. 记录测试文件数、通过数、失败数、条件跳过数与原因；
5. 确认开发模式和生产构建至少能启动到主窗口；
6. 手工确认 TXT 当前查找替换、DOCX 编辑保存、DOCX 工作区结果定位、文件重命名/移动后的编辑器会话均无回归；
7. 为 WP0 建立可审计的 Git 恢复点，但不得覆盖或清理用户已有修改。

基线失败时必须先归因。若是既有问题，应单独报告并决定是否先修复；不得把既有失败弱化、跳过或伪装为 Task 10 的预期失败。

### 3.3 WP0 必须完成的技术验证

WP0 必须使用最小 Tiptap/ProseMirror 夹具实际验证并记录：

- 从实时 ProseMirror 文档按 `node.isTextblock` 深度优先收集文本块，结果与 `joinDocxTextBlocks` / `projectDocxModelSearchText` 的顺序和文本一致；
- 单个匹配跨越多个相邻 text node / marks run 时，可以稳定映射为一个 ProseMirror 选区；
- 匹配不会跨越规范投影插入的人工 `\n`；查找和替换输入均为单行；
- 中文、emoji、代理对和组合字符的 JavaScript UTF-16 偏移与 ProseMirror 位置映射一致；
- ProseMirror Decoration 能同时标记全部匹配和当前匹配，事务后能通过映射或重算安全更新；
- `insertText`、`replaceWith` 或等价公开事务 API 对单 run、跨同 marks run、跨不同 marks run、空替换的实际 marks 行为；
- “替换继承匹配起点字符 marks，保留所在段落/标题/列表结构”的规则可以通过公开事务 API 确定实现；
- 多个匹配按文档逆序写入同一个 transaction，不发生位置漂移，且一次 undo 能恢复全部替换；
- 候选 transaction 的 `doc.toJSON()` 能在 dispatch 前通过 `tiptapJsonToDocxModel` 和现有模型预算校验；失败时可以做到不 dispatch、不 dirty；
- read-only editor 可以显示装饰、选区和滚动，同时替换命令不可用；
- degraded 未确认时查找可用、替换不可用；确认后不重建 editor 即可替换；
- saving 期间替换后，旧保存完成不会清除保存期间产生的新修改；
- 接近 `DOCX_MAX_MODEL_SERIALIZED_BYTES` 和 20,000 文本块的文档中，搜索、装饰和输入响应满足第 4.10 节预算；
- 不增加第三方依赖即可完成；若结论不成立，必须先提交依赖评估并更新规划，不得直接安装依赖。

若任一固定语义无法可靠实现，先更新本任务文档和 `TASK_010_WP0_REPORT.md`，由项目所有者确认后再进入 WP1。

## 四、固定产品与技术决策

### 4.1 当前编辑器实时内容是唯一搜索来源

- 当前 DOCX 查找搜索活动 Tiptap/ProseMirror editor 的实时 `state.doc`；
- 搜索包含未保存修改，不读取磁盘，不调用主进程搜索 IPC，不比较磁盘 revision；
- 不直接搜索 `DocxDocumentModel` 的旧 React 快照，以避免输入事务与 React 更新之间出现短暂过期；
- 不读取 `.docx` ZIP、OOXML、Mammoth HTML 或编辑器 DOM；
- 图片、表格、页眉页脚、批注、修订等未进入当前结构化编辑器的内容不在本任务承诺内。

### 4.2 复用 Task 8 的规范正文投影

- 实时编辑器按文档顺序收集所有 `textblock`；
- 每个 paragraph / heading 是一个文本块，列表容器本身不产生文字；
- 同一文本块内所有 text node 的 `textContent` 连续连接，因此匹配可以跨 marks run；
- 相邻文本块之间只在投影中插入一个人工 `\n`；
- 查找输入是单行，包含 `\r` 或 `\n` 的查询拒绝提交，因此匹配完整位于一个真实文本块；
- 偏移使用 UTF-16 code unit；映射公式继续为：文本块内容起点 `nodePos + 1` 加块内偏移；
- 主进程与 renderer 不新增第二套 DOCX 正文定义。

### 4.3 查找语义

- 只承诺普通 literal 查找和“区分大小写”；
- 默认不区分大小写；WP0 必须记录与现有 CodeMirror 当前文件搜索对 ASCII、中英文和组合字符的实测差异；
- 不执行 Unicode 规范化、语言相关分词或模糊匹配；
- 匹配按文档顺序、从左到右、非重叠收集；
- 查询不能为空，最大 `4096` 个 UTF-16 code unit，包含换行时显示稳定输入错误；
- 当前匹配优先取编辑器选区/光标之后的第一个匹配；不存在时循环到第一个；
- 下一个/上一个循环导航；查询或大小写选项变化后重新确定当前匹配；
- 普通编辑导致匹配变化时，优先选择旧当前位置之后最近的有效匹配；无匹配时 current 为 null；
- 关闭面板移除装饰并把焦点返回编辑器，但保留该标签的查询、替换文本和大小写选项，重开时恢复；
- 工作区搜索结果定位不得改写当前文件查询；如果面板已打开，只按最新编辑器内容重算装饰。

### 4.4 匹配数量与资源预算

- 单标签最多保留和装饰 `2000` 个匹配；扫描发现第 `2001` 个时标记 `truncated`；
- 截断时显示“匹配超过 2000 处”，允许在已收集的 2000 项中导航，但不得声称这是全部结果；
- 截断时禁用“全部替换”，严禁只替换前 2000 项；用户可缩小查询后重试；
- “替换当前项”在当前匹配有效时仍可使用；
- 查找重算不得阻塞输入事件形成明显卡顿；WP0 先实测，再在 WP2 冻结同步计算、微任务、`requestAnimationFrame` 或短 debounce 策略；
- 不引入 worker、索引、数据库、持久缓存或主进程计算；
- editor 销毁后必须释放装饰、监听器、计时器和 controls 引用。

### 4.5 匹配高亮与导航

- 使用 ProseMirror Plugin / PluginKey 管理查找状态和 DecorationSet；
- 普通匹配与当前匹配使用不同 class，当前匹配不得只依赖颜色区分；
- 不向文档内容写入 mark，不修改 DOCX 模型，不制造 dirty；
- 只使用 ProseMirror 公开 state、transaction、node traversal、selection、view dispatch 与 Tiptap 公开命令；
- 不使用 `querySelector` 解析编辑器正文，不依赖 Tiptap 私有字段；
- 导航设置 TextSelection、滚动并聚焦；只读模式也可定位，但不因此开放编辑；
- 查找、导航、切换大小写、开关面板均不得进入撤销历史或触发保存。

### 4.6 替换当前项的固定语义

- 替换输入为普通单行文本，最大 `4096` 个 UTF-16 code unit，包含换行时拒绝；
- 执行前从当前实时 `state.doc` 重新投影并校验查询、选项、当前范围与匹配文本，不信任 UI 中的旧范围；
- 匹配必须完整位于一个文本块；映射失败时不修改文档并重算；
- 非空替换继承匹配起点字符的 marks；若匹配跨越不同 marks，仅使用起点 marks；
- 空替换表示删除；
- paragraph / heading 类型、对齐、列表类型、层级及周围未匹配文字的 marks 保持；
- 候选 transaction 在 dispatch 前必须转换和验证为合法 `DocxDocumentModel`；预算失败时显示非破坏性错误，不 dispatch、不 dirty；
- 成功替换是一个普通可撤销编辑事务，进入既有 `editDocxTab`、dirty、editRevision 和保存流程；
- 替换后当前匹配选择下一处有效匹配并保持面板焦点策略明确。

### 4.7 全部替换的固定语义

- 执行瞬间重新扫描完整实时投影，不能复用输入期间的旧范围；
- 只处理非重叠匹配；
- 有 0 个匹配时无操作，不 dispatch、不 dirty、不产生成功假提示；
- 发现超过 2000 项时整体拒绝，不进行部分替换；
- 从文档末尾向开头把所有替换写入同一个 transaction，避免前方位置漂移；
- 每个替换分别继承自身匹配起点 marks；
- dispatch 前对最终 transaction 文档执行模型转换与资源预算验证；任一失败整体中止；
- 成功后只 dispatch 一次、只产生一次 undo history event；一次 undo 恢复完整替换前内容与格式，一次 redo 恢复全部替换；
- 成功后重算匹配、更新计数并显示实际替换数量；
- 不自动保存，用户仍通过现有保存入口显式保存。

### 4.8 可编辑性与兼容性

- 有可用 editor/model 的 loaded、dirty、saving、save-error、conflict、带快照 read-error DOCX 可以查找；
- `read-only` 可以查找、导航和高亮，所有替换入口禁用；
- `degraded` 可以不经确认查找；只有 `compatibilityConfirmationRevision === document.revision` 时允许替换；
- 兼容性确认必须复用现有确认入口，不允许查找 controller 自行写 confirmation revision；
- saving 期间保持与普通键入相同的可编辑语义：替换产生更高 editRevision，旧保存完成后仍为 dirty；
- loading 或没有可用 editor/model 的 read-error 不显示假可用面板；
- 替换权限应由共享 selector / controller 状态派生，不在多个组件中复制不一致的 status 判断。

### 4.9 TXT 与 DOCX 共用一个侧栏入口

- 保留活动栏“搜索”下的“全局搜索 / 查找与替换”两页结构；
- TXT 继续使用 CodeMirror 自带搜索扩展、面板状态和撤销历史，本任务不重写 TXT matcher；
- DOCX 使用项目自有 React 面板和 ProseMirror 插件；
- `SearchSidebar` 根据活动文档 kind 展示 TXT 的外部 panel host 或 DOCX 面板，不同时显示两套控件；
- `Ctrl+F` / `Ctrl+H` 无论从 TXT 还是 DOCX 发起，都先切到搜索活动栏和“查找与替换”页，再聚焦正确字段；
- 切换标签后 active controls 必须原子切换，迟到的旧 editor 回报不得操作新标签；
- 不从展示文本、文件名或相对路径推导 editor 身份，所有会话绑定稳定 `tabId`。

### 4.10 性能与刷新策略

- 普通文档中输入查询后应在 100 ms 量级内出现结果；这是一项目标，不以不稳定 CI wall-clock 作为单元测试硬断言；
- 20,000 文本块 / 接近模型序列化上限夹具必须进行一次性性能观察并记录硬件、文档规模、查询、匹配数、扫描和装饰耗时；
- 编辑事务后只安排一次重算，取消旧的待执行重算，避免每个 React render 重复扫描；
- 隐藏的非活动 DOCX 标签不得因其他标签输入而重算；其自身 editor state 和查询状态仍保留；
- 不做增量索引或复杂 transaction mapping 优化，除非 WP0 证据证明完整重算不可接受；
- 性能优化不得削弱范围校验、模型预算、全部替换原子性或资源上限。

### 4.11 依赖、进程与安全边界

- 优先只使用当前已安装的 `@tiptap/core`、`@tiptap/pm`、React 和项目纯模块；
- 不增加主进程 IPC、preload 方法、DesktopApi、文件系统读写或 Electron 权限；
- 不把 editor、ProseMirror Node、transaction、Decoration 或文档正文跨 IPC；
- 查找不写磁盘、不创建临时文件或备份；替换只修改内存 editor，保存仍走 Task 7/9 既有路径；
- 不扩大 DOCX 支持格式，不把 read-only/degraded 内容转为无保护编辑；
- 不记录查询、替换文本、正文、完整模型或系统绝对路径到日志；
- 新依赖若确有必要，必须先记录包名、版本、许可证、维护状态、bundle 影响、替代方案和安全风险，经确认后才能加入。

## 五、状态模型、接口与不变量

### 5.1 建议的每标签查找状态

可在 renderer 内定义等价于下列形状的状态；命名可在 WP0 后调整，但语义不得丢失：

```ts
interface DocxCurrentSearchState {
  readonly open: boolean;
  readonly query: string;
  readonly replacement: string;
  readonly caseSensitive: boolean;
  readonly matches: readonly DocxCurrentSearchMatch[];
  readonly currentIndex: number | null;
  readonly truncated: boolean;
  readonly validationError: string | null;
  readonly operationMessage: string | null;
}

interface DocxCurrentSearchMatch {
  readonly from: number;
  readonly to: number;
  readonly matchedText: string;
  readonly blockOrdinal: number;
  readonly pmFrom: number;
  readonly pmTo: number;
}
```

`pmFrom` / `pmTo` 可以只在一次实时计算结果中存在，不得作为跨 editor 生命周期的持久身份。任何编辑事务后都必须映射或重新计算，不允许把旧位置当作仍然有效。

### 5.2 建议的活动 editor controls

App / Sidebar 只应拿到窄的活动编辑器控制接口，不暴露通用 `Editor` 或 `EditorView`：

```ts
interface DocxCurrentSearchControls {
  readonly tabId: string;
  readonly getSnapshot: () => DocxCurrentSearchSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly open: (mode: 'find' | 'replace') => void;
  readonly close: () => void;
  readonly setQuery: (query: string) => void;
  readonly setReplacement: (replacement: string) => void;
  readonly setCaseSensitive: (value: boolean) => void;
  readonly selectNext: () => void;
  readonly selectPrevious: () => void;
  readonly replaceCurrent: () => void;
  readonly replaceAll: () => void;
}
```

可以采用 `useSyncExternalStore` 或等价稳定订阅方式。不得在 React render 期间直接 dispatch ProseMirror transaction，也不得让旧标签 controls 在切换后继续成为活动入口。

### 5.3 必须保持的不变量

1. 查找状态一一绑定稳定 `tabId`，不绑定可变 `relativePath`；
2. 一个 DOCX editor 实例至多注册一个 current-search plugin / controller；
3. active controls 的 `tabId` 必须等于当前活动且已挂载 DOCX 标签；
4. 查找、导航、装饰和关闭面板不修改 `state.doc`、不 dirty、不改变 editRevision；
5. 替换只能作用于执行瞬间重新验证过的实时匹配；
6. 一个替换命令至多 dispatch 一个文档变化 transaction；
7. 全部替换要么全部成功，要么 0 修改；
8. 超过匹配预算时不得部分执行全部替换；
9. 候选文档模型验证失败时不得 dispatch；
10. read-only 或 degraded 未确认时不得 dispatch 替换 transaction；
11. saving 期间替换不得被旧保存完成结果清除；
12. 查找状态和编辑器会话在重命名、移动、另存为后保持；
13. 标签关闭、工作区成功切换或 editor 销毁后不存在悬空订阅、计时器或 active controls；
14. TXT 当前搜索行为、面板状态和快捷键不得因 DOCX 接入而退化；
15. 工作区搜索、结果定位、mutationEpoch 和当前文件搜索状态互不冒充身份；
16. renderer 新能力不扩大 Electron/IPC/preload 权限面。

### 5.4 异步与迟到结果规则

- 若搜索重算使用 debounce、微任务或 animation frame，回调必须绑定 editor/controller generation；
- 回调执行前再次确认 editor 未销毁、tabId 未变且序号仍是最新；
- 新查询、新编辑事务、外部 setContent 或 editor 销毁必须取消/作废旧计算；
- 切换标签不销毁 DOCX editor，但旧标签不得更新当前侧栏；侧栏订阅应随 active controls 切换；
- 外部模型替换后保留 query/replacement/caseSensitive，清除旧 matches/currentIndex，再基于新文档重算；
- 不通过 wall-clock 时间戳判断新旧，不依赖相对路径或显示名称。

## 六、模块与文件职责建议

以下是建议边界，不要求机械照搬文件名；若调整，完成报告必须说明原因。

### 6.1 DOCX 当前搜索纯模块

建议新增 `src/renderer/lib/docx-current-search.ts`：

- 从 ProseMirror 文本块描述生成规范投影；
- 校验 query / replacement；
- literal、case-sensitive、非重叠、有界匹配；
- 投影范围到 textblock / PM 位置映射；
- 当前索引选择、下一个/上一个和内容变化后的最近匹配策略；
- 模块尽量保持纯函数，便于对 UTF-16、marks、列表和预算做确定性测试。

### 6.2 ProseMirror 插件与 controller

建议新增 `src/renderer/lib/docx-current-search-plugin.ts` 或等价模块：

- PluginKey、plugin state 与 DecorationSet；
- editor transaction / selection 监听；
- 搜索重算调度和过期 generation；
- 窄 controls 与订阅快照；
- 导航 selection / scroll / focus；
- 替换 transaction 构建、marks 继承、逆序 replace-all、模型预验证；
- editor 销毁清理。

插件不得持有 React 组件实例，不得直接调用主进程 API。

### 6.3 DOCX 查找替换面板

建议新增 `src/renderer/components/search/DocxCurrentSearchPanel.tsx`：

- 受控查找输入、替换输入、大小写选项；
- 上一个、下一个、关闭、替换、全部替换；
- 当前/总数、截断、验证错误、操作反馈；
- read-only / degraded 未确认 / 无 editor 的禁用原因；
- Enter、Shift+Enter、Escape 和焦点恢复；
- 不直接访问 Tiptap editor，只调用窄 controls。

### 6.4 DOCX editor 宿主

`DocxEditorSessionHost.tsx` 负责：

- 每 editor 安装一次搜索插件/controller；
- 把最新 `tabId`、可替换权限、模型预验证出口与保存/编辑生命周期接入 controller；
- 注册/注销当前搜索 controls；
- 保持现有内容同步、工具栏、保存快捷键和工作区结果定位行为；
- 不因查询变化重建 editor。

### 6.5 DocumentPane、SearchSidebar 与 App

- `DocumentPane` 在稳定 tabId 下转发 controls 注册，并只把活动 DOCX controls 暴露给 App；
- `SearchSidebar` 根据 kind 渲染 CodeMirror panel host 或 `DocxCurrentSearchPanel`；
- `App` 统一处理从快捷键请求切换活动栏/页签和 active controls 身份；
- 活动 DOCX 即使 read-only 也属于 current-document-search available，只是 replace capability 为 false；
- 现有 `EditorSearchControls` 可以演进为判别联合，或为 TXT/DOCX 保持两个窄接口；不得暴露通用 editor。

### 6.6 样式

`src/renderer/styles/app.css` 只增加本任务需要的最小样式：

- DOCX 普通匹配与当前匹配；
- 查找/替换表单、计数、错误、截断和禁用原因；
- keyboard focus-visible 与最小窗口溢出；
- 高对比度下仍可区分当前匹配；
- 不顺带执行未来 UI 优化计划中的设计体系重构。

## 七、Electron、数据与保存边界

### 7.1 不新增跨进程协议

- Task 10 不新增 IPC channel；
- 不修改 preload 暴露面和 `DesktopApi` 方法集合；
- 不把查询、替换文本、匹配范围或正文发送到主进程；
- 不调用工作区搜索 IPC 来实现当前查找；
- preload 契约测试必须证明 API 集合未扩大。

### 7.2 替换不等于保存

- 替换只产生内存编辑事务；
- dirty、editRevision、保存中继续编辑语义全部复用 `document-tabs` / `use-documents`；
- 用户显式保存时继续调用现有 `saveDocx`；
- revision、兼容性 confirmation、滚动备份、产物验证、临时写入、刷盘和安全替换规则不变；
- 替换失败不应触发保存、备份、文件树刷新或 mutationEpoch；
- 替换成功但未保存时，工作区磁盘搜索仍只反映旧磁盘内容，这是既有且必须保留的语义。

### 7.3 不记录敏感正文

- 自动测试使用仓库夹具或临时生成文本；
- 日志、错误和完成报告只记录长度、计数、稳定错误类别与匿名场景；
- 不记录真实查询、替换内容、文档正文、完整模型或绝对工作区路径。

## 八、测试要求

### 8.1 Task 1 至 Task 9 全量回归

必须完整运行现有 typecheck、lint、format、全部 Vitest 与 build。不得：

- 删除或弱化既有断言；
- 使用 `.only`；
- 把稳定测试改为无条件 `.skip`；
- 通过扩大 timeout 掩盖死循环或泄漏；
- 修改 TXT 搜索产品语义来迁就 DOCX 实现；
- 修改 DOCX 安全保存、文件管理或工作区搜索契约。

### 8.2 纯搜索与映射测试

至少覆盖：

- 空查询、超长查询、换行查询；
- 大小写敏感/不敏感；
- 无匹配、一个匹配、多个非重叠匹配、相邻匹配；
- 重复字符的非重叠规则；
- 中文、emoji、代理对、组合字符；
- 跨 marks run 命中；
- 段落、标题、空段落、项目符号/编号/嵌套列表；
- 不跨人工 `\n` 匹配；
- 投影范围与 `pmFrom` / `pmTo`；
- 2000 项边界和第 2001 项截断；
- 当前匹配初选、循环导航和内容变化后的最近匹配。

### 8.3 插件、装饰和导航测试

至少覆盖：

- 打开/关闭面板不修改正文、不 dirty；
- 普通匹配与当前匹配装饰数量、class 和范围；
- 查询/大小写变化刷新装饰；
- next/previous、Enter/Shift+Enter、F3/Shift+F3；
- 选择、滚动与焦点；
- read-only 可定位；
- editor transaction 后重算，不保留错误装饰；
- 外部 setContent 后旧异步重算失效；
- editor destroy 后订阅和定时器清理；
- 不读取正文 DOM、不写入内容 mark。

### 8.4 替换当前项测试

至少覆盖：

- 单 run 替换；
- 同 marks 与不同 marks 的跨 run 替换；
- 替换继承起点 marks；
- 替换为更短、更长、相同文本和空字符串；
- 中文、emoji 与组合字符；
- 标题、列表项内替换，块结构和属性保持；
- 旧范围失效时不修改并重算；
- 无匹配不 dirty；
- 成功替换 dirty、editRevision 增加、undo/redo 正确；
- 模型预算或转换失败时 0 dispatch、0 dirty；
- 替换后选择下一匹配与计数更新。

### 8.5 全部替换测试

至少覆盖：

- 0、1、多个匹配；
- 不同长度替换按逆序不漂移；
- 每个匹配继承各自起点 marks；
- 一次 transaction、一次 undo 恢复全部、一次 redo 重做全部；
- 2000 项允许，2001 项整体拒绝；
- 候选模型超预算整体拒绝，无部分修改；
- 替换结果仍包含查询时安全重算，不递归重复执行；
- 快速重复点击不会重复提交同一命令；
- operation message 报告真实替换数量。

### 8.6 兼容性与生命周期测试

至少覆盖：

- read-only 查找可用、替换入口禁用、命令防御性拒绝；
- degraded 未确认可查不可替换，确认当前 revision 后可替换；
- compatibility revision 变化后旧确认失效；
- saving 期间替换，保存完成后新修改仍 dirty；
- save-error、conflict、带快照 read-error 的确定行为；
- 多 DOCX 标签查询/替换/装饰/历史隔离；
- TXT 与 DOCX 混合切换，正确面板和 controls 原子切换；
- 关闭标签清理，重开是新会话；
- 重命名、移动、save-as 保留稳定 tabId 与搜索状态；
- 工作区切换关闭全部标签并清理 controls；
- 工作区结果定位与当前搜索面板同时存在时互不污染；
- mutationEpoch 只影响工作区搜索，不错误清空当前标签搜索状态。

### 8.7 组件、快捷键与可访问性测试

至少覆盖：

- `Ctrl+F` / `Ctrl+H` 从文件侧栏或全局搜索页切换到正确当前搜索面板；
- 查找/替换字段自动聚焦；
- tab 顺序、按钮可访问名称、disabled 原因和 status live region；
- Escape 关闭并恢复编辑器焦点；
- 窄侧栏下控件可达，无横向溢出导致的不可操作；
- 当前匹配不只依赖颜色；
- 加载、无活动文档、TXT、DOCX、read-only、degraded 的文案准确；
- 不使用 `dangerouslySetInnerHTML` 渲染查询或替换文本。

### 8.8 性能与泄漏观察

至少记录：

- 典型 100 段 DOCX 的查询重算与装饰耗时；
- 20,000 文本块 / 接近模型预算文档在无匹配、少量匹配、超过 2000 匹配下的耗时；
- 全部替换 2000 项的 transaction 构建、模型预验证和 dispatch 耗时；
- 快速连续输入只提交最新重算；
- 反复打开/关闭面板、切换 20 次标签后无重复订阅、控制台错误和明显内存持续增长；
- renderer bundle 增量；若明显增加，说明原因。

### 8.9 Windows 手工桌面冒烟

开发模式和生产构建至少分别验证：

- 普通 DOCX 的 Ctrl+F、Ctrl+H、导航、高亮、替换、全部替换、撤销、重做和保存；
- 含不同粗体/颜色/字号 run 的匹配替换格式继承；
- 标题、列表、中文和 emoji；
- read-only 与 degraded；
- 两个 DOCX 和一个 TXT 混合标签切换；
- dirty、saving、外部 Word/WPS 修改冲突与重新读取；
- 重命名、移动、另存为后搜索状态保持；
- 最小窗口、键盘操作和焦点恢复；
- 控制台无未处理异常，工作区无新增临时残留。

## 九、明确不在本任务范围内

- 正则表达式、全字匹配、模糊、拼音、语义或 AI 搜索；
- 跨段落/标题/列表项的多行查询与多行替换；
- 工作区替换、跨文件替换、批量替换或替换预览；
- 在未进入结构化模型的图片、表格、页眉页脚、批注、修订或文本框中查找；
- 直接搜索或修改 OOXML；
- 完整 Word 格式无损替换、域、超链接目标、批注或修订跟踪；
- TXT 当前查找引擎重写或统一为新的自研 matcher；
- 工作区搜索语义、索引、缓存或主进程搜索协议改造；
- 文件系统监听、自动刷新、自动保存和启动恢复；
- 标签拖拽、固定、批量关闭或分屏；
- 未来 UI 优化计划中的设计变量、侧栏缩放、全量图标或截图系统；
- Windows 安装包与正式发布；
- 新文件类型、插件、云同步或 AI/Agent 功能；
- 新增 IPC、preload 或通用 editor/文件系统 API。

## 十、工作包与执行顺序

每次只实施一个工作包。每包结束后必须审查 diff、运行定向测试、完整 `check` 和 `build`，并保留可审计恢复点。当前包门禁失败时不得进入下一包。

### WP0：锁定基线、编辑器事务与资源语义

- 运行并记录 Task 9 完成后的完整质量基线和桌面启动基线；
- 完成第 3.3 节全部最小夹具验证；
- 冻结文本块投影、literal 匹配、UTF-16、marks 继承、单事务全部替换、模型预验证、read-only/degraded/saving 与性能策略；
- 评估但默认不增加依赖；
- 新增 `docs/TASK_010_WP0_REPORT.md`；
- 不向产品 UI 暴露 DOCX 当前查找，不实现 WP1+。

**进入 WP1 门禁：** 基线可重复；所有关键 ProseMirror 行为有实际测试证据；固定语义无未决项；规划与 WP0 报告一致。

### WP1：纯查找、文本块与位置映射

- 新增 renderer 纯模块和类型；
- 完成输入校验、literal/case、非重叠、有界匹配、截断、当前索引与循环导航纯函数；
- 复用 `joinDocxTextBlocks` 完成实时 textblock 投影和 PM 范围映射；
- 覆盖段落、标题、marks、列表、空块、中文、emoji、组合字符、2000/2001 边界；
- 不安装 editor plugin，不接 UI，不 dispatch 文档事务。

**进入 WP2 门禁：** 纯函数测试完整；投影与 Task 8 规则一致；没有第二套正文语义；完整回归通过。

### WP2：ProseMirror 插件、装饰与每标签 controller

- 安装项目自有 current-search plugin/controller；
- 实现每标签状态、订阅快照、重算 generation、DecorationSet、普通/当前匹配样式状态；
- 实现 open/close、query、case、next/previous、selection、scroll、focus；
- editor transaction / external setContent 后安全重算；
- editor destroy 清理；
- 暂不实现替换命令和正式侧栏 UI。

**进入 WP3 门禁：** 查找和导航不修改正文、不 dirty；多 editor 会话隔离；过期重算和销毁安全；性能策略有定向证据。

### WP3：搜索侧栏、快捷键与活动 editor 接入

- 新增 DOCX 当前搜索 React 面板；
- 接入 `DocxEditorSessionHost`、`DocumentPane`、`SearchSidebar` 和 `App`；
- 支持 Ctrl+F、Ctrl+H、Enter、Shift+Enter、F3、Shift+F3、Escape 和按钮；
- TXT 继续使用 CodeMirror 面板，DOCX 使用新面板；
- 完成计数、截断、输入错误、无活动文档、read-only/degraded 禁用原因和焦点恢复；
- 替换按钮可以展示但在 WP4 前不得形成未实现的可用状态。

**进入 WP4 门禁：** DOCX 查找用户流完整；TXT/DOCX 切换无 controls 串线；键盘与可访问性测试通过；TXT 行为无回归。

### WP4：替换当前项、全部替换与模型预验证

- 实现替换输入校验；
- 实现当前匹配实时复验、起点 marks 继承和单次替换；
- 实现最多 2000 项的逆序单 transaction 全部替换；
- dispatch 前对最终 doc 做模型转换与预算校验；
- 接入 dirty、editRevision、undo/redo、operation feedback；
- 2001+、模型失败、过期范围、不可编辑状态全部非破坏性拒绝；
- 不自动保存、不修改主进程协议。

**进入 WP5 门禁：** 替换原子性、格式继承、一次 undo、预算失败 0 修改和既有安全保存入口均有自动测试证据。

### WP5：兼容性、保存中编辑、路径迁移与跨功能回归

- 覆盖 read-only、degraded confirmation revision、saving、save-error、conflict、read-error；
- 覆盖保存期间替换和保存完成后的 dirty 语义；
- 覆盖多标签、关闭、工作区切换、重命名、移动、save-as 与稳定 tabId；
- 覆盖工作区搜索结果定位、mutationEpoch、当前搜索面板共存；
- 修复范围内竞态、悬空 controls、迟到订阅和焦点问题；
- 不新增产品功能或编写完成报告。

**进入 WP6 门禁：** 生命周期矩阵通过；不存在路径身份回退、迟到控制器串线或保存丢编辑；Task 1–9 全量回归通过。

### WP6：性能观察、Windows 冒烟与风险收敛

- 执行第 8.8 节性能和泄漏观察；
- 执行开发/生产构建 Windows 手工冒烟；
- 验证 Word/WPS 外部修改、read-only/degraded、格式继承、混合标签和文件管理迁移；
- 检查控制台、bundle、事件监听、计时器、临时残留与 preload/IPC 暴露面；
- 只修复属于 Task 10 范围且有证据的问题；
- 不提前标记任务完成。

**进入 WP7 门禁：** 自动基线、性能、桌面冒烟和安全边界均有记录；无未解决的数据损坏、部分替换、权限扩大或明显卡顿问题。

### WP7：整体验收、文档与完成报告

- 逐项核对第十一节，不凭推测勾选；
- 运行 typecheck、lint、format、全部 test、完整 `check` 和 `build`；
- 复核开发/生产 Windows 冒烟；
- 更新 README 当前能力、尚未实现、Roadmap、文档与项目结构；
- 更新 `PROJECT_BASELINE.md` 和 `TESTING.md`；
- 新增 `docs/TASK_010_COMPLETION_REPORT.md`；
- 只有全部标准满足时，才把本任务状态改为已完成并勾选第十一节；
- 若仍有阻塞，保持待实施/进行中并明确列出，不以“基本完成”替代验收。

## 十一、最终验收标准

任务开始时以下项目保持未勾选。只有 WP7 根据实际证据逐项核对。

### 11.1 查找与导航

- [x] 活动 DOCX 的 Ctrl+F / Ctrl+H 打开正确侧栏和字段；
- [x] 查找基于实时未保存 ProseMirror 文档，不读取磁盘；
- [x] literal、大小写、非重叠、单行和输入长度规则确定；
- [x] 段落、标题、跨 marks run、列表、中文、emoji 均可匹配；
- [x] 不跨人工文本块换行匹配；
- [x] 上一个/下一个循环导航、计数、选区、滚动和焦点正确；
- [x] 普通/当前匹配装饰可辨识且不修改正文；
- [x] 2000/2001 匹配预算与截断提示正确；
- [x] 查找、导航、关闭面板不 dirty、不进入撤销历史。

### 11.2 替换

- [x] 替换当前项在执行瞬间重新验证实时范围；
- [x] 空、短、长、中文和 emoji 替换正确；
- [x] 跨不同 marks run 时继承匹配起点 marks；
- [x] 段落、标题、列表结构和未匹配格式保持；
- [x] 全部替换按逆序写入一个 transaction；
- [x] 全部替换一次 undo/redo 完整恢复/重做；
- [x] 0 匹配无修改，2001+ 整体拒绝且无部分替换；
- [x] 模型转换或预算失败 0 dispatch、0 dirty；
- [x] 替换成功进入 dirty/editRevision，且不自动保存；
- [x] 保存替换结果继续使用既有 revision、备份和安全替换流程。

### 11.3 兼容性与生命周期

- [x] read-only 可查不可替换；
- [x] degraded 未确认可查不可替换，确认绑定当前 revision 后可替换；
- [x] saving 期间替换不会被旧保存完成结果清除；
- [x] save-error、conflict、read-error 行为确定；
- [x] 多 TXT/DOCX 标签状态、装饰、选择和历史隔离；
- [x] 标签关闭/重开、工作区切换清理完整；
- [x] 重命名、移动、save-as 后稳定 tabId 搜索状态保持；
- [x] 工作区结果定位、mutationEpoch 与当前搜索互不污染；
- [x] 不存在迟到 controls、重复订阅、定时器或 editor 泄漏。

### 11.4 UI、可访问性与安全边界

- [x] TXT 保持 CodeMirror 既有当前搜索行为；
- [x] DOCX 面板的输入、按钮、计数、错误、截断和禁用原因准确；
- [x] 快捷键、焦点进入/恢复、键盘顺序和 screen-reader 名称可用；
- [x] 当前匹配不只依赖颜色，最小窗口控件仍可达；
- [x] 不解析正文 DOM、不使用私有 editor API；
- [x] 不记录查询、替换文本或正文；
- [x] 无新增 IPC、preload、DesktopApi 或文件系统权限；
- [x] 无未经评估的新依赖。

### 11.5 质量、性能与文档

- [x] 纯函数、插件、组件、替换、兼容性、生命周期和回归测试完整；
- [x] 完整 `check` 通过，跳过项均有合理条件与记录；
- [x] `build` 通过；
- [x] 开发和生产 Windows 冒烟通过；
- [x] 典型与上限夹具性能观察无明显不可接受卡顿；
- [x] 无控制台未处理异常、明显泄漏或临时残留；
- [x] README、PROJECT_BASELINE、TESTING 和项目结构已同步；
- [x] `TASK_010_WP0_REPORT.md` 和 `TASK_010_COMPLETION_REPORT.md` 内容完整；
- [x] Task 1 至 Task 9 既有能力无回归。

## 十二、失败处理与决策规则

- ProseMirror 位置无法可靠映射：本次命令不修改，清除旧匹配并重算，不猜测最近同名文本；
- 查询/替换包含换行或超过长度：显示输入错误，不静默裁剪；
- 匹配超过 2000：允许有界导航，禁用全部替换，不部分执行；
- 候选替换模型无效或超预算：整体中止，不 dispatch，不尝试绕过模型验证；
- read-only / degraded 未确认：防御性拒绝替换，不依赖按钮 disabled 作为唯一保护；
- editor 在异步重算前销毁：丢弃结果并释放资源，不写 React 状态；
- 活动标签变化：旧 controls 不得操作新标签；
- saving 期间替换：遵守既有保存中继续编辑语义，不取消或覆盖已有保存；
- 替换后保存冲突：保留本地替换结果，继续使用现有重新读取确认，不自动覆盖磁盘；
- 性能不达标：先测量扫描、映射、装饰、React 订阅各阶段，再选择 debounce 或减少重复重算；不得先引入索引/worker；
- 需要新依赖：先形成书面评估，未经确认不安装；
- TXT 回归：优先恢复既有 CodeMirror 行为，不为统一实现强行重写 TXT；
- 安全与便利冲突：优先模型有效性、兼容性、全部替换原子性、未保存内容和非破坏性失败。

## 十三、真正执行开发时使用的提示词模板

本节提示词不是摘要或示例口号，而是实际执行各工作包时应直接复制给开发 Agent 的完整模板。一次对话只使用一个工作包模板；将 `[当前分支]`、`[上一包提交或恢复点]`、`[已知用户修改]` 替换为实际值。不得把多个工作包合并成一次“大包开发”。

### 13.1 所有工作包共同执行规则

- 开始前完整阅读本任务文档，以及模板中列出的直接相关源码、测试和上一包报告；
- 先报告当前分支、HEAD、工作树、用户已有修改、上一包恢复点、本包范围、明确非目标、预计修改文件、测试和回滚方式；
- 保护用户已有修改，不执行 `git reset --hard`、不 checkout 覆盖、不清理无关文件；
- 只实现当前 WP，不提前实现后续工作包，不做无关重构；
- 文件编辑后先运行定向测试，再运行完整 `npm run check` 和 `npm run build`；
- 每包结束审查 `git diff`、`git status --short`、依赖变化、IPC/preload 暴露面、日志正文泄漏、`.only` / 无条件 `.skip`、事件监听和计时器清理；
- 最终报告实际修改、关键决策、与规划差异、命令结果、手工证据、性能观察、已知限制和是否满足本包门禁；
- 门禁失败即停止，不自行进入下一包；
- 只有 WP7 可以新增完成报告、勾选第十一节并把任务状态改为已完成。

### 13.2 WP0 执行提示词

> 当前任务是执行 `TASK-010` 的 `WP0：锁定基线、编辑器事务与资源语义`。当前分支为 `[当前分支]`，上一恢复点为 `[上一包提交或恢复点；首包写 Task 9 完成提交]`，已知用户修改为 `[已知用户修改]`。先完整阅读 `README.md`、`docs/PROJECT_BASELINE.md`、`docs/DEVELOPMENT_ENVIRONMENT.md`、`docs/TESTING.md`、Task 6/7/8/9 的任务文档与完成报告、`docs/TASK_010_DOCX_FIND_REPLACE.md`，再阅读 `src/shared/docx.ts`、`docx-convert.ts`、`docx-search-text.ts`、`src/renderer/lib/document-tabs.ts`、`use-documents.ts`、`use-editor-sessions.ts`、`EditorSessionHost.tsx`、`DocxEditorSessionHost.tsx`、`DocumentPane.tsx`、`SearchSidebar.tsx`、`App.tsx` 及直接测试。开始时报告分支、HEAD、工作树、Task 9 测试基线、本包非目标、最小夹具、验证清单和预计报告内容。实际运行完整 `check`、`build`，记录测试文件/测试/条件跳过，并完成开发与生产主窗口启动基线。只做技术验证和规划冻结：用最小 Tiptap/ProseMirror 夹具验证实时 textblock 投影与 Task 8 规则、跨 marks run 范围、中文/emoji/组合字符 UTF-16 映射、Decoration、read-only 定位、degraded 权限、saving 期间编辑、起点 marks 继承、空替换、逆序单 transaction 全部替换、一次 undo、dispatch 前 `tiptapJsonToDocxModel` 预算验证、2000/2001 匹配预算和接近上限文档性能。默认不得新增依赖，不接产品 UI，不实现正式 matcher/plugin/controller/replace，不修改最终验收勾选。新增 `docs/TASK_010_WP0_REPORT.md`，记录真实命令、环境、夹具、API 行为、耗时、失败点、冻结决策和是否满足 WP0 门禁；若固定假设不成立，先更新 Task 10 规划并停止。结束前审查 diff，运行完整 `check`/`build`，报告是否满足“基线可重复、关键 ProseMirror 行为有证据、替换与预算语义无未决项”。

### 13.3 WP1 执行提示词

> 当前任务是执行 `TASK-010` 的 `WP1：纯查找、文本块与位置映射`。当前分支为 `[当前分支]`，上一包提交或恢复点为 `[上一包提交或恢复点]`，已知用户修改为 `[已知用户修改]`。先完整阅读 `docs/TASK_010_DOCX_FIND_REPLACE.md`、`docs/TASK_010_WP0_REPORT.md`、`src/shared/docx-search-text.ts`、`src/shared/docx.ts`、`src/main/search/match-text.ts`（只比较语义）、`DocxEditorSessionHost.tsx` 的 Task 8 定位逻辑，以及 docx projection/locate/find-replace 测试。开始时报告 WP0 冻结结论、本包纯模块 API、非目标、预计文件和测试矩阵。只实现 renderer 纯函数：query/replacement 输入校验、literal + caseSensitive、从左到右非重叠有界匹配、2000/2001 截断、当前索引初选、next/previous 循环、内容变化后的最近匹配，以及复用 `joinDocxTextBlocks` 的实时 textblock 投影和 UTF-16 投影范围到 ProseMirror 位置映射。不得安装 ProseMirror plugin、创建 Decoration、接 React UI、注册 controls、dispatch transaction、实现替换或修改 IPC/preload。测试必须覆盖段落、标题、空段落、跨 marks run、项目符号/编号/嵌套列表、中文、emoji、组合字符、人工换行拒绝、重复字符非重叠规则、长度边界和匹配预算。不得复制一套与 Task 8 不一致的 DOCX 正文投影。先跑新增纯测试和现有 projection/locate 测试，再跑完整 `check`、`build`。结束时报告导出 API、复杂度、预算、与 CodeMirror/工作区 matcher 的实测差异、diff 和是否满足 WP1 门禁；不要进入 WP2。

### 13.4 WP2 执行提示词

> 当前任务是执行 `TASK-010` 的 `WP2：ProseMirror 插件、装饰与每标签 controller`。当前分支为 `[当前分支]`，上一包提交或恢复点为 `[上一包提交或恢复点]`，已知用户修改为 `[已知用户修改]`。先阅读 Task 10 文档、WP0 报告、WP1 纯模块与测试、`DocxEditorSessionHost.tsx`、Tiptap editor 创建/销毁和 external setContent 路径、`DocumentPane.tsx` 的常驻 DOCX 宿主、现有 docx editor/locate tests。开始时报告 plugin state、PluginKey、DecorationSet、controller snapshot/subscription、generation 和销毁策略。只实现项目自有 ProseMirror current-search plugin/controller：每稳定 tabId 查询状态、重算调度、普通/当前匹配装饰、open/close、setQuery、setCaseSensitive、next/previous、TextSelection、scroll/focus、transaction/external setContent 后安全重算、active current 选择、订阅和 destroy 清理；可以在测试宿主中注册，但不得接正式 SearchSidebar/App，不实现替换 transaction，不增加依赖/IPC/preload。查找、导航、开关面板不得修改 doc、dirty 或 undo history；异步回调必须有 generation，旧 editor/旧计算不得回报；隐藏非活动 editor 不因其他标签更新而重算。测试覆盖 Decoration 范围/class、循环导航、选区/焦点、read-only、编辑后重算、setContent、快速查询只采用最新结果、多 editor 隔离、销毁无悬空监听。根据 WP0 数据实现最小刷新策略，不提前引入 worker/索引。先跑定向 plugin/editor 测试，再跑完整 `check`、`build`。结束时报告状态转移、调度耗时、资源清理、diff 和 WP2 门禁；不要进入 WP3。

### 13.5 WP3 执行提示词

> 当前任务是执行 `TASK-010` 的 `WP3：搜索侧栏、快捷键与活动 editor 接入`。当前分支为 `[当前分支]`，上一包提交或恢复点为 `[上一包提交或恢复点]`，已知用户修改为 `[已知用户修改]`。先阅读 Task 10 文档、WP0 报告、WP1/WP2 实现与测试，以及 `EditorSessionHost.tsx`、`use-editor-sessions.ts`、`DocxEditorSessionHost.tsx`、`DocumentPane.tsx`、`SearchSidebar.tsx`、`App.tsx`、`app.css`、现有 `find-replace.test.tsx`、`docx-editor.test.tsx` 和 search-sidebar tests。开始时报告 TXT CodeMirror 面板保留策略、DOCX controls 判别、活动 tabId 原子切换、焦点与快捷键方案。只新增 DOCX 当前查找 React 面板并把 WP2 controls 接到 DocxEditorSessionHost/DocumentPane/SearchSidebar/App；支持 Ctrl+F、Ctrl+H、Enter、Shift+Enter、F3、Shift+F3、Escape、按钮、query、case、计数、截断、输入错误、装饰和焦点恢复。TXT 继续使用现有 CodeMirror panel host，不重写 TXT matcher；SearchSidebar 同一时刻只显示活动 kind 的面板。read-only/degraded 必须能查找并显示替换不可用原因；替换字段和按钮在 WP4 完成前不得成为可执行假功能。旧标签 controls 不得操作新标签，不从路径/名称推导 editor 身份。只增加最小样式和可访问性状态，不执行未来 UI 全面优化。新增组件、快捷键、混合 TXT/DOCX、焦点、无活动/加载/read-only/degraded 测试。先跑定向组件测试，再跑完整 `check`、`build`。结束时报告用户流、controls 生命周期、可访问性、TXT 回归、diff 和 WP3 门禁；不要进入 WP4。

### 13.6 WP4 执行提示词

> 当前任务是执行 `TASK-010` 的 `WP4：替换当前项、全部替换与模型预验证`。当前分支为 `[当前分支]`，上一包提交或恢复点为 `[上一包提交或恢复点]`，已知用户修改为 `[已知用户修改]`。先阅读 Task 10 文档、WP0 的 transaction/marks/预算证据、WP1 matcher、WP2 plugin/controller、WP3 UI，以及 `docx-convert.ts`、`docx.ts`、`document-tabs.ts` 的 `editDocxTab`/editRevision、`use-documents.ts`、DocxEditorSessionHost 内容上报和 DOCX undo/save tests。开始时报告替换实时复验、marks 继承、逆序 transaction、模型预验证、dirty/undo 和错误反馈策略。只实现 replacement 输入、replaceCurrent、replaceAll 及 UI 启用：执行瞬间重新投影和校验；匹配完整位于一个 textblock；非空替换继承匹配起点 marks；空替换删除；段落/标题/列表结构保持；全部替换最多 2000 项、从末到前写入同一 transaction；最终 `transaction.doc.toJSON()` 在 dispatch 前经 `tiptapJsonToDocxModel` 和现有预算验证；失败整体 0 dispatch/0 dirty；成功只 dispatch 一次、进入既有 editDocxTab/dirty/editRevision，并可一次 undo/redo。2001+ 禁止全部替换，0 匹配无操作，快速重复点击不可重复应用；不自动保存、不修改 saveDocx/IPC/preload。防御性权限检查必须在 command 内存在，不能只依赖 disabled 按钮。测试覆盖单/跨同 marks/跨不同 marks、起点格式、标题列表、中文 emoji、空/长短替换、位置漂移、模型失败、2000/2001、单事务 undo/redo、operation count。先跑定向替换/编辑器/模型测试，再跑现有 DOCX 保存测试、完整 `check`、`build`。结束时报告 transaction 证据、格式结果、预算失败原子性、diff 和 WP4 门禁；不要进入 WP5。

### 13.7 WP5 执行提示词

> 当前任务是执行 `TASK-010` 的 `WP5：兼容性、保存中编辑、路径迁移与跨功能回归`。当前分支为 `[当前分支]`，上一包提交或恢复点为 `[上一包提交或恢复点]`，已知用户修改为 `[已知用户修改]`。先阅读 Task 10 文档、WP0 报告、WP1 至 WP4 实现和直接测试，重点阅读 `document-tabs.ts` 的兼容性/保存状态转移、`use-documents.ts`、`use-file-management.ts`、`DocumentPane.tsx`、`App.tsx`、workspace search locate/mutationEpoch，以及 Task 9 的 path migration/save-as/lifecycle tests。开始时列出 read-only、degraded revision、loaded/dirty/saving/save-error/conflict/read-error、关闭/工作区切换/路径迁移/搜索定位的完整矩阵。只补齐兼容性和生命周期：read-only 可查不可替换且 command 防御性拒绝；degraded 未确认可查不可替换、确认当前 revision 后不重建 editor 即可替换、revision 变化后旧确认失效；saving 期间替换产生更高 editRevision，旧保存完成后仍 dirty；save-error/conflict/read-error 行为确定；多 TXT/DOCX 标签、关闭重开、工作区切换、重命名、移动、save-as 保留或清理正确；工作区结果定位、mutationEpoch 与当前搜索不串状态；旧 controls、订阅、generation 和焦点回报安全。不得增加搜索类型、工作区替换、文件监听、自动保存或新协议，不编写完成报告。先跑定向生命周期/路径迁移/搜索交互测试，再跑完整 `check`、`build`。结束时报告矩阵证据、竞态修复、stable tabId 证明、保存期间编辑结果、diff 和 WP5 门禁；不要进入 WP6。

### 13.8 WP6 执行提示词

> 当前任务是执行 `TASK-010` 的 `WP6：性能观察、Windows 冒烟与风险收敛`。当前分支为 `[当前分支]`，上一包提交或恢复点为 `[上一包提交或恢复点]`，已知用户修改为 `[已知用户修改]`。先阅读 Task 10 文档、WP0 报告、WP1 至 WP5 全部实现与测试，检查新增 controller/plugin/UI 的订阅、计时器、generation、模型预验证和样式。不得新增产品能力、扩大协议、进行无关重构或编写完成报告；只根据证据修复 Task 10 范围内问题。使用确定性生成夹具观察 100 段、20,000 textblock、接近模型序列化上限、少量匹配、2000/2001 匹配、全部替换 2000 项的扫描/映射/Decoration/transaction/模型验证/dispatch 耗时，记录环境但不把不稳定 wall-clock 写成 CI 硬断言；快速输入、反复开关面板和切换标签验证没有重复订阅、迟到结果、明显内存增长。实际执行 Windows 开发模式和生产构建冒烟，覆盖 Ctrl+F/H、导航、高亮、不同 marks 格式继承、全部替换/撤销/重做/保存、标题列表中文 emoji、read-only/degraded、TXT/DOCX 混合、dirty/saving、Word/WPS 外部冲突、重命名/移动/save-as、最小窗口和键盘焦点。审查 bundle 增量、console、IPC/preload 集合、日志正文泄漏、临时残留、`.only`/无条件 `.skip`。运行定向测试、完整 `check`、`build`。结束时报告命令、应用模式、硬件/夹具、性能数据、手工证据、修复、剩余风险和是否满足 WP6 门禁；不要进入 WP7。

### 13.9 WP7 执行提示词

> 当前任务是执行 `TASK-010` 的 `WP7：整体验收、文档与完成报告`。当前分支为 `[当前分支]`，上一包提交或恢复点为 `[上一包提交或恢复点]`，已知用户修改为 `[已知用户修改]`。先完整阅读 `docs/TASK_010_DOCX_FIND_REPLACE.md`、`docs/TASK_010_WP0_REPORT.md`、WP1 至 WP6 提交/恢复点、全部新增源码测试，以及 README、PROJECT_BASELINE、TESTING 和 Task 9 完成报告。不要新增产品功能；只修复验收发现且属于 Task 10 范围的问题。逐项核对第十一节，每个勾选必须有自动测试、代码审查、性能记录或手工冒烟证据，不得凭推测。实际运行 typecheck、lint、format check、全部 test、完整 `check`、`build`，记录测试文件数、通过数、失败数、条件跳过及原因；执行最终开发/生产 Windows 冒烟。审查 literal/UTF-16/2000 预算、Decoration 不改正文、实时复验、起点 marks、单事务 replace-all、模型预验证、read-only/degraded/saving、stable tabId、旧 controls/订阅清理、TXT/工作区搜索回归、IPC/preload 未扩大、日志无正文、无 `.only`/无条件 `.skip`。更新 README 当前能力/尚未实现/Roadmap/文档/项目结构、PROJECT_BASELINE、TESTING；新增 `docs/TASK_010_COMPLETION_REPORT.md`，记录实现摘要、关键文件、固定语义、搜索/位置映射、插件/controller/UI、替换事务/格式继承/预算原子性、兼容性/生命周期、安全边界、测试、性能、Windows 证据和限制。只有全部验收真实满足时，才把本任务状态改为已完成并将第十一节改为 `[x]`；否则保持待实施/进行中并列出阻塞。结束时给出最终 diff、命令证据、未解决问题和是否满足 Task 10 全部标准。

## 十四、交付物

Task 10 完成时应交付：

1. DOCX 当前文档 literal 搜索、输入校验、预算和位置映射纯模块；
2. ProseMirror current-search plugin、PluginKey、DecorationSet 与每标签 controller；
3. 窄 controls、稳定订阅、generation 与销毁清理；
4. DOCX 当前查找替换 React 面板与快捷键；
5. TXT CodeMirror / DOCX ProseMirror 共用侧栏入口的 kind 分流；
6. 替换当前项、起点 marks 继承与模型预验证；
7. 最多 2000 项、逆序、单 transaction、可一次撤销的全部替换；
8. read-only、degraded、saving、冲突与外部重读生命周期；
9. stable tabId 下多标签、重命名、移动、save-as 会话保持；
10. 纯函数、插件、组件、替换、兼容性、生命周期、性能和回归测试；
11. `docs/TASK_010_WP0_REPORT.md`；
12. 更新后的 README、PROJECT_BASELINE、TESTING 和项目结构；
13. `docs/TASK_010_COMPLETION_REPORT.md`，至少记录：
    - 实现摘要和关键文件；
    - literal、case、单行、非重叠和 2000 项预算；
    - 实时 ProseMirror 投影、UTF-16 和 textblock/PM 映射；
    - plugin、Decoration、controller、controls 和 sidebar；
    - 替换实时复验、起点 marks、逆序单事务与模型预验证；
    - read-only、degraded、saving、dirty、冲突和路径迁移；
    - TXT/工作区搜索回归与 IPC/preload 安全边界；
    - 自动测试、性能观察和 Windows 开发/生产冒烟；
    - 已知限制及是否满足全部验收标准。

## 十五、完成后的下一任务入口

Task 10 完成后，再根据实际使用反馈比较以下候选，单独规划下一任务：

- 文件系统监听、外部变化提示与安全自动刷新；
- 基础设置、主题与启动/会话恢复；
- 标签拖拽、固定、批量关闭与状态恢复；
- 未来 UI 优化计划中的 UI-1 设计基线与组件状态；
- Windows 安装包、签名与正式发布流程。

建议优先比较“文件系统监听与外部变化提示”和“UI-1 设计基线”。Task 10 不应顺带实现上述任何能力。
