# 文枢测试指南

本文档说明如何验证当前已完成的工程基座、Task 2 工作区能力与 Task 3 的 UTF-8 TXT 受控只读读取能力。现阶段测试目标是确认应用能够安装、检查、构建、选择本地工作区、浏览只读文件树，并从文件树打开 TXT 在中央只读标签页阅读；不包含文档编辑、保存、多标签页或 DOCX 功能验收。

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

### 3.1 TXT 只读读取验收

准备一个包含多层目录的测试文件夹，并在根目录与子目录中各放置一个 UTF-8 TXT（建议包含中文、多行和空白），另准备一个空 TXT、一个非 TXT 文件和一个超过 5 MiB 的 TXT。

- 点击根目录 TXT：中央区域先显示"正在读取 <文件名>…"，随后显示以文件名命名的单个活动标签和只读正文；
- 正文保留换行与空白，可用鼠标选择并复制，但不可编辑；
- 展开子目录并打开嵌套 TXT，内容正确且标签标题为文件名；
- 打开空 TXT：标签正常显示，正文区域为空；
- 连续快速选择两个 TXT，最终只显示最后选择的文件；
- 点击非 TXT 文件、目录或符号链接：不读取正文，中央区域内容不变；
- 删除一个尚未打开的 TXT 后点击它：显示错误提示，应用不崩溃；
- 打开超过 5 MiB 或非 UTF-8 编码的 TXT：显示明确错误提示，不显示部分正文；
- 已有正文时打开失败文件：原正文保留并显示非阻塞错误横幅；
- 点击"刷新"：当前只读正文保持可见；
- 成功切换工作区：旧正文清除并回到欢迎状态；
- 取消切换工作区：旧正文保留；
- 开发者控制台没有未处理异常；
- 测试过程中确认应用没有创建、修改或删除任何测试文件。

当前不应出现文档编辑、保存、多标签页或通用 IPC 功能。

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

生产窗口应显示与开发模式一致的基础工作台和运行环境信息。选择工作区并打开一个 UTF-8 TXT，确认中央只读标签页能够显示正文，控制台没有未处理异常。关闭窗口即可结束进程。

## 5. 安全边界检查

当前阶段应持续满足：

- `BrowserWindow` 使用 `nodeIntegration: false`；
- `contextIsolation: true`；
- sandbox 保持启用；
- preload 只暴露只读运行环境数据、固定的 `workspace.open()` / `workspace.refresh()` 以及 `document.readText(relativePath)`；
- 渲染进程不直接导入 Node.js 文件系统 API；
- 不向渲染进程暴露 `ipcRenderer` 或通用 IPC 调用器；
- 工作区 IPC 不接受渲染进程提供的绝对路径；
- `document.readText` 只接受文件树快照中的规范相对路径，主进程对其重新执行格式、边界、符号链接、类型、大小与 UTF-8 校验；
- 文档读取只使用只读文件系统 API（`lstat`、`realpath`、有界 `read`），不执行任何文件写入；
- 跨进程结果不包含原始异常、Buffer、文件句柄或调用栈。

这些约束主要由代码审查、类型隔离、单元测试和真实窗口启动共同验证。后续新增桌面能力时，应为每个具体用例设计独立接口和测试。

## 6. 推荐验收顺序

```powershell
.\scripts\bootstrap.cmd
.\scripts\npm.cmd ci
.\scripts\npm.cmd run check
.\scripts\npm.cmd run build
.\scripts\dev.cmd
```

不要并行运行 `check` 和 `build`：electron-vite 构建期间会创建临时配置文件，与 ESLint 扫描并发时可能产生无意义的文件竞争。
