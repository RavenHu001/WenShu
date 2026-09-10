# 文枢开发环境

## 目标

开发环境采用“项目本地工具链”模式。Node.js、npm 和 npm 项目依赖都位于仓库目录中，不依赖系统 PATH 中的全局 Node.js：

```text
.node-version                         固定 Node.js 版本
.tools/node-v<版本>-win-<架构>/       本地 Node.js 与 npm，不提交 Git
node_modules/                         npm 项目依赖，不提交 Git
package-lock.json                     依赖解析结果，提交 Git
scripts/                              引导脚本与固定环境命令入口
```

这不是进程或操作系统级沙箱，但在开发环境复现方面相当于 Python 虚拟环境：每个项目使用自己的运行时版本和依赖目录。

## 初始化

在仓库根目录运行：

```powershell
.\scripts\bootstrap.cmd
.\scripts\npm.cmd ci
```

`bootstrap.cmd` 使用进程级 `ExecutionPolicy Bypass` 调用内部 PowerShell 脚本，因此可以在禁止直接执行 `npm.ps1` 的 Windows 环境中使用。它不会修改系统 PowerShell 执行策略。

引导过程执行以下操作：

1. 从 `.node-version` 读取精确版本；
2. 根据 Windows 主机选择 x64 或 ARM64 便携包；
3. 从 Node.js 官方发布目录下载压缩包和 `SHASUMS256.txt`；
4. 对压缩包执行 SHA-256 校验；
5. 解压到 `.tools/`；
6. 输出实际 Node.js 与 npm 版本。

脚本可重复执行。工具链已经完整存在且版本一致时，不会重新下载。

## 命令入口

- `scripts/node.cmd`：执行项目本地 `node.exe`；
- `scripts/npm.cmd`：执行项目本地 npm，并将本地 Node.js 临时放到当前进程 PATH 首位；
- `scripts/dev.cmd`：开发启动快捷入口。

示例：

```powershell
.\scripts\node.cmd --version
.\scripts\npm.cmd --version
.\scripts\npm.cmd run check
.\scripts\npm.cmd run build
```

当前固定工具链为 Node.js `22.15.0`、npm `10.9.2` 和 Electron `43.6.0`。干净 `npm ci`
之后如果 Electron runtime 尚未落盘，在运行 E2E 或打包前执行：

```powershell
.\scripts\npm.cmd exec -- install-electron --no
```

包装器只修改自身及子进程的环境，不修改用户或系统 PATH。

## 更新 Node.js

更新运行时时应作为一次明确的工程变更：

1. 修改 `.node-version`；
2. 同步检查 `package.json` 中的 `engines` 和 `packageManager`；
3. 运行 `scripts\bootstrap.cmd`；
4. 使用 `scripts\npm.cmd ci` 进行干净安装；
5. 运行 `scripts\npm.cmd run check` 和 `scripts\npm.cmd run build`；
6. 实际启动 Electron 窗口；
7. 将验证结果记录到任务报告。

旧版本目录位于 `.tools/`，确认新版本通过全部验证后可以手动删除。

## 故障处理

### 下载受限

引导脚本默认从 Node.js 官方版本目录下载。若当前网络无法下载官方大文件，可以只为当前命令指定兼容镜像：

```powershell
$env:WENSHU_NODE_DIST_URL = 'https://npmmirror.com/mirrors/node'
.\scripts\bootstrap.cmd
Remove-Item Env:WENSHU_NODE_DIST_URL
```

镜像只提供 ZIP 数据；脚本仍从 Node.js 官方目录取得版本化 `SHASUMS256.txt` 并校验 ZIP，不会信任镜像提供的散列。该变量不写入项目配置，也不会永久修改系统环境。

如果官方校验清单本身也无法访问，可在其他可信环境下载对应 Windows ZIP 和同目录 `SHASUMS256.txt`，手工核对散列后将完整工具链目录复制到 `.tools/`。

### 不完整工具链

如果下载或解压被中断，脚本会拒绝使用不完整目录并给出路径。删除提示的单个版本目录后重新运行 `scripts\bootstrap.cmd`。不要删除整个项目或其他版本目录。

### 依赖损坏

工具链正常但 npm 依赖异常时，优先运行：

```powershell
.\scripts\npm.cmd ci
```

`npm ci` 会依据锁文件重建 `node_modules`，不应通过 `--force` 绕过依赖冲突。

### Windows 换行符与格式检查

项目在 Windows 开发，但源码和文档应采用仓库统一的行尾策略。Git 的 `core.autocrlf`、`.gitattributes` 与 Prettier 的 `endOfLine` 必须保持一致；否则可能出现 Git 工作树干净，但 `prettier --check` 因磁盘上的 CRLF / LF 差异失败。

诊断时可以检查：

```powershell
git config --get core.autocrlf
Get-Content .gitattributes
Get-Content .prettierrc.json
.\scripts\npm.cmd run format:check
```

不要只在个人编辑器中关闭行尾检查。行尾策略应由仓库配置固定，并在调整后通过全新检出或等价的重新规范化验证。批量规范化可能触及大量文件，执行前必须确认工作树并保护用户已有修改。

### Vitest worker 或文件系统测试超时

若测试出现 `vitest-worker` 通信超时、临时目录初始化超时或 symlink/junction 探测卡住：

1. 单独运行失败测试文件，区分业务断言失败和测试基础设施失败；
2. 确认系统临时目录可创建和删除普通文件；
3. 在普通本地 PowerShell 与受控环境分别复现，记录环境差异；
4. 不支持符号链接时只跳过对应真实链接用例，并保留适配器 mock 的确定性安全覆盖；
5. 必要时对文件系统测试使用受控 worker 数量，但不得用任意长超时掩盖死锁；
6. 修复后重新运行完整 `check` 和 `build`。

Task 4 的 WP0 将这些项目作为首次写入能力实施前的强制门禁，详见 [TASK-004 规划](./TASK_004_TXT_EDIT_SAFE_SAVE.md)。

### Electron 下载受限

`npm ci` 安装 Electron npm 包后，还需要下载对应的 Electron 运行时。若官方二进制端点在当前网络中连接重置，可以只为当前安装命令指定镜像：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
.\scripts\npm.cmd ci
.\scripts\npm.cmd exec -- install-electron --no
Remove-Item Env:ELECTRON_MIRROR
```

该变量不写入 npm 配置或仓库；`package-lock.json` 仍然固定 Electron npm 包及其他依赖版本。

## 发布环境与开发环境的区别

`.tools/` 只服务于源码开发和构建。Task 12 的内部 Electron 包携带应用运行所需的 Electron、
Chromium 和 Node.js 组件，普通测试用户不需要安装或保留本地开发工具链。当前包没有自动更新源：
builder 配置显式使用 `publish: null`，最终审计禁止 `resources/app-update.yml`。

内部 Windows 产物的完整本地门禁为：

```powershell
.\scripts\npm.cmd run check
.\scripts\npm.cmd run build
.\scripts\npm.cmd run package:dir
.\scripts\npm.cmd run package:win
.\scripts\npm.cmd run package:verify -- --mode=win
.\scripts\npm.cmd run test:e2e
.\scripts\npm.cmd run release:manifest:unsigned
.\scripts\npm.cmd run release:verify:unsigned
```

这些命令只构建和验证未签名内部产物，不授权 push、tag、签名或公开发布。Windows 10 理论兼容性、
后续实机验证边界、远程 CI 和已知限制以 [TASK-012 完成报告](./TASK_012_COMPLETION_REPORT.md) 为准。
