# 文枢（WenShu）

文枢是一款面向个人创作、设定整理和资料维护的本地多文档桌面工作台。它以普通文件夹作为工作区，采用类似代码编辑器的文件树、多标签页和中央编辑区域，目标是让一组相关文档能够被集中管理、搜索与编辑。

> **当前阶段：Pre-alpha / Task 6 已完成。** Task 1 至 Task 6 均已完成；下一任务为[基础 DOCX 阅读、编辑与安全保存](./docs/PROJECT_BASELINE.md#55-docx-支持)。当前应用具备工作区选择、只读文件树浏览，从文件树选择 UTF-8 TXT 后在中央区域以多标签页编辑，每个标签独立维护读取、正文、未保存状态与保存状态，通过保存按钮或 `Ctrl+S` 显式保存；保存执行工作区边界、符号链接、真实路径与内容版本校验，采用同目录临时文件、刷盘、关闭和安全替换流程。外部修改会触发冲突提示；关闭 dirty 标签、切换工作区和关闭窗口均有未保存保护，正在保存的标签不会被丢弃。Task 6 已加入当前文件查找替换（`Ctrl+F`/`Ctrl+H`）与工作区 TXT 搜索（活动栏搜索 / `Ctrl+Shift+F`），搜索结果可打开或激活唯一标签并在 revision 与正文范围仍有效时安全定位。自动保存、DOCX、文件管理与会话恢复仍不可用。

## 当前能力

### 可以体验

- 启动 Windows Electron 桌面窗口；
- 点击左侧"打开文件夹"按钮，通过原生对话框选择本地工作区；
- 浏览工作区目录树，展开/折叠多层文件夹；
- 手动刷新工作区以反映外部文件变化；
- 切换工作区或取消选择而不丢失当前状态；
- 查看子目录错误提示而不影响其他节点显示；
- 点击（或通过键盘激活）文件树中的 `.txt` 文件，在中央区域以标签页打开并编辑其 UTF-8 正文；连续选择多个 TXT 会依次生成多个标签，重复选择已打开文件只激活原标签；
- 点击标签在多个文档之间切换，切换保留各标签的光标、选区、滚动位置与撤销/重做历史；同名不同路径的文件可同时打开，标签可显示完整相对路径提示；
- 输入、删除、复制、粘贴、撤销和重做；空文件可正常输入；
- 通过保存按钮或 `Ctrl+S` 显式保存当前活动标签；标签显示未保存标记（●），工具条显示已保存/未保存/正在保存/保存失败/外部冲突；
- 不同标签可以并行保存；同一标签不会产生并发保存；保存期间继续编辑不会丢失后续修改；保存失败保留全部编辑内容；
- 文件被其他程序修改后保存会显示外部冲突，本地内容保留，确认后才重新读取磁盘版本；
- BOM 与一致 LF/CRLF 换行风格在保存后保留；混合换行保存前需要明确确认规范化；
- 关闭未保存标签前会得到"放弃修改/取消"确认，`Ctrl+W` 与关闭按钮走同一流程；有未保存修改时切换工作区或关闭窗口会显示包含未保存标签数量的聚合确认；
- 正在保存的标签不会被关闭标签、切换工作区或关闭窗口等操作丢弃，会提示等待保存完成；
- 读取期间显示加载状态；读取失败、文件过大或编码非法时显示可恢复的错误提示，且不影响其他标签；
- 通过受控 preload API 在状态栏读取平台和 Electron 版本信息；
- 在活动 TXT 标签中按 `Ctrl+F` 打开查找面板、`Ctrl+H` 打开替换面板：普通文字查询、大小写选项、上一个/下一个、替换当前项与全部替换；替换进入撤销历史并正常产生 dirty 与显式保存；查找不修改正文、不制造 dirty；查找面板、查询、选区与历史按标签隔离；
- 点击活动栏"搜索"或按 `Ctrl+Shift+F` 打开工作区搜索侧栏：对当前工作区磁盘上已保存的普通 UTF-8 TXT 执行文字搜索（大小写可切换、可取消、可连续提交新查询），展示按文件分组的结果（相对路径、1-based 行列、安全片段）与扫描/命中/匹配/跳过统计和截断提示；无工作区时显示空状态且不发起搜索；
- 点击搜索结果打开或激活唯一标签，读取完成后在结果仍有效时选中匹配、滚动到可视区域并聚焦编辑器；revision、范围或正文已变化时只显示"搜索结果已过期"提示，不错误定位、不修改正文；
- 切换文件/搜索活动栏不丢失工作区、已打开标签或文件树展开状态；工作区成功切换清空旧搜索结果。

### 工程能力

- Electron、React、TypeScript 与 Vite 开发和生产构建链路；
- 相互隔离的主进程、preload 和渲染进程类型环境；
- `nodeIntegration: false`、`contextIsolation: true` 和 sandbox 安全基线；
- 受控 IPC 通道：`workspace.open()` / `workspace.refresh()`、`document.readText()` / `document.saveText()`、`search.textWorkspace()` / `search.cancelTextWorkspace()` 与窗口关闭协调窄协议；
- 主进程对 TXT 读取与保存执行完整校验：相对路径格式、工作区边界、逐段符号链接 / junction、真实路径、普通文件类型、5 MiB 大小上限与严格 UTF-8；
- 保存执行内容版本（SHA-256）冲突检测，采用同目录排他临时文件、完整写入、刷盘、关闭与 `rename` 安全替换；
- 主进程工作区 TXT 搜索：根路径只来自主进程工作区会话，不跟随符号链接，候选读取复用受控 TXT 校验，固定并发 4，候选 1000 / 单文件 200 / 总匹配 2000 上限，协作式取消与单文件错误隔离；搜索不写工作区、不建立索引；
- CodeMirror 6 纯文本编辑器（编辑、撤销重做、保存快捷键与当前文件查找替换），按标签隔离会话缓存；
- 多标签纯状态模型与不变量校验（标签唯一性、活动标签引用、保存在途一致性、异步结果三重有效性）；
- 搜索与定位异步协议：requestId + 工作区 epoch + 相对路径 + revision 绑定，迟到结果安全忽略，过期定位只提示；
- ESLint、Prettier、Vitest 与严格 TypeScript 检查；
- React Testing Library 组件行为测试；
- 项目本地的便携 Node.js/npm 开发工具链。

### 尚未实现

- 标签页拖拽排序、固定、批量关闭与状态恢复；
- TXT 自动保存、另存为、新建和文件管理（重命名、移动、删除）；
- DOCX 文件读取与编辑；
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

在活动 TXT 标签中按 `Ctrl+F` 可打开查找面板，输入查询后可用 `F3`/`Shift+F3`（或面板按钮）在匹配之间前后跳转，勾选"区分大小写"可精确匹配；按 `Ctrl+H` 打开面板并聚焦替换输入，可替换当前项或全部替换，替换通过撤销历史恢复并正常进入未保存状态。点击活动栏"搜索"或按 `Ctrl+Shift+F` 打开工作区搜索侧栏：在输入框输入查询并按 Enter（或点击"搜索"）即可搜索当前工作区磁盘上已保存的普通 UTF-8 TXT，结果按文件分组显示相对路径、行列与片段，并提供扫描/命中/匹配/跳过统计与截断提示；搜索中可点击"取消"中止，输入新查询并提交会取消旧搜索。点击任意匹配结果会打开或激活对应唯一标签并在结果仍有效时选中匹配、滚动到可视区域；若文件已被外部修改或正文已变化，则只显示"搜索结果已过期"提示，不会错误定位或修改正文。切换文件/搜索活动栏不会丢失工作区、标签或文件树展开状态。

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
- [ ] 基础 DOCX 阅读、编辑和安全保存。

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

## 项目结构

```text
.
├─ docs/                  项目基线、任务记录和开发说明
├─ scripts/               本地工具链及开发命令包装器
├─ src/
│  ├─ main/
│  │  ├─ index.ts         Electron 生命周期、窗口创建与安全策略
│  │  ├─ workspace/       工作区扫描器、会话状态与 IPC 处理器
│  │  ├─ document/        TXT 读取器、安全保存器与受控文档 IPC
│  │  ├─ search/          工作区 TXT 搜索器、固定搜索 IPC 与纯匹配器
│  │  └─ window/          窗口关闭协调（未保存保护）
│  ├─ preload/            受控桌面 API 桥接
│  ├─ renderer/
│  │  ├─ components/      React UI 组件（侧栏、文件树、标签栏、搜索侧栏、文档区、确认对话框）
│  │  ├─ lib/             纯状态模型与多文档/工作区/搜索 controller（含标签不变量与竞态处理）
│  │  └─ styles/          界面样式
│  └─ shared/             跨进程共享的纯类型契约
├─ tests/                  单元测试与组件行为测试
└─ README.md               项目入口与快速使用说明
```

## 技术栈

- Electron
- React
- TypeScript
- CodeMirror 6（TXT 编辑器）
- Vite / electron-vite
- Vitest + React Testing Library
- ESLint / Prettier

## 开发原则

- 本地文件与用户数据安全优先；
- 渲染进程不直接拥有 Node.js 或文件系统权限，桌面能力通过受控接口逐项提供；
- 先保证简单、稳定和可运行，再扩展文件类型、编辑能力与 AI 功能。

完整设计原则见[项目技术基线](./docs/PROJECT_BASELINE.md)。当前项目处于个人开发阶段，暂未建立外部贡献、用户支持或正式发布流程。
