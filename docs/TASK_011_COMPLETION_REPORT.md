# TASK-011 完成报告：桌面应用外壳、信息架构与编辑体验重构

> 实施日期：2026-08-22；分支：`TASK-011`；起始提交：`5eea921`；平台：Windows。
> WP0–WP5 已按顺序完成产品实现、定向测试与自动质量门禁。真实 Electron 截图、开发/
> 生产启动冒烟和最终命令结果见第 8–10 节。Windows 物理 100%/125%/150% 显示缩放会
> 修改会话级系统设置，当前自动化会话未擅自切换，保留项目所有者最终确认项。

## 1. 实际完成结果

Task 11 的产品代码与自动化验收已完成：应用从“双菜单 + 固定侧栏 + 底部按钮墙”的工程原型，重构为单一中文应用菜单、SVG 活动栏、可调/可折叠侧栏、文件树对象菜单/键盘/内部拖拽、紧凑标签与状态、DOCX 连续居中写作画布、分组溢出工具栏、分层搜索结果和 toast 反馈。

没有新增第三方依赖、IPC、preload 方法或 DesktopApi；renderer 仍不访问 Node 文件系统。Task 9 的安全文件管理服务和 Task 10 的 DOCX 当前查找 controller 原样作为业务事实来源。

## 2. 工作包对应

### WP0：冻结基线

- 完整阅读指定文档、renderer/controller/shared/preload/main 与测试；仓库无适用 `AGENTS.md`；工作树起始干净。
- 修改前 `check`：62 文件 / 1133 passed / 10 条件跳过；`build` 退出码 0。
- 冻结菜单事件模型、拖拽状态机、页面状态矩阵、截图策略与风险，见 `TASK_011_WP0_REPORT.md`。

### WP1：token、SVG 与基础组件

- `tokens.css`：表面/边框/文字、primary/success/warning/danger/info、hover/active/selected/focus/disabled、间距/字号/圆角/阴影/层级/动画；包含 forced-colors 与 reduced-motion。
- `Icon.tsx`：项目内 SVG 图标；不使用 emoji、远程图片或新增图标依赖。
- `MenuSurface`：方向键、Home/End、Enter、Tab 圈定、Escape、外部点击、窗口 blur、焦点恢复与 listener cleanup。
- `ModalDialog`：初始焦点、Tab 圈定、Escape 与焦点恢复；`ToastRegion`：成功限时、错误持久、live region 和显式关闭。

### WP2：应用外壳

- 主进程 `Menu.setApplicationMenu(null)` 移除 Electron 默认英文菜单；renderer `AppMenuBar` 是唯一中文菜单，命令均调用真实 controller。
- 文件/搜索活动栏改为 SVG + tooltip + 明确名称；未实现设置入口移除。
- 标签可同时表达 active、dirty、saving、error/conflict 与关闭能力；备份路径进入 tooltip。
- 状态栏降为 22 px 中性表面，Electron 版本进入“关于文枢”。

### WP3：侧栏、上下文菜单、键盘与拖拽

- 删除 `FileManagementToolbar.tsx` 和侧栏底部按钮墙；文件树获得完整剩余高度。
- 侧栏 180–420 px，指针拖动、Arrow/Home/End 键盘调整、双击复位、折叠/活动栏或视图菜单恢复。
- 根/空白、文件、文件夹三类上下文菜单；稳定目标是 `WorkspaceEntry`/规范 relativePath，不解析展示文字。
- F2、Delete、Shift+F10/菜单键、F5、Ctrl+Shift+S 与 Escape 等价入口全部复用既有门禁。
- 同工作区内部拖拽只调用 `workspace.relocate`：目录/根高亮，no-op、自身/后代、同名、saving、非法目标、过期 epoch 拒绝；pending 防重；Escape/dragend/卸载/工作区切换清理。
- 成功仍执行 commitRelocate → stable tabId 路径迁移 → 刷新 → mutationEpoch；主进程失败不乐观迁移；partial failure 强制刷新。

### WP4：编辑区与搜索

- DOCX 为连续写作画布，最大 820 px、居中、外围工作区背景；无 page/page count 语义。
- 工具栏按历史、字符、段落、字符外观、列表、对齐分组；`ResizeObserver` 在 700 px 阈值切换“更多格式”，不撑出编辑区横向滚动。
- TXT 继续使用原 CodeMirror 全高布局与快捷键。
- 搜索结果为“文件卡片 → 匹配”，文件名/父路径/类型/数量分层，片段优先、行列次要；对象身份与点击参数保持原结果对象。
- 工作区搜索限制说明折叠收纳；当前 TXT/DOCX 查找、普通/当前匹配与 focus 样式语义保持。

### WP5：验收、截图与文档

- 增加 token/forced-colors/reduced-motion、菜单/对话框/toast、侧栏、拖拽、工具栏溢出、画布和搜索层级测试。
- 增加真实 Electron capturePage 脚本与固定截图目录；更新 README、PROJECT_BASELINE、TESTING、Task 11/FUTURE UI 文档和本报告。

## 3. 关键架构与文件

### 新增

- `src/renderer/components/common/{Icon,IconButton,MenuSurface,ModalDialog,ToastRegion}.tsx`
- `src/renderer/components/shell/{AppMenuBar,ActivityBar,AboutDialog,StatusBar,SidebarResizeHandle}.tsx`
- `src/renderer/components/workspace/FileTreeContextMenu.tsx`
- `src/renderer/lib/{file-tree-interactions,sidebar-size}.ts`
- `src/renderer/styles/{tokens,common,shell,workspace,document,search}.css`
- `tests/common/ui-primitives.test.tsx`
- `tests/shell/{app-shell,design-system}.test.*`
- `tests/workspace/{file-tree-interactions,file-tree-context-drag,file-management-drag-controller}.test.*`
- `tests/document/docx-toolbar-layout.test.tsx`
- `scripts/capture-ui-baselines.mjs`
- `docs/TASK_011_WP0_REPORT.md` 与本报告。

### 主要修改/删除

- `src/main/index.ts`：只移除默认菜单；安全 BrowserWindow 配置不变。
- `src/renderer/App.tsx`：保留顶层生命周期编排，展示细节移至 shell/common/workspace 组件；接入 toast、sidebar width 与全局 F5/Ctrl+Shift+S。
- `use-file-management.ts`：增加针对稳定路径的菜单命令入口和 `relocateByDrop`；未新增协议。
- `WorkspaceSidebar/FileTree/FileTreeNode`：完整重构侧栏与树交互；删除 `FileManagementToolbar.tsx`。
- `TabBar/DocumentPane/DocxToolbar/SearchSidebar/SearchResults`：外壳、画布、工具栏和搜索层级。
- 既有 Task 1–10 测试只适配新的可访问名称/入口/紧凑状态文本，安全与行为断言未删除或弱化。

## 4. 安全与生命周期复核

- BrowserWindow 仍为 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`。
- preload/DesktopApi/IPC 集合未扩大；拖拽没有 Node、绝对路径、外部 FileList、force/overwrite 参数。
- 主进程仍逐段拒绝 symlink/junction、做 realpath 边界/发布前复验；DOCX 备份迁移与回滚/partial failure 不变。
- 删除仍只调用 `shell.trashItem`，无永久删除降级。
- saving 路径变化被 UI/controller 防御；dirty 可移动并保持；冲突/只读/degraded/关闭保护不变。
- 拖拽成功使用既有 commitRelocate，stable tabId、标签顺序、活动状态、正文/模型、选区、滚动、撤销与当前查找保持。
- 成功 mutation 才通知 mutationEpoch；普通失败/取消/reveal 不通知；过期 workspace epoch 的迟到结果不提交 UI。
- 产品代码不记录正文、查询、绝对用户路径或拖拽内容。

## 5. 新增测试矩阵

- UI primitive：7 项；shell/menu/status/resize：8 项；design/static security：4 项。
- 文件树纯 drop/geometry：6 项；上下文/键盘/拖拽 UI：5 项；拖拽 controller：3 项。
- DOCX toolbar width/overflow：2 项；DOCX canvas/style：新增 1 项（文件共 3 项）。
- 既有文件管理、mutationEpoch、stable tabId、DOCX 查找/定位、保存/冲突和窗口生命周期全量回归。
- 无 `.only`、无新增无条件 `.skip`、无 timeout 扩大、无宽泛快照替代状态转移。

## 6. 视觉与无障碍证据

截图目录：`docs/visual-baselines/task-011/`。正常基线包含：

- `empty-files-1280x820.png`
- `empty-files-900x600.png`
- `empty-search-1280x820.png`
- `about-900x600.png`

矩阵脚本还生成：

- `empty-files-900x600-scale-125.png`
- `empty-files-900x600-scale-150.png`
- `empty-files-900x600-text-200.png`
- `empty-files-900x600-high-contrast.png`

执行 Agent 已用本地图片查看器逐张检查。正常 1280×820、900×600、搜索和关于无裁切/遮挡；125%/150% device-scale 代理稳定。第一次 200% zoom 检查发现欢迎页出现横向滚动，随后增加 ≤600 px 的 padding、字号、折行与 `overflow-x` 修复，重新 build/capture 后横向滚动消失。forced-high-contrast 图片为 Chromium 启动开关代理，不能冒充物理 Windows 高对比度会话确认。

自动行为证据覆盖菜单/对话框焦点、可访问名称、toast live region、侧栏 separator 值、键盘命令、drag target 状态和 reduced-motion/forced-colors 入口。真实屏幕阅读器朗读与 Windows 会话级 DPI 切换仍属于人工终验。

## 7. 依赖与包体积

- `package.json` / lockfile 无依赖变化。
- renderer 新增代码为项目 TypeScript/CSS/SVG；最终产物：main 154.95 kB、preload 4.10 kB、renderer CSS 53.24 kB、renderer JS 2,262.13 kB。

## 8. 自动质量命令

| 命令                                 | 最终结果                                    |
| ------------------------------------ | ------------------------------------------- |
| `.\scripts\npm.cmd run typecheck`    | 通过；5 个 tsconfig；退出码 0               |
| `.\scripts\npm.cmd run lint`         | 通过；0 warning；退出码 0                   |
| `.\scripts\npm.cmd run format:check` | 通过；退出码 0                              |
| `.\scripts\npm.cmd test`             | 69 文件；1170 passed / 10 skipped；退出码 0 |
| `.\scripts\npm.cmd run check`        | 69 文件；1170 passed / 10 skipped；退出码 0 |
| `.\scripts\npm.cmd run build`        | main/preload/renderer 全部产出；退出码 0    |

10 个条件跳过均为 Task 1–10 已记录的真实 symlink/junction 权限条件：read-text 2、read-docx 2、TXT search 1、mixed search 1、resolve 1、relocate 1、trash 1、reveal 1；拒绝分支由 mock 确定覆盖。无新增跳过。三条 stderr 是既有保存/新建失败注入对临时清理失败的预期记录。

## 9. Windows 开发/生产冒烟

| 模式                                        | 实际记录                                                                                                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 开发模式 `.\scripts\dev.cmd`                | main 154.95 kB、preload 4.10 kB 构建成功；renderer `http://localhost:5173/` ready；`start electron app...`；4 个 Electron 进程存活 ≥10 s；无 error/Uncaught；Ctrl+C 后残留 0                                               |
| 生产 `.\scripts\npm.cmd exec -- electron .` | 4 个 Electron 进程存活 ≥10 s；终端无 error/Uncaught；Ctrl+C 后残留 0                                                                                                                                                       |
| 截图辅助进程                                | 在受限 sandbox 内 GPU 子进程不可用，按批准在 sandbox 外运行；BrowserWindow 仍使用 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`，renderer 由 loopback-only 临时 HTTP server 提供；全部 capture 退出码 0 |

启动冒烟与真实截图证明最终 main/preload/renderer 可加载；不替代工作区文件操作、Office 外部占用和物理显示设置的人工 GUI 清单。

## 10. 已知限制与后续建议

1. Windows 物理 100%/125%/150% DPI 与 200% 系统文本缩放需要切换会话级系统设置；当前自动化会话不擅自修改，项目所有者需按 TESTING 3.9 确认。
2. 自动截图覆盖空工作区、搜索空态与关于；包含真实长树、dirty/saving/conflict、read-only/degraded、DOCX 大量结果的截图需使用隐私安全的人工夹具补录。
3. HTML5 drag 只支持文枢树内移动；Windows 资源管理器拖入/拖出、复制、覆盖、跨工作区/跨盘仍明确不支持。
4. DOCX 画布是连续阅读列，不是分页/打印预览；复杂 Word 内容范围不变。
5. 建议后续任务：文件系统监听与外部变化提示；基础设置/主题/会话恢复；安装包与签名。

## 11. 是否满足 Task 11 全部验收标准

- 产品代码、协议安全、自动测试、构建、固定尺寸真实 Electron 截图与启动冒烟均已完成，可确认“实现与自动验收标准满足”。
- Task 11 明确列为“必须人工核对”的 Windows 物理 DPI/文本缩放、真实长树和完整状态矩阵尚需项目所有者在实际显示设备上确认；在得到该证据前，不把 Task 11 描述为全部人工验收完成。

**当前结论：代码与自动验收完成；Task 11 全部（含物理显示环境人工终验）尚未完全满足。**
