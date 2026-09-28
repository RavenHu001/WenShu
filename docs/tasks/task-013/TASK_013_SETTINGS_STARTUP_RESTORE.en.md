# TASK-013: Basic Settings and Startup Restoration

[简体中文](./TASK_013_SETTINGS_STARTUP_RESTORE.md) | English

[Task archive](../README.en.md) · [Documentation hub](../../README.en.md)

> **Status: awaiting acceptance; WP0–WP4 complete, WP5 final acceptance not executed.** Planning date: 2026-09-12. See the [completion report](./TASK_013_COMPLETION_REPORT.en.md) for WP0/WP1 on 2026-09-20 and WP2/WP3/WP4 implementation, verification, and handoff on 2026-09-27.
> This task defines the product scope, implementation approach, and work packages requested by the owner, prioritizing a simple design and minimizing unnecessary writes to the C drive.
> This is not an implementation completion report and does not change Task 12's boundary between internal binaries and public source releases.

Use the [full-task execution prompt](./TASK_013_DEVELOPMENT_PROMPT.en.md) or copy an individual [WP0–WP5 work-package prompt](./TASK_013_WORK_PACKAGE_PROMPTS.en.md). Both follow the scope and behavior defined in this plan.

## 1. Goals and Scope

Let users continue their previous file work when they next start WenShu and adjust basic display preferences. Keep settings and restoration records in one explicit data directory, together with Electron runtime data whose location the application can configure.

| Deliverable          | Fixed scope                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Settings entry       | “View → Settings…” and `Ctrl+,`, reusing the existing modal dialog; no new activity-bar page or routing system                                                     |
| Theme                | Light, dark, and follow system; follow system by default and respond to system changes                                                                             |
| TXT display          | Preset font families and a 12–24 px font size; defaults match the actual display values before implementation, with system fallback for unavailable fonts          |
| Startup behavior     | One setting with three choices: start empty, restore workspace, or restore workspace and tabs; the third is the default                                            |
| Layout restoration   | Normal window position/size and maximized state; sidebar width/collapsed state; always start in the file sidebar                                                   |
| Document restoration | Only the last workspace; tab relative paths, order, and active document; reread TXT/DOCX files from disk                                                           |
| Storage visibility   | Show the actual data directory in settings, provide a fixed “Open data directory” action, and provide “Choose data directory on next startup” for installed builds |

Out of scope: autosave, recovery of unsaved content/drafts, exact cursor/selection/reading-position restoration, undo history across launches, a recent-workspaces list, history for multiple workspaces, file-tree expansion state, tab dragging/pinning/bulk closing, file watching, DOCX display zoom, configuration sync, a cache-management page, and automatic data migration.

TXT font and size are display preferences and must not be written into documents. DOCX continues to use the formatting in its document model; themes must not change that model or exported output. Include one sentence in settings: “Startup restoration reopens files from disk. Unsaved content still needs to be saved manually.”

## 2. Verified Integration Points

- `src/main/index.ts`: window dimensions are fixed, and `userData` / `sessionData` have not been redirected; initialize data paths at the very start of startup.
- `src/main/workspace/workspace-session.ts` and `workspace-ipc.ts`: the root path is held only in memory and comes from the native picker; restoration requires adding the previous root saved by the main process as a controlled source.
- `src/renderer/lib/use-workspace.ts`: workspace opening/refreshing, generation, and epoch already exist; restoration should reuse the same commit logic after a successful scan.
- `src/renderer/lib/use-documents.ts`: `openFile` already handles TXT/DOCX opening, unique tabs, and read lifecycles; do not build a second editor path for restoration.
- `src/renderer/lib/use-editor-sessions.ts`: sessions contain runtime objects and cannot be persisted directly; DOCX sessions and compatibility confirmations must also be established anew.
- `src/renderer/components/shell/AppMenuBar.tsx`, `components/common/ModalDialog.tsx`, and `lib/sidebar-size.ts`: reuse the existing entries, focus behavior, and 180–420 px sidebar constraints.
- `src/renderer/styles/tokens.css` already contains design variables, but `app.css` and other files still contain hardcoded colors; verify dark mode in actual editing areas and feedback states.
- `electron-builder.yml` targets portable and per-user NSIS, permits choosing the installation directory, and preserves AppData on uninstall; this does not imply that data inside the installation directory will be retained.

## 3. Data Directory: Minimize C-Drive Usage

### 3.1 Three Runtime Modes

| Mode                                                     | Data-root rule                                                                                                                                                         | Application-owned data in the system user directory                                                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development                                              | `.local-data/dev/` under the repository root, resolved from a stable project path rather than the launch working directory                                             | No locator file needed                                                                                                                                                        |
| Portable                                                 | `WenShuData/` beside the actual portable launcher EXE; move it with the entire directory                                                                               | No locator file needed                                                                                                                                                        |
| Installed / standalone package without a portable marker | Choose an independent data directory with the native picker on first run, outside the installation directory; locate it through a small locator file on later launches | Only `<appData>/WenShu/bootstrap.json`, containing the version, data-root path, and optional flag to choose again next time; at most 8 KiB, normally only a few hundred bytes |

Guide users toward an independent directory on a non-system drive, such as `D:\WenShuData`. This is an example: do not hardcode the D drive or select a drive automatically. If only C is available, allow the user to choose it explicitly. When installed on a non-C drive, the picker may initially open on that drive; do not automatically write data into the installation directory.

Portable builds must use `PORTABLE_EXECUTABLE_DIR`, not derive their persistent directory from the extracted EXE that is actually running. The existing builder's portable launcher runs the application from a temporary directory and cleans it up on exit. Verify this behavior in the pinned dependency's `node_modules/app-builder-lib/templates/nsis/portable.nsi`.

If the portable directory is not writable, clearly ask the user to move the entire portable directory to a writable location or exit. Do not silently fall back to C or add a second portable locator mechanism. If an installed build's data drive is unavailable or unwritable, show a native “Retry / Choose data directory / Exit” flow; canceling selection retains the original locator. Do not automatically move, delete, or overwrite existing data.

### 3.2 One Layout

```text
<data root>/
  settings.json          # User preferences
  state.json             # Window/sidebar and last workspace/tab metadata
  runtime/               # Electron userData
    session/             # Explicit sessionData, including Chromium caches
    logs/                # Confine logs here if generated
    crashDumps/          # Confine crash dumps here if generated
```

Do not create a configuration directory in every workspace. Documents and existing DOCX `.wenshu.bak` files remain in their original locations. Changing settings and restoring startup state must not write documents.

Use an ordinary local data directory rather than redirecting through directory links. Installed builds reject overlap between the data root and the application installation directory; development and portable builds use the fixed subdirectory layouts above. If an opened workspace contains the current data root, file-tree scans and search must exclude that exact real subtree. Do not globally hide user folders simply because they are named `WenShuData`.

### 3.3 Startup Order and Choosing a New Location

1. At the main-process entry point, synchronously resolve the portable marker, development path, or installed-build locator. Development and portable builds may create their prescribed data root on first use. If an installed build's recorded data root no longer exists, enter the directory-selection flow rather than silently creating an empty replacement. Create runtime subdirectories only after the root is valid.
2. When the data root is known, set `userData` and `sessionData` before `ready`, and set log/dump paths before using them. Only then initialize sessions, windows, and IPC. Acquire a single-instance lock; later instances only focus the existing window, preventing multiple processes for the same user from writing the same data directory.
3. On an installed build's first launch, or when reselection was requested, take a separate setup branch: after `whenReady`, show only native dialogs without a parent window; do not create a business `BrowserWindow` or access `session.defaultSession`. After selecting and validating the directory and writing the locator, exit and relaunch. The next process starts from step 1.
4. “Choose again on next startup” only writes the locator flag; it does not restart immediately or close tabs. Normal closing still uses the existing dirty/saving protections. The target directory may be empty or contain valid settings for this application; report unknown versions or incompatible content without merging two datasets.
5. To retain existing settings, explain that the user should exit normally, copy the data directory manually, and choose its new location on the next launch. The application performs no background migration. Portable users can move the entire application and data directory together.

Cancellation behavior is fixed: canceling the initial selection exits; canceling a user-requested reselection retains the previous path, clears the reselection flag, and relaunches with the previous directory; canceling selection when the previous directory is unavailable returns to the native “Retry / Exit” flow. Cancellation must not cause a repeating reselection loop.

The timing requirement for `sessionData` comes from the [official Electron app documentation](https://www.electronjs.org/docs/latest/api/app#appsetpathname-path). Relaunching after the first selection lets the next process meet this requirement. WP0 must verify the flow; do not change paths after `ready` and claim the cache has switched.

**This task promises to avoid unnecessary long-term data on C, not zero writes to C.** Traces from the first native setup run, Windows records, and the system temporary directory used by the existing portable extractor may still reside on C. Task 13 does not change system TEMP/TMP, global registry directory settings, or the portable extractor. If even temporary extraction data must avoid C in the future, assess distribution without self-extraction in a separate small task.

Previous versions have none of this task's settings/restoration records. Do not automatically scan, migrate, or clean up old Electron profiles. Development, tests, and screenshots use separate isolated data roots. Add the new directories to ignore rules and package exclusions; they must not enter installers or uploaded test evidence.

## 4. Minimal Persistence Implementation

### 4.1 Data and Boundaries

Use Node.js file APIs and two versioned JSON files. Do not introduce `electron-store`, SQLite, Zustand, a general configuration framework, or an event bus. The project baseline lists `electron-store` as an earlier technical recommendation, but it is not currently installed. This task explicitly chooses the smaller implementation, without adding equivalent overlapping dependencies.

| File            | Allowlisted contents                                                                                        | Limits                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings.json` | `version: 1`, `theme`, `txtFontPreset`, `txtFontSizePx`, `startupMode`                                      | At most 16 KiB; exact enum and numeric-range validation                                                                                                        |
| `state.json`    | `version: 1`, normal window bounds/maximized state, sidebar width/collapsed state, nullable `lastWorkspace` | At most 512 KiB; restore at most 100 tabs, without limiting the number opened at runtime                                                                       |
| `lastWorkspace` | Root path recorded by the main process, ordered TXT/DOCX relative paths, nullable active relative path      | Deduplicated, bounded paths; when over the limit, retain the active tab and preserve the relative order of the other selected tabs; clearly disclose the limit |

Do not store content, DOCX models, HTML, editor instances, disk revisions, dirty/saving/error state, compatibility confirmations, search terms/results, runtime tab IDs, or user-action logs. Necessary absolute paths exist only in local locator/state records and are not copied into logs, screenshot evidence, or telemetry. This task adds no telemetry.

The main process is the only disk writer. The renderer may submit only display preferences and tab/sidebar snapshots for the current workspace. The main process supplies the workspace root, window bounds, and data paths. Interfaces accept exact objects and reject extra fields, arbitrary root paths, arbitrary configuration keys, and force-overwrite switches.

### 4.2 Writing and Corruption Handling

- At startup, enforce file-size limits before parsing; use defaults for missing files. Malformed content, unknown versions, and invalid fields return explicit states. Never merge unvalidated data directly into application objects.
- Use one serial write queue per file, coalescing snapshots submitted in quick succession (500 ms suggested). Create an exclusive temporary file in the same directory, write it completely, flush it to disk, close it, then replace the destination. On failure, retain the old file and current in-memory state and show “These settings/restoration records were not saved. You can retry.”
- Submit state only when metadata changes; typing document content must not trigger state writes. Flush the latest snapshot and queues when closing; do not save only in quit events.
- Retain corrupt originals and provide an explicit reset action in settings. Never automatically downgrade and overwrite an unknown newer version. No multilevel backup store, migration chain, or live configuration-file watcher is needed.
- Persistence failure is separate from document-save failure. Let users retry or continue exiting; do not make the application impossible to close. Forced termination may lose the latest metadata change; do not promise recovery of unsaved content.

## 5. Settings UI and Display Implementation

Use one small dialog with “Display,” “Startup,” and “Data location” groups, reusing the existing ModalDialog, buttons, focus containment, and error feedback. No settings search, multipage tabs, JSON editor, or plugin extension points are needed.

Display settings preview and save immediately. On save failure, retain the current appearance and show feedback. Switch themes through a root-node attribute and CSS variables. Follow-system mode subscribes to `prefers-color-scheme` and cleans up its subscription. Apply loaded preferences before the initial display to reduce theme flashing.

For TXT, offer only a limited set of font presets (system default, monospace, serif) and font sizes. Do not enumerate all OS fonts or accept arbitrary CSS. Apply changes through styles or public editor reconfiguration APIs without rebuilding EditorState/Tiptap instances, clearing undo/selection, or marking documents dirty.

Verify DOCX page readability together with explicit text colors and highlights. Prefer retaining a white document canvas and original text colors while theming the surrounding shell; do not invert colors globally. Dark-mode checks must also cover CodeMirror, find highlights, menus, dialogs, error/disabled states, and high-contrast mode.

## 6. Startup Restoration Flow

### 6.1 Restoration and Recording Rules

1. Read settings and layout first. The main process adjusts normal window bounds against current display work areas. Do not restore minimized or fullscreen state, and avoid placing the window on a disconnected screen. Keep the existing sidebar clamp.
2. `Start empty` does not read a workspace. Selecting this mode clears `lastWorkspace` and stops recording it, while layout remains persistent. `Restore workspace` records/opens only the last root, without tab records. Only `Restore workspace and tabs` records the path list. Mode changes take effect after successful persistence.
3. The main process provides `workspace.restoreLast()` with no path argument. It takes the root from its own state, revalidates the local directory, links along the path, real paths, and types, and commits the workspace only after a successful scan. On failure, retain the previous record and enter an empty state with retry available. Manual opening and restoration share commit logic.
4. Validate tab path syntax, types, and duplicates, then call the existing `openFile` in recorded order. Sequential reading is sufficient for the first version. Each tab receives a new tab ID, a new disk snapshot, and the normal read checks; do not reuse old state objects. Restore at most 100 tabs by default to avoid unbounded startup work.
5. If a path is valid but its file is missing, inaccessible, or fails to read, retain an ordinary `read-error` tab with the existing retry/close actions and continue restoring other tabs. Reject dangerous paths outright. If a file has become a directory, link, or unsupported type, do not read it based on the old record.
6. Finally activate the recorded active path. If absent, activate the first retained tab; if there are none, show the welcome area. Handle read-only/degraded status from fresh read results. Do not restore a previous degraded-document confirmation.
7. Suspend automatic snapshot writes from the beginning of initial restoration until it completes, so empty initial state cannot overwrite the previous record. During restoration, temporarily disable opening other files/workspaces, document editing, saving, and file mutations; the window remains closable. After the workspace scan succeeds, show “Restoring” and “Stop restoration” during tab restoration. Stopping cancels only subsequent tab scheduling and the final active-tab switch; an already started read completes normally through the existing controller. Keep opened tabs, including loading placeholders, and then record the current visible state. No separate protocol for canceling individual file reads is needed.
8. Reuse the existing workspace generation/epoch and add one local generation for the restoration batch. Stopping, closing, or opening another workspace invalidates the old batch first. After closing or switching workspaces, existing epoch/tab/requestId checks continue to discard read responses; old restoration scheduling must not append tabs or steal focus. Main-process asynchronous scans for restoration and manual opening must also check their generation before committing; discarding return values only in the renderer is insufficient.

Allowing a root saved from the user's last selection by the main process necessarily extends the old rule requiring the native picker on every opening. It does not add `openPath(string)`. Local JSON remains untrusted input. Restoration is read-only and never automatically saves, confirms degraded compatibility, or executes file-management commands merely because a record exists.

### 6.2 Integration with Existing Lifecycles

- After a successful rename, move, or Save As, create the new snapshot from committed tab state. Failures/cancellations do not migrate records. Directory moves continue to respect path-segment boundaries; successful deletion removes affected tabs from the record.
- State snapshots carry the current workspace session identifier issued by the main process. The main process accepts relative paths only for the matching session. Reject late writes from the old workspace instead of binding their tabs to the new root.
- Normal closing saves the current path list. After the user confirms discarding dirty changes, the next launch restores disk content at those paths. Canceling close continues the current session without clearing records. Closing before restoration finishes retains the original `lastWorkspace` and only finishes settings/layout writes. Adopt the partially visible workspace as the new record only after the user explicitly chooses “Stop restoration.”
- Existing close/workspace-switch protections for saving tabs remain unchanged. Writing restoration records does not count as a successful document save. Extend the window-close protocol only to finish metadata queues, without bypassing existing confirmations.
- When restoration is enabled, a successful manual workspace switch retains only the new workspace snapshot. Canceling or failing to open a workspace retains the previous session.

## 7. Suggested Files and Interfaces

Keep the implementation in a small number of modules corresponding to concrete responsibilities. These boundaries are suggestions and may be combined during implementation; do not create empty abstractions merely to match a directory structure.

| Location                                                                | Responsibility                                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/shared/app-state.ts` (new)                                         | Preference/state DTOs, versions, limits, and pure validation; no Node/Electron imports    |
| `src/main/app-state/data-directory.ts` (new)                            | Startup paths, locator file, directory validation, and reselection setup                  |
| `src/main/app-state/app-state-store.ts` (new)                           | Reading/writing the two JSON files, coalescing queues, flushing, and corruption states    |
| `src/main/app-state/app-state-ipc.ts` (new)                             | Fixed settings/snapshot/data-directory operations; no generic configuration-key interface |
| `src/renderer/lib/use-app-settings.ts` (new)                            | Settings loading, display preferences, and persistence feedback                           |
| `src/renderer/lib/use-startup-restore.ts` (new)                         | One restoration run, cancellation, and metadata snapshots, using existing controllers     |
| `src/renderer/components/shell/SettingsDialog.tsx` (new)                | The single settings dialog                                                                |
| Existing main/workspace, preload, App, styles, and test/package scripts | Minimal integration while retaining existing responsibilities                             |

Suggested narrow capabilities are `appState.get()`, `updatePreferences(validatedPreferences)`, `checkpoint(validatedSessionSnapshot)`, `openDataDirectory()`, `chooseDataDirectoryOnNextStart()`, and `resetInvalidFile(settings|state)`, plus `workspace.restoreLast()`. Names may change, but data-directory selection must use native UI in the main process. Do not give the renderer arbitrary filesystem access. If the existing close protocol or startup data already handles an operation, do not add a duplicate method.

## 8. Work Packages

Dependency order: **WP0 → WP1 → WP2/WP3 → WP4 → WP5**. WP2 and WP3 may proceed independently only after the shared contracts are fixed. Record a short outcome for each package rather than creating extensive process documentation, then produce one completion report.

| Work package                             | Implementation                                                                                                                                                                                                                                                              | Completion gate                                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WP0: Baseline and startup validation** | Read this plan and existing lifecycles; run the existing check/build; use small verification exercises to confirm portable paths, first native selection → relaunch, redirection before ready, single-instance locking, NSIS uninstall boundaries, and automation isolation | Actual data paths and startup order are established; no feature expansion or new runtime dependencies in this package                                                        |
| **WP1: Data directory and JSON storage** | Three path strategies, locator file, fixed layout, strict validation, safe writes/flush, isolated test paths, and git/package exclusions for new directories                                                                                                                | Missing/corrupt/unwritable data is recoverable; no silent fallback to C; serial saves prevent stale snapshots from overwriting newer state; data stays out of packages       |
| **WP2: Basic settings and themes**       | Settings dialog, themes, TXT presets/size, startup mode, displayed data directory, and reselection action                                                                                                                                                                   | Preferences survive restart; theme/font changes do not mark documents dirty or lose history; keyboard, dark-mode, and high-contrast behavior work                            |
| **WP3: Workspace and tab restoration**   | Main-process restoreLast, shared commit/generation checks, one renderer restoration run, failed tabs, cancellation, recording modes, and snapshot session identity                                                                                                          | TXT/DOCX order and active tab are correct; read/security checks remain intact; old results cannot contaminate new sessions; previous degraded confirmations are invalidated  |
| **WP4: Layout and close integration**    | Bounds/maximized/sidebar state, offscreen correction, snapshots after path moves/deletions, close-time queue finishing, and write-failure feedback                                                                                                                          | Cancel/discard/close-while-saving semantics do not regress; initial restoration cannot overwrite old state; settings/state write failures are not reported as document saves |
| **WP5: Regression and delivery**         | Targeted tests, full check/build/E2E, portable/installed restart and uninstall verification, documentation, and a bilingual completion report                                                                                                                               | Evidence supports every acceptance item below; record the actual system environment and unverified items; do not change public binary authorization                          |

## 9. Acceptance Checklist

- [ ] With development/portable/installed data roots on a non-C drive, settings, restoration records, and configurable Electron profile/cache/log/dump paths actually use that location. Check actual paths and directory changes before/after running, not just configuration code.
- [ ] On C, installed builds add only the bounded locator and explicitly documented necessary startup/system traces. The data root is separate from the installation directory and survives upgrade/uninstall. Portable persistent data is outside the temporary extraction directory.
- [ ] Chinese characters/spaces in the data path, unwritable directories, missing data drives, canceled initial selection, and canceled reselection all have defined outcomes. No automatic data moves or silent fallback to C occur.
- [ ] Missing/corrupt/unknown-version/oversized configuration, extra fields, path traversal/links, and write failures cannot damage documents or expand permissions. Incomplete output never replaces the previous file.
- [ ] The three startup modes record and restore as defined. Empty state cannot overwrite records awaiting restoration. Repeated calls, cancellation, manual opening, and stale asynchronous results cannot produce duplicate tabs or an incorrect root.
- [ ] Behavior is covered for mixed TXT/DOCX, identical names at different paths, empty files, read errors, read-only/degraded documents, external changes, and restoration after rename/move/Save As/delete.
- [ ] Changing settings and restoring state do not mark documents dirty, save their content, or clear current-session history. Old search state, compatibility confirmations, and tab IDs do not survive restart.
- [ ] Window behavior is valid after display changes/disconnection/scaling, and maximized/sidebar bounds remain valid. Settings, dark mode, and key error states are usable at 900×600 and 1280×820.
- [ ] Canceling close, discarding changes, saving, persistence write failures, and forced termination behave as specified. No claim is made to recover unsaved content or guarantee the final millisecond of metadata.
- [ ] Test and screenshot data roots use isolated repository directories. Respect the existing `--user-data-dir` test override or migrate every call site together. Tests must not read real user restoration records or delete workspaces/user profiles.
- [ ] Run and pass `./scripts/npm.cmd run check`, `./scripts/npm.cmd run build`, and `./scripts/npm.cmd run test:e2e` in sequence. Because this task changes startup and data paths, also verify actual restart and storage locations in internal portable/NSIS builds.

## 10. Implementation References

- Use the [project baseline](../../architecture/PROJECT_BASELINE.en.md), [Task 12 completion report](../task-012/TASK_012_COMPLETION_REPORT.en.md), [testing guide](../../development/TESTING.en.md), and current source as the project record.
- [Electron app API](https://www.electronjs.org/docs/latest/api/app): paths, lifecycle, logging, and single-instance capabilities; compare against the pinned Electron version's local type definitions and actual behavior before implementation.
- [electron-builder portable documentation](https://www.electron.build/docs/nsis/#portable): verify the actual launcher location together with the pinned dependency's `portable.nsi`. Follow the current template; do not assume that portable packaging automatically makes application data portable.
- [electron-builder NSIS configuration](https://www.electron.build/docs/nsis/): verify data retention against the current `electron-builder.yml` and the pinned dependency's uninstall template.

The original plan reviewed source, existing records, and official references only. Subsequent WP0 verification is recorded separately in the completion report; it does not imply product-feature or full-task acceptance.
