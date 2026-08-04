# 文枢（WenShu）

文枢是一款面向个人创作、设定整理和资料维护的本地多文档桌面工作台。它以普通文件夹作为工作区，采用类似代码编辑器的文件树、多标签页和中央编辑区域，目标是让一组相关文档能够被集中管理、搜索与编辑。

> **当前阶段：Pre-alpha / 工作区 + TXT 只读阅读。** Task 1、Task 2、Task 3 已完成；Task 4“单 TXT 基础编辑与安全保存”已完成规划但尚未实施。当前应用具备工作区选择、只读文件树浏览，以及从文件树选择 UTF-8 TXT 后在中央区域以单个只读标签页阅读的能力。TXT 编辑、保存、多标签页和 DOCX 尚未实现。

## 当前能力

### 可以体验

- 启动 Windows Electron 桌面窗口；
- 点击左侧"打开文件夹"按钮，通过原生对话框选择本地工作区；
- 浏览工作区目录树，展开/折叠多层文件夹；
- 手动刷新工作区以反映外部文件变化；
- 切换工作区或取消选择而不丢失当前状态；
- 查看子目录错误提示而不影响其他节点显示；
- 点击（或通过键盘激活）文件树中的 `.txt` 文件，在中央区域以单个只读标签页阅读其 UTF-8 正文；
- 读取期间显示加载状态；读取失败、文件过大或编码非法时显示可恢复的错误提示；
- 读取新 TXT 会替换当前单标签内容；切换工作区后自动回到未选择文档状态；
- 通过受控 preload API 在状态栏读取平台和 Electron 版本信息。

### 工程能力

- Electron、React、TypeScript 与 Vite 开发和生产构建链路；
- 相互隔离的主进程、preload 和渲染进程类型环境；
- `nodeIntegration: false`、`contextIsolation: true` 和 sandbox 安全基线；
- 受控 IPC 通道：`workspace.open()` / `workspace.refresh()` 与 `document.readText()`；
- 主进程对 TXT 读取执行完整校验：相对路径格式、工作区边界、逐段符号链接 / junction、真实路径、普通文件类型、5 MiB 大小上限与严格 UTF-8；
- ESLint、Prettier、Vitest 与严格 TypeScript 检查；
- React Testing Library 组件行为测试；
- 项目本地的便携 Node.js/npm 开发工具链。

### 尚未实现

- [Task 4](./docs/TASK_004_TXT_EDIT_SAFE_SAVE.md) 已规划的 TXT 基础编辑、显式保存、外部冲突检测和安全写入；
- TXT 自动保存；
- DOCX 文件读取与编辑；
- 多标签页、搜索、保存和状态恢复；
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

在工作区文件树中点击（或用键盘激活）任意 `.txt` 文件，中央区域会先显示加载状态，随后显示以文件名命名的单个只读标签页和正文；正文支持原生选择与复制，不可编辑。再次选择其他 TXT 会替换当前内容。文件缺失、超过 5 MiB 或非 UTF-8 编码时会显示错误提示；若已有成功打开的文档，错误以横幅提示且原正文保留。切换工作区后回到未选择文档状态，取消切换或刷新工作区会保留当前文档。关闭窗口或在终端按 `Ctrl+C` 可以结束开发进程。

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
- [ ] [Task 4：单 TXT 基础编辑与安全保存](./docs/TASK_004_TXT_EDIT_SAFE_SAVE.md)；
- [ ] 多标签页与工作区搜索；
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

## 项目结构

```text
.
├─ docs/                  项目基线、任务记录和开发说明
├─ scripts/               本地工具链及开发命令包装器
├─ src/
│  ├─ main/
│  │  ├─ index.ts         Electron 生命周期、窗口创建与安全策略
│  │  ├─ workspace/       工作区扫描器、会话状态与 IPC 处理器
│  │  └─ document/        TXT 读取器与受控读取 IPC
│  ├─ preload/            受控桌面 API 桥接
│  ├─ renderer/
│  │  ├─ components/      React UI 组件（工作区侧栏、文件树、中央文档区）
│  │  ├─ lib/             纯逻辑工具（含单文档状态与竞态处理）
│  │  └─ styles/          界面样式
│  └─ shared/             跨进程共享的纯类型契约
├─ tests/                  单元测试与组件行为测试
└─ README.md               项目入口与快速使用说明
```

## 技术栈

- Electron
- React
- TypeScript
- Vite / electron-vite
- Vitest + React Testing Library
- ESLint / Prettier

## 开发原则

- 本地文件与用户数据安全优先；
- 渲染进程不直接拥有 Node.js 或文件系统权限，桌面能力通过受控接口逐项提供；
- 先保证简单、稳定和可运行，再扩展文件类型、编辑能力与 AI 功能。

完整设计原则见[项目技术基线](./docs/PROJECT_BASELINE.md)。当前项目处于个人开发阶段，暂未建立外部贡献、用户支持或正式发布流程。
