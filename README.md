# 文枢（WenShu）

文枢是一款面向个人创作、设定整理和资料维护的本地多文档桌面工作台。它以普通文件夹作为工作区，采用类似代码编辑器的文件树、多标签页和中央编辑区域，目标是让一组相关文档能够被集中管理、搜索与编辑。

> **当前阶段：Pre-alpha / 工程基座。** 应用可以启动、检查和构建，但尚未实现真实工作区、文件浏览或文档编辑功能。

## 当前能力

### 可以体验

- 启动 Windows Electron 桌面窗口；
- 查看“文枢”基础工作台及侧栏、中央区域和状态栏布局；
- 通过受控 preload API 在状态栏读取平台和 Electron 版本信息。

### 工程能力

- Electron、React、TypeScript 与 Vite 开发和生产构建链路；
- 相互隔离的主进程、preload 和渲染进程类型环境；
- `nodeIntegration: false`、`contextIsolation: true` 和 sandbox 安全基线；
- ESLint、Prettier、Vitest 与严格 TypeScript 检查；
- 项目本地的便携 Node.js/npm 开发工具链。

### 尚未实现

- 工作区选择和文件树；
- TXT、DOCX 文件读取与编辑；
- 多标签页、搜索、保存和状态恢复；
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

开发窗口启动成功后，应能看到“文枢”欢迎工作台、左侧占位栏、中央欢迎区域和底部状态栏；状态栏应显示 Windows 与当前 Electron 版本。关闭窗口或在终端按 `Ctrl+C` 可以结束开发进程。

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
- [ ] [Task 2：工作区目录选择与只读文件树](./docs/TASK_002_WORKSPACE_READONLY.md)；
- [ ] TXT 文件读取、编辑和保存；
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

## 项目结构

```text
.
├─ docs/        项目基线、任务记录和开发说明
├─ scripts/     本地工具链及开发命令包装器
├─ src/
│  ├─ main/     Electron 生命周期、窗口与安全策略
│  ├─ preload/  受控桌面 API 桥接
│  ├─ renderer/ React 界面与样式
│  └─ shared/   跨进程共享的纯类型契约
├─ tests/       基础单元测试
└─ README.md    项目入口与快速使用说明
```

## 技术栈

- Electron
- React
- TypeScript
- Vite / electron-vite
- Vitest
- ESLint / Prettier

## 开发原则

- 本地文件与用户数据安全优先；
- 渲染进程不直接拥有 Node.js 或文件系统权限，桌面能力通过受控接口逐项提供；
- 先保证简单、稳定和可运行，再扩展文件类型、编辑能力与 AI 功能。

完整设计原则见[项目技术基线](./docs/PROJECT_BASELINE.md)。当前项目处于个人开发阶段，暂未建立外部贡献、用户支持或正式发布流程。
