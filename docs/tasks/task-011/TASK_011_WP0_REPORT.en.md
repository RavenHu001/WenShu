# TASK-011 WP0 report: UI baseline, event model, and frozen risks

[简体中文](./TASK_011_WP0_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Execution date: 2026-08-22; branch: `TASK-011`; starting commit: `5eea921`; working tree: clean.
> Platform: Windows / PowerShell. Node.js, Electron, and dependencies follow the current lockfile.

## 1. Required reading and code review

Read all materials required by the Task 11 development prompt: README, project baseline, future UI plan, Task 9/10 plans and completion reports, Task 11 plan, and testing guide. No `AGENTS.md` applicable to this directory was found.

Reviewed renderer App, workspace/tree/file management dialogs, tabs/editors/DOCX toolbar, search components and their controllers; shared workspace/file management/DesktopApi contracts; fixed preload mappings, main-process file management IPC and relocate service; and Task 9/10 controller, component, stable tabId, path migration, search invalidation, and lifecycle tests.

Frozen conclusion: Task 11 adds no filesystem IPC and changes neither preload nor DesktopApi. Context-menu, keyboard, and drag actions all enter existing `useFileManagement` / `useDocuments` flows. The main process retains final authority over paths, links, revisions, backups, and safe publication.

## 2. Pre-change quality baseline

| Command                       | Result                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `.\scripts\npm.cmd run check` | Passed; 62 test files; 1133 passed / 10 skipped; exit 0                                         |
| `.\scripts\npm.cmd run build` | Passed; main 154.91 kB, preload 4.10 kB, renderer CSS 27.84 kB, renderer JS 2,206.54 kB; exit 0 |

All 10 skips are existing real symlink/junction permission conditions, with rejection branches covered by mock adapters. Three stderr messages are expected records from existing injected temporary-file cleanup failures. No baseline issue required weaker assertions, longer timeouts, or new skips.

## 3. Pre-change page and state matrix

| Area              | Current state                                                                | Frozen Task 11 target                                                                                  |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Top               | Electron's default English menu and renderer Chinese placeholder coexist     | Remove default menu in main; one Chinese renderer menu with real commands and keyboard access          |
| Activity bar      | Single-character `文 / 搜 / 设` placeholders; Settings disabled              | Project-local SVG; Files/Search tooltips and accessible names; no falsely usable Settings entry        |
| Workspace sidebar | Fixed 238 px; bottom wall of file management buttons crowds the tree         | Adjustable 180–420 px; collapse/restore; tree context menus, keyboard, and drag actions                |
| File tree         | Letter type icons; expansion and management selection already separate       | SVG, ellipsized long paths, deep horizontal scrolling; right-click/Shift+F10/Menu key; internal moving |
| Tabs and status   | Active state mainly a thin top line; dirty only a dot; wide save-status text | Active background, combined dirty/saving/error states, accessible names, compact document status       |
| DOCX              | Full-width editor surface; crowded single-row toolbar                        | Centered limited-width canvas, grouped toolbar, fixed narrow-window overflow policy                    |
| TXT               | Full-height CodeMirror                                                       | Keep full height without simulating paper                                                              |
| Search            | Complete workspace/current-find features with inconsistent control hierarchy | Shared input/button/status language, file → match hierarchy, snippet priority                          |
| Feedback          | Success/error banners near sidebar toolbar                                   | Timed dismissible success toasts; traceable errors/conflicts/partial completion                        |
| Status bar        | Saturated primary color; persistent Electron version                         | Subdued status bar; runtime version moves to About                                                     |

States requiring ongoing coverage: empty, loading, active, management selection, hover, focus-visible, dirty, saving, save-error, conflict, read-only, degraded, search truncation, success toast, persistent error, confirmation, and drag allowed/forbidden/pending.

## 4. Fixed sizes and visual evidence strategy

- Fixed windows: `1280×820` and minimum `900×600`.
- Windows manual matrix: display scaling 100% / 125% / 150%, text scaling 200%, high contrast, and reduced motion.
- The automation environment has no existing reliable Electron pixel-comparison foundation. Task 11 will not represent jsdom style-class assertions as real screenshot passes. Use deterministic component/layout behavior tests, and in WP5 supply real Electron empty-workspace screenshots if capturePage works reliably, plus complete reproducible manual capture instructions. Workspace-content states that cannot be automated must be explicitly marked for manual checking.

## 5. Menu technology and event model

Use testable, accessible renderer menus, with main-process `Menu.setApplicationMenu(null)` removing Electron's default menu. Reasons:

1. Chinese menu state derives directly from product state: active tab, saving, workspace availability.
2. Component behavior tests can deterministically verify arrow keys, Enter, Escape, focus trapping, and restoration.
3. No general menu IPC or expanded preload permission is needed.
4. Tree context menus reuse the same primitives and fixed command descriptions.

Event model: menus use stable command IDs and optional canonical `relativePath` targets. Capture the triggering element when opening. Closing reasons include a command, Escape, outside pointer, window blur, target unmount, and workspace epoch changes. Restore focus only if the element remains connected. Register global listeners only while open and remove them during effect cleanup.

## 6. File-tree keyboard and commands

- `Enter`: open ordinary TXT/DOCX; expand/collapse directories.
- `F2`: open the existing rename dialog for ordinary files/directories.
- `Delete`: open existing Recycle Bin confirmation for ordinary files/directories.
- `Shift+F10` / `ContextMenu`: open a menu for the current stable entry.
- `F5`: refresh through App's manual entry point; advance mutationEpoch only on success.
- `Ctrl+Shift+S`: use the existing save-as controller without bypassing loaded/read-only/saving gates.
- `Escape`: according to priority, close menus, cancel dragging, or exit the current nonmodal interaction. Window listeners must not steal existing editor Escape behavior.

## 7. Drag state machine

```text
idle
  -> dragging(sourcePath, sourceKind, workspaceEpoch)
       -> target(allowed | noop | forbidden, targetDirectory)
       -> Escape / dragend / unmount / workspace change -> idle
       -> drop allowed -> pending(mutationId, captured source/target/epoch)
            -> succeeded -> relocate commit + tab path migration + mutationEpoch + toast -> idle
            -> rejected/error -> stable persistent error -> idle
            -> late result (epoch/path/operation mismatch) -> ignore + refresh if disk may have changed
```

Immediate pure checks cover only ordinary file/directory types, saving, current-location drops, self/descendant directory moves, snapshot name conflicts, and target types. Main-process `relocate` remains the final authority for links, realpath, external races, existing targets, accompanying backups, and partial failure. Pending blocks duplicate drops. `DataTransfer` carries only application-internal MIME and canonical relative paths, rejects Windows Explorer file lists, and logs no absolute paths or document text.

## 8. Risks and mitigation

| Risk                                           | Mitigation                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Menus/shortcuts bypass saving or confirmation  | Commands call existing controllers; pure functions derive menu capabilities; controllers/main remain defensive       |
| Dragging uses a stale path/workspace           | Capture workspaceEpoch + source path; recheck snapshot before drop and epoch/mutationId before committing results    |
| Incorrect descendant checks                    | Reuse segment-boundary pure functions; `a/b` does not match `a/b2`; main checks again                                |
| Sidebar dragging leaks global listeners        | Register pointermove/up only while dragging; clean on unmount/blur; unit-test pure width clamping                    |
| Toolbar overflow hides reachable DOCX commands | Fixed groups and “更多格式” (More Formatting) menu; hidden commands retain keyboard access, names, and real behavior |
| Broad CSS regressions                          | Migrate token/common first, then shell/workspace/document/search in packages, each with targeted tests               |
| Unreliable screenshot environment              | Never invent pixel passes; retain size, scaling, page state, and manual-result fields                                |

## 9. WP0 gate conclusion

The pre-change baseline passes repeatedly. Task 9/10 safety and lifecycle semantics are mapped. Menu implementation, global-event cleanup, drag state machine, visual state matrix, and acceptance strategy have no unresolved baseline changes. WP0 gates are satisfied; WP1 may begin.
