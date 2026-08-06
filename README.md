# 文枢（WenShu）

文枢是一款面向个人创作、设定整理和资料维护的本地多文档桌面工作台。它以普通文件夹作为工作区，采用类似代码编辑器的文件树、多标签页和中央编辑区域，目标是让一组相关文档能够被集中管理、搜索与编辑。

> **当前阶段：Pre-alpha / 单 TXT 编辑与安全保存。** Task 1、Task 2、Task 3、Task 4 已完成；[Task 5 多 TXT 标签页](./docs/TASK_005_MULTI_TXT_TABS.md)已完成规划、尚未实施。当前应用具备工作区选择、只读文件树浏览，从文件树选择 UTF-8 TXT 后在中央区域以单个标签页编辑，并通过保存按钮或 `Ctrl+S` 显式保存；保存执行工作区边界、符号链接、真实路径与内容版本校验，采用同目录临时文件、刷盘、关闭和安全替换流程。外部修改会触发冲突提示；打开其他文件、切换工作区和关闭窗口均有未保存保护。多标签页、自动保存和 DOCX 尚未实现。

## 当前能力

### 可以体验

- 启动 Windows Electron 桌面窗口；
- 点击左侧"打开文件夹"按钮，通过原生对话框选择本地工作区；
- 浏览工作区目录树，展开/折叠多层文件夹；
- 手动刷新工作区以反映外部文件变化；
- 切换工作区或取消选择而不丢失当前状态；
- 查看子目录错误提示而不影响其他节点显示；
- 点击（或通过键盘激活）文件树中的 `.txt` 文件，在中央区域以单个标签页打开并编辑其 UTF-8 正文；
- 输入、删除、复制、粘贴、撤销和重做；空文件可正常输入；
- 通过保存按钮或 `Ctrl+S` 显式保存；标签显示未保存标记（●），工具条显示已保存/未保存/正在保存/保存失败/外部冲突；
- 保存期间继续编辑不会丢失后续修改；保存失败保留全部编辑内容；
- 文件被其他程序修改后保存会显示外部冲突，本地内容保留，确认后才重新读取磁盘版本；
- BOM 与一致 LF/CRLF 换行风格在保存后保留；混合换行保存前需要明确确认规范化；
- 有未保存修改时打开其他 TXT、切换工作区或关闭窗口都会得到"放弃修改/取消"确认；
- 读取期间显示加载状态；读取失败、文件过大或编码非法时显示可恢复的错误提示；
- 通过受控 preload API 在状态栏读取平台和 Electron 版本信息。

### 工程能力

- Electron、React、TypeScript 与 Vite 开发和生产构建链路；
- 相互隔离的主进程、preload 和渲染进程类型环境；
- `nodeIntegration: false`、`contextIsolation: true` 和 sandbox 安全基线；
- 受控 IPC 通道：`workspace.open()` / `workspace.refresh()`、`document.readText()` / `document.saveText()` 与窗口关闭协调窄协议；
- 主进程对 TXT 读取与保存执行完整校验：相对路径格式、工作区边界、逐段符号链接 / junction、真实路径、普通文件类型、5 MiB 大小上限与严格 UTF-8；
- 保存执行内容版本（SHA-256）冲突检测，采用同目录排他临时文件、完整写入、刷盘、关闭与 `rename` 安全替换；
- CodeMirror 6 纯文本编辑器（仅编辑、撤销重做与保存快捷键，无语法高亮）；
- ESLint、Prettier、Vitest 与严格 TypeScript 检查；
- React Testing Library 组件行为测试；
- 项目本地的便携 Node.js/npm 开发工具链。

### 尚未实现

- 多标签页、标签关闭、排序和状态恢复；
- TXT 自动保存、另存为、新建和文件管理（重命名、移动、删除）；
- DOCX 文件读取与编辑；
- 工作区搜索与当前文件查找替换；
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

在工作区文件树中点击（或用键盘激活）任意 `.txt` 文件，中央区域会先显示加载状态，随后显示以文件名命名的单个标签页与可编辑正文。编辑后标签显示未保存标记（●），点击"保存"或按 `Ctrl+S` 显式保存；未修改时保存不触发写入。文件缺失、超过 5 MiB 或非 UTF-8 编码时会显示错误提示；若已有成功打开的文档，错误以横幅提示且原正文保留。文件被其他程序修改后保存会显示外部冲突，本地内容保留，确认后才重新读取磁盘版本；BOM 与一致 LF/CRLF 换行风格保存后保留，混合换行保存前需确认规范化。有未保存修改时打开其他 TXT、切换工作区或关闭窗口都会先得到"放弃修改/取消"确认，取消后一切保持不变。切换工作区成功后回到未选择文档状态，取消切换或刷新工作区会保留当前文档。关闭窗口或在终端按 `Ctrl+C` 可以结束开发进程。

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
- [ ] [Task 5：多 TXT 标签页与独立编辑会话](./docs/TASK_005_MULTI_TXT_TABS.md)；
- [ ] 工作区 TXT 搜索与当前文件查找替换；
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
│  │  └─ window/          窗口关闭协调（未保存保护）
│  ├─ preload/            受控桌面 API 桥接
│  ├─ renderer/
│  │  ├─ components/      React UI 组件（侧栏、文件树、文档区、确认对话框）
│  │  ├─ lib/             纯逻辑工具（含单文档编辑/保存状态与竞态处理）
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
