# TASK-002：工作区目录选择与只读文件树

简体中文 | [English](./TASK_002_WORKSPACE_READONLY.en.md)

[任务档案](../README.md) · [文档中心](../../README.md)

## 任务状态

- 状态：`已完成`
- 优先级：`P0`
- 类型：`产品纵向切片 / 本地文件系统 / IPC / React 界面`
- 前置任务：[TASK-001：建立可运行、可测试的桌面应用工程骨架](../task-001/TASK_001_PROJECT_BOOTSTRAP.md)
- 后续直接任务：[TASK-003：UTF-8 TXT 受控读取与单只读标签页](../task-003/TASK_003_TXT_READONLY.md)
- 项目基线：[PROJECT_BASELINE.md](../../architecture/PROJECT_BASELINE.md)
- 主要执行方式：低价模型分工作包顺序实施，逐包验收

## 一、任务目的

Task 1 已建立 Electron、preload、React、TypeScript、构建和测试基线，但当前应用还不能访问真实工作区。

本任务实现第一个产品纵向切片：用户通过系统目录选择器选择一个本地文件夹，主进程安全读取目录结构，渲染进程在左侧栏展示可展开和折叠的只读文件树。

该切片必须贯通以下链路：

```text
React 操作
  -> 受限 preload API
  -> 固定 IPC 通道
  -> Electron 主进程
  -> 系统目录选择器与 Node.js 文件系统
  -> 可序列化的工作区快照
  -> React 文件树
```

本任务只建立“选择工作区并浏览目录结构”的能力，不打开文件内容，也不执行任何写入操作。

## 二、完成后的用户体验

任务完成后，用户应能：

1. 在尚未打开工作区时看到明确的“打开文件夹”入口；
2. 点击入口后使用 Electron 原生目录选择器选择一个文件夹；
3. 取消目录选择时继续留在原状态，不出现错误提示；
4. 选择成功后在左侧栏看到工作区名称、路径和只读文件树；
5. 展开或折叠任意已成功读取的目录；
6. 看到空目录、符号链接和局部读取失败的明确状态；
7. 手动刷新当前工作区目录结构；
8. 再次选择其他文件夹，并用新工作区替换旧工作区；
9. 在读取失败后继续使用应用或重新选择工作区。

点击文件在本任务中不得读取内容或打开编辑器。

## 三、执行前置检查

执行智能体开始修改前必须完成以下检查：

1. 确认 Task 1 的源码和文档均存在；
2. 确认当前开发分支基于已包含 Task 1 的提交，而不是仅包含初始文档的旧 `main`；
3. 确认 `git status --short` 中没有不属于本任务的未提交修改；
4. 执行以下基线命令并记录结果：

```powershell
.\scripts\npm.cmd run check
.\scripts\npm.cmd run build
```

若基线命令失败，应先说明既有失败，不得通过删除测试、放宽类型检查或关闭 lint 规则继续开发。

## 四、固定设计决策

为降低低价模型实现时的歧义，本任务固定采用以下设计。

### 4.1 一次性工作区快照

- 用户选择目录后，主进程异步递归读取完整目录树；
- 读取结果以可序列化快照一次性返回渲染进程；
- 展开和折叠只改变 React 本地界面状态，不再次访问文件系统；
- 点击“刷新”时由主进程重新扫描当前工作区并返回新快照；
- 不在本任务中实现懒加载、虚拟列表、后台索引或文件监听。

项目初期建议范围为 1000 个文件以内，一次性快照足以支撑本任务。若实测出现明确性能问题，应记录数据后再提出设计调整，不得提前扩展架构。

### 4.2 主进程持有当前工作区

- 当前工作区根路径由主进程保存；
- `open` 操作只能使用原生目录选择器返回的路径；
- `refresh` 操作只能刷新主进程已保存的当前根路径；
- 渲染进程不得向主进程传入任意绝对路径；
- 当前应用只有单窗口，本任务不设计多窗口工作区状态。

该设计避免向渲染进程提供通用路径读取能力，也避免在本任务中引入复杂的路径授权系统。

### 4.3 只读边界

本任务允许的文件系统行为只有：

- 打开系统目录选择器；
- 获取所选目录的基本信息；
- 读取目录项；
- 判断目录项类型；
- 为界面生成可序列化树结构。

不得读取文件正文，不得创建、修改、移动、重命名或删除任何用户文件。

## 五、共享数据契约

跨进程类型应放在 `src/shared/`，只能包含纯 TypeScript 数据结构和常量，不得依赖 Electron、Node.js、React 或浏览器运行时。

推荐采用以下语义等价契约。名称可以做小幅调整，但不得改变安全边界或结果状态。

```ts
export type WorkspaceEntryKind = 'directory' | 'file' | 'symbolic-link' | 'other';

export interface WorkspaceEntryError {
  readonly code?: string;
  readonly message: string;
}

export interface WorkspaceEntry {
  readonly name: string;
  readonly relativePath: string;
  readonly kind: WorkspaceEntryKind;
  readonly children?: readonly WorkspaceEntry[];
  readonly error?: WorkspaceEntryError;
}

export interface WorkspaceSnapshot {
  readonly rootName: string;
  readonly rootPath: string;
  readonly entries: readonly WorkspaceEntry[];
}

export type OpenWorkspaceResult =
  | { readonly status: 'selected'; readonly workspace: WorkspaceSnapshot }
  | { readonly status: 'cancelled' }
  | { readonly status: 'error'; readonly error: WorkspaceEntryError };

export type RefreshWorkspaceResult =
  | { readonly status: 'refreshed'; readonly workspace: WorkspaceSnapshot }
  | { readonly status: 'not-open' }
  | { readonly status: 'error'; readonly error: WorkspaceEntryError };
```

契约要求：

- 所有跨进程值必须可由 Electron structured clone 安全复制；
- 不传递 `Error`、`Dirent`、`Stats`、函数、类实例或 Node.js 对象；
- `relativePath` 相对于工作区根目录，不使用它触发新的文件系统读取；
- 根目录读取失败返回顶层 `error`；
- 子目录读取失败保留对应目录节点，在节点上设置 `error`，不得让整个扫描失败；
- 成功读取的空目录使用空 `children` 表达；
- 文件、符号链接和其他类型不应具有 `children`。

## 六、主进程实现要求

### 6.1 目录扫描器

目录扫描逻辑应从 `src/main/index.ts` 中分离，放入职责明确的工作区模块。推荐结构：

```text
src/main/
├─ index.ts
└─ workspace/
   ├─ scan-workspace.ts
   └─ workspace-ipc.ts
```

扫描器必须：

- 使用 `node:fs/promises` 的异步 API；
- 使用 `readdir(..., { withFileTypes: true })` 或语义等价方式；
- 递归读取普通目录；
- 不跟随符号链接和 Windows junction；
- 将符号链接作为可见叶节点返回；
- 将未知类型作为 `other` 叶节点返回；
- 对每层目录进行稳定排序：目录在前，其余条目在后，同类按名称自然排序；
- 使用相对路径作为节点标识基础；
- 捕获并转换文件系统错误，不向 IPC 返回原始异常；
- 保证单个子目录读取失败不会丢失同级其他条目；
- 不读取文件内容，不调用写入类 API。

不得为了测试扫描器而建立通用依赖注入容器。若需要隔离少量文件系统调用，应使用简单函数参数、轻量适配器或 Vitest mock。

### 6.2 目录选择

目录选择必须在主进程中使用 Electron `dialog.showOpenDialog`，并至少启用：

```ts
properties: ['openDirectory'];
```

要求：

- 尽量将当前 BrowserWindow 作为父窗口；
- 只接受一个目录；
- 用户取消时返回 `cancelled`，不得抛出异常或清空已有工作区；
- 选择并扫描成功后才更新主进程中的当前工作区根路径；
- 新工作区扫描失败时保留原工作区，除非界面明确选择清空；本任务默认保留；
- 不记录最近工作区，不在启动时自动恢复。

### 6.3 IPC 注册

只允许注册本任务所需的固定通道，例如：

- `workspace:open`
- `workspace:refresh`

要求：

- 使用 `ipcMain.handle` 提供请求/响应语义；
- 处理器不接受渲染进程传入的路径参数；
- 注册逻辑与窗口创建逻辑保持清晰边界；
- 避免重复注册同一处理器；
- 捕获意外错误并转换为共享错误结构；
- 不建立通用文件系统路由、任意通道代理或命令分发器。

## 七、preload 与渲染进程边界

### 7.1 preload API

在现有 `DesktopApi` 中新增窄接口，推荐语义：

```ts
interface DesktopApi {
  readonly runtime: DesktopRuntimeInfo;
  readonly workspace: {
    readonly open: () => Promise<OpenWorkspaceResult>;
    readonly refresh: () => Promise<RefreshWorkspaceResult>;
  };
}
```

preload 只允许：

- 为上述两个方法调用固定 IPC 通道；
- 暴露冻结或只读形态的 API；
- 依赖共享类型以保证主进程、preload 和渲染进程契约一致。

preload 不得暴露：

- `ipcRenderer` 对象；
- `invoke(channel, ...args)` 形式的通用方法；
- 任意文件读取方法；
- Node.js `fs`、`path`、`process` 或 Electron 对象；
- 可由渲染进程指定绝对路径的接口。

### 7.2 React 状态

本任务使用 React 自带状态能力即可，不引入 Zustand。

界面至少需要表达：

- 未打开工作区；
- 正在选择或扫描；
- 已打开工作区；
- 工作区为空；
- 顶层扫描错误；
- 子目录局部读取错误；
- 正在刷新。

加载期间应禁用会发起重复请求的按钮。所有异步调用都必须处理成功、取消和失败结果，避免未处理的 Promise rejection。

### 7.3 文件树组件

推荐将现有占位侧栏拆分为小型组件，例如：

```text
src/renderer/components/workspace/
├─ WorkspaceSidebar.tsx
├─ FileTree.tsx
└─ FileTreeNode.tsx
```

组件要求：

- 根工作区信息与树节点分离显示；
- 目录节点可通过按钮或等价可访问控件展开和折叠；
- 文件节点在本任务中只显示名称和类型，不读取内容；
- 符号链接和其他类型具有可辨识但不过度设计的显示；
- 子目录错误显示在对应节点附近；
- 使用稳定 key，优先采用 `relativePath`；
- 递归组件只负责展示已有快照，不调用桌面 API；
- 保持中央编辑区为界面视觉主体；
- 不进行正式图标系统、主题系统或大规模 CSS 重构。

## 八、测试要求

本任务应继续使用 Vitest。可按需要加入 React Testing Library、`user-event` 和 `jsdom`，但只能添加实际用于本任务测试的最小开发依赖，并必须提交锁文件变化。

### 8.1 扫描器测试

至少覆盖：

- 空目录返回空条目列表；
- 嵌套目录生成正确树结构和相对路径；
- 目录排在文件之前；
- 同类名称自然排序稳定；
- 文件不会被当作目录递归；
- 符号链接不会被递归跟随；
- 子目录读取失败被转换为节点错误，并保留其他同级条目；
- 根目录读取失败被转换为顶层错误结果或可识别异常。

Windows 环境创建符号链接可能需要额外权限。不得为了测试申请管理员权限；可以对目录项分类函数使用 mock 或纯逻辑测试。

### 8.2 界面测试

至少覆盖：

- 初始状态显示“打开文件夹”；
- 用户取消选择后保持原状态；
- 成功结果显示根目录和条目；
- 空目录显示空状态；
- 目录可以展开和折叠；
- 顶层错误显示可恢复提示；
- 子目录错误不会阻止其他节点显示；
- 加载状态下重复操作入口被禁用；
- 刷新成功后替换旧快照。

测试应验证用户可见行为，不要大面积断言组件内部实现或 CSS 类名。

### 8.3 手工桌面冒烟验证

自动测试不能代替 Electron 桌面链路验证。完成实现后至少手工验证：

1. 启动开发环境；
2. 打开一个包含多层目录和文件的测试文件夹；
3. 展开和折叠多层目录；
4. 打开空文件夹；
5. 取消一次目录选择；
6. 从一个工作区切换到另一个工作区；
7. 在外部添加或删除文件后点击刷新并看到变化；
8. 确认点击普通文件不会读取正文或打开编辑器；
9. 确认开发者控制台没有未处理异常。

## 九、明确不在本任务范围内

- 读取或显示 TXT、DOCX 及其他文件正文；
- 编辑器、标签页、未保存状态和保存；
- 文件创建、另存为、重命名、移动或删除；
- 文件系统监听和自动刷新；
- 最近工作区、启动恢复和 `electron-store`；
- 搜索、过滤、收藏和文档大纲；
- CodeMirror、Tiptap、Mammoth、docx、JSZip；
- Zustand 或其他全局状态库；
- 右键菜单、拖放和键盘导航体系；
- 大型目录虚拟滚动和懒加载；
- Windows 安装包、自动更新和发布流程；
- Playwright/Electron 端到端测试设施；
- AI、Agent、云服务和账号系统；
- 通用文件系统 API、通用 IPC 或插件系统。

若某项能力不属于第五至第八节，即使实现方便也不得顺手加入。

## 十、工作包与执行顺序

低价模型必须按以下工作包顺序实施。每次只领取一个工作包；当前工作包验收失败时不得进入下一包。

### WP0：基线确认和任务落点

- 确认分支包含 Task 1；
- 运行既有 `check` 和 `build`；
- 阅读本任务、项目基线和 Task 1 完成报告；
- 列出计划修改的文件；
- 不修改产品代码。

验收门禁：基线结果已记录，任务范围没有歧义。

### WP1：共享契约与目录扫描器

- 新增工作区共享类型；
- 实现异步递归扫描；
- 实现目录优先和名称排序；
- 实现符号链接、未知类型和局部错误规则；
- 添加扫描器测试。

验收门禁：扫描器测试、完整 `check` 和 `build` 通过；不包含 Electron IPC 或 React 界面修改。

### WP2：目录选择、主进程状态与 IPC

- 实现原生目录选择；
- 保存当前成功打开的工作区根路径；
- 注册固定 `open` 和 `refresh` IPC；
- 处理取消、顶层错误和刷新无工作区状态；
- 保持现有窗口安全策略。

验收门禁：处理器不接受路径输入；没有通用 IPC；完整 `check` 和 `build` 通过。

### WP3：preload 窄接口

- 扩展 `DesktopApi`；
- 在 preload 中映射两个固定 IPC 通道；
- 更新渲染端全局类型；
- 必要时添加轻量契约测试。

验收门禁：渲染进程只能调用 `workspace.open()` 和 `workspace.refresh()`；完整 `check` 和 `build` 通过。

### WP4：工作区侧栏与文件树

- 替换左侧栏占位状态；
- 实现打开、刷新、切换工作区；
- 实现加载、空、成功和错误状态；
- 实现树节点展开和折叠；
- 添加用户可见行为测试。

验收门禁：组件测试、完整 `check` 和 `build` 通过；未读取文件正文，未引入全局状态库。

### WP5：整体验收与文档

- 执行完整自动检查；
- 完成桌面冒烟验证；
- 更新 README 中与实际用户操作有关的说明；
- 编写 `docs/tasks/task-002/TASK_002_COMPLETION_REPORT.md`；
- 记录依赖变化、验证结果、已知限制和后续任务入口。

验收门禁：第十一节所有验收项均满足后才能标记任务完成。

## 十一、最终验收标准

只有以下条件全部满足，Task 2 才可标记为完成。

### 11.1 功能验收

- [x] 未打开工作区时存在明确的“打开文件夹”入口；
- [x] 点击入口会打开原生目录选择器；
- [x] 取消选择不报错、不清空已有工作区；
- [x] 成功选择后显示工作区名称、路径和目录树；
- [x] 多层目录可展开和折叠；
- [x] 空目录具有明确状态；
- [x] 目录优先于其他条目，名称排序稳定；
- [x] 符号链接可见但不会被递归跟随；
- [x] 子目录读取错误显示在对应节点且不影响其他条目；
- [x] 顶层读取错误不会导致应用崩溃；
- [x] 刷新会重新扫描当前工作区；
- [x] 再次选择文件夹会替换为新工作区；
- [x] 点击文件不会读取正文或打开编辑器。

### 11.2 安全验收

- [x] `nodeIntegration: false`、`contextIsolation: true` 和 `sandbox: true` 保持不变；
- [x] 渲染进程没有直接导入 Node.js 或 Electron 文件系统能力；
- [x] preload 未暴露 `ipcRenderer` 或通用 `invoke`；
- [x] IPC 处理器不接受渲染进程传入的绝对路径；
- [x] 只有固定的工作区打开和刷新能力进入渲染进程；
- [x] 跨进程结果不包含原始 `Error` 或 Node.js 对象；
- [x] 不存在任何用户文件写入操作。

### 11.3 质量验收

- [x] 新增扫描器测试覆盖第 8.1 节关键分支；
- [x] 新增界面测试覆盖第 8.2 节关键状态；
- [x] `.\scripts\npm.cmd run typecheck` 成功；
- [x] `.\scripts\npm.cmd run lint` 成功且 0 warning；
- [x] `.\scripts\npm.cmd run format:check` 成功；
- [x] `.\scripts\npm.cmd test` 成功；
- [x] `.\scripts\npm.cmd run check` 成功；
- [x] `.\scripts\npm.cmd run build` 成功；
- [x] Electron 开发窗口完成手工冒烟验证；
- [x] README 与实际操作一致；
- [x] 完成报告准确记录验证结果和已知限制。

## 十二、失败处理与决策规则

- 若读取某个子目录失败，保留该节点及错误信息，继续处理其他条目；
- 若根目录扫描失败，返回可恢复错误，不更新当前工作区；
- 若用户取消目录选择，返回正常取消状态，不记录日志为错误；
- 若目录在扫描过程中被外部删除，按读取错误处理，不崩溃、不重试循环；
- 若遇到符号链接或 junction，不跟随目标；
- 若测试需要管理员权限，改用 mock 或纯逻辑测试，不提高运行权限；
- 若新增依赖出现冲突，选择稳定兼容版本，不使用 `--force`；
- 若实现需要改变项目安全基线、一次性快照方案或任务范围，应停止相关实现，说明收益、风险、复杂度和迁移成本，等待项目所有者决定；
- 不得删除有效测试、关闭严格类型检查、降低 Electron 安全设置或忽略 lint 规则来制造通过结果。

## 十三、低价模型执行提示模板

每个工作包建议使用以下固定提示，只替换工作包编号和内容：

> 阅读 `docs/architecture/PROJECT_BASELINE.md`、`docs/tasks/task-001/TASK_001_COMPLETION_REPORT.md`、`docs/tasks/task-002/TASK_002_WORKSPACE_READONLY.md` 以及与当前工作包直接相关的源码。只实现 TASK-002 的 WPx，不实现后续工作包，不进行无关重构，不添加任务范围外功能。严格保持 Electron 安全边界，不暴露通用 IPC、任意路径读取或文件写入能力。修改后运行本工作包要求的测试、`.\scripts\npm.cmd run check` 和 `.\scripts\npm.cmd run build`。最终报告修改文件、关键决策、命令结果、未解决问题和是否满足当前工作包门禁。

执行规则：

- 一次对话只完成一个工作包；
- 提示中直接粘贴当前工作包的范围和门禁；
- 不让模型自行重新规划整个阶段；
- 每包结束后先审查 diff，再进入下一包；
- WP2 和 WP3 完成后重点复核 IPC 参数、错误序列化和 preload 暴露面；
- 只有 WP5 可以撰写完成报告并将任务状态改为 `已完成`。

## 十四、交付物

执行智能体最终应交付：

1. 工作区共享数据契约；
2. 主进程异步只读目录扫描器；
3. 原生目录选择和固定 IPC 处理器；
4. 受控 preload 工作区 API；
5. React 工作区侧栏和可展开文件树；
6. 扫描器与界面行为测试；
7. 更新后的 README；
8. `TASK_002_COMPLETION_REPORT.md`，至少包含：
   - 实现摘要；
   - 新增和修改的关键文件；
   - 数据契约与安全边界；
   - 新增依赖及选择原因；
   - 实际执行的自动检查和结果；
   - 桌面冒烟验证记录；
   - 已知限制；
   - 是否满足全部验收标准。

## 十五、完成后的下一任务入口

Task 2 完成后，下一任务为 [TASK-003：UTF-8 TXT 受控读取与单只读标签页](../task-003/TASK_003_TXT_READONLY.md)：从只读文件树选择一个 UTF-8 TXT 文件，通过新的受控 IPC 读取正文，并在中央区域的单个只读标签页中显示。

下一任务仍不应立即加入编辑保存、多标签页、文件监听或 DOCX。先验证“文件树选择 -> 受控文件读取 -> 中央区域显示”的安全链路，再逐步加入 TXT 编辑和安全保存。
