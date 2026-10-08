# TASK-013 Development Execution Prompt

[简体中文](./TASK_013_DEVELOPMENT_PROMPT.md) | English

[Task plan](./TASK_013_SETTINGS_STARTUP_RESTORE.en.md) · [Task archive](../README.en.md) · [Documentation hub](../../README.en.md)

> Give the entire “Main prompt” below to the development Agent responsible for implementation. The plan defines scope and behavior; this prompt defines execution order and delivery requirements.
> Written on 2026-09-12; prompts preserve the original execution instructions. As of 2026-10-08, WP0–WP4 are implemented and WP5 local verification has run. Remaining environment checks and acceptance status are in the [completion report](./TASK_013_COMPLETION_REPORT.en.md).
> For individual work packages, copy the corresponding [WP0–WP5 work-package prompt](./TASK_013_WORK_PACKAGE_PROMPTS.en.md), which includes prerequisites, scope, checkpoints, and handoff requirements.

---

## Main prompt

You are continuing development of the WenShu Windows desktop application in the `WenShu` repository. Fully implement **TASK-013: Basic Settings and Startup Restoration**, proceeding through WP0–WP5 and delivering product code, necessary tests, verification through actual execution, and Chinese/English delivery documentation. Do not stop at a proposal, visual styling, or partial functionality, and do not expand the work into a generic configuration or session management framework.

The core objective is to let users adjust a small set of display preferences and restore their last workspace and document tabs at the next launch. **Minimize unnecessary writes to the C drive**, placing settings, restoration records, and configurable Electron runtime data under an explicit data root. Restoration only reopens files from disk; it does not recover unsaved document content.

### 1. Before starting and how to execute

1. Check the current branch, `git status`, and applicable `AGENTS.md` instructions. Preserve existing changes. If Task 13 already has an implementation, examine its diff and evidence before continuing the unfinished work; do not reset the user's work.
2. Read these files in full:
   - `docs/tasks/task-013/TASK_013_SETTINGS_STARTUP_RESTORE.md`;
   - `README.md`;
   - `docs/architecture/PROJECT_BASELINE.md`;
   - `docs/development/TESTING.md`;
   - `docs/tasks/task-012/TASK_012_COMPLETION_REPORT.md`.
3. Read the integration source files listed in Sections 2 and 7 of the plan and their corresponding tests. Focus on the main/preload/renderer boundaries, workspace epoch, stable tabId, dirty/saving states, DOCX compatibility, path changes, window closing, and E2E launch behavior. Consult the relevant Task 9–11 specifications or reports when an existing behavior is unclear; do not mechanically reread the entire historical archive.
4. Use the project's local `scripts/npm.cmd` and `scripts/node.cmd`. First prepare isolated testing and verification directories inside the repository to avoid reading or writing real user profiles. If necessary, specify test temporary paths only for child processes; do not change user or system TEMP/TMP settings.
5. Before modifying product code, run the existing `check` and `build` commands sequentially and record their actual results. If the baseline fails, first distinguish environment problems, existing changes, and code defects. Do not manufacture passing results by deleting assertions, adding skips, disabling security settings, or increasing timeouts without justification.
6. Continue through the work packages, performing targeted verification and recording a brief result after each package. Do not repeatedly wait for confirmation about routine file organization, naming, or starting the next package. If a real scope conflict, permission blocker, or missing environment arises, complete unaffected work first, then explain the specific problem and required input.
7. Use WP0 → WP1 → WP2 → WP3 → WP4 → WP5 as the default sequence. WP2/WP3 may run in parallel only after the shared contract is stable, with explicit file ownership and coordinated integration afterward. Do not let multiple Agents modify App, preload, or the same contract file concurrently.

### 2. Keep the implementation simple

- Use Node.js file APIs and two versioned JSON files, `settings.json` and `state.json`. Do not add `electron-store`, SQLite, Zustand, a generic event bus, storage backends, or a configuration migration framework.
- Reuse the existing ModalDialog, menus, style variables, workspace controller, and `useDocuments.openFile`. Create a small number of modules organized by responsibility. The proposed file boundaries in the plan may be combined; do not create empty abstractions.
- Provide “View → Settings…” and `Ctrl+,` as the settings entry points, with one dialog containing “Display / Startup / Data location”.
- Implement light/dark/follow-system themes, defaulting to follow-system. TXT fonts are limited to system-default/monospace/serif presets and a 12–24 px font size; preserve the actual current display values as defaults.
- Provide only three startup modes: blank, restore workspace, and restore workspace with tabs; default to the third. Blank mode clears and stops recording lastWorkspace. Workspace-only mode does not record tabs; layout remains persistent.
- Restore the last workspace, tab order/active path, normal window bounds/maximized state, and sidebar width/collapsed state. Do not restore minimized state, full screen, or old search state.
- Exclude autosave, draft content, exact cursor/selection/scroll positions, undo history across launches, a recent-workspace list, multiple-workspace history, directory expansion state, file watching, DOCX display zoom, and automatic data migration.
- Apply TXT display preferences through styling or public editor reconfiguration APIs. Do not rebuild sessions, introduce dirty state, or clear selection or undo history. Keep DOCX document formatting and export results unchanged; prefer retaining a white DOCX canvas and original text colors within the dark application shell.

### 3. Implement data location and startup order in practice

Follow Section 3 of the plan. Changing only the settings JSON path does not constitute completion:

| Run mode                                                 | Fixed strategy                                                                                                                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Development                                              | Resolve the repository root from a stable location and store data in `.local-data/dev/`, independently of the startup cwd                                                                                                |
| Portable                                                 | Use `PORTABLE_EXECUTABLE_DIR` to locate `WenShuData/` beside the actual launcher; do not use the temporarily extracted EXE location                                                                                      |
| Installed / standalone package without a portable marker | Select an independent data root through a native dialog on first launch; it must be outside the installation directory. Store only `<appData>/WenShu/bootstrap.json` in the system user directory, with an 8 KiB maximum |

- Within the data root, use `settings.json`, `state.json`, `runtime/`, and its `session/`, `logs/`, and `crashDumps/` subdirectories as defined in the plan. Generate logs/dumps only as needed; do not introduce document-content logging or telemetry for this task.
- Guide users toward a non-C drive, but do not hardcode D or select a drive without their choice. Users with only C may explicitly choose it. Never silently fall back to C when a directory is unavailable.
- Synchronously resolve and validate a known data root at the entry point. Set `userData` / `sessionData` before `ready`, then initialize the session and business window. Acquire the single-instance lock after resolving the paths; subsequent instances only focus the existing window.
- Use a separate native bootstrap branch for an installed application's first launch or directory reselection: after `whenReady`, show only native dialogs, without creating a business BrowserWindow or accessing defaultSession. Validate the destination, safely write the locator, exit, and relaunch so the next process sets its paths before ready.
- If an existing installed data root disappears, enter the bootstrap flow; do not recreate an empty directory as if it were the original data. Canceling the initial selection exits. Canceling an explicit reselection preserves the old path, clears the flag, and relaunches using the old path. If the old directory is unavailable, canceling directory selection returns to “Retry / Exit”.
- “Choose the data directory again on next launch” only writes a flag; it does not immediately exit or migrate data. Normal closing still uses the dirty/saving protections. If a portable directory is unwritable, instruct the user to move the entire portable directory or exit.
- Development and portable modes may use their respective fixed subdirectory layouts; installed data roots must not overlap the installation directory. If a workspace contains the current data root, exclude only that actual data subtree by real path; do not globally hide user directories with the same name.
- Do not migrate or clean old profiles, change system temporary directories, or redesign the portable extractor. The existing portable launcher may first extract into system TEMP, so promise only to reduce unnecessary long-term data on C, never zero writes to C.
- Read the locked Electron type definitions and builder portable/NSIS templates, and verify startup order and uninstall behavior against the official references in Section 10 of the plan. Do not use this task to redo Task 12 or make unrelated dependency upgrades.

### 4. Persistence and security constraints

- Limit `settings.json` to 16 KiB and `state.json` to 512 KiB. Restore at most 100 tabs; if the limit is exceeded, retain the active tab and the relative order of the selected tabs, and show a notice. This is not a limit on tabs opened during runtime.
- Validate size/version/exact fields/enums/numbers/paths for both files and IPC before use. Local JSON is untrusted; do not spread it into arbitrary objects or expose absolute-path parameters to the renderer.
- The main process is the sole disk writer and owns the data directory, root paths, and window bounds. The renderer submits only allowlisted preferences and tab/sidebar snapshots bound to the main process's current workspace session identifier. A snapshot from an old workspace must never be associated with a new root.
- Do not persist document content, DOCX models/HTML, runtime tabId, revision, dirty/saving/error states, compatibility confirmations, search terms/results, undo history, or editor objects.
- Use one serial queue per file, coalescing repeated metadata snapshots over a short interval. Write to an exclusive temporary file in the same directory, flush, close, and replace; retain the original file and in-memory state on failure. Typing document content must not trigger metadata writes. Submit the final snapshot and flush before closing.
- Preserve damaged records and provide an explicit reset action. Do not automatically overwrite an unknown newer version with an older format. Allow retry or continued exit after a write failure; do not present it as successful document saving or permanently prevent closing.
- Keep nodeIntegration disabled, contextIsolation and sandbox enabled, narrow preload/IPC capabilities, workspace boundaries, symlink/junction/realpath validation, revision conflict checks, DOCX budgets/backups/output verification, and Recycle Bin deletion semantics.
- Do not include local absolute paths or document content in logs, committed files, or release evidence. Use publishable synthetic material for screenshots. Add data roots, caches, and test artifacts to ignore rules and packaging exclusions; they must not enter the ASAR or installer.

### 5. Deterministic restoration and closing behavior

1. Begin restoration only after settings and layout have loaded. Adjust window bounds into the visible area of the current displays, and reuse the sidebar's 180–420 px clamp.
2. Use `workspace.restoreLast()` without a path parameter. The main process retrieves the root path from its own validated record and reuses safe scanning and successful commit logic. If the root is invalid, retain the previous record and offer retry/normal-open entry points.
3. Reuse `openFile` to reread TXT/DOCX in recorded order, with a new tabId, disk snapshot, and compatibility result. Read-only documents remain read-only; degraded documents require confirmation again. For a valid path whose read fails, retain a read-error tab in its original position and continue with the remaining tabs. Reject dangerous paths; do not automatically create missing files.
4. After restoration succeeds, activate the saved active path. If unavailable, select the first retained tab; show the welcome page if there are none. Repeated calls, StrictMode, or late results must not open duplicate tabs or steal focus.
5. Pause automatic snapshot writes during restoration, and temporarily disable other file/workspace opening, editing, saving, and file mutations; the window must remain closable. Offer “Stop restoration” during the tab phase after workspace scanning succeeds.
6. “Stop restoration” stops only subsequent tab scheduling and final activation. Allow an already initiated read to finish through the existing controller. Retain opened/loading tabs and resume recording the currently visible session; do not introduce a per-file read cancellation protocol.
7. If the window closes before restoration finishes, retain the original lastWorkspace and finalize only settings/layout writes. Adopt the partially visible session as a new record only after the user explicitly stops restoration.
8. Both main-process scanning and renderer restoration batches must check their generation; reads continue using the existing epoch/tab/requestId checks. Old scans, reads, snapshots, or final activation after a switch/close must not contaminate a new session.
9. Derive the path list from the successfully committed tab model, reusing the results of rename/directory move/Save As/delete operations. Do not write a second path migration system. Failure or cancellation must not change the recorded paths.
10. Normal closing continues to check dirty/saving states. After the user confirms discard, the next launch opens only the disk version; cancellation retains the current edits. Report state flush failures separately without changing the document-save result. Do not promise that the last metadata update always reaches disk before forced termination.

### 6. Work packages and checkpoints

| Package | Implementation work                                                                                                                                                         | Evidence required before proceeding                                                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP0     | Baseline checks; small practical probes of path redirection, initial selection → relaunch, portable launcher directory, single instance, NSIS uninstall, and test isolation | Startup order works in practice, paths are explicit, and existing failures are attributed; do not infer these platform behaviors solely from mocks               |
| WP1     | Data root/locator, versioned JSON, serial safe writes, flush, corruption handling, narrow IPC foundation, and package exclusions                                            | Unwritable/missing/damaged data can be handled; no silent C-drive fallback; tests do not touch real profiles                                                     |
| WP2     | One settings dialog, themes, TXT display, startup modes, and data-location display/reselection                                                                              | Preferences survive relaunch; display changes do not introduce dirty state or rebuild sessions; keyboard, dark mode, and high contrast work                      |
| WP3     | restoreLast, one restoration flow, batch/session identifiers, error tabs, stopping, and snapshot projection                                                                 | Correct order/active tab; old results cannot contaminate a new session; initial empty state does not overwrite records; fresh reads retain security checks       |
| WP4     | Window/sidebar state, cross-display correction, file path changes, closing, and write-failure integration                                                                   | Cancel/discard/saving behavior remains intact; closing during restoration retains the full old record, and only explicit stopping adopts a partial session       |
| WP5     | Full regression, actual execution/package verification, Chinese/English documentation, and completion report                                                                | Each item in Section 9 of the plan has corresponding evidence and unverified items are explicit; a successful build must not be described as complete acceptance |

Run targeted tests relevant to each package's changes. Once checks pass, do not rerun the entire suite without cause. By default, keep brief WP results together in one completion report rather than creating multiple repetitive reports for every package.

### 7. Final verification and delivery

Run the following sequentially at the end, resolving a failure before proceeding to the next step:

```powershell
.\scripts\npm.cmd run check
.\scripts\npm.cmd run build
.\scripts\npm.cmd run test:e2e
```

Startup and data paths require additional practical verification:

- Actually close/relaunch twice, checking preferences, workspace, mixed TXT/DOCX tabs, active document, and layout; verify that external disk modifications are read as new content.
- Verify closing during restoration/explicit stopping, cancel/discard on unsaved exit, closing protections while saving, invalid records, unwritable/missing data directories, all three directory-selection cancellation cases, and old asynchronous results.
- Use separate repository-isolated directories for development, E2E, and screenshots. Respect existing `--user-data-dir` overrides or update all call sites together. Collect evidence of actual settings/state/profile/session/cache paths and directory changes before and after execution; asserting that `setPath` was called is insufficient.
- Generate and verify portable/NSIS packages with the current internal packaging commands. At an isolated test installation location, verify relaunch and external-data retention during upgrade/uninstall. Do not uninstall the user's active copy, clean user profiles, or move real documents; there is no need to create a public Release or move old tags.
- Inspect settings, dark theme, DOCX canvas, TXT, find highlights, and error states at 900×600 and 1280×820, with necessary scaling/high-contrast cases. Record the actual test system; do not describe Windows 11 results as verification on a real Windows 10 system.

For delivery:

1. Provide implementation code and meaningful behavior/failure tests. Preserve existing security assertions and avoid tests that merely restate implementation structure.
2. Add `docs/tasks/task-013/TASK_013_COMPLETION_REPORT.md` and `.en.md`, recording final decisions, WP results, test commands/actual outcomes, storage-location evidence, known limitations, and items requiring manual verification. Do not mark unverified items as passed. If required acceptance remains outstanding, use “Pending acceptance” as the status.
3. Update the Task 13 plan status, project README, task/documentation indexes, and relevant project baseline and testing guide, keeping Chinese and English consistent. Update only facts relevant to this task; do not rewrite historical acceptance records or release authorization.
4. Check formatting, links, `git diff --check`, and the final diff. Confirm that no real data, caches, isolated test directories, or unrelated dependency changes enter the proposed commit content.
5. State the completed work, verification results, and remaining limitations in the final response. If a real-environment check cannot be completed, finish all executable work and accurately list the required environment/actions. Do not hide an unfinished gate behind “recommended future testing”.

Begin implementation in this order and continue making progress. The Task 13 plan governs detailed behavior and limits. This prompt does not authorize features outside its scope, public releases, or cleaning user data.
