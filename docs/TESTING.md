# 文枢测试指南

本文档说明如何验证当前已完成的工程基座与 Task 2 工作区能力。现阶段测试目标是确认应用能够安装、检查、构建、选择本地工作区并显示只读文件树；不包含文件正文读取、文档编辑或保存功能验收。Task 3 的计划验收范围见 [`TASK_003_TXT_READONLY.md`](./TASK_003_TXT_READONLY.md)，在其实现完成前不作为当前能力验收。

## 1. 前置条件

- Windows 10 或 Windows 11；
- Windows PowerShell 5.1 或更高版本；
- 命令在仓库根目录执行。

首次使用时初始化项目本地 Node.js 和依赖：

```powershell
.\scripts\bootstrap.cmd
.\scripts\npm.cmd ci
```

预期工具版本：

```powershell
.\scripts\node.cmd --version
.\scripts\npm.cmd --version
```

- Node.js：`v22.15.0`；
- npm：`10.9.2`。

下载失败时参见[开发环境说明](./DEVELOPMENT_ENVIRONMENT.md)中的镜像配置和故障处理。

## 2. 自动检查

运行完整质量检查：

```powershell
.\scripts\npm.cmd run check
```

该命令依次验证：

1. Electron 配置、主进程、preload、渲染进程和测试代码的 TypeScript 类型；
2. ESLint 静态检查；
3. Prettier 格式检查；
4. Vitest 单元测试。

验收标准：命令退出码为 `0`，没有 TypeScript、ESLint 或格式错误，全部测试通过。

需要单独定位问题时，可以分别运行：

```powershell
.\scripts\npm.cmd run typecheck
.\scripts\npm.cmd run lint
.\scripts\npm.cmd run format:check
.\scripts\npm.cmd test
```

## 3. 开发模式界面验收

启动应用：

```powershell
.\scripts\dev.cmd
```

手动确认：

- Electron 窗口能够出现且不是空白页；
- 标题和中央欢迎区域显示“文枢”；
- 顶部菜单占位、左侧活动栏、工作区侧栏、中央欢迎区域和底部状态栏均可见；
- 状态栏显示 `Windows · Electron <版本>`；
- 尚未打开工作区时显示“尚未打开文件夹”和“打开文件夹”入口；
- 点击“打开文件夹”会打开原生目录选择器；
- 取消选择不会报错或清除已经打开的工作区；
- 成功选择后显示工作区名称、路径和文件树；
- 多层目录可以展开和折叠，空目录具有明确状态；
- 点击“刷新”后可以看到外部增加或删除的文件；
- 再次选择文件夹可以切换工作区；
- 普通文件、符号链接和其他叶节点只显示名称与类型，不读取正文；
- 调整窗口大小后，中央区域仍然可见；
- 启动终端没有 preload、React 或资源加载错误；
- 关闭窗口后应用正常退出。

当前不应出现文件正文读取、文档编辑、保存、多标签页或通用 IPC 功能。

## 4. 生产构建验收

生成生产构建：

```powershell
.\scripts\npm.cmd run build
```

验收标准：命令退出码为 `0`，并生成以下关键产物：

```text
out/
├─ main/index.js
├─ preload/index.js
└─ renderer/
   ├─ index.html
   └─ assets/
```

运行生产构建：

```powershell
.\scripts\npm.cmd exec -- electron .
```

生产窗口应显示与开发模式一致的基础工作台和运行环境信息。关闭窗口即可结束进程。

## 5. 安全边界检查

当前阶段应持续满足：

- `BrowserWindow` 使用 `nodeIntegration: false`；
- `contextIsolation: true`；
- sandbox 保持启用；
- preload 只暴露只读运行环境数据以及固定的 `workspace.open()`、`workspace.refresh()`；
- 渲染进程不直接导入 Node.js 文件系统 API；
- 不向渲染进程暴露 `ipcRenderer` 或通用 IPC 调用器。
- 工作区 IPC 不接受渲染进程提供的绝对路径；
- 工作区扫描只读取目录项，不读取文件正文，也不执行文件写入。

这些约束主要由代码审查、类型隔离和真实窗口启动共同验证。后续新增桌面能力时，应为每个具体用例设计独立接口和测试。

## 6. 推荐验收顺序

```powershell
.\scripts\bootstrap.cmd
.\scripts\npm.cmd ci
.\scripts\npm.cmd run check
.\scripts\npm.cmd run build
.\scripts\dev.cmd
```

不要并行运行 `check` 和 `build`：electron-vite 构建期间会创建临时配置文件，与 ESLint 扫描并发时可能产生无意义的文件竞争。
