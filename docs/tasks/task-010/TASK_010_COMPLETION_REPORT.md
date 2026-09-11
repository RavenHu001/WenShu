# TASK-010 完成报告：当前 DOCX 内查找与替换

简体中文 | [English](./TASK_010_COMPLETION_REPORT.en.md)

[任务档案](../README.md) · [文档中心](../../README.md)

> 实施日期：2026-08-19/20（WP0-WP7 逐包实施、逐包验收）；验证平台：Windows 11（zh-CN，
> build 10.0.26200），Node.js 22.15.0，npm 10.9.2，Electron 37.10.3，TypeScript 5.9.3，
> Vitest 3.2.7，Tiptap 3.29.2（@tiptap/core / @tiptap/pm / @tiptap/starter-kit）。
> 自动验收（typecheck/lint/format:check/全部测试/check/build）、开发与生产构建启动冒烟、
> WP6 性能与泄漏观察由开发 Agent 完成；任务第八节手工界面验收与 Windows 手工冒烟由
> 项目所有者执行并通过（用户确认"手动测试已通过，测试手动跑了一遍没有报错"）。

## 1. 实现摘要

按工作包顺序（WP0 锁定基线、编辑器事务与资源语义 → WP1 纯查找、文本块与位置映射 →
WP2 ProseMirror 插件、装饰与每标签 controller → WP3 搜索侧栏、快捷键与活动 editor 接入 →
WP4 替换当前项、全部替换与模型预验证 → WP5 兼容性、保存中编辑、路径迁移与跨功能回归 →
WP6 性能观察、Windows 冒烟与风险收敛 → WP7 整体验收、文档与完成报告）完成了"当前 DOCX
内查找与替换"的交付：

```text
活动 DOCX（Tiptap/ProseMirror 实时文档）
  -> 每编辑器安装一次 current-search 插件（PluginKey + DecorationSet + generation 调度）
  -> 实时 textblock 投影（复用 joinDocxTextBlocks）→ UTF-16 literal 匹配（≤2000，2001+ 截断）
  -> 普通/当前匹配双 class 高亮；F3/Shift+F3、Enter/Shift+Enter 循环导航；Escape 关闭并恢复焦点
  -> 替换当前项：执行瞬间重新扫描复验 + 起点字符 marks 继承
  -> 全部替换：≤2000 项逆序单 transaction；dispatch 前 tiptapJsonToDocxModel + 序列化预算验证
  -> 进入既有 editDocxTab / dirty / editRevision / 保存（revision 冲突、滚动备份、安全替换）流程
  -> read-only / degraded 确认 / saving / save-error / conflict / read-error / 路径迁移生命周期确定
```

## 2. 新增与修改的关键文件

### 新增文件（产品代码）

| 文件                                                                   | 用途                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/renderer/lib/docx-current-search.ts`（WP1）                       | 纯函数层：查询/替换输入校验（非空、≤4096 UTF-16、单行）、literal + ASCII 大小写折叠、非重叠有界匹配、2000/2001 预算与截断、实时 textblock 投影（复用 `joinDocxTextBlocks`）、投影范围 → PM 位置映射、当前索引初选与循环/最近匹配选择                                                                                                       |
| `src/renderer/lib/docx-current-search-plugin.ts`（WP2/WP4）            | ProseMirror current-search 插件（PluginKey、插件状态、DecorationSet、微任务单次调度 + generation 丢弃旧计算、销毁清理）与每稳定 tabId 的窄 controller（快照订阅、open/close/setQuery/setReplacement/setCaseSensitive/selectNext/Previous、replaceCurrent/replaceAll、focusEditor）；替换事务构建（起点字符 marks、逆序单事务、模型预验证） |
| `src/renderer/components/search/DocxCurrentSearchPanel.tsx`（WP3/WP4） | DOCX 查找/替换面板：受控查找与替换输入、大小写选项、上一个/下一个/关闭按钮、计数/截断/输入错误/操作反馈、read-only/degraded 禁用原因、Enter/Shift+Enter/F3/Shift+F3/Escape 与焦点恢复；只经窄 controls 操作，不接触 Editor/EditorView                                                                                                      |

### 修改文件（产品代码）

| 文件                                                         | 变更                                                                                                                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/components/document/DocxEditorSessionHost.tsx` | 每标签安装一次搜索插件/controller（绑定稳定 tabId）、注册窄 controls、Ctrl+F/Ctrl+H/F3/Shift+F3 快捷键、可替换权限派生（可编辑 + 非 degraded 或已确认绑定当前 revision）并同步 controller |
| `src/renderer/components/document/DocumentPane.tsx`          | DOCX 宿主保持挂载（非活动隐藏）、每标签搜索 controls 注册表、活动 controls 原子上交给 App（切换/挂载/卸载时清理）                                                                         |
| `src/renderer/components/search/SearchSidebar.tsx`           | 按活动 kind 分流：TXT 继续 CodeMirror 面板宿主，DOCX 渲染 `DocxCurrentSearchPanel`；同一时刻只显示活动 kind 的面板                                                                        |
| `src/renderer/App.tsx`                                       | Ctrl+F/Ctrl+H 请求切换搜索侧栏与聚焦字段（含 read-only 窗口级快捷键补充）、活动 DOCX controls 状态、替换可用性与原因派生、定位/mutationEpoch 与当前查找互不干扰                           |
| `src/renderer/styles/app.css`                                | 最小样式：普通/当前匹配 class、查找/替换表单、计数、错误、截断与禁用原因、焦点可见性                                                                                                      |

### 新增测试文件

| 文件                                                             | 覆盖                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/docx/docx-current-search-assumptions.test.tsx`（WP0）     | 最小 Tiptap/ProseMirror 技术验证（22 用例）：投影一致性、跨 marks 范围、UTF-16（中文/emoji/组合字符）、Decoration、替换 marks 实测、逆序单事务、模型预算失败、read-only/degraded/saving 语义、性能观察                                                |
| `tests/docx/docx-current-search.test.ts`（WP1）                  | 纯模块（23 用例）：输入校验、literal/大小写/非重叠/截断、投影与 PM 映射、标题/列表/中文/emoji、循环/最近匹配、2000/2001（含恰好 2000 项后接非匹配尾部）                                                                                               |
| `tests/document/docx-current-search-plugin.test.tsx`（WP2）      | 插件/controller（15 用例）：状态/快照/装饰范围与 class、不 dirty/不进历史、循环导航与选区焦点（可编辑与 read-only）、编辑后/外部 setContent/快速输入重算调度、多 editor 隔离、销毁清理与 generation                                                   |
| `tests/search/docx-current-search-panel.test.tsx`（WP3）         | 面板组件（8 用例）：受控输入、计数/截断/错误、大小写与按钮、键盘导航、Escape 焦点恢复、read-only/degraded 禁用、WP4 替换区接线与截断禁用                                                                                                              |
| `tests/search/docx-current-search-app.test.tsx`（WP3/WP4）       | App 集成（12 用例）：Ctrl+F/H、即时搜索与装饰、导航、Escape、TXT/DOCX 混合面板切换、多 DOCX 隔离、read-only/degraded/loading、关闭标签清理、替换当前项/全部替换 → dirty 与一次 undo                                                                   |
| `tests/document/docx-current-search-replace.test.tsx`（WP4）     | 替换（15 用例）：单/跨 marks 起点格式继承、空/短/长/中文/emoji、结构保持、实时复验 stale 拒绝、权限命令内拒绝、输入校验、逆序单事务无漂移、一次 undo/redo、0 匹配无操作、2000/2001、快速重复点击、结果仍含查询时前进到下一项、模型预算失败 0 dispatch |
| `tests/search/docx-current-search-lifecycle.test.tsx`（WP5）     | 兼容性与生命周期（15 用例）：read-only/degraded 确认与 revision 失效、saving 期间替换、save-error/conflict/read-error、关闭重开、工作区切换、两 DOCX 旧 controls 不污染、重命名/移动/另存为会话保持、工作区定位/mutationEpoch 互不污染                |
| `tests/docx/docx-current-search-wp6-observation.test.tsx`（WP6） | 性能与泄漏观察（7 用例）：典型 100 段、20,000 textblock（0/200/20000 匹配）、近序列化上限、全部替换 2000 项耗时、快速输入合并、20 次开关面板无重复订阅、20 次标签切换无控制台错误/单一输入/堆观察                                                     |
| `docs/tasks/task-010/TASK_010_WP0_REPORT.md`（WP0）              | WP0 基线、技术验证、冻结决策与性能观察                                                                                                                                                                                                                |

## 3. 固定语义落地（任务第四节）

- **搜索来源**：活动 Tiptap/ProseMirror 实时 `state.doc`；不读磁盘、不搜索模型旧快照/编辑器 DOM/OOXML。
- **投影**：深度优先 textblock，相邻块恰一个人工 \n，UTF-16 偏移；映射公式「块内容起点 pos+1 + 块内偏移」（与 Task 8 共用 `joinDocxTextBlocks`，无第二套正文语义）。
- **输入**：查询非空、≤4096 UTF-16、单行（\r/\n 拒绝）；替换 ≤4096 UTF-16、单行（空替换 = 删除）。
- **匹配**：literal + caseSensitive；大小写不敏感只折叠 ASCII A-Z（与 Task 6 matcher 一致，不 Unicode 规范化）；从左到右、非重叠；最多 2000 项，第 2001 个起 truncated。
- **替换当前项**：执行瞬间重新投影并复验 pmFrom/pmTo 双重匹配；失效 → 拒绝并提示重算，0 dispatch。
- **marks 继承**：非空替换继承匹配起点**字符**所在 text node 的 marks（WP0 F1：不用 `resolve(from).marks()` 的边界前语义）；空替换删除；段落/标题/列表/对齐结构与周围格式保持。
- **全部替换**：0 匹配无操作；truncated 或 >2000 整体拒绝（0 部分替换）；从末到前同一 transaction；每个匹配各自继承起点 marks；dispatch 前对 `tr.doc.toJSON()` 执行 `tiptapJsonToDocxModel` + 序列化预算验证，任一失败 0 dispatch/0 dirty；成功只 dispatch 一次、一次 undo/redo。
- **权限**：read-only / degraded 未确认 / editor 不可编辑时命令内防御性拒绝（不依赖按钮 disabled）；degraded 确认绑定 `document.revision`，重读新 revision 后旧确认失效。
- **保存**：替换只是普通可撤销编辑事务，进入 `editDocxTab`/dirty/editRevision；saving 期间替换不被旧保存完成清除；不自动保存，保存继续走既有 revision 冲突、滚动备份、产物验证与安全替换。

## 4. 插件、controller 与 UI

- 每编辑器安装一次 `createCurrentSearchPlugin`（PluginKey `wenshu-current-search`）；插件状态含 open/query/replacement/caseSensitive/matches/currentIndex/truncated/validationError/operationMessage/decorations/generation。
- 重算调度：编辑事务/输入变化后微任务单次调度（`scheduled` 合并），执行时读取最新 doc/query；异步回调带 `requestGeneration` 与销毁守卫，旧 editor/旧计算绝不回报；无 debounce 定时器、无 worker/索引/缓存。
- DecorationSet 存入插件状态：普通匹配与当前匹配不同 class（当前匹配同时带两 class，不只依赖颜色）；文档事务经 `mapping` 安全更新，重算整体替换；查找/导航/关闭不修改正文、不 dirty、不进撤销历史。
- controller 提供 `getSnapshot/subscribe`（useSyncExternalStore 兼容）与窄操作；UI（面板/App）只经 `DocxCurrentSearchControls` 交互，不暴露 Editor/EditorView。
- 侧栏：TXT 保持 CodeMirror 面板宿主与既有行为；DOCX 显示项目面板；同一时刻只显示活动 kind 的面板；Ctrl+F/H 从两侧栏与 read-only 窗口级快捷键统一进入。

## 5. 兼容性与生命周期（WP5 证据）

| 场景                        | 固定行为                                                                                                                  | 证据                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| read-only                   | 可查找/导航/装饰；替换入口禁用且命令层拒绝（editor 不可编辑）                                                             | app + plugin + lifecycle 测试                                   |
| degraded 未确认             | 可查不可替换；原因明确；确认绑定当前 revision 后**同一 editor** 即可替换（不重建）；重读新 revision 后旧确认失效          | lifecycle 测试（editor 引用恒等 + 保存请求携带确认 revision）   |
| saving 期间替换             | 与普通键入相同 editDocxTab 语义：editRevision 更高，旧保存完成仍 loaded-dirty，磁盘保存的是替换前内容                     | lifecycle 测试（磁盘请求模型 vs 编辑器内容断言）                |
| save-error / conflict       | 查找与替换仍可用并进入 dirty；conflict 重读回到磁盘内容                                                                   | lifecycle 测试                                                  |
| read-error                  | 带快照可查可替换（dirty 保留）；无快照不挂载 editor、不显示假可用面板                                                     | lifecycle 测试                                                  |
| 多标签 / 关闭 / 工作区切换  | 每标签查询/选项/匹配/装饰/历史隔离；关闭重开是新会话（新 tabId/新 editor，查询不残留）；工作区切换清空全部标签与 controls | app + lifecycle + WP6 20 次切换测试                             |
| 重命名 / 移动 / 另存为      | 稳定 tabId：不重建 editor，面板/查询/装饰保持；路径迁移纯状态转移（Task 9 基座）                                          | lifecycle + tab-path-migration 测试                             |
| 工作区定位 / mutationEpoch  | 结果定位不改写当前查找查询；mutationEpoch 只作废工作区搜索，不清空当前 DOCX 搜索                                          | lifecycle 测试                                                  |
| 旧 controls / 订阅 / 定时器 | 迟到编辑回报不污染活动面板；销毁清理订阅；无 setInterval/setTimeout（仅微任务）                                           | WP2 销毁测试 + WP6 泄漏观察（20 周期恰一次通知、无定时器 grep） |

## 6. 安全边界（任务第七节）

- 未新增 IPC channel、preload 方法或 DesktopApi：仍为 17 个固定 `ipcMain.handle`（workspace 6 + document 4 + save-as 2 + search 2 + window 3），preload 契约测试（23 用例）通过。
- 查询、替换文本、匹配范围与正文不跨 IPC、不进日志；产品搜索模块无任何 `console.*` 调用。
- 搜索/替换不写磁盘、不创建临时文件或备份；替换只修改内存 editor，保存仍走 Task 7/9 既有路径。
- 不解析正文 DOM、不使用 Tiptap 私有字段（代码审查：全部公开节点/事务/命令 API）。
- 未新增第三方依赖（package-lock 无变化）；WP0 已评估并冻结依赖结论。

## 7. 自动检查与最终测试基线

| 命令                        | 结果                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `typecheck`（5 tsconfig）   | **通过**                                                                                        |
| `lint`（--max-warnings=0）  | **通过**（0 warning）                                                                           |
| `format:check`              | **通过**                                                                                        |
| `test`（62 文件 1143 用例） | **通过**：1133 passed / 10 skipped                                                              |
| `check`                     | **通过**（退出码 0，约 30 s，Vitest 约 50-63 s）                                                |
| `build`                     | **通过**（退出码 0；main 154.91 kB / preload 4.10 kB / renderer JS 2,205.76 kB / CSS 27.84 kB） |

- 10 个条件跳过全部为真实符号链接/junction 权限条件（`it.runIf`）：read-text-document 2、read-docx-document 2、search-text-workspace 1、search-mixed-workspace 1、resolve-workspace-entry 1、relocate-workspace-entry 1、trash-workspace-entry 1、reveal-workspace-entry 1；拒绝分支均由 mock 适配器确定性覆盖。
- Task 1 至 Task 9 全部既有测试原样执行并通过（WP5 定向 14 文件 196 用例 + 全量回归）；无 `.only`、无条件 `.skip` 或弱化断言。
- 唯一预期 stderr：保存器/新建清理失败注入用例的 `wenshu: 清理临时文件失败 (EACCES/EPERM)`（既有基线）。

## 8. Windows 开发/生产构建冒烟与实测证据

| 验证项                                                   | 结果                                                                                                                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 开发模式（`scripts\dev.cmd`，WP7 终验）                  | dev server（renderer :5173）+ main/preload 构建成功，4 个 electron 进程存活，日志无 error/Uncaught/failed，清理后残留 0                                                                                                 |
| 生产构建（`node_modules\.bin\electron.cmd .`，WP7 终验） | 4 个 electron 进程存活 ≥14 s，stdout/stderr 无错误，清理后残留 0                                                                                                                                                        |
| 手工界面验收（任务第八节）                               | 由项目所有者手动执行并通过（Ctrl+F/H、导航、高亮、不同 marks 格式继承、全部替换/撤销/重做/保存、标题列表中文 emoji、read-only/degraded、TXT/DOCX 混合、dirty/saving、外部冲突、重命名/移动/另存为、最小窗口与键盘焦点） |
| 临时残留                                                 | 仓库无 `.wenshu-*` 残留；仅既有 `*.log`（`.gitignore` 覆盖）；`out/`、`.tools/` 忽略                                                                                                                                    |
| Electron 暴露面（审查）                                  | 17 个固定 IPC 通道；无通用 invoke/ipcRenderer 泄漏；无新增权限                                                                                                                                                          |

## 9. 性能与泄漏观察（WP6，一次性观察非 CI 硬断言）

| 场景                                                      | 实测（jsdom 本机，本轮）                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| 典型 100 段 DOCX，查询 100 匹配重算 + 装饰                | 11.8 ms                                                                     |
| 20,000 textblock：0 匹配                                  | 14.8 ms                                                                     |
| 20,000 textblock：200 匹配                                | 39.3 ms                                                                     |
| 20,000 textblock：20000 匹配（截断 2000 + 装饰）          | 165.7 ms                                                                    |
| 近序列化上限（8,386,188 / 8,388,608 字节）截断查询 + 装饰 | 93.7 ms                                                                     |
| 全部替换 2000 项：构建 + 模型预验证 + dispatch            | 59.2 ms                                                                     |
| 快速连续输入                                              | 5 次输入合并为 1 次重算                                                     |
| 反复开关面板 20 次                                        | 装饰 2→0 每周期清理；每状态变化恰 1 次通知（无重复订阅）                    |
| 两个 DOCX 标签切换 20 次                                  | 单一输入、查询稳定、console.error 0 次；heapUsed +7.3 MB（GC 噪声，仅观察） |

普通文档远低于 100 ms 目标；最重近上限场景约 90-170 ms 量级，无可感知卡顿（WP0 冻结的同步全量重算 + 单次调度 + generation 策略成立）。

## 10. 第十一节验收核对（45 项全部勾选）

- **11.1 查找与导航（9 项）**：Ctrl+F/H 与侧栏入口（app/panel 测试）；实时未保存 PM 文档（plugin/代码审查）；literal/大小写/非重叠/单行/长度（WP1 纯测试）；段落/标题/跨 marks/列表/中文/emoji（WP1/assumptions/result-locate）；不跨人工换行（WP1）；循环导航/计数/选区/滚动/焦点（plugin + app）；双 class 装饰不修改正文（plugin）；2000/2001 预算与截断（WP1/replace/panel）；查找/导航/关闭不 dirty 不进历史（plugin + app）。
- **11.2 替换（10 项）**：实时复验（replace）；空/短/长/中文/emoji（replace）；起点 marks（replace/assumptions）；结构保持（replace）；逆序单 transaction（replace）；一次 undo/redo（replace/assumptions）；0 匹配/2001+ 整体拒绝（replace）；模型/预算失败 0 dispatch（replace/assumptions）；dirty/editRevision 且不自动保存（app/lifecycle）；保存走既有 revision/备份/安全替换（lifecycle/docx save 回归）。
- **11.3 兼容性与生命周期（9 项）**：read-only；degraded 确认与 revision 失效；saving 期间替换；save-error/conflict/read-error；多标签隔离；关闭/重开/工作区切换清理；重命名/移动/save-as stable tabId；定位/mutationEpoch 互不污染；无迟到 controls/重复订阅/定时器/editor 泄漏（WP5 lifecycle + WP2 销毁 + WP6 泄漏观察）。
- **11.4 UI、可访问性与安全边界（8 项）**：TXT CodeMirror 回归（find-replace 9 用例 + 混合切换测试）；面板控件/计数/错误/截断/禁用原因（panel）；快捷键/焦点/名称（panel/app）；当前匹配不只依赖颜色 + 最小窗口（双 class + WP6 冒烟）；公开 API 审查；无日志正文（grep 审查）；无新增 IPC/preload（契约测试 + handle 计数）；无新依赖（package-lock 审查）。
- **11.5 质量、性能与文档（9 项）**：测试完整（62 文件 1133 通过）；check 通过且跳过项有合理条件；build 通过；开发/生产冒烟通过；性能观察（WP6）；无控制台异常/泄漏/残留（WP6 + 残留审查）；README/PROJECT_BASELINE/TESTING/项目结构同步（本包更新）；WP0 报告 + 本完成报告完整；Task 1-9 无回归。

## 11. 已知限制

1. 大小写不敏感匹配为 ASCII-only 折叠、不做 Unicode 规范化（与 CodeMirror 的 NFKD 差异为固定已知行为，TXT 引擎不改写，见 WP0 F3）。
2. Tiptap v3 StarterKit 默认 TrailingNode 在文档以非 paragraph 块结尾时追加末尾空段（WP0 F2）；实时 doc 为唯一来源，空块无匹配，语义自洽。
3. 替换/全部替换只作用于实时编辑内容与既有 DOCX 模型能力（图片/表格/页眉页脚/批注/修订等未进入结构化模型的内容不在承诺内）。
4. jsdom 滚动坐标与真实浏览器渲染路径不可断言，真实滚动/聚焦由 WP6 手工冒烟覆盖。
5. 性能数字为一次性观察（jsdom 本机），非 CI 基准门禁；真实浏览器滚动/渲染由冒烟观察。
6. 本任务不提供工作区替换、批量替换、正则/模糊搜索、文件系统监听、自动保存与会话恢复（明确非目标）。

## 12. 是否满足 Task 10 全部验收标准

- 任务文档第十一节 11.1-11.5 全部验收项（共 45 项）已逐项核对并勾选为 `[x]`：每项均有对应自动化测试、WP0 技术验证、代码审查、性能记录或手工冒烟证据，无凭推测勾选项；
- `check`（62 文件 / 1133 通过 / 10 条件跳过）与 `build` 依次通过（退出码 0）；开发与生产 Windows 冒烟通过；无未解决的数据丢失、部分替换、权限扩大或明显卡顿问题；
- 本任务状态已改为「已完成」，README / PROJECT_BASELINE / TESTING / 项目结构同步更新，WP0 报告与完成报告内容完整。

**结论：Task 10 全部验收标准满足。**
