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

### Electron 下载受限

`npm ci` 安装 Electron npm 包后，还需要下载对应的 Electron 运行时。若官方二进制端点在当前网络中连接重置，可以只为当前安装命令指定镜像：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
.\scripts\npm.cmd ci
Remove-Item Env:ELECTRON_MIRROR
```

该变量不写入 npm 配置或仓库；`package-lock.json` 仍然固定 Electron npm 包及其他依赖版本。

## 发布环境与开发环境的区别

`.tools/` 只服务于源码开发和构建。未来生成的 Electron 安装包会携带应用运行所需的 Electron、Chromium 和 Node.js 组件，普通用户不需要安装或保留本地开发工具链。
