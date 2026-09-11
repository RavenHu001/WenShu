# TASK-007 完成报告：基础 DOCX 阅读、编辑与安全保存

简体中文 | [English](./TASK_007_COMPLETION_REPORT.en.md)

[任务档案](../README.md) · [文档中心](../../README.md)

> 实现完成日期：2026-08-10；最新回归与手工验收日期：2026-08-11；验证平台：Windows 11
> （zh-CN），Node.js 22.15.0，npm 10.9.2，Electron 37.x，Microsoft Word
> 16.0.20228.20158 与 WPS Office（外部 Office 验证环境，WPS 版本未记录）。
> WP0-WP6 逐包实施、逐包验收；自动验收（typecheck/lint/format:check/全部测试/check/build）、
> 开发与生产构建桌面冒烟、性能观察与外部 Office 验证由开发 Agent 完成；
> 第 8.7 节手工界面清单最终由项目所有者在 WPS Office 上复核通过。

## 1. 实现摘要

按工作包顺序完成了 DOCX 从受控读取到安全保存的完整闭环：

```text
工作区中的普通 .docx
  -> 路径/链接/真实路径/20 MiB 受控校验 + 原始字节 SHA-256 revision
  -> ZIP/OOXML 结构检查与固定资源预算（条目/解压/关键 XML/模型节点数）
  -> 有限属性补充读取（run 颜色、页眉页脚、修订、保护、嵌入对象）
  -> Mammoth 语义导入 -> 项目结构化中间模型 DocxDocumentModel + 兼容性报告
  -> 每标签 Tiptap/ProseMirror 富文本会话编辑（段落/标题/marks/字号/颜色/列表/对齐）
  -> dirty 经内容版本判定，可撤销/重做，受关闭/切换/关窗保护
  -> 保存前重新校验磁盘 revision + degraded 确认门禁
  -> 同目录滚动备份 <文件名>.wenshu.bak -> 生成新 DOCX -> 大小/结构/重新导入验证
  -> 排他临时写入 -> sync -> close -> 替换前复检 revision -> 安全替换
  -> 任一失败保留原文件、备份与未保存编辑
```

## 2. 新增与修改的关键文件

| 模块     | 文件                                                                                                                                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 共享契约 | `src/shared/docx.ts`（模型/预算/运行时校验/兼容性/读写契约/稳定错误码）、`src/shared/docx-convert.ts`（导入源→模型、模型↔Tiptap JSON、模型→导出描述）、`src/shared/desktop-api.ts`（readDocx/saveDocx）                                                                                                                                     |
| 主进程   | `src/main/docx/`：`inspect-docx-package.ts`（ZIP 预算+有限属性）、`import-docx.ts`（Mammoth→模型）、`export-docx.ts`（模型→产物+验证）、`read-docx-document.ts`、`save-docx-document.ts`、`docx-ipc.ts`；`src/main/document/path-validation.ts`、`write-safety.ts`（TXT/DOCX 共用安全 helper）；`src/main/index.ts`、`src/preload/index.ts` |
| renderer | `src/renderer/lib/document-tabs.ts`（TXT/DOCX 判别联合）、`use-documents.ts`（联合 controller）；`components/document/`：`DocxEditorSessionHost.tsx`、`DocxToolbar.tsx`、`DocxCompatibilityNotice.tsx`、`DocumentPane.tsx`、`TabBar.tsx`；`components/workspace/`（文件树 `.docx` 选择）；`App.tsx`                                         |
| 测试     | `tests/docx/`：fixture-builder、fixture-suite、model、convert、inspect、import、read、save、export、ipc；`tests/document/`：document-tabs、docx-editor、docx-lifecycle；`tests/preload/contract.test.ts`、`tests/workspace/components.test.tsx` 修改                                                                                        |
| 文档     | `docs/tasks/task-007/TASK_007_WP0_REPORT.md`、本报告；README、PROJECT_BASELINE、TESTING、任务文档同步                                                                                                                                                                                                                                       |

## 3. 新增依赖、版本、用途与许可证

| 依赖                                            | 版本   | 许可证                   | 用途                                   |
| ----------------------------------------------- | ------ | ------------------------ | -------------------------------------- |
| `mammoth`                                       | 1.12.1 | BSD-2-Clause             | DOCX 语义导入（文档树 + 警告）         |
| `jszip`                                         | 3.10.1 | MIT（双许可按 MIT 使用） | ZIP/OOXML 结构、资源预算与有限补充读取 |
| `docx`                                          | 9.7.1  | MIT                      | 中间模型 → 基础 DOCX 导出              |
| `@tiptap/core` / `@tiptap/pm` / `@tiptap/react` | 3.29.2 | MIT                      | Tiptap/ProseMirror 编辑器              |
| `@tiptap/starter-kit`                           | 3.29.2 | MIT                      | 最小扩展集（v3 已含下划线/列表/历史）  |
| `@tiptap/extension-text-style`                  | 3.29.2 | MIT                      | textStyle 标记（Color/FontSize 依赖）  |
| `@tiptap/extension-color`                       | 3.29.2 | MIT                      | 文字颜色                               |
| `@tiptap/extension-text-align`                  | 3.29.2 | MIT                      | 段落对齐                               |
| `@tiptap/extension-underline`                   | 3.29.2 | MIT                      | 备用（StarterKit v3 已含，不重复注册） |

新增依赖无 `npm audit` 告警；现存 high 均为既有问题（Electron 37 固定版本、eslint 工具链的
brace-expansion），非本任务引入。Tiptap v3.29.2 peer 支持 React 19；`docx` 在
`exactOptionalPropertyTypes` 严格模式下需条件展开构造参数（已在夹具代码处理）。

## 4. 中间模型、预算与运行时校验

- `DocxDocumentModel`（schemaVersion 1）：paragraph/heading（1-3 级）/bullet-list/ordered-list
  块 + run（text + marks：bold/italic/underline/font-size/color），颜色规范大写 `#RRGGBB`、
  字号为磅值（≤1638）；列表为嵌套结构 + 显式 level（0-4）；
- 固定预算：文件 20 MiB、ZIP 条目 ≤128、关键 XML 解压 ≤1 MiB、总解压 ≤64 MiB、
  模型块 ≤20000、单块 run ≤512、run 文本 ≤4096 UTF-16、列表深度 ≤5、marks ≤8、
  序列化 ≤8 MiB；超限返回稳定 `TOO_LARGE` / `RESOURCE_LIMIT_EXCEEDED`；
- `validateDocxDocumentModel` 深度运行时校验：未知 schemaVersion 拒绝、规范 marks 顺序、
  无额外字段、循环引用兜底；IPC 入口对模型再次校验（结构+预算）。

## 5. ZIP/OOXML 检查、导入与不支持内容检测

- 检查顺序：大小（20 MiB，解析前）→ ZIP 元数据预算 → 关键部件（`[Content_Types].xml` +
  `word/document.xml`）→ 有限扫描（顶层段落 run 颜色序列；`w:ins`/`w:del`；header/footer
  部件；settings.xml 中明确启用的 `w:documentProtection`；embeddings/vbaProject）；
- 导入：`mammoth.convertToHtml({buffer}, {transformDocument})`（选项是第二参数）的文档树 →
  库无关 `DocxImportSource` → `importSourceToDocxModel`；行内换行 → `\n`、超长 run 无损拆分、
  相邻同 marks run 合并；颜色按序合并（数量不一致时保守放弃）；
- 兼容性警告码（稳定可测）：image/table/header-footer/comment/revision/field/formula/
  embedded-object/hyperlink/unknown-style/heading-level-unsupported/encrypted-protected/
  other-unrecognized；任一只读码（encrypted-protected/embedded-object）→ `read-only`，
  其余 → `degraded`，无警告 → `supported`；
- 不访问外部关系、不执行宏/脚本/嵌入内容；悬空 hyperlink 关系 → 稳定 `INVALID_DOCX`。

## 6. 富文本编辑器 schema、会话与 dirty 策略

- 最小扩展链：StarterKit（heading 1-3、`link: false`）+ TextStyle + Color + FontSize +
  TextAlign；下划线由 StarterKit v3 提供；
- 每标签一个 Tiptap Editor 实例，全部 DOCX 宿主稳定挂载、非活动以 `hidden` 隐藏，
  切换不销毁会话（选择/滚动/撤销历史隔离）；编辑器实例不跨 IPC；
- 内容变化只在 `transaction.docChanged` 时上报（无变化事务不制造 dirty）；模型经
  `tiptapJsonToDocxModel` 转换（未知节点/标记/危险属性拒绝）；外部替换（重读/保存回写
  基线）以正文文本一致判定，一致不重置历史；
- dirty 经编辑修订号（单调版本）判定，不做每次输入的无界深比较；保存捕获修订号，
  完成仅在修订号仍匹配时清除 dirty。

## 7. 导出、重新导入验证、revision、备份与安全替换

- 导出：模型 → `docx` 库重建（标题/marks/字号半磅/颜色去 `#`/对齐/编号 levels 0-4/
  项目符号），已知限制：core.xml 时间戳非确定（不影响 revision 语义）；
- 产物验证：大小 ≤20 MiB → ZIP/OOXML 结构 → 重新导入（Mammoth），返回新产物兼容性；
- 保存顺序（第 4.7 节）：请求/模型校验 → 路径/链接/真实路径重校验 → revision 冲突 →
  磁盘兼容性判断（read-only 拒绝；degraded 需 `compatibilityConfirmationRevision ===
expectedRevision`）→ 滚动备份（自身排他临时文件→刷盘→关闭→替换）→ 生成 → 验证 →
  目标临时写入 → 替换前复检 → 安全替换；任一失败不删除不截断原文件，尽力清理临时文件；
- 备份 `<文件名>.wenshu.bak` 内容等于保存前原文件，只保留最近一次版本。

## 8. 多类型标签、异步身份与生命周期保护

- `DocumentTabState = TextDocumentTabState | DocxDocumentTabState`（kind 判别）；TXT 分支
  与既有实现一致，DOCX 分支持有模型/兼容性/确认 revision/备份提示；
- 异步结果提交统一三重校验（工作区会话 epoch / 目标标签 / 请求编号）+ 保存在途一致性；
  确认绑定 revision，重读后重置；
- dirty 关闭、工作区切换、窗口关闭聚合确认与 saving 标签保护在 TXT/DOCX 上统一复用
  （组件测试固化）。

## 9. Electron / IPC 安全边界

- `nodeIntegration: false`、`contextIsolation: true`、sandbox 保持；preload 只新增
  `document.readDocx(relativePath)` / `document.saveDocx(request)`，不暴露 ipcRenderer/
  Buffer/任意调用器；
- `document:read-docx` 单字符串参数；`document:save-docx` 字段白名单（relativePath/
  expectedRevision/model/compatibilityConfirmationRevision）+ 模型运行时校验；拒绝根路径、
  绝对路径、临时/备份路径、原始 HTML/XML、force/skipBackup 等危险字段；根路径只来自
  主进程工作区会话快照；
- 跨进程结果只含稳定 code/可展示消息；错误与日志不含正文、OOXML、绝对路径、Buffer、
  句柄或临时名称（测试断言 JSON 序列化不泄漏）。

## 10. 自动检查、构建与桌面冒烟证据

| 命令                       | 结果                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `typecheck`（5 tsconfig）  | **通过**（每工作包）                                                               |
| `lint`（--max-warnings=0） | **通过**（0 warning）                                                              |
| `format:check`             | **通过**（Windows 检出环境行尾策略固定）                                           |
| `test`（32 文件 742 用例） | **通过**：737 passed / 5 skipped（真实 symlink 权限条件，mock 拒绝分支确定性覆盖） |
| `check`                    | **通过**（退出码 0）                                                               |
| `build`                    | **通过**（2026-08-11 最新生产构建退出码 0）                                        |

测试覆盖运行时、工作区扫描、TXT/DOCX 读取与安全保存、IPC/preload、窗口生命周期、搜索、
DOCX 夹具/模型/转换/检查/导入/导出、混合标签、编辑器视觉样式与外部模型同步。新增回归包括
0 字节 DOCX、WPS `enforcement="0"`、备份文件树隐藏、中文合成斜体、非活动标签视觉隔离，以及
正文相同但 marks 不同的外部重读。
`check` 与 `build` 未并行运行；React 组件测试无未等待的 `act(...)` 警告（WP0 归因修复）。

开发模式与生产构建桌面冒烟：`.\scripts\dev.cmd` 18s 存活、`npm exec -- electron .` 15s 存活，
均无 preload/React/资源错误日志。

## 11. 性能观察（一次性观察，非基准门禁；临时脚本观察后已删除）

| 场景                                 | 结果                                                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 普通 DOCX 读取（含导入）             | 10-34 ms（ok-plain 33.9 / ok-lists 13.4 / ok-font-size-color 12.0 / complex-image 14.8 / complex-table 11.2 / complex-header-footer 9.9） |
| 模型 → Tiptap JSON                   | 0.0-0.5 ms                                                                                                                                |
| 导出 + 产物验证                      | 11.6-20.7 ms                                                                                                                              |
| 接近 20 MiB 文档读取                 | 135.5 ms                                                                                                                                  |
| 超过 20 MiB 拒绝                     | 0.7 ms                                                                                                                                    |
| 900 KB document.xml（近 1 MiB 预算） | 4.8 ms                                                                                                                                    |

全部满足"数秒内打开"目标；主进程解析/导出全程有界且不阻塞事件循环。

## 12. 外部 Office 程序、版本与往返观察

- 外部 Office：Microsoft Word 16.0.20228.20158（`C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE`）
  与 WPS Office（项目所有者手工测试，版本未记录）；
- Word COM 打开文枢导出产物：**成功**，5 个段落，标题（WENSHU-H1）、居中粗体正文、
  斜体 14pt 文本、项目符号条目、编号条目全部识别为 True；
- Word COM 写入自动化受本机 Protected View/恢复对话框影响；该环境限制不再作为验收缺口，
  因为项目所有者已在 WPS Office 上完成最新版双向手工测试；
- WPS 手工验收：**通过**。覆盖 0 字节占位 DOCX 首次物化、WPS 普通文档读取与编辑、
  文枢保存产物由 WPS 重新打开、外部修改冲突、滚动备份恢复、中文斜体显示、
  TXT/DOCX 与多 DOCX 标签切换隔离；
- 外部进程修改冲突闭环（同语义验证）：外部程序追加字节修改文件后，文枢以旧 revision
  保存 → `CONFLICT` 零写入，外部内容保留、未生成备份；重新读取后保存成功 → 新 revision
  `a12564fc...`；滚动备份 `a.docx.wenshu.bak` 内容 = 保存前（含外部修改）版本且可重新导入；
  保存产物可重新导入（WENSHU-SAVED 正文）；工作区无 `.wenshu-*` 临时残留。

## 13. 已知限制

1. `docx@9` core.xml 时间戳取当前时间，产物字节非完全确定（revision 基于实际字节，不受影响）；
2. 行内换行以 `\n` 文本写出，tab 被 Mammoth 静默丢弃，不承诺 Word 级版式一致；
3. 非 ASCII 大小写折叠不实现（TXT 搜索既有限制）；TXT 搜索不包含 DOCX；
4. 保存期间外部变化的 TOCTOU 竞态只做保存时刻复检，不承诺实时监听（与 TXT 一致）；
5. 备份只保留最近一次版本，无版本历史与恢复入口 UI；内部 `.wenshu.bak` 不在文件树显示。

## 14. 是否满足全部验收标准

TASK-007 第十一节 11.1-11.5 全部验收项已在任务文档勾选。自动验收项全部由命令实际执行通过；
开发与生产构建桌面冒烟、性能观察与 Word 打开验证由 Agent 完成；项目所有者已在 WPS Office
完成第 8.7 节最终手工清单，双向打开保存、冲突、备份恢复和近期界面修复均验证通过。

## 15. 任务状态与后续入口

**TASK-007 状态：已完成。**

下一任务已规划为 [TASK-008：工作区 DOCX 正文搜索与富文本结果定位](../task-008/TASK_008_DOCX_WORKSPACE_SEARCH.md)：
复用 Task 6 已验证的搜索请求、取消、预算、统计和过期结果原则，为 DOCX 单独设计规范正文
投影、文本块位置映射、结果 revision 与富文本编辑器二次校验；在 Task 7 完成前不把 DOCX
隐式加入 TXT 搜索器。
