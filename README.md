# 文枢（WenShu）

文枢是一款面向个人创作、设定整理和资料维护的本地多文档桌面工作台。它以普通文件夹作为工作区，采用类似代码编辑器的文件树、多标签页和中央编辑区域，目标是让一组相关文档能够被集中管理、搜索与编辑。

## 项目状态

项目目前处于工程基座阶段，已经具备：

- Electron、React、TypeScript 与 Vite 开发和生产构建链路；
- 相互隔离的主进程、preload 和渲染进程类型环境；
- 通过 `contextBridge` 提供的最小只读桌面 API；
- ESLint、Prettier、Vitest 与严格 TypeScript 检查；
- 项目本地的便携 Node.js/npm 开发工具链；
- 可运行的“文枢”桌面工作台占位界面。

工作区选择、文件树、TXT/DOCX 编辑和多标签页等产品功能尚未实现。

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

## 技术栈

- Electron
- React
- TypeScript
- Vite / electron-vite
- Vitest
- ESLint / Prettier

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

## 文档

- [项目定义与技术基线](./docs/PROJECT_BASELINE.md)
- [开发环境说明](./docs/DEVELOPMENT_ENVIRONMENT.md)
- [TASK-001：桌面应用工程骨架](./docs/TASK_001_PROJECT_BOOTSTRAP.md)
- [TASK-001 完成报告](./docs/TASK_001_COMPLETION_REPORT.md)

## 核心原则

- 本地文件优先，基础功能无需联网；
- 中央文档编辑区域优先；
- 渲染进程不直接拥有 Node.js 或文件系统权限；
- 文件能力通过受控 preload/IPC 接口逐项提供；
- 先保证简单、稳定和可运行，再逐步扩展文件类型与 AI 能力。
