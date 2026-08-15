# TASK-007：基础 DOCX 阅读、编辑与安全保存

## 任务状态

- 状态：`已完成`（2026-08-11 完成最新回归与 WPS 手工验收，详见 [TASK-007 完成报告](./TASK_007_COMPLETION_REPORT.md)）
- 优先级：`P0`
- 类型：`产品纵向切片 / 新文件类型 / 富文本编辑 / 高风险文件写入`
- 前置任务：[TASK-006：工作区 TXT 搜索与当前文件查找替换](./TASK_006_TXT_SEARCH_FIND_REPLACE.md)
- 前置完成报告：[TASK-006 完成报告](./TASK_006_COMPLETION_REPORT.md)
- 后续建议任务：工作区 DOCX 正文搜索与结果定位
- 项目基线：[PROJECT_BASELINE.md](./PROJECT_BASELINE.md)
- 主要执行方式：按工作包顺序实施，逐包验收；只有最终工作包可以将状态改为`已完成`

## 一、任务目的

Task 6 已完成“工作区文件树 → 多 TXT 标签 → 独立 CodeMirror 会话 → 安全保存 → 当前文件查找替换 → 工作区 TXT 搜索与安全定位”的 TXT 闭环。本任务在不削弱 TXT 能力和 Electron 安全边界的前提下，新增第一个结构化文档类型：基础 DOCX。

```text
工作区中的普通 .docx
  -> 主进程受控读取原始字节并计算 revision
  -> 检查文件大小、ZIP/OOXML 基础结构与资源预算
  -> 导入为受支持范围内的 DocxDocumentModel
  -> 在独立 Tiptap/ProseMirror 富文本会话中阅读和编辑
  -> 修改产生 dirty，可撤销/重做并受关闭保护
  -> 保存前重新校验磁盘 revision
  -> 先生成同目录滚动备份，再生成并验证临时 DOCX
  -> 刷盘、关闭并安全替换目标
  -> 失败时保留原文件、备份和未保存编辑
```

本任务的核心不是“让文件树接受 `.docx` 扩展名”，而是建立以下完整边界：

1. TXT 与 DOCX 可以共享标签生命周期，但拥有独立内容模型、编辑器和文件处理器；
2. DOCX 导入、编辑器状态和导出之间通过明确的结构化中间模型衔接；
3. 只承诺基础格式范围，复杂内容必须给出兼容性报告并安全降级；
4. DOCX 保存必须同时具备外部修改冲突检测、保存前备份、临时写入、产物验证和安全替换；
5. 不因加入 DOCX 而向 renderer 暴露任意文件读取、写入、ZIP 或 IPC 能力。

## 二、完成后的用户体验

任务完成后，用户应能够：

1. 在工作区文件树中识别并选择普通 `.docx` 文件；
2. 在中央区域以唯一标签打开 DOCX，加载期间看到明确状态；
3. 阅读普通段落、标题、粗体、斜体、下划线、基础字号、文字颜色、项目符号、编号列表和基础对齐；
4. 在兼容范围内编辑上述内容，并使用复制、剪切、粘贴、撤销和重做；
5. 同时打开 TXT 与 DOCX，在混合标签之间切换且各自正文、选择、滚动、历史和 dirty 状态互不污染；
6. 看到当前 DOCX 的兼容性状态；不支持的内容不会被静默伪装为完全兼容；
7. 对可安全编辑的文档点击“保存”或按 `Ctrl+S`，保存期间看到明确状态；
8. 保存成功后原文件被基础 DOCX 产物替换，同时保留最近一次保存前版本的滚动备份；
9. 文档被外部程序修改后保存时得到冲突提示，默认不覆盖外部内容；
10. 保存失败时继续保留编辑器正文和 dirty 状态，原文件不被删除、截断或破坏；
11. 关闭 dirty DOCX、切换工作区或关闭窗口时继续受到未保存保护；
12. 打开损坏、超限、加密或不受支持的复杂 DOCX 时得到稳定错误或只读降级，而不是应用崩溃；
13. 用 Microsoft Word、WPS Office 或 LibreOffice 打开保存后的基础 DOCX，并能在文枢中重新打开。

## 三、执行前置检查

任何产品代码修改前必须完成 WP0，并记录实际结果。

### 3.1 必读材料

- `README.md`；
- `docs/PROJECT_BASELINE.md`；
- `docs/DEVELOPMENT_ENVIRONMENT.md`；
- `docs/TESTING.md`；
- `docs/TASK_004_TXT_EDIT_SAFE_SAVE.md` 与完成报告；
- `docs/TASK_005_MULTI_TXT_TABS.md` 与完成报告；
- `docs/TASK_006_TXT_SEARCH_FIND_REPLACE.md` 与完成报告；
- `src/main/index.ts`；
- `src/main/document/` 下的 TXT 读取、保存与 IPC 实现；
- `src/main/workspace/` 下的扫描器、IPC 与工作区会话；
- `src/preload/index.ts`；
- `src/shared/desktop-api.ts`、`document.ts`、`workspace.ts`；
- `src/renderer/App.tsx`；
- `src/renderer/components/document/` 与 `components/workspace/`；
- `src/renderer/lib/text-document-tabs.ts`、`use-text-documents.ts`、`use-editor-sessions.ts`；
- TXT 读取保存、多标签、窗口关闭、preload 和搜索定位的现有测试。

### 3.2 工作树与质量基线

- 检查 `git status --short`，识别并保护用户已有修改；
- 确认 `main` 已包含 Task 6 与 `TASK_006_COMPLETION_REPORT.md`；
- 依次运行 `typecheck`、`lint`、`format:check`、`test`、完整 `check` 和 `build`；
- `check` 与 `build` 不得并行运行；
- 记录测试文件数、通过数、条件跳过数、构建产物和任何警告；
- 当前 Windows 环境若复现测试临时 junction 清理 `EBUSY` 或 React 异步 `act(...)` 警告，必须在 WP0 归因并修复测试可靠性；
- 不得用删除测试、整文件跳过、弱化断言或单纯延长超时制造绿色基线。

### 3.3 DOCX 夹具与兼容性验证环境

WP0 必须准备最小、可审计且不含隐私的 DOCX 夹具：

- 纯段落与空文档；
- 标题 1 至标题 3；
- 粗体、斜体、下划线及其组合；
- 受支持字号和十六进制文字颜色；
- 项目符号、编号列表和嵌套列表；
- 左对齐、居中、右对齐和两端对齐；
- 中文、英文、emoji、空段落和多段落；
- 含图片、简单表格、页眉页脚、批注或修订等不支持特性的复杂样本；
- 损坏 ZIP、伪装扩展名、超限、加密或缺失关键 OOXML 部件的失败样本；
- 由文枢导出后再次导入的 round-trip 样本。

测试夹具优先由固定脚本或测试构造器生成；必须提交二进制夹具时，应记录来源、用途和预期结构，禁止提交真实用户文档。

手工兼容性环境至少覆盖本机可用的一种外部 Office 程序；推荐 Microsoft Word，无法使用时记录 WPS Office 或 LibreOffice 的具体版本。

### 3.4 WP0 必须产出的技术验证记录

WP0 在进入产品实现前必须用夹具确认：

1. Mammoth 对标题、强调、列表、字号、颜色和对齐的实际导入结果；
2. Mammoth 不足以表达的受支持格式是否需要通过 JSZip 对有限 OOXML 属性做补充读取；
3. Tiptap/ProseMirror schema 和所需扩展的最小集合；
4. `DocxDocumentModel -> docx` 的导出映射能否稳定生成可被外部 Office 打开的文件；
5. 导入与导出的消息、警告和格式丢失是否能形成确定兼容性矩阵；
6. 普通文档的解析、渲染和导出耗时是否满足“数秒内完成”的目标；
7. 依赖的许可证、包体积和运行环境与 Electron 37、React 19、TypeScript 5 兼容。

若既定库无法在不自行实现大规模 OOXML 引擎的前提下满足某一格式，应把该格式降级为“读取但不保证保存”或“不支持”，并更新本任务兼容矩阵；不得静默扩大实现复杂度。

## 四、固定产品与协议决策

### 4.1 受支持格式矩阵

Task 7 的可编辑、可导出范围固定为：

| 内容                       | 导入                      | 编辑           | 导出           |
| -------------------------- | ------------------------- | -------------- | -------------- |
| 普通段落、空段落           | 支持                      | 支持           | 支持           |
| 标题 1-3                   | 支持                      | 支持           | 支持           |
| 粗体、斜体、下划线         | 支持                      | 支持           | 支持           |
| 基础字号                   | 支持有限值或原值映射      | 支持白名单值   | 支持           |
| 文字颜色                   | 支持普通 RGB              | 支持 `#RRGGBB` | 支持           |
| 项目符号、编号列表         | 支持基础层级              | 支持           | 支持           |
| 段落对齐                   | 支持左/中/右/两端         | 支持           | 支持           |
| 超链接                     | 降级为可见文本            | 不编辑链接属性 | 导出为普通文本 |
| 图片、表格                 | 显示兼容性警告并降级/省略 | 不支持         | 不承诺保留     |
| 页眉页脚、脚注尾注         | 不进入编辑模型            | 不支持         | 不承诺保留     |
| 批注、修订、字段、公式     | 不进入编辑模型            | 不支持         | 不承诺保留     |
| 浮动对象、文本框、SmartArt | 不进入编辑模型            | 不支持         | 不承诺保留     |
| 宏、嵌入脚本或对象         | 不执行                    | 不支持         | 不保留         |

具体字号白名单、最大列表层级和颜色归一化规则由 WP0 根据 Tiptap 与 `docx` 验证后写入共享常量和测试；不得仅在 UI 中隐式约定。

### 4.2 兼容性等级与编辑策略

每次导入必须返回兼容性等级和稳定警告码：

- `supported`：只包含已声明支持的内容，可直接编辑和保存；
- `degraded`：正文可用，但检测到可能丢失的不支持内容；默认允许阅读，进入编辑或首次保存前必须明确确认；
- `read-only`：结构无法安全映射、文档明确启用了编辑保护或存在高风险复杂内容，只读显示可提取正文；
- `rejected`：不是合法 DOCX、真正加密、资源超限、关键部件缺失或解析失败，不创建可编辑标签正文。0 字节 `.docx` 作为 Windows/WPS 惰性占位文件是唯一例外，按空白文档加载并在首次保存时物化。

确认必须绑定稳定 tabId、相对路径、revision 和当前兼容性报告。用户确认只对当前 revision 有效；重新读取不同 revision 后必须重新确认。

不得使用笼统的“可能不兼容”代替可测试警告。共享契约至少区分：图片、表格、页眉页脚、批注、修订、字段、公式、嵌入对象、未知样式、加密/保护和其他未识别内容。

### 4.3 结构化 DOCX 中间模型

IPC 和 renderer 文档状态使用项目自有的结构化模型，不使用以下内容作为唯一真相：

- 原始 OOXML；
- 未清洗 HTML；
- Mammoth 私有对象；
- Tiptap/ProseMirror 内部实例；
- `docx` 库实例；
- `Buffer`、文件句柄或 ZIP 对象。

建议的共享模型为带版本号的判别联合：

```ts
interface DocxDocumentModel {
  readonly schemaVersion: 1;
  readonly blocks: readonly DocxBlock[];
}

type DocxBlock = DocxParagraphBlock | DocxHeadingBlock | DocxBulletListBlock | DocxOrderedListBlock;

interface DocxTextRun {
  readonly text: string;
  readonly marks: readonly DocxTextMark[];
}
```

实际字段由 WP1 固化，但必须满足：

- 可以独立运行时校验；
- 不包含原型对象、循环引用或可执行内容；
- 文本、节点数、列表深度、marks 数量和序列化大小有固定上限；
- 模型到编辑器、编辑器到模型、模型到导出库的转换函数可单元测试；
- 未知 schemaVersion 必须拒绝，不能猜测迁移。

### 4.4 文件身份、revision 与标签去重

- DOCX 仍以规范工作区相对路径作为文件身份；
- TXT 与 DOCX 共享同一标签路径命名空间，同一路径只能存在一个标签；
- `tabId` 在标签生命周期内稳定，不使用数组下标或文件名；
- DOCX revision 基于读取到的完整原始字节计算 SHA-256；
- 读取、保存、兼容性确认和异步转换结果都绑定 `tabId + requestId + workspaceEpoch + relativePath + revision`；
- 迟到结果只有在上述身份仍一致时才能提交；否则静默作废或显示非破坏性提示。

### 4.5 资源上限与不可信输入

固定基础上限：

- 普通 DOCX 文件压缩后最大 20 MiB；
- ZIP 条目数、总解压大小、单个关键 XML 大小和模型节点数必须设独立预算；
- 具体预算由 WP0 用夹具验证后固化为共享常量，并在完成报告记录；
- 达到任一预算必须返回稳定 `FILE_TOO_LARGE` 或 `RESOURCE_LIMIT_EXCEEDED`，不得继续部分编辑；
- 不读取网络外部关系，不获取远程图片、模板、OLE 对象或链接资源；
- 不执行宏、脚本、字段、嵌入对象或任何文档携带的代码；
- 只接受大小写不敏感的 `.docx`，不接受 `.docm`、`.dotm`、`.rtf` 或伪装扩展名。

### 4.6 富文本编辑器与状态所有权

- TXT 继续使用 CodeMirror 6，DOCX 使用项目基线指定的 Tiptap/ProseMirror；
- 只安装实现第 4.1 节所需的最小扩展，不引入协作、云端、AI、分页或完整 Word UI；
- Tiptap 实例只存在于 renderer 的 DOCX 编辑会话层，不跨 IPC；
- React/controller 持有可序列化文档状态、保存状态和兼容性状态；
- dirty 应通过单调内容版本或等价稳定机制判断，不在每次输入时对大型 JSON 做无界深比较；
- 保存捕获内容版本；保存完成仅在版本未变化时清除 dirty；保存期间继续编辑必须保留后续修改；
- 标签切换保留各自选区、滚动位置和撤销/重做历史；关闭或工作区切换清理对应会话。

### 4.7 DOCX 保存和滚动备份策略

每次覆盖已有 DOCX 前必须完成以下顺序：

1. 重新校验工作区、相对路径、扩展名、符号链接、真实路径、普通文件和磁盘 revision；
2. 从当前已验证原文件创建或刷新同目录滚动备份 `<文件名>.wenshu.bak`；
3. 备份写入自身排他临时文件，完整写入、刷盘、关闭后再安全替换备份；
4. 根据提交的结构化模型生成新的 DOCX 字节；
5. 对生成字节执行大小、ZIP/OOXML 基础结构和可重新导入验证；
6. 将生成字节写入目标同目录的排他临时文件，完整写入、刷盘并关闭；
7. 替换目标前再次确认目标仍是同一 revision；
8. 使用不先删除、不先截断目标的安全替换流程；
9. 保存成功后返回新 revision、文件大小、兼容性信息和备份相对名称；
10. 任一步失败都保留原目标和 renderer 未保存内容，并尽力清理本次临时文件。

滚动备份只保留最近一次保存前版本，不在 Task 7 引入版本历史。若备份创建或验证失败，保存必须中止，不允许以“无备份模式”继续。备份文件不作为普通 `.docx` 出现在可编辑文件筛选中。

### 4.8 导出是基础重建，不承诺无损往返

- 保存后的 DOCX 由受支持中间模型重新生成，不修改原 OOXML 包中的任意节点；
- `supported` 文档应保证第 4.1 节范围的语义和基础格式往返；
- `degraded` 文档保存可能丢失未进入模型的内容，必须在首次编辑或保存前确认；
- 不尝试把未知 OOXML 片段与新导出内容合并；
- 不自行实现分页、Word 布局或完整样式继承引擎；
- “在外部 Office 可打开、受支持内容正确、未知内容不被谎称保留”优先于表面上的无警告保存。

### 4.9 新建、另存为与 DOCX 搜索边界

- Task 7 只打开和覆盖保存工作区内已有普通 DOCX；
- 使用 `docx` 生成保存产物即为本任务的“基础导出”，但不新增任意目标路径的“另存为”；
- 新建 DOCX、另存为、重命名、移动和删除属于后续文件管理任务；
- 当前 DOCX 查找替换与工作区 DOCX 正文搜索不在本任务范围；
- Task 6 的 TXT 搜索候选、匹配语义、上限和定位协议保持不变，不把 DOCX 隐式塞入 TXT 搜索器。

## 五、建议的数据模型与不变量

### 5.1 共享快照与请求

建议新增独立共享契约：

```ts
interface DocxDocumentSnapshot {
  readonly kind: 'docx';
  readonly relativePath: string;
  readonly name: string;
  readonly revision: string;
  readonly size: number;
  readonly model: DocxDocumentModel;
  readonly compatibility: DocxCompatibilityReport;
}

interface SaveDocxDocumentRequest {
  readonly relativePath: string;
  readonly expectedRevision: string;
  readonly model: DocxDocumentModel;
  readonly compatibilityConfirmationRevision?: string;
}
```

最终字段应保持最小化。请求不得包含工作区根、绝对路径、目标临时路径、备份路径、任意 XML、任意 HTML、替换策略或文件系统选项。

### 5.2 多类型标签状态

现有 `TextDocumentTabState` 应演进为共享生命周期与分类型正文的判别联合，例如：

```ts
type DocumentTabState = TextDocumentTabState | DocxDocumentTabState;
```

共享字段包括 `tabId`、`kind`、`relativePath`、`name`、`status`、`dirty`、`requestId`、`workspaceEpoch` 和错误；TXT 专有的 `lineEnding`、BOM、纯文本内容与 CodeMirror runtime 不得进入 DOCX 分支；DOCX 专有的结构化模型、兼容性报告、确认 revision 与 Tiptap runtime 不得进入 TXT 分支。

### 5.3 必须保持的不变量

1. 所有标签 `tabId` 唯一；
2. 所有标签规范相对路径唯一；
3. 活动 tabId 必须为空或引用现存标签；
4. 每个 live TXT 标签至多一个 CodeMirror 会话；
5. 每个 live DOCX 标签至多一个 Tiptap 会话；
6. loading、saving、conflict、error 与 dirty 的组合必须符合各文件类型状态机；
7. 同一标签不得并发保存；不同标签可以并行保存；
8. 保存完成只提交到仍存在且身份、requestId、epoch、路径和基线 revision 均匹配的标签；
9. 保存期间继续编辑时，旧保存成功不能清除新 dirty；
10. `degraded` 文档没有当前 revision 的用户确认时不得写入；
11. `read-only` 与 `rejected` 文档不得发起保存；
12. TXT 行为和 Task 6 搜索定位不因多类型抽象而改变。

## 六、模块与文件职责建议

### 6.1 共享契约

建议新增：

- `src/shared/docx.ts`：DOCX 模型、兼容性、快照、读写结果、错误码、固定上限和运行时校验；
- `src/shared/document.ts`：只保留通用文档身份或通过小型导出聚合现有 TXT 与 DOCX 类型，避免一次性重写所有 TXT 契约；
- `src/shared/desktop-api.ts`：新增固定 `readDocx` / `saveDocx` 窄接口。

### 6.2 主进程 DOCX 处理器

建议新增 `src/main/docx/` 或在 `src/main/document/docx/` 下集中：

- `inspect-docx-package.ts`：ZIP/OOXML 结构、关系和资源预算检查；
- `import-docx.ts`：Mammoth 与有限补充读取到中间模型；
- `export-docx.ts`：中间模型到 `docx` 产物；
- `read-docx-document.ts`：工作区路径安全、受控读取、revision 和导入；
- `save-docx-document.ts`：冲突、备份、生成、验证、临时写入和安全替换；
- `docx-ipc.ts`：固定 IPC 与请求运行时校验。

TXT 安全路径校验、完整读写和替换步骤可以提取为小型内部 helper，但不能借机暴露通用 renderer 文件系统 API，也不能进行与 Task 7 无关的大范围重构。

### 6.3 preload 与 DesktopApi

新增能力建议保持为：

```ts
document.readDocx(relativePath);
document.saveDocx(request);
```

preload 只做参数透传和结果返回，不解析 DOCX、不处理路径、不保存 Buffer。主进程 IPC 必须拒绝多余字段并对结构化模型执行有界运行时校验。

### 6.4 renderer 多文档 controller

- 将现有多 TXT 标签纯状态逐步演进为多类型标签状态；
- 共享打开、激活、关闭、工作区失效、dirty 统计和保存中保护；
- TXT 读取保存仍由现有分支处理；
- DOCX controller 负责读取、兼容性确认、编辑版本、保存和冲突；
- App 只按文件类型调度，不直接包含导入导出细节；
- 搜索结果仍只调度 TXT 打开和定位。

### 6.5 富文本编辑器组件

建议新增：

- `DocxEditorSessionHost.tsx`：Tiptap 生命周期、事务、选择、滚动和历史；
- `DocxToolbar.tsx`：只包含受支持格式操作；
- `DocxCompatibilityNotice.tsx`：兼容性等级、警告和确认入口；
- 纯转换模块：`DocxDocumentModel <-> Tiptap JSON`。

不要让通用 `DocumentPane` 直接操作 Tiptap 私有状态；它只按 `kind` 选择 TXT 或 DOCX 宿主并展示共享标签/保存状态。

## 七、Electron 与安全边界

### 7.1 新增能力的最小接口

renderer 只能提交：

- 工作区规范相对路径；
- 读取或保存请求身份；
- 预期 revision；
- 通过运行时校验且有界的 `DocxDocumentModel`；
- 必要时当前兼容性确认 revision。

renderer 不能提交：

- 工作区根或任意绝对路径；
- 备份、临时文件或替换目标路径；
- 原始 ZIP/OOXML 或任意 HTML；
- shell 命令、外部程序、网络 URL 或库配置；
- “强制覆盖”“跳过备份”“忽略校验”等危险策略。

### 7.2 必须保持的安全属性

- `nodeIntegration: false`；
- `contextIsolation: true`；
- renderer sandbox 保持启用；
- renderer 不直接导入 Node.js、Mammoth、JSZip 或 `docx` 文件系统能力；
- 主进程工作区根只来自 `workspace-session`；
- 每次读取和保存都重新校验路径、符号链接、真实路径和文件类型；
- DOCX 作为不可信 ZIP 处理，所有解析和模型转换都有资源上限；
- 不访问外部关系、不执行宏、不加载远程资源；
- 错误结果不泄漏原始异常、绝对路径、文件内容、XML、Buffer、句柄或调用栈；
- 日志不记录文档正文、模型全文、绝对路径、备份内容或临时名称；
- 保存不先删除、不先截断原文件；备份失败即保存失败。

## 八、测试要求

### 8.1 Task 1 至 Task 6 回归

- 所有现有测试必须实际执行并通过；
- TXT 读取、保存、冲突、换行、BOM、临时替换和错误语义不变；
- 多 TXT 标签、独立 CodeMirror 会话、关闭保护和窗口协调不变；
- 当前文件查找替换、工作区 TXT 搜索和结果定位不变；
- 不允许用新增 DOCX 测试替代既有回归。

### 8.2 模型、兼容性与转换测试

- 合法模型与所有非法结构的运行时校验；
- schemaVersion、节点数、文本长度、marks、列表深度和序列化预算；
- 段落、标题、marks、字号、颜色、列表和对齐导入；
- Mammoth/有限 OOXML 补充结果到项目模型；
- 项目模型到 Tiptap JSON，再回到项目模型；
- 项目模型到 `docx` 产物并重新导入；
- 不支持内容产生稳定兼容性警告；
- 未清洗 HTML、未知节点和危险属性不能进入模型。

### 8.3 主进程读取与安全测试

- 根目录与嵌套 `.docx` 读取；
- 大小写扩展名；
- 无工作区、非法路径、绝对路径、`..`、空段、盘符和 NUL；
- 目录、符号链接、junction、路径中间链接和工作区逃逸；
- 不存在、无权限、读取中变化和非普通文件；
- 恰好上限和超过上限；
- 非 ZIP、缺失关键 OOXML 部件、损坏关系、加密和资源预算超限；
- SHA-256 revision 基于原始字节；
- 预期与意外失败都转换为稳定错误。

### 8.4 保存、备份与失败恢复测试

- 无 dirty 不调用保存；
- expectedRevision 匹配时成功保存；
- 外部 revision 不一致返回冲突且零写入；
- 备份字节等于保存前原文件；
- 备份失败时不生成或替换目标；
- 导出失败、产物验证失败、临时打开/写入/sync/close/replace 失败；
- 目标在保存期间再次变化时中止替换；
- 任一失败都不删除、不截断原文件并保留 dirty；
- 临时文件尽力清理且主要错误不被清理错误覆盖；
- 保存成功返回新 revision，产物可重新导入且外部 Office 可打开；
- 保存期间继续编辑后旧保存成功不清除新 dirty；
- `degraded` 未确认、确认 revision 过期、`read-only` 和非法模型均拒绝保存。

### 8.5 IPC 与 preload 契约测试

- 只注册固定 DOCX 读写通道；
- 参数数量、字段白名单、字段类型、模型预算和 requestId 校验；
- 拒绝根路径、绝对路径、临时路径、备份路径、原始 HTML/XML 和危险策略字段；
- preload 只暴露窄接口，不暴露 `ipcRenderer`、Buffer 或任意调用器；
- 主进程结果不泄漏内部对象或原始异常。

### 8.6 多类型标签与富文本组件测试

- 文件树只允许普通 `.txt` 与 `.docx` 选择；
- 同一路径去重，TXT/DOCX 混合标签顺序与激活正确；
- DOCX loading、loaded、degraded、read-only、error、dirty、saving、conflict 状态；
- 基础格式工具栏及不可用状态；
- 编辑、撤销、重做、复制粘贴和无变化事务；
- 每标签选择、滚动和历史隔离；
- 保存、保存期间继续编辑、冲突和重新读取；
- dirty 关闭、工作区切换、窗口关闭和保存中保护；
- 关闭/切换/新请求后迟到读取、保存和确认结果安全忽略；
- Task 6 搜索结果仍只打开 TXT 并准确定位。

### 8.7 手工桌面与外部 Office 冒烟

- 开发模式和生产构建分别执行相同关键路径；
- 打开普通、复杂、损坏和接近 20 MiB 的 DOCX；
- 编辑每种受支持格式并保存；
- 用外部 Office 打开保存产物，确认正文、标题、marks、列表和对齐；
- 在外部 Office 修改文件后验证文枢冲突；
- 验证 `.wenshu.bak` 是保存前版本且能恢复；
- 验证保存失败后原文件仍能被外部 Office 打开；
- 验证混合 TXT/DOCX 标签、dirty 关闭、切换工作区和关闭窗口；
- 确认工作区没有遗留本次 `.wenshu-*` 临时文件；滚动备份除外；
- 控制台和终端无未处理异常、正文、XML、绝对路径或临时名称日志。

## 九、明确不在本任务范围内

- 新建 DOCX、另存为、重命名、移动、删除和文件资源管理器显示；
- TXT 或 DOCX 自动保存、保存全部、失焦保存和定时保存；
- DOCX 当前文件查找替换和工作区 DOCX 正文搜索；
- 工作区替换、正则搜索、持久索引和搜索缓存；
- 图片、表格、页眉页脚、脚注尾注、批注、修订、字段和公式编辑；
- 精确分页、纸张、页边距、分页符、分节、打印和 PDF 导出；
- 浮动对象、文本框、SmartArt、图表、OLE 和嵌入文件；
- 宏执行、外部模板、远程资源和脚本；
- 与 Microsoft Word 完整无损往返；
- 标签拖拽、固定、分屏、批量关闭和会话恢复；
- 主题、字体设置、自动备份开关或备份历史管理；
- 通用 Office 文件处理框架、插件系统、云端、协作或 AI 功能；
- 为性能预先引入 worker pool、数据库或后台服务；只有测量证明需要时另行规划。

## 十、工作包与执行顺序

每次只实施一个工作包；当前工作包门禁失败时不得进入下一包。

### WP0：基线稳定、夹具与兼容性技术验证

- 完成第 3 节全部前置检查；
- 修复或明确当前 Windows junction 清理与 React `act(...)` 测试警告；
- 建立最小 DOCX 夹具和外部 Office 验证环境；
- 安装或在隔离 spike 中验证 Tiptap/ProseMirror、Mammoth、`docx` 与 JSZip；
- 产出第 4.1 节兼容性矩阵的实测结论、固定预算和依赖清单；
- 尚不把 DOCX 能力暴露给产品 UI。

验收门禁：Task 6 基线稳定可重复；夹具可审计；导入、编辑 schema、导出和重新打开形成最小闭环；所有未满足格式均有明确降级决策。

### WP1：共享 DOCX 模型、契约与纯转换

- 新增有版本、有上限的 `DocxDocumentModel`；
- 新增兼容性报告、读写请求/结果和稳定错误；
- 实现运行时校验；
- 实现导入结果到模型、模型到 Tiptap JSON、Tiptap JSON 到模型、模型到导出描述的纯转换；
- 增加第 8.2 节测试；
- 尚不注册 IPC、不读取或写入用户文件。

验收门禁：模型与库解耦、可序列化、可校验且有资源上限；转换与兼容性结果确定；完整 `check` 与 `build` 通过。

### WP2：主进程受控读取、检查与 DOCX 导入

- 实现路径、扩展名、符号链接、普通文件、大小和 revision 校验；
- 实现 ZIP/OOXML 结构和资源预算检查；
- 实现 Mammoth 导入与必要的有限属性补充；
- 生成兼容性等级和警告；
- 增加第 8.3 节测试；
- 尚不注册 renderer IPC。

验收门禁：不越界、不跟随链接、不请求网络、不执行文档内容；普通和复杂样本结果稳定；完整 `check` 与 `build` 通过。

### WP3：安全导出、滚动备份与替换

- 实现中间模型到基础 DOCX 字节；
- 实现生成产物重新检查和导入验证；
- 实现 expectedRevision 冲突、滚动备份、排他临时写入、sync、close 和安全替换；
- 实现保存期间再次变化检测与清理；
- 增加第 8.4 节测试；
- 尚不向 renderer 暴露写入。

验收门禁：所有失败点可注入验证；原目标不先删除或截断；备份失败禁止覆盖；成功产物可重新导入并被外部 Office 打开；完整 `check` 与 `build` 通过。

### WP4：固定 IPC、preload 与多类型标签状态

- 注册固定 DOCX 读写 IPC 并扩展 DesktopApi/preload；
- 对所有请求执行字段白名单和运行时校验；
- 将标签核心演进为 TXT/DOCX 判别联合；
- 保持 TXT controller、CodeMirror runtime 和搜索定位行为；
- 实现 DOCX 打开、异步有效性、dirty、保存、冲突与确认状态；
- 增加第 8.5 节及状态不变量测试。

验收门禁：renderer 暴露面保持窄且无任意路径能力；混合标签状态确定；TXT 全量回归；完整 `check` 与 `build` 通过。

### WP5：DOCX 富文本编辑器与兼容性 UI

- 接入 Tiptap/ProseMirror 最小扩展；
- 实现段落、标题、marks、字号、颜色、列表和对齐工具栏；
- 实现每标签富文本会话、选择、滚动、撤销/重做和内容版本；
- 实现兼容性等级、警告、只读态和 revision 绑定确认；
- 文件树支持选择普通 `.docx`；
- 增加第 8.6 节组件和交互测试。

验收门禁：支持范围可编辑可撤销；不支持内容不被静默保存；会话隔离且无 TXT 回归；完整 `check` 与 `build` 通过。

### WP6：保存闭环、生命周期保护与混合场景

- 接通保存按钮与 `Ctrl+S`；
- 实现保存中、成功、失败、冲突、重新读取和备份提示；
- 复用并验证 dirty 关闭、工作区切换与窗口关闭保护；
- 验证保存期间继续编辑与多个标签并行保存；
- 验证 TXT 搜索结果与 DOCX 标签共存；
- 补齐第 8.6 节跨组件测试。

验收门禁：DOCX 从打开到安全保存形成闭环；任何失败不丢原文件或编辑；混合标签生命周期可靠；完整 `check` 与 `build` 通过。

### WP7：整体验收、兼容性观察与文档

- 执行全部自动检查和生产构建；
- 完成第 8.7 节开发与生产桌面冒烟；
- 记录普通、复杂和接近上限 DOCX 的读取、渲染与导出耗时；
- 记录外部 Office 程序及版本、格式往返结果和已知差异；
- 更新 README、项目基线、测试指南和项目结构中的实际能力；
- 将 Roadmap 中 Task 7 标记为完成；
- 新增 `TASK_007_COMPLETION_REPORT.md`；
- 仅在第十一节全部满足后把本文件状态改为`已完成`并勾选验收项。

验收门禁：文档与实际行为一致；自动检查、构建、桌面冒烟、外部 Office 验证和备份恢复验证均有可核对证据。

## 十一、最终验收标准

以下条件全部满足后，Task 7 才可标记为完成。

### 11.1 读取与兼容性验收

- [x] 文件树可以选择普通 `.docx`，目录、链接、`.docm` 和其他类型不可读取；
- [x] 普通段落、标题、marks、字号、颜色、列表和对齐按兼容矩阵导入；
- [x] 中文、英文、emoji、空段落和多段落正确；
- [x] 普通 DOCX 数秒内打开且界面不失去响应；
- [x] 损坏、加密、伪装、超限和资源预算超限返回稳定错误；
- [x] 复杂文档返回确定兼容性等级和警告；
- [x] `degraded` 需 revision 绑定确认，`read-only` 不可编辑保存；
- [x] 不读取网络关系、不执行宏或嵌入内容。

### 11.2 编辑器与多标签验收

- [x] 基础段落、标题、粗体、斜体、下划线、字号、颜色、列表和对齐可编辑；
- [x] 复制、剪切、粘贴、撤销和重做可用；
- [x] 无实际变化不产生 dirty，编辑后产生 dirty；
- [x] TXT/DOCX 混合标签路径唯一、顺序、激活和关闭正确；
- [x] 每个 DOCX 标签的模型、选择、滚动、历史、dirty 和错误独立；
- [x] 普通切换不丢历史、不重置模型、不重复读取；
- [x] 关闭或工作区切换清理对应富文本会话；
- [x] TXT CodeMirror、多标签和搜索定位行为无回归。

### 11.3 保存与数据安全验收

- [x] 保存前校验 expectedRevision，外部变化默认不覆盖；
- [x] 每次覆盖前成功创建 `<文件名>.wenshu.bak`，内容为保存前原文件；
- [x] 备份失败时保存中止，原文件与 dirty 保留；
- [x] 生成产物在替换前通过大小、OOXML 结构和重新导入验证；
- [x] 临时写入执行完整写入、sync、close 和同目录安全替换；
- [x] 替换前再次检测保存期间的外部变化；
- [x] 任一失败点都不先删除、不截断或破坏原文件；
- [x] 保存期间继续编辑不丢后续修改，不错误清除 dirty；
- [x] 保存成功返回新 revision，文枢与外部 Office 均可重新打开；
- [x] dirty 关闭、工作区切换、窗口关闭和保存中保护完整。

### 11.4 Electron 与安全验收

- [x] DOCX 路径只来自当前主进程工作区会话与规范相对路径；
- [x] 每次读写都重新执行边界、链接、真实路径、类型和大小校验；
- [x] IPC 请求字段白名单和模型运行时预算完整；
- [x] renderer 不拥有 Node.js、文件系统、ZIP、OOXML 或任意 IPC 能力；
- [x] `nodeIntegration: false`、`contextIsolation: true` 和 sandbox 保持；
- [x] DOCX 输入被视为不可信内容且不会触发网络、脚本、宏或嵌入对象；
- [x] 错误、日志和跨进程结果不泄漏正文、XML、绝对路径、Buffer、句柄或调用栈；
- [x] 工作区除目标 DOCX、滚动备份和保存期间临时文件外没有新增持久产物。

### 11.5 质量验收

- [x] 第 8 节模型、转换、安全读取、保存、备份、IPC、状态和组件测试完整；
- [x] Task 1 至 Task 6 既有测试实际执行并通过；
- [x] 条件跳过仅限有说明且有确定性 mock 覆盖的环境能力；
- [x] `typecheck`、`lint`、`format:check`、`test` 和完整 `check` 通过；
- [x] `build` 通过；
- [x] 开发模式与生产构建桌面冒烟完成；
- [x] 至少一种外部 Office 程序完成导出打开与外部冲突验证；
- [x] 备份恢复、保存失败保留原文件和临时文件清理已手工验证；
- [x] README、项目基线、测试指南、任务文档和完成报告与实际行为一致；
- [x] 未加入第九节明确排除的功能。

## 十二、失败处理与决策规则

- 无工作区、非法路径或非 `.docx` 返回稳定错误，不猜测或修补路径；
- 资源超限、结构损坏、加密或关键部件缺失时不返回部分可编辑模型；
- 未知内容必须进入兼容性报告，不能被静默忽略后宣称完全支持；
- `degraded` 未确认、确认 revision 失效或 `read-only` 时拒绝保存；
- 外部 revision 冲突时不自动覆盖、不自动合并，也不覆盖本地编辑；
- 备份失败时不继续目标替换；
- 生成或重新导入验证失败时不写目标；
- 目标在保存期间变化时清理本次临时文件并返回冲突；
- 保存主要错误优先，清理错误只做安全诊断且不覆盖主要错误；
- 若 Windows 无法可靠使用现有 rename 语义，必须先用适配器测试确定安全替换方案，不得先删除目标；
- 若 Mammoth 无法支持某一已列格式，优先缩小兼容矩阵或做有限属性补充，不自行实现完整 OOXML 引擎；
- 若 Tiptap 扩展引入超出范围的 UI 或状态，使用最小 schema 和命令封装，不开放额外功能；
- 若解析或导出出现性能问题，先测量 ZIP、导入、模型转换、渲染和导出阶段，再决定是否规划 worker；
- 任何需要任意路径、强制覆盖、跳过备份、网络访问或执行外部程序的建议都必须停止当前工作包并单独评审；
- 不得用关闭安全设置、删除测试、弱化断言或扩大超时制造通过结果。

## 十三、执行提示模板

每个工作包建议使用以下固定提示，只替换工作包编号和内容：

> 阅读 `README.md`、`docs/PROJECT_BASELINE.md`、`docs/DEVELOPMENT_ENVIRONMENT.md`、`docs/TESTING.md`、`docs/TASK_006_COMPLETION_REPORT.md`、`docs/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md` 以及与当前工作包直接相关的源码和测试。只实现 TASK-007 的 WPx，不提前实现后续工作包，不进行无关重构，不添加新建/另存为、文件管理、自动保存、DOCX 搜索、复杂 Word 格式、宏、云端或 AI。DOCX 通过项目结构化中间模型导入、编辑和导出；根路径只能来自主进程工作区会话；所有读写必须遵守路径、链接、资源预算、revision、兼容性确认、滚动备份、临时写入、产物验证和安全替换决策。不得削弱 TXT、多标签、搜索定位、Electron sandbox 或未保存保护。修改后运行当前工作包要求的测试、完整 `check` 和 `build`。最终报告修改文件、关键决策、命令结果、夹具/兼容性证据、未解决问题和是否满足当前工作包门禁。

执行规则：

- 一次对话只完成一个工作包；
- 先读当前工作包直接相关的文件和测试，不重复扫描无关依赖；
- 不覆盖用户已有修改；
- 每个工作包完成后审查 diff 并保留可审计的 Git 恢复点；
- WP0 不向产品 UI 暴露 DOCX 能力；
- WP1 后复核模型边界、预算和库解耦；
- WP2 后复核不可信 ZIP、路径、链接、网络和兼容性；
- WP3 后逐个注入备份与保存失败点；
- WP4 后复核 IPC 暴露面、标签不变量和 TXT 回归；
- WP5 后复核格式矩阵、会话隔离和兼容性确认；
- WP6 后复核保存期间编辑、冲突和生命周期保护；
- 只有 WP7 可以编写完成报告、勾选最终验收项并将状态改为`已完成`。

## 十四、交付物

任务完成时应交付：

1. 有版本、有预算的 DOCX 结构化中间模型；
2. 兼容性等级、警告、读取/保存请求结果和稳定错误契约；
3. DOCX ZIP/OOXML 基础结构与资源预算检查；
4. Mammoth/有限属性补充到中间模型的导入器；
5. 中间模型到 `docx` 的基础导出器及重新导入验证；
6. 工作区受控 DOCX 读取器；
7. revision 冲突、滚动备份、临时写入和安全替换保存器；
8. 固定 DOCX IPC 与受控 preload API；
9. TXT/DOCX 判别联合标签状态与多文档 controller；
10. Tiptap/ProseMirror DOCX 编辑器、基础格式工具栏和兼容性 UI；
11. 模型、转换、读取、安全、保存、备份、IPC、状态、组件和回归测试；
12. 不含隐私的 DOCX 夹具或确定性构造器；
13. 更新后的 README、项目基线、测试指南和项目结构说明；
14. `TASK_007_COMPLETION_REPORT.md`，至少记录：
    - 实现摘要与最终兼容性矩阵；
    - 新增依赖、版本、用途和许可证核对；
    - 中间模型、预算与运行时校验；
    - ZIP/OOXML 检查、导入和不支持内容检测；
    - 富文本编辑器 schema、会话与 dirty 策略；
    - 导出、重新导入验证、revision、备份和安全替换；
    - 多类型标签、异步身份和生命周期保护；
    - Electron/IPC 安全边界；
    - 自动测试、构建和 Windows 冒烟证据；
    - 外部 Office 程序、版本和往返观察；
    - 性能数据、已知限制及是否满足全部验收标准。

## 十五、完成后的下一任务入口

Task 7 完成后的下一任务已规划为 [TASK-008：工作区 DOCX 正文搜索与富文本结果定位](./TASK_008_DOCX_WORKSPACE_SEARCH.md)：复用 Task 6 已验证的搜索请求、取消、预算、统计和过期结果原则，但为 DOCX 单独设计规范正文投影、文本块位置映射、结果 revision 和富文本编辑器定位，不把 DOCX 当作 UTF-8 TXT 读取。

在 Task 7 完成前不应并行把 DOCX 加入工作区搜索。先验证“受控读取 → 兼容性判断 → 结构化编辑 → 备份 → 安全导出”的单文件闭环，再扩展跨文档搜索。
