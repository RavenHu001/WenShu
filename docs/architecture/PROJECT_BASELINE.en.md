# WenShu (文枢) project definition and technical baseline

[简体中文](./PROJECT_BASELINE.md) | English

[Product and architecture](./README.en.md) · [Documentation](../README.en.md)

> This document resides in the repository's `docs/architecture/` directory and provides a shared reference for product design, technology choices, development planning, implementation, testing, and later AI Agent collaboration.  
> The Agent responsible for development defines specific tasks, implementation steps, and stage plans separately, based on the current code.

## 1. Project identity

- **Working product name:** 文枢
- **English name:** Wenshu
- **Recommended repository name:** `wenshu-desktop`
- **Project type:** desktop application for editing and managing multiple local documents
- **Primary platforms:** Windows 10 / Windows 11
- **Development model:** led by an individual developer, with AI Agents assisting with planning, coding, testing, and maintenance

Platform goals are not current release claims. Task 12's current internal binary completion scope covers only theoretical Windows 10 x64 compatibility. Physical Windows 10 validation is deferred to a later development stage; Windows 11 acceptance, trusted signing, and public binary distribution are optional future work.

### 1.1 Meaning of the name

“文” refers to documents, text, and creative content; “枢” means a center, hub, or unified entry point.

The name reflects the project's central idea: bring scattered local documents into one workspace, read and edit them in a central editor, and manage them through a file tree, search, and future AI capabilities.

“文枢 / Wenshu” is the working project name. Before a future public release, commercialization, or brand registration, perform separate checks for naming conflicts, domains, and trademarks.

## 2. Project overview

WenShu is a lightweight desktop application for personal writing across multiple documents and reference management.

Its overall interaction model takes inspiration from Visual Studio Code, with a workspace, file tree, multiple tabs, central editor, and auxiliary sidebars. Its main subjects are ordinary text and document files rather than source code.

The core goal is:

> Let users centrally manage, search, switch between, and edit related documents as they would manage a code project.

Initial support covers TXT and basic DOCX files, with simplicity, stability, a working application, and room for later extension as the main criteria. The project does not aim to reproduce all of Microsoft Word or Visual Studio Code.

## 3. Product positioning

### 3.1 Intended role

WenShu is:

> A local workspace for personal writing, organizing creative settings, and maintaining reference material across multiple documents.

Main scenarios include:

- Managing worlds, characters, places, organizations, and historical settings.
- Managing novel chapters and long-form content.
- Managing game design documents.
- Organizing project descriptions, research notes, and personal reference material.
- Switching quickly between related documents.
- Searching text across a workspace.
- Using AI in the future to understand, organize, and modify documents.

### 3.2 Non-goals

The initial project is not positioned as:

- A complete replacement for Microsoft Word.
- Professional publishing or precise typesetting software.
- An online collaborative document platform.
- A cloud file management system.
- An enterprise knowledge base.
- A complete integrated development environment.
- An unsupervised AI automation platform.

## 4. Core design principles

### 4.1 Local files first

- Users select a local folder as their workspace.
- Files remain in the ordinary filesystem.
- Importing into a dedicated database or proprietary format is not mandatory.
- Basic file management and editing should work offline.
- Users should be able to continue opening the original files in other applications whenever possible.

### 4.2 Prioritize the central editor

The central document editor is the visual and operational focus of the interface and should occupy the largest part of the window.

The left side handles workspace navigation and search; the right side provides document properties, formatting, and future AI assistance. Both sidebars should be collapsible so the central area can expand as needed.

### 4.3 Basic features first

Initial priorities are:

- Opening workspaces.
- Browsing the file tree.
- Multiple tabs.
- TXT editing.
- Basic DOCX reading and editing.
- Saving.
- Searching.
- Basic file management.
- State restoration.

Complex formatting, cloud services, plugin systems, and full Agent capabilities should not prevent completion of the basic version.

### 4.4 Simple extension without overdesign

Keep clear module boundaries and leave interfaces for new file types and AI capabilities. Do not initially build a complex plugin framework, microservice system, or large database architecture.

### 4.5 Data safety first

- Failed saves must not clear unsaved state.
- TXT saving must check the read version and never silently overwrite externally changed content.
- TXT writing should use a temporary file beside the target, completing the write, flush, and close before safe replacement.
- Create a backup or safe copy before saving DOCX.
- Prefer temporary-file-then-replace workflows for important file writes.
- Deletion requires confirmation.
- A single-file error must not crash the whole application.
- AI must not overwrite files without the user's knowledge.

## 5. Initial feature scope

### 5.1 Workspaces

Support should include:

- Selecting a local folder as a workspace.
- Displaying files and subfolders.
- Expanding and collapsing directories.
- Refreshing the file tree.
- Recording recent workspaces.
- Restoring the last workspace according to settings.
- Detecting basic external file changes.

Only a single-root workspace is required initially.

### 5.2 File management

Support should include:

- Creating TXT files.
- Creating basic DOCX files.
- Creating folders.
- Opening files.
- Save and Save As.
- Renaming.
- Deleting.
- Revealing items in Windows File Explorer.

Task 9 completed the basic file management flow (see the [TASK-009 completion report](../tasks/task-009/TASK_009_COMPLETION_REPORT.en.md)): creating TXT/basic DOCX/folders in the workspace root or selected folder, with exclusive creation, no overwrite, and no automatic renaming; DOCX is exported from a canonical empty model and validated. TXT/DOCX Save As uses two-phase overwrite confirmation: when the target exists, the first response returns only its controlled revision, and the confirmed second request supplies `expectedTargetRevision` for compare-and-swap (CAS) before publication. Ordinary files and directories can be renamed/moved, including Windows case-only renames using two steps, an intermediate name, and rollback; directories cannot move into themselves or descendants. Accompanying DOCX `.wenshu.bak` backups migrate with the main file, with rollback or explicit partial failure. Deletion consistently uses injectable `shell.trashItem` to send items to the Windows Recycle Bin; fallback to permanent deletion is strictly prohibited. Nontransactional partial success for a document and its backup returns `PARTIAL_FAILURE` and forces refresh. Reveal in File Explorer invokes fixed `showItemInFolder` after revalidation. All writes use fixed narrow IPC and a per-window serial queue; source and target segments are checked without following symlinks/junctions. Successful operations migrate tabs in place using stable tabId, exact single-file paths or directory-segment prefixes, preserving editor sessions and dirty/saving states. They increment `mutationEpoch`, cancel active search, and clear completed results and navigation; failure, cancellation, and reveal do not increment it.

### 5.3 Multiple tabs

Support should include:

- Opening multiple files at once.
- Switching tabs.
- Closing tabs.
- Unsaved-state indicators.
- Preventing duplicate tabs for one file.
- Confirmation when closing unsaved files.

### 5.4 TXT support

Support should include:

- UTF-8 text reading and saving.
- Basic text editing.
- Copy, cut, and paste.
- Undo and redo.
- Current-file find and replace.
- Character or word counts.
- Common keyboard shortcuts.

### 5.5 DOCX support

Only basic DOCX content is required initially:

- Ordinary paragraphs.
- Headings.
- Bold.
- Italic.
- Underline.
- Basic font sizes and text colors.
- Bulleted and numbered lists.
- Basic text alignment.
- Simple DOCX creation and export.

Full initial support is not promised for:

- Precise pagination.
- Header and footer editing.
- Footnotes and endnotes.
- Comments and revision history.
- SmartArt.
- Macros.
- Equations.
- Advanced fields.
- Complex tables.
- Complex floating images and text boxes.
- Completely lossless formatting round trips with Microsoft Word.

Complex DOCX files may be displayed with reduced fidelity, opened read-only, or edited after user confirmation.

Task 7 is complete (see [TASK-007: basic DOCX reading, editing, and safe saving](../tasks/task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.en.md) and its [completion report](../tasks/task-007/TASK_007_COMPLETION_REPORT.en.md)). A versioned structured intermediate model with resource limits, `DocxDocumentModel` in `src/shared/docx.ts`, connects DOCX import, Tiptap/ProseMirror editing, and basic export. Complex content is classified as `supported`, `degraded`, or `read-only`; `rejected` follows the read-error path. Overwrite saves perform original-byte revision conflict checks, same-directory rolling `<文件名>.wenshu.bak` backups, temporary generation, output revalidation, flushing, closing, and safe replacement. Task 7 excludes creation/Save As, DOCX search, complex Word formatting, and fully lossless round trips.

### 5.6 Search

Support should include:

- Find in the current file.
- Replace in the current file.
- Workspace TXT content search.
- Workspace DOCX body-text search.
- Matches grouped by file.
- Opening the corresponding file by clicking a result.

Task 6 completed TXT find and search (see its [completion report](../tasks/task-006/TASK_006_COMPLETION_REPORT.en.md)). Current-file find/replace acts on the active editor's live text using `Ctrl+F` / `Ctrl+H`, literal queries, case options, previous/next navigation, Replace Current, and Replace All. Replacements use CodeMirror edit transactions and enter undo history. Workspace TXT search acts on saved disk content through controlled asynchronous main-process traversal, fixed concurrency of 4, cancellation, and result limits: 1000 candidates, 200 matches per file, and 2000 total matches. Results identify files by canonical relative path and content revision and reuse multi-tab open/activate behavior. Invalid revisions or text ranges only produce an expired-result notice, without incorrect positioning or overwriting content. Task 6's first version excludes workspace replacement, workspace regular expressions, persistent full-text indexing, and DOCX search; Task 8 supplies DOCX search. See the [TASK-006 plan](../tasks/task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.en.md) for implementation boundaries and acceptance.

Task 7 still does not implicitly add DOCX to Task 6's TXT searcher. Task 8 is complete (see its [completion report](../tasks/task-008/TASK_008_COMPLETION_REPORT.en.md)). Workspace DOCX search and rich-text result navigation reuse search identity, cancellation, budgets, and revision-expiry principles. DOCX has its own canonical body-text projection from `DocxDocumentModel`: the pure function in `src/shared/docx-search-text.ts` collects text blocks depth-first and inserts synthetic `\n` separators. It also provides text-block position mapping and navigation through public ProseMirror APIs. Main-process mixed search allows 1000 total candidates, including 200 DOCX, with concurrency 4 overall and 2 for DOCX. Result navigation must pass two checks of kind, revision, range, and match text: the App checks the live projection and the DOCX host checks the same projection rules again. Expired results, structural changes, or mapping failures show only a nondestructive notice, without incorrect navigation or content changes. Search does not write to the workspace or build an index.

Task 10 is complete (see its [completion report](../tasks/task-010/TASK_010_COMPLETION_REPORT.en.md)). Find/replace within DOCX shares TXT's Find and Replace sidebar. Its sole text source is the active Tiptap/ProseMirror live document, reusing Task 8's `joinDocxTextBlocks` projection; it does not read disk, search old model snapshots, or inspect editor DOM. Matching is literal with ASCII case folding, non-overlapping, and subject to single-line and length rules, with at most 2000 matches; 2001+ results are truncated and disable Replace All. A project-owned plugin uses DecorationSet and two highlight classes for ordinary/current matches. Finding, navigation, and panel closure do not change content, mark dirty, or enter undo history. Replace Current rescans and validates live ranges at execution; nonempty replacements inherit marks from the starting character, including when crossing different mark runs. Replace All applies at most 2000 edits in reverse order in one transaction and supports one undo/redo. Before dispatch, candidate `tr.doc` passes `tiptapJsonToDocxModel` and serialization-budget validation; any failure means 0 dispatch and 0 dirty state. Read-only permits find but not replacement; degraded permits replacement only after confirmation tied to the current revision, invalidated by reloading a new revision. Replacing during a save is not cleared by completion of the earlier save. Per-tab state binds to stable tabId and survives rename/move/Save As; closure, reopening, and workspace changes clean it up completely. Workspace navigation and mutationEpoch do not contaminate current-find state. No new IPC/preload/DesktopApi is introduced.

### 5.7 Settings

Basic settings include:

- Light and dark themes.
- Editor font.
- Editor font size.
- Autosave toggle.
- Restore workspace at startup.
- Restore tabs at startup.
- Automatic backup before DOCX saving.

## 6. Interface layout baseline

The application uses a desktop workspace layout centered on the document editor.

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ Menu: File  Edit  View  Tools  Help                                        │
├─────────┬──────────────────┬────────────────────────┬─────────────────────┤
│Activity │ Left sidebar     │ Central document area  │ Right auxiliary bar │
│         │                  │                        │                     │
│Files    │ Workspace tree   │ Editor tabs            │ Document properties │
│Search   │ Search results   ├────────────────────────┤ Formatting          │
│Outline  │ Document outline │                        │ Document info       │
│Settings │ Recent files     │ Current file editor    │ Reserved AI panel   │
│AI later │                  │                        │                     │
├─────────┴──────────────────┴────────────────────────┴─────────────────────┤
│ Status: file type, save state, word count, cursor, workspace state         │
└───────────────────────────────────────────────────────────────────────────┘
```

### 6.1 Central document editor

The central area should:

- Occupy the largest width in the default layout.
- Contain the editor tab bar and current file editor.
- Load the appropriate editor for each file type.
- Expand automatically when either sidebar collapses.
- Retain priority for usable space when the window shrinks.
- Leave room for future split editing, without requiring it initially.

Conceptual file-type/editor mapping:

- `.txt` → plain-text editor.
- `.docx` → rich-text editor.
- Future `.md` → Markdown editor.
- Future `.pdf` → read-only preview.
- Unsupported types → file information and an unsupported-type notice.

### 6.2 Left area

The left activity bar switches between main features, initially including:

- Files.
- Search.
- Settings.

Document outline and AI can be added later.

The left sidebar mainly displays:

- Workspace file tree.
- Search input and results.
- Recent files.
- Future document outline.

### 6.3 Right auxiliary sidebar

The right auxiliary sidebar is not required for the first version and can be added incrementally.

It may provide:

- File and document properties.
- DOCX formatting.
- Document statistics and compatibility notices.
- Future AI chat, change suggestions, and operation confirmation.

The right sidebar should collapse and must not permanently crowd out the central editor.

### 6.4 Status bar

The status bar may show:

- Current workspace.
- Current file type.
- Saved or unsaved state.
- Character or word count.
- Text encoding.
- Cursor position.
- DOCX compatibility state.
- Future AI service state.

### 6.5 Task 11 implemented desktop shell and information architecture baseline

Task 11 completed product code, automated quality gates, and final manual Windows acceptance (see the [completion report](../tasks/task-011/TASK_011_COMPLETION_REPORT.en.md)), freezing these UI boundaries:

- Electron's default application menu is removed. The renderer contains one Chinese, testable menu whose commands are real entry points, with no new menu IPC.
- The activity bar shows only implemented Files and Search entries, using project-local SVG, tooltips, `aria-pressed`, and explicit accessible names. Unimplemented Settings is not presented as usable.
- Sidebar width is 180–420 px, adjustable with pointer or keyboard, collapsible and restorable. The file tree is the main scroll area and supports long paths, deep directories, and long names.
- File management moves from the bottom button area to root/file/folder context menus and keyboard commands. Internal dragging within a workspace only means moving and calls existing `relocate`; it does not add copying, overwriting, cross-drive operations, or external drag-in/drag-out.
- The renderer immediately rejects no-ops, self/descendant moves, same-name snapshot entries, saving states, invalid targets, and stale workspaces. The main process retains final checks for segment links, realpath, target races, accompanying backups, and partial failure.
- DOCX uses a continuous, centered reading/writing column up to 820 px wide, without a Word pagination promise. The toolbar observes actual width to switch between grouped commands and More Formatting; TXT remains a full-height editor.
- Successful mutations use timed, dismissible toasts. Errors, conflicts, and partial completion remain traceable. Electron version is no longer permanently shown in the status bar; runtime information is in About.
- Styles are layered as tokens/common/shell/workspace/document/search, with `forced-colors` and `prefers-reduced-motion` support points.

This UI rework adds no `DesktopApi`, preload, or IPC capability. Task 9's stable tabId, mutationEpoch, DOCX `.wenshu.bak`, Recycle Bin, and write safety, together with Task 10's current-DOCX find/replace lifecycle, remain regression baselines. On 2026-08-27 the owner completed manual acceptance for physical Windows display scaling at 100%/125%/150%, 200% text scaling, high contrast, reduced motion, and screen readers, finding no issues.

## 7. Overall technical architecture

The project uses a standalone desktop architecture, initially divided into:

```text
Desktop application
├─ Electron application shell
├─ React user interface
├─ Workspace and file tree
├─ Tabs and editors
├─ File-type handlers
├─ Search
├─ Settings and state persistence
└─ Reserved AI interfaces
```

### 7.1 Electron application shell

Responsible for:

- Desktop windows.
- System menus.
- File and folder selection.
- Application lifecycle.
- Windows capabilities.
- Local file access.
- Renderer/main-process communication.

### 7.2 React user interface

Responsible for:

- Main layout.
- Activity bar.
- Left/right sidebars.
- File tree.
- Tab bar.
- Editor container.
- Status bar.
- Settings and notices.

### 7.3 Workspace and filesystem

Responsible for:

- Opening and restoring workspaces.
- Reading directory structure.
- File-tree state.
- Watching file changes.
- Creating, renaming, deleting, and saving files.
- Workspace search, cancellation, and resource limits.
- Path and permission error handling.

### 7.4 Editor system

Responsible for:

- TXT editor.
- DOCX rich-text editor.
- Unsupported-file notices.
- Tab state.
- Modification state.
- Find, replace, undo, and redo.

### 7.5 File-type handlers

Each file type should have a relatively independent handler supplying:

- Extension recognition.
- Reading.
- Saving.
- Whether it is editable.
- Whether it is searchable.
- Search-text extraction.
- Corresponding editor type.

Initially include at least:

- `TextFileHandler`
- `DocxFileHandler`

Adding file types later should not require rewriting core workspace or tab logic.

### 7.6 Reserved AI interfaces

Do not implement a full Agent initially, but avoid directly coupling AI logic to the UI or filesystem.

Future AI modules access these through controlled application capabilities:

- Current file content.
- User selection.
- Workspace file list.
- Document search.
- Text-change suggestions.
- Confirmed file and document operations.

## 8. Languages and technical baseline

### 8.1 Core languages

| Technology | Purpose                                                                        |
| ---------- | ------------------------------------------------------------------------------ |
| TypeScript | Main language for Electron, React, state, file handling, and application logic |
| HTML       | Application pages and intermediate rich-text representation                    |
| CSS        | Layout, themes, and editor styles                                              |
| JSON       | Settings, state, configuration, and structured data                            |

### 8.2 Desktop and frontend

| Technology                  | Purpose                                                             |
| --------------------------- | ------------------------------------------------------------------- |
| Electron                    | Windows desktop shell, local capabilities, and packaging foundation |
| React                       | UI components                                                       |
| Vite                        | Frontend development and builds                                     |
| Zustand                     | Lightweight global state management                                 |
| CSS Modules or ordinary CSS | UI styling                                                          |

Do not use Tauri initially, to avoid adding Rust and cross-language complexity at the same time.

### 8.3 Editors

| Technology   | Purpose                                                        |
| ------------ | -------------------------------------------------------------- |
| CodeMirror 6 | TXT plain-text editor                                          |
| Tiptap       | Basic rich-text editor for converted DOCX                      |
| ProseMirror  | Structured rich-text foundation used indirectly through Tiptap |

If a more VS Code-like plain-text experience becomes an explicit future need, evaluate Monaco Editor. CodeMirror 6 is recommended initially.

Task 4 adopted CodeMirror 6 when moving TXT from read-only viewing to editing. The editor maintains only UI memory state and does not access the filesystem directly; reading and saving continue through narrow preload and fixed IPC interfaces.

Task 5 expanded single-document editing into multiple TXT tabs without expanding filesystem permissions. Each tab independently maintains text, disk revision, modified state, save state, errors, conflicts, and a CodeMirror session. Switching tabs preserves cursor, selection, scrolling, and undo/redo history. Multi-tab behavior reuses Task 4's fixed read/save IPC and adds no general desktop capability for renderer session management. See the [TASK-005 plan](../tasks/task-005/TASK_005_MULTI_TXT_TABS.en.md).

Task 6 added current-file find/replace inside CodeMirror sessions, with `@codemirror/search` as a direct dependency, and a separate read-only main-process capability for workspace TXT search. The renderer submits only a bounded query and request identity (requestId), never the workspace root or arbitrary filesystem parameters. The main process handles controlled traversal, TXT reading, fixed concurrency 4, cancellation, result limits of 1000 candidates / 200 per file / 2000 overall, and error isolation. The first search implementation creates no persistent index and writes nothing to the workspace. Result navigation binds requestId, workspace epoch, relative path, revision, and stable tabId; expiry only shows a notice and never overwrites content. See the [TASK-006 plan](../tasks/task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.en.md).

Task 7 adopted Tiptap/ProseMirror for DOCX renderer editing sessions; editor instances never cross IPC. The project-owned `DocxDocumentModel` is the stable boundary for import, editing state, and export, through the `src/shared/docx.ts` contract and pure `src/shared/docx-convert.ts` conversions. TXT continues to use CodeMirror. Common tab lifecycle behavior uses a file-kind discriminated union in `src/renderer/lib/document-tabs.ts`, while TXT/DOCX content models and editor runtimes stay isolated. See the [TASK-007 completion report](../tasks/task-007/TASK_007_COMPLETION_REPORT.en.md).

Task 8 expanded workspace search to mixed TXT + DOCX and rich-text result navigation (see its [completion report](../tasks/task-008/TASK_008_COMPLETION_REPORT.en.md)). The only semantic source for DOCX search text is `DocxDocumentModel`'s canonical body projection in `src/shared/docx-search-text.ts`: depth-first text blocks with synthetic `\n` separators, with UTF-16 offsets aligned to ProseMirror text positions. DOCX is not treated as UTF-8 TXT, and OOXML, Mammoth HTML, and editor DOM are not searched directly. The main-process searcher reuses controlled readers, permits 1000 candidates including 200 DOCX, runs concurrency 4 including 2 DOCX reads, cooperatively cancels, and isolates per-file failures. The App checks the live projection and the DOCX host checks it again with the same rules before public ProseMirror commands `setTextSelection` / `scrollIntoView` / `focus` select, scroll, and focus. Expiry or mapping failure only shows a nondestructive notice, never incorrect navigation or content changes. Search is read-only and creates no workspace writes, index, or cache.

Task 10 added a project-owned current-search plugin and per-tab controller to DOCX editor sessions: the pure `src/renderer/lib/docx-current-search.ts` layer plus the `docx-current-search-plugin.ts` ProseMirror plugin and narrow controls. Each editor installs the plugin once and each stable tabId has one controller. Recalculation uses single microtask scheduling and generation-based rejection of stale work, without workers, indexes, or debounce timers. Editor/controller destruction cleans subscriptions completely. Replacement uses public transaction APIs and reuses existing `editDocxTab`, dirty, editRevision, and save gates. Read-only, degraded confirmation, continued editing during saves, conflict, and path-migration semantics remain unchanged. IPC/preload exposure does not expand.

### 8.4 DOCX processing

| Technology | Purpose                                                           |
| ---------- | ----------------------------------------------------------------- |
| Mammoth    | Import basic DOCX body content and formatting; extract plain text |
| docx       | Create and export basic DOCX                                      |
| JSZip      | Inspect DOCX ZIP packages and internal XML when needed            |

Do not initially implement a complete OOXML parser and layout engine from scratch.

In Task 7, Mammoth handles semantic import through the document tree from `mammoth.convertToHtml({buffer}, {transformDocument})`. JSZip only checks basic ZIP/OOXML structure and resource budgets and supplements limited properties proven necessary by technical validation: run colors, headers/footers, revisions, protection, and embedded objects. `docx` rebuilds basic output from the supported intermediate model. Raw OOXML, unsanitized HTML, editor instances, and library-private objects never enter the cross-process document model. Before saving, create a same-directory rolling `<文件名>.wenshu.bak` backup of the most recent original file. Backup or output-validation failure prohibits target replacement. See the [TASK-007 completion report](../tasks/task-007/TASK_007_COMPLETION_REPORT.en.md).

### 8.5 Local storage and system communication

| Technology              | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| Node.js File System API | Local directory and file operations                   |
| Electron IPC            | Main-process/renderer communication                   |
| Context Bridge          | Expose restricted desktop APIs to the UI              |
| electron-store          | Persist settings, recent workspaces, and window state |

Do not use SQLite initially. Reevaluate it only if future requirements include large full-text indexes, document relationships, historical versions, or Agent logs.

### 8.6 Testing, quality, and releases

| Technology            | Purpose                                                                       |
| --------------------- | ----------------------------------------------------------------------------- |
| Vitest                | Unit tests                                                                    |
| React Testing Library | React component and interaction tests                                         |
| Playwright            | Electron end-to-end launch, TXT/DOCX saving, and close-protection smoke tests |
| ESLint                | Static code checks                                                            |
| Prettier              | Consistent code formatting                                                    |
| electron-builder      | Windows installers and portable builds                                        |
| Git                   | Version control and recovery of changes                                       |
| GitHub                | Optional remote repository, issues, and releases                              |

Task 12 release engineering pins Electron `43.6.0` and electron-builder `27.0.0-alpha.8`, producing Windows x64 portable and per-user NSIS internal artifacts. Packages use ASAR integrity and fixed Electron fuses and pass complete unpacked/ASAR allowlist, x64 PE, source-independent launch, `NotSigned`, and SHA-256 gates. Builder `publish` is explicitly disabled, so the application has no update feed or automatic updating. Public Windows binary distribution is not currently authorized.

## 9. Technical targets

### 9.1 Platforms and execution model

| Item                     | Initial baseline                     |
| ------------------------ | ------------------------------------ |
| Primary platforms        | Windows 10, Windows 11               |
| Architecture             | 64-bit first                         |
| Application form         | Standalone local desktop application |
| User model               | Single user                          |
| Basic network dependency | None                                 |
| Workspace form           | One local folder                     |
| Distribution form        | Installer or portable package        |

Task 12 release engineering currently targets only Windows 10 x64 as its internal binary baseline and does not claim Windows 11 acceptance. WP8 found that the acceptance host's kernel build 26200 was actually Windows 11. On 2026-09-10 the owner moved the physical Windows 10 matrix to a later development stage, requiring only theoretical compatibility auditing for the current scope. Final-package PE, architecture, Electron, NSIS, dependency, and source-platform gate audits support Windows 10 x64, but must not be described as physical Windows 10 validation. See the [TASK-012 completion report](../tasks/task-012/TASK_012_COMPLETION_REPORT.en.md) for precise status.

### 9.2 File and workspace scale

These figures describe recommended use, not enforced limits:

| Item                          | Recommended range |
| ----------------------------- | ----------------- |
| Workspace file count          | Up to 1000        |
| Simultaneously open tabs      | Up to 20          |
| Ordinary TXT size             | Up to 5 MB        |
| Ordinary DOCX size            | Up to 20 MB       |
| Directory nesting             | Up to 20 levels   |
| Files in one workspace search | Up to 1000        |

### 9.3 Performance goals

| Operation                  | Initial goal                                             |
| -------------------------- | -------------------------------------------------------- |
| Application startup        | Main window within a few seconds on an ordinary computer |
| Open an ordinary workspace | File tree within a few seconds                           |
| Open ordinary TXT          | Nearly immediate                                         |
| Switch tabs                | No noticeable wait                                       |
| Save TXT                   | Nearly immediate                                         |
| Open ordinary DOCX         | Within a few seconds                                     |
| Workspace search           | Does not freeze the main interface                       |
| Reflect file changes       | Within a reasonable delay                                |

Development Agents should measure actual performance and avoid introducing complex architecture for performance problems that have not occurred.

### 9.4 Stability and data safety

Required behavior:

- File-read failures do not crash the whole application.
- Failed saves retain unsaved state.
- TXT saving checks the disk content revision, reports external modification conflicts, and does not overwrite by default.
- Prefer a temporary file beside the TXT target, completing write, flush, and close before replacement.
- Failed TXT replacement never first deletes, truncates, or unsafely overwrites the original.
- Create a backup or recovery point before writing DOCX.
- Prefer temporary DOCX output, replacing the target only after success.
- Deletion requires confirmation.
- File switches, workspace switches, and window closure that could discard unsaved content require confirmation.
- Do not execute DOCX macros or embedded scripts.
- The renderer does not directly hold full Node.js permissions.
- Filesystem capabilities are exposed through controlled preload and IPC.

### 9.5 Maintainability

Requirements:

- Use TypeScript.
- Enable strict or relatively strict type checks.
- Separate filesystem logic from React components.
- Separate editor, workspace, and file handling responsibilities.
- Give each file type an independent processing module.
- Cover important pure logic with basic unit tests.
- Pass ESLint.
- Use Prettier for consistent formatting.
- Preserve recovery points for important changes through Git.

## 10. Features currently excluded

The initial version explicitly excludes:

- Real-time multi-user collaboration.
- Cloud synchronization.
- User accounts.
- Browser and mobile versions.
- Git integration.
- Plugin marketplace.
- Complete Office compatibility.
- Professional publishing layout.
- Complete revisions and comments system.
- Macro execution.
- Complex table and graphics editing.
- Unconfirmed AI bulk modifications.
- Complex autonomously running Agent systems.

These can be reevaluated later but must not expand the initial development scope.

## 11. AI and Agent extension principles

Future AI capabilities can progress through:

1. **Text assistance**
   - Summarization, polishing, expansion, shortening, and grammar checks.

2. **Workspace questions and answers**
   - Searching multiple documents, summarizing references, and finding content conflicts.

3. **Agent operations**
   - Creating files, editing documents, renaming, bulk replacing, and organizing directories.

Agent operations must:

- Use only controlled interfaces supplied by the application.
- Never directly receive arbitrary disk access.
- Show a plan or diff before modification.
- Obtain user confirmation for important changes.
- Create a backup or recovery point before modifying.
- Return results and errors after modifying.
- Support undo wherever possible.
- Preserve the local-files-first principle when adding AI.

## 12. Constraints for later development Agents

This document defines product direction and the technical baseline. Agents responsible for individual stages may independently handle:

- Requirements refinement.
- Architecture and directory design.
- Task decomposition.
- Implementation order.
- Dependency version selection.
- Coding.
- Testing.
- Debugging.
- Refactoring.

Development Agents must not change these baselines without explanation:

- Windows desktop first.
- Electron, React, and TypeScript as the initial core technologies.
- The central document editor as the interface's focus.
- Establish TXT support before basic DOCX.
- Keep files in ordinary local folders.
- Do not pursue complete Word compatibility.
- Do not build complex plugin systems prematurely.
- Do not initially introduce cloud services or user accounts.
- AI must not overwrite user files without confirmation.
- Prioritize a simple, stable, working version.

If the baseline needs to change, first explain:

- The current problem.
- The proposed change.
- Benefits.
- Risks.
- Added complexity.
- Migration costs.
- Effects on existing code and files.

The project owner decides whether to accept the change.

## 13. Project success criteria

The initial core goals are met when:

1. The application runs as a standalone Windows desktop program.
2. Users can open local folders as workspaces.
3. Users can manage files through a file tree.
4. Users can open and switch between documents in multiple tabs.
5. TXT reading, editing, search, and saving work reliably.
6. Basic DOCX reading, editing, and export work.
7. DOCX saving includes backups and error protection.
8. Users can search the current file and workspace content.
9. The central editor remains the primary work area.
10. Project structure permits later file-type extensions.
11. Controlled extension interfaces remain available for AI and Agent capabilities.
12. The project can continue evolving as a personal desktop-development and AI-assisted-development project.

## 14. Project summary

> WenShu (文枢 / Wenshu) is a lightweight Windows desktop application for personal writing and reference management across multiple documents. It uses workspace, file-tree, and multi-tab interactions similar to Visual Studio Code, centered on a document editor. Initial support covers management, reading, editing, searching, and saving for TXT and basic DOCX files. Built with Electron, React, and TypeScript, it uses modular file handling and controlled local interfaces to leave room for other file types, document analysis, and AI Agent capabilities.
