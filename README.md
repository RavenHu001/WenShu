# 文枢（WenShu）

文枢是一款面向个人创作、设定整理和资料维护的本地多文档桌面工作台。它以普通文件夹作为工作区，采用类似代码编辑器的文件树、多标签页和中央编辑区域，目标是让一组相关文档能够被集中管理、搜索与编辑。

> **当前阶段：Pre-alpha / Task 11 已完成。** Task 1 至 Task 10 的工作区、TXT/DOCX 编辑、安全保存、搜索、查找替换与文件管理语义全部保留。Task 11 已把工程原型界面重构为单一中文应用菜单、SVG 活动栏、可调整/折叠侧栏、可访问文件树上下文菜单、键盘等价入口与同工作区内部拖拽移动；移除了侧栏底部按钮墙。DOCX 现在使用居中有限宽的连续写作画布和分组/溢出工具栏，工作区搜索与当前查找共享控件语言，成功操作通过限时 toast 反馈，错误与部分完成状态持续可追溯。renderer 仍只调用既有窄 controller/IPC，稳定 `tabId`、`mutationEpoch`、saving/dirty/conflict、DOCX 伴随备份和回收站删除语义不变。自动保存、文件系统监听、会话恢复、工作区替换与正则/模糊搜索仍未提供。代码实现、自动质量门禁与 Windows 物理 100%/125%/150% 显示缩放等最终人工验收均已通过，证据见 [Task 11 完成报告](./docs/TASK_011_COMPLETION_REPORT.md)。

## 当前能力

### 可以体验

- 启动 Windows Electron 桌面窗口；
- 点击左侧"打开文件夹"按钮，通过原生对话框选择本地工作区；
- 浏览工作区目录树，展开/折叠多层文件夹；
- 手动刷新工作区以反映外部文件变化；
- 切换工作区或取消选择而不丢失当前状态；
- 查看子目录错误提示而不影响其他节点显示；
- 点击（或通过键盘激活）文件树中的 `.txt` 文件，在中央区域以标签页打开并编辑其 UTF-8 正文；连续选择多个 TXT 会依次生成多个标签，重复选择已打开文件只激活原标签；
- 点击（或通过键盘激活）文件树中的普通 `.docx` 文件，以唯一标签打开；加载期间显示明确状态，读取完成后在 Tiptap/ProseMirror 富文本编辑器中展示段落、标题 1-3、粗体、斜体、下划线、基础字号、文字颜色、项目符号/编号列表与基础对齐；
- TXT 与 DOCX 可以混合打开；每个标签的正文/模型、选择、滚动、撤销历史、dirty、保存与错误状态独立，切换保留各自会话；同一路径只能存在一个标签；
- 点击标签在多个文档之间切换，切换保留各标签的光标、选区、滚动位置与撤销/重做历史；同名不同路径的文件可同时打开，标签可显示完整相对路径提示；
- 输入、删除、复制、粘贴、撤销和重做；空文件可正常输入；
- 通过保存按钮或 `Ctrl+S` 显式保存当前活动标签；标签显示未保存标记（●），工具条显示已保存/未保存/正在保存/保存失败/外部冲突；
- 不同标签可以并行保存；同一标签不会产生并发保存；保存期间继续编辑不会丢失后续修改；保存失败保留全部编辑内容；
- 文件被其他程序修改后保存会显示外部冲突，本地内容保留，确认后才重新读取磁盘版本；
- DOCX 重新读取会比较完整结构化模型，外部程序只修改格式而不修改文字时也会同步更新；
- DOCX 支持基础格式工具栏（粗体/斜体/下划线、段落/标题、字号白名单、文字颜色、列表、对齐、撤销/重做）；`Ctrl+S` 与保存按钮走同一 DOCX 保存流程；
- Windows/WPS 创建的 0 字节 `.docx` 占位文件按空白文档打开，首次保存时物化为有效 OOXML；只有明确启用编辑保护的 DOCX 才进入只读状态，WPS 写入的 `w:enforcement="0"` 不会被误判；
- DOCX 保存前在同目录生成滚动备份 `<文件名>.wenshu.bak`（内容为保存前原文件）；保存成功后状态栏显示备份文件名；备份持续保留但不在工作区文件树显示；备份失败或产物验证失败时目标文件不变；
- 含图片/表格/页眉页脚/批注/修订/超链接等不受支持内容的文档显示确定兼容性警告：`degraded` 需在编辑或保存前确认（确认绑定 revision），`read-only` 文档只读展示、不可编辑保存；
- 损坏、加密、伪装、超 20 MiB 或超出资源预算的 DOCX 显示稳定错误，不显示部分可编辑内容；
- BOM 与一致 LF/CRLF 换行风格在 TXT 保存后保留；混合换行保存前需要明确确认规范化；
- 关闭未保存标签前会得到"放弃修改/取消"确认，`Ctrl+W` 与关闭按钮走同一流程；有未保存修改时切换工作区或关闭窗口会显示包含未保存标签数量的聚合确认；
- 正在保存的标签不会被关闭标签、切换工作区或关闭窗口等操作丢弃，会提示等待保存完成；
- 读取期间显示加载状态；读取失败、文件过大或编码非法时显示可恢复的错误提示，且不影响其他标签；
- 通过受控 preload API 在状态栏读取平台和 Electron 版本信息；
- 在活动 TXT 标签中按 `Ctrl+F` 打开查找面板、`Ctrl+H` 打开替换面板：普通文字查询、大小写选项、上一个/下一个、替换当前项与全部替换；替换进入撤销历史并正常产生 dirty 与显式保存；查找不修改正文、不制造 dirty；查找面板、查询、选区与历史按标签隔离；
- 在活动 DOCX 标签中按 `Ctrl+F` / `Ctrl+H` 打开与 TXT 共用的“查找与替换”面板：在实时未保存的 ProseMirror 正文中即时搜索（段落、标题、跨 marks run、列表、中文、emoji），普通/当前匹配双 class 高亮，上一个/下一个循环导航、计数与“匹配超过 2000 处”截断提示；查找、导航与关闭面板不修改正文、不 dirty、不进撤销历史，关闭后恢复编辑器焦点；
- 对可编辑 DOCX 替换当前项或全部替换：执行瞬间重新扫描并复验实时范围，非空替换继承匹配起点字符的格式（跨不同 marks run 时只取起点 marks），全部替换最多 2000 项、从文档末到开头写入同一 transaction、一次撤销/重做完整恢复，dispatch 前对候选模型做结构与序列化预算验证（任一失败 0 dispatch、0 dirty）；替换进入 dirty 与既有保存流程（revision 冲突、滚动备份与安全替换不变），不自动保存；
- DOCX 兼容性生命周期：read-only 可查找不可替换；degraded 未确认可查找不可替换，确认绑定当前 revision 后可替换（确认不重建编辑器），重新读取不同 revision 后旧确认失效；saving 期间替换不会被旧保存完成清除；save-error / conflict / 带快照 read-error 行为确定；
- 多 TXT/DOCX 标签的查询、选项、当前匹配、装饰与编辑历史按稳定 tabId 隔离；关闭标签后重开是新会话；重命名、移动、另存为后当前查找会话随稳定 tabId 保持（不重建编辑器）；工作区结果定位与 mutationEpoch 变化不污染当前查找状态；
- 点击活动栏"搜索"或按 `Ctrl+Shift+F` 打开工作区搜索侧栏：一次查询同时搜索当前工作区磁盘上已保存的普通 UTF-8 TXT 与基础 DOCX 规范正文（大小写可切换、可取消、可连续提交新查询）；TXT 语义与 Task 6 完全一致，DOCX 只搜索 Task 7 结构化模型投影的正文（段落、标题、跨 run 文字、列表；图片/表格/页眉页脚/批注等未进入模型的内容不在搜索承诺内）；展示按文件分组的结果（相对路径、TXT/DOCX 类型标识、1-based 行列、安全片段）与扫描/命中/匹配/跳过统计和截断提示（含 DOCX 候选上限截断），DOCX 行列基于提取正文而非 Word 页面坐标；无工作区时显示空状态且不发起搜索；
- 点击 TXT 或 DOCX 搜索结果打开或激活唯一标签：TXT 复用 CodeMirror 安全定位；DOCX 经 kind、revision、规范投影范围与匹配文本双重校验后，用 ProseMirror 公开 API 设置选区、滚动并聚焦（read-only 可定位不可编辑、degraded 定位不自动确认、dirty 但原范围未变时可定位）；revision、范围、正文结构或宿主二次校验任一失效时只显示"搜索结果已过期"提示，不错误定位、不修改正文；
- 切换文件/搜索活动栏不丢失工作区、已打开标签或文件树展开状态；工作区成功切换清空旧搜索结果；
- 在工作区根或选中文件夹内新建 TXT、基础 DOCX 与文件夹（名称自动补全应有扩展名，如输入 `会议纪要` 新建 TXT 得到 `会议纪要.txt`）；新建 TXT/DOCX 成功后自动打开为唯一干净标签，新建文件夹保持选中；
- 对当前可写 TXT/DOCX 执行"另存为"：选择工作区内目标文件夹并输入文件名；目标不存在时安全创建，目标存在时先显示明确覆盖确认，确认仍绑定同一目标版本时才覆盖；成功后当前标签迁移到新路径并保持编辑器会话，源文件留在原位置；
- 重命名或移动工作区内普通文件与文件夹（含 Windows 只改大小写重命名），不能移动到自身或后代；重命名 TXT/DOCX 自动保留原扩展名（`报告.txt` 改名 `总结` 得到 `总结.txt`），不允许改扩展名当格式转换；已打开文档的标签顺序、活动状态、dirty、正文/模型、光标、选区、滚动、撤销历史和查找状态全部保留，目录重命名/移动一次迁移其下全部已打开标签；
- 删除文件或文件夹到 Windows 回收站（可恢复），删除前确认包含路径、类型与受影响未保存标签数量；存在正在保存的标签时先等待；删除成功关闭受影响标签；
- 对文件、目录或工作区根执行"在资源管理器中显示"；
- 任一成功新建/另存为/重命名/移动/删除后工作区自动刷新，旧搜索结果立即失效（取消活动搜索、清空结果与定位），不会继续点击到已不存在的路径；失败、取消与"在资源管理器中显示"不误使有效结果失效。
- 顶部只保留 renderer 内的一套中文应用菜单；文件、编辑、视图与帮助菜单中的命令均为真实入口，运行时版本信息移入“关于文枢”；
- 活动栏、文件树、标签、工具栏和状态反馈使用项目内 SVG 图标；未实现的设置入口不再伪装成可用功能；
- 工作区侧栏可在 180–420 px 间拖动或键盘调整，可折叠并通过活动栏/视图菜单恢复；长路径、深层目录与超长文件名可滚动并保留完整 tooltip；
- 文件树右键、`Shift+F10`/菜单键支持根、文件、文件夹三类菜单；`F2` 重命名、`Delete` 删除确认、`F5` 刷新、`Ctrl+Shift+S` 另存为均复用既有门禁；
- 文件和文件夹可拖到同工作区普通目录或根投放区，no-op、自身/后代、同名、saving、非法类型和过期工作区在提交前拒绝，主进程仍作最终裁决；
- DOCX 使用居中 820 px 上限的连续写作画布（不承诺分页），工具栏按历史、字符、段落、列表与对齐分组，窄宽度进入“更多格式”溢出；TXT 保持全高纯文本布局；
- 成功文件操作显示限时可关闭 toast；错误、冲突与 partial failure 不自动消失；高对比度与减少动画具有 CSS 适配入口。

### 工程能力

- Electron、React、TypeScript 与 Vite 开发和生产构建链路；
- 相互隔离的主进程、preload 和渲染进程类型环境；
- `nodeIntegration: false`、`contextIsolation: true` 和 sandbox 安全基线；
- 受控 IPC 通道：`workspace.open()` / `workspace.refresh()`、`workspace.createText()` / `createDocx()` / `createDirectory()` / `relocate()` / `trash()` / `reveal()`、`document.readText()` / `saveText()`、`document.readDocx()` / `saveDocx()`、`document.saveTextAs()` / `saveDocxAs()`、`search.textWorkspace()` / `cancelTextWorkspace()` 与窗口关闭协调窄协议；所有请求精确形状校验（拒绝多余字段、根/绝对路径与 force/overwrite 等危险开关）；
- 文件管理安全服务（TASK-009）：源/目标逐段校验（不跟随 symlink/junction、realpath 边界）、按窗口串行写操作队列、排他临时文件 + 发布前复验不覆盖发布、Windows case-only 两步重命名与回滚、DOCX 伴随 `.wenshu.bak` 迁移、删除统一走可注入 `shell.trashItem`（严禁永久删除降级）、另存为两阶段覆盖确认（`expectedTargetRevision` CAS）；
- 稳定 tabId 与可变 relativePath 解耦的多标签模型：单文件/目录段边界路径迁移、save-as 完成与批量关闭纯状态转移，编辑器会话（CodeMirror/Tiptap 实例、选区、滚动、撤销历史）在路径变化时保持；
- mutationEpoch 搜索失效（TASK-009 §4.11）：成功 create/save-as/relocate/trash 递增并取消活动搜索、清空 completed/cancelled/error 结果与定位；失败、取消、reveal 与刷新失败不递增；迟到搜索结果同时校验 requestId + workspaceEpoch + mutationEpoch；
- DOCX 通过项目自有、有版本、有预算上限的结构化中间模型（`src/shared/docx.ts`）导入、编辑与导出；Tiptap/ProseMirror 实例只存在于 renderer 编辑会话层，不跨 IPC；
- CodeMirror 6 纯文本编辑器（TXT）与 Tiptap/ProseMirror 富文本编辑器（DOCX），按标签隔离会话缓存；
- 主进程对 TXT 读取与保存执行完整校验：相对路径格式、工作区边界、逐段符号链接 / junction、真实路径、普通文件类型、5 MiB 大小上限与严格 UTF-8；
- 主进程对 DOCX 执行同等的路径/链接/真实路径校验与 20 MiB 上限，并把 DOCX 作为不可信 ZIP 处理：条目数/解压大小/关键 XML/模型节点数等固定资源预算、关键部件检查、有限属性补充读取（颜色/页眉页脚/修订/保护/嵌入对象）、Mammoth 语义导入；
- TXT 保存执行内容版本（SHA-256）冲突检测，采用同目录排他临时文件、完整写入、刷盘、关闭与 `rename` 安全替换；
- DOCX 保存执行原始字节 revision 冲突检测、同目录滚动备份 `<文件名>.wenshu.bak`、产物生成与重新导入验证、排他临时写入、刷盘、关闭与安全替换；`degraded` 未确认、`read-only` 与非法模型拒绝保存；
- 主进程工作区混合搜索（TXT + DOCX）：根路径只来自主进程工作区会话，不跟随符号链接；TXT 复用受控读取，DOCX 复用受控 `readDocxDocument` 与规范正文投影；总候选 1000（其中 DOCX 200）、单文件 200、总匹配 2000 上限，总并发 4（其中 DOCX 并发 2），协作式取消与单文件错误隔离；搜索只读，不写工作区、不建立索引或缓存；
- DOCX 规范正文投影（`src/shared/docx-search-text.ts`）：按文档顺序深度优先收集文本块、相邻块间恰一个人工 `\n` 的纯函数投影，UTF-16 偏移与 ProseMirror 文本位置一致，主进程搜索与 renderer 定位双重校验共用同一规则；
- 多标签纯状态模型与不变量校验（标签唯一性、活动标签引用、保存在途一致性、异步结果三重有效性）；TXT/DOCX 判别联合标签状态；
- 搜索与定位异步协议：requestId + 工作区 epoch + 相对路径 + kind + revision + locateId 绑定，App 实时投影校验与 DOCX 宿主同规则投影二次校验，迟到结果/迟到回报安全忽略，过期定位只提示；
- DOCX 当前查找（TASK-010）：项目自有 ProseMirror current-search 插件与每标签 controller（PluginKey + DecorationSet + 微任务单次调度 + generation 丢弃旧计算 + 销毁清理），实时 textblock 投影复用 `joinDocxTextBlocks`（UTF-16 → PM 位置映射），literal + ASCII 大小写折叠、非重叠、2000/2001 匹配预算，替换经公开 transaction API 构建（起点字符 marks 继承、逆序单事务、dispatch 前 `tiptapJsonToDocxModel` + 序列化预算预验证）；每标签窄 controls 绑定稳定 tabId，无新增 IPC/preload/DesktopApi；
- ESLint、Prettier、Vitest 与严格 TypeScript 检查；
- React Testing Library 组件行为测试；
- 项目本地的便携 Node.js/npm 开发工具链。

### 尚未实现

- 深色主题、完整设置系统、可持久主题/字体配置；
- 标签页拖拽排序、固定、批量关闭与状态恢复；
- TXT/DOCX 自动保存与会话恢复；
- 工作区替换、批量替换、正则/模糊/语义搜索与持久全文索引；
- 复杂 Word 格式（图片/表格/页眉页脚/批注/修订编辑、精确分页、宏）与完整无损往返；
- 文件系统监听和自动刷新（外部变化需手动刷新）；
- 文件复制粘贴、批量文件操作与跨工作区/跨盘操作；
- Windows 安装包与正式发布流程。

## 快速开始

### 自动测试（与 CI 一致）

在 Windows 项目根目录依次执行，任一步失败后先修复再继续：

```powershell
npm ci
npx install-electron --no
npm run build
npm run check
npm run test:e2e
```

Electron 二进制文件需要显式准备，`npm ci` 不会完成这一步。`npm test` 和 `npm run check` 只运行普通测试；`npm run test:e2e` 单独运行 Electron 冒烟测试，需要已安装的 Electron 和最新的 `out/` 构建产物。

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

## 使用与验证

开发窗口启动成功后，左侧栏显示"尚未打开文件夹"的空状态。点击"打开文件夹"按钮，通过原生目录选择器选择一个本地文件夹，即可在左侧栏看到工作区名称、路径和可展开的文件树。点击目录名称可展开/折叠子目录，点击"刷新"按钮可重新扫描当前工作区。

在工作区文件树中点击（或用键盘激活）任意 `.txt` 文件，中央区域会先显示加载状态，随后显示以文件名命名的标签页与可编辑正文；连续选择多个 TXT 会生成多个标签，重复选择已打开文件只激活原标签。标签可点击切换，切换保留各自的光标、选区、滚动位置与撤销历史；点击标签上的"×"或按 `Ctrl+W` 关闭标签。编辑后标签显示未保存标记（●），点击"保存"或按 `Ctrl+S` 显式保存当前活动标签；未修改时保存不触发写入。文件缺失、超过 5 MiB 或非 UTF-8 编码时会显示错误提示，且不影响其他标签。文件被其他程序修改后保存会显示外部冲突，本地内容保留，确认后才重新读取磁盘版本；BOM 与一致 LF/CRLF 换行风格保存后保留，混合换行保存前需确认规范化。关闭未保存标签前会得到"放弃修改/取消"确认；有未保存标签时切换工作区或关闭窗口会显示包含未保存标签数量的聚合确认，取消后一切保持不变；正在保存的标签不会被这些操作丢弃，会提示等待保存完成。切换工作区成功后回到未选择文档状态，取消切换或刷新工作区会保留当前标签。关闭窗口或在终端按 `Ctrl+C` 可以结束开发进程。

在活动 TXT 标签中按 `Ctrl+F` 可打开查找面板，输入查询后可用 `F3`/`Shift+F3`（或面板按钮）在匹配之间前后跳转，勾选"区分大小写"可精确匹配；按 `Ctrl+H` 打开面板并聚焦替换输入，可替换当前项或全部替换，替换通过撤销历史恢复并正常进入未保存状态。点击活动栏"搜索"或按 `Ctrl+Shift+F` 打开工作区搜索侧栏：在输入框输入查询并按 Enter（或点击"搜索"）即可一次查询同时搜索当前工作区磁盘上已保存的普通 UTF-8 TXT 与基础 DOCX 规范正文，结果按文件分组显示相对路径、TXT/DOCX 类型标识、行列与片段，并提供扫描/命中/匹配/跳过统计与截断提示；搜索中可点击"取消"中止，输入新查询并提交会取消旧搜索。点击任意 TXT 或 DOCX 匹配结果会打开或激活对应唯一标签：TXT 在结果仍有效时选中匹配、滚动到可视区域并聚焦；DOCX 经 kind、revision、规范投影范围与匹配文本双重校验后用 ProseMirror 公开 API 定位（read-only 可定位不可编辑，degraded 定位不自动确认兼容性）；若文件已被外部修改或正文/结构已变化，则只显示"搜索结果已过期"提示，不会错误定位或修改正文。切换文件/搜索活动栏不会丢失工作区、标签或文件树展开状态。

在活动 DOCX 标签中按 `Ctrl+F` / `Ctrl+H` 打开同一“查找与替换”入口的项目面板：输入查询后即时搜索实时未保存正文并高亮全部匹配（当前匹配双 class 标识），可用 `F3`/`Shift+F3` 或 Enter/Shift+Enter 循环导航，Escape 关闭并恢复编辑器焦点；可编辑文档可替换当前项或全部替换（替换继承匹配起点格式，全部替换为一次可撤销事务，超过 2000 处匹配时全部替换被禁用），替换进入 dirty 并可继续撤销/重做与显式保存；read-only 可查不可替换，degraded 需先确认兼容性（绑定当前 revision），saving 期间替换不会被旧保存完成清除；重命名、移动或另存为后查找会话随稳定标签保持。

点击文件树中的普通 `.docx`，中央区域先显示加载状态，随后以唯一标签打开 Tiptap/ProseMirror 富文本编辑器；Windows/WPS 创建但尚未物化的 0 字节 `.docx` 会作为空白文档打开，首次保存后成为有效 OOXML。使用标签上方的格式工具栏或 `Ctrl+S` 完成基础格式编辑与保存。含图片、表格、页眉页脚、批注或修订等不受支持内容的文档会显示兼容性警告：`degraded` 文档需先点击"确认继续编辑并保存"（确认绑定打开时的 revision）才能编辑与保存；只有 `w:documentProtection` 明确启用的文档才按编辑保护进入 `read-only`，WPS 的 `w:enforcement="0"` 不触发只读。保存前会自动生成同目录滚动备份 `<文件名>.wenshu.bak`，保存成功后状态栏显示备份文件名；保存失败、产物验证失败或备份失败时原文件不被修改。用其他程序（如 Microsoft Word 或 WPS Office）修改已打开的 DOCX 后保存会显示外部冲突，本地编辑保留，确认后才重新读取磁盘版本。损坏、加密、伪装、超过 20 MiB 或超出资源预算的 DOCX 会显示稳定错误。

文件管理（Task 9/11）：在工作区标题区的紧凑“新建”菜单，或工作区根/文件夹右键菜单中创建 TXT、基础 DOCX 与文件夹；TXT/DOCX 名称无扩展名时自动补全。右键文件或文件夹可重命名、移动、删除到回收站或在资源管理器中显示，也可使用 `F2`、`Delete`、`Shift+F10` 和菜单键。文件/文件夹可拖到同一工作区普通目录或根投放区完成移动；不支持复制、覆盖、跨工作区或从 Windows 资源管理器拖入。当前文档另存为位于“文件”菜单并支持 `Ctrl+Shift+S`。所有操作继续使用 Task 9 的安全 controller，成功后刷新文件树、稳定迁移标签并使旧工作区搜索结果失效。

运行全部自动检查：

```powershell
.\scripts\npm.cmd run check
```

验证生产构建：

```powershell
.\scripts\npm.cmd run build
```

完整的自动检查、手动界面验收和生产构建验证步骤见[测试指南](./docs/TESTING.md)。

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

## Roadmap

- [x] Task 1：建立可运行、可测试的桌面应用工程骨架；
- [x] [Task 2：工作区目录选择与只读文件树](./docs/TASK_002_WORKSPACE_READONLY.md)；
- [x] [Task 3：UTF-8 TXT 受控读取与单只读标签页](./docs/TASK_003_TXT_READONLY.md)；
- [x] [Task 4：单 TXT 基础编辑与安全保存](./docs/TASK_004_TXT_EDIT_SAFE_SAVE.md)；
- [x] [Task 5：多 TXT 标签页与独立编辑会话](./docs/TASK_005_MULTI_TXT_TABS.md)；
- [x] [Task 6：工作区 TXT 搜索与当前文件查找替换](./docs/TASK_006_TXT_SEARCH_FIND_REPLACE.md)；
- [x] [Task 7：基础 DOCX 阅读、编辑与安全保存](./docs/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md)（已完成，见 [TASK-007 完成报告](./docs/TASK_007_COMPLETION_REPORT.md)）。
- [x] [Task 8：工作区 DOCX 正文搜索与富文本结果定位](./docs/TASK_008_DOCX_WORKSPACE_SEARCH.md)（已完成，见 [TASK-008 完成报告](./docs/TASK_008_COMPLETION_REPORT.md)）。
- [x] [Task 9：基础文件管理闭环](./docs/TASK_009_BASIC_FILE_MANAGEMENT.md)（已完成，见 [TASK-009 完成报告](./docs/TASK_009_COMPLETION_REPORT.md)）。
- [x] [Task 10：当前 DOCX 内查找与替换](./docs/TASK_010_DOCX_FIND_REPLACE.md)（已完成，见 [TASK-010 完成报告](./docs/TASK_010_COMPLETION_REPORT.md)）。
- [x] [Task 11：桌面应用外壳、信息架构与编辑体验重构](./docs/TASK_011_UI_SHELL_INFORMATION_ARCHITECTURE.md)（代码实现、自动质量门禁与 Windows 人工终验全部通过，见[完成报告](./docs/TASK_011_COMPLETION_REPORT.md)）。
- [ ] [Task 12：Windows Alpha 发布工程](./docs/TASK_012_WINDOWS_ALPHA_RELEASE.md)（待实施）。

具体范围与技术约束以任务文档和[项目技术基线](./docs/PROJECT_BASELINE.md)为准。

## 文档

- [项目定义与技术基线](./docs/PROJECT_BASELINE.md)
- [开发环境说明](./docs/DEVELOPMENT_ENVIRONMENT.md)
- [测试指南](./docs/TESTING.md)
- [TASK-001：桌面应用工程骨架](./docs/TASK_001_PROJECT_BOOTSTRAP.md)
- [TASK-001 完成报告](./docs/TASK_001_COMPLETION_REPORT.md)
- [TASK-002：工作区目录选择与只读文件树](./docs/TASK_002_WORKSPACE_READONLY.md)
- [TASK-002 完成报告](./docs/TASK_002_COMPLETION_REPORT.md)
- [TASK-003：UTF-8 TXT 受控读取与单只读标签页](./docs/TASK_003_TXT_READONLY.md)
- [TASK-003 完成报告](./docs/TASK_003_COMPLETION_REPORT.md)
- [TASK-004：单 TXT 基础编辑与安全保存](./docs/TASK_004_TXT_EDIT_SAFE_SAVE.md)
- [TASK-004 完成报告](./docs/TASK_004_COMPLETION_REPORT.md)
- [TASK-005：多 TXT 标签页与独立编辑会话](./docs/TASK_005_MULTI_TXT_TABS.md)
- [TASK-005 完成报告](./docs/TASK_005_COMPLETION_REPORT.md)
- [TASK-006：工作区 TXT 搜索与当前文件查找替换](./docs/TASK_006_TXT_SEARCH_FIND_REPLACE.md)
- [TASK-006 完成报告](./docs/TASK_006_COMPLETION_REPORT.md)
- [TASK-007：基础 DOCX 阅读、编辑与安全保存](./docs/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md)
- [TASK-007 完成报告](./docs/TASK_007_COMPLETION_REPORT.md)
- [TASK-008：工作区 DOCX 正文搜索与富文本结果定位](./docs/TASK_008_DOCX_WORKSPACE_SEARCH.md)
- [TASK-008 完成报告](./docs/TASK_008_COMPLETION_REPORT.md)
- [TASK-009：基础文件管理闭环](./docs/TASK_009_BASIC_FILE_MANAGEMENT.md)
- [TASK-009 完成报告](./docs/TASK_009_COMPLETION_REPORT.md)
- [TASK-010：当前 DOCX 内查找与替换](./docs/TASK_010_DOCX_FIND_REPLACE.md)
- [TASK-010 完成报告](./docs/TASK_010_COMPLETION_REPORT.md)
- [TASK-011：桌面应用外壳、信息架构与编辑体验重构](./docs/TASK_011_UI_SHELL_INFORMATION_ARCHITECTURE.md)
- [TASK-011 WP0 报告](./docs/TASK_011_WP0_REPORT.md)
- [TASK-011 完成报告](./docs/TASK_011_COMPLETION_REPORT.md)
- [TASK-012：Windows Alpha 发布工程](./docs/TASK_012_WINDOWS_ALPHA_RELEASE.md)
- [TASK-012 开发执行提示词](./docs/TASK_012_DEVELOPMENT_PROMPT.md)
- [未来 UI 优化计划](./docs/FUTURE_UI_OPTIMIZATION_PLAN.md)

## 项目结构

```text
.
├─ docs/                  项目基线、任务记录和开发说明
├─ scripts/               本地工具链及开发命令包装器
├─ src/
│  ├─ main/
│  │  ├─ index.ts         Electron 生命周期、窗口创建与安全策略
│  │  ├─ workspace/       工作区扫描器、会话状态、文件管理服务（新建/重命名/移动/删除/显示）与固定 IPC
│  │  ├─ document/        TXT 读取器、安全保存器、另存为、路径/写入安全 helper 与受控文档 IPC
│  │  ├─ docx/            DOCX 读取/导入/导出/安全保存器、另存为、ZIP 检查与固定 DOCX IPC
│  │  ├─ search/          工作区 TXT/DOCX 混合搜索器、固定搜索 IPC 与纯匹配器
│  │  └─ window/          窗口关闭协调（未保存保护）
│  ├─ preload/            受控桌面 API 桥接
│  ├─ renderer/
│  │  ├─ components/      React UI 组件（shell/menu/toast、可调侧栏、文件树上下文/拖拽、对话框、标签、搜索与编辑器）
│  │  ├─ lib/             纯状态模型与多文档/工作区/文件管理/搜索 controller（含标签不变量、竞态处理与 mutationEpoch）
│  │  └─ styles/          tokens/common/shell/workspace/document/search 分层样式
│  └─ shared/             跨进程共享的纯类型契约（含 DOCX 结构化中间模型、规范正文投影、文件管理契约与纯转换）
├─ tests/                  单元测试与组件行为测试
└─ README.md               项目入口与快速使用说明
```

## 技术栈

- Electron
- React
- TypeScript
- CodeMirror 6（TXT 编辑器）
- Tiptap / ProseMirror（DOCX 富文本编辑器）
- Mammoth / JSZip / docx（DOCX 导入、ZIP 检查与基础导出）
- Vite / electron-vite
- Vitest + React Testing Library
- ESLint / Prettier

## 开发原则

- 本地文件与用户数据安全优先；
- 渲染进程不直接拥有 Node.js 或文件系统权限，桌面能力通过受控接口逐项提供；
- 先保证简单、稳定和可运行，再扩展文件类型、编辑能力与 AI 功能。

完整设计原则见[项目技术基线](./docs/PROJECT_BASELINE.md)。当前项目处于个人开发阶段，暂未建立外部贡献、用户支持或正式发布流程。
