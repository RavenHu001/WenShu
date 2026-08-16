# 文枢（WenShu）

文枢是一款面向个人创作、设定整理和资料维护的本地多文档桌面工作台。它以普通文件夹作为工作区，采用类似代码编辑器的文件树、多标签页和中央编辑区域，目标是让一组相关文档能够被集中管理、搜索与编辑。

> **当前阶段：Pre-alpha / Task 8 已完成。** Task 1 至 Task 8 均已完成；工作区搜索已扩展为一次查询同时搜索磁盘上已保存的 TXT 与 DOCX 规范正文。当前应用具备工作区选择、只读文件树浏览，从文件树选择 UTF-8 TXT 或普通 `.docx` 后在中央区域以多标签页编辑：TXT 使用 CodeMirror，DOCX 经项目结构化中间模型导入并在 Tiptap/ProseMirror 富文本会话中编辑（段落、标题 1-3、粗体、斜体、下划线、基础字号、文字颜色、项目符号/编号列表、基础对齐），每个标签独立维护读取、正文/模型、未保存状态与保存状态，通过保存按钮或 `Ctrl+S` 显式保存；保存执行工作区边界、符号链接、真实路径与内容版本校验，采用同目录临时文件、刷盘、关闭和安全替换流程。DOCX 保存前生成同目录滚动备份 `<文件名>.wenshu.bak`，产物经过大小/结构/重新导入验证后才替换目标；`degraded` 文档需绑定 revision 的兼容性确认才能编辑与保存，`read-only` 文档不可编辑保存。外部修改会触发冲突提示；关闭 dirty 标签、切换工作区和关闭窗口均有未保存保护，正在保存的标签不会被丢弃。Task 6 已加入当前文件查找替换（`Ctrl+F`/`Ctrl+H`）与工作区搜索（活动栏搜索 / `Ctrl+Shift+F`）；Task 8 把工作区搜索扩展为一次查询同时搜索 TXT 与 DOCX 正文——TXT 语义保持 Task 6 不变，DOCX 只搜索 Task 7 结构化模型投影的规范正文，点击结果经 kind、revision、范围与匹配文本双重校验后打开或激活唯一标签并定位；任何过期、结构变化或映射失败只显示非破坏性提示，不错误定位、不修改正文。自动保存、文件管理与会话恢复仍不可用；当前文件查找替换仍只支持 TXT。

## 当前能力

### 可以体验

- 启动 Windows Electron 桌面窗口；
- 点击左侧"打开文件夹"按钮，通过原生对话框选择本地工作区；
- 浏览工作区目录树，展开/折叠多层文件夹；
- 手动刷新工作区以反映外部文件变化；
- 切换工作区或取消选择而不丢失当前状态；
- 查看子目录错误提示而不影响其他节点显示；
- 点击（或通过键盘激活）文件树中的 `.txt` 文件，在中央区域以标签页打开并编辑其 UTF-8 正文；连续选择多个 TXT 会依次生成多个标签，重复选择已打开文件只激活原标签；
- 点击（或通过键盘激活）文件树中的普通 `.docx` 文件，以唯一标签打开；加载期间显示明确状态，读取完成后在 Tiptap/ProseMirror 富文本编辑器中展示段落、标题 1-3、粗体、斜体、下划线、基础字号、文字颜色、项目符号/编号列表与基础对齐；
- TXT 与 DOCX 可以混合打开；每个标签的正文/模型、选择、滚动、撤销历史、dirty、保存与错误状态独立，切换保留各自会话；同一路径只能存在一个标签；
- 点击标签在多个文档之间切换，切换保留各标签的光标、选区、滚动位置与撤销/重做历史；同名不同路径的文件可同时打开，标签可显示完整相对路径提示；
- 输入、删除、复制、粘贴、撤销和重做；空文件可正常输入；
- 通过保存按钮或 `Ctrl+S` 显式保存当前活动标签；标签显示未保存标记（●），工具条显示已保存/未保存/正在保存/保存失败/外部冲突；
- 不同标签可以并行保存；同一标签不会产生并发保存；保存期间继续编辑不会丢失后续修改；保存失败保留全部编辑内容；
- 文件被其他程序修改后保存会显示外部冲突，本地内容保留，确认后才重新读取磁盘版本；
- DOCX 重新读取会比较完整结构化模型，外部程序只修改格式而不修改文字时也会同步更新；
- DOCX 支持基础格式工具栏（粗体/斜体/下划线、段落/标题、字号白名单、文字颜色、列表、对齐、撤销/重做）；`Ctrl+S` 与保存按钮走同一 DOCX 保存流程；
- Windows/WPS 创建的 0 字节 `.docx` 占位文件按空白文档打开，首次保存时物化为有效 OOXML；只有明确启用编辑保护的 DOCX 才进入只读状态，WPS 写入的 `w:enforcement="0"` 不会被误判；
- DOCX 保存前在同目录生成滚动备份 `<文件名>.wenshu.bak`（内容为保存前原文件）；保存成功后状态栏显示备份文件名；备份持续保留但不在工作区文件树显示；备份失败或产物验证失败时目标文件不变；
- 含图片/表格/页眉页脚/批注/修订/超链接等不受支持内容的文档显示确定兼容性警告：`degraded` 需在编辑或保存前确认（确认绑定 revision），`read-only` 文档只读展示、不可编辑保存；
- 损坏、加密、伪装、超 20 MiB 或超出资源预算的 DOCX 显示稳定错误，不显示部分可编辑内容；
- BOM 与一致 LF/CRLF 换行风格在 TXT 保存后保留；混合换行保存前需要明确确认规范化；
- 关闭未保存标签前会得到"放弃修改/取消"确认，`Ctrl+W` 与关闭按钮走同一流程；有未保存修改时切换工作区或关闭窗口会显示包含未保存标签数量的聚合确认；
- 正在保存的标签不会被关闭标签、切换工作区或关闭窗口等操作丢弃，会提示等待保存完成；
- 读取期间显示加载状态；读取失败、文件过大或编码非法时显示可恢复的错误提示，且不影响其他标签；
- 通过受控 preload API 在状态栏读取平台和 Electron 版本信息；
- 在活动 TXT 标签中按 `Ctrl+F` 打开查找面板、`Ctrl+H` 打开替换面板：普通文字查询、大小写选项、上一个/下一个、替换当前项与全部替换；替换进入撤销历史并正常产生 dirty 与显式保存；查找不修改正文、不制造 dirty；查找面板、查询、选区与历史按标签隔离；
- 点击活动栏"搜索"或按 `Ctrl+Shift+F` 打开工作区搜索侧栏：一次查询同时搜索当前工作区磁盘上已保存的普通 UTF-8 TXT 与基础 DOCX 规范正文（大小写可切换、可取消、可连续提交新查询）；TXT 语义与 Task 6 完全一致，DOCX 只搜索 Task 7 结构化模型投影的正文（段落、标题、跨 run 文字、列表；图片/表格/页眉页脚/批注等未进入模型的内容不在搜索承诺内）；展示按文件分组的结果（相对路径、TXT/DOCX 类型标识、1-based 行列、安全片段）与扫描/命中/匹配/跳过统计和截断提示（含 DOCX 候选上限截断），DOCX 行列基于提取正文而非 Word 页面坐标；无工作区时显示空状态且不发起搜索；
- 点击 TXT 或 DOCX 搜索结果打开或激活唯一标签：TXT 复用 CodeMirror 安全定位；DOCX 经 kind、revision、规范投影范围与匹配文本双重校验后，用 ProseMirror 公开 API 设置选区、滚动并聚焦（read-only 可定位不可编辑、degraded 定位不自动确认、dirty 但原范围未变时可定位）；revision、范围、正文结构或宿主二次校验任一失效时只显示"搜索结果已过期"提示，不错误定位、不修改正文；
- 切换文件/搜索活动栏不丢失工作区、已打开标签或文件树展开状态；工作区成功切换清空旧搜索结果。

### 工程能力

- Electron、React、TypeScript 与 Vite 开发和生产构建链路；
- 相互隔离的主进程、preload 和渲染进程类型环境；
- `nodeIntegration: false`、`contextIsolation: true` 和 sandbox 安全基线；
- 受控 IPC 通道：`workspace.open()` / `workspace.refresh()`、`document.readText()` / `document.saveText()`、`document.readDocx()` / `document.saveDocx()`、`search.textWorkspace()` / `search.cancelTextWorkspace()` 与窗口关闭协调窄协议；
- DOCX 通过项目自有、有版本、有预算上限的结构化中间模型（`src/shared/docx.ts`）导入、编辑与导出；Tiptap/ProseMirror 实例只存在于 renderer 编辑会话层，不跨 IPC；
- CodeMirror 6 纯文本编辑器（TXT）与 Tiptap/ProseMirror 富文本编辑器（DOCX），按标签隔离会话缓存；
- 主进程对 TXT 读取与保存执行完整校验：相对路径格式、工作区边界、逐段符号链接 / junction、真实路径、普通文件类型、5 MiB 大小上限与严格 UTF-8；
- 主进程对 DOCX 执行同等的路径/链接/真实路径校验与 20 MiB 上限，并把 DOCX 作为不可信 ZIP 处理：条目数/解压大小/关键 XML/模型节点数等固定资源预算、关键部件检查、有限属性补充读取（颜色/页眉页脚/修订/保护/嵌入对象）、Mammoth 语义导入；
- TXT 保存执行内容版本（SHA-256）冲突检测，采用同目录排他临时文件、完整写入、刷盘、关闭与 `rename` 安全替换；
- DOCX 保存执行原始字节 revision 冲突检测、同目录滚动备份 `<文件名>.wenshu.bak`、产物生成与重新导入验证、排他临时写入、刷盘、关闭与安全替换；`degraded` 未确认、`read-only` 与非法模型拒绝保存；
- 主进程工作区混合搜索（TXT + DOCX）：根路径只来自主进程工作区会话，不跟随符号链接；TXT 复用受控读取，DOCX 复用受控 `readDocxDocument` 与规范正文投影；总候选 1000（其中 DOCX 200）、单文件 200、总匹配 2000 上限，总并发 4（其中 DOCX 并发 2），协作式取消与单文件错误隔离；搜索只读，不写工作区、不建立索引或缓存；
- DOCX 规范正文投影（`src/shared/docx-search-text.ts`）：按文档顺序深度优先收集文本块、相邻块间恰一个人工 `\n` 的纯函数投影，UTF-16 偏移与 ProseMirror 文本位置一致，主进程搜索与 renderer 定位双重校验共用同一规则；
- 多标签纯状态模型与不变量校验（标签唯一性、活动标签引用、保存在途一致性、异步结果三重有效性）；TXT/DOCX 判别联合标签状态；
- 搜索与定位异步协议：requestId + 工作区 epoch + 相对路径 + kind + revision + locateId 绑定，App 实时投影校验与 DOCX 宿主同规则投影二次校验，迟到结果/迟到回报安全忽略，过期定位只提示；
- ESLint、Prettier、Vitest 与严格 TypeScript 检查；
- React Testing Library 组件行为测试；
- 项目本地的便携 Node.js/npm 开发工具链。

### 尚未实现

- 标签页拖拽排序、固定、批量关闭与状态恢复；
- TXT 自动保存、另存为、新建和文件管理（重命名、移动、删除）；
- DOCX 新建、另存为、重命名、移动、删除；
- 工作区替换、批量替换、正则/模糊/语义搜索与持久全文索引；
- 复杂 Word 格式（图片/表格/页眉页脚/批注/修订编辑、精确分页、宏）与完整无损往返；
- 文件系统监听和自动刷新；
- Windows 安装包与正式发布流程。

## 快速开始

### 环境要求

- Windows 10 或 Windows 11
- Windows PowerShell 5.1 或更高版本
- 首次初始化时能够访问 Node.js 和 npm 下载服务

项目不要求预先全局安装 Node.js。首次克隆后，在仓库根目录运行：

```powershell
.\scripts\bootstrap.cmd
.\scripts\npm.cmd ci
```

随后启动开发环境：

```powershell
.\scripts\dev.cmd
```

本地 Node.js 安装在被 Git 忽略的 `.tools/` 中，不会修改系统 PATH 或 PowerShell 执行策略。网络受限环境的镜像配置和故障处理参见[开发环境说明](./docs/DEVELOPMENT_ENVIRONMENT.md)。

## 使用与验证

开发窗口启动成功后，左侧栏显示"尚未打开文件夹"的空状态。点击"打开文件夹"按钮，通过原生目录选择器选择一个本地文件夹，即可在左侧栏看到工作区名称、路径和可展开的文件树。点击目录名称可展开/折叠子目录，点击"刷新"按钮可重新扫描当前工作区。

在工作区文件树中点击（或用键盘激活）任意 `.txt` 文件，中央区域会先显示加载状态，随后显示以文件名命名的标签页与可编辑正文；连续选择多个 TXT 会生成多个标签，重复选择已打开文件只激活原标签。标签可点击切换，切换保留各自的光标、选区、滚动位置与撤销历史；点击标签上的"×"或按 `Ctrl+W` 关闭标签。编辑后标签显示未保存标记（●），点击"保存"或按 `Ctrl+S` 显式保存当前活动标签；未修改时保存不触发写入。文件缺失、超过 5 MiB 或非 UTF-8 编码时会显示错误提示，且不影响其他标签。文件被其他程序修改后保存会显示外部冲突，本地内容保留，确认后才重新读取磁盘版本；BOM 与一致 LF/CRLF 换行风格保存后保留，混合换行保存前需确认规范化。关闭未保存标签前会得到"放弃修改/取消"确认；有未保存标签时切换工作区或关闭窗口会显示包含未保存标签数量的聚合确认，取消后一切保持不变；正在保存的标签不会被这些操作丢弃，会提示等待保存完成。切换工作区成功后回到未选择文档状态，取消切换或刷新工作区会保留当前标签。关闭窗口或在终端按 `Ctrl+C` 可以结束开发进程。

在活动 TXT 标签中按 `Ctrl+F` 可打开查找面板，输入查询后可用 `F3`/`Shift+F3`（或面板按钮）在匹配之间前后跳转，勾选"区分大小写"可精确匹配；按 `Ctrl+H` 打开面板并聚焦替换输入，可替换当前项或全部替换，替换通过撤销历史恢复并正常进入未保存状态。点击活动栏"搜索"或按 `Ctrl+Shift+F` 打开工作区搜索侧栏：在输入框输入查询并按 Enter（或点击"搜索"）即可一次查询同时搜索当前工作区磁盘上已保存的普通 UTF-8 TXT 与基础 DOCX 规范正文，结果按文件分组显示相对路径、TXT/DOCX 类型标识、行列与片段，并提供扫描/命中/匹配/跳过统计与截断提示；搜索中可点击"取消"中止，输入新查询并提交会取消旧搜索。点击任意 TXT 或 DOCX 匹配结果会打开或激活对应唯一标签：TXT 在结果仍有效时选中匹配、滚动到可视区域并聚焦；DOCX 经 kind、revision、规范投影范围与匹配文本双重校验后用 ProseMirror 公开 API 定位（read-only 可定位不可编辑，degraded 定位不自动确认兼容性）；若文件已被外部修改或正文/结构已变化，则只显示"搜索结果已过期"提示，不会错误定位或修改正文。切换文件/搜索活动栏不会丢失工作区、标签或文件树展开状态。

点击文件树中的普通 `.docx`，中央区域先显示加载状态，随后以唯一标签打开 Tiptap/ProseMirror 富文本编辑器；Windows/WPS 创建但尚未物化的 0 字节 `.docx` 会作为空白文档打开，首次保存后成为有效 OOXML。使用标签上方的格式工具栏或 `Ctrl+S` 完成基础格式编辑与保存。含图片、表格、页眉页脚、批注或修订等不受支持内容的文档会显示兼容性警告：`degraded` 文档需先点击"确认继续编辑并保存"（确认绑定打开时的 revision）才能编辑与保存；只有 `w:documentProtection` 明确启用的文档才按编辑保护进入 `read-only`，WPS 的 `w:enforcement="0"` 不触发只读。保存前会自动生成同目录滚动备份 `<文件名>.wenshu.bak`，保存成功后状态栏显示备份文件名；保存失败、产物验证失败或备份失败时原文件不被修改。用其他程序（如 Microsoft Word 或 WPS Office）修改已打开的 DOCX 后保存会显示外部冲突，本地编辑保留，确认后才重新读取磁盘版本。损坏、加密、伪装、超过 20 MiB 或超出资源预算的 DOCX 会显示稳定错误。

运行全部自动检查：

```powershell
.\scripts\npm.cmd run check
```

验证生产构建：

```powershell
.\scripts\npm.cmd run build
```

完整的自动检查、手动界面验收和生产构建验证步骤见[测试指南](./docs/TESTING.md)。

## 常用命令

| 操作         | 命令                                 |
| ------------ | ------------------------------------ |
| 启动开发环境 | `.\scripts\dev.cmd`                  |
| 完整质量检查 | `.\scripts\npm.cmd run check`        |
| 类型检查     | `.\scripts\npm.cmd run typecheck`    |
| 代码检查     | `.\scripts\npm.cmd run lint`         |
| 格式检查     | `.\scripts\npm.cmd run format:check` |
| 单元测试     | `.\scripts\npm.cmd test`             |
| 生产构建     | `.\scripts\npm.cmd run build`        |

生产构建产物写入 `out/`。当前阶段不生成 Windows 安装包。

## Roadmap

- [x] Task 1：建立可运行、可测试的桌面应用工程骨架；
- [x] [Task 2：工作区目录选择与只读文件树](./docs/TASK_002_WORKSPACE_READONLY.md)；
- [x] [Task 3：UTF-8 TXT 受控读取与单只读标签页](./docs/TASK_003_TXT_READONLY.md)；
- [x] [Task 4：单 TXT 基础编辑与安全保存](./docs/TASK_004_TXT_EDIT_SAFE_SAVE.md)；
- [x] [Task 5：多 TXT 标签页与独立编辑会话](./docs/TASK_005_MULTI_TXT_TABS.md)；
- [x] [Task 6：工作区 TXT 搜索与当前文件查找替换](./docs/TASK_006_TXT_SEARCH_FIND_REPLACE.md)；
- [x] [Task 7：基础 DOCX 阅读、编辑与安全保存](./docs/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md)（已完成，见 [TASK-007 完成报告](./docs/TASK_007_COMPLETION_REPORT.md)）。
- [x] [Task 8：工作区 DOCX 正文搜索与富文本结果定位](./docs/TASK_008_DOCX_WORKSPACE_SEARCH.md)（已完成，见 [TASK-008 完成报告](./docs/TASK_008_COMPLETION_REPORT.md)）。
- [ ] [Task 9：基础文件管理闭环](./docs/TASK_009_BASIC_FILE_MANAGEMENT.md)（已完成规划，待从 WP0 开始实施）。

具体范围与技术约束以任务文档和[项目技术基线](./docs/PROJECT_BASELINE.md)为准。

## 文档

- [项目定义与技术基线](./docs/PROJECT_BASELINE.md)
- [开发环境说明](./docs/DEVELOPMENT_ENVIRONMENT.md)
- [测试指南](./docs/TESTING.md)
- [TASK-001：桌面应用工程骨架](./docs/TASK_001_PROJECT_BOOTSTRAP.md)
- [TASK-001 完成报告](./docs/TASK_001_COMPLETION_REPORT.md)
- [TASK-002：工作区目录选择与只读文件树](./docs/TASK_002_WORKSPACE_READONLY.md)
- [TASK-002 完成报告](./docs/TASK_002_COMPLETION_REPORT.md)
- [TASK-003：UTF-8 TXT 受控读取与单只读标签页](./docs/TASK_003_TXT_READONLY.md)
- [TASK-003 完成报告](./docs/TASK_003_COMPLETION_REPORT.md)
- [TASK-004：单 TXT 基础编辑与安全保存](./docs/TASK_004_TXT_EDIT_SAFE_SAVE.md)
- [TASK-004 完成报告](./docs/TASK_004_COMPLETION_REPORT.md)
- [TASK-005：多 TXT 标签页与独立编辑会话](./docs/TASK_005_MULTI_TXT_TABS.md)
- [TASK-005 完成报告](./docs/TASK_005_COMPLETION_REPORT.md)
- [TASK-006：工作区 TXT 搜索与当前文件查找替换](./docs/TASK_006_TXT_SEARCH_FIND_REPLACE.md)
- [TASK-006 完成报告](./docs/TASK_006_COMPLETION_REPORT.md)
- [TASK-007：基础 DOCX 阅读、编辑与安全保存](./docs/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md)
- [TASK-007 完成报告](./docs/TASK_007_COMPLETION_REPORT.md)
- [TASK-008：工作区 DOCX 正文搜索与富文本结果定位](./docs/TASK_008_DOCX_WORKSPACE_SEARCH.md)
- [TASK-008 完成报告](./docs/TASK_008_COMPLETION_REPORT.md)
- [TASK-009：基础文件管理闭环](./docs/TASK_009_BASIC_FILE_MANAGEMENT.md)

## 项目结构

```text
.
├─ docs/                  项目基线、任务记录和开发说明
├─ scripts/               本地工具链及开发命令包装器
├─ src/
│  ├─ main/
│  │  ├─ index.ts         Electron 生命周期、窗口创建与安全策略
│  │  ├─ workspace/       工作区扫描器、会话状态与 IPC 处理器
│  │  ├─ document/        TXT 读取器、安全保存器、路径/写入安全 helper 与受控文档 IPC
│  │  ├─ docx/            DOCX 读取/导入/导出/安全保存器、ZIP 检查与固定 DOCX IPC
│  │  ├─ search/          工作区 TXT/DOCX 混合搜索器、固定搜索 IPC 与纯匹配器
│  │  └─ window/          窗口关闭协调（未保存保护）
│  ├─ preload/            受控桌面 API 桥接
│  ├─ renderer/
│  │  ├─ components/      React UI 组件（侧栏、文件树、标签栏、搜索侧栏、文档区、DOCX 工具栏/兼容性提示、确认对话框）
│  │  ├─ lib/             纯状态模型与多文档/工作区/搜索 controller（含标签不变量与竞态处理）
│  │  └─ styles/          界面样式
│  └─ shared/             跨进程共享的纯类型契约（含 DOCX 结构化中间模型、规范正文投影与纯转换）
├─ tests/                  单元测试与组件行为测试
└─ README.md               项目入口与快速使用说明
```

## 技术栈

- Electron
- React
- TypeScript
- CodeMirror 6（TXT 编辑器）
- Tiptap / ProseMirror（DOCX 富文本编辑器）
- Mammoth / JSZip / docx（DOCX 导入、ZIP 检查与基础导出）
- Vite / electron-vite
- Vitest + React Testing Library
- ESLint / Prettier

## 开发原则

- 本地文件与用户数据安全优先；
- 渲染进程不直接拥有 Node.js 或文件系统权限，桌面能力通过受控接口逐项提供；
- 先保证简单、稳定和可运行，再扩展文件类型、编辑能力与 AI 功能。

完整设计原则见[项目技术基线](./docs/PROJECT_BASELINE.md)。当前项目处于个人开发阶段，暂未建立外部贡献、用户支持或正式发布流程。
