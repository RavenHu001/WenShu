# TASK-013 Work Package Execution Prompts

[简体中文](./TASK_013_WORK_PACKAGE_PROMPTS.md) | English

[Task plan](./TASK_013_SETTINGS_STARTUP_RESTORE.en.md) · [Full-task execution prompt](./TASK_013_DEVELOPMENT_PROMPT.en.md) · [Task archive](../README.en.md)

> Written on 2026-09-12; prompts preserve the original execution instructions. As of 2026-10-08, WP0–WP4 are implemented and WP5 local verification has run. Remaining environment checks and acceptance status are in the [completion report](./TASK_013_COMPLETION_REPORT.en.md).

## How to use

- Copy the complete text block for one work package and give it to a development Agent with access to this repository. You do not need to paste the other packages.
- Every prompt requires reading the shared specification. Its instruction to execute only that package takes precedence over the full-task prompt's instruction to continue through all packages. Hand off when the package is complete; do not start the next one automatically.
- Default order: WP0 → WP1 → WP2 → WP3 → WP4 → WP5. WP2/WP3 may run in parallel only after WP1's contracts are stable and file ownership is clear. One integrator edits shared files.
- Earlier reports do not replace implementation evidence: inspect current code, diffs, and relevant tests first. Reuse completed work instead of starting over, and do not repeat every baseline test just because the Agent changes.
- Record brief results for every package in the same `TASK_013_COMPLETION_REPORT.md` and `.en.md`: package status, interface/file changes, actual test results, unverified items, and inputs for the next package. Keep the overall status “In progress” or “Pending acceptance” until final acceptance. Separate reports for each package are not required.

## WP0: Baseline and startup validation

```text
You are working in the WenShu repository. Execute only TASK-013 WP0: Baseline and startup validation. Finish this package's checkpoints and handoff, then stop. Do not automatically implement WP1.

Read first:
- docs/tasks/task-013/TASK_013_SETTINGS_STARTUP_RESTORE.md (in full);
- docs/tasks/task-013/TASK_013_DEVELOPMENT_PROMPT.md (in full; follow its general constraints, but “execute only WP0” overrides its instruction to continue through the full task);
- README.md, docs/architecture/PROJECT_BASELINE.md, docs/development/TESTING.md;
- docs/tasks/task-012/TASK_012_COMPLETION_REPORT.md;
- Applicable AGENTS.md files, current Git diffs, and any existing Task 13 report.

Goal: establish that the planned startup and storage strategy is feasible, and give WP1 a brief, stable implementation basis. Preserve existing changes. This package does not deliver a settings page, production restore functionality, or new runtime dependencies.

Execute:
1. Inspect main/index, workspace IPC/session, window-close, preload/DesktopApi, use-workspace/use-documents, Electron configuration, packaging templates, and E2E/screenshot launchers. Identify current data paths, directory-picker timing, and unsaved-change protection.
2. Use the repository's scripts/npm.cmd / scripts/node.cmd. Prepare validation data in isolated repository directories. Any temporary-path overrides must apply only to validation child processes; do not change user/system TEMP/TMP or touch real profiles.
3. Before modifying product code, run .\scripts\npm.cmd run check followed by .\scripts\npm.cmd run build. Record actual passes, failures, skips, and reasons. Diagnose failures first; do not work around them by weakening assertions, increasing timeouts without evidence, or disabling security settings.
4. Check the pinned Electron type definitions, builder portable/NSIS templates, and official references listed in the plan. Perform minimal real startup validation: set userData/sessionData before ready; first-run native data-root selection → write the bootstrap locator → exit and relaunch; initialize the business session/window only in the normal startup branch; verify single-instance behavior with a known data root.
5. Verify that the actual portable launcher directory comes from PORTABLE_EXECUTABLE_DIR and differs from the extracted EXE directory. Confirm that data inside the installation directory cannot rely on surviving uninstall. Do not establish platform behavior solely with mocks; clearly mark anything that cannot yet be tested on a real runtime.
6. Establish the three layouts: repository .local-data/dev for development; WenShuData beside the portable launcher; a separate, natively selected data root for installed builds, with only a bootstrap.json of at most 8 KiB in the system user directory. Do not hard-code drive D, silently fall back to drive C, or promise zero C-drive writes from the OS or portable temporary extraction.
7. Specify settings/state fields, versions and budgets, the workspace session identifier, error responses, write-queue/flush boundaries, and test path overrides. Use the plan's two JSON files and a small number of modules with clear responsibilities; do not expand this into a general configuration system.

Package checkpoints:
- Baseline results and actual startup/path evidence explain the difference between normal startup and first-run bootstrapping.
- Data-directory strategy, contract essentials, and isolated validation entry points are ready for WP1; required assumptions are verified or accurately marked as pending verification.
- Retain only necessary reusable experimental code. Do not wire unfinished product entry points into the production UI or package experimental data.

Handoff: create or update docs/tasks/task-013/TASK_013_COMPLETION_REPORT.md and .en.md with overall status “In progress.” Record WP0 findings, actual commands/results, storage-path rules, and remaining conditions. Finish by listing the files/contracts WP1 should take over and any unresolved prerequisites. If this package is blocked, complete the remaining checks; do not substitute a different storage design for the plan.
```

## WP1: Data directory and JSON storage

```text
You are working in the WenShu repository. Execute only TASK-013 WP1: Data directory and JSON storage. Complete this package and hand it off; do not automatically start WP2 or WP3.

Read docs/tasks/task-013/TASK_013_SETTINGS_STARTUP_RESTORE.md and docs/tasks/task-013/TASK_013_DEVELOPMENT_PROMPT.md in full, plus applicable AGENTS.md files, current Git diffs, and WP0 findings in the completion report. The shared prompt's security and scope constraints still apply; “execute only WP1” overrides its instruction to continue through the full task.

Prerequisite: verify WP0's real startup validation, path strategy, and unresolved issues. Do not repeat the full baseline when existing results still apply. Address and record prerequisite issues that block this package's core implementation. Preserve existing changes.

Implementation scope:
1. Implement data-directory initialization, the installed-build bootstrap locator and native onboarding, pre-ready userData/sessionData redirection, log/dump paths when needed, and single-instance behavior.
2. Implement the three paths: repository .local-data/dev; WenShuData under PORTABLE_EXECUTABLE_DIR; a separate, user-selected data root for installed builds. An installed-build data root must not overlap the installation directory. Do not recreate a missing old root as an empty directory and treat it as the original. Guide users toward a non-C drive; never silently fall back to C when writing fails.
3. For installed-build first-run/reselection, complete native selection, write bootstrap.json within its 8 KiB limit, then exit and relaunch. Do not create a business window in the bootstrap process. Canceling first selection exits. Canceling requested reselection keeps the old path, clears the flag, and relaunches with that path. Canceling selection for an invalid root returns to Retry/Exit. If the portable directory is unwritable, prompt the user to move the entire directory or exit. Reselection only marks the next startup; do not migrate data.
4. Use Node file APIs for version=1 settings.json (≤16 KiB) and state.json (≤512 KiB). Follow the plan's fixed allowlists, ranges, maximum of 100 restored tabs, and main-process workspace-session-identifier contract. Do not store document content/models, search data, old revisions/confirmations, or editor runtime objects.
5. Use one serial write queue per file and coalesce rapid metadata changes. Write to an exclusively created temporary file in the same directory, flush, close, then replace; flush must await completion. On failure, preserve the old file and in-memory state, returning a retryable result. Use defaults for missing files, preserve corrupt originals, and do not automatically overwrite unknown newer versions. Do not broaden permissions through generic configuration keys or arbitrary-path IPC.
6. Provide the minimum shared contracts and main-process services/narrow IPC required by WP2/WP3: read preferences/state, update preferences, accept snapshots tied to the current session, expose/open the data directory, request selection on next startup, and reset invalid files. WP3 handles document restore scheduling; WP4 handles actual window layout and final close integration. Do not return false success for these later behaviors.
7. Exclude precisely the current data-root subtree from workspace scanning/search while keeping same-named user directories visible. Isolate development, test, and screenshot paths. Preserve existing --user-data-dir test overrides or migrate all their call sites together. Add new data directories to ignore and packaging-exclusion rules.

The application must be safe to run after this package is integrated: startup defaults, layout updates, or exit flush must never overwrite corrupt or unknown-newer-version originals. One main-process location owns startupMode updates and lastWorkspace clearing/trimming rules; hand that policy to WP2/WP3 for reuse instead of letting both packages implement separate versions.

Validation:
- Use real startup checks for the three path strategies, relaunch after first selection, unwritable/missing directories, and cancellation branches. Inspect actual userData/sessionData locations.
- Add focused coverage for missing/corrupt/unknown-version/oversized JSON and extra fields, unsafe paths/links, concurrent write ordering, mid-write failures, and flush. Confirm that failure does not truncate the old file and that an old-session snapshot cannot be attached to a new root.
- Run affected type, behavior, and package-exclusion checks. Do not change global TEMP/TMP, clean real user data, or add a database/state framework.

The handoff must list final fields/defaults, error shapes, interface names, data-root resolution and test overrides, session-identifier ownership, and wiring left for WP2/WP3/WP4. Update WP1 status and actual results in the same Chinese and English completion report. Explicitly state when the settings page and tab restore remain unimplemented; do not mark all of Task 13 complete.
```

## WP2: Basic settings and themes

```text
You are working in the WenShu repository. Execute only TASK-013 WP2: Basic settings and themes. Finish this package and hand it off; do not automatically start WP3.

Read docs/tasks/task-013/TASK_013_SETTINGS_STARTUP_RESTORE.md and docs/tasks/task-013/TASK_013_DEVELOPMENT_PROMPT.md in full. Read applicable AGENTS.md files, current diffs, WP0/WP1 results in the completion report, and WP1's actual interfaces. General constraints still apply; “execute only WP2” overrides the instruction to continue through the full task.

Prerequisite: WP1 provides working preference read/write, data-directory, and error-feedback interfaces. Inspect the implementation; do not replace missing services with permanent mocks, a second localStorage copy, or a new state framework. If running in parallel with WP3, one integrator owns App/preload/shared contracts; agree on file boundaries first.

Implementation scope:
1. Reuse AppMenuBar and ModalDialog to add “View → Settings…” and Ctrl+,. Keep one dialog with only Display, Startup, and Data location sections. Preserve focus trapping, Escape, focus restoration, and accessible names.
2. Implement Light/Dark/Follow system (default), switch root style variables, subscribe to system changes, and clean up subscriptions. Load preferences before initial display to reduce flashing. Inspect remaining hard-coded colors, CodeMirror, menus, search highlights, and error/disabled states; do more than replacing root tokens.
3. TXT display offers only System default/Monospace/Serif font presets and a 12–24 px font size. Preserve current actual display defaults and use font fallbacks. Apply changes immediately through styles or public reconfiguration APIs; do not rebuild editors, clear selections/history, or make documents dirty.
4. Preserve the DOCX document model/export and original text colors. Prefer a white document canvas inside the dark shell. Do not apply display preferences through document-formatting commands or add DOCX zoom.
5. Implement selection and persistence for the three startupMode values, defaulting to restore workspace and tabs. Blank startup clears and stops recording lastWorkspace; workspace-only mode does not record tabs. Apply recording policy through the existing storage service rather than keeping a separate UI history. WP3 owns actual restore scheduling.
6. Show the real data directory, a permanent Open data directory action, and an installed-build “Choose data directory on next startup” action. Reselection writes only a flag; it does not exit immediately or migrate data. Do not accept arbitrary renderer paths. Clearly explain in the UI: “Startup restore reopens files from disk; unsaved content still needs to be saved manually.”
7. Preview display settings immediately. On save failure, retain the current display and offer retry. Startup mode takes effect as planned only after successful persistence; a failed mode write must not prematurely clear the original restore record. Do not present document-save status as the result of saving settings.

Validation:
- Themes, TXT font/size, and mode values survive restart, with clear feedback for defaults, corrupt configuration, and write failures.
- Changing settings leaves current TXT/DOCX content, dirty state, selection, and undo/redo history unchanged. Follow-system subscriptions are released correctly.
- At 900×600 and 1280×820, inspect the actual settings dialog, dark editor area, DOCX readability, and high contrast. Run relevant component/style/editor behavior tests.
- Do not add settings routes, activity-bar pages, full system-font enumeration, autosave, drafts, or a cache-management page in this package.

Handoff: update WP2 results in the Chinese and English completion report, including menu entry points, state-service wiring, style/font interfaces, actual UI validation, and unverified items. Without WP3, claim only that the mode is saved, not that workspaces/tabs restore automatically. Identify restore-scheduling wiring for WP3 and layout/close integration for WP4.
```

## WP3: Workspace and tab restore

```text
You are working in the WenShu repository. Execute only TASK-013 WP3: Workspace and tab restore. Finish this package and hand it off; do not automatically start WP4.

Read docs/tasks/task-013/TASK_013_SETTINGS_STARTUP_RESTORE.md and docs/tasks/task-013/TASK_013_DEVELOPMENT_PROMPT.md in full. Read applicable AGENTS.md files, current diffs, and WP0/WP1 plus any WP2 results in the completion report. General constraints apply; “execute only WP3” overrides the instruction to implement all packages continuously.

Prerequisite: WP1's state allowlists, write queues, and workspace-session-identifier interfaces are stable. Inspect current use-workspace, use-documents, workspace IPC/session, and the close protocol. WP2 may finish independently or in parallel, but this package must use the same startupMode and state source rather than a second configuration system.

Implementation scope:
1. Add workspace.restoreLast() without an arbitrary-path parameter. Obtain the root only from the main process's validated record. Revalidate directories/links/real paths and commit only after a successful scan, sharing logic with manual opening. Check the generation before committing the main-process scan. On failure, preserve the old record and offer retry/normal opening.
2. After settings load, apply the three modes: blank startup neither restores nor records a workspace; workspace-only mode neither restores nor records tabs; the third mode restores root and tabs. The main process owns the root path, and snapshots carry its issued identifier for the current workspace session.
3. Validate path syntax/type/budgets and deduplicate, then call the existing openFile in recorded order to reread TXT/DOCX with new tabIds and disk snapshots. Restore at most 100 tabs; when over budget, keep the active item and preserve the original relative order of selected items, with a notice. Do not limit the number of tabs opened during normal use.
4. Keep a read-error tab in its original position when reading fails, reusing retry/close actions, and continue with other tabs. Reject unsafe paths and do not create missing files. read-only remains read-only, and old degraded confirmations do not carry over.
5. At completion, activate the recorded active path; fall back to the first retained tab, or show the welcome screen if none remain. Repeated mounting, StrictMode, and late results after stop/close/switch must not append tabs or steal focus. Reuse existing epoch/tab/requestId checks and a generation for the one-time restore.
6. Pause snapshots from restore start to finish so empty state cannot overwrite the original record. Temporarily disable other opening, editing, saving, and file mutations, while keeping window close available. Offer “Stop restoring” only during the tab phase after the workspace scan succeeds.
7. Explicit stop cancels only subsequent tab scheduling and final activation; the one read already started completes through the existing controller. Keep open/loading tabs and adopt the currently visible session. Do not add a per-file read cancellation protocol.
8. Closing before restore finishes must preserve the complete old lastWorkspace; adopt a partial session only after explicit stop. Complete the necessary minimum close wiring in this package. Do not defer protection to WP4 and leave a period in which empty or partial state can overwrite the old record. WP4 later performs full layout/flush integration.
9. Project metadata snapshots from the committed tab model. Do not store content, old revisions/confirmations, search data, tabIds, undo history, or editor objects. Never write an old workspace's asynchronous snapshot into a new root. Record only metadata changes; typing document content must not trigger snapshot writes.

Validation:
- Order and active tabs for mixed TXT/DOCX, same names under different paths, empty files, and error/read-only/degraded files; current disk content is read after external modifications.
- Three modes, missing workspaces, duplicate/out-of-bounds paths, over-budget lists, stopping restore, closing during restore, and suppression of initial writes.
- Both layers of generation checks, old snapshot identities, late read responses, and final-activation races. Pausing snapshots must not permanently stop normal recording afterward.
- Regressions in current find/workspace search, compatibility confirmation, and safe reads. Do not restore precise positions or any unsaved content at this stage.

Handoff: update WP3 status, restore phases and snapshot guards, cancellation/close semantics, and actual test results in the Chinese and English completion report. Identify window layout, final close flush/failure feedback, and file-path-change integration for WP4. This package's minimum data protection must already work.
```

## WP4: Layout and close integration

```text
You are working in the WenShu repository. Execute only TASK-013 WP4: Layout and close integration. Finish this package and hand it off; do not automatically execute WP5's final release validation.

Read docs/tasks/task-013/TASK_013_SETTINGS_STARTUP_RESTORE.md and docs/tasks/task-013/TASK_013_DEVELOPMENT_PROMPT.md in full. Read applicable AGENTS.md files, current diffs, and WP0–WP3 results in the completion report. General constraints apply; “execute only WP4” overrides the instruction to continue through the full task.

Prerequisite: verify that WP1 storage/flush, WP2 settings entry points, and WP3 restore/recording protection are actually integrated. Address integration issues affecting this package's safety first; do not rewrite verified modules. Records continue to use only two JSON files and the same main-process state service.

Implementation scope:
1. Persist window normal bounds and maximized state in the main process. Correct bounds against current display work areas when creating the window, handling removed monitors, invalid values, and scaling. Do not restore minimized or fullscreen state.
2. Restore sidebar width/collapse using the existing 180–420 px clamp. Start in the file sidebar every time. Do not overwrite saved layout with defaults during initialization, or expand scope into file-tree expansion or precise reading positions.
3. Obtain final paths after rename, file/directory moves, Save As, and delete from successfully committed tab state. Respect path-segment boundaries for directories. Failed/canceled operations do not migrate records. Do not build a second path-change engine.
4. Normal close first goes through existing dirty/saving protection, then submits final metadata and flushes. Metadata success is not document-save success. Canceling close continues editing; confirming discard restores the disk version next time; saving still prevents discarding tabs/workspaces.
5. Preserve WP3's distinction: closing before restore finishes keeps the original lastWorkspace and only finishes settings/layout writes; after explicit stop, a partial session may be saved. Old scans, reads, timers, and queue responses must not rewrite the session after close.
6. Clearly offer retry or continue exiting when state writes fail. Preserve old files and current edits, and do not permanently block closing. Forced termination preserves only the last successfully persisted metadata on a best-effort basis; do not promise final-millisecond data or recovery of unsaved content.
7. Coordinate installed-build “Choose data directory on next startup” with normal exit. Do not bypass unsaved-change confirmation or turn it into an immediate restart. Verify that canceling reselection does not loop and old data is not automatically moved/overwritten.

Validation:
- Restart restore for normal/maximized windows, removed monitors, scaling, out-of-bounds values, sidebar bounds, and collapse. Preserve existing UI minimum dimensions and keyboard operation.
- Restart paths after file/directory rename and moves, Save As, and delete; failed operations do not pollute records.
- Dirty-close cancel/discard, close while saving, rapid close, write-failure retry/continue, close during restore/after stop, and late responses.
- Verify that different workspace snapshots do not mix, typing content does not trigger metadata persistence, and current TXT/DOCX undo/save safety does not regress.
- Run relevant window/state/file-management/editor integration tests and actually restart to confirm that settings, tabs, and layout work together. Leave the complete final matrix to WP5.

Handoff: update WP4 results in the Chinese and English completion report, listing the full close flow, failure feedback, layout-correction rules, path-change evidence, and remaining real-environment acceptance checks. Confirm that the features are ready for WP5. Set overall status to “Pending acceptance”; do not mark unexecuted matrix items as passed.
```

## WP5: Regression, real validation, and delivery

```text
You are working in the WenShu repository. Execute only TASK-013 WP5: Regression, real validation, and delivery. Fix issues found during this task's acceptance checks and complete delivery. Do not add new features or change the public-release scope.

Read docs/tasks/task-013/TASK_013_SETTINGS_STARTUP_RESTORE.md in full (especially the acceptance checklist in section 9), and docs/tasks/task-013/TASK_013_DEVELOPMENT_PROMPT.md. Read applicable AGENTS.md files, current Git diffs, and WP0–WP4 results in the Chinese and English completion report. Verify against current source and tests rather than relying only on report text. “Execute only WP5” overrides the shared prompt's instruction to repeat the full task.

Prerequisite: WP1–WP4 functionality and minimum safety gates are integrated. Fix gaps first and attribute them to the relevant WP without rebuilding the implementation from scratch. All validation uses isolated repository data and test installation directories. Do not uninstall the user's current copy, clean real profiles, or move real documents.

Execute:
1. Map every item in plan section 9 to an actual test or manual evidence. Cover the three data roots, first-run onboarding/relaunch/cancellation, corrupt configuration/write failures, three startup modes, mixed tabs/compatibility, asynchronous invalidation, path migration, layout, and close protection.
2. Run these sequentially on the final code, fixing any failure before continuing:
   .\scripts\npm.cmd run check
   .\scripts\npm.cmd run build
   .\scripts\npm.cmd run test:e2e
   Record actual commands, exit results, and skip reasons. Do not obtain passes by increasing timeouts, lowering the security baseline, or deleting assertions.
3. Actually close/restart at least twice. Confirm that theme/TXT display, mode, workspace, tab order/active document, and window/sidebar restore together. Read new disk content after external changes; unsaved-exit cancel/discard and protection while saving must remain correct.
4. Collect evidence of actual settings/state/userData/sessionData/cache paths, plus log/dump paths when used, for development, portable, and installed builds. Compare directory changes before and after running. With a non-C data root, verify that persistent configuration/cache has not been left in the default C-drive profile. Do not merely assert calls to setPath. Clearly record the locator's required size, native-onboarding/OS traces, and portable TEMP-extraction limits.
5. Generate and verify portable/NSIS packages using current internal packaging commands; first inspect existing scripts such as package:win and package:verify in package.json. In an isolated test installation, actually validate first selection, restart, upgrade, and uninstall preserving external data. Portable data must live beside the launcher, not in the extracted directory. Confirm that settings/state/runtime/test data are absent from the ASAR and installer.
6. Check settings, TXT, dark UI, the white DOCX canvas, search highlights, and error feedback at 900×600 and 1280×820, with display scaling/high contrast where needed. Use synthetic documents and shareable paths in screenshots. Record the actual OS/build; do not describe Windows 11 testing as Windows 10 device validation.
7. Make minimal fixes for new failures and rerun affected checks. Final gates must correspond to the latest product code. Do not repeat unchanged matrices when no new changes or unresolved concerns justify doing so.

Delivery:
- Complete docs/tasks/task-013/TASK_013_COMPLETION_REPORT.md and .en.md: final implementation, each WP's status, commands/actual results, evidence of actual data locations, known limitations, and item-by-item acceptance conclusions. Mark the overall task complete only after all required acceptance checks are done. If real-environment prerequisites are missing, keep “Pending acceptance,” specify the required environment and actions, and do not claim passes.
- Synchronize Task 13 plan status, README, task/document indexes, and necessary project-baseline/testing-guide updates in Chinese and English. Preserve historical Task 12 release and system-validation boundaries. Do not publicly release Windows binaries, move old tags, or perform unrelated runtime upgrades.
- Check document formatting, local links, git diff --check, and final diffs. Confirm that no real user content/paths, caches, validation artifacts, or unrelated dependency changes enter the changes intended for commit.
- Finish with completion status, actual test results, and real prerequisites still needed from the user. For environment blockers, first finish all remaining executable work. Do not turn required gates collectively into “follow-up recommendations.”
```
