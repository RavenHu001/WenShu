# TASK-009：基础文件管理闭环

## 任务状态

> **状态：已完成（2026-08-16）。**
>
> 优先级：`P0`。执行必须从 WP0 开始，逐包完成、逐包验收；只有 WP8 可以新增完成报告、勾选最终验收项并把本文件状态改为“已完成”。
>
> WP0 至 WP8 已全部完成并逐包验收（见 [TASK-009 完成报告](./TASK_009_COMPLETION_REPORT.md) 与 [WP0 报告](./TASK_009_WP0_REPORT.md)）；第十一节全部验收项已逐项核对并勾选；任务第九节手工界面清单由项目所有者执行并通过（用户确认“手动功能测试已通过”）。完整 `check`（54 测试文件 / 1016 通过 / 10 条件跳过）与 `build` 依次通过（退出码 0）。
>
> 本任务建立在 Task 2 的只读工作区树、Task 4/5 的 TXT 安全保存与多标签、Task 7 的 DOCX 结构化编辑和安全保存、Task 8 的混合工作区搜索与结果定位之上。Task 1 至 Task 8 的既有行为均为回归基线。

## 一、任务目的

补齐当前项目核心成功标准中尚未闭环的“用户可以通过文件树管理文件”，在不把 renderer 变成通用文件系统客户端、不削弱已有数据安全能力的前提下，实现当前工作区内的基础文件管理：

1. 新建空 TXT；
2. 新建有效基础 DOCX；
3. 新建文件夹；
4. TXT / DOCX 另存为；
5. 普通文件与文件夹重命名；
6. 普通文件与文件夹在当前工作区内移动；
7. 删除到 Windows 回收站；
8. 在 Windows 文件资源管理器中显示条目；
9. 在上述路径变化后安全迁移标签、编辑器会话、dirty/saving 状态与选中状态；
10. 让旧搜索结果和在途定位按确定规则失效，不保留指向旧路径的可点击结果。

本任务不是完整文件资源管理器，不实现复制粘贴、批量操作、拖拽、永久删除或跨工作区文件操作。所有写入和路径变化都必须绑定主进程持有的当前工作区，由固定窄 IPC、严格请求校验、源/目标双重路径校验和可恢复失败策略完成。

## 二、完成后的用户体验

Task 9 完成后，用户应能：

- 在工作区根或选中文件夹内新建 TXT、基础 DOCX 和文件夹；
- 新建成功后立即在文件树中看到条目；新建 TXT / DOCX 自动打开为唯一、干净标签；
- 对当前可写 TXT / DOCX 执行“另存为”，选择当前工作区内的目标文件夹并输入文件名；
- 目标不存在时安全创建；目标存在时先看到明确覆盖确认，确认仍绑定同一目标版本时才覆盖；
- 另存为成功后让当前标签迁移到新路径并保持编辑器会话，源文件留在原位置；
- 重命名文件或文件夹，包括 Windows 下只改变大小写的重命名；
- 把文件或文件夹移动到当前工作区内的其他普通目录，但不能移动到自身或自身后代；
- 重命名或移动已打开文档时保留标签顺序、活动状态、dirty、正文/模型、光标、选区、滚动、撤销/重做历史与查找状态；
- 重命名或移动目录时，一次迁移其下全部已打开标签的相对路径；
- 删除前看到包含路径、类型和受影响未保存标签数量的确认；存在 saving 标签时先等待，不能让在途保存写回已删除或旧路径；
- 删除成功后从文件树移除条目，关闭受影响标签，并可通过 Windows 回收站恢复；
- 对普通文件或文件夹执行“在资源管理器中显示”；
- 在冲突、权限不足、外部修改、路径失效、部分失败或刷新失败时得到稳定错误，现有编辑内容不丢失；
- 任一成功写操作后旧工作区搜索结果立即失效，不能继续定位旧路径。

## 三、执行前置检查

### 3.1 必读材料

实施前必须阅读并核对：

- `README.md`；
- `docs/PROJECT_BASELINE.md`；
- `docs/DEVELOPMENT_ENVIRONMENT.md`；
- `docs/TESTING.md`；
- `docs/TASK_004_TXT_EDIT_SAFE_SAVE.md` 与完成报告；
- `docs/TASK_005_MULTI_TXT_TABS.md` 与完成报告；
- `docs/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md` 与完成报告；
- `docs/TASK_008_DOCX_WORKSPACE_SEARCH.md` 与完成报告；
- `src/shared/workspace.ts`；
- `src/shared/desktop-api.ts`；
- `src/shared/document.ts`；
- `src/shared/docx.ts`；
- `src/main/workspace/scan-workspace.ts`；
- `src/main/workspace/workspace-ipc.ts`；
- `src/main/workspace/workspace-session.ts`；
- `src/main/document/path-validation.ts`；
- `src/main/document/write-safety.ts`；
- `src/main/document/save-text-document.ts`；
- `src/main/docx/export-docx.ts`；
- `src/main/docx/save-docx-document.ts`；
- `src/renderer/lib/document-tabs.ts`；
- `src/renderer/lib/use-documents.ts`；
- `src/renderer/lib/use-editor-sessions.ts`；
- `src/renderer/lib/use-workspace.ts`；
- `src/renderer/lib/use-workspace-search.ts`；
- `src/renderer/components/workspace/WorkspaceSidebar.tsx`；
- `src/renderer/components/workspace/FileTree.tsx`；
- `src/renderer/components/workspace/FileTreeNode.tsx`；
- `src/renderer/components/document/DocumentPane.tsx`；
- `src/renderer/App.tsx`。

### 3.2 工作树与质量基线

WP0 开始时必须：

1. 检查当前分支与 `git status --short`，保护用户已有修改；
2. 确认 Task 8 已合并且完成报告存在；
3. 运行完整 `npm run check`；
4. 运行 `npm run build`；
5. 记录测试文件数、通过数、条件跳过数与每个跳过原因；
6. 分别启动开发模式和生产构建到主窗口；
7. 冒烟确认工作区打开/刷新、TXT/DOCX 打开编辑保存、多标签会话、未保存保护、工作区搜索与结果定位无回归。

规划时于 2026-08-16 实际观察到：工作树干净；`check` 通过，38 个测试文件通过，835 项测试通过、6 项按环境条件跳过；`build` 通过。该记录只用于规划参考，不能替代 WP0 在实际开发分支上的重新执行。

基线失败时必须先归因。不得把既有失败混入 Task 9，不得删除测试、扩大超时、关闭严格检查或无条件跳过来制造通过。

### 3.3 WP0 必须完成的技术验证

任何产品写能力落地前，WP0 必须以最小夹具验证并记录：

- Windows 文件名保留字、非法字符、尾随点/空格、控制字符、大小写冲突和只改大小写重命名的实际行为；
- 源条目存在而目标叶节点不存在时，如何在不跟随 symlink/junction 的前提下校验目标父目录；
- `rename` 对同卷文件、目录、非空目录、跨父目录移动和只改大小写路径的行为；
- Electron `shell.trashItem` 对普通文件、非空目录、权限失败和不存在目标的行为，以及测试环境的可注入边界；
- Electron `shell.showItemInFolder` 对文件与目录的行为，且不会开放通用 shell 调用；
- TXT 另存为如何复用 BOM、换行、revision 与安全替换语义；
- DOCX 空白规范模型能生成、验证、重新导入为有效基础 DOCX；
- DOCX 另存为如何复用导出、产物验证、兼容性确认与目标备份语义；
- 当前 `tab.id === relativePath` 对 CodeMirror 会话、DOCX 常驻编辑器、React key 和异步保存身份的实际影响；
- 稳定 `tabId` 与可变 `relativePath` 解耦后，TXT/DOCX 的选择、滚动、撤销历史、查找面板和工具栏实例能够保持；
- 目录路径迁移可线性更新后代标签，不用扫描编辑器 DOM；
- 文件操作成功后，活动搜索取消、完成结果清空和迟到定位拒绝能够共享确定的 mutation epoch。

若任一结论与本规划冲突，必须先更新固定决策、测试方案与风险记录，再进入 WP1。

## 四、固定产品与协议决策

### 4.1 仅管理当前工作区

- 新建、另存为、重命名、移动、删除和显示都只作用于主进程 `workspace-session` 持有的当前工作区；
- renderer 请求不得携带工作区根、绝对路径、盘符、UNC 路径、`file://` URI、临时路径或 shell 参数；
- 新建和另存为目标只能位于当前工作区；本任务不弹出允许越过工作区边界的通用 Save As 对话框；
- 移动只允许当前工作区内的同工作区移动，不允许跨工作区、跨盘或移动工作区根；
- 工作区根可以作为“新建目标父目录”和“在资源管理器中显示”的目标，但不能被重命名、移动或删除；
- 符号链接、junction、其他重解析点和 `other` 条目只展示，不允许通过本任务的管理命令操作；
- `.wenshu.bak` 和 `.wenshu-*` 内部恢复/临时文件不在文件树中暴露，也不能由 renderer 直接指定为管理目标。

### 4.2 固定操作集合，不提供通用文件系统命令

允许的跨进程能力固定为：

- `workspace.createText`；
- `workspace.createDocx`；
- `workspace.createDirectory`；
- `workspace.relocate`，只表达工作区内重命名/移动；
- `workspace.trash`；
- `workspace.reveal`；
- `document.saveTextAs`；
- `document.saveDocxAs`。

不得提供以下能力：

- 任意 `fs` 方法名或通用 `execute(operation, args)`；
- renderer 可指定的 IPC 通道；
- 任意绝对源/目标路径；
- 任意 shell 命令、可执行程序、参数列表或 URL；
- `force`、`recursiveDelete`、`skipValidation`、`skipBackup`、`allowOutsideWorkspace` 等危险开关；
- renderer 可调的权限、并发、超时、路径策略或临时文件策略。

所有请求使用精确对象形状和运行时校验；多余字段、错误类型和未知判别值一律拒绝。

### 4.3 名称、相对路径与目标父目录

目标由 `parentRelativePath + name` 表达：

- 工作区根父目录使用空字符串 `''`；
- 非根父目录使用 `/` 分隔的规范相对路径；
- `name` 只能是单个叶节点名称，不能包含 `/`、`\`、NUL、控制字符或路径段；
- 不接受空名称、`.`、`..`、尾随点、尾随空格；
- 拒绝 Windows 文件名非法字符 `< > : " / \ | ? *`；
- 拒绝不区分大小写的保留设备名 `CON`、`PRN`、`AUX`、`NUL`、`COM1` 至 `COM9`、`LPT1` 至 `LPT9`，包含扩展名时也拒绝；
- 不静默裁剪、替换、Unicode 归一化或自动添加数字后缀；非法名称和冲突由用户明确修正；
- TXT 新建/另存为要求最终名称为普通 `.txt`；DOCX 要求普通 `.docx`，大小写不敏感；
- 对已打开 TXT/DOCX 的重命名不得跨类型改变为另一种受支持类型或不受支持类型；本任务不把改扩展名当格式转换；
- 主进程必须分别验证源路径、目标父目录和目标叶节点；已有的 `resolveWorkspaceTarget` 只适合“最终段必须是普通文件”，不能直接假装支持不存在目标或目录目标；
- 目标父目录从工作区根逐段 `lstat`，拒绝任一 symlink/junction，中间和最终父段必须为普通目录；随后执行 realpath 边界检查；
- 源文件/目录同样逐段校验，类型必须与操作允许范围一致；
- 文件系统是最终冲突权威。renderer 的工作区快照只能用于界面，不替代主进程操作时校验。

### 4.4 工作区 epoch、mutationId 与串行化

- renderer 为每次文件操作分配单调递增 `mutationId`，只用于界面迟到结果校验，不作为权限凭据；
- 主进程按窗口维护当前工作区内的写操作队列，同一窗口同一时刻最多一个文件管理写操作；
- 另存为继续服从目标标签的 `saveInFlight`，同一标签不能并发普通保存与另存为；
- 请求开始时捕获工作区身份；提交前必须确认主进程当前根未变化、窗口仍有效、请求未被新状态作废；
- renderer 只提交同时满足“组件仍挂载、mutationId 当前、工作区 epoch 未变、目标标签仍存在且身份一致”的结果；
- 用户不能靠重复点击制造并发重命名、双删除、双创建或旧操作覆盖新状态；
- 文件系统操作成功但后续扫描失败时，不得谎报“未执行”。返回“操作已完成但刷新失败”的稳定结果，并强制提供可重试刷新入口。

### 4.5 稳定标签身份与路径唯一性

Task 9 必须先解除 `tab.id === relativePath` 的耦合：

- `tabId` 是 renderer 会话内稳定、不可由路径推导的身份；
- `relativePath`、`name` 和磁盘文档快照路径是可迁移属性；
- TXT/DOCX 运行时 Map、CodeMirror 会话缓存、DOCX editor Map、React key、活动标签和异步请求都以稳定 `tabId` 为键；
- 打开去重仍按当前规范相对路径进行，不能因为稳定 `tabId` 而允许同一路径多个标签；
- Windows 路径比较必须覆盖大小写不敏感和只改大小写重命名；主进程文件系统判断为最终权威；
- 路径迁移不得改变标签顺序、活动标签、dirty、saving、正文/模型、编辑 revision、读取请求身份或保存请求身份；
- TXT 必须保留 CodeMirror `EditorState`、选区、滚动、撤销历史、查找面板与查询；
- DOCX 必须保留 Tiptap/ProseMirror 实例、选区、滚动、撤销历史和工具栏绑定；
- 目录迁移对全部后代标签执行前缀边界匹配，`a/b` 不能错误命中 `a/b2`；
- 路径迁移后保存必须写入新路径；任何迁移前捕获、迁移后才完成的旧保存不得写回旧路径。

为避免最后一项产生数据分叉，存在受影响 saving 标签时重命名、移动和删除必须被阻止，提示等待保存完成。dirty 但未 saving 的标签允许重命名/移动，并保留未保存编辑。

### 4.6 新建语义

- 新建 TXT 以排他方式创建 0 字节普通文件；它是合法无 BOM UTF-8 空文档，首次读取采用现有 TXT 语义；
- 新建 DOCX 使用版本正确的空白 `DocxDocumentModel`（至少一个空段落），调用现有导出器生成字节，执行大小、ZIP/OOXML 和重新导入验证后再排他写入；不得用 0 字节占位冒充新建完成；
- 新建文件夹只创建单级目标，不隐式递归创建缺失父目录；
- 三类新建均不覆盖现有条目、不自动改名；冲突返回 `TARGET_EXISTS`；
- 写文件必须采用目标同目录排他临时文件、完整写入、`sync`、关闭、验证和不覆盖发布，失败尽力清理临时文件；
- 新建成功后返回规范相对路径和条目类型；工作区 controller 重新扫描；
- 新建 TXT/DOCX 在刷新成功后通过通用 `openFile` 打开唯一干净标签；新建文件夹保持选中并展开其父目录；
- UI 不能在磁盘成功前创建可编辑的“幽灵标签”。本任务不引入 untitled 内存文档。

### 4.7 另存为与覆盖确认

- TXT 与 DOCX 使用各自固定另存为请求和主进程实现，不用复制原文件字节的通用接口；
- 另存为只允许当前已稳定加载、可保存的标签；loading、read-error、saving、save-error 的在途阶段不得发起；
- TXT 使用当前最新正文，并复用 BOM、换行和混合换行确认规则；
- DOCX 使用当前最新合法模型，复用兼容性确认、导出和产物验证；`read-only` DOCX 不允许通过本任务另存为，字节级“另存副本”不在范围内；
- degraded DOCX 的确认仍绑定当前基线 revision，另存为不能绕过确认；
- 目标不存在时执行排他安全创建；目标存在时第一次调用只返回 `TARGET_EXISTS` 与受控目标 revision，不写文件；
- 用户确认覆盖后的第二次请求必须携带 `expectedTargetRevision`，主进程在发布前再次读取并比较；目标变化时返回 `CONFLICT`，必须重新确认；
- 不接受简单 `overwrite: true` 或 `force: true`；
- 覆盖 TXT 使用与现有 TXT 保存一致的临时写入和安全替换；
- 覆盖 DOCX 在替换目标前为目标创建/刷新 `<目标文件名>.wenshu.bak`，备份内容必须是目标替换前原字节；备份失败则目标不变；
- 新目标不存在时不创建无意义备份；
- 另存为成功后源文件保持不变，当前标签原地迁移到目标路径并成为目标文档会话；
- 若目标路径已经由另一个标签打开，renderer 在请求前拒绝；主进程仍独立校验磁盘冲突。不得合并两个标签状态；
- 保存期间继续编辑的既有规则继续适用：若捕获内容保存成功后又发生编辑，标签迁移到目标路径但仍保持 dirty，后续保存写目标路径。

### 4.8 重命名与移动

重命名和移动统一为受控 `relocate` 语义：

- 请求包含源规范相对路径、目标父目录和目标名称，不包含绝对路径；
- 源可以是普通文件或普通目录，但不能是工作区根、symlink/junction、`other` 或内部恢复文件；
- 目标父目录必须存在且为普通目录；
- 目录不能移动到自身或任一后代；
- 目标存在时一律返回 `TARGET_EXISTS`，不覆盖文件、不替换目录、不合并目录；覆盖只属于 TXT/DOCX 另存为的显式流程；
- 同一实际路径且名称完全相同时为安全无操作；
- Windows 只改大小写重命名必须通过不可预测、同目录、排他的中间名称实现，并在任一步失败时尝试回滚；
- 普通同卷移动使用文件系统原子 `rename` 能力，不先复制再删除；
- 操作发布前再次校验源仍是预期类型、目标仍不存在、工作区根未改变；
- 对打开文件或含打开后代的目录，renderer 在主进程成功后一次提交路径迁移；主进程失败则标签路径不变；
- 迁移后更新选中路径、展开路径和待处理对话框目标；旧搜索结果与定位目标不做路径猜测迁移，直接失效；
- 已有 DOCX 旁的 `.wenshu.bak` 视为伴随恢复文件。单 DOCX 重命名/移动时，如备份存在，应迁移到新 DOCX 对应备份路径；目标备份已存在则操作前冲突；伴随迁移失败时必须尝试回滚主文件并返回稳定错误；
- 目录重命名/移动自然携带目录内备份，不单独枚举或暴露它们；
- 若回滚也失败，返回 `PARTIAL_FAILURE`，强制刷新并保留可诊断但不包含绝对路径/正文的错误信息；完成报告必须记录真实恢复结果。

### 4.9 删除到回收站

- 删除统一使用 Electron `shell.trashItem` 或经 WP0 验证的等价 Windows 回收站 API；不得使用 `unlink`、`rm`、`rmdir` 实现用户删除；
- renderer 在调用前显示明确确认，包含相对路径、文件/文件夹类型和受影响 dirty 标签数；
- 存在受影响 saving 标签时拒绝删除，不显示可继续的“强制删除”；
- dirty 标签只有用户明确确认放弃修改后才能删除；取消不得调用删除 IPC；
- 删除普通文件成功后关闭对应标签；删除目录成功后关闭全部后代标签；
- 主进程成功前不得提前关闭标签或从快照乐观移除条目；
- 删除根、symlink/junction、`other`、内部恢复文件或工作区外路径一律拒绝；
- 单 DOCX 删除时，主文件和存在的 `.wenshu.bak` 都送入回收站，不永久删除；目录删除自然包含目录内备份；
- 回收站 API 无法保证多条目事务。主文件与伴随备份出现部分成功时返回 `PARTIAL_FAILURE`，立即刷新；不得把已进入回收站的主文件写回原位置冒充回滚；
- 本任务不实现应用内“撤销删除”或回收站浏览，界面应明确提示可在 Windows 回收站恢复。

### 4.10 在资源管理器中显示

- `reveal` 只接受当前工作区规范相对路径，或显式的工作区根判别值；
- 主进程重新执行路径、边界、类型和链接校验后调用固定的 `shell.showItemInFolder`；
- 不暴露 `shell.openExternal`、`shell.openPath`、任意 URL 或任意命令；
- 条目不存在、已移动、链接或工作区切换时返回稳定错误，不猜测最近路径；
- reveal 不修改文件树、标签、dirty 或搜索状态。

### 4.11 工作区快照、选择和搜索失效

- 所有成功创建、另存为、重命名、移动和删除都触发工作区重新扫描；
- 工作区 controller 增加单调递增的 `mutationEpoch` 或等价身份，只在磁盘操作确认成功后递增；
- mutationEpoch 变化时立即取消活动搜索、清空 completed/cancelled/error 结果、清除定位目标和过期提示；
- 迟到搜索结果必须同时校验搜索 requestId、工作区 epoch 和 mutationEpoch；
- 不尝试把旧结果字符串替换为新路径，因为文件内容、revision、目录范围和目标身份可能同时变化；
- reveal 不递增 mutationEpoch；失败或用户取消的写操作不递增；
- 扫描成功后选择迁移到新路径；删除后选择最近仍存在的父目录或清空；
- 文件树的操作选择与活动文档路径分离。目录和不支持编辑的普通文件也可以被选中用于文件管理，但只有普通 TXT/DOCX 可打开编辑；
- 展开状态应由规范目录路径集合集中持有，路径迁移时按边界迁移，避免递归组件局部 state 因 key 变化全部丢失；
- 外部手工刷新若替换了工作区快照，也应作废当前搜索结果；本任务不加入自动文件系统监听。

### 4.12 UI 与可访问性

- 工作区侧栏增加新建 TXT、新建 DOCX、新建文件夹的可访问入口；
- 文件/目录行具有独立选择状态；单击选择与打开行为必须明确，不能让增加目录选择后破坏现有键盘打开 TXT/DOCX；
- 重命名、移动、删除、资源管理器显示可使用行操作菜单或选中项工具栏，但必须支持键盘访问、焦点恢复和可辨识标签；
- 新建/重命名使用受控输入，不以 `contentEditable` 拼接 HTML；
- 移动和另存为使用当前工作区目录选择器，只返回相对目录和叶名称；
- 覆盖、删除、dirty 放弃和 saving 阻止使用明确对话框；不同风险不能复用含糊的“确定吗”；
- 操作中禁用同一目标的重复提交，并显示正在创建/另存为/移动/删除等状态；
- 错误消息展示稳定产品文案，不直接显示 Node.js 原始异常、绝对路径、临时文件名或调用栈；
- 操作成功后焦点回到新/迁移条目或活动编辑器；取消后回到原触发控件；
- 不使用 `dangerouslySetInnerHTML`，不从展示文案反解析路径、类型或确认身份。

### 4.13 依赖与状态管理

- 预计不新增生产依赖；
- 复用 Node.js `fs/promises`、Electron `shell`、现有 TXT/DOCX 保存器、DOCX 导出验证器、React controller 和确认对话框；
- 不引入 Redux、Zustand、数据库、文件索引、通用命令框架、文件管理组件库或额外原生二进制；
- 若确需新增依赖，必须在对应工作包开始前记录版本、用途、许可证、包体积、安全面和现有能力不足的证据。

## 五、共享契约、状态模型与不变量

### 5.1 建议的共享结果模型

建议新增 `src/shared/file-management.ts`，使用明确的 discriminated union：

```ts
type ManagedEntryKind = 'text' | 'docx' | 'directory' | 'file';

interface WorkspaceTargetName {
  readonly parentRelativePath: string; // 根目录为 ''
  readonly name: string;
}

interface RelocateWorkspaceEntryRequest extends WorkspaceTargetName {
  readonly mutationId: number;
  readonly sourceRelativePath: string;
}

type WorkspaceMutationResult =
  | {
      readonly status: 'succeeded';
      readonly mutationId: number;
      readonly relativePath: string;
      readonly kind: ManagedEntryKind;
    }
  | {
      readonly status: 'succeeded-refresh-failed';
      readonly mutationId: number;
      readonly relativePath: string;
      readonly kind: ManagedEntryKind;
      readonly error: FileManagementError;
    }
  | {
      readonly status: 'error';
      readonly mutationId: number;
      readonly error: FileManagementError;
    };
```

实际实现可按职责拆分更窄的请求/结果，但必须保持：

- mutationId 原样回传；
- 成功路径只返回规范相对路径，不返回绝对路径；
- 错误是稳定 code/message，不跨 IPC 传 `Error`、`Stats`、句柄或调用栈；
- `PARTIAL_FAILURE` 与普通失败可区分；
- 保存为结果携带新的文档快照/revision，供标签原地迁移；
- 运行时校验拒绝多余字段。

### 5.2 稳定错误码

至少需要冻结并测试：

- `NO_WORKSPACE`；
- `INVALID_REQUEST`；
- `INVALID_PATH`；
- `INVALID_NAME`；
- `OUTSIDE_WORKSPACE`；
- `NOT_FOUND`；
- `NOT_FILE`；
- `NOT_DIRECTORY`；
- `LINK_NOT_ALLOWED`；
- `ROOT_OPERATION_NOT_ALLOWED`；
- `TARGET_EXISTS`；
- `TARGET_CHANGED` / `CONFLICT`；
- `TARGET_OPEN`（renderer 产品状态，可不由主进程信任）；
- `DIRECTORY_INTO_DESCENDANT`；
- `TYPE_CHANGE_NOT_ALLOWED`；
- `COMPATIBILITY_CONFIRMATION_REQUIRED`；
- `BACKUP_FAILED`；
- `VERIFICATION_FAILED`；
- `ACCESS_DENIED`；
- `WRITE_FAILED`；
- `TRASH_FAILED`；
- `REVEAL_FAILED`；
- `PARTIAL_FAILURE`。

相同原因在 create、save-as、relocate、trash 和 reveal 中应尽量复用同一 code/message，不能依赖英文系统异常文案判断流程。

### 5.3 文件操作 UI 状态

renderer controller 至少区分：

- `idle`；
- `editing-input`：输入新建/重命名名称；
- `choosing-target`：移动/另存为选择目录；
- `confirming-overwrite`；
- `confirming-trash`；
- `running`：绑定唯一 mutationId；
- `succeeded`：短暂反馈后回 idle；
- `error`：保留输入与稳定错误，可修改后重试或取消；
- `partial-failure`：禁止假定原路径或目标路径，先刷新再允许下一写操作。

### 5.4 必须保持的不变量

1. 主进程工作区根是全部文件操作的唯一根来源；
2. renderer 永远不能提交绝对源/目标路径；
3. 同一窗口同一时刻最多一个文件管理写操作；
4. 同一标签不能并发普通保存与另存为；
5. 存在受影响 saving 标签时不能重命名、移动或删除；
6. 同一规范路径最多一个打开标签；
7. 稳定 tabId 不因重命名、移动或另存为改变；
8. 路径迁移不丢失 dirty、内容、编辑 revision、编辑器状态或标签顺序；
9. 主进程失败时 renderer 不提前迁移路径、关闭标签或修改工作区快照；
10. 目标冲突不自动覆盖、不自动改名；
11. 覆盖确认必须绑定目标 revision，目标变化必须重新确认；
12. DOCX 新建/另存为产物必须通过验证；
13. DOCX 覆盖前备份失败则目标不变；
14. 删除只进入回收站，不执行永久删除；
15. 目录不能移动到自身或后代；
16. 任何路径段都不跟随 symlink/junction；
17. 成功 mutation 必须使搜索结果与定位目标失效；
18. 失败、取消和 reveal 不改变 mutationEpoch；
19. IPC 和日志不泄漏正文、模型、绝对路径、临时名或原始异常；
20. 临时文件必须排他、不可预测、与目标同目录并在失败时尽力清理。

### 5.5 异步提交条件

文件操作结果提交前必须同时满足：

- controller 仍挂载；
- mutationId 仍为当前运行操作；
- 工作区 epoch 与发起时一致；
- 主进程当前根未切换；
- 涉及标签时，稳定 tabId 仍存在；
- 标签当前路径仍与发起操作的源路径一致；
- 操作类型、源 kind 和目标 kind 与当前状态一致；
- 未被用户取消的纯 UI 阶段或新操作取代。

另存为结果还必须校验：

- 保存请求仍属于同一稳定 tabId；
- 捕获的 editRevision 与当前 editRevision 决定 dirty 是否清除；
- 目标路径没有被另一标签占用；
- 返回 document/model/revision 通过共享契约校验。

路径迁移提交必须是一次模型转移：不能先改 tab path、下一帧再改 runtime/search/selection，使中间状态被快捷键或保存观察到。

## 六、模块与文件职责建议

### 6.1 共享文件管理契约

建议新增 `src/shared/file-management.ts`：

- 名称、目标、创建、relocate、trash、reveal 和 save-as 请求/结果；
- 稳定错误码和产品文案；
- 纯运行时校验器；
- 路径前缀迁移所需的纯数据类型；
- 不依赖 Electron、Node.js、React 或浏览器 API。

### 6.2 主进程源/目标路径安全

建议扩展 `src/main/document/path-validation.ts` 或新增职责明确的 `src/main/workspace/resolve-workspace-entry.ts`：

- `resolveExistingWorkspaceFile`；
- `resolveExistingWorkspaceDirectory`；
- `resolveWorkspaceParentDirectory`，允许根父目录 `''`；
- `validateWindowsLeafName`；
- `resolveNonExistingWorkspaceTarget`；
- `isSameOrDescendantPath`；
- case-only rename 检测；
- 内部恢复/临时名称拒绝。

不要削弱现有 TXT/DOCX 读取保存校验，也不要把“最终段必须存在”的 helper 改成含糊的可选行为。

### 6.3 主进程文件管理服务

建议新增：

- `src/main/workspace/create-workspace-entry.ts`；
- `src/main/workspace/relocate-workspace-entry.ts`；
- `src/main/workspace/trash-workspace-entry.ts`；
- `src/main/workspace/reveal-workspace-entry.ts`；
- 必要时新增小型 mutation coordinator，按窗口串行写操作。

每个模块接受可注入适配器，以便确定性测试权限失败、冲突、case-only 中间步骤、伴随备份失败、trash 失败和回滚失败。不得为了测试暴露生产后门。

### 6.4 TXT / DOCX 另存为

建议分别新增：

- `src/main/document/save-text-document-as.ts`；
- `src/main/docx/save-docx-document-as.ts`。

可以提取现有保存器中真正共享的安全写入小函数，但不得把 TXT/DOCX 合并成失去类型、兼容性和备份语义的通用 blob 写入 API。

### 6.5 IPC、preload 与 DesktopApi

建议：

- 扩展 `src/main/workspace/workspace-ipc.ts` 或新增 `file-management-ipc.ts` 注册固定通道；
- 在 `src/main/index.ts` 显式注册；
- 扩展 `src/shared/desktop-api.ts` 的窄方法；
- 在 `src/preload/index.ts` 一对一映射固定方法；
- IPC 层先运行时校验，再读取主进程当前根，再调用具体服务；
- 所有 handler 绑定发送窗口，不创建全局通用文件系统路由。

### 6.6 稳定标签与路径迁移

扩展 `src/renderer/lib/document-tabs.ts` 和 `use-documents.ts`：

- 新标签生成稳定 tabId；
- 打开去重从 `id === relativePath` 改为独立路径查找；
- 新增单文件和目录前缀路径迁移纯转移；
- 迁移 tab、document snapshot、runtime、activeTabId 和保存目标；
- 新增 save-as start/complete 转移；
- 新增删除文件/目录后关闭受影响标签的批量转移；
- 全部转移先写纯测试，再接 IPC。

扩展 `use-editor-sessions.ts`、`DocumentPane.tsx` 和 DOCX editor Map，确保它们只以稳定 tabId 为键，不因路径改变重建编辑器。

### 6.7 工作区文件操作 controller

建议新增 `src/renderer/lib/use-file-management.ts`：

- 持有第 5.3 节状态机和 mutationId；
- 组合名称输入、目录选择、覆盖确认和删除确认；
- 调用固定 DesktopApi；
- 成功后触发工作区重新扫描、mutationEpoch、选择/展开迁移和文档路径迁移；
- 失败时保留可恢复输入，不修改磁盘镜像状态；
- 不直接持有 Node/Electron 对象。

### 6.8 文件树和对话框

扩展或新增：

- `WorkspaceSidebar`：操作入口和运行状态；
- `FileTree` / `FileTreeNode`：所有可管理条目的选择、行操作与集中展开状态；
- `WorkspaceTargetDialog`：选择工作区内目录；
- `EntryNameDialog` 或内联名称编辑；
- 覆盖、删除、partial-failure 与 saving-blocked 的明确对话框。

保持展示组件尽量纯，由 App/controller 注入动作；不要让每个递归节点自行调用 IPC。

### 6.9 App 协调与搜索失效

`App.tsx` 负责协调：

- 文档 dirty/saving 守卫；
- 工作区 controller、文件管理 controller 和文档 controller；
- mutation 成功后的路径迁移或批量关闭；
- 搜索取消、结果清空和 locate 身份失效；
- 工作区切换与文件操作互斥；
- 窗口关闭询问与文件操作确认不互相覆盖。

不要把文件系统细节、绝对路径或 Node 错误带入 App。

## 七、Electron 与数据安全边界

### 7.1 建议的最小 API 形状

```ts
interface DesktopApi {
  readonly workspace: {
    readonly open: () => Promise<OpenWorkspaceResult>;
    readonly refresh: () => Promise<RefreshWorkspaceResult>;
    readonly createText: (request: CreateWorkspaceEntryRequest) => Promise<WorkspaceMutationResult>;
    readonly createDocx: (request: CreateWorkspaceEntryRequest) => Promise<WorkspaceMutationResult>;
    readonly createDirectory: (
      request: CreateWorkspaceEntryRequest,
    ) => Promise<WorkspaceMutationResult>;
    readonly relocate: (request: RelocateWorkspaceEntryRequest) => Promise<WorkspaceMutationResult>;
    readonly trash: (request: TrashWorkspaceEntryRequest) => Promise<WorkspaceMutationResult>;
    readonly reveal: (request: RevealWorkspaceEntryRequest) => Promise<RevealResult>;
  };
  readonly document: {
    // 既有 read/save 方法保持
    readonly saveTextAs: (request: SaveTextDocumentAsRequest) => Promise<SaveTextDocumentAsResult>;
    readonly saveDocxAs: (request: SaveDocxDocumentAsRequest) => Promise<SaveDocxDocumentAsResult>;
  };
}
```

此代码只表示暴露面，不冻结最终类型命名。WP0/WP2 可在不扩大权限的前提下细化。

### 7.2 必须保持的安全属性

- `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true` 保持；
- renderer 不导入 Electron、Node.js、`fs`、`path`、`child_process` 或 PowerShell；
- preload 不暴露 `ipcRenderer`、`shell`、通用 invoke/send/on 或任意 channel；
- 根路径只来自主进程工作区会话；
- 所有相对路径按不可信输入重新校验；
- 源、父目录、目标和发布前状态分别复验；
- 不跟随 symlink/junction，不通过 realpath 越界；
- 不把 renderer 快照、kind、revision 或确认布尔值当作唯一安全判断；
- 覆盖必须进行目标 revision compare-and-swap；
- 临时文件排他、不可预测、同目录，写完 sync/close 后再发布；
- DOCX 产物验证和覆盖前备份不减少；
- 删除只进回收站；
- reveal 只调用固定资源管理器显示能力；
- 日志只允许 operation code、稳定错误码和必要计数，不记录正文、模型、绝对路径、用户文件名、临时名或原始异常。

## 八、测试要求

### 8.1 Task 1 至 Task 8 全量回归

- 当前完整测试全部实际执行；
- 不减少 TXT 路径、UTF-8、BOM、换行、revision、安全替换和多标签测试；
- 不减少 DOCX ZIP/OOXML、兼容性、模型、备份、验证、安全保存和生命周期测试；
- 不减少搜索遍历、取消、预算、结果定位和过期校验测试；
- Electron sandbox、preload 白名单、窗口关闭与未保存保护测试继续通过。

### 8.2 名称、路径和契约测试

至少覆盖：

- 根父目录 `''` 与多级普通父目录；
- 空名称、`.`、`..`、斜杠、反斜杠、NUL、控制字符和 Windows 非法字符；
- 保留设备名及带扩展名形式；
- 尾随点/空格；
- 绝对路径、盘符、UNC、ADS 和路径穿越；
- 源/父目录任一段 symlink/junction；
- 不存在、非文件、非目录和 `other`；
- 工作区边界与 realpath 越界；
- 大小写冲突、只改大小写和 Unicode 名称不被静默改写；
- 请求缺字段、多余字段、错误类型、未知 operation/kind；
- 所有结果可 structured clone，错误不含运行时对象。

### 8.3 新建测试

至少覆盖：

- 根和子目录新建 TXT/DOCX/文件夹；
- TXT 为可读取空 UTF-8；
- DOCX 可检查、导入、打开并保存；
- 文件与目录冲突均不覆盖；
- 父目录在校验后消失或变成链接；
- 排他创建、短写、sync、close、验证、发布和清理失败注入；
- 操作失败无目标、无临时残留；
- 成功后刷新并打开唯一干净标签。

### 8.4 另存为测试

至少覆盖：

- TXT 无 BOM/BOM、LF/CRLF/混合换行；
- 保存期间继续编辑，目标迁移后 dirty 判定正确；
- DOCX supported/degraded/read-only；
- degraded 确认 revision 失效；
- DOCX 导出、验证、目标备份和安全替换失败点；
- 新目标无备份，覆盖目标备份等于覆盖前字节；
- 第一次冲突不写，确认绑定目标 revision；
- 确认后目标外部变化返回冲突；
- 目标已在另一标签打开时不发 IPC；
- 成功后 stable tabId、编辑器状态和标签顺序保持，源文件不变；
- 失败时当前标签仍指向源路径且正文/模型不丢失。

### 8.5 重命名与移动测试

至少覆盖：

- 文件重命名、跨父目录移动、目录及非空目录移动；
- 只改大小写；
- 同路径 no-op；
- 目标存在不覆盖、不合并；
- 目录移入自身/后代拒绝；
- 工作区根、link、other、内部文件拒绝；
- 操作时外部删除、替换、权限变化；
- DOCX 伴随备份迁移、目标备份冲突、第二步失败与回滚失败；
- 目录迁移全部后代标签，前缀边界不误命中；
- dirty 标签保留，saving 标签阻止；
- TXT/DOCX 编辑器选择、滚动、撤销历史和查找状态不丢失；
- 迁移后保存只写新路径。

### 8.6 回收站与资源管理器测试

至少覆盖：

- 普通文件、空目录和非空目录调用可注入 trash 适配器；
- 用户取消时不调用 IPC；
- dirty 聚合确认、saving 阻止；
- 文件删除关闭对应标签，目录删除关闭后代标签；
- trash 失败不提前关闭标签；
- DOCX 伴随备份与 partial failure；
- 永久删除 API 不被调用；
- reveal 文件、目录、工作区根、缺失路径和链接拒绝；
- preload 不暴露任意 shell 方法。

### 8.7 IPC 与 preload 契约测试

至少覆盖：

- 固定通道和精确参数数量；
- 无工作区返回 `NO_WORKSPACE`；
- renderer 不能提交根或绝对路径；
- 多余字段与危险开关拒绝；
- handler 从主进程 session 取根并绑定发送窗口；
- 同窗口写操作串行；
- 工作区切换后的迟到操作不提交旧快照；
- DesktopApi 只暴露第 4.2 节固定能力；
- `ipcRenderer`、`shell`、文件句柄和 Node 错误不泄漏。

### 8.8 renderer 状态、组件和跨功能测试

至少覆盖：

- stable tabId 与路径去重；
- 单文件/目录路径迁移纯转移；
- save-as editRevision 与 dirty；
- 文件树所有普通条目可选择，只有 TXT/DOCX 可打开；
- 集中展开状态在刷新和迁移后保持；
- 新建、重命名、移动、覆盖、删除、错误和取消焦点行为；
- 重复点击只发一个 mutation；
- 操作确认与关闭标签/切换工作区/关闭窗口确认不互相覆盖；
- mutation 成功取消搜索、清空结果和定位；
- 失败、取消、reveal 不清空仍有效搜索；
- 新搜索或旧定位迟到时受 workspace epoch + mutationEpoch + requestId/locateId 拒绝；
- partial failure 强制刷新且不猜测标签路径。

### 8.9 Windows 手工桌面冒烟

开发模式与生产构建至少各执行一次：

- 根和多层目录新建 TXT/DOCX/文件夹；
- 中英文、空格、emoji、大小写文件名及非法名称反馈；
- TXT/DOCX 另存为新目标、覆盖确认和目标外部变化；
- dirty TXT/DOCX 重命名、移动后继续编辑保存；
- 目录移动包含多个已打开 TXT/DOCX；
- saving 时重命名/移动/删除被阻止；
- 删除文件/非空目录并从 Windows 回收站恢复；
- 在资源管理器中显示文件、目录和工作区；
- Word/WPS 打开的 DOCX 遇到权限或共享冲突时不丢内容；
- 只改大小写重命名；
- 操作后文件树、标签、选择、搜索结果和定位状态一致；
- 快速重复提交、切换工作区和关闭窗口；
- 控制台/终端无未处理异常；
- 工作区无 `.wenshu-*` 临时残留，DOCX 备份位置符合规则。

## 九、明确不在本任务范围内

- 工作区外另存为、跨工作区或跨盘移动；
- 复制、粘贴、复制路径、复制文件、创建快捷方式或重复文件；
- 多选、批量重命名、批量移动、批量删除；
- 拖拽排序或拖拽移动；
- 永久删除、安全擦除、应用内回收站或撤销删除；
- 文件系统监听、自动刷新、外部变化通知；
- untitled 内存文档、模板库、最近文件或启动恢复；
- TXT/DOCX 自动保存；
- read-only DOCX 字节级另存副本；
- TXT 与 DOCX 格式互转或通过改扩展名转换类型；
- DOCX 当前文件查找替换、工作区替换或批量替换；
- 复杂 Word 格式、完整无损往返或 Office 自动化；
- 标签拖拽、固定、批量关闭、分屏；
- Markdown、PDF、图片或其他新编辑器；
- 通用文件系统 API、系统终端、插件系统、云同步或 AI/Agent 能力。

## 十、工作包与执行顺序

每次只实施一个工作包。当前包门禁失败时不得进入下一包。

### WP0：锁定基线、Windows 行为与固定语义

- 完成第三节全部前置检查；
- 记录 check、build、测试数量与条件跳过；
- 建立临时工作区和 Windows 名称/冲突/大小写/回收站夹具；
- 验证第 3.3 节全部技术假设；
- 冻结第 4 节协议、错误码、伴随备份和 partial failure 规则；
- 新增 `TASK_009_WP0_REPORT.md`；
- 不向产品 UI 暴露文件写操作。

验收门禁：Task 8 基线可重复通过；关键 Windows 与 Electron 行为有实际证据；无未决数据安全语义。

### WP1：稳定 tabId 与纯路径迁移状态机

- 解耦稳定 tabId 与 relativePath；
- 改造打开去重、runtime、CodeMirror session、DOCX editor Map 和 React key；
- 实现单文件/目录路径迁移、批量关闭和 save-as 完成纯转移；
- 覆盖 dirty、saving、editRevision、异步读取/保存和前缀边界；
- 暂不新增文件系统写 IPC 或 UI。

验收门禁：现有 TXT/DOCX 标签行为无回归；路径变化不重建编辑器、不丢会话；纯状态测试完整；完整 check/build 通过。

### WP2：共享契约、名称校验与源/目标路径安全

- 新增文件管理共享契约、稳定错误与运行时校验；
- 实现 Windows 叶名称校验；
- 实现现有文件、现有目录、目标父目录和不存在目标的独立解析；
- 实现边界、link、root、internal name、descendant 和 case-only 判断；
- 完成第 8.2 节测试；
- 尚不注册真实写 IPC。

验收门禁：危险路径和名称确定拒绝；既有读取保存校验不弱化；纯契约/路径测试通过；完整 check/build 通过。

### WP3：新建、资源管理器显示与固定 IPC

- 实现 TXT/DOCX/文件夹新建服务；
- DOCX 复用空模型导出和产物验证；
- 实现 reveal 服务；
- 注册对应固定 IPC、DesktopApi 与 preload；
- 实现主进程写操作串行和请求身份校验；
- 完成第 8.3、8.6、8.7 节相关测试；
- 暂不接 renderer 文件树操作 UI。

验收门禁：新建排他、安全、无临时残留；DOCX 有效；reveal 不扩大 shell 权限；完整 check/build 通过。

### WP4：TXT / DOCX 另存为与 revision 覆盖确认

- 实现两类 save-as 服务、共享契约和固定 IPC；
- TXT 复用编码/换行/安全替换；
- DOCX 复用兼容性、导出、验证和目标备份；
- 实现 TARGET_EXISTS → expectedTargetRevision → 发布前复验；
- 接入稳定 tabId 的 save-as start/complete；
- 覆盖保存期间继续编辑和目标已打开；
- 完成第 8.4 节测试；
- 暂不实现重命名/移动/删除。

验收门禁：源文件不变；目标写入安全；覆盖不使用 force；标签迁移与 dirty 正确；完整 check/build 通过。

### WP5：重命名、移动、伴随备份与回收站删除

- 实现 relocate、case-only 中间路径、目录后代检查；
- 实现 DOCX 伴随备份迁移和失败回滚；
- 实现 shell trash 适配器与普通文件/目录删除；
- 实现 dirty 聚合、saving 阻止所需结果与 controller 接口；
- 实现 partial failure 结果；
- 注册固定 IPC/preload；
- 完成第 8.5、8.6、8.7 节相关测试；
- 暂不完成最终文件树 UI。

验收门禁：不覆盖、不越界、不永久删除；目录与备份失败可诊断；标签只在主进程成功后迁移/关闭；完整 check/build 通过。

### WP6：文件管理 controller、文件树与对话框 UI

- 新增文件管理 controller 和 mutationId 状态机；
- 分离条目选择与活动文档；
- 集中管理展开目录集合；
- 接入新建、另存为、重命名、移动、删除和 reveal；
- 实现目录目标选择、名称输入和风险分级确认；
- 保持键盘、焦点、loading/error/cancel 行为；
- 完成第 8.8 节组件测试。

验收门禁：全部用户操作形成 UI → 窄 IPC → 刷新/迁移闭环；无重复提交；现有打开编辑交互无回归；完整 check/build 通过。

### WP7：生命周期、搜索失效、Windows 冒烟与风险收敛

- 接入 mutationEpoch，取消活动搜索并清空旧结果/定位；
- 覆盖工作区切换、关闭标签、关闭窗口、保存中、迟到结果和确认互斥；
- 覆盖 partial failure 强制刷新；
- 执行第 8.9 节开发与生产构建冒烟；
- 使用 Word/WPS 或等价外部占用验证权限/共享冲突；
- 记录操作耗时、界面响应和临时残留；
- 只根据证据修复，不在本包扩大功能范围。

验收门禁：全部异步身份和生命周期可验证；搜索不残留旧路径；Windows 数据安全风险收敛；完整 check/build 通过。

### WP8：整体验收、文档与完成报告

- 运行完整 check 和 build；
- 执行最终 Windows 手工清单；
- 审查全部写路径、错误分支、临时清理和日志；
- 更新 README、项目基线、测试指南和项目结构；
- 将 Roadmap 中 Task 9 标记完成；
- 新增 `TASK_009_COMPLETION_REPORT.md`；
- 记录实际协议、Windows 名称规则、稳定 tabId、覆盖确认、备份、回收站、partial failure、搜索失效、测试和冒烟证据；
- 仅在第十一节全部满足后把本文件状态改为已完成。

验收门禁：文档与行为一致；全部自动和手工证据可核对；无开放的 P0/P1 数据丢失、越界写入或永久删除问题。

## 十一、最终验收标准

> 以下条件已于 WP8 逐项核对并全部勾选。每项均有对应自动化测试、WP0 实测证据或完成报告
> 记录的手工/Shell 实测证据，无凭推测勾选项（详见 [TASK-009 完成报告](./TASK_009_COMPLETION_REPORT.md)）。

### 11.1 新建与另存为

- [x] 可在根或普通子目录新建 TXT、有效 DOCX 和文件夹；
- [x] 新建冲突不覆盖、不自动改名；
- [x] 新建 DOCX 可重新导入、打开、编辑和保存；
- [x] TXT 另存为保持 BOM/换行和保存期间继续编辑语义；
- [x] DOCX 另存为保持兼容性确认、导出验证与目标备份语义；
- [x] 覆盖确认绑定目标 revision，目标变化必须重新确认；
- [x] 另存为成功后源文件不变、当前标签迁移到目标；
- [x] 失败时标签仍指向源路径且正文/模型不丢失。

### 11.2 重命名、移动、删除与显示

- [x] 普通文件和目录可在工作区内重命名/移动；
- [x] Windows 只改大小写重命名可用；
- [x] 目标存在不覆盖、不合并；
- [x] 工作区根、link、other、内部文件和目录移入后代均拒绝；
- [x] DOCX 伴随备份按规则迁移，失败可回滚或明确 partial failure；
- [x] 文件和非空目录删除进入 Windows 回收站；
- [x] dirty 删除需确认，saving 删除被阻止；
- [x] 删除失败不提前关闭标签；
- [x] 文件、目录和工作区可在资源管理器中显示且不开放通用 shell。

### 11.3 标签、编辑器与生命周期

- [x] stable tabId 与 relativePath 已解耦；
- [x] 同一路径仍只有一个标签；
- [x] 文件/目录路径迁移同步全部受影响标签且前缀边界准确；
- [x] TXT 光标、选区、滚动、撤销历史和查找状态保留；
- [x] DOCX 编辑器实例、选区、滚动、撤销历史和工具栏绑定保留；
- [x] dirty、saving、editRevision、读取/保存身份和标签顺序保持；
- [x] 迁移后保存只写新路径；
- [x] 工作区切换、关闭标签/窗口和文件操作确认不互相污染。

### 11.4 路径、IPC 与数据安全

- [x] renderer 不能提交根、绝对路径、任意 shell 或危险开关；
- [x] Windows 非法/保留名称、路径穿越、ADS 和越界确定拒绝；
- [x] 源和目标任一路径段不跟随 symlink/junction；
- [x] 主进程写操作串行且发布前复验；
- [x] 临时写入排他、同目录、sync/close 后发布，失败尽力清理；
- [x] DOCX 产物验证与覆盖前备份不减少；
- [x] 删除不调用永久删除 API；
- [x] IPC/日志不泄漏正文、模型、绝对路径、临时名或原始异常；
- [x] partial failure 不被伪装成普通成功或普通失败。

### 11.5 工作区、搜索、质量与文档

- [x] 成功 mutation 刷新工作区并更新选择/展开状态；
- [x] 成功 mutation 取消活动搜索、清空旧结果与定位；
- [x] 失败、取消和 reveal 不错误使有效结果失效；
- [x] Task 1 至 Task 8 全量回归通过；
- [x] 第 8 节新增测试完整，无 only 或无条件 skip；
- [x] typecheck、lint、format、test、check、build 全部通过；
- [x] 开发模式与生产构建 Windows 冒烟通过；
- [x] 回收站恢复、外部占用和只改大小写具有实际证据；
- [x] 工作区无临时残留，备份位置符合规则；
- [x] README、项目基线、测试指南、项目结构和完成报告同步。

## 十二、失败处理与决策规则

- Windows 行为与假设不一致：停止实现，先用最小临时目录和适配器测试更新 WP0 结论；
- 无法安全校验不存在的目标：不得退回字符串 `join` 后直接写入，先完善父目录与发布前复验；
- 只改大小写中间重命名失败：尝试回滚；回滚失败返回 partial failure 并强制刷新；
- DOCX 伴随备份语义无法事务化：优先主文档可恢复和明确 partial failure，不静默遗留错误路径；
- 目标在覆盖确认后变化：返回冲突并重新确认，不重试覆盖；
- 编辑器状态在路径迁移时丢失：不得接受重挂载作为“功能可用”，先完成 stable tabId 解耦；
- saving 标签涉及路径变化：阻止操作，不取消或抢占已有保存；
- dirty 标签删除：必须用户明确放弃；取消不调用 IPC；
- 回收站不可用：返回稳定错误并保留原状态，不降级永久删除；
- 操作成功但刷新失败：报告“已完成、刷新失败”，禁止重新执行相同破坏性操作作为刷新手段；
- partial failure：立即停止后续写操作、刷新、展示恢复建议并记录可审计结果；
- 搜索结果无法可靠迁移：直接失效，不猜测替换路径；
- 新依赖才可解决：先形成依赖评估，未经记录不增加；
- 安全与便利冲突：优先工作区边界、revision、备份、回收站、未保存内容和非破坏性失败。

## 十三、真正执行开发时使用的提示词模板

本节不是示例性口号，而是逐工作包执行时应直接复制给开发 Agent 的提示词。一次对话只使用一个工作包模板；把方括号中的分支/恢复点信息替换为实际值，不合并多个工作包。

### 13.1 所有工作包共同执行规则

- 开始前读取本任务文档全文，以及模板指定的直接相关源码/测试；
- 先报告当前分支、工作树、上一包恢复点、本包范围、非目标、预计修改文件、测试和回滚方式；
- 保护用户已有修改，不覆盖、reset 或清理无关内容；
- 只实现当前 WP，不提前做后续 UI、IPC、重构或文档完成勾选；
- 文件修改后先跑定向测试，再跑完整 `npm run check` 和 `npm run build`；
- 审查 diff、`git status --short`、新增 IPC 暴露面、写路径和临时残留；
- 最终报告实际修改、关键决策、与规划差异、命令结果、手工证据、已知限制和是否满足本包门禁；
- 门禁失败就停止，不得自行进入下一包；
- 只有 WP8 可以新增完成报告、勾选第十一节并把任务标为完成。

### 13.2 WP0 执行提示词

> 当前任务是执行 `TASK-009` 的 `WP0：锁定基线、Windows 行为与固定语义`。先完整阅读 `README.md`、`docs/PROJECT_BASELINE.md`、`docs/DEVELOPMENT_ENVIRONMENT.md`、`docs/TESTING.md`、Task 7/8 任务文档与完成报告、`docs/TASK_009_BASIC_FILE_MANAGEMENT.md`，再阅读当前工作区、路径校验、TXT/DOCX 保存、标签、编辑器会话、搜索 controller 的直接相关源码和测试。开始时报告当前分支与工作树、上一恢复点、本包非目标、验证清单和将新增的最小夹具。实际运行完整 `check`、`build`，记录测试文件/测试/条件跳过；完成开发与生产构建主窗口冒烟。使用临时工作区和可注入适配器验证 Windows 非法/保留名称、大小写冲突、只改大小写 rename、普通/非空目录 rename、目标父目录逐段校验、Electron `shell.trashItem`、`shell.showItemInFolder`、空白 DOCX 导出验证、TXT/DOCX 另存为复用点、`tab.id === relativePath` 的会话影响、stable tabId 技术路径、目录后代迁移和 mutationEpoch 搜索失效。不得向产品 UI 或 preload 暴露新的文件写能力，不实现 WP1+，不修改最终验收勾选。新增 `docs/TASK_009_WP0_REPORT.md`，记录实际命令、环境、夹具、证据、失败点、冻结决策和是否满足 WP0 门禁。若任何假设不成立，先更新 Task 9 规划与报告，不进入 WP1。结束前审查 diff、运行完整 `check`/`build`，报告是否满足“Task 8 基线可重复、关键 Windows/Electron 行为有证据、无未决数据安全语义”。

### 13.3 WP1 执行提示词

> 当前任务是执行 `TASK-009` 的 `WP1：稳定 tabId 与纯路径迁移状态机`。先完整阅读 `docs/TASK_009_BASIC_FILE_MANAGEMENT.md`、`docs/TASK_009_WP0_REPORT.md`，以及 `src/renderer/lib/document-tabs.ts`、`use-documents.ts`、`use-editor-sessions.ts`、`DocumentPane.tsx`、`EditorSessionHost.tsx`、`DocxEditorSessionHost.tsx`、`TabBar.tsx`、`App.tsx` 和相关 document/docx/search 测试。开始时报告当前分支、工作树、WP0 恢复点、本包将保持的不变量和预计迁移步骤。只完成 stable tabId 与 relativePath 解耦、路径去重、runtime/session/editor Map/React key 改造，以及单文件路径迁移、目录前缀迁移、save-as 完成和批量关闭的纯状态转移与测试；不得新增文件系统写 IPC、preload 方法、文件树管理 UI、真实另存为、重命名、移动或删除。确保现有 TXT/DOCX 打开、切换、保存、搜索定位、关闭保护全部使用稳定 tabId，不以路径变更导致编辑器重建；目录前缀必须按段边界匹配。覆盖 dirty、saving、editRevision、迟到读取/保存、标签顺序、活动标签、CodeMirror 查找/撤销/滚动和 DOCX 常驻 editor。先跑定向状态/组件测试，再跑完整 `check` 和 `build`。结束时审查是否仍存在 `id === relativePath` 的隐式假设，报告修改文件、迁移策略、回归结果和是否满足 WP1 门禁；不要进入 WP2。

### 13.4 WP2 执行提示词

> 当前任务是执行 `TASK-009` 的 `WP2：共享契约、名称校验与源/目标路径安全`。先完整阅读 Task 9 文档、WP0 报告、WP1 实现与直接测试，以及 `src/shared/workspace.ts`、`desktop-api.ts`、`document.ts`、`docx.ts`、`src/main/document/path-validation.ts`、`src/main/workspace/scan-workspace.ts`、`workspace-session.ts`。只新增/完善纯共享契约、稳定错误、严格运行时校验、Windows 叶名称校验，以及现有文件、现有目录、目标父目录、不存在目标、工作区根、internal name、case-only 和 same/descendant 的主进程安全解析；不得注册真实写 IPC、调用 write/rename/trash/shell、修改 renderer UI 或实现 WP3+。目标根父目录 `''` 必须显式支持；源、父目录、目标各自逐段 lstat/realpath，不跟随 symlink/junction；不能削弱现有 read/save 的最终文件校验。测试必须覆盖 Windows 保留名、非法字符、尾随点/空格、ADS、绝对/UNC/盘符、路径穿越、link、边界、类型、大小写冲突、多余字段和 structured clone。先跑定向契约/路径测试，再跑完整 `check` 和 `build`。结束时报告 API 形状、错误码、校验顺序、与现有 helper 的边界、命令结果和 WP2 门禁；不要进入 WP3。

### 13.5 WP3 执行提示词

> 当前任务是执行 `TASK-009` 的 `WP3：新建、资源管理器显示与固定 IPC`。先阅读 Task 9 文档、WP0 报告、WP1/WP2 代码和测试，以及现有 `write-safety.ts`、DOCX export/verify、workspace IPC、preload、DesktopApi 和 main 注册。只实现 TXT、基础 DOCX、文件夹排他新建，固定 reveal 服务，按窗口串行的最小 mutation coordinator，以及对应固定 IPC/DesktopApi/preload；不得接 renderer 文件树操作 UI，不实现另存为、relocate、trash 或 WP4+。TXT 创建为合法空 UTF-8；DOCX 必须从规范空模型导出、验证、重新导入后安全发布；文件写入使用同目录排他临时文件、完整写入、sync、close、不覆盖发布和失败清理。reveal 只能在重新校验当前工作区相对路径后调用固定 `showItemInFolder`，不得暴露通用 shell。IPC 请求严格拒绝根/绝对路径、多余字段和危险开关，从主进程 session 取根并绑定发送窗口。使用适配器测试短写、sync/close/验证/发布/清理、冲突、权限、父目录竞态和 reveal 失败；更新 preload 契约测试。先跑定向测试，再跑完整 `check`、`build`。结束时审查工作区临时残留和新增 IPC 面，报告是否满足 WP3 门禁；不要进入 WP4。

### 13.6 WP4 执行提示词

> 当前任务是执行 `TASK-009` 的 `WP4：TXT / DOCX 另存为与 revision 覆盖确认`。先阅读 Task 9 文档、WP0 报告、WP1 stable tabId 状态机、WP2 路径契约、WP3 IPC，以及现有 TXT/DOCX save、write-safety、export/verify、compatibility、document-tabs/use-documents 测试。只实现 `saveTextAs`、`saveDocxAs` 的共享契约、主进程服务、固定 IPC/preload 和 stable tabId start/complete controller 转移；不得实现 relocate、trash 或最终文件树管理 UI。新目标使用排他创建；目标存在时第一次只返回 TARGET_EXISTS 与目标 revision，不写盘；确认覆盖必须携带 expectedTargetRevision，发布前再次比较，禁止 force/overwrite 布尔捷径。TXT 保持 BOM、换行、混合换行确认和保存期间继续编辑语义；DOCX 保持 degraded confirmation、导出验证，覆盖前为目标创建滚动备份，read-only 不允许另存为。成功后源文件不变、当前 stable tabId 原地迁移到目标；若保存后又编辑则保持 dirty；失败仍指向源路径。目标由另一标签打开时 renderer 不发请求。逐个注入生成、验证、备份、临时写入、目标复验、替换和清理失败；覆盖外部竞态。先跑定向 save-as/状态/IPC 测试，再跑完整 `check`、`build`。结束时报告源/目标字节证据、备份、revision CAS、dirty 结果和 WP4 门禁；不要进入 WP5。

### 13.7 WP5 执行提示词

> 当前任务是执行 `TASK-009` 的 `WP5：重命名、移动、伴随备份与回收站删除`。先阅读 Task 9 文档、WP0 报告、WP1 路径迁移状态机、WP2 安全解析、WP3/4 IPC 模式，以及 Electron shell、workspace session、DOCX 备份和 App 未保存/saving 守卫的直接相关代码测试。只实现受控 relocate、Windows case-only 中间重命名、目录 same/descendant 拒绝、DOCX 伴随备份迁移/回滚、普通文件/目录 trash、partial failure 结果和对应固定 IPC/preload/controller 接口；不得完成最终 UI 或提前做 WP6+。目标存在一律不覆盖/合并；工作区根、link、other、internal name 拒绝；同卷 rename 发布前复验；saving 受影响标签阻止，dirty 只在删除时要求明确放弃。删除必须调用可注入 `shell.trashItem`，严禁 unlink/rm/rmdir 降级；主进程成功前不得迁移或关闭标签。单 DOCX 主文件与备份的非事务 partial failure 必须明确，目录自然携带备份。测试覆盖文件/非空目录、只改大小写、外部竞态、权限、伴随备份冲突、第二步失败、回滚失败、trash 失败、dirty/saving 和后代标签。先跑定向测试，再跑完整 `check`、`build`；检查不存在永久删除路径。结束时报告每个失败点、恢复结果、partial failure 语义和 WP5 门禁；不要进入 WP6。

### 13.8 WP6 执行提示词

> 当前任务是执行 `TASK-009` 的 `WP6：文件管理 controller、文件树与对话框 UI`。先阅读 Task 9 文档、WP0 报告、WP1 至 WP5 已实现契约/状态/IPC，以及 `use-workspace.ts`、`use-workspace-search.ts`、WorkspaceSidebar/FileTree/FileTreeNode、DocumentPane、ConfirmDialog、App 和组件测试。只完成 renderer 文件管理 controller、mutationId 状态机、所有普通条目的独立选择、集中展开状态、名称输入、工作区内目录选择、新建/另存为/重命名/移动/删除/reveal UI 与风险分级确认；不得在本包新增协议权限或扩大文件类型，不提前编写完成报告。保持现有 TXT/DOCX 单击/键盘打开行为和可访问性；目录与其他普通文件可选择但不可误打开。所有磁盘动作必须经已完成的窄 API；主进程成功前不乐观迁移/关闭；操作中阻止重复提交；取消恢复焦点；错误保留输入；partial failure 强制刷新。另存为、覆盖、删除、dirty、saving 提示文案必须具体。新增 controller/组件/键盘/焦点/重复点击/错误测试，先跑定向测试，再跑完整 `check`、`build`。结束时报告完整用户流、可访问性、UI 状态机、diff 和 WP6 门禁；不要进入 WP7。

### 13.9 WP7 执行提示词

> 当前任务是执行 `TASK-009` 的 `WP7：生命周期、搜索失效、Windows 冒烟与风险收敛`。先阅读 Task 9 文档、WP0 报告、WP1 至 WP6 全部实现和直接测试，重点检查 App、workspace/file-management/document/search controllers、窗口关闭、搜索结果定位和确认对话框。接入并验证 mutationEpoch：成功 create/save-as/relocate/trash 必须取消活动搜索、清空 completed 结果和 locate；失败、取消、reveal 不错误失效。覆盖工作区切换、保存中、关闭标签、关闭窗口、迟到 mutation/search/locate、确认互斥和 partial failure 强制刷新。不得增加新功能、重构无关模块或编写完成报告。补齐生命周期和跨功能回归后，实际执行 Windows 开发模式与生产构建冒烟：新建、另存为覆盖/目标外变、dirty 重命名/移动、目录后代标签、saving 阻止、回收站删除/恢复、资源管理器显示、只改大小写、快速重复提交、工作区切换、Word/WPS 或等价外部占用。记录命令、应用模式、Office/环境、可核对结果、操作耗时观察和工作区残留；隐私文件不得提交。只根据证据修复范围内问题。运行定向测试、完整 `check`、`build`。结束时报告风险收敛、手工证据、已知限制和 WP7 门禁；不要进入 WP8。

### 13.10 WP8 执行提示词

> 当前任务是执行 `TASK-009` 的 `WP8：整体验收、文档与完成报告`。先完整阅读 Task 9 文档、WP0 报告、WP1 至 WP7 提交/恢复点、全部新增源码测试和现有 README/PROJECT_BASELINE/TESTING。不要新增产品功能；只修复验收发现且属于 Task 9 范围的问题。逐项核对第十一节，不得凭推测勾选。实际运行 typecheck、lint、format check、全部 test、完整 `check`、`build`，记录测试文件数、通过数、条件跳过与原因；执行最终开发/生产 Windows 冒烟，核对回收站恢复、外部占用、case-only、临时残留、DOCX 备份、搜索失效和 Electron 暴露面。审查全部写路径、绝对路径泄漏、危险开关、永久删除调用、skip/only、弱化断言和用户已有修改。更新 README 当前能力/尚未实现/Roadmap/文档/结构、PROJECT_BASELINE、TESTING；新增 `docs/TASK_009_COMPLETION_REPORT.md`，记录实现摘要、关键文件、协议、名称/路径规则、stable tabId、create/save-as、revision 覆盖、relocate/backup/trash/partial failure、搜索失效、IPC 安全、测试、Windows 证据、性能观察和限制。只有全部验收真实满足时，才把本任务状态改为已完成并将第十一节改为 `[x]`；否则保持待实施/进行中并列出阻塞。结束时给出最终 diff、命令证据、未解决问题和是否满足 Task 9 全部标准。

## 十四、交付物

任务完成时应交付：

1. 文件管理共享请求、结果、稳定错误与运行时校验；
2. Windows 叶名称、源条目、目标父目录、不存在目标和 descendant 安全校验；
3. 稳定 tabId 与可变 relativePath 的多类型标签模型；
4. 单文件/目录路径迁移、save-as 完成和批量关闭纯状态转移；
5. TXT、基础 DOCX 和文件夹安全新建；
6. TXT/DOCX 另存为、目标 revision 覆盖确认和 DOCX 目标备份；
7. 文件/目录重命名、移动、case-only 与 DOCX 伴随备份处理；
8. Windows 回收站删除和资源管理器显示；
9. 固定 IPC、受控 preload 与 DesktopApi；
10. renderer 文件管理 controller、文件树选择/展开和风险分级对话框；
11. mutationEpoch、工作区刷新、搜索取消和定位失效；
12. 名称、路径、创建、另存为、覆盖、迁移、备份、trash、IPC、状态、组件、生命周期和回归测试；
13. `TASK_009_WP0_REPORT.md`；
14. 更新后的 README、项目基线、测试指南和项目结构；
15. `TASK_009_COMPLETION_REPORT.md`，至少记录：
    - 实现摘要和关键文件；
    - 固定产品范围与明确非目标；
    - Windows 名称、路径、link、边界与 case-only 规则；
    - stable tabId、目录后代迁移和编辑器会话证据；
    - TXT/DOCX/文件夹新建；
    - TXT/DOCX 另存为、目标 revision 与覆盖确认；
    - DOCX 目标/伴随备份策略；
    - relocate、trash、回滚与 partial failure；
    - 工作区刷新、选择/展开与搜索失效；
    - Electron/IPC/preload 安全边界；
    - 自动测试、构建与 Windows 开发/生产冒烟；
    - 外部 Office/占用、回收站恢复和临时残留证据；
    - 性能观察、已知限制及是否满足全部验收标准。

## 十五、完成后的下一任务入口

Task 9 完成后，再比较以下候选的用户价值和风险后单独规划下一任务：

- 当前 DOCX 内查找与替换；
- 文件系统监听与自动刷新；
- 基础设置、主题与启动恢复；
- 标签拖拽、固定与批量关闭；
- Windows 安装包与正式发布流程。

Task 9 不应顺带实现上述任何能力。优先候选可暂定为“当前 DOCX 内查找与替换”，但必须在 Task 9 完成报告中根据实际使用反馈重新确认。
