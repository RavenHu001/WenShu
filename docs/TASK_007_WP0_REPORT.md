# TASK-007 WP0 报告：基线锁定、DOCX 夹具与兼容性技术验证

> 工作包范围：TASK-007 第 10 节 WP0（第 3 节全部前置检查、测试可靠性修复、DOCX 夹具、
> Mammoth/Tiptap/`docx`/JSZip 最小闭环验证、兼容性矩阵与固定预算冻结）。
> 实施日期：2026-08-10；验证平台：Windows 11（zh-CN），Node.js 22.15.0，npm 10.9.2，
> Electron 37.x，Microsoft Word 16.0.20228.20158（本机可用，作为外部 Office 验证环境）。
> 本工作包不向产品 UI 暴露 DOCX 能力；不修改任何产品功能代码。

## 1. 前置检查结果（任务第 3.1 / 3.2 节）

### 1.1 必读材料（3.1）

已全部阅读：`README.md`、`docs/PROJECT_BASELINE.md`、`docs/DEVELOPMENT_ENVIRONMENT.md`、
`docs/TESTING.md`、`docs/TASK_006_COMPLETION_REPORT.md`、`docs/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md`，
以及 WP0 直接相关的源码与测试：

- `src/main/index.ts`、`src/main/document/`（读取器、保存器、IPC）、
  `src/main/workspace/`（扫描器、会话、IPC）、`src/main/search/`、`src/main/window/`；
- `src/preload/index.ts`、`src/shared/desktop-api.ts`、`document.ts`、`workspace.ts`、`search.ts`；
- `src/renderer/App.tsx`、`components/document/`、`components/workspace/`、`components/search/`、
  `lib/use-text-documents.ts`、`text-document-tabs.ts`、`use-editor-sessions.ts`、`use-workspace.ts`；
- 既有测试：读取器 49、保存器 51、文档 IPC 33、preload 契约 16、窗口关闭 8、扫描器 11、
  标签不变量 23、转移 32、多标签组件 64、查找替换 9、搜索契约/匹配器/搜索器/搜索 IPC/
  搜索 controller/搜索侧栏/结果定位等 Task 6 全量回归。

### 1.2 工作树与质量基线（3.2）

- `git status --short`：**干净**（无未提交的用户修改需要保护）；
- `main` 已包含 Task 6 与 `TASK_006_COMPLETION_REPORT.md`（`224d850 T7规划` 之后的提交历史）；
- 以下命令依次执行（`check` 与 `build` 未并行）：

| 命令                       | 结果                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `typecheck`（5 tsconfig）  | **通过**（基线）                                                                                               |
| `lint`（--max-warnings=0） | **通过**（0 warning，基线）                                                                                    |
| `format:check`             | **通过**（基线；Windows 检出环境行尾策略固定）                                                                 |
| `test`（19 文件 466 用例） | **通过**：463 passed / 3 skipped（真实 symlink 权限条件跳过，mock 拒绝分支覆盖）；复现一条 React 19 `act` 警告 |
| `build`                    | **通过**（基线后再验证，见第 6 节）                                                                            |

基线结论与 TASK-006 完成报告一致：19 个测试文件、463 通过、3 条件跳过。**junction 清理
`EBUSY` 未复现**（`tests/document/read-text-document.test.ts` 49 项全部执行，2 个真实链接
用例按权限条件跳过，与规划基线一致）；React 组件测试的 `act(...)` 警告复现，已在 WP0
归因并修复（见第 3 节）。

## 2. DOCX 夹具（任务第 3.3 节）

夹具全部由固定构造器生成（`tests/docx/docx-fixture-builder.ts`，内存构造，不提交二进制夹具，
不含真实用户文档），`tests/docx/docx-fixture-suite.test.ts` 校验结构并固定审计结论：

| 夹具 id                 | 用途与预期结构                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ok-empty`              | 空文档（无段落）                                                                                                      |
| `ok-plain`              | 中文/英文/emoji/空段落/多段落/前导空白 run                                                                            |
| `ok-headings`           | 标题 1-3 + 正文（pStyle Heading1-3）                                                                                  |
| `ok-marks`              | 粗体、斜体、下划线及组合（w:b / w:i / w:u）                                                                           |
| `ok-font-size-color`    | 9/10.5/14 pt（w:sz 18/21/28）+ `#FF0000`/`#336699`（w:color）                                                         |
| `ok-lists`              | 项目符号/编号列表 + 嵌套层级（numbering.xml + numPr，level 0/1）                                                      |
| `ok-alignment`          | 左/中/右/两端/未指定（w:jc）                                                                                          |
| `complex-image`         | 1×1 PNG 图片（w:drawing，Mammoth run 子节点 image）                                                                   |
| `complex-table`         | 2×2 简单表格（w:tbl，Mammoth table 节点）                                                                             |
| `complex-header-footer` | 页眉页脚（word/header1.xml、word/footer1.xml）                                                                        |
| `complex-comment`       | 一条批注（word/comments.xml + commentRange/reference，Mammoth comments 模型）                                         |
| `complex-revision`      | 修订模拟（JSZip 对 document.xml 注入 w:ins/w:del，Mammoth 不识别，需 XML 扫描）                                       |
| `complex-link`          | 外部超链接（Mammoth hyperlink 节点，降级为可见文本）                                                                  |
| `fail-corrupt`          | 非 ZIP 随机字节（Mammoth/JSZip 稳定拒绝）                                                                             |
| `fail-fake-docx`        | 纯文本伪装 `.docx`（稳定拒绝）                                                                                        |
| `fail-missing-parts`    | ZIP 但缺 `word/document.xml`（稳定拒绝）                                                                              |
| `fail-encrypted-sim`    | 加密包部件布局模拟（只有 EncryptionInfo + EncryptedPackage，无关键 OOXML 部件，稳定拒绝；**非**真实 Office 加密文件） |
| `fail-oversize`         | 合法 DOCX + 追加 21 MiB 填充（ZIP 可解析但文件大小超 20 MiB 上限，解析前大小检查拒绝）                                |

确定性验证：同一夹具两次构造除 `docProps/core.xml` 外逐部件字节一致。`docx@9` 的 core.xml
时间戳固定取当前时间（`TimestampElement` 使用 `new Date()`），该部件不确定，已记录为已知
限制；不影响正文/结构部件确定性、夹具审计与 revision 语义。

## 3. 测试可靠性：React 19 `act` 警告归因与修复（第 3.2 节门禁）

### 3.1 复现

`tests/search/result-locate.test.tsx` 首条用例复现 Task 6 已知的一次性 stderr 警告：
"A component suspended inside an `act` scope, but the `act` call was not awaited."

### 3.2 归因（对 `react.development.js` 的 `act`/`flushActQueue` 与 RTL `act-compat` 做临时插桩定位）

1. 触发路径：RTL `eventWrapper` 内的**同步** `act`（从不被 await）在 `flushActQueue` 因
   `isFlushing` 为 true 被跳过时，act 队列残留条目，随后调度该一次性警告；
2. 来源：`@testing-library/user-event@14.6.1` 的 `prepareDocument` 在 `document` 上安装
   **捕获阶段 blur 监听器**，输入框失焦且值变化时经 `dispatchDOMEvent` 再派发 `change`；
   该派发发生在前一个 `act` 的 flush 进行中（isFlushing=true）时触发警告；
3. 具体场景：`submitSearch` 用 `user.type` + `user.keyboard('{Enter}')` 输入搜索词后，
   `clickMatch` 打开定位标签、编辑器聚焦使搜索输入框失焦，触发上述 blur→change 派发。

### 3.3 修复

`result-locate.test.tsx` 的 `submitSearch` 改用等价的 `fireEvent` 序列（click 搜索 →
`change` 输入值 → keyDown Enter → form submit），保持被测行为（提交查询、状态转移）不变，
同时消除 user-event 的 document 捕获派发路径。12 条用例断言原样通过；键入语义仍由
`tests/search/search-sidebar.test.tsx`（保留 user-event）覆盖。全量测试不再出现该警告。

### 3.4 处置记录

- junction 清理 `EBUSY`：未复现（读取器测试 49 项实际执行，2 个真实链接用例按本机权限条件跳过，
  与规划基线一致；拒绝分支由 lstat mock 确定性覆盖）；
- 未用删除测试、整文件跳过、弱化断言或延长超时制造绿色基线。

## 4. Mammoth / JSZip 导入实测结论（第 3.4 节结论 1/2）

对夹具逐项实测（`tests/docx/docx-fixture-suite.test.ts` 固化）：

| 内容                | Mammoth 文档模型（`transformDocument`）实测                               | 结论                                                        |
| ------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 段落/空段落         | 全部段落进入 `children`，空段落为含空 run 的 paragraph（HTML 才丢弃空段） | 模型直接可用                                                |
| 标题 1-3            | paragraph.styleId `Heading1-3` / styleName `Heading N` 保留               | 模型直接可用（含中文 `标题 N` 由 WP2 映射）                 |
| 粗体/斜体           | run.isBold / run.isItalic                                                 | 模型直接可用                                                |
| 下划线              | run.isUnderline（模型有；HTML 默认不输出）                                | 模型直接可用，**无需 JSZip**                                |
| 字号                | run.fontSize（点数，如 9/10.5/14）                                        | 模型直接可用，**无需 JSZip**                                |
| 文字颜色            | 模型**不含** color                                                        | **需要 JSZip 有限补充读取 `w:color`**                       |
| 项目符号/编号       | paragraph.numbering `{isOrdered, level}`（level 为字符串）                | 模型直接可用（层级 0/1 实测）                               |
| 段落对齐            | paragraph.alignment（left/center/right/both；justify 映射为 both）        | 模型直接可用，**无需 JSZip**                                |
| 超链接              | run 子节点 type `hyperlink`（href/targetFrame）                           | 模型可检测，降级为可见文本                                  |
| 图片                | run 子节点 type `image`（contentType/altText）                            | 模型可检测，警告+省略                                       |
| 表格                | children 顶层 type `table`（tableRow/tableCell 递归）                     | 模型可检测，警告+省略                                       |
| 批注                | 文档模型 `comments[]` + paragraph 内 `commentReference` 子节点            | 模型可检测，警告+省略                                       |
| 页眉页脚            | 模型**不含**                                                              | **需要 JSZip 检查 `word/header*.xml` / `word/footer*.xml`** |
| 修订（w:ins/w:del） | 模型**不识别**：w:delText 也进入正文                                      | **需要 JSZip 扫描 document.xml 中的 `w:ins`/`w:del`**       |

### 4.1 失败样本实测

- 损坏 ZIP / 伪装扩展名：Mammoth 抛 "Can't find end of central directory"（稳定错误）；
- 缺失 `word/document.xml`（含加密模拟布局）：抛 "Could not find main document part"；
- 超限样本：ZIP 读取器忽略尾部填充仍可解析，**文件大小检查必须在 ZIP 解析之前**（WP2 顺序：
  大小检查 → ZIP 结构/预算检查 → Mammoth 导入）；
- 全程不读取网络外部关系（`externalFileAccess: false` 为默认），不执行文档内容。

### 4.2 对 WP2 导入器的固定要求（本报告冻结）

1. 以 `mammoth.convertToHtml({buffer}, {transformDocument})` 的文档模型为语义导入来源
   （选项是**第二参数**；Mammoth 1.12.1 实测确认，第一参数中的 transformDocument 会被忽略）；
2. JSZip 只做三类有限补充：`w:color` 提取（逐 run）、`word/header*.xml`/`word/footer*.xml`
   存在性、document.xml 中 `w:ins`/`w:del` 存在性；不解析其他 OOXML 属性；
3. 兼容性警告来源固化：图片/表格/批注/超链接来自 Mammoth 模型，页眉页脚/修订来自 JSZip 检查。

## 5. Tiptap / ProseMirror 最小 schema 与导出映射（第 3.4 节结论 3/4）

### 5.1 扩展链（实测无重复警告）

```ts
StarterKit.configure({ heading: { levels: [1, 2, 3] } })  // v3 已含 underline、bold、italic、列表、历史等
+ TextStyle + Color + FontSize（@tiptap/extension-text-style 的 FontSize）
+ TextAlign.configure({ types: ['heading', 'paragraph'] })
```

- `getSchema` 在 node 环境可用（无需 DOM）；schema 节点集合：paragraph, heading, bulletList,
  orderedList, listItem, doc, text 等 11 个；标记集合：bold, italic, underline（StarterKit v3 内置，
  不得重复注册否则触发 "Duplicate extension names" 警告）, textStyle, link, code, strike；
- color/fontSize 挂在 textStyle 标记 attrs（`{color, fontSize}`，默认 null；fontSize 为 `'18px'` 字符串）；
- JSON 文档 `schema.nodeFromJSON` → `node.toJSON()` 往返成立；默认属性（color:null、textAlign:null）
  会被物化导致字符串不相等，语义等价（WP1 转换做归一化，已记录为转换要求）；
- StarterKit 默认含 link 扩展：本任务超链接降级为可见文本，WP5 决定用
  `StarterKit.configure({ link: false })` 关闭 link 输入能力（记录为 WP5 决策点）。

### 5.2 `docx` 导出映射（XML 级实测）

`docx@9.7.1` 对 MiniModel 的导出已验证：标题 → `w:pStyle w:val="HeadingN"`；粗/斜/下划线 →
`w:b`/`w:i`/`w:u w:val="single"`；字号 → `w:sz`（半磅值）；颜色 → `w:color w:val="RRGGBB"`；
对齐 → `w:jc`；项目符号/编号 → `w:numPr`（配合 `numbering.config` 生成 numbering.xml，level 0/1
实测可被 Mammoth 重新识别为 `{isOrdered, level}`）。round-trip 最小闭环：
**Mammoth 导入 → MiniModel → `docx` 导出 → Mammoth 重新导入**，正文、标题、marks、字号、
对齐、列表语义一致（颜色经 JSZip 补充读取，Mammoth 模型不含）。

## 6. 性能观察（第 3.4 节结论 6；一次性观察，非基准门禁）

临时观察脚本（真实库路径，观察后已删除）实测：

| 场景                                         | 结果                              |
| -------------------------------------------- | --------------------------------- |
| 300 段普通文档 `docx` 导出                   | ≈ 31 ms（产物约 10 KiB）          |
| 300 段 Mammoth `convertToHtml`（含模型捕获） | ≈ 47 ms；`extractRawText` ≈ 14 ms |
| 2000 段导出 / Mammoth 导入                   | ≈ 41 ms / ≈ 69 ms                 |
| JSZip 加载普通 DOCX                          | < 1 ms                            |

性能冒烟测试（`docx-fixture-suite.test.ts`）固定：300 段文档构造+解析+导出合计 < 10 s
（宽松上限，避免受控环境抖动误报），满足"数秒内打开"目标。

## 7. 固定预算（第 4.5 节；WP0 冻结数值，WP1 固化到 `src/shared/docx.ts`）

| 预算                          | 冻结值                    | 依据/说明                                                       |
| ----------------------------- | ------------------------- | --------------------------------------------------------------- |
| 普通 DOCX 文件压缩后大小      | 20 MiB                    | 任务固定值；`fail-oversize` 夹具覆盖                            |
| ZIP 条目数                    | 128                       | `docx` 库产物约 25 条；夹具套件断言                             |
| 单个关键 XML 解压大小         | 1 MiB                     | 正常文档 document.xml 约 3-35 KiB；夹具套件断言                 |
| ZIP 总解压大小                | 64 MiB                    | 夹具套件断言                                                    |
| 模型块数（导入后 block 数）   | 20 000                    | 20 MiB 文档的宽松上界；WP1 固化常量并测试                       |
| 单块 run 数 / 单 run 文本长度 | 512 / 4096（UTF-16 单元） | WP1 固化常量并测试                                              |
| 列表最大层级                  | 5                         | Mammoth 默认 style map 支持到 level 5                           |
| 单 run marks 数量             | 8                         | 受支持 mark 类型上限（bold/italic/underline/color/fontSize 等） |
| 模型序列化大小                | 8 MiB                     | 与解压预算一致的 IPC 保护上界                                   |

## 8. 依赖清单与许可证（第 3.4 节结论 7）

新增直接依赖（`package.json`，锁文件已更新）：

| 依赖                           | 版本   | 许可证                        | 用途                                       |
| ------------------------------ | ------ | ----------------------------- | ------------------------------------------ |
| `mammoth`                      | 1.12.1 | BSD-2-Clause                  | DOCX 语义导入（文档模型 + 警告）           |
| `jszip`                        | 3.10.1 | MIT OR GPL-3.0（按 MIT 使用） | ZIP/OOXML 结构、资源预算与有限补充读取     |
| `docx`                         | 9.7.1  | MIT                           | 中间模型 → 基础 DOCX 导出                  |
| `@tiptap/core` / `@tiptap/pm`  | 3.29.2 | MIT                           | Tiptap/ProseMirror 编辑器核心              |
| `@tiptap/react`                | 3.29.2 | MIT                           | React 绑定（WP5）                          |
| `@tiptap/starter-kit`          | 3.29.2 | MIT                           | 最小扩展集（含 underline）                 |
| `@tiptap/extension-text-style` | 3.29.2 | MIT                           | textStyle 标记（Color/FontSize 依赖）      |
| `@tiptap/extension-color`      | 3.29.2 | MIT                           | 文字颜色                                   |
| `@tiptap/extension-text-align` | 3.29.2 | MIT                           | 段落对齐                                   |
| `@tiptap/extension-underline`  | 3.29.2 | MIT                           | 备用（StarterKit v3 已含；WP5 不重复注册） |

兼容性核对：@tiptap v3.29.2 peerDependencies 支持 React 17/18/19 与 Electron 37（Chromium 版本
无关）；TypeScript 5.8 严格模式（`exactOptionalPropertyTypes`）下 `docx` 构造参数需条件展开
（已在夹具代码处理）。`npm audit`：新增依赖无告警；现存 high 均为既有问题
（Electron 37 固定版本、eslint 工具链的 brace-expansion），不属于本任务引入，记录为已知限制。

## 9. 修改文件

| 文件                                            | 变更                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `tests/docx/docx-fixture-builder.ts`（新增）    | 18 个 DOCX 夹具的确定性构造器（内存构造，含普通/复杂/失败样本与修订 XML 补丁）                               |
| `tests/docx/docx-fixture-suite.test.ts`（新增） | 夹具结构、Mammoth 映射、JSZip 补充读取、复杂样本检测、失败样本、最小闭环、Tiptap schema、性能冒烟（24 用例） |
| `tests/search/result-locate.test.tsx`（修改）   | `submitSearch` 由 user-event 键入改为等价的 fireEvent 序列，消除 React 19 act 一次性警告（断言不变）         |
| `package.json` / `package-lock.json`（修改）    | 新增第 8 节依赖清单（Tiptap v3 最小集、Mammoth、JSZip、docx）                                                |
| `docs/TASK_007_WP0_REPORT.md`（新增）           | 本报告                                                                                                       |

未修改任何产品功能代码；未向产品 UI 暴露 DOCX 能力；`git status --short` 仅有上述文件。

## 10. 兼容性矩阵冻结（第 4.1 节实测版）

| 内容                 | 导入           | 编辑           | 导出           | WP0 实测依据                                                   |
| -------------------- | -------------- | -------------- | -------------- | -------------------------------------------------------------- |
| 普通段落、空段落     | 支持           | 支持           | 支持           | 模型保留空段；round-trip 一致                                  |
| 标题 1-3             | 支持           | 支持           | 支持           | styleId/styleName → heading；导出 pStyle 往返                  |
| 粗体、斜体、下划线   | 支持           | 支持           | 支持           | isBold/isItalic/isUnderline 往返                               |
| 基础字号             | 支持           | 支持白名单值   | 支持           | fontSize 点数；导出 w:sz 往返                                  |
| 文字颜色             | 支持普通 RGB   | 支持 `#RRGGBB` | 支持           | JSZip 补充读取 w:color；导出 w:color                           |
| 项目符号、编号列表   | 支持基础层级   | 支持           | 支持           | numbering {isOrdered, level} 往返（层级 ≤5）                   |
| 段落对齐             | 支持 4 种      | 支持           | 支持           | alignment 模型往返（justify↔both）                             |
| 超链接               | 降级为可见文本 | 不编辑链接属性 | 导出为普通文本 | hyperlink 节点检测（WP5 关 link 输入）                         |
| 图片、表格           | 警告并省略     | 不支持         | 不承诺保留     | image/table 节点检测                                           |
| 页眉页脚、脚注尾注   | 不进入模型     | 不支持         | 不承诺保留     | JSZip header/footer 部件检测（脚注尾注 WP2 补扫描 notes 部件） |
| 批注、修订           | 不进入模型     | 不支持         | 不承诺保留     | comments 模型 + JSZip w:ins/w:del 扫描                         |
| 字段、公式、浮动对象 | 不进入模型     | 不支持         | 不承诺保留     | 依赖模型检测 + 未知节点降级                                    |
| 宏、嵌入对象         | 不执行         | 不支持         | 不保留         | 不执行文档内容；`fail-encrypted-sim` 稳定拒绝                  |

未满足格式均有明确降级决策（警告码由 WP1 固化）：图片、表格、页眉页脚、批注、修订、超链接
之外，WP1 补充"未知样式/其他未识别内容"警告来源（Mammoth 警告消息 + 模型未知节点类型）。

## 11. 未解决问题与已知限制

1. **docx@9 产物非完全确定**：core.xml 时间戳固定取当前时间（`TimestampElement` 用 `new Date()`），
   两次保存字节必然不同；revision 基于实际字节不受影响，保存器无需确定性产物；
2. **Mammoth 不读颜色/页眉页脚/修订**：三类信息依赖 JSZip 有限补充（第 4 节），WP2 导入器按
   固定顺序执行且只读必要属性；
3. **真实 Office 加密文件未构造**：`fail-encrypted-sim` 只复刻部件布局；WP2 以"无关键部件 →
   稳定拒绝"覆盖，WP7 用真实加密文件做最终验证；
4. **外部 Office 验证环境已确认**：Microsoft Word 16.0.20228.20158（`C:\Program Files\Microsoft
Office\root\Office16\WINWORD.EXE`）；实际往返冒烟按计划在 WP7 执行；
5. **既有 audit 告警**（Electron 37 固定版本、eslint 工具链 brace-expansion）非本任务引入；
6. **Tiptap schema 默认属性物化**：模型↔Tiptap JSON 转换需归一化（WP1 要求）；
7. **StarterKit 默认含 link/blockquote 等**：schema 集合比受支持矩阵略宽，WP5 决定是否
   `link: false` 等裁剪（记录为 WP5 决策点，不影响 WP0 门禁）。

## 12. 门禁结论

WP0 验收门禁（任务第 10 节）：**全部满足**。

- Task 6 基线稳定可重复：19 文件 / 463 通过 / 3 条件跳过复现；`typecheck`/`lint`/
  `format:check`/完整 `check`/`build` 依次通过；junction `EBUSY` 未复现；React 组件测试
  遗留的 `act` 警告已归因并修复（全量测试无该警告）；
- 夹具可审计：18 个夹具全部由确定性构造器生成（除 core.xml 时间戳外字节确定），
  结构/失败形状/审计说明完整，不含真实用户文档；
- 最小闭环成立：Mammoth 导入 → MiniModel → Tiptap schema（getSchema + JSON 往返）→
  `docx` 导出 → Mammoth 重新导入，正文与受支持格式语义一致（夹具套件 24 用例固化）；
- 所有未满足格式均有明确降级决策（第 10 节兼容性矩阵）；
- 未向产品 UI 暴露 DOCX 能力；未修改产品功能代码；工作树仅有夹具/测试/依赖/报告变更。
