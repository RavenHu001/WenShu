# TASK-010 WP0 报告：锁定基线、编辑器事务与资源语义

简体中文 | [English](./TASK_010_WP0_REPORT.en.md)

[任务档案](../README.md) · [文档中心](../../README.md)

> 工作包范围：TASK-010 第 10 节 WP0（第 3 节全部前置检查、Task 9 完成后质量/桌面基线、
> 第 3.3 节全部最小 Tiptap/ProseMirror 技术验证、替换与预算语义冻结、第 4.10 节性能观察、
> 依赖评估与「docs/tasks/task-010/TASK_010_WP0_REPORT.md」）。
> 实施日期：2026-08-20；验证平台：Windows 11（zh-CN，build 10.0.26200），Node.js 22.15.0
> （项目本地「.tools/node-v22.15.0-win-x64」），npm 10.9.2，Electron 37.10.3，TypeScript 5.9.3，
> Vitest 3.2.7，Tiptap 3.29.2（@tiptap/core / @tiptap/pm / @tiptap/starter-kit），
> prosemirror-view 1.42.2、prosemirror-transform 1.12.0（经 @tiptap/pm 固定版本）。
> 本工作包不向产品 UI 暴露 DOCX 当前查找；不实现正式 matcher / plugin / controller / replace；
> 未修改任何产品功能代码；未修改最终验收勾选；未更新 README / PROJECT_BASELINE / TESTING
> 的完成状态（属 WP7 职责）。

## 1. 工作包声明（开始时报告项）

- 当前分支与 HEAD：分支「TASK-010」，HEAD「7b3d087aa6592ccecec345a356c8f2f38bda95a4」
  （提交信息「TASK-010：当前 DOCX 内查找与替换」，即 Task 10 规划完成提交）。
- 工作树与用户已有修改：开始时「git status --short」为空（干净工作树，**无用户已有修改**
  需要保护）；Task 9 完成提交「9d30e2c」（Merge pull request #9）已合入本分支历史。
- 上一恢复点：「7b3d087」（本分支 HEAD；首包以 Task 10 规划提交为恢复点）。
- 本包范围：只做基线锁定、编辑器事务/资源语义实测与冻结，新增
  「docs/tasks/task-010/TASK_010_WP0_REPORT.md」与最小技术验证测试（测试脚手架，非产品代码）。
- 本包非目标：不接产品 UI（SearchSidebar / DocumentPane / DocxEditorSessionHost / App 均不改）；
  不实现正式 matcher / plugin / controller / replace；不新增/修改 IPC、preload、DesktopApi；
  不新增依赖；不修改最终验收勾选；不更新完成状态文档。
- 最小夹具：「tests/docx/docx-current-search-assumptions.test.tsx」（22 用例，jsdom，保留为回归
  资产）——真实 Tiptap Editor（与产品「DOCX_EDITOR_EXTENSIONS」相同扩展链）+ 实时 textblock
  投影/范围映射/Decoration/替换事务脚手架；「document-tabs」纯状态夹具（degraded / saving）；
  近上限夹具（20,000 块；1800 段 × 4096 字符 ≈ 7,498,830 序列化字节，为 8 MiB 上限的约 89%）。
- 验证清单：必读材料；「git status」/分支/HEAD；完整「check」与「build」（依次执行，不并行）；
  测试文件数/通过数/条件跳过数与原因；开发与生产构建主窗口冒烟；第 3.3 节全部技术验证；
  第 4.10 节性能观察；依赖评估；diff 审查；结束前再次完整「check」/「build」。
- 预计报告内容：工作包声明、必读材料核对、质量/桌面基线、夹具验证结果与实测发现、
  冻结决策表、性能观察、依赖评估、修改文件、结束前复核、已知限制、WP0 门禁结论。

## 2. 必读材料核对（任务第 3.1 节）

已完整阅读：「README.md」、「docs/architecture/PROJECT_BASELINE.md」、「docs/development/DEVELOPMENT_ENVIRONMENT.md」、
「docs/development/TESTING.md」、「docs/tasks/task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.md」与完成报告、
「docs/tasks/task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md」与完成报告（含 WP0 报告）、
「docs/tasks/task-008/TASK_008_DOCX_WORKSPACE_SEARCH.md」与完成报告（含 WP0 报告）、
「docs/tasks/task-009/TASK_009_BASIC_FILE_MANAGEMENT.md」与完成报告（含 WP0 报告）、
「docs/tasks/task-010/TASK_010_DOCX_FIND_REPLACE.md」（全文），以及直接相关源码与测试：

- 共享契约：「src/shared/docx.ts」（全文）、「docx-convert.ts」（全文）、「docx-search-text.ts」（全文）；
- 主进程参考：「src/main/search/match-text.ts」（全文，仅比较 literal matcher 语义）；
- renderer：「lib/document-tabs.ts」（含 editDocxTab / startDocxSave / completeDocxSave /
  confirmDocxCompatibility / 不变量）、「lib/use-documents.ts」、「lib/use-editor-sessions.ts」；
  「components/document/EditorSessionHost.tsx」、「DocxEditorSessionHost.tsx」、「DocumentPane.tsx」、
  「components/search/SearchSidebar.tsx」、「App.tsx」；
- 测试：「tests/document/find-replace.test.tsx」、「docx-editor.test.tsx」、「docx-locate-host.test.tsx」、
  「tests/docx/docx-search-projection.test.ts」、「docx-search-locate-assumptions.test.tsx」、
  「tests/search/result-locate-docx.test.tsx」、Task 9 路径迁移/save-as/mutation epoch 测试、
  「vitest.config.ts」与「tsconfig.test.json」。

## 3. 工作树与质量基线（任务第 3.2 节）

### 3.1 执行环境说明

受控执行环境无交互式终端；全部命令经 Git Bash 调用项目本地 Node（「.tools/node-v22.15.0-win-x64」）
与「cmd.exe」子进程实际执行（「PROCESSOR_ARCHITECTURE=AMD64」注入，与 Task 9 一致，仅影响
「scripts/npm.cmd」的架构选择）。测试在 jsdom/node 环境下真实运行，无任何断言被 mock 掉。

### 3.2 命令与结果（开始基线，「check」与「build」依次执行）

| 命令                          | 结果                                               |
| ----------------------------- | -------------------------------------------------- |
| 「git status --short」        | 干净（无用户已有修改）                             |
| 「scripts\npm.cmd run check」 | **通过**（退出码 0；约 41 s，其中 Vitest 23.42 s） |
| 「scripts\npm.cmd run build」 | **通过**（退出码 0；约 11 s）                      |

### 3.3 测试数量与条件跳过（Task 9 完成后基线实测）

- **54 个测试文件全部通过，1016 项通过，10 项条件跳过（共 1026 项用例）**，与 Task 9 完成
  报告基线（54 文件 / 1016 passed / 10 skipped）完全一致。
- 10 个条件跳过均为真实符号链接/junction 权限条件（「it.runIf」）：read-text-document 2、
  read-docx-document 2、search-text-workspace 1、search-mixed-workspace 1、
  resolve-workspace-entry 1、relocate-workspace-entry 1、trash-workspace-entry 1、
  reveal-workspace-entry 1；拒绝分支由 mock 适配器确定性覆盖。
- 唯一预期 stderr：保存器/新建清理失败注入用例的「wenshu: 清理临时文件失败 (EPERM/EACCES)」，
  与 Task 7/8/9 记录一致。
- 无「only」、无条件「skip」或弱化断言；「typecheck」（5 tsconfig）、「lint」
  （--max-warnings=0）、「format:check」均通过。

### 3.4 构建产物（开始基线）

| 产物                                | 大小        |
| ----------------------------------- | ----------- |
| 「out/main/index.js」               | 154.91 kB   |
| 「out/preload/index.js」            | 4.10 kB     |
| 「out/renderer/index.html」         | 0.57 kB     |
| 「out/renderer/assets/index-*.js」  | 2,173.67 kB |
| 「out/renderer/assets/index-*.css」 | 25.83 kB    |

## 4. 桌面主窗口冒烟（开发与生产构建）

| 验证项                                           | 结果                                                                                                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 开发模式（「scripts\dev.cmd」）                  | **通过**：dev server + Electron 启动，26 s 存活 4 个 electron 进程，日志含 preload 构建成功、无 error/uncaught/failed；主窗口存在（PID 9188，标题非空）；进程树清理后残留 0 |
| 生产构建（「node_modules\.bin\electron.cmd .」） | **通过**：16 s 存活 4 个 electron 进程，stdout/stderr 无错误；以 UTF-8 复测枚举到主窗口 **PID 17660，标题「文枢」**；进程树清理后残留 0                                     |

## 5. 最小 Tiptap/ProseMirror 技术验证（任务第 3.3 节）

### 5.1 夹具与脚手架

「tests/docx/docx-current-search-assumptions.test.tsx」（22 用例，全部通过）使用真实 Tiptap
Editor（与产品「DOCX_EDITOR_EXTENSIONS」相同扩展链：StarterKit(levels 1-3, link:false) +
TextStyle + Color + FontSize + TextAlign），通过公开 API（「doc.descendants」/「isTextblock」/
「textContent」/「textBetween」/「resolve」/「tr.replaceWith」/「tr.delete」/「tr.insertText」/
「setTextSelection」/「scrollIntoView」/「undo」/「redo」/ Plugin / PluginKey / Decoration /
DecorationSet）验证；「document-tabs」纯状态函数验证 degraded/saving；全部脚手架仅存在于
测试文件，WP1/WP2/WP4 移植为产品模块时保持语义。

### 5.2 验证结果

| #   | 验证项（任务第 3.3 节）                                                                                                                        | 结果 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | 实时 textblock 投影与「joinDocxTextBlocks」/「projectDocxModelSearchText」顺序和文本一致（标题、跨 run marks、空段、嵌套列表、emoji/组合字符） | ✓    |
| 2   | 跨 marks run 匹配稳定映射为单一 PM 选区（「粗体跨run」）                                                                                       | ✓    |
| 3   | 匹配不跨人工「\n」；查询/替换含换行或超 4096 被拒绝                                                                                            | ✓    |
| 4   | 中文/emoji/代理对/组合字符 UTF-16 偏移映射（🎉、e+U+0301、𠮷、字符）                                                                           | ✓    |
| 5   | Decoration 同时标记全部匹配与当前匹配（class + DOM span 断言），应用/清空不修改正文、不进撤销历史                                              | ✓    |
| 6   | 文档事务后 DecorationSet 经「mapping」安全更新（插入前移），重算后替换旧集合                                                                   | ✓    |
| 7   | 单 run 替换（短/长/中文/emoji/组合/相同文本），模型合法、可撤销                                                                                | ✓    |
| 8   | 「insertText」与显式「replaceWith」的 marks 实测；冻结显式「replaceWith」+ 起点字符 marks                                                      | ✓    |
| 9   | 跨不同 marks run：替换继承匹配起点 marks，未匹配格式保持                                                                                       | ✓    |
| 10  | 空替换 = 删除；段落/标题/列表结构保持（含 TrailingNode 记录，见 5.3-F2）                                                                       | ✓    |
| 11  | 全部替换每个匹配继承各自起点 marks（同查询命中 bold/plain/italic 三上下文）                                                                    | ✓    |
| 12  | 执行瞬间复验：旧范围失效 →「stale-range」拒绝且 0 dispatch                                                                                     | ✓    |
| 13  | 非法模型候选（hardBreak 注入）→「tiptapJsonToDocxModel」invalid → 0 dispatch、文档不变                                                         | ✓    |
| 14  | 逆序单 transaction 全部替换（不同长度替换无漂移）；一次 undo/redo 完整恢复/重做，仅一个历史事件                                                | ✓    |
| 15  | 2000 项允许（truncated=false）；第 2001 个匹配起扫描标记 truncated，全部替换整体拒绝、0 部分替换                                               | ✓    |
| 16  | 0 匹配全部替换无操作、不 dispatch                                                                                                              | ✓    |
| 17  | 预算失败：接近序列化上限文档 + 1,000,000 字符替换候选 → 序列化超限 invalid → 0 dispatch、0 dirty                                               | ✓    |
| 18  | read-only：装饰、选区、滚动可应用（focus 为安全 no-op），替换命令防御性拒绝、不 dispatch                                                       | ✓    |
| 19  | degraded 未确认拒绝；确认绑定当前 revision 后同一 editor 实例即可替换；新 revision 读取后旧确认失效                                            | ✓    |
| 20  | saving 期间替换（editDocxTab）后，旧保存完成仍保持 loaded-dirty + 新模型（不清除保存期间修改）                                                 | ✓    |
| 21  | 20,000 文本块：投影/扫描/装饰/一次输入事务（一次性性能观察）                                                                                   | ✓    |
| 22  | 接近「DOCX_MAX_MODEL_SERIALIZED_BYTES」：投影/扫描/装饰/预算失败候选转换（一次性性能观察）                                                     | ✓    |

### 5.3 WP0 实测发现（全部已冻结进本节与第 6 节）

- **F1（起点 marks 的准确语义）**：「doc.resolve(from).marks()」在匹配起点恰为两个不同 marks
  text node 的边界时返回**边界前**（上一 text node）的 marks（实测：bold+plain+italic 三连
  文本中，对起点位于 plain 字符的匹配，「resolve().marks()」返回「['bold']」）。因此冻结规则为
  「继承匹配起点**字符**的 marks」：取匹配起点所在 text node 的 marks
  （脚手架「startCharMarks」：「$pos.parent.forEach」查找包含「from」的 text 节点）。「insertText」
  与显式「replaceWith」在段首边界均继承起点 marks；统一冻结**显式
  「tr.replaceWith(from, to, schema.text(repl, startCharMarks))」**，不依赖「insertText」
  内部实现。
- **F2（Tiptap v3 StarterKit 默认 TrailingNode）**：文档以非 paragraph 块（实测列表；源码
  确认「disabledNodes=[paragraph]」，标题/列表/代码块等结尾同样触发）结尾时，编辑器 doc 会在
  末尾自动追加一个空 paragraph（实测 doc content 类型：「heading/paragraph/bulletList/
  paragraph」）。该块位于文档末尾，**前方块的 ordinal/from/to 全部不变**，因此 Task 8 定位
  不受影响；当前查找以实时 doc 为唯一来源（第 4.1 节），空块无匹配，语义自洽。冻结：WP1
  直接使用实时 textblock 投影（包含该空块），不剥离、不猜测；若未来要求与模型投影逐块
  等价，可在宿主配置「trailingNode:false」（本包不改产品代码，留待相关 WP 决策并记录）。
- **F3（与 CodeMirror 的实测差异）**：读取 pinned「@codemirror/search」源码确认：大小写
  不敏感匹配使用「x.normalize("NFKD")」+「toLowerCase」（Unicode 级），并默认规范化；
  而 Task 6「matchText」只折叠 ASCII「A-Z」、不规范化。差异：「É/é」、「e\u0301/é」在 CodeMirror
  匹配而 matchText 不匹配；中文不受影响。Task 10 第 4.3 节已固定「literal + 大小写开关、
  不执行 Unicode 规范化」→ **冻结沿用 matchText 语义**（ASCII-only 折叠、不规范化），
  该差异作为已知限制在 WP1 完成报告记录；不重写 TXT 引擎。
- **F4（truncated 必须显式传递）**：扫描在收集满 2000 项后若正文仍可能有更多匹配即置
  「truncated=true」；全部替换不能只看「已收集 2000 项」——2001+ 时收集数仍为 2000，必须由
  truncated 标记整体拒绝（实测：「a」.repeat(4000) 查「a」收集 2000/truncated=true → 拒绝；
  查「aa」恰好 2000/truncated=false → 允许）。
- **F5（装饰与历史）**：仅含「setMeta(key, DecorationSet)」的事务不修改 doc、不产生历史
  步骤（「undo()」无效果）；无 meta 的文档事务经「value.map(tr.mapping, newState.doc)」安全
  更新装饰范围；jsdom 中 dispatch 后装饰 span 同步渲染，可断言 class。
- **F6（保存语义）**：「startDocxSave」对「loaded-clean」标签是无操作（既有语义，先 dirty
  才能发起保存）；saving 期间替换走与普通键入相同的「editDocxTab」路径，「completeDocxSave」
  以保存开始时的「editRevision」判定是否清除 dirty——保存期间产生的新修订使完成结果保持
  「loaded-dirty」且保留新模型（实测断言）。
- **F7（read-only 定位）**：复测 Task 8 冻结项：只读视图可应用装饰、「setTextSelection」、
  「scrollIntoView」，「focus()」为安全 no-op（不获得 DOM 焦点、不开放编辑）；替换命令在
  command 内防御性拒绝（不依赖按钮 disabled）。

## 6. 冻结决策（任务第四节对应项）

| 项目                 | 冻结值 / 规则                                                                                                                                                          | 证据                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 搜索来源             | 活动 Tiptap/ProseMirror 实时「state.doc」（含未保存修改），不读磁盘、不搜索模型旧快照                                                                                  | 任务 4.1；本包全部用例基于实时 doc |
| 正文投影             | 复用「joinDocxTextBlocks」：深度优先 textblock，相邻块恰一个人工「\n」，UTF-16 偏移；映射公式「块内容起点 pos+1 + 块内偏移」；「descendants」需终止守卫（Task 8 冻结） | 用例 1/2/4；Task 8 WP0             |
| 输入                 | 查询非空、≤4096 UTF-16、单行（「\r」/「\n」拒绝）；替换 ≤4096 UTF-16、单行                                                                                             | 用例 3                             |
| 匹配                 | literal + caseSensitive；ASCII-only 大小写折叠；从左到右非重叠；最多 2000 项；第 2001 项起「truncated=true」                                                           | 用例 3/15；F3                      |
| 全部替换             | 0 匹配无操作；truncated 或 >2000 整体拒绝（0 部分替换）；从末到前同一 transaction；每个匹配继承各自起点字符 marks；一次 undo/redo                                      | 用例 11/14/15/16；F4               |
| 替换当前项           | 执行瞬间重新扫描 + 范围复验（pmFrom/pmTo 双重匹配），失效 → 拒绝并重算                                                                                                 | 用例 12                            |
| marks 继承           | 非空替换继承**起点字符**所在 text node 的 marks（「startCharMarks」），不取边界前 marks；空替换 = 删除；段落/标题/列表结构与周围格式保持                               | 用例 8/9/10/11；F1                 |
| 模型预验证           | dispatch 前对候选「tr.doc.toJSON()」执行「tiptapJsonToDocxModel」+「validateDocxDocumentModel」（含序列化预算）；任一失败 0 dispatch、0 dirty                          | 用例 13/17                         |
| read-only            | 可查找/装饰/定位，替换命令内拒绝（不依赖 disabled）                                                                                                                    | 用例 18；F7                        |
| degraded             | 未确认可查找不可替换；确认绑定「compatibilityConfirmationRevision === document.revision」后可替换（复用既有确认入口，不重建 editor）；revision 变化后旧确认失效        | 用例 19                            |
| saving               | 替换期间编辑语义与普通键入一致（editDocxTab）；旧保存完成不得清除保存期间修改                                                                                          | 用例 20；F6                        |
| 性能策略（WP2 建议） | 同步全量重算（本机近上限扫描 61ms 量级）+ 编辑事务后单次调度 + generation 丢弃旧计算；不引入 worker/索引/持久缓存                                                      | 第 7 节                            |
| 依赖                 | 默认不新增；本包仅使用已安装的 @tiptap/*、现有 matcher 与共享模型/转换                                                                                                 | 第 8 节                            |

## 7. 性能观察（第 4.10 节；一次性，非基准门禁）

| 场景                                                | 数据（本机 jsdom/node） |
| --------------------------------------------------- | ----------------------- |
| 20,000 文本块（模型上限）实时投影                   | 10 ms                   |
| 20,000 文本块扫描（2000 匹配，truncated）           | 8 ms                    |
| 20,000 文本块 2000 项装饰构建 / 应用（DOM 渲染）    | 48 ms / 82 ms           |
| 20,000 文本块一次输入事务（insertText + view 更新） | 30 ms                   |
| 近序列化上限（7,498,830 字节 / 8,388,608）实时投影  | 1 ms                    |
| 近上限扫描「aa」（2000 匹配，truncated）            | 61 ms                   |
| 近上限 2000 项装饰构建 / 应用                       | 5 ms / 76 ms            |
| 近上限预算失败候选模型转换（+1,000,000 字符）       | 17 ms                   |

结论：本机全量同步重算（投影 + 扫描 + 装饰）在近上限文档上约 70-140 ms 量级，普通文档远低于
100 ms 目标；WP2 按第 6 节建议冻结「同步重算 + 单次调度 + generation 丢弃」，不提前引入
debounce/worker/索引（WP6 如实测卡顿再按第 4.10 节顺序评估）。一次性观察，不以 CI
wall-clock 作硬断言；真实浏览器滚动/渲染由 WP6 冒烟观察。

## 8. 依赖评估

- 本包未安装、未修改任何依赖（「package-lock.json」无变化）。
- 验证仅使用：「@tiptap/core」、「@tiptap/pm」（state/view/model）、「@tiptap/starter-kit」、
  「@tiptap/extension-text-style」、「@tiptap/extension-color」、「@tiptap/extension-text-align」
  （均已安装，版本 3.29.2）、现有「src/main/search/match-text.ts」（纯函数参考语义）、
  「src/shared/docx.ts」/「docx-convert.ts」/「docx-search-text.ts」。
- 结论：**不新增依赖即可完成全部固定语义**（任务第 3.3 节最后一项成立）。

## 9. 修改文件与 diff 审查

| 文件                                                    | 变更                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 「tests/docx/docx-current-search-assumptions.test.tsx」 | **新增**：TASK-010 WP0 最小 Tiptap/ProseMirror 技术验证（22 用例，jsdom；测试脚手架，非产品代码） |
| 「docs/tasks/task-010/TASK_010_WP0_REPORT.md」          | **新增**：本报告                                                                                  |

- 「git status --short」：仅上述两个新增文件（「??」）；**无产品代码、preload、IPC、DesktopApi、
  测试（既有）或文档勾选变更**；「package-lock.json」未变；临时日志（「*.log」）被 .gitignore
  覆盖且位于仓库根，不进入提交。
- preload/IPC 暴露面复核：仍为 Task 9 完成时的固定集合（workspace 6 + document 4 + save-as 2
  - search 2 + window 3 = 17 个 handle），无新增。
- 未修改最终验收勾选（第十一节仍全部「[ ]」）；未向产品 UI 暴露 DOCX 当前查找。

## 10. 结束前完整 check/build（报告落盘后重跑）

| 命令                          | 结果                                               |
| ----------------------------- | -------------------------------------------------- |
| 「scripts\npm.cmd run check」 | **通过**（退出码 0；约 45 s，其中 Vitest 27.42 s） |
| 「scripts\npm.cmd run build」 | **通过**（退出码 0；约 11 s）                      |

## 11. 未解决问题与已知限制

1. jsdom 滚动坐标不可断言（「scrollIntoView」为布局 no-op）；真实滚动/聚焦由 WP6 手工冒烟
   （沿用 Task 6/8 限制）。
2. CodeMirror 当前查找与 Task 6 matcher 的大小写/规范化差异（NFKD+toLowerCase+规范化 vs
   ASCII-only 折叠、无规范化）已实测确认；Task 10 固定为 matchText 语义，TXT 引擎不改写，
   差异在 WP1 完成报告记录为已知行为。
3. Tiptap v3 StarterKit 默认 TrailingNode 会在「文档以非 paragraph 块结尾」时追加末尾空段；
   本包冻结为「实时 doc 唯一来源、不剥离该块」；如需与模型投影逐块等价，相关 WP 决策
   「trailingNode:false」（本包不改产品代码）。
4. 性能数字为一次性观察（jsdom/node 本机），非基准门禁；近上限编辑器创建耗时未单独计时
   （共享夹具懒加载）。
5. read-only 视图「focus()」为安全 no-op（Task 8 已冻结）：只读定位以选区+滚动为准。
6. 本包全部断言在 jsdom 中完成；真实浏览器渲染路径（装饰 DOM 更新、滚动、焦点）由
   WP6 冒烟与 WP3/WP4 组件测试覆盖。

## 12. WP0 门禁结论

**满足 WP0 门禁**（任务第 10 节 WP0 三项 + 第 3.3 节全部验证）：

1. **基线可重复**：Task 9 完成后基线实测与完成报告一致（54 文件 / 1016 通过 / 10 条件跳过，
   均为真实符号链接/junction 权限条件且 mock 覆盖拒绝分支）；「typecheck」/「lint」/
   「format:check」/完整「check」/「build」依次通过；开发与生产构建主窗口冒烟通过（生产窗口
   PID 17660，标题「文枢」）。
2. **关键 ProseMirror 行为有实际测试证据**：第 3.3 节全部技术验证以 22 个真实 Tiptap/PM
   用例固化（投影与 Task 8 规则一致、跨 marks run 范围、中文/emoji/组合字符 UTF-16 映射、
   Decoration 与事务后 mapping、insertText/replaceWith marks、起点字符 marks 继承、空替换、
   逆序单 transaction 全部替换与一次 undo、dispatch 前模型/预算校验、read-only/degraded/
   saving、2000/2001 与近上限性能）。
3. **替换与预算语义无未决项**：起点 marks（F1）、TrailingNode（F2）、truncated 整体拒绝
   （F4）、模型/预算失败 0 dispatch、read-only/degraded/saving 权限、性能策略全部冻结并有
   断言证据；未触发「固定假设不成立 → 先更新 Task 10 规划并停止」（两处发现为冻结补充记录，
   不改变规划语义）。

**结论：TASK-010 WP0 完成，可进入 WP1。** 本包未实现 WP1+，未接产品 UI，未修改最终验收勾选。
