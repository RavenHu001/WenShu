# WenShu testing guide

[简体中文](./TESTING.md) | English

[Development and testing](./README.en.md) · [Documentation](../README.en.md)

This guide covers automated checks, Windows desktop smoke tests, and manual acceptance for Tasks 1–12. Task 11 added a unified Chinese shell, design tokens and SVG icons, an adjustable/collapsible sidebar, file-tree context menus and keyboard commands, internal dragging within a workspace, a continuous centered DOCX canvas, toolbar overflow, search-result hierarchy, and toasts, without changing the file/save/search lifecycles from Tasks 1–10. Autosave, filesystem watching, and session recovery are still unavailable. Sections 3.5–3.8 retain the detailed existing checklists for Tasks 7–10. Sections 2.10 and 3.9 cover Task 11's shell, scaling, accessibility, and visual baselines. Section 2.11 covers Task 12's packaging gates, theoretical compatibility, and physical-machine validation boundaries; the [TASK-012 completion report](../tasks/task-012/TASK_012_COMPLETION_REPORT.en.md) is the final evidence source.

## 1. Prerequisites

- Windows 10 or Windows 11.
- Windows PowerShell 5.1 or later.
- Run commands from the repository root.

These describe the development/test environment. Task 12 portable/NSIS artifacts currently claim only theoretical Windows 10 x64 compatibility. Physical Windows 10 validation is deferred to a later development stage, and the Windows 11 matrix has moved to optional future work.

On first use, initialize project-local Node.js and dependencies:

```powershell
.\scripts\bootstrap.cmd
.\scripts\npm.cmd ci
```

Expected tool versions:

```powershell
.\scripts\node.cmd --version
.\scripts\npm.cmd --version
```

- Node.js: `v22.15.0`.
- npm: `10.9.2`.

For download failures, see mirror configuration and troubleshooting in the [development environment guide](./DEVELOPMENT_ENVIRONMENT.en.md).

## 2. Automated checks

Run the full quality check:

```powershell
.\scripts\npm.cmd run check
```

This command verifies, in order:

1. TypeScript types for Electron configuration, main process, preload, renderer, and tests.
2. ESLint static checks.
3. Prettier formatting.
4. Vitest unit tests.

Acceptance requires exit code `0`, no TypeScript/ESLint/formatting errors, and all tests passing.

To isolate a problem, run the checks separately:

```powershell
.\scripts\npm.cmd run typecheck
.\scripts\npm.cmd run lint
.\scripts\npm.cmd run format:check
.\scripts\npm.cmd test
```

### 2.1 Baseline gates before Task 4

Task 4 introduces writing user files for the first time. Before implementation, confirm:

- Windows checkout line-ending policy is explicit, and `format:check` passes repeatedly.
- Vitest workers, temporary directories, and symbolic-link capability probes do not time out or skip an entire test file.
- Environments without real symlink/junction support conditionally skip only the few affected integration cases, while mocks deterministically cover rejection branches.
- Task 2 and Task 3 tests actually run and pass.
- `check` and `build` run sequentially and both pass.

A controlled Windows environment check on 2026-08-04 found Prettier line-ending differences and Vitest worker/initialization timeouts. Task 4 WP0 must reproduce, identify, and resolve them, without deleting tests, skipping entire files, or merely increasing timeouts.

### 2.2 Baseline gates before Task 5

Task 5 expands single-document renderer state into multi-tab sessions without changing Task 4's filesystem permissions or safe-save protocol. Before implementation, confirm:

- `main` includes Task 4, and working-tree changes are identified and protected.
- Current `check` and `build` run sequentially and pass.
- TXT reading, saving, IPC, preload, workspace component, and window-close tests actually run.
- Single-tab editing, typing during saving, conflicts, mixed line endings, and unsaved-change protection are repeatable.
- Every Task 5 work package continues running full `check` and `build`; new multi-tab tests do not replace existing safety regressions.

The planning baseline on 2026-08-06 was 9 passing test files, 224 passing cases, and 2 real-symbolic-link cases conditionally skipped for local permissions, with a passing production build. Record actual implementation results in work-package reports; `TASK_005_COMPLETION_REPORT.md` is the final authority.

### 2.3 Baseline after Task 5

After all Task 5 work packages completed (see the [completion report](../tasks/task-005/TASK_005_COMPLETION_REPORT.en.md)), the measured baseline matched the plan:

- 11 test files passed, 305 cases passed, and 2 real-symbolic-link cases were conditionally skipped for local permissions; mocks deterministically cover rejection branches.
- Type checks across 5 tsconfigs, ESLint with --max-warnings=0, and Prettier all passed.
- Full `check` and `build` ran sequentially and passed.
- Task 4's reader 49, saver 51, document IPC 33, preload 13, window-close 8, and workspace-scan 11 cases all ran unchanged as regressions.
- Development and production desktop smoke tests passed, with live windows and no error logs.

### 2.4 Baseline gates before Task 6

Task 6 adds read-only main-process workspace search, cancellation, result navigation, and CodeMirror current-file find/replace. Before implementation, confirm:

- Task 5's baseline of 11 test files, 305 passing cases, and 2 conditional skips is repeatable.
- Full `check` and `build` run sequentially and pass.
- Workspace open/refresh, multi-tab identity, controlled TXT reading, safe saving, and unsaved-change protection have no regressions.
- Workspace search roots come only from main-process sessions; requests cannot contain root or absolute paths.
- Search data sources, fixed limits, cancellation, late results, and revision-expiry navigation rules are frozen according to section 4 of the [TASK-006 plan](../tasks/task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.en.md).
- Every work package runs full `check` and `build`; new search tests do not replace Task 1–5 regressions.

Before Task 6 is complete, section 3 of this guide accepts only Task 5's actual capabilities. After completion, Task 6 WP7 incorporates the search/find/replace checklist here according to task section 8.7.

### 2.5 Baseline after Task 6

After all Task 6 work packages completed (see the [completion report](../tasks/task-006/TASK_006_COMPLETION_REPORT.en.md)), the measured baseline matched the plan:

- 19 test files passed, 463 cases passed, and 3 real-symbolic-link cases were conditionally skipped for local permissions; mocks deterministically cover rejection branches.
- Type checks across 5 tsconfigs, ESLint with --max-warnings=0, and Prettier all passed.
- Full `check` and `build` ran sequentially and passed.
- All Task 1–5 tests ran unchanged and passed: reader 49, saver 51, document IPC 33, preload contract 16, window-close 8, workspace-scan 11, workspace component 22, tab invariants 23, tab transitions 32, and multi-tab component 64.
- Search contract 14, matcher 42, searcher 25, search IPC 26, search controller 14, sidebar 13, result navigation 12, and find/replace 9 cases all passed.
- Development and production desktop smoke tests passed, with live windows and no error logs.
- A near-limit TXT workspace measured about 66 ms to search 1000 files and about 3 ms to cancel on 2026-08-08; see performance observations in the completion report.
- The owner executed and passed every item in the section 8.7 manual UI checklist on 2026-08-08.

### 2.6 Baseline gates before Task 7

Task 7 first introduces untrusted DOCX ZIP/OOXML parsing, a structured rich-text model, Tiptap/ProseMirror sessions, backups before saving, and DOCX overwriting. Before implementation, confirm:

- Task 6's 19 test files, 463 passes, and 3 conditional skips are repeatable, or current environment differences have a verifiable explanation.
- Full `check` and `build` run sequentially and pass.
- Temporary Windows junction cleanup must not skip an entire reading-test file due to `EBUSY`; React component tests must not leave unawaited `act(...)` warnings.
- TXT reading, safe saving, multi-tab behavior, window closure, find/replace, workspace search, and navigation have no regressions.
- Privacy-safe DOCX fixtures are prepared according to section 3.3 of the [TASK-007 plan](../tasks/task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.en.md).
- Fixtures verify the minimum Mammoth, Tiptap/ProseMirror, `docx`, and JSZip flow, freezing the actual compatibility matrix, model budgets, and dependencies.
- The external Office application and version for manual validation are identified.
- Every Task 7 work package runs full `check` and `build`; DOCX tests do not replace Task 1–6 regressions.

Task 7 results (see the [completion report](../tasks/task-007/TASK_007_COMPLETION_REPORT.en.md)): the 19-file, 463-pass, 3-conditional-skip baseline was repeatable across work packages. WP0 fixed a one-time residual React `act(...)` warning, with its cause in the TASK-007 WP0 report; junction `EBUSY` did not recur. WP0 created 18 auditable DOCX fixtures and froze the compatibility matrix, model budgets, and dependencies: Mammoth 1.12.1, JSZip 3.10.1, docx 9.7.1, and Tiptap 3.29.2. External Office validation used Microsoft Word 16.0.20228.20158. Final full tests: 31 files, 722 passes, and 5 conditional skips, all for real-symbolic-link permissions.

### 2.7 Task 8 pre-implementation gates and completed baseline

Task 8 expands workspace TXT search into mixed TXT + DOCX search and rich-text navigation, adding canonical DOCX body projection, candidate classification, and two-level concurrency. Before implementation, confirm:

- Task 7's 31 files, 722 passes, and 5 conditional skips are repeatable, or environment differences have a verifiable explanation.
- Full `check` and `build` run sequentially and pass.
- TXT search/navigation/find/replace, DOCX read/edit/save, tabs, and window closure have no regressions.
- The sole semantic source for DOCX search is the canonical `DocxDocumentModel` body projection; never treat DOCX as UTF-8 TXT or directly search OOXML, Mammoth HTML, or editor DOM.
- Projection and public ProseMirror API validation are complete according to section 3.3 of the [TASK-008 plan](../tasks/task-008/TASK_008_DOCX_WORKSPACE_SEARCH.en.md); see `TASK_008_WP0_REPORT.md`.
- Every Task 8 work package runs full `check` and `build`; DOCX search tests do not replace Task 1–7 regressions.

Task 8 results (see the [completion report](../tasks/task-008/TASK_008_COMPLETION_REPORT.en.md)): all 8 work packages passed individual acceptance. Final tests: 38 files, 833 passes, and 6 conditional skips, all for real-symbolic-link permissions, with deterministic mock rejection coverage. Sequential `check` and `build` both exited 0. A near-limit workspace of 800 TXT + 200 DOCX measured about 1.5–1.7 s to search and about 8 ms to cancel. Development/production desktop smoke tests passed. The owner executed and passed the section 3.6 manual UI checklist.

### 2.8 Task 9 pre-implementation gates and completed baseline

Task 9 introduces workspace file management writes—create, Save As, rename, move, delete, and reveal—and search invalidation. Before implementation, confirm:

- Task 8's 38 files, 835 passes, and 6 conditional skips are repeatable, or environment differences have a verifiable explanation.
- Full `check` and `build` run sequentially and pass.
- Workspace open/refresh, TXT/DOCX read/edit/save, multi-tab sessions, unsaved protection, find/replace, mixed search, and navigation have no regressions.
- All writes and path changes bind to the current workspace held by the main process through fixed narrow IPC. The renderer cannot submit roots, absolute paths, or dangerous switches.
- Technical validation covers Windows names/conflicts/case, trashItem, showItemInFolder, empty DOCX export and Save As reuse points, stable tabId, and mutationEpoch according to section 3.3 of the [TASK-009 plan](../tasks/task-009/TASK_009_BASIC_FILE_MANAGEMENT.en.md); see `TASK_009_WP0_REPORT.md`.
- Every Task 9 work package runs full `check` and `build`; file management tests do not replace Task 1–8 regressions.

Task 9 results (see the [completion report](../tasks/task-009/TASK_009_COMPLETION_REPORT.en.md)): WP0–WP8 passed individually. WP7 fixed missing extension preservation/completion during rename/create. Final tests: **54 files, 1016 passes, and 10 conditional skips**, all for real symlink/junction permissions, with mock-adapter rejection coverage. Sequential `check` and `build` both exited 0. Development/production desktop smoke tests passed. Recycle Bin restoration, external locks, and case-only behavior have actual evidence in WP0/completion reports. The owner executed and passed the section 3.7 checklist, confirming “手动功能测试已通过” (manual functional testing passed).

### 2.9 Task 10 pre-implementation gates and completed baseline

Task 10 makes current-file find/replace a shared TXT/DOCX entry point and adds a project-owned ProseMirror find plugin, decorations, replacement transactions, and lifecycle semantics to DOCX sessions. Before implementation, confirm:

- Task 9's 54 files, 1016 passes, and 10 conditional skips are repeatable, or environment differences have a verifiable explanation.
- Full `check` and `build` run sequentially and pass.
- Current TXT find, workspace search/navigation, DOCX read/edit/save, tabs, path migration, and unsaved protection have no regressions.
- Minimum Tiptap/ProseMirror validation covers live textblock projection, cross-marks mapping, Decoration, replacement transactions, model prevalidation, read-only/degraded/saving states, and performance strategy according to section 3.3 of the [TASK-010 plan](../tasks/task-010/TASK_010_DOCX_FIND_REPLACE.en.md); see `TASK_010_WP0_REPORT.md`.
- Every Task 10 work package runs full `check` and `build`; current-DOCX-find tests do not replace Task 1–9 regressions.

Task 10 results (see the [completion report](../tasks/task-010/TASK_010_COMPLETION_REPORT.en.md)): WP0–WP7 passed individually. Final tests: **62 files, 1133 passes, and 10 conditional skips**, all for real symlink/junction permissions, with deterministic mock rejection coverage. Sequential `check` and `build` exited 0. Development/production Windows smoke tests passed, with WP6 performance and leak observations also recorded. The owner executed and passed the task's section 8 manual UI checklist, confirming manual testing passed.

### 2.10 Task 11 baseline and completed gates

Actual pre-change baseline: 62 files, 1133 passes, and 10 conditional skips; `check` and `build` exited 0. Technology and state decisions are frozen in `TASK_011_WP0_REPORT.md`.

Besides the complete Task 1–10 regression suite, Task 11's final automated gates add coverage for:

- Menu arrow keys/Tab/Enter/Escape/outside clicks/focus restoration and dialog focus trapping.
- Root/file/folder context command sets, dangerous-operation ordering, saving-state disabling, and stable path arguments.
- F2/Delete/F5/Ctrl+Shift+S, sidebar restoration from the activity bar, and editor shortcut regressions.
- File/directory dragging to directories/root, no-ops, self/descendants, same names, saving, invalid targets, pending duplicate prevention, stale epochs, and main-process failures.
- Stable tabId, editor/find sessions, mutationEpoch, and existing relocate/backup regressions.
- Sidebar clamping to 180–420 px, pointer/keyboard adjustment, and collapsing; DOCX canvas width and wide/narrow toolbar overflow.
- Accessible SVG/menu/toast/dialog names and forced-colors/reduced-motion entry points.
- Actual Electron screenshot script `scripts/capture-ui-baselines.mjs`, with outputs in `docs/visual-baselines/task-011/`.
- Background reconciliation refresh after file management success does not insert temporary status rows or rebuild the file tree. Manual refresh retains progress feedback; manual/background refreshes share single-flight deduplication to prevent flickering from rapid state changes. Late refresh results for the old root are discarded after a workspace switch.

Final results on 2026-08-22: **69 files, 1170 passes, 10 conditional skips**; typecheck, lint, format:check, test, check, and build all exited 0. Development and production Electron each had 4 processes alive for at least 10 seconds without startup errors, and 0 processes remained after cleanup. Fixed screenshots and scaling proxies were actually generated and inspected.

Follow-up fixes on 2026-08-27 added behavior regressions for window-level `Ctrl+F/H` and silent file management background refresh. Final totals were **69 files, 1175 passes, and 10 conditional skips**, with `check` and `build` exiting 0. The owner completed final manual acceptance from section 3.9 the same day, finding no issues with interactions, physical Windows display scaling at 100%/125%/150%, 200% text scaling, high contrast, reduced motion, screen readers, or real file operations.

See the Task 11 completion report for final counts, exit codes, and manual acceptance evidence. Screenshots or static CSS assertions must not replace important interaction behavior tests.

### 2.11 Task 12 WP8 acceptance results

After installing dependencies from a clean baseline and lockfile on 2026-09-09, final regular tests with Electron `43.6.0` reported **73 files, 1184 passes, 10 conditional skips, and 0 failures**. Typecheck, lint, format:check, test, check, build, package:dir, package:win, package:verify, and Electron E2E actually passed. E2E comprises 1 file and 4 cases: launch/About, exact-byte TXT saving, valid DOCX output and backup, and canceling dirty-window closure.

Internal Windows packages also require:

```powershell
.\scripts\npm.cmd run package:dir
.\scripts\npm.cmd run package:win
.\scripts\npm.cmd run package:verify -- --mode=win
.\scripts\npm.cmd run test:e2e
.\scripts\npm.cmd run release:manifest:unsigned
.\scripts\npm.cmd run release:verify:unsigned
```

`package:verify` reads the full unpacked tree and ASAR, rejecting source, tests, logs, environment files, credentials, userData, `app-update.yml`, and unpacked files missing from the ASAR index. It verifies x64, identity, runtime dependencies, and artifact names. Generate hashes only after both EXEs are `NotSigned`, then verify again.

All 33/33 current-scope WP8 items are closed. The acceptance host's kernel build 26200 is Windows 11 and cannot represent actual Windows 10 testing. On 2026-09-10 the owner deferred physical Windows 10 x64 validation to a later development stage, requiring only theoretical compatibility auditing now. Final 43.6.0 portable/NSIS checks of PE, architecture, Electron, NSIS, dependencies, and source-platform gates support Windows 10 x64. Installation/over-installation/uninstallation, paths, external workspace preservation, residue, security-product behavior, and existing Word/WPS document lifecycle acceptance have no known issues. The private repository uses GitHub Free; artifact attestation is unsupported and the actual reason is recorded. Main-push CI passed for exact product commit `98b05b4`. Theoretical auditing must not be described as physical Windows 10 testing. See the item-by-item mapping in the [TASK-012 completion report](../tasks/task-012/TASK_012_COMPLETION_REPORT.en.md).

## 3. Development-mode UI acceptance

Start the application:

```powershell
.\scripts\dev.cmd
```

Manually confirm:

- An Electron window appears and is not blank.
- The title and central welcome area show “文枢”.
- The top application menu, left activity bar, workspace sidebar, central welcome area, and bottom status bar are visible. File/Edit/View/Help menus provide functional commands.
- About WenShu shows the platform and Electron version; the status bar no longer shows runtime versions.
- With no workspace open, “尚未打开文件夹” (No Folder Open) and “打开文件夹” (Open Folder) are visible.
- Open Folder opens a native directory picker.
- Canceling does not report an error or clear an existing workspace.
- Successful selection shows the workspace name, path, and tree.
- Nested directories expand/collapse, with an explicit empty-directory state.
- Refresh reveals files added or deleted externally.
- Selecting another folder switches workspaces.
- Ordinary files, symbolic links, and other leaves initially show only names and types without reading content.
- The central area remains visible after resizing.
- The startup terminal contains no preload, React, or resource-loading errors.
- Closing the window exits the application normally.

### 3.1 TXT reading and editing acceptance

Prepare a test folder with nested directories and UTF-8 TXT files in both the root and subdirectories, preferably containing Chinese, multiple lines, and whitespace. Also prepare an empty TXT, a non-TXT file, and a TXT larger than 5 MiB.

- Click a root TXT: the central area first shows “正在读取 <文件名>…” (Reading), then one active tab named after the file with editable text.
- CodeMirror supports typing, deletion, copy/paste, undo, and redo.
- Expand a subdirectory and open nested TXT: content is correct and the tab title is the filename.
- Open empty TXT: the tab appears normally and its empty body accepts input.
- Quickly select two TXT files: two tabs appear, with the last selected active; see multi-tab semantics in 3.3.
- Click an unsupported file (neither TXT nor DOCX), directory, or symbolic link: no text is read and central content remains unchanged.
- Delete an unopened TXT externally, then click it: an error appears without crashing.
- Open TXT over 5 MiB or with non-UTF-8 encoding: a clear error appears, without partial content.
- Open a failing file while text is already displayed: existing text remains, with a nonblocking error banner.
- Refresh preserves visible editing content.
- Successful workspace switching clears old content and returns to the welcome state.
- Canceling a workspace switch retains old content.
- The developer console has no unhandled exceptions.
- No test files are created, modified, or deleted during testing, except in save cases.

### 3.2 Editing and saving acceptance

- The first edit adds an unsaved marker (●) to the tab and “未保存” (Unsaved) to the toolbar.
- Save and `Ctrl+S` use the same flow; saving without changes does not write.
- Saving displays “正在保存…” (Saving); repeated rapid saves do not write concurrently.
- After a successful save with no newer edits, the marker disappears and “已保存” (Saved) appears.
- Continue editing during a save: the earlier save's success retains the unsaved marker, and the next save uses the new revision.
- Failed saving, such as a read-only file or permission error, retains text and the unsaved marker and shows “保存失败” (Save Failed).
- Modify the open file in another editor such as Notepad, then save: “外部冲突” (External Conflict) appears, external bytes are not overwritten, and local text remains. Reload reads disk only after confirmation.
- Saving preserves BOM and consistent LF/CRLF styles.
- Saving mixed line endings first asks to confirm normalization, then uses the predominant style only after confirmation.
- Close a tab, switch workspaces, and close the window with unsaved changes: test both Discard Changes and Cancel. Cancellation retains text, files, workspace, and selection state.
- Typing after saving restores the unsaved marker.
- Refreshing the workspace retains current edits.
- No `.wenshu-*` temporary files remain in the workspace.

### 3.3 Multiple tabs and independent sessions

- Open three TXT files from different directories: tab order follows click order, and the last is active.
- Clicking an open file activates its existing tab without rereading or resetting text.
- Open same-name files at different paths: both tabs coexist, and `title` tooltips distinguish full paths.
- Type different content in different tabs and switch repeatedly: text and unsaved markers stay independent.
- Each tab has its own cursor, selection, scroll position, and undo history. Normal switching neither clears history nor marks dirty.
- Saving one tab does not clear another's marker. Switch to B and edit while A saves; both final states remain correct.
- Modify A externally, then save: A reports a conflict while B remains editable and savable.
- Closing clean tabs needs no confirmation; dirty tabs require Discard Changes / Cancel. The close button and `Ctrl+W` behave identically.
- Closing the active tab prefers the right neighbor, then the left if no right neighbor exists. Closing the last tab returns to welcome.
- With several dirty tabs, workspace/window-close confirmations include the unsaved-tab count; test discard and cancel.
- Saving tabs cannot be discarded by tab closure, workspace switching, or window closure; the UI asks users to wait.
- File-tree refresh does not affect open tabs.
- Open nearly 20 ordinary TXT files: the tab bar scrolls horizontally and switching has no noticeable wait.
- Developer console and startup terminal contain no unhandled exceptions or logs of text, absolute paths, or temporary filenames.

Task 6 has delivered workspace TXT search and current-file find/replace. At this recorded stage, autosave, DOCX editing, file management, and session recovery should still be absent.

### 3.4 Search and find/replace acceptance

Prepare a nested test workspace with multiple UTF-8 TXT files in root/subdirectories, including Chinese, English, emoji, LF, CRLF, blank lines, and long lines. Include same-name files at different paths, empty TXT, non-TXT, non-UTF-8, files over 5 MiB, symbolic links, unreadable directories/files, and a performance workspace with nearly 1000 small TXT files.

- In the active tab, `Ctrl+F` opens Find and `Ctrl+H` focuses replacement. Literal queries, case options, previous/next, Replace Current, and Replace All work.
- Finding does not change content or mark dirty. Replacements mark dirty, support undo/redo, and allow explicit saving.
- Switching tabs preserves independent queries, current matches, selection, and undo history. Closing tabs or switching workspaces cleans up the corresponding find sessions.
- Existing `Ctrl+S`, `Ctrl+W`, undo/redo, and session-preservation behavior have no regressions.
- Search in the activity bar or `Ctrl+Shift+F` opens the sidebar; no workspace means an empty state and no request.
- Search ordinary Chinese, English, and emoji: result coordinates/snippets are correct. No-results, cancellation, rapid consecutive queries, and limits have clear states.
- A failed file does not block others; skipped counts are shown.
- Click results for unopened, open, same-name/different-path, and loading files: open/activate one unique tab, then select, scroll to, and focus a still-valid match after reading completes.
- Externally modify a file or change an open tab's text range after searching, then click an old result: show only “搜索结果已过期” (Search Result Is Out of Date), without incorrect positioning or content changes.
- Switch workspaces during search: old results never appear. The UI remains usable near 1000 files, with cancellation taking effect in reasonable time.
- Console/terminal contain no unhandled exceptions or logs of queries, matched text, absolute paths, or file handles. Search creates no workspace cache, index, or temporary files.
- Development and production builds pass the same key smoke paths.

### 3.5 DOCX acceptance checklist (Task 7 incorporated)

> Task 7 is complete; see its [completion report](../tasks/task-007/TASK_007_COMPLETION_REPORT.en.md). This is the manual DOCX UI checklist; automatable coverage is established in `tests/docx/` and `tests/document/docx-*.test.tsx`.

Prepare the ordinary, complex, corrupt, over-budget, and round-trip DOCX fixtures from section 3.3 of the [TASK-007 plan](../tasks/task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.en.md), and at least one external Office application, locally Microsoft Word 16.0.20228.20158.

- Ordinary `.docx` files are selectable in the tree. Directories, symbolic links, `.docm`, disguised extensions, and other types do not trigger DOCX reading.
- Ordinary DOCX shows loading, then one unique tab displaying paragraphs, headings, bold, italic, underline, basic sizes, colors, lists, and alignment.
- Chinese, English, emoji, empty paragraphs, and multiple paragraphs display correctly. Ordinary documents open within seconds while the UI stays usable.
- A zero-byte `.docx` created by Windows/WPS but not yet materialized opens blank, accepts input, and saves for the first time. Output is valid and reopenable, and its rolling backup preserves the original zero-byte placeholder.
- Ordinary WPS DOCX containing `<w:documentProtection w:enforcement="0"/>` remains editable. Protection with `enforcement="1"`, `true`, or `on` makes it read-only.
- Corrupt/encrypted files, missing key OOXML parts, files over 20 MiB, or decompression/model budget violations show stable errors without partially editable content.
- Images, tables, headers/footers, comments, tracked changes, equations, or embedded objects produce deterministic compatibility levels and warnings. `degraded` requires confirmation before editing or first saving; `read-only` cannot save.
- Basic formatting controls, copy, cut, paste, undo, and redo work. No actual change means no dirty state.
- TXT/DOCX can be open together; text, selection, scrolling, history, dirty, save, and error states are independent per tab.
- Inactive DOCX tabs do not participate in layout. Switching among TXT/DOCX tabs shows only the current document.
- External reload compares the complete structured model: even with identical text, changes to bold, italic, color, size, or alignment update the editor. Reload itself does not mark dirty.
- Save and `Ctrl+S` use the same DOCX flow; clean tabs do not write, and the same tab never saves concurrently.
- Before saving, create same-directory `<文件名>.wenshu.bak` containing the original file immediately before that save. Failed backup leaves the target unchanged. Backups persist but stay hidden in the workspace tree.
- Saving has explicit feedback. Continued editing during saving is not cleared by the earlier save's success.
- Externally modify the open file in Office, then save: WenShu reports a revision conflict without overwriting external content or losing local edits.
- Inject export, output-validation, temporary-write, sync, close, or replacement failure: the original DOCX remains openable in external Office, and editor content/dirty state remain.
- After saving, WenShu and external Office both reopen the output, with supported text/formatting matching the compatibility matrix.
- Dirty DOCX retains confirmations for tab closure, workspace switching, and window closure. Saving DOCX is never discarded.
- No new `.wenshu-*` temporary files remain, apart from rolling backups.
- No remote relationship requests occur; macros, scripts, and embedded content never execute.
- Console/terminal contain no unhandled exceptions or logs of document text, OOXML, absolute paths, Buffers, handles, or temporary names.
- Development and production pass the same key paths; record external Office name, version, and observations.

2026-08-11: the owner used WPS Office for the latest manual acceptance. Bidirectional open/save, conflicts, backup restoration, Chinese italic text, and tab isolation all passed. The specific WPS version was not recorded.

### 3.6 Workspace DOCX search and rich-text navigation (Task 8 incorporated)

> Task 8 is complete; see its [completion report](../tasks/task-008/TASK_008_COMPLETION_REPORT.en.md). This is the manual DOCX search/navigation checklist; automatable coverage is in `tests/search/` for mixed search/navigation/lifecycle and `tests/document/` for the host's second validation.

Prepare a mixed workspace with UTF-8 TXT and DOCX in root/subdirectories: ordinary, WPS-generated, read-only, degraded, corrupt, zero-byte placeholders, and same-name/different-path files. Also prepare a performance workspace near 1000 total files, including nearly 200 DOCX.

- Search in the activity bar or `Ctrl+Shift+F` opens the sidebar; no workspace means an empty state and no search.
- One query searches TXT and DOCX together. Results group by file with relative path, TXT/DOCX label, 1-based line/column, and safe snippets. DOCX coordinates are explicitly extracted-text coordinates, with a notice that they are not Word page coordinates.
- Chinese, English, emoji, and the case toggle work. No-results, cancellation, consecutive queries, and truncation, including the DOCX candidate limit, have clear states.
- Scanned/hit/matched/skipped statistics are accurate. Corrupt, over-budget, encrypted, or disguised individual files become skips without blocking other results.
- Click DOCX results for unopened/open/loading/dirty/read-only/degraded files: open/activate one unique tab and navigate. Read-only permits navigation but not editing; degraded navigation does not confirm compatibility automatically. Dirty files remain dirty and can navigate when the original range is unchanged.
- Selections are accurate for paragraphs, headings, formatting across runs, bulleted/numbered/nested lists, and emoji.
- Formatting-only changes to bold/italic/size/color/alignment preserve projection and still permit navigation. Insertions/deletions before a match, structural changes, out-of-bounds ranges, or text mismatches show only the expired-result notice, without incorrect navigation or content changes.
- Modify the file externally in Office, then click an old result: only expiry is reported, covering Word/WPS external modification → revision change.
- Switch workspaces or close the window during search: old results do not appear, tasks clean up, and tabs/unsaved protection remain correct.
- Near 1000 total files including nearly 200 DOCX, the UI remains usable and cancellation takes effect within reasonable time.
- Console/terminal contain no unhandled exceptions or logs of queries/matches, OOXML, absolute paths, or handles. No backups, indexes, caches, or temporary files are created in the workspace.

### 3.7 File management acceptance (Task 9 incorporated)

> Task 9 is complete; see its [completion report](../tasks/task-009/TASK_009_COMPLETION_REPORT.en.md). This is the manual file management checklist; automatable coverage is in `tests/workspace/` for UI, relocate/trash controllers, and mutationEpoch lifecycle, `tests/file-management/` for contracts/parsing, and `tests/document/` for Save As/path migration.

Prepare a workspace with nested directories and TXT, DOCX, and ordinary files in root/subdirectories. Also prepare Word/WPS or another program that can hold files open.

- Create TXT, basic DOCX, and folders in the root and selected folders. TXT/DOCX automatically open as unique clean tabs that can be edited/saved; new folders remain selected and expandable.
- Names without extensions automatically gain `.txt`/`.docx`, such as `会议纪要` → `会议纪要.txt`. Other extensions are rejected while retaining input.
- Creating an existing name shows Target Already Exists without overwriting or automatic renaming.
- Save As selects a workspace target folder and name. Missing targets are safely created; existing targets require overwrite confirmation. External target modification during confirmation requires reconfirmation.
- Successful Save As preserves the source file and migrates the current tab to the new path, retaining cursor/selection/undo history. Tabs edited during saving remain dirty.
- Rename files and folders, including Windows case-only changes. TXT/DOCX extensions are preserved automatically; changing to another extension is rejected. Open documents retain tab order, active state, dirty, text/model, and editor session.
- Move files/folders to other workspace directories. Directories cannot move into themselves or descendants. All open descendant tabs migrate paths when their directory moves.
- Delete files and nonempty directories: first confirm path, type, and affected unsaved-tab count. Success sends items to the Windows Recycle Bin, where restoration works. Dirty deletion requires explicit discard; saving blocks deletion and asks the user to wait.
- Failed deletion due to permissions/locks neither closes tabs prematurely nor falls back to permanent deletion.
- Reveal files, directories, and the workspace root in File Explorer without exposing arbitrary shell access.
- Successful create/Save As/rename/move/delete automatically refreshes the tree, immediately clears completed workspace search results, and cancels in-flight searches. Failures, cancellation, and Reveal preserve valid results.
- Rapid repeated clicks do not cause concurrent writes; buttons are disabled while submitting.
- Hold a file exclusively in Word/WPS/Notepad or another external program, then delete/rename it: show a stable error without crashing or leaving partial output.
- Cancellation restores focus to the triggering control. Errors retain input for correction/retry. Partial failure, such as document and backup not both being deleted, shows Operation Partially Completed and forces refresh.
- No `.wenshu-*` temporary files remain. DOCX backups follow the required location rules: `<目标>.wenshu.bak` or beside the original file.
- Console/terminal contain no unhandled exceptions or logs of document text, absolute paths, temporary names, or raw exceptions.
- Development and production pass the same key smoke paths.

### 3.8 Current-DOCX find/replace acceptance (Task 10 incorporated)

> Task 10 is complete; see its [completion report](../tasks/task-010/TASK_010_COMPLETION_REPORT.en.md). This is the manual current-DOCX find/replace checklist. Automated coverage is in `tests/search/` for panel/App integration/lifecycle, `tests/document/` for plugin/replacement/path migration, and `tests/docx/` for pure modules and WP6 performance/leak observations.

In the active DOCX tab, test ordinary/read-only/degraded/dirty/saving/save-error/conflict states:

- `Ctrl+F` opens Find and Replace focused on the query; `Ctrl+H` focuses replacement. TXT/DOCX share one entry, showing only the active kind's panel.
- An ordinary single-line query immediately searches live unsaved text: paragraphs, headings, cross-mark runs, bulleted/numbered/nested lists, Chinese, and emoji. Counts show match n of m; more than 2000 matches show truncation.
- Ordinary/current highlights are distinguishable, with current identity not relying only on color. `F3`/`Shift+F3`, Enter/Shift+Enter, and buttons navigate cyclically, setting selection, scrolling, and focusing. Escape closes the panel and restores focus.
- Find/navigation/panel toggling do not change content, mark dirty, or enter undo history. Read-only permits find but not replacement and explains why.
- Unconfirmed degraded permits find but not replacement and explains why. Confirm Continue Editing and Saving for the current revision; replacement then works in the same editor. Reloading a different revision invalidates confirmation and disables replacement again.
- Editable DOCX supports Replace Current/All. Commands revalidate live ranges at execution. Nonempty replacement inherits the starting character's formatting; when crossing different marks, only starting marks are used. Headings/lists/alignment and surrounding formatting remain. Replace All is one undoable/redoable transaction; 0 matches is a no-op, 2001+ is rejected entirely without partial replacement, and model-budget failure causes 0 changes.
- Successful replacement marks dirty and supports explicit saving through the existing revision-conflict, rolling-backup, safe-replacement flow. Replacing during saving stays dirty after the earlier save completes.
- Queries, options, current matches, decorations, and history remain independent across TXT/DOCX tabs. Reopening a closed tab starts a new session; workspace switching cleans all sessions and panels.
- Rename/move/Save As preserve find sessions and decorations without editor recreation. Workspace navigation and mutationEpoch changes do not contaminate current-find state.
- Console/terminal contain no unhandled exceptions or logs of queries/replacements, document text, or absolute paths. No new temporary residue remains.
- Development and production pass the same key smoke paths.

### 3.9 Task 11 shell, scaling, and interaction acceptance

Fixed screenshot sizes: `1280×820`, `900×600`. In normal mode, run:

```powershell
.\scripts\npm.cmd run build
.\scripts\npm.cmd exec -- electron .\scripts\capture-ui-baselines.mjs
```

Manually verify:

- Only one Chinese menu appears at the top. File/Edit/View/Help commands are real; About shows platform/Electron, and the status bar no longer shows versions.
- Files/Search use SVG with tooltips/accessible names and no fake Settings entry. The sidebar drags to 180/420 px, supports Home/End adjustment, and collapses/restores.
- Empty workspaces, long trees, 20-level directories, long filenames, and multiple tabs have no editor horizontal overflow or unreachable actions at 1280×820 and 900×600.
- Root/blank-area/file/folder context menu contents and enabled states are correct. Shift+F10/Menu key, arrows, Enter, Escape, outside clicks, and focus restoration work.
- F2, Delete, F5, and Ctrl+Shift+S do not bypass saving, dirty, confirmation, conflict, or permission gates. Ctrl+F/H/S/W and undo/redo have no regressions.
- Dragging files/directories to directories/root succeeds. Current-location drops are no-ops; self/descendants, same names, saving, and invalid types are rejected. Escape/dragend/window blur/workspace changes clean up; failures show persistent errors.
- After drag/rename/move/delete/Save As, stable tabId, dirty, selection, scrolling, undo, current find, DOCX backup, and workspace-search invalidation semantics are correct.
- DOCX is a continuous centered writing column without a pagination promise; narrow toolbars show More Formatting. TXT stays full-height.
- Search results use file → match hierarchy, emphasizing snippets over coordinates. Ordinary/current matches and input/button focus are distinguishable.
- Success toasts are timed and dismissible; errors/conflicts/partial failures do not disappear automatically. Menus, icon buttons, drop targets, toasts, and dialogs have explicit names.
- Repeat core paths with Windows display scaling at 100%/125%/150%, 200% text scaling, high contrast, and reduced motion.

Physical display scaling changes Windows session-level settings; automated environments must not change it without authorization. If the current session cannot switch scaling, retain Pending Project Owner Confirmation in the completion report, rather than claiming a pass.

The owner executed and confirmed all these Task 11 manual checks on 2026-08-27. Final evidence is in the [TASK-011 completion report](../tasks/task-011/TASK_011_COMPLETION_REPORT.en.md).

## 4. Production-build acceptance

Generate the production build:

```powershell
.\scripts\npm.cmd run build
```

Acceptance requires exit code `0` and these key outputs:

```text
out/
├─ main/index.js
├─ preload/index.js
└─ renderer/
   ├─ index.html
   └─ assets/
```

Run the production build:

```powershell
.\scripts\npm.cmd exec -- electron .
```

The production window should match development: one Chinese menu, activity bar, adjustable sidebar, editor, and visually subdued status bar. Besides Task 7–10 DOCX/search/file management/current-find paths, verify context menus, keyboard commands, internal dragging, DOCX toolbar overflow, toasts, and collapse/restoration according to 3.9. Closing the window ends the process.

## 5. Security boundary checks

The current stage must continue satisfying:

- `BrowserWindow` uses `nodeIntegration: false`.
- `contextIsolation: true`.
- Sandbox remains enabled.
- Preload exposes only read-only runtime data, fixed `workspace.open()` / `workspace.refresh()`, `document.readText(relativePath)` / `document.saveText(request)`, and the narrow `window` close-coordination protocol: `setDirtyState` / `requestClose` / `cancelClose` / `onCloseRequested`.
- The renderer does not directly import Node.js filesystem APIs.
- Neither `ipcRenderer` nor a general IPC invoker is exposed to the renderer.
- Workspace IPC does not accept renderer-supplied absolute paths.
- `document.readText` and `document.saveText` accept only canonical relative paths from the tree snapshot; the main process rechecks format, boundaries, symbolic links, type, size, and UTF-8.
- Reading uses only read-only filesystem APIs: `lstat`, `realpath`, and bounded `read`.
- TXT saving revalidates workspace/path, detects SHA-256 content-version conflicts and returns `CONFLICT` without writing on mismatch, then uses a same-directory exclusive temporary file, complete write, `sync`, close, and same-filesystem `rename`. Failure never deletes or truncates the original and attempts temporary-file cleanup.
- Save IPC rejects extra dangerous fields, including workspace root, absolute targets, temporary paths, encoding, and replacement strategy, and validates arguments at runtime.
- Window-close coordination gains no document content, workspace root, or general IPC capability.
- Cross-process results contain no raw exceptions, Buffers, file handles, or stacks.

Task 7 implemented and continuously verifies:

- Preload adds only fixed `document.readDocx(relativePath)` / `document.saveDocx(request)`, with no ZIP, OOXML, arbitrary HTML, or general filesystem capability.
- DOCX requests reject workspace roots, absolute paths, temporary/backup paths, forced overwrite, or skip-backup policies, using IPC field allowlists and runtime model validation.
- The main process treats DOCX as untrusted ZIP, enforcing fixed budgets for compressed size, entries, decompressed size, key XML, and the intermediate model.
- External relationships are not accessed; macros, scripts, fields, and embedded objects do not execute.
- DOCX saving checks original-byte revisions, creates same-directory rolling backups, revalidates generated output, writes an exclusive temporary file, runs `sync`, closes, and safely replaces.
- Failed backup, failed output validation, or another revision change before replacement must not modify the target.
- Cross-process results contain no raw OOXML, unsanitized HTML, library/Tiptap instances, Buffers, handles, or stacks.

Task 8 implemented and continuously verifies:

- Preload reuses only fixed `search.textWorkspace(request)` / `search.cancelTextWorkspace(request)`, with no general IPC. Requests reject roots, absolute paths, glob, extension, encoding, concurrency, and resource-budget fields.
- Search roots come only from main-process `workspace-session`. Traversal does not follow symlinks/junctions, and each candidate read repeats controlled validation, using `readTextDocument` for TXT and `readDocxDocument` for DOCX.
- DOCX search text comes only from valid `DocxDocumentModel` canonical body projection in `src/shared/docx-search-text.ts`, never UTF-8 treatment of DOCX or direct OOXML/Mammoth HTML/editor DOM search.
- Fixed limits: 1000 total candidates including 200 DOCX, 200 matches per file, 2000 total matches, query length 256, concurrency 4 overall and 2 DOCX, with fixed truncation-reason priority.
- Search is read-only: no write/create/rename/delete API calls and no backups, temporary files, indexes, or caches.
- Navigation must pass two checks of kind/revision/range/match text—the App's live projection and the DOCX host's same-rule projection—then use public ProseMirror selection/scroll/focus commands. Expiry, structural changes, or mapping failures only show nondestructive notices.
- Queries, matched text, full projections, models, raw exceptions, and absolute paths never enter logs or cross-process errors.

Task 9 implemented and continuously verifies:

- Preload adds only fixed `createText/createDocx/createDirectory/relocate/trash/reveal/saveTextAs/saveDocxAs`, with kind injected by preload. It exposes no ipcRenderer, general invoke, or arbitrary channels. Exact-shape validation rejects extra fields, roots/absolute paths, temporary/backup paths, shell arguments, and dangerous `force`/`overwrite`/`skipValidation` switches.
- Workspace roots come only from main-process `workspace-session`, with handlers bound to the sending window. Its mutation coordinator serializes writes to at most one in-flight write per window.
- Create/Save As targets undergo segment-by-segment lstat/realpath for source and target, rejecting any symlink/junction and enforcing realpath boundaries. Existing targets return `TARGET_EXISTS` under exclusive creation, without overwrite or auto-rename. Publication uses same-filesystem rename after revalidation.
- Writes use an exclusive temporary file in the target directory, a complete write, `sync`, close, and publication without overwrite; failures attempt cleanup. Windows case-only rename uses an unpredictable intermediate name, two steps, and rollback.
- DOCX Save As/rename preserve validation and backup semantics: overwrite creates a target rolling backup first; rename/move migrates accompanying `<源>.wenshu.bak`; failure rolls back or explicitly reports `PARTIAL_FAILURE`.
- Deletion consistently calls injectable `shell.trashItem`, Electron shell.trashItem in production. Fallback to permanent unlink/rm/rmdir is prohibited. Root/link/other/internal recovery-file deletion is rejected.
- Save As uses two-phase confirmation: an existing target first returns only `TARGET_EXISTS` and its controlled revision. The second confirmed request must carry `expectedTargetRevision`; recompare before publication, returning `CONFLICT` and requiring confirmation again if changed.
- Successful create/save-as/relocate/trash increments `mutationEpoch`, cancels active search, and clears completed/cancelled/error results and navigation. Failures, cancellation, reveal, and failed refresh do not increment. Late results validate requestId + workspaceEpoch + mutationEpoch together.
- Cross-process results contain no text, models, absolute paths, temporary names, raw exceptions, or stacks, and logs do not leak them.

Task 10 implemented and continuously verifies:

- The preload/IPC/DesktopApi set did not expand: 17 fixed `ipcMain.handle` registrations remain, workspace 6 + document 4 + save-as 2 + search 2 + window 3. Preload contract tests pass. Queries, replacement text, match ranges, and document content do not cross IPC or enter logs.
- Current-DOCX-find text comes only from the active Tiptap/ProseMirror live document, without disk reads, old-model search, or OOXML/Mammoth HTML/editor DOM parsing.
- Find/navigation/panel closure dispatch only non-document transactions, selection + plugin meta, without edits, dirty, or undo entries. Replacement uses public transactions and validates candidate structure/serialization budgets with `tiptapJsonToDocxModel` before dispatch; failure means 0 dispatch and 0 dirty.
- Replacement permission derives from shared tab state and is defensively enforced inside commands for read-only, unconfirmed degraded, or noneditable editors. Disabled buttons are not the sole protection.
- Replace All handles at most 2000 items in one reverse-order transaction with one undo/redo. 2001+ matches or model-budget violations reject the whole operation without partial replacement.
- Per-tab find state binds to stable tabId. Rename/move/Save As do not recreate editors. Tab closure, workspace changes, and editor destruction clean plugin subscriptions and controls. No timers are used, only microtask scheduling.
- Queries, replacement text, document text, full models, and absolute paths are not logged. No third-party dependency is added.

These constraints are verified through code review, type isolation, unit tests, and real window launches together. New desktop capabilities should have separate interfaces and tests for each concrete use case.

## 6. Recommended acceptance order

```powershell
.\scripts\bootstrap.cmd
.\scripts\npm.cmd ci
.\scripts\npm.cmd run check
.\scripts\npm.cmd run build
.\scripts\dev.cmd
```

Do not run `check` and `build` in parallel: electron-vite creates temporary configuration files during builds, which can race unnecessarily with ESLint scanning.
