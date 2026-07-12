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
- Node.js 22.12 或更高版本
- npm 10 或更高版本

本项目开发时使用 Node.js 22.15.0。若 PowerShell 因执行策略禁止运行 `npm.ps1`，可将下列命令中的 `npm` 替换为 `npm.cmd`。

## 安装

```powershell
npm install
```

## 开发

```powershell
npm run dev
```

该命令启动 Vite 开发服务器和 Electron 窗口，并支持渲染进程热更新。

## 质量检查

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
```

也可以运行全部检查：

```powershell
npm run check
```

## 生产构建

```powershell
npm run build
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
```

工程决策、验证结果和已知限制见 [`TASK_001_COMPLETION_REPORT.md`](./TASK_001_COMPLETION_REPORT.md)。产品与技术基线见 [`PROJECT_BASELINE.md`](./PROJECT_BASELINE.md)。
