# 文枢（WenShu）

文枢是一款面向个人多文档创作与资料管理的 Windows 桌面应用。本仓库当前完成了 Electron、React、TypeScript 和 Vite 的最小工程骨架，用于承载后续工作区、文件树与文档编辑功能。

## 当前范围

Task 1 只提供可运行、可构建、可测试的应用外壳：

- Electron 主进程负责窗口与生命周期；
- preload 通过 `contextBridge` 暴露只读、窄范围的运行环境信息；
- React 渲染进程提供“文枢”占位工作台；
- 渲染进程不具备 Node.js 或文件系统访问能力；
- 暂不包含工作区、文件树、TXT/DOCX 编辑等产品功能。

## 环境要求

- Windows 10 或 Windows 11
- Windows PowerShell 5.1 或更高版本
- 首次初始化时能够访问 Node.js 和 npm 的下载服务

项目提供本地便携工具链，不要求预先全局安装 Node.js。Node.js 22.15.0 和随附的 npm 10.9.2 会安装到被 Git 忽略的 `.tools/`，项目命令始终优先使用该版本。

## 首次初始化

```powershell
.\scripts\bootstrap.cmd
.\scripts\npm.cmd ci
```

第一条命令从 Node.js 官方版本目录下载 Windows 便携包、校验 SHA-256 后解压到项目内；第二条命令严格按照 `package-lock.json` 安装项目依赖。

## 开发

```powershell
.\scripts\dev.cmd
```

该命令启动 Vite 开发服务器和 Electron 窗口，并支持渲染进程热更新。

## 质量检查

```powershell
.\scripts\npm.cmd run typecheck
.\scripts\npm.cmd run lint
.\scripts\npm.cmd run format:check
.\scripts\npm.cmd test
```

也可以运行全部检查：

```powershell
.\scripts\npm.cmd run check
```

## 生产构建

```powershell
.\scripts\npm.cmd run build
```

构建产物写入 `out/`。Task 1 不生成 Windows 安装包；安装包与自动更新不在本阶段范围内。

## 目录结构

```text
src/
├─ main/       Electron 生命周期、窗口和安全策略
├─ preload/    受控桌面 API 的唯一渲染进程入口
├─ renderer/   React 界面与样式
└─ shared/     跨进程共享的纯类型契约
tests/         可独立运行的基础测试
scripts/       本地 Node.js 引导及命令包装器
.tools/        本机便携工具链（自动生成，不提交 Git）
```

工具链原理、更新方式和故障处理见 [`DEVELOPMENT_ENVIRONMENT.md`](./DEVELOPMENT_ENVIRONMENT.md)。工程决策、验证结果和已知限制见 [`TASK_001_COMPLETION_REPORT.md`](./TASK_001_COMPLETION_REPORT.md)。产品与技术基线见 [`PROJECT_BASELINE.md`](./PROJECT_BASELINE.md)。
