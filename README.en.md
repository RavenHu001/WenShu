# WenShu (文枢)

[简体中文](./README.md) | [English](./README.en.md)

WenShu is a local desktop workspace for managing multiple documents, designed for personal writing, organizing creative settings, and maintaining reference material. It uses an ordinary folder as its workspace and provides a file tree, multiple tabs, and a central editor similar to a code editor, so related documents can be managed, searched, and edited together.

> **Current stage: Task 12 internal Alpha release engineering.** The source code is licensed under the MIT License and may be published on GitHub. Windows portable/NSIS packages remain unsigned internal Draft artifacts and are not offered as public downloads. There are no plans to publish the project on the Microsoft Store. Microsoft Artifact Signing + GitHub OIDC is only an optional future task if public binaries are released.

## Release and licensing

- See the [release documentation](./docs/releases/README.en.md) for release notes and publication scope, and the [documentation center](./docs/README.en.md) for development documentation organized by category.
- The project code uses the [MIT License](./LICENSE), Copyright 2026 Jinxi Hu.
- The current public scope covers GitHub source code only. There is no public binary Pre-release and no automatic update mechanism.
- Internal portable/NSIS packages have no Authenticode publisher signature or timestamp. Do not describe an internal Draft as a trusted public release.
- Third-party component versions, licenses, and required notices are listed in [THIRD_PARTY_NOTICES.txt](./THIRD_PARTY_NOTICES.txt).

WP8 passed all 33/33 acceptance items within the current scope: preparation for MIT source publication is complete, as is engineering for the unsigned Windows 10 x64 internal Alpha. The final Electron 43.6.0 portable/NSIS artifacts passed the theoretical Windows 10 compatibility audit. Because the project owner currently has no corresponding physical test environment, testing on an actual Windows 10 machine is deferred to a later development phase; this conclusion does not claim that such testing has occurred. The main push CI passed for the exact product commit `98b05b4`. The private repository uses GitHub Free, so artifact attestation is unsupported, and the actual reason has been recorded. See the [TASK-012 completion report](./docs/tasks/task-012/TASK_012_COMPLETION_REPORT.en.md).

## Current capabilities

### Available to try

- Launch the Windows Electron desktop window.
- Click “打开文件夹” (Open Folder) on the left to select a local workspace through a native dialog.
- Browse the workspace file tree and expand or collapse nested folders.
- Manually refresh the workspace to reflect changes made by other programs.
- Switch workspaces, or cancel the selection without losing the current state.
- View errors for individual subdirectories without affecting other tree nodes.
- Click a `.txt` file in the tree, or activate it with the keyboard, to open its UTF-8 contents in an editable tab in the central area. Selecting several TXT files opens separate tabs; selecting an already open file activates its existing tab.
- Click an ordinary `.docx` file in the tree, or activate it with the keyboard, to open a single tab for that file. A clear loading state is shown while reading. Once loaded, the Tiptap/ProseMirror rich text editor displays paragraphs, heading levels 1–3, bold, italic, underline, basic font sizes, text colors, bulleted/numbered lists, and basic alignment.
- Open TXT and DOCX files together. Each tab has its own text/model, selection, scroll position, undo history, dirty flag, save state, and error state. Switching tabs preserves each session, and a path can have only one tab.
- Click tabs to switch documents while retaining each tab’s cursor, selection, scroll position, and undo/redo history. Files with the same name at different paths can be open together, with the full relative path available in a tab tooltip.
- Type, delete, copy, paste, undo, and redo, including in empty files.
- Explicitly save the active tab with the Save button or `Ctrl+S`. Tabs show an unsaved indicator (●), and the toolbar reports saved, unsaved, saving, save failure, or external conflict states.
- Save different tabs in parallel while preventing concurrent saves of the same tab. Edits made during a save are preserved, and a failed save retains all edits.
- Detect an external conflict when saving a file changed by another program. Local content is retained, and the disk version is reloaded only after confirmation.
- Compare the complete structured model when reloading DOCX, so formatting-only changes made by an external program are also reflected.
- Use the basic DOCX formatting toolbar: bold/italic/underline, paragraph/heading, allowed font sizes, text color, lists, alignment, and undo/redo. `Ctrl+S` and the Save button use the same DOCX save flow.
- Open a zero-byte `.docx` placeholder created by Windows/WPS as a blank document; its first save creates valid OOXML. Only DOCX files with explicitly enabled editing protection enter read-only mode. WPS’s `w:enforcement="0"` is not misclassified as enabled protection.
- Create a rolling backup named `<filename>.wenshu.bak` in the same directory before saving DOCX, containing the original file before the save. The status bar shows the backup filename after a successful save. Backups are retained but hidden from the workspace tree. If backup creation or output validation fails, the target file is unchanged.
- Show explicit compatibility warnings for documents containing unsupported content such as images, tables, headers/footers, comments, tracked changes, or hyperlinks. `degraded` documents require confirmation tied to their revision before editing or saving; `read-only` documents can be viewed but cannot be edited or saved.
- Show stable errors for corrupt, encrypted, disguised, oversized (over 20 MiB), or resource-budget-exceeding DOCX files, without exposing partially editable content.
- Preserve BOM and consistent LF/CRLF line endings when saving TXT. Mixed line endings require explicit confirmation before normalization.
- Ask for “Discard Changes / Cancel” before closing an unsaved tab; `Ctrl+W` and the close button use the same flow. Switching workspaces or closing the window with unsaved changes shows a combined confirmation containing the number of unsaved tabs.
- Prevent tabs with an in-progress save from being discarded by closing tabs, switching workspaces, or closing the window, and ask the user to wait for the save to finish.
- Show loading states while reading files and recoverable errors for read failures, oversized files, or invalid encoding, without affecting other tabs.
- Retrieve platform and Electron version information through a controlled preload API and view it in About WenShu.
- Press `Ctrl+F` in an active TXT tab to open Find, or `Ctrl+H` to open Replace. Use literal text queries, a case-sensitive option, previous/next navigation, Replace Current, and Replace All. Replacements enter undo history, mark the document dirty, and use explicit saving. Finding does not change content or mark it dirty. The find panel, query, selection, and history are isolated per tab.
- Press `Ctrl+F` / `Ctrl+H` in an active DOCX tab to open the same Find and Replace panel used by TXT. Search the live, unsaved ProseMirror document immediately, including paragraphs, headings, text spanning mark runs, lists, Chinese, and emoji. Matches and the current match use two highlight classes. Navigation wraps, match counts are displayed, and a truncation notice appears when there are more than 2,000 matches. Finding, navigating, and closing the panel do not change content, mark it dirty, or enter undo history. Closing the panel returns focus to the editor.
- Replace the current match or all matches in editable DOCX. The live ranges are rescanned and revalidated at execution time. A nonempty replacement inherits the formatting of the character at the start of the match; if the match spans different mark runs, only the starting marks are used. Replace All handles at most 2,000 matches in one transaction, applied from the end of the document to the beginning, and one undo/redo restores the entire operation. Before dispatch, the candidate model is checked against structural and serialization budgets; any failure means zero dispatches and no dirty state. Replacements mark the document dirty and use the existing save flow, preserving revision conflicts, rolling backups, and safe replacement behavior. They do not save automatically.
- Apply the DOCX compatibility lifecycle consistently: read-only documents support finding but not replacing; unconfirmed degraded documents support finding but not replacing until confirmation is tied to the current revision. Confirmation does not recreate the editor, and reloading a different revision invalidates old confirmation. Edits from replacement during a save are not cleared when the earlier save completes. Save-error, conflict, and read-error states with a retained snapshot have defined behavior.
- Isolate queries, options, current matches, decorations, and edit history across TXT/DOCX tabs using stable `tabId` values. Closing and reopening a tab starts a new session. Renaming, moving, or saving as another path retains the current find session with the stable `tabId`, without recreating the editor. Workspace result navigation and `mutationEpoch` changes do not contaminate current-document find state.
- Click Search in the activity bar or press `Ctrl+Shift+F` to open workspace search. A single query searches both ordinary UTF-8 TXT files and the canonical body text of basic DOCX files saved on disk in the current workspace. Case sensitivity can be toggled, searches can be canceled, and new queries can be submitted consecutively. TXT semantics are identical to Task 6. DOCX searches only text projected from the Task 7 structured model: paragraphs, headings, text spanning runs, and lists. Content not included in that model, such as images, tables, headers/footers, and comments, is outside the search promise. Results are grouped by file and show relative paths, TXT/DOCX type labels, 1-based line/column positions, safe snippets, counts of scanned/hit/matched/skipped items, and truncation notices, including the DOCX candidate limit. DOCX line/column positions refer to extracted text, not Word page coordinates. With no workspace, an empty state is shown and no search is started.
- Click a TXT or DOCX search result to open or activate its unique tab. TXT reuses CodeMirror’s safe positioning. DOCX verifies kind, revision, canonical projected range, and match text at both validation points before using public ProseMirror APIs to select, scroll, and focus. Read-only documents can be navigated but not edited; navigating degraded documents does not confirm compatibility automatically; a dirty document can be navigated if the original range is unchanged. If revision, range, body structure, or the editor host’s second validation fails, only a “Search result is out of date” notice is shown, without incorrect positioning or content changes.
- Switch between Files and Search in the activity bar without losing the workspace, open tabs, or tree expansion state. Successfully switching workspaces clears old search results.
- Create TXT files, basic DOCX files, and folders in the workspace root or a selected folder. Missing file extensions are added automatically: creating a TXT named `Meeting notes` produces `Meeting notes.txt`. Newly created TXT/DOCX files open automatically as unique clean tabs; newly created folders remain selected.
- Use Save As for the current writable TXT/DOCX document by selecting a target folder within the workspace and entering a filename. A missing target is created safely. An existing target requires explicit overwrite confirmation and is overwritten only if it still has the same confirmed version. On success, the current tab moves to the new path and retains its editor session; the source file remains at its original location.
- Rename or move ordinary files and folders within the workspace, including Windows renames that change only letter case. A folder cannot be moved into itself or a descendant. Renaming TXT/DOCX preserves the existing extension automatically: renaming `Report.txt` to `Summary` produces `Summary.txt`. Changing an extension is not allowed as a format conversion. Open documents retain tab order, active state, dirty flag, text/model, cursor, selection, scroll position, undo history, and find state. Renaming or moving a directory migrates all open tabs below it together.
- Delete files or folders to the Windows Recycle Bin, allowing recovery. Confirmation includes the path, type, and number of affected unsaved tabs. If any affected tab is saving, the operation waits first. Successful deletion closes affected tabs.
- Reveal a file, directory, or workspace root in File Explorer.
- Automatically refresh the workspace after a successful create, Save As, rename, move, or delete. Old search results become invalid immediately: active search is canceled, results and navigation targets are cleared, and deleted paths cannot remain clickable. Failures, cancellations, and Reveal in File Explorer do not invalidate otherwise valid results.
- Use a single set of Chinese application menus at the top of the renderer. Commands in File, Edit, View, and Help are functional entry points, and runtime version information is available in “关于文枢” (About WenShu).
- Use project-local SVG icons in the activity bar, file tree, tabs, toolbars, and status feedback. The unimplemented Settings entry no longer appears to be a working feature.
- Resize the workspace sidebar between 180 and 420 px by dragging or using the keyboard, collapse it, and restore it through the activity bar or View menu. Long paths, deeply nested folders, and very long filenames remain scrollable and have complete tooltips.
- Open separate context menus for the workspace root, files, and folders using right-click, `Shift+F10`, or the Menu key. `F2` for Rename, `Delete` for deletion confirmation, `F5` for Refresh, and `Ctrl+Shift+S` for Save As reuse the existing guards.
- Drag files and folders to ordinary directories or the root drop zone within the same workspace. No-ops, self/descendant moves, name collisions, in-progress saves, invalid types, and stale workspaces are rejected before submission; the main process still makes the final decision.
- Edit DOCX on a centered continuous writing canvas with a maximum width of 820 px, without a pagination promise. The toolbar groups history, character, paragraph, list, and alignment controls, with a “More Formatting” overflow at narrow widths. TXT retains a full-height plain text layout.
- Show dismissible, timed toasts for successful file operations. Errors, conflicts, and partial failures do not disappear automatically. CSS provides adaptation points for high contrast and reduced motion.

### Engineering capabilities

- Electron, React, TypeScript, and Vite development and production build pipelines.
- Isolated type environments for the main process, preload, and renderer.
- A security baseline with `nodeIntegration: false`, `contextIsolation: true`, and sandboxing.
- Controlled IPC channels: `workspace.open()` / `workspace.refresh()`, `workspace.createText()` / `createDocx()` / `createDirectory()` / `relocate()` / `trash()` / `reveal()`, `document.readText()` / `saveText()`, `document.readDocx()` / `saveDocx()`, `document.saveTextAs()` / `saveDocxAs()`, `search.textWorkspace()` / `cancelTextWorkspace()`, and a narrow window-close coordination protocol. All requests undergo exact shape validation, rejecting extra fields, root/absolute paths, and dangerous switches such as force/overwrite.
- File management safety services (TASK-009): segment-by-segment source/target validation with no symlink/junction following and realpath boundaries; serialized write queues per window; exclusive temporary files and revalidation before publication without overwriting; two-step Windows case-only renames with rollback; migration of accompanying DOCX `.wenshu.bak` files; deletion through injectable `shell.trashItem` with no fallback to permanent deletion; and two-phase Save As overwrite confirmation using `expectedTargetRevision` compare-and-swap (CAS).
- A multi-tab model that separates stable `tabId` from mutable `relativePath`: path migration for individual files or directory-segment boundaries, pure state transitions for Save As completion and bulk closing, and retention of editor sessions—CodeMirror/Tiptap instances, selection, scroll position, and undo history—when paths change.
- Search invalidation through `mutationEpoch` (TASK-009 §4.11): successful create/save-as/relocate/trash operations increment the epoch, cancel active search, and clear completed/cancelled/error results and navigation targets. Failures, cancellations, reveal operations, and refresh failures do not increment it. Late search results validate `requestId` + `workspaceEpoch` + `mutationEpoch` together.
- DOCX import, editing, and export through a project-owned, versioned structured intermediate model with fixed budgets (`src/shared/docx.ts`). Tiptap/ProseMirror instances exist only in renderer editing sessions and do not cross IPC.
- CodeMirror 6 for plain text (TXT) and Tiptap/ProseMirror for rich text (DOCX), with session caches isolated by tab.
- Full main-process validation for TXT reading and saving: relative path format, workspace boundaries, segment-by-segment symlink/junction checks, real paths, ordinary-file type, a 5 MiB size limit, and strict UTF-8.
- Equivalent DOCX path/link/realpath validation in the main process with a 20 MiB limit. DOCX is treated as an untrusted ZIP with fixed resource budgets for entry counts, decompressed sizes, key XML parts, model nodes, and more; checks of required parts; limited supplementary reads of properties for colors, headers/footers, tracked changes, protection, and embedded objects; and semantic import through Mammoth.
- TXT saves detect content-version conflicts using SHA-256 and safely replace the target using an exclusive temporary file in the same directory, a complete write, flush, close, and `rename`.
- DOCX saves detect conflicts using the revision of the original bytes, create a rolling `<filename>.wenshu.bak` backup in the same directory, generate and reimport the output for validation, and use an exclusive temporary write, flush, close, and safe replacement. Saving is rejected for unconfirmed `degraded` documents, `read-only` documents, and invalid models.
- Mixed TXT + DOCX workspace search in the main process. The root path comes only from the main-process workspace session, and symbolic links are not followed. TXT reuses controlled reading; DOCX reuses controlled `readDocxDocument` and canonical body-text projection. Limits are 1,000 total candidates, including at most 200 DOCX files; 200 matches per file; and 2,000 total matches. Overall concurrency is 4, including at most 2 concurrent DOCX reads. Search supports cooperative cancellation and isolates per-file errors. It is read-only, writes nothing to the workspace, and creates no index or cache.
- A canonical DOCX body-text projection (`src/shared/docx-search-text.ts`): a pure function that collects text blocks depth-first in document order and places exactly one synthetic `\n` between adjacent blocks. UTF-16 offsets align with ProseMirror text positions, and the main-process search and renderer navigation checks share the same rules.
- A pure multi-tab state model with invariant validation for tab uniqueness, active-tab references, in-flight save consistency, and three-part asynchronous result validity; tab states use a discriminated union for TXT/DOCX.
- An asynchronous search/navigation protocol bound to `requestId` + workspace epoch + relative path + kind + revision + `locateId`. The App validates the live projection, and the DOCX host validates it again using the same rules. Late results/reports are safely ignored; stale navigation only shows a notice.
- Current-document DOCX find (TASK-010): a project-owned ProseMirror current-search plugin and per-tab controller using `PluginKey`, `DecorationSet`, single microtask scheduling, generation-based rejection of stale computations, and destruction cleanup. Live textblock projection reuses `joinDocxTextBlocks` with UTF-16-to-ProseMirror position mapping. Matching is literal, uses ASCII case folding, is non-overlapping, and has a 2,000/2,001 match budget. Replacement uses public transaction APIs: starting-character marks are inherited, Replace All runs in reverse order in one transaction, and `tiptapJsonToDocxModel` plus serialization-budget checks validate the candidate before dispatch. Narrow per-tab controls bind to a stable `tabId`; no new IPC/preload/DesktopApi is introduced.
- ESLint, Prettier, Vitest, and strict TypeScript checks.
- Component behavior tests using React Testing Library.
- A project-local portable Node.js/npm development toolchain.

### Not yet implemented

- Dark theme, a complete settings system, and persistent theme/font configuration.
- Tab drag-reordering, pinning, bulk closing, and state restoration.
- TXT/DOCX autosave and session recovery.
- Workspace replacement, batch replacement, regular-expression/fuzzy/semantic search, and a persistent full-text index.
- Complex Word formatting, including editing images/tables/headers/footers/comments/tracked changes, precise pagination, macros, and completely lossless round trips.
- File system watching and automatic refresh; external changes require a manual refresh.
- File copy/paste, batch file operations, and operations across workspaces or drives.
- Trusted Windows signing and a public binary release process.

## Quick start

### Automated tests (matching CI)

Run the following in order from the project root on Windows. If a step fails, resolve it before continuing:

```powershell
.\scripts\npm.cmd ci
.\scripts\npm.cmd exec -- install-electron --no
.\scripts\npm.cmd run build
.\scripts\npm.cmd run check
.\scripts\npm.cmd run test:e2e
```

The Electron binary must be prepared explicitly; `npm ci` does not do this. `npm test` and `npm run check` run only the regular tests. `npm run test:e2e` runs the Electron smoke tests separately and requires an installed Electron binary and an up-to-date `out/` build.

### Requirements

- The current development and internal-artifact baseline is Windows 10 x64. Theoretical compatibility has been audited; testing on an actual machine is deferred to a later development phase. Windows 11 is not yet included in the support matrix.
- Windows PowerShell 5.1 or later.
- Access to Node.js and npm download services for initial setup.

A global Node.js installation is not required. After cloning the repository, run from its root:

```powershell
.\scripts\bootstrap.cmd
.\scripts\npm.cmd ci
```

Then start the development environment:

```powershell
.\scripts\dev.cmd
```

The local Node.js installation lives in the Git-ignored `.tools/` directory and does not modify the system PATH or PowerShell execution policy. For mirrors and troubleshooting in restricted network environments, see the [development environment guide](./docs/development/DEVELOPMENT_ENVIRONMENT.en.md).

## Usage and verification

After the development window starts, the left sidebar shows the “尚未打开文件夹” (No Folder Open) empty state. Click “打开文件夹” (Open Folder) and choose a local folder in the native directory picker. The sidebar then displays the workspace name, path, and expandable file tree. Click directory names to expand or collapse them, and click “刷新” (Refresh) to rescan the current workspace.

Click any `.txt` file in the workspace tree, or activate it with the keyboard. The central area first shows a loading state, then a tab named after the file and its editable contents. Selecting several TXT files opens multiple tabs; selecting an already open file only activates its existing tab. Click tabs to switch while retaining each tab’s cursor, selection, scroll position, and undo history. Click “×” on a tab or press `Ctrl+W` to close it. After editing, the tab shows the unsaved indicator (●). Click “保存” (Save) or press `Ctrl+S` to save the active tab explicitly; saving an unchanged document does not write to disk. Missing files, files larger than 5 MiB, and non-UTF-8 files produce errors without affecting other tabs. Saving a file changed by another program reports an external conflict, preserves local content, and reloads the disk version only after confirmation. Saving preserves BOM and consistent LF/CRLF line endings; mixed line endings require confirmation before normalization. Closing an unsaved tab asks for “放弃修改/取消” (Discard Changes / Cancel). Switching workspaces or closing the window with unsaved tabs shows a combined confirmation containing the number of unsaved tabs; canceling leaves everything unchanged. Tabs being saved cannot be discarded by these actions, which instead ask the user to wait for saving to finish. After a successful workspace switch, no document is selected. Canceling a switch or refreshing the workspace preserves current tabs. Close the window or press `Ctrl+C` in the terminal to stop the development process.

Press `Ctrl+F` in an active TXT tab to open Find. Enter a query and use `F3`/`Shift+F3`, or the panel buttons, to move between matches. Enable “区分大小写” (Match Case) for case-sensitive matching. Press `Ctrl+H` to open the panel with focus in the replacement input. Replace the current match or all matches; replacements are undoable and enter the normal unsaved state. Click Search in the activity bar or press `Ctrl+Shift+F` to open workspace search. Enter a query and press Enter or click “搜索” (Search) to search both ordinary UTF-8 TXT files and canonical body text from basic DOCX files saved on disk in the current workspace. Results are grouped by file and show relative paths, TXT/DOCX type labels, line/column positions, and snippets, together with scanned/hit/matched/skipped counts and truncation notices. Click “取消” (Cancel) during a search to stop it; submitting a new query cancels the previous search. Clicking any TXT or DOCX match opens or activates the file’s unique tab. For a valid TXT result, the match is selected, scrolled into view, and focused. DOCX uses public ProseMirror APIs to position the selection after two checks of kind, revision, canonical projected range, and match text; read-only documents support navigation but not editing, and navigation in degraded documents does not automatically confirm compatibility. If the file was changed externally or its text/structure changed, only a “搜索结果已过期” (Search result is out of date) notice is shown, without incorrect navigation or content changes. Switching between Files and Search preserves the workspace, tabs, and expanded tree state.

Press `Ctrl+F` / `Ctrl+H` in an active DOCX tab to open the project’s shared Find and Replace panel. Entering a query immediately searches the live, unsaved text and highlights every match, with the current match identified by two classes. Use `F3`/`Shift+F3` or Enter/Shift+Enter to navigate with wraparound; Escape closes the panel and restores editor focus. Editable documents support Replace Current and Replace All. Replacement inherits formatting at the start of the match; Replace All is a single undoable transaction and is disabled when there are more than 2,000 matches. Replacements mark the document dirty and support subsequent undo/redo and explicit saving. Read-only documents support finding but not replacing. Degraded documents require compatibility confirmation tied to the current revision. Replacements during a save are not cleared when the earlier save completes. Renaming, moving, and Save As retain the find session with the stable tab.

Click an ordinary `.docx` file in the tree to show its loading state, followed by a unique tab with the Tiptap/ProseMirror rich text editor. A zero-byte `.docx` placeholder created by Windows/WPS opens as a blank document and becomes valid OOXML on its first save. Use the formatting toolbar above the tab for basic formatting, and save through the toolbar or `Ctrl+S`. Unsupported content such as images, tables, headers/footers, comments, or tracked changes triggers a compatibility warning. For `degraded` documents, click “确认继续编辑并保存” (Confirm to Continue Editing and Saving) before editing or saving; confirmation is tied to the revision at opening. Only documents with explicitly enabled `w:documentProtection` become `read-only` due to editing protection; WPS’s `w:enforcement="0"` does not trigger read-only mode. Before saving, a rolling backup named `<filename>.wenshu.bak` is created automatically in the same directory, and its filename appears in the status bar after success. A failed save, failed output validation, or failed backup leaves the original file unchanged. Changing an open DOCX in another program, such as Microsoft Word or WPS Office, causes an external conflict on save. Local edits are retained, and the disk version is reloaded only after confirmation. Corrupt, encrypted, disguised, oversized (over 20 MiB), or resource-budget-exceeding DOCX files show stable errors.

File management (Tasks 9/11): create TXT files, basic DOCX files, and folders through the compact “新建” (New) menu in the workspace header or the workspace root/folder context menu. Missing TXT/DOCX extensions are added automatically. Right-click a file or folder to rename, move, send it to the Recycle Bin, or reveal it in File Explorer. Keyboard alternatives include `F2`, `Delete`, `Shift+F10`, and the Menu key. Drag files/folders to ordinary directories or the root drop zone in the same workspace to move them. Copying, overwriting, moving across workspaces, and dragging files in from Windows File Explorer are unsupported. Save As for the current document is in the File menu and supports `Ctrl+Shift+S`. All operations continue to use Task 9’s safety controllers. On success, the file tree refreshes, tabs migrate without losing their state, and old workspace search results are invalidated.

Run all automated checks:

```powershell
.\scripts\npm.cmd run check
```

Verify the production build:

```powershell
.\scripts\npm.cmd run build
```

See the [testing guide](./docs/development/TESTING.en.md) for complete automated checks, manual UI acceptance steps, and production build verification.

## Common commands

| Action              | Command                              |
| ------------------- | ------------------------------------ |
| Start development   | `.\scripts\dev.cmd`                  |
| Full quality checks | `.\scripts\npm.cmd run check`        |
| Type checking       | `.\scripts\npm.cmd run typecheck`    |
| Lint                | `.\scripts\npm.cmd run lint`         |
| Format check        | `.\scripts\npm.cmd run format:check` |
| Unit tests          | `.\scripts\npm.cmd test`             |
| Production build    | `.\scripts\npm.cmd run build`        |

Production build output is written to `out/`. Internal Windows packaging and audit commands are documented in Task 12; these unsigned artifacts are not currently public.

## Roadmap

- [x] Task 1: establish a runnable, testable desktop application skeleton.
- [x] [Task 2: workspace folder selection and a read-only file tree](./docs/tasks/task-002/TASK_002_WORKSPACE_READONLY.en.md).
- [x] [Task 3: controlled UTF-8 TXT reading and a single read-only tab](./docs/tasks/task-003/TASK_003_TXT_READONLY.en.md).
- [x] [Task 4: basic single-TXT editing and safe saving](./docs/tasks/task-004/TASK_004_TXT_EDIT_SAFE_SAVE.en.md).
- [x] [Task 5: multiple TXT tabs and independent editing sessions](./docs/tasks/task-005/TASK_005_MULTI_TXT_TABS.en.md).
- [x] [Task 6: workspace TXT search and current-document find/replace](./docs/tasks/task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.en.md).
- [x] [Task 7: basic DOCX reading, editing, and safe saving](./docs/tasks/task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.en.md), complete; see the [TASK-007 completion report](./docs/tasks/task-007/TASK_007_COMPLETION_REPORT.en.md).
- [x] [Task 8: workspace DOCX body-text search and rich text result navigation](./docs/tasks/task-008/TASK_008_DOCX_WORKSPACE_SEARCH.en.md), complete; see the [TASK-008 completion report](./docs/tasks/task-008/TASK_008_COMPLETION_REPORT.en.md).
- [x] [Task 9: complete basic file management flow](./docs/tasks/task-009/TASK_009_BASIC_FILE_MANAGEMENT.en.md), complete; see the [TASK-009 completion report](./docs/tasks/task-009/TASK_009_COMPLETION_REPORT.en.md).
- [x] [Task 10: find and replace within the current DOCX](./docs/tasks/task-010/TASK_010_DOCX_FIND_REPLACE.en.md), complete; see the [TASK-010 completion report](./docs/tasks/task-010/TASK_010_COMPLETION_REPORT.en.md).
- [x] [Task 11: desktop shell, information architecture, and editing experience rework](./docs/tasks/task-011/TASK_011_UI_SHELL_INFORMATION_ARCHITECTURE.en.md). Implementation, automated quality gates, and final manual Windows acceptance all passed; see the [completion report](./docs/tasks/task-011/TASK_011_COMPLETION_REPORT.en.md).
- [x] [Task 12: Windows Alpha release engineering](./docs/tasks/task-012/TASK_012_WINDOWS_ALPHA_RELEASE.en.md). All 33/33 items in the current scope passed. MIT source publication preparation and unsigned Windows 10 x64 internal Alpha engineering are complete. Actual-machine validation is deferred to a later development phase; see the [completion report](./docs/tasks/task-012/TASK_012_COMPLETION_REPORT.en.md).

The task documents and [project technical baseline](./docs/architecture/PROJECT_BASELINE.en.md) define the detailed scope and technical constraints. These development records are available in Chinese and English.

## Documentation

The [documentation center](./docs/README.en.md) provides navigation by category, and the [Chinese documentation center](./docs/README.md) provides the Chinese entry point. Task specifications, development records, and acceptance reports are available in Chinese and English.

| Category                     | Entry points                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Releases and versions        | [Release documentation](./docs/releases/README.en.md) · [v0.1.0-alpha.1 release notes](./docs/releases/v0.1.0-alpha.1.en.md)    |
| Development and verification | [Development environment](./docs/development/DEVELOPMENT_ENVIRONMENT.en.md) · [Testing guide](./docs/development/TESTING.en.md) |
| Architecture and constraints | [Project definition and technical baseline](./docs/architecture/PROJECT_BASELINE.en.md)                                         |
| Task archives                | [Task index: specifications, execution records, and completion reports](./docs/tasks/README.en.md)                              |
| Planning and design          | [UI optimization plan (implemented in Task 11)](./docs/plans/FUTURE_UI_OPTIMIZATION_PLAN.en.md)                                 |

## Project structure

```text
.
├─ docs/
│  ├─ README.md           Chinese documentation center
│  ├─ README.en.md        English documentation center
│  ├─ releases/           Chinese/English release indexes and release notes
│  ├─ development/        Development environment and testing guides
│  ├─ architecture/       Project definition and technical baseline
│  ├─ tasks/              Task index and archives grouped under task-NNN
│  ├─ plans/              Design plans and implementation records
│  └─ visual-baselines/   UI visual baseline screenshots
├─ scripts/               Local toolchain and development command wrappers
├─ src/
│  ├─ main/
│  │  ├─ index.ts         Electron lifecycle, window creation, and security policies
│  │  ├─ workspace/       Workspace scanner, session state, file management services (create/rename/move/trash/reveal), and fixed IPC
│  │  ├─ document/        TXT reader, safe saver, Save As, path/write safety helpers, and controlled document IPC
│  │  ├─ docx/            DOCX read/import/export/safe-save services, Save As, ZIP inspection, and fixed DOCX IPC
│  │  ├─ search/          Mixed workspace TXT/DOCX search, fixed search IPC, and pure matcher
│  │  └─ window/          Window-close coordination (unsaved-change protection)
│  ├─ preload/            Controlled desktop API bridge
│  ├─ renderer/
│  │  ├─ components/      React UI components (shell/menu/toast, adjustable sidebar, tree context menus/dragging, dialogs, tabs, search, and editors)
│  │  ├─ lib/             Pure state models and document/workspace/file-management/search controllers (tab invariants, races, and mutationEpoch)
│  │  └─ styles/          Layered tokens/common/shell/workspace/document/search styles
│  └─ shared/             Pure cross-process type contracts (DOCX structured model, canonical body-text projection, file management contracts, and pure conversions)
├─ tests/                  Unit and component behavior tests
├─ README.md               Chinese project entry point and quick start
└─ README.en.md            English project entry point and quick start
```

## Technology stack

- Electron 43.6.0
- React
- TypeScript
- CodeMirror 6 (TXT editor)
- Tiptap / ProseMirror (DOCX rich text editor)
- Mammoth / JSZip / docx (DOCX import, ZIP inspection, and basic export)
- Vite / electron-vite
- Vitest + React Testing Library + Playwright Electron E2E
- ESLint / Prettier

## Development principles

- Prioritize the safety of local files and user data.
- Give the renderer no direct Node.js or file system permissions; expose desktop capabilities individually through controlled interfaces.
- Establish a simple, stable, working application before expanding file types, editing capabilities, and AI features.

See the [project technical baseline](./docs/architecture/PROJECT_BASELINE.en.md) for the complete design principles. The project is currently developed by an individual and has not yet established processes for external contributions, user support, or formal releases.
