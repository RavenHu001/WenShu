# TASK-013 完成报告：基础设置与启动恢复

简体中文 | [English](./TASK_013_COMPLETION_REPORT.en.md)

[任务规划](./TASK_013_SETTINGS_STARTUP_RESTORE.md) · [任务档案](../README.md)

> **状态：实施中。** 2026-09-20 仅执行 WP0：基线与启动验证；本包完成后停止，未实施 WP1–WP5。
> 设置页面、正式数据目录入口、JSON 存储器和恢复功能均尚未交付。Task 12 的内部二进制/公开源码边界不变。

## 1. 基线与改动范围

- 分支 `TASK-13`，起点 `e536c1c70e826fe5dd0fe232fda178a953660635`；开始时 Git 工作树干净，无已有 Task 13 完成报告；仓库及适用父目录未发现 `AGENTS.md`。
- 已完整阅读本任务规划、开发提示词、README、PROJECT_BASELINE、TESTING 和 Task 12 完成报告，并核查下面的实际接入点。
- 本机 Windows build `26200.9457`，属于 Windows 11；不作为 Windows 10 实机证据。项目本地 Node `22.15.0`、npm `10.9.2`，锁定 Electron `43.6.0`、builder `27.0.0-alpha.8`；当前 Vitest `3.2.7`。
- 未修改 `src/`、产品打包配置、依赖或锁文件。只保留两个隔离探针脚本、工具目录的 lint/format 排除和中英文交接文档；没有产品 UI 接线。
- 全部合成数据/缓存/包位于 Git 已忽略的 `.tools/task-013-wp0/`。现有 builder 白名单只收集 `out/main`、`out/preload`、`out/renderer` 等产品文件，探针和数据不进入产品包。没有清理或搬移旧 `.tools/doc-review/` 文件。

## 2. 命令与真实结果

所有 npm/node 命令均经 `scripts/npm.cmd` / `scripts/node.cmd`。基线验证 shell 临时将 TEMP/TMP 指向仓库 `.tools/task-013-wp0/temp`，仅由该 shell 的子进程继承；没有修改用户/系统环境变量。探针为每轮创建独立目录，并只给子进程传入 TEMP/TMP、appData 和 profile 的隔离位置。

| 命令/动作                                                                                                         | 结果 | 说明                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| `npm.cmd run check` 首次                                                                                          | 1    | typecheck 通过；lint 扫到 Git 已忽略的 `.tools/doc-review/` 三个旧 CJS 脚本，25 个错误；后续阶段未运行     |
| `npm.cmd run check` 修正扫描范围后                                                                                | 0    | typecheck、lint、format、103 包 NOTICE 校验通过；73 文件、1189 通过、10 条件跳过、0 失败                   |
| 随后 `npm.cmd run build`                                                                                          | 0    | main 155.17 kB、preload 4.30 kB、renderer JS 2264.13 kB；产品代码修改数为 0                                |
| `node.cmd scripts/verify-task-013-startup.mjs` 受限沙箱两次                                                       | 1    | 正常分支 ready 前路径设置成功；renderer 加载 data URL 报 `ERR_FAILED (-2)`；第二次只增加错误诊断           |
| 同一命令，普通桌面进程                                                                                            | 0    | 不改安全开关即通过；同根单实例、窗口聚焦、退出重启和 cookie 持久性均通过                                   |
| 同命令加 `--native`，普通桌面进程                                                                                 | 0    | 实际 Windows 原生选址，经 computer-use 操作；未 mock 对话框；定位文件→`app.relaunch()`→新 PID 正常启动通过 |
| 同命令加 `--prepare-package`                                                                                      | 0    | 生成独立 appId 的最小探针工程与 builder 配置，全部位于隔离目录                                             |
| `node.cmd scripts/run-electron-builder.mjs --config .tools/task-013-wp0/builder.json --win --x64 --publish never` | 0    | 实际生成 portable/NSIS，沿用产品 fuse hook、ASAR integrity、未签名策略；无发布                             |
| 同探针命令加 `--portable=.tools/task-013-wp0/package/WP0-portable.exe`                                            | 0    | 真实启动器目录、解包目录、路径、同根锁、cookie 重启均通过；补齐启动器退出等待后再次通过                    |
| 独立 NSIS `/S /D=<probe-install>`                                                                                 | 0    | 安装到仓库内中文含空格目录；独立 appId、无桌面/开始菜单快捷方式                                            |
| 探针 `--installed=<probe-install>/WenShu.exe`                                                                     | 0    | 安装后 EXE 实际启动、外置根、同根锁、重启持久性通过                                                        |
| 独立卸载器 `/S _?=<probe-install>`                                                                                | 0    | 安装目录内合成哨兵被删除；外置数据 44 个文件 SHA-256 前后一致                                              |
| `npm.cmd run test:e2e`，隔离 TEMP/TMP                                                                             | 0    | 1 文件、4 用例：启动/About、TXT 精确字节、DOCX/备份、dirty 标签取消关闭                                    |
| 新增脚本 Prettier / ESLint                                                                                        | 0    | 首次 lint 发现 MJS 未显式导入 Node 全局；补齐 import 后通过，未放宽规则                                    |

基线修复仅为 ESLint / Prettier 排除 `.tools/`、`.local-data/`、`release/` 工具和产物目录；没有禁用源码规则、删除断言、增加测试跳过或调整既有 timeout。10 个跳过均为既有真实 symlink/junction 能力条件：TXT 2、DOCX 2、搜索 2、resolve/relocate/trash/reveal 各 1。测试中一条 EPERM 清理提示来自既有故障注入用例，不是基线失败。

现有 E2E 本来就传 `--disable-gpu --no-sandbox`；本包未修改它，4/4 仅作既有行为回归。WP0 专用探针不传这两个开关，窗口保持 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`；真实启动通过发生在普通桌面执行环境，不能把受限沙箱失败说成通过。

收尾定向复验：最终脚本普通桌面启动通过（`known-SwsbP8`）；`npm.cmd run lint`、`npm.cmd run format:check`、`git diff --check` 均为 0。334 个本地 Markdown 链接目标存在；探针 ASAR 实读仅有 `main.mjs`、`package.json`，没有验证数据。首次 ASAR 单行命令因 Windows 命令行引号丢失而语法失败，改为本地 `.mjs` 文件后检查通过。最终仓库相关 Electron/探针进程为 0。

## 3. 启动与目录证据

本地证据为 `.tools/task-013-wp0/` 下的 `check*.log`、`build.log`、`e2e.log`、`package.log`、`nsis-result.json`，以及每轮的 `events.jsonl` / `summary.json`。报告只记相对路径与合成数据，不提交 profile、包或绝对用户路径。

- **已知根**（`known-uVZavD`）：`paths-before-ready.ready=false`，`userData=数据 根/runtime`、`sessionData=数据 根/runtime/session`；正式分支才出现 1 个 session、1 个 BrowserWindow。第二进程在 ready 前锁失败，session/window 均为 0；首进程收到 `second-instance`，仍只有 1 个窗口且 `focused=true`。第三个 PID 的 `previousCookie=true`。
- **首次引导**（`native-pHMzJE`）：原生对话框前及返回后均为 0 session、0 BrowserWindow。原生选择的目录包含中文/空格；定位文件实写 **103 bytes**，同目录 `wx` 临时文件→写入→fsync→close→rename。`app.relaunch()` 后是不同 PID，再在 ready 前设置正式路径。没有在 ready 后改正式缓存路径。
- **真实落盘**：正常分支退出后可见 `runtime/session/Network/Cookies`、`Local State`、`Preferences`、`Cache`、`Code Cache`、`GPUCache` 等；`session.defaultSession.getStoragePath()` 与显式 sessionData 一致。cookie 重启后读到合成值，证明不只是调用了 setPath。logs/crashDumps 的路径和目录已验证，但没有故意产生日志或崩溃转储，不能宣称验证了 dump 内容。
- **引导痕迹边界**：即使没有访问 defaultSession 或创建业务窗口，引导隔离 profile 仍出现 `bootstrap-traces/session/Local State`。探针为了保护真实 profile，在 ready 前给引导阶段也设置了测试路径；这不是产品备用数据根，不能证明真实系统用户目录只增加 bootstrap。WP1 必须明确启动期痕迹归属，WP5 实测最终产品目录增量；规划已允许必要引导/系统/临时痕迹。
- **portable**（`portable-9UwWuo`，退出等待复验 `portable-aUAh15`）：启动器实测在 `launcher 中文/`；环境变量由真实 NSIS 启动器设置，验证器事先删除继承的 portable 标识。持久目录为 `launcher 中文/WenShuData/runtime/session`；运行 EXE 不在启动器目录，而在本轮子进程 TEMP 下；重启保持 cookie。仅按相同数据根验证单实例，不推断不同根/不同用户共用一把锁。
- **NSIS**：独立探针沿用锁定 builder 默认 portable/卸载模板和产品安全 fuse hook，使用不同 appId，未触碰用户 WenShu 安装。内部 `WenShuData/synthetic-sentinel.txt` 被卸载删除，外置根 44 文件哈希不变。`_?=` 原地运行卸载器会留下卸载器自身，已记录为探针启动方式的残留，不称安装目录完全消失。未做本轮最终 WenShu 产品升级/卸载验收。

## 4. 当前接入点与 WP1 文件交接

| 文件/模块                                                               | 已核对事实及后续职责                                                                                                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main/index.ts`                                                     | 当前不设路径、不取单实例锁；whenReady 后立即访问 defaultSession、注册业务 IPC、创建 1280×820 / 最小 900×600 窗口。WP1 必须先分流引导/正常入口，不能让引导分支落入该回调                          |
| `workspace-session.ts` / `workspace-ipc.ts`                             | 根仅存在主进程内存，当前只来自用户打开工作区时的原生选择器；扫描成功才提交，取消/失败保留旧根。缺少主进程扫描代次和会话 token；restoreLast 必须共享安全扫描成功提交逻辑                          |
| `scan-workspace.ts` / 文档路径解析 / 工作区搜索                         | 子树扫描和文档安全读取不是同一层；恢复根需逐段 lstat/realpath 拒绝链接，不能仅凭现有扫描就称根已安全。需按真实路径精确排除当前数据子树，不能按名称屏蔽所有 WenShuData                            |
| `window/window-close.ts` / `App.tsx`                                    | 主进程 close 总是先询问 renderer，pending 防重；renderer 用最新 dirty/saving 决定放弃、取消、等待。以后只在用户允许关闭后提交最后元数据并 flush；不得绕过保存保护                                |
| `src/preload/index.ts` / `src/shared/desktop-api.ts`                    | 只有固定窄调用，无 appState / restoreLast。WP1 加有限 DTO 和结果，不暴露 fs、任意键、任意根路径、通用 invoke                                                                                     |
| `use-workspace.ts`                                                      | generation 防旧 renderer 结果、成功提交递增 epoch，刷新单飞；提取共享成功提交路径，补入主进程签发会话 token                                                                                      |
| `use-documents.ts` / `use-editor-sessions.ts`                           | openFile 唯一路径标签，读取结果受 epoch/tabId/requestId 门禁；失败保留 read-error。复用 controller，不持久化编辑器、正文、revision 或运行时 tabId                                                |
| `electron.vite.config.ts` / builder / `verify-package.mjs`              | preload 保持 CJS sandbox；开发根可从固定 `out/main` 相对项目根解析，不依赖 cwd；WP1 增加 `.local-data` Git/包禁止项及审计，保留现有白名单/fuses                                                  |
| `tests/e2e/electron-smoke.test.ts` / `scripts/capture-ui-baselines.mjs` | E2E 用 tmpdir + `--user-data-dir`；截图在 ready 前只设 `out/.capture-user-data`，且路径依赖 cwd。WP1 同步迁移隔离启动方式，显式覆盖 session/log/dump 及 settings/state，不读取开发或用户恢复记录 |

新增职责保持规划的少量模块：`src/shared/app-state.ts`（纯 DTO/预算/校验）、`src/main/app-state/data-directory.ts`（路径/引导/定位）、`app-state-store.ts`（两个 JSON/队列/flush）、`app-state-ipc.ts`（窄接口）。本包没有创建这些 WP1 产品模块。

## 5. 固定的目录与契约

### 目录

1. 开发：稳定项目根下 `.local-data/dev`；不能用启动 cwd 或硬编码盘符。便携：`PORTABLE_EXECUTABLE_DIR/WenShuData`；不能用 `dirname(process.execPath)`。安装/无 portable 独立包：原生选择独立根，系统用户目录的长期应用定位数据只有 `<appData>/WenShu/bootstrap.json`（≤8 KiB）。
2. 正式根固定含 `settings.json`、`state.json`、`runtime/session`、`runtime/logs`、`runtime/crashDumps`。userData=runtime，sessionData=runtime/session；路径存在并验证后在顶层同步设置，再取单实例锁，成功后才初始化业务 session/window/IPC。
3. 安装根与安装目录相等、互为祖先/后代或经链接重叠均拒绝；本地普通目录逐段验证。已记录根丢失时不 mkdir 冒充原目录。不可写/缺盘走规划的重试、选择、退出；便携不可写提示移动目录或退出。不得静默回退 C 盘。
4. 首选取消退出；主动重选取消保留原路径、清除重选标志、重启旧根；原根不可用时取消回到重试/退出。不自动迁移、合并或删除旧数据。只写下次重选标志，不立即重启编辑会话。
5. 不承诺 Windows、引导痕迹或 portable TEMP 解包零 C 盘写入；不更改全局 TEMP/TMP。测试覆盖必须先于模式分流，明确只接受主进程启动参数，renderer 无选址路径能力。

### WP1 DTO 冻结依据（尚未实现）

| 对象          | 字段与默认值/预算                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| bootstrap     | `{version:1,dataRoot:string,reselectOnNextStart?:boolean}`；UTF-8 ≤8192 bytes；绝对本地根，拒绝多余字段/未知版本；取消不破坏旧定位                                                                                                                                                         |
| settings      | `{version:1,theme,txtFontPreset,txtFontSizePx,startupMode}`；≤16384 bytes。theme=`system/light/dark`，默认 system；字体=`system/monospace/serif`，默认 **monospace**；字号整数 12–24，默认 **13**；startupMode=`blank/workspace/workspace-and-tabs`，默认最后一项                          |
| state         | `{version:1,window:{normalBounds,maximized},sidebar:{width,collapsed},lastWorkspace}`；≤524288 bytes。normalBounds 初始 null，否则有限安全整数 x/y/width/height、宽高正数，由主进程结合屏幕校正；maximized=false；侧栏 258 px / false，复用 180–420 clamp；lastWorkspace=null              |
| lastWorkspace | `{rootPath,tabRelativePaths,activeRelativePath}`；仅主进程填写 rootPath；相对路径使用 `/`、只 TXT/DOCX，禁止绝对路径、空段、点段、反斜杠、NUL/ADS；路径字符串建议统一上限 4096 UTF-16 单元并叠加 JSON 字节预算。活动路径可 null，否则必须属于所存列表；仅工作区模式列表为空、活动路径 null |
| checkpoint    | `{workspaceSessionId,tabRelativePaths,activeRelativePath,sidebar}`；无工作区时 token=null 且列表为空；renderer 不传根、window bounds、dataRoot。主进程签发不透明 token，成功切换（包括同根重开）更换，refresh 保持；校验/入队及发布前复验 token，拒绝旧工作区快照。token 不写入 state.json |

TXT 当前真实样式是 `app.css` 中 `'Cascadia Mono', Consolas, 'Courier New', monospace`、13 px，因此默认 monospace/13；不能按 UI 名称猜成 system。设置字号/字体只改变显示，不写文档。

恢复最多 100 个标签，不限制运行时标签数；主进程先去重，超限时保留活动标签，并按原顺序保留其余所选标签，返回显式 `TAB_LIMIT` 提示。快照输入本身也受 512 KiB 总预算限制，超大 IPC 在合并前拒绝；不能先无限复制/解析再检查。文件先 stat/有界读取后 parse；版本和精确字段校验不直接展开到应用对象。

窄 API：`appState.get()`、`updatePreferences(完整白名单偏好)`、`checkpoint(snapshot)`、`openDataDirectory()`、`chooseDataDirectoryOnNextStart()`、`resetInvalidFile('settings'|'state')`，以及无路径参数的 `workspace.restoreLast()`。建议统一 `{status:'ok',...}` / `{status:'error',error:{code,message}}`，取消独立 status；code 至少区分 `INVALID_REQUEST`、`INVALID_DATA`、`UNSUPPORTED_VERSION`、`TOO_LARGE`、`STALE_SESSION`、`DATA_DIRECTORY_UNAVAILABLE`、`READ_FAILED`、`WRITE_FAILED`。get 对每文件返回 missing/valid/invalid/unsupported/read-error 状态和安全默认值；错误不含原始异常/绝对路径，数据位置只经明确展示字段返回。

每文件一个串行队列，约 500 ms 合并，仅元数据变动触发；排他同目录临时文件→完整写→sync→close→rename，失败保留旧文件与内存偏好。`checkpoint` 入队确认不能冒充已落盘；结果区分 queued/saved，flush 等待最新版本及在途写入，并暴露可重试持久化错误。设置模式切换的 lastWorkspace 清理在 settings 成功持久化后生效；两文件不声称事务，启动按 settings 再投影 state，防止旧标签意外恢复。损坏/未知版本禁止自动覆写，明确重置前保留原件。

关闭先完成既有 dirty/saving 协议，再提交最终元数据、flush；失败给重试/继续退出，不等于文档保存失败。恢复开始到结束暂停快照；中途关闭保留原 lastWorkspace、只收尾设置/布局；用户明确停止才采纳部分现场。工作区根/窗口 bounds 归主进程，正文输入不写 state。

测试兼容策略：保留已有 `--user-data-dir=<P>` 的 runtime 语义；WP1 把该显式参数识别为隔离测试根 `<P>`，settings/state 位于 `<P>`，userData 仍为 `<P>`，session/log/dump 为其子目录（仅测试布局例外），跳过真实 bootstrap/开发根。生产三种固定布局不变。E2E 与截图必须同时采用这一约定，截图绝对路径从脚本位置解析；不得让仅覆写 Chromium profile 的旧入口仍读取真实 settings/state。

## 6. 可复用验证入口与剩余条件

```powershell
.\scripts\node.cmd scripts/verify-task-013-startup.mjs
.\scripts\node.cmd scripts/verify-task-013-startup.mjs --native
.\scripts\node.cmd scripts/verify-task-013-startup.mjs --prepare-package
.\scripts\node.cmd scripts/run-electron-builder.mjs --config .tools/task-013-wp0/builder.json --win --x64 --publish never
.\scripts\node.cmd scripts/verify-task-013-startup.mjs --portable=.tools/task-013-wp0/package/WP0-portable.exe
```

`--native` 在真实对话框中选择本轮打印目录下的 `数据 根`；原生选择有 180 秒人工交互期限，正常启动观察 30 秒。脚本专为合成目录设计，不能复用其简化定位读取作为产品安全校验器。独立 NSIS 的安装/卸载仅针对 `--prepare-package` 生成的独立身份；安装后可用 `--installed=<probe-install>/WenShu.exe`。不要对用户现有安装执行该演练。

WP0 核心可行性检查点已满足，可交接 WP1；仍须保留以下门禁，不能标记全 Task 13 完成：

- 引导阶段的 Local State 是实际发现；最终产品启动期痕迹位置及“仅有界定位文件为长期用户目录数据”仍需 WP1 定案、WP5 量测。测试 appData 重定向不替代真实产品路径证明。
- WP1 还需严格目录/链接/安装重叠校验，不可写/缺盘、首次取消/主动重选取消/旧根不可用取消，坏 JSON、超大/未知版本、写入失败、flush 竞态等行为测试。本包没有用 mock 声称这些已完成。
- 默认开发 `.local-data/dev` 与最终产品 portable/installed 入口尚未接线；升级/卸载保留外置业务 settings/state、真实 logs/dumps、跨用户/不同数据根锁范围及 Windows 10 实机均未验。本次只证明锁定运行时和模板的最小实际流程。
- 后续实现需同步 E2E/截图覆盖与 `.local-data` Git/包审计禁止项；现有 E2E 的 no-sandbox 限制仍须在报告中区分。

本次到此结束，不自动开始 WP1。

## 7. 参考核对

- 锁定 `node_modules/electron/electron.d.ts` 的 `setPath`、`setAppLogsPath`、`relaunch`、`requestSingleInstanceLock`、`Session.getStoragePath`，与 [Electron app API](https://www.electronjs.org/docs/latest/api/app#appsetpathname-path) 对照：目录须存在，sessionData 须在 ready 前覆写。
- 锁定 `node_modules/app-builder-lib/templates/nsis/portable.nsi` 的 `$EXEDIR` 环境变量、`ExecWait` 与解包清理，与 [builder portable 文档](https://www.electron.build/docs/nsis/#portable) 对照。
- 锁定 `uninstaller.nsh` 的 `RMDir /r $INSTDIR` 与单独的 AppData 删除分支，对照 [NSIS 配置](https://www.electron.build/docs/nsis/#deleteappdataonuninstall)：`deleteAppDataOnUninstall:false` 不保护安装目录内部数据。
