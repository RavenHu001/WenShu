# TASK-008 WP0 报告：基线锁定、DOCX 正文投影与技术假设验证

简体中文 | [English](./TASK_008_WP0_REPORT.en.md)

[任务档案](../README.md) · [文档中心](../../README.md)

> 工作包范围：TASK-008 第 10 节 WP0（第 3 节全部前置检查、Windows junction 清理 EBUSY
> 可靠性修复、DOCX 夹具扩展、模型投影 ↔ ProseMirror 文本块映射验证、公开 API 定位/只读
> 假设验证、接近 20 MiB 读取与双层并发/取消假设验证、第四节协议与预算冻结）。
> 实施日期：2026-08-15；验证平台：Windows 11（zh-CN），Node.js 22.15.0，npm 10.9.2，
> Electron 37.x。
> 本工作包不向产品 UI 暴露 DOCX 搜索能力；未修改任何产品功能代码（仅测试夹具/验证/报告
> 与一处测试可靠性修复，见第 3 节）。

## 1. 前置检查结果（任务第 3.1 / 3.2 节）

### 1.1 必读材料（3.1）

已全部阅读：`README.md`、`docs/architecture/PROJECT_BASELINE.md`、`docs/development/DEVELOPMENT_ENVIRONMENT.md`、
`docs/development/TESTING.md`、`docs/tasks/task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.md`、`docs/tasks/task-006/TASK_006_COMPLETION_REPORT.md`、
`docs/tasks/task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md`、`docs/tasks/task-007/TASK_007_COMPLETION_REPORT.md`、
`docs/tasks/task-008/TASK_008_DOCX_WORKSPACE_SEARCH.md`，以及 WP0 直接相关的源码与测试：

- `src/shared/search.ts`、`src/main/search/match-text.ts`、`search-text-workspace.ts`、`search-ipc.ts`；
- `src/shared/docx.ts`、`docx-convert.ts`；`src/main/docx/read-docx-document.ts`、
  `inspect-docx-package.ts`；`src/main/search/` 与 `src/main/workspace/workspace-session.ts`；
- `src/renderer/lib/use-workspace-search.ts`、`use-documents.ts`、`document-tabs.ts`；
- `src/renderer/components/document/EditorSessionHost.tsx`、`DocxEditorSessionHost.tsx`、
  `DocumentPane.tsx`；`src/renderer/App.tsx`；
- 既有测试：Task 6 搜索契约/匹配器/搜索器/搜索 IPC/搜索 controller/搜索侧栏/结果定位、
  Task 7 DOCX 夹具套件/模型/转换/检查/导入/导出/读取/保存/IPC、TXT 读取保存、多标签、
  窗口关闭、preload 契约全量回归。

### 1.2 工作树与质量基线（3.2）

- `git status --short`：存在一条用户已有修改——`docs/tasks/task-008/TASK_008_DOCX_WORKSPACE_SEARCH.md`
  （任务文档第十三节"执行提示模板"补充），**已识别并保护，未触碰**；其余修改均来自本
  工作包（见第 8 节修改文件清单）。
- 分支 `TASK-008`（`cb65410 Task 8：DOCX 正文搜索与富文本结果定位，完成当前文档路线。`）。
- 基线命令依次执行（`check` 与 `build` 未并行）：

| 命令                       | 结果                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `typecheck`（5 tsconfig）  | **通过**                                                                                                               |
| `lint`（--max-warnings=0） | **通过**（0 warning）                                                                                                  |
| `format:check`             | **通过**（Windows 检出环境行尾策略固定）                                                                               |
| `test`（32 文件 742 用例） | 首次运行 **2 个套件因 junction 清理 EBUSY 失败**（见第 3 节）；修复后连续 3 次全量运行通过：**737 passed / 5 skipped** |
| `check`                    | 修复后**通过**（退出码 0）                                                                                             |
| `build`                    | **通过**（main 84.94 kB、preload 2.70 kB、renderer 2,107.16 kB + CSS 21.86 kB）                                        |

- 5 个条件跳过均为真实符号链接权限用例（本机 junction 可创建、文件符号链接需提权；
  `read-text-document` 2 个、`read-docx-document` 2 个、`search-text-workspace` 1 个真实
  链接集成用例），拒绝分支由 lstat/readDir mock 确定性覆盖。
- 桌面冒烟：开发模式（`.\scripts\dev.cmd`）22 s 存活、生产构建（`npm exec -- electron .`）
  18 s 存活，均无 preload/React/资源错误日志（第 6 节）。
- Task 6 的 TXT 搜索、取消、结果定位与 Task 7 的 DOCX 打开、编辑、保存、兼容性提示全量
  回归通过（测试全部实际执行，无回归断言弱化）。

### 1.3 首次基线失败归因与修复（第 3.2 节门禁：junction 清理不得跳过整个测试文件）

首次全量 `check` 复现了 TASK-007 规划中已知、当时未复现的 Windows junction 清理问题：

```
EBUSY: resource busy or locked, rmdir '...\wenshu-reader-probe-*\alias-dir'   （2 套件）
```

**归因**：`tests/document/read-text-document.test.ts`、`tests/search/search-text-workspace.test.ts`、
`tests/docx/read-docx-document.test.ts` 的 `beforeAll` 在临时目录创建 junction 探测链接后
立即 `fs.rm(dir, {recursive:true, force:true})` 清理。全量并行（vitest forks 4）加载时，
Windows 杀毒/索引组件对新创建 junction 的短暂加锁使 `rmdir` 瞬时失败（单文件运行与减压
运行均不出现，40 次压力脚本 junction-only 全通过，确认是并行负载下的瞬时锁而非权限或
Node 递归 rm 结构性缺陷）。`beforeAll` 抛错导致整个测试文件被跳过（49 用例）或真实文件
系统集成组被跳过（7 用例），违反"不得因 EBUSY 使整个读取测试文件跳过"的门禁。

**修复（测试可靠性，不涉及产品代码）**：新增 `tests/test-utils/temp-dir-cleanup.ts`
`removeDirWithRetry`：只对 `EBUSY`/`EPERM` 瞬时错误码做最多 5 次、间隔 200 ms 的有界重试，
其他错误立即抛出、重试耗尽后抛原始错误（不吞真实失败，不扩大超时，不整文件跳过）。
三个含 junction 探测的测试文件在探测目录、含 junction 用例的工作区根目录清理处改用该
helper。修复后全量 `test` 连续 3 次通过（737/5）。

## 2. DOCX 夹具（任务第 3.3 节）

复用 TASK-007 的 18 个夹具（构造器确定性、无隐私内容），本工作包在
`tests/docx/docx-fixture-builder.ts` 新增 4 个：

| 夹具 id               | 用途与预期结构                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ok-read-only`        | 普通文档 + settings.xml 注入 `<w:documentProtection w:edit="readOnly" w:enforcement="1"/>`；检查器判为 `encrypted-protected` → `read-only`（仅阅读可搜索、不可编辑保存） |
| `ok-combining-emoji`  | 组合变音符号（`e\u0301`）、astral emoji（🎉🚀）、CJK 扩展区（𠮷）与 run 内原生换行；验证 UTF-16 code unit 偏移不被归一化/代理对拆分改变                                  |
| `ok-projection-mixed` | 标题 1 + 跨 run marks 段落（粗体/斜体/普通三 run）+ 空段落 + 嵌套项目符号列表（level 0/1）+ 嵌套编号列表（level 0/1）+ emoji 段落；冻结投影结构                          |
| `ok-large`            | 合法 DOCX 填充到恰好 20 MiB（ZIP 仍可解析），用于接近上限单文件读取耗时与"已开始读取可完成"窗口验证                                                                      |

`tests/docx/docx-fixture-suite.test.ts` 新增 4 个断言用例固化：只读夹具的检查器特性、
组合字符/代理对/换行按原码位进入模型、投影混合夹具的模型结构（标题级别、run 序列、
嵌套列表分组）、大文件恰好 20 MiB 且可解析。

## 3. DOCX 正文投影技术验证（任务第 3.3 节）

### 3.1 冻结的投影规则（任务第 4.3 节全部 10 条）

测试脚手架 `tests/docx/docx-search-projection-scaffold.ts` 按下列规则实现（WP1 把同一
规则实现为产品模块 `src/shared/docx-search-text.ts`）：

1. 按文档顺序深度优先遍历模型；
2. 普通段落与标题各形成一个文本块；
3. 列表块自身不产生文字，列表内段落/标题按深度优先顺序形成文本块；
4. 单个文本块内容为全部 run 的 `text` 原样连接，marks/字号/颜色/对齐/标题等级与列表序号
   不进入搜索文本；
5. 相邻文本块之间插入恰好一个人工 `\n`；
6. 空段落仍保留为空文本块和相邻分隔边界；
7. 不在文档开头或结尾额外插入换行；
8. 投影偏移使用 UTF-16 code unit，与 JavaScript 字符串和 ProseMirror 文本位置一致；
9. 投影结果携带仅供进程内映射使用的文本块序号、投影 `from/to` 与块正文；
10. 投影函数不依赖 Electron、Node.js、Mammoth、Tiptap、ProseMirror、DOM 或文件系统。

**实测附加冻结约束**：产品模型（导入/转换）不产生空文本 run——空 run 在 `importRuns`
与 `parseInlineContent` 中都被跳过，且 ProseMirror `nodeFromJSON` 直接拒绝空 text 节点
（`RangeError: Empty text nodes are not allowed`，WP0 实测）；投影对空文本 run 视为
无贡献，输出与真实模型一致。

### 3.2 投影 ↔ ProseMirror 文本块一致（第 3.3 节结论 1/2）

`tests/docx/docx-search-projection.test.ts`（16 用例，node 环境）用**真实 ProseMirror
schema**（与产品 `DOCX_EDITOR_EXTENSIONS` 相同扩展链：StarterKit(levels 1-3, link:false)

- TextStyle + Color + FontSize + TextAlign）通过公开节点 API（`schema.nodeFromJSON` →
  `doc.descendants` / `isTextblock` / `textContent` / `textBetween` / `nodeSize`）验证：

* 空模型、单段、多段、空段：投影文本/块区间与 PM 文本块逐一相等；
* 标题 1-3 各形成文本块，级别不进搜索文本；marks/字号/颜色/对齐不进入投影；
* 项目符号、编号与嵌套列表：PM 文本块顺序与模型深度优先顺序完全一致（列表条目段落
  也是 textblock）；
* UTF-16：中文、emoji 代理对（2 code unit）、组合字符（基准字母 + U+0301 两个独立
  code unit）在投影与 PM 位置上的偏移一致；
* run 内原生换行保留在块文本中（不产生额外文本块）；
* 合法（无换行）查询的每个匹配完整落在单个文本块内（不跨人工分隔符）；
* 预算级：20,000 块（模型上限）投影 7 ms（实测，见第 5 节），相邻块 `from/to` 链连续，
  最后一块 `to` 等于投影文本长度；
* **真实夹具闭环**：9 个夹具（含新 4 个）经产品 `inspectDocxPackage` + `importDocxDocument`
  导入后的模型，投影与 PM 文本块正文、UTF-16 长度逐块一致。

### 3.3 公开 API 定位与只读假设（第 3.3 节结论 3/4）

`tests/docx/docx-search-locate-assumptions.test.tsx`（9 用例，jsdom）用真实 Tiptap
Editor 验证：

- `editor.commands.setTextSelection` / `scrollIntoView` / `focus` 均可用公开命令调用，
  不读取私有 DOM；选区经 `view.state.selection` 公开状态断言；
- 映射公式成立：`PM 位置 = textblock 起始位置 + 1 + 块内 UTF-16 偏移`（起始位置经
  `doc.descendants` 取得）；emoji/组合字符/空段/嵌套列表的块内偏移映射精确命中
  `textBetween`；
- read-only（`editable: false`）：选区与滚动可正常应用，正文不变、无历史步骤、
  DOM `contenteditable=false`。

**WP0 实测发现并冻结的三个公开 API 语义**（WP4 宿主实现必须遵守）：

1. **`doc.descendants` 的 `return false` 只停止进入该节点子树，不停止整个遍历**；
   映射函数匹配后必须用终止标志（如 `done`）短路，否则后续文本块会覆盖映射结果
   （实测曾把块 1 映射到最后一块的起点）。WP4 宿主二次校验的映射实现必须包含该守卫；
2. **Tiptap `focus` 命令经 `requestAnimationFrame` 延迟调用 `view.focus()`**（WP0 实测
   源码与行为）；真实浏览器聚焦在下一帧完成，测试/宿主断言需等待一帧；jsdom 环境
   RAF 正常派发（已用独立用例确认）；
3. **PM `view.focus()` 对非 editable 视图是安全 no-op**（不设置 DOM 焦点，不开放编辑）；
   read-only 定位以"保持选区与滚动、不获得编辑能力"为优先（与任务第十二节失败处理
   决策一致），不在只读态断言 DOM 焦点。

### 3.4 接近 20 MiB 读取与取消（第 3.3 节结论 5）

- 真实文件系统验证：`ok-large`（恰好 20 MiB）经 `readDocxDocument` 默认适配器读取
  **164 ms** 完成（loaded，revision 64 位十六进制），即"已开始读取可完成"的时间窗口；
- 协作式取消语义复用现网 `searchTextWorkspace` 验证：三个慢速受控读取在途时置位
  `shouldStop`，结果返回 `cancelled` 且三个读取全部执行到完成（`start→done` 顺序
  固定），不提交任何部分 completed 结果。WP2 的 DOCX 分支复用同一检查点模式（读取
  前/后 + 匹配循环内），读取本身不中断。

### 3.5 双层并发（第 3.3 节结论 6）

测试脚手架 `runMixedSearch` 按冻结设计实现双层并发池（总信号量 4 + DOCX 信号量 2，
顺序取候选、读取后检查取消），门闩验证：

- 12 个候选（6 TXT + 6 DOCX）：峰值总在途 = 4、峰值 DOCX 在途 = 2，全程不超上限，
  全部读取完成后 completed，读取完成顺序不影响提交（排序在池外由候选自然排序决定）；
- 4 个候选在途时置位取消：4 个读取全部完成但整体返回 `cancelled`，无部分结果。

内存边界分析（WP0 冻结）：最坏在途缓冲 = 2 × DOCX 20 MiB + 2 × TXT 5 MiB ≈ 50 MiB
（DOCX 有界读取 20 MiB+1、TXT 5 MiB+1；DOCX ZIP/模型另有 Task 7 固定预算），加上
遍历/匹配为流式有界，主进程内存与事件循环压力可接受；界面可用性与取消响应由 WP6
做最终性能观察。

## 4. 冻结的协议与预算（任务第四节；WP0 全部确认）

| 项目                                 | 冻结值                                                                                               | 说明                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 查询长度                             | 256 UTF-16 code unit                                                                                 | 沿用 Task 6 契约                                                                                |
| 单次 TXT + DOCX 总候选数             | 1000                                                                                                 | 合计预算，不是每种 1000                                                                         |
| 其中 DOCX 候选数                     | 200                                                                                                  | 控制 ZIP 检查/导入/模型内存压力                                                                 |
| 单个 TXT 大小                        | 复用 5 MiB                                                                                           | 沿用 Task 6                                                                                     |
| 单个 DOCX 压缩大小 / 模型与 ZIP 预算 | 复用 Task 7 全部上限                                                                                 | 20 MiB / 128 条目 / 关键 XML 1 MiB / 总解压 64 MiB / 模型 20 000 块等                           |
| 单文件返回匹配数                     | 200                                                                                                  | 沿用 Task 6                                                                                     |
| 单次返回匹配总数                     | 2000                                                                                                 | 沿用 Task 6                                                                                     |
| 单条预览长度                         | 160 UTF-16 code unit                                                                                 | 沿用 Task 6                                                                                     |
| 全部候选读取并发                     | 4                                                                                                    | 总在途 ≤ 4（门闩验证峰值恰好 4）                                                                |
| 其中 DOCX 同时读取/导入              | 2                                                                                                    | DOCX 在途 ≤ 2（门闩验证峰值恰好 2）                                                             |
| 截断原因新增                         | `docx-file-limit`                                                                                    | 优先级固定：`file-limit` > `docx-file-limit` > `total-matches-limit` > `matches-per-file-limit` |
| 候选分类与排序                       | 大小写不敏感普通 `.txt`/`.docx`；规范相对路径自然排序后应用预算                                      | 遍历不跟随链接/junction，读取时复用两类受控读取器重新校验                                       |
| 数据来源                             | 磁盘已保存快照；DOCX 只来自成功导入的 `DocxDocumentModel` 投影                                       | 不搜索未进入模型的内容；0 字节占位为空白文档无匹配不报错                                        |
| 定位校验链                           | locateId + epoch + requestId + kind + 相对路径 + revision + from/to + matchedText + 宿主二次投影校验 | 任一失败只提示过期，不猜测、不按块序号跳转、不改正文不清 dirty                                  |
| 新增依赖                             | **无**                                                                                               | 投影/池/映射全部复用现有匹配器与 Tiptap/PM 公开 API；不引入数据库/索引/worker                   |
| 搜索结果提交                         | 取消不携带部分 completed 结果                                                                        | 沿用 Task 6 三重校验 + epoch                                                                    |

## 5. 性能观察（一次性观察，非基准门禁；临时脚本已删除）

| 场景                                      | 结果                                                             |
| ----------------------------------------- | ---------------------------------------------------------------- |
| 接近 20 MiB DOCX 受控读取（真实文件系统） | **164 ms**（loaded；revision 64 位十六进制）                     |
| 20,000 块（模型上限）正文投影             | **7 ms**（20 000 块，投影约 380 万 UTF-16 单元）                 |
| 双层并发峰值                              | 总 4 / DOCX 2（门闩确定性验证）                                  |
| 读取中取消响应                            | 协作式：读取完成即返回 `cancelled`，无部分结果（注入慢读取验证） |

## 6. 桌面冒烟证据

| 验证项                                   | 结果                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| 开发模式启动（`.\scripts\dev.cmd`）      | **通过**：dev server + Electron 启动，22 s 存活，无 preload/React/资源错误日志 |
| 生产构建启动（`npm exec -- electron .`） | **通过**：加载 `out/` 构建，18 s 存活，stdout/stderr 无错误                    |

## 7. 语义结论与 WP1+ 固定要求

1. 投影 ↔ PM 文本块顺序完全一致（含空段、嵌套列表、跨 run marks、run 内换行）；WP1
   产品模块必须按 3.1 冻结规则实现，WP4 宿主映射必须含 `descendants` 终止守卫；
2. 映射公式：`PM 位置 = textblock 起点位置 + 1 + 块内偏移`；只读编辑器同样适用；
3. focus 命令延迟一帧；只读视图不获得 DOM 焦点（记录为已接受的平台行为）；
4. 双层并发池设计冻结（总 4 / DOCX 2），WP2 实现时保持"顺序取候选 + 读取后取消检查 +
   池外自然排序"；
5. 预算、截断优先级与"取消不提交部分结果"冻结（第 4 节表）；
6. 搜索全过程只读：本次验证未创建任何持久文件（临时目录与观察脚本已清理，工作区无
   残留）。

## 8. 修改文件

| 文件                                                         | 变更                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `tests/test-utils/temp-dir-cleanup.ts`（新增）               | `removeDirWithRetry`：junction 目录清理的 EBUSY/EPERM 有界重试（第 1.3 节归因与修复） |
| `tests/document/read-text-document.test.ts`（修改）          | 探测目录/工作区根清理改用有界重试（断言不变）                                         |
| `tests/search/search-text-workspace.test.ts`（修改）         | 探测目录/工作区/链接用例清理改用有界重试（断言不变）                                  |
| `tests/docx/read-docx-document.test.ts`（修改）              | 同上（同一潜在 flake 预防，断言不变）                                                 |
| `tests/docx/docx-fixture-builder.ts`（修改）                 | 新增 `ok-read-only` / `ok-combining-emoji` / `ok-projection-mixed` / `ok-large` 夹具  |
| `tests/docx/docx-fixture-suite.test.ts`（修改）              | 新增 4 个夹具断言用例（只读特性/组合字符/投影混合结构/大文件）                        |
| `tests/docx/docx-search-projection-scaffold.ts`（新增）      | 冻结投影规则脚手架（测试共享模块，WP1 移植为产品模块）                                |
| `tests/docx/docx-search-projection.test.ts`（新增）          | 投影规则 + PM 等价 + UTF-16 + 查询不跨块 + 预算级线性（16 用例）                      |
| `tests/docx/docx-search-locate-assumptions.test.tsx`（新增） | 公开 API 定位/read-only/近 20 MiB 读取/协作式取消/双层并发（9 用例）                  |
| `docs/tasks/task-008/TASK_008_WP0_REPORT.md`（新增）         | 本报告                                                                                |

未修改任何产品功能代码；未向产品 UI 暴露 DOCX 搜索能力；`git status --short` 除上述文件
与用户既有的 `docs/tasks/task-008/TASK_008_DOCX_WORKSPACE_SEARCH.md` 修改外无其他变更。

## 9. 未解决问题与已知限制

1. **read-only 视图的 DOM 焦点**：PM `view.focus()` 对非 editable 视图为安全 no-op，
   只读定位以选区+滚动为准（与任务第十二节决策一致，已在 3.3 节记录）；
2. **jsdom 滚动数值不可断言**：`scrollIntoView` 在 jsdom 中是布局 no-op（坐标全零），
   滚动行为由真实浏览器手工冒烟覆盖（与 Task 6 已知限制 4 同类）；
3. **文件符号链接需提权**：本机 junction 可创建、文件符号链接创建 EPERM，真实链接
   集成用例按既有条件跳过，mock 拒绝分支确定性覆盖；
4. **近 20 MiB 读取与投影耗时**为一次性观察（164 ms / 7 ms），非基准门禁；
5. **空文本 run 语义**：产品模型不含空 run（转换保证）；投影对空 run 视为无贡献，
   PM JSON 侧若出现空 text 节点会被 `nodeFromJSON` 拒绝（WP1 投影模块按冻结约束
   处理，不影响真实模型）；
6. 投影脚手架在 WP1 产品模块落地后退役或替换（测试保留等价断言）。

## 10. 门禁结论

WP0 验收门禁（任务第 10 节）：**全部满足**。

- Task 7 基线可重复通过：首次全量运行复现的 junction 清理 EBUSY 已归因并修复，修复后
  连续 3 次全量 `test` 通过（32 文件 / 737 通过 / 5 条件跳过）；`typecheck`/`lint`/
  `format:check`/完整 `check`/`build` 依次通过；开发与生产构建桌面冒烟通过；
- 投影与公开 API 技术验证有记录：投影 ↔ PM 文本块等价（真实夹具 + 产品导入器闭环）、
  UTF-16/空段/marks/嵌套列表、公开命令选区/滚动/聚焦、read-only 语义、`descendants`
  终止守卫等实测发现全部冻结（第 3、7 节）；
- 无未决语义：双层并发（总 4 / DOCX 2）、协作式取消、近 20 MiB 读取窗口、截断优先级、
  预算与定位校验链全部冻结（第 4 节）；
- 未向产品 UI 暴露 DOCX 搜索能力；未修改产品功能代码；工作树变更仅限测试夹具/验证/
  可靠性修复与报告。
