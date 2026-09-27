# TASK-013 Completion Report: Basic Settings and Startup Restore

[简体中文](./TASK_013_COMPLETION_REPORT.md) | English

[Task plan](./TASK_013_SETTINGS_STARTUP_RESTORE.en.md) · [Task archive](../README.en.md)

> **Status: in progress. WP0–WP3 complete.** This run on 2026-09-27 implements only WP3, workspace and tab restoration, and stops at handoff; WP4/WP5 have not started.
> All three startup modes, disk-based workspace/tab reopening, and incomplete-restore data protection are connected. Window layout and complete close/failure integration remain for WP4. Task 12 release boundaries are unchanged.
> Sections 1–9 preserve historical WP0–WP2 results; section 10 records WP3.

## 1. WP0 baseline and scope

- Branch `TASK-13`, starting commit `e536c1c70e826fe5dd0fe232fda178a953660635`; initially clean Git worktree, no existing Task 13 completion report, and no applicable repository/ancestor `AGENTS.md` found.
- Read the complete task plan, development prompt, README, PROJECT_BASELINE, TESTING, and Task 12 completion report; inspected the integration points below.
- Host Windows build `26200.9457` is Windows 11, not Windows 10 evidence. Project-local Node `22.15.0`, npm `10.9.2`, pinned Electron `43.6.0`, builder `27.0.0-alpha.8`; current Vitest `3.2.7`.
- No changes to `src/`, product packaging configuration, dependencies, or lockfile. Retained two isolated probe scripts, lint/format exclusions for tool/output directories, and bilingual handoff documentation. No product UI wiring.
- All synthetic data, caches, and probe packages live in the already Git-ignored `.tools/task-013-wp0/`. The existing builder allowlist collects only product `out/main`, `out/preload`, `out/renderer`, and required metadata/dependencies; probes and data are excluded. Existing `.tools/doc-review/` files were preserved.

## 2. Commands and actual results

Every npm/node command used `scripts/npm.cmd` / `scripts/node.cmd`. The verification shell temporarily set TEMP/TMP to repository `.tools/task-013-wp0/temp`, inherited only by its child processes. No user/system environment changes. Each probe creates a separate directory and provides isolated TEMP/TMP, appData, and profile paths to its children.

| Command/action                                                                                                    | Result | Evidence                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Initial `npm.cmd run check`                                                                                       | 1      | Typecheck passed; lint included three old Git-ignored `.tools/doc-review/` CJS scripts, producing 25 errors; later stages did not run |
| `npm.cmd run check` after scope correction                                                                        | 0      | Typecheck, lint, format, 103-package NOTICE verification; 73 files, 1189 passed, 10 conditional skips, zero failures                  |
| Subsequently `npm.cmd run build`                                                                                  | 0      | main 155.17 kB, preload 4.30 kB, renderer JS 2264.13 kB; zero product-code changes                                                    |
| `node.cmd scripts/verify-task-013-startup.mjs`, twice in restricted sandbox                                       | 1      | Pre-ready paths succeeded; renderer data URL load returned `ERR_FAILED (-2)`; second attempt only added error diagnostics             |
| Same command in ordinary desktop process                                                                          | 0      | Passed with unchanged security settings: same-root lock, window focus, exit/restart, persistent cookie                                |
| Same command with `--native`, ordinary desktop process                                                            | 0      | Real Windows directory dialog operated through computer-use, not mocked; locator → `app.relaunch()` → new normal PID passed           |
| Same command with `--prepare-package`                                                                             | 0      | Prepared a minimal probe project and builder configuration with a separate appId inside the isolated directory                        |
| `node.cmd scripts/run-electron-builder.mjs --config .tools/task-013-wp0/builder.json --win --x64 --publish never` | 0      | Real portable/NSIS packages, product fuse hook, ASAR integrity, unsigned policy; no publishing                                        |
| Probe with `--portable=.tools/task-013-wp0/package/WP0-portable.exe`                                              | 0      | Real launcher/extraction paths, redirection, same-root lock, and cookie restart passed; passed again after adding launcher-exit waits |
| Separate NSIS `/S /D=<probe-install>`                                                                             | 0      | Repository install directory containing Chinese/spaces; separate appId, no desktop/start-menu shortcuts                               |
| Probe `--installed=<probe-install>/WenShu.exe`                                                                    | 0      | Real installed EXE startup, external root, same-root lock, restart persistence                                                        |
| Separate uninstaller `/S _?=<probe-install>`                                                                      | 0      | Synthetic sentinel inside installation deleted; all 44 external data-file SHA-256 hashes unchanged                                    |
| `npm.cmd run test:e2e`, isolated TEMP/TMP                                                                         | 0      | One file, four cases: startup/About, exact TXT bytes, DOCX/backup, dirty-tab close cancellation                                       |
| New script Prettier / ESLint                                                                                      | 0      | Initial lint caught missing explicit Node global imports in MJS; imports fixed, rules unchanged                                       |

The baseline fix only excludes `.tools/`, `.local-data/`, and `release/` tool/output directories from ESLint/Prettier. No source rules, assertions, existing timeouts, or test skips were relaxed. The ten existing symlink/junction capability skips are TXT 2, DOCX 2, search 2, and resolve/relocate/trash/reveal 1 each. One EPERM cleanup message belongs to an existing fault-injection test, not a baseline failure.

Existing E2E already supplies `--disable-gpu --no-sandbox`; unchanged here, its 4/4 result is behavioral regression evidence only. The dedicated WP0 probe uses neither switch and keeps `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`. Successful actual startup occurred in an ordinary desktop execution environment; restricted-sandbox failures remain recorded as failures.

Final targeted checks: the retained script passed ordinary desktop startup (`known-SwsbP8`); `npm.cmd run lint`, `npm.cmd run format:check`, and `git diff --check` returned 0. All 334 local Markdown link targets exist. Reading the probe ASAR found only `main.mjs` and `package.json`, with no verification data. The first ASAR one-line command failed because Windows command-line quoting stripped quotes; rerunning as a local `.mjs` file passed. Final repository Electron/probe process count: zero.

## 3. Startup and filesystem evidence

Local evidence resides under `.tools/task-013-wp0/`: `check*.log`, `build.log`, `e2e.log`, `package.log`, `nsis-result.json`, plus per-run `events.jsonl` / `summary.json`. This report uses relative paths and synthetic data; profiles, packages, and absolute user paths are not committed.

- **Known root** (`known-uVZavD`): `paths-before-ready.ready=false`, userData=`数据 根/runtime`, sessionData=`数据 根/runtime/session`. Only the normal branch creates one session and one BrowserWindow. The second process loses the lock before ready with zero sessions/windows; the primary receives `second-instance`, still has one window, and reports `focused=true`. A third PID reports `previousCookie=true`.
- **First-run bootstrap** (`native-pHMzJE`): zero sessions and BrowserWindows before and after the real native dialog. The selected path contains Chinese/spaces. The locator is **103 bytes**, written through same-directory exclusive temporary file → write → fsync → close → rename. `app.relaunch()` produces another PID that sets the final paths before ready. No post-ready cache-path switch.
- **Actual files**: after normal exit, `runtime/session/Network/Cookies`, `Local State`, `Preferences`, `Cache`, `Code Cache`, `GPUCache`, and other Chromium files exist. `session.defaultSession.getStoragePath()` equals explicit sessionData. The synthetic cookie survives restart, proving more than setPath calls. Log/crash-dump paths and directories were checked, but no log or crash dump was deliberately generated; dump contents are unverified.
- **Bootstrap trace limitation**: even without accessing defaultSession or creating a business window, bootstrap creates `bootstrap-traces/session/Local State`. To protect real profiles, the probe redirects bootstrap paths before ready too. This is test isolation, not a production fallback data root; it does not prove the real system user directory gains only bootstrap.json. WP1 must define startup-trace placement and WP5 must measure final product directory changes. The plan already permits necessary bootstrap/system/temporary traces.
- **Portable** (`portable-9UwWuo`, exit-wait rerun `portable-aUAh15`): the real launcher is in `launcher 中文/`. Its NSIS launcher sets the environment variable; the verifier removes inherited portable markers first. Persistent data is `launcher 中文/WenShuData/runtime/session`; the running EXE is elsewhere, under this run's child TEMP. Cookies survive restart. Lock results apply to the same data root, not all different roots/users.
- **NSIS**: the separate probe uses pinned builder default portable/uninstaller templates and the product fuse hook, with a distinct appId; no user WenShu installation was touched. Uninstall removed internal `WenShuData/synthetic-sentinel.txt`, while all 44 external files retained their hashes. In-place `_?=` invocation leaves the uninstaller itself; recorded as a probe invocation artifact, not complete installation-directory removal. Final WenShu product upgrade/uninstall acceptance was not performed.

## 4. Integration points and WP1 file handoff

| File/module                                                             | Verified behavior and follow-up responsibility                                                                                                                                                                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/index.ts`                                                     | No path setup or single-instance lock; whenReady immediately accesses defaultSession, registers business IPC, creates 1280×820/minimum 900×600 window. WP1 must split bootstrap/normal paths before this callback                                         |
| `workspace-session.ts` / `workspace-ipc.ts`                             | Root is main-process memory only, from the workspace-open native picker. Successful scan commits; cancellation/failure preserves it. Main-process scan generation and session token are missing; restoreLast must share safe successful-scan commit logic |
| `scan-workspace.ts` / document path resolution / workspace search       | Tree scanning and secure document resolution are different layers. Restored roots need component-wise lstat/realpath link rejection; scanning alone is insufficient. Exclude the actual data subtree by real path, not every folder named WenShuData      |
| `window/window-close.ts` / `App.tsx`                                    | Main close first asks renderer, with pending deduplication; renderer checks latest dirty/saving. Add final metadata checkpoint/flush only after close permission, preserving save protection                                                              |
| `src/preload/index.ts` / `src/shared/desktop-api.ts`                    | Fixed narrow calls, no appState/restoreLast. Add finite DTO/results, not fs, arbitrary keys/roots, or generic invoke                                                                                                                                      |
| `use-workspace.ts`                                                      | Generation rejects stale renderer results, successful commit advances epoch, refresh is single-flight. Share success commit and carry the main-issued session token                                                                                       |
| `use-documents.ts` / `use-editor-sessions.ts`                           | openFile deduplicates paths; reads use epoch/tabId/requestId gates and retain read-error tabs. Reuse controllers; do not persist editors, content, revisions, or runtime tabId                                                                            |
| `electron.vite.config.ts` / builder / `verify-package.mjs`              | Keep CJS sandbox preload; resolve development root relative to stable `out/main`, not cwd. WP1 adds `.local-data` Git/package deny rules and audit while preserving allowlists/fuses                                                                      |
| `tests/e2e/electron-smoke.test.ts` / `scripts/capture-ui-baselines.mjs` | E2E uses tmpdir + `--user-data-dir`; capture only sets cwd-relative `out/.capture-user-data` before ready. Migrate both launchers together, isolating session/log/dump and settings/state so they never read developer/user restore records               |

Keep the small planned modules: `src/shared/app-state.ts` (pure DTO/budgets/validation), `src/main/app-state/data-directory.ts` (paths/bootstrap/locator), `app-state-store.ts` (two JSON files/queues/flush), `app-state-ipc.ts` (narrow operations). None of these WP1 product modules was created in WP0.

## 5. Fixed directory policy and contract

### Directories

1. Development: `.local-data/dev` under a stable project root, independent of cwd or drive letters. Portable: `PORTABLE_EXECUTABLE_DIR/WenShuData`, not `dirname(process.execPath)`. Installed/non-portable standalone: independently selected native data root; long-term application locator data in the system user directory is only `<appData>/WenShu/bootstrap.json`, ≤8 KiB.
2. Final root contains `settings.json`, `state.json`, `runtime/session`, `runtime/logs`, `runtime/crashDumps`. userData=runtime; sessionData=runtime/session. Validate/create required paths, set synchronously at top level before ready, then acquire the instance lock before business session/window/IPC initialization.
3. Reject installation-root equality, ancestor/descendant overlap, and overlap through links. Validate ordinary local directory components. Never recreate a missing recorded root as if it were the original. Unwritable/missing installed roots use retry/select/exit; unwritable portable roots require moving the directory or exiting. No silent C-drive fallback.
4. First selection cancellation exits. Requested reselection cancellation preserves the old path, clears the flag, and restarts there. If the old root is unavailable, cancellation returns to retry/exit. No automatic migration/merge/deletion; requesting next-start reselection only writes the flag, without restarting the editing session.
5. No zero-C-write promise for Windows/bootstrap/portable TEMP extraction, and no global TEMP/TMP changes. Test overrides precede mode selection and accept only main-process launch inputs; renderer gets no path-selection capability.

### WP1 DTO basis frozen during WP0 (implementation in section 8)

| Object        | Fields, defaults, budgets                                                                                                                                                                                                                                                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bootstrap     | `{version:1,dataRoot:string,reselectOnNextStart?:boolean}`; UTF-8 ≤8192 bytes; absolute local root; reject extras/unknown versions; cancellation preserves old locator                                                                                                                                                                                                                               |
| settings      | `{version:1,theme,txtFontPreset,txtFontSizePx,startupMode}`; ≤16384 bytes. theme=`system/light/dark`, default system; font=`system/monospace/serif`, default **monospace**; integer size 12–24, default **13**; startupMode=`blank/workspace/workspace-and-tabs`, default last option                                                                                                                |
| state         | `{version:1,window:{normalBounds,maximized},sidebar:{width,collapsed},lastWorkspace}`; ≤524288 bytes. normalBounds initially null, otherwise finite safe integer x/y/width/height with positive dimensions, corrected against screens by main; maximized=false; sidebar 258 px/false with existing 180–420 clamp; lastWorkspace=null                                                                 |
| lastWorkspace | `{rootPath,tabRelativePaths,activeRelativePath}`; rootPath supplied by main only. `/` relative TXT/DOCX paths; reject absolute paths, empty/dot segments, backslashes, NUL/ADS. Suggested uniform path limit: 4096 UTF-16 units plus JSON byte budgets. Active path is null or a list member; workspace-only mode stores empty list/null activity                                                    |
| checkpoint    | `{workspaceSessionId,tabRelativePaths,activeRelativePath,sidebar}`; no workspace means null token/empty paths. Renderer supplies no root/window bounds/dataRoot. Main issues an opaque token, changes it on successful switch including same-root reopen, preserves it on refresh; validate at acceptance/queueing and before publication, rejecting old workspace snapshots. Token is not persisted |

Current TXT styling is `'Cascadia Mono', Consolas, 'Courier New', monospace` at 13 px in `app.css`, so the default is monospace/13 rather than guessing system from a UI label. Font changes affect display only.

Restore at most 100 tabs without limiting runtime tab count. Deduplicate in main, keep the active tab on truncation, preserve relative order of remaining selected tabs, and return explicit `TAB_LIMIT` feedback. Snapshot input itself is bounded to 512 KiB; reject oversized IPC before merging, not after unbounded copying/parsing. Stat/bounded-read files before parsing and validate versions/exact shapes without spreading untrusted objects.

Narrow API: `appState.get()`, `updatePreferences(complete allowlisted preferences)`, `checkpoint(snapshot)`, `openDataDirectory()`, `chooseDataDirectoryOnNextStart()`, `resetInvalidFile('settings'|'state')`, plus argument-free `workspace.restoreLast()`. Suggested results: `{status:'ok',...}` / `{status:'error',error:{code,message}}`, with separate cancellation status. Codes distinguish at least `INVALID_REQUEST`, `INVALID_DATA`, `UNSUPPORTED_VERSION`, `TOO_LARGE`, `STALE_SESSION`, `DATA_DIRECTORY_UNAVAILABLE`, `READ_FAILED`, `WRITE_FAILED`. get returns per-file missing/valid/invalid/unsupported/read-error and safe defaults. Errors omit raw exceptions/absolute paths; actual data location is returned only through an intentional display field.

One serial queue per file, roughly 500 ms metadata coalescing; exclusive same-directory temporary file → full write → sync → close → rename. Failure retains old files and in-memory preferences. Enqueue acknowledgment is not durable success: distinguish queued/saved, flush waits for the latest generation and in-flight writes, and expose retryable persistence failures. Clear lastWorkspace for mode changes only after settings is durable. The two files are not a transaction: on startup, apply settings to state projection so stale tabs cannot unexpectedly restore. Invalid/unknown versions are not overwritten automatically; preserve originals before explicit reset.

Close first completes existing dirty/saving protection, then final metadata checkpoint/flush. Failures offer retry/continue-exit, independently of document-save outcomes. Suspend snapshots during restoration; closing mid-restore keeps original lastWorkspace and finishes only settings/layout. Only explicit stop adopts the partial visible state. Main owns roots/bounds; document typing does not write state.

Test compatibility: preserve existing `--user-data-dir=<P>` runtime semantics. WP1 treats that explicit argument as isolated test root `<P>`: settings/state in `<P>`, userData still `<P>`, session/log/dump below it, bypassing real bootstrap/development roots (test-only layout exception). Production layouts remain fixed. E2E and capture adopt this together; capture paths resolve from script location. An override that redirects only Chromium while reading real settings/state is unacceptable.

## 6. Reusable verification and remaining conditions

```powershell
.\scripts\node.cmd scripts/verify-task-013-startup.mjs
.\scripts\node.cmd scripts/verify-task-013-startup.mjs --native
.\scripts\node.cmd scripts/verify-task-013-startup.mjs --prepare-package
.\scripts\node.cmd scripts/run-electron-builder.mjs --config .tools/task-013-wp0/builder.json --win --x64 --publish never
.\scripts\node.cmd scripts/verify-task-013-startup.mjs --portable=.tools/task-013-wp0/package/WP0-portable.exe
```

For `--native`, select `数据 根` under the printed run directory using the real dialog. Native interaction has a 180-second deadline; normal startup observation has 30 seconds. This synthetic-data probe's simplified locator reader is not a production validator. NSIS installation/uninstallation must target only the separate identity generated by `--prepare-package`; verify the installed EXE with `--installed=<probe-install>/WenShu.exe`. Never use a user's existing installation for this exercise.

WP0's core feasibility checkpoint is satisfied and ready for WP1 handoff. The following gates remain open; Task 13 is not complete:

- Bootstrap Local State was actually observed. WP1 must settle startup-trace placement and WP5 must measure the final product's bounded long-term system-user-directory data. Test appData redirection does not establish production behavior.
- WP1 still requires strict directory/link/installation-overlap validation; unwritable/missing roots; first cancellation, requested-reselection cancellation, unavailable-old-root cancellation; corrupt/oversized/unknown JSON; write failure and flush races. No mock-only completion claims for these cases.
- Default development `.local-data/dev` and final portable/installed product entries are not wired. Final product upgrade/uninstall preservation of external settings/state, real log/dump output, cross-user/different-root lock scope, and Windows 10 hardware remain unverified. This run proves the minimal pinned-runtime/template flow only.
- Subsequent implementation must migrate E2E/capture overrides and add `.local-data` Git/package audit exclusions. Existing E2E no-sandbox limitations must remain explicit.

WP0 stopped here. The subsequently authorized WP1 work is recorded in section 8.

## 7. References checked

- Pinned `node_modules/electron/electron.d.ts`: `setPath`, `setAppLogsPath`, `relaunch`, `requestSingleInstanceLock`, `Session.getStoragePath`; compared with [Electron app API](https://www.electronjs.org/docs/latest/api/app#appsetpathname-path): directories must exist and sessionData is overridden before ready.
- Pinned `node_modules/app-builder-lib/templates/nsis/portable.nsi`: `$EXEDIR` environment variable, `ExecWait`, extraction cleanup; compared with [builder portable documentation](https://www.electron.build/docs/nsis/#portable).
- Pinned `uninstaller.nsh`: `RMDir /r $INSTDIR` and separate AppData deletion branch; compared with [NSIS configuration](https://www.electron.build/docs/nsis/#deleteappdataonuninstall). `deleteAppDataOnUninstall:false` does not protect data inside the installation directory.

## 8. WP1: Data directories and JSON storage (completed)

Started from clean commit `521e9cd` (WP0). Re-read the entire plan, development prompt, and WP0 handoff; no applicable AGENTS.md was found. Reused applicable WP0 baseline and pinned Electron/portable/NSIS evidence instead of repeating all prerequisites. No dependency, lockfile, database, state framework, generic configuration registry, settings UI, or document restoration scheduler was added.

### 8.1 Final directory and startup rules

| Mode                   | Data root                                                                   | userData / sessionData                      | Locator and failure behavior                                                                                             |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Development            | Repository `.local-data/dev`, resolved from the built entry rather than cwd | `<root>/runtime` / `<root>/runtime/session` | Report unavailable fixed root and exit                                                                                   |
| Portable               | `PORTABLE_EXECUTABLE_DIR/WenShuData`                                        | Same                                        | Never derive persistent storage from the extracted EXE; prompt to move the entire portable folder when unwritable        |
| Installed              | Independently selected native directory                                     | Same                                        | `<appData>/WenShu/bootstrap.json`, UTF-8 ≤8192 bytes; neither data root nor installation directory may contain the other |
| Explicit test override | `--user-data-dir=<P>`                                                       | `<P>` / `<P>/session`                       | settings/state also reside in `<P>`; bypass real bootstrap; empty, relative, unsafe, or unavailable overrides fail       |

`logs` and `crashDumps` are below runtime and configured before ready; no document logging or crashReporter is started. Bootstrap uses its own `wenshu-bootstrap-*` runtime under OS temp, with best-effort cleanup of that directory on exit. This contains the Local State observed in WP0 without creating a permanent Chromium profile alongside the locator. After the isolated installed-mode native selection/restart, the appData subtree contained only the **131-byte bootstrap.json**. This does not promise zero C-drive writes by Windows, native dialogs, or portable extraction.

Only the ready branch requests the lock for the resolved profile, initializes the business session/IPC, and creates the business window. A second instance creates no business window/session and asks the first instance to restore/show/focus its window. Bootstrap uses native UI only, writes the locator, requests `app.relaunch()`, and exits.

First cancellation exits without a locator. Requested reselection cancellation revalidates the old root, clears the flag, and restarts with it. Missing old roots are never recreated as empty substitutes; cancelling replacement returns to Retry/Exit. Reselection marks the next launch and never migrates data. The native picker suggests a non-C installation volume, or enumerates available non-C volumes when installed on C; a suggestion never silently becomes the data root. Selection accepts an empty or compatible WenShu directory and rejects installation overlap, links/unsafe ancestors, unrelated contents, and invalid existing JSON.

### 8.2 Final DTOs and error contracts

`src/shared/app-state.ts` owns the fixed whitelist, budgets, and defaults:

- `settings.json`: `version:1`, `theme:'system'` (system/light/dark), `txtFontPreset:'monospace'` (system/monospace/serif), `txtFontSizePx:13` (integer 12–24), `startupMode:'workspace-and-tabs'` (blank/workspace/workspace-and-tabs); ≤16 KiB.
- `state.json`: `version:1`, `window:{normalBounds:null,maximized:false}`, `sidebar:{width:258,collapsed:false}`, `lastWorkspace:null`; ≤512 KiB. Bounds use safe integer x/y/width/height with positive dimensions; screen correction belongs to WP4. Sidebar width is an integer 180–420.
- `lastWorkspace`: main-owned `rootPath`, `tabRelativePaths`, `activeRelativePath`. Paths are bounded to 4096 UTF-16 units and the overall UTF-8 budget. Only canonical relative TXT/DOCX paths are accepted; dot segments, absolute paths, backslashes, controls, ADS, reserved device names, etc. are rejected. Existing filesystem segments are checked for links and type. At most 100 deduplicated restore tabs are retained, including the active item and original selected-item order; truncation reports `TAB_LIMIT`.
- `checkpoint`: only `workspaceSessionId`, relative tab paths/active path, and sidebar. Null session requires empty paths and does not erase a pending saved workspace. No body, DOCX model, search, old revision/confirmation, tabId, or editor object is accepted.
- `workspace-session.ts` owns roots and UUIDs. Every successful open, including reopening the same root, issues a new token in the selected `workspace.open()` result; refresh retains it. Open generations prevent stale scans from committing. Queue admission and replacement both validate the token; tokens are never persisted. WP3 must retain the token returned with the committed open/restore result instead of fetching a newer token for an old tab collection.

`appState.get()` returns `{status:'ok',snapshot}` with settings, projected state, `effectiveStartupMode`, current `workspaceSessionId`, both file health records, and `dataDirectory:{path,mode,canReselect}`. Health is `{status,pending,error}`, with missing/valid/invalid/unsupported/too-large/read-error statuses. Writes return `{status:'queued'|'saved'|'unchanged',warnings:[]|['TAB_LIMIT']}`; actions return `{status:'ok'}`. Failures are `{status:'error',error:{code,message,retryable}}`, without raw exceptions or stacks.

Codes are INVALID_REQUEST, INVALID_DATA, UNSUPPORTED_VERSION, TOO_LARGE, STALE_SESSION, DATA_DIRECTORY_UNAVAILABLE, READ_FAILED, WRITE_FAILED, FILE_CHANGED, and NOT_SUPPORTED. Write/read/directory/stale-session failures are retryable: stale sessions require a current snapshot; startup read failures require repair and restart. External changes report FILE_CHANGED and require restart/inspection rather than blind overwrite.

Seven fixed preload methods map to seven `app-state:*` handlers: `get`, `updatePreferences`, `checkpoint`, `flush`, `openDataDirectory`, `chooseDataDirectoryOnNextStart`, and `resetInvalidFile('settings'|'state')`. Handlers verify the business window, its main frame, arity, and DTO. There is no arbitrary path/key/channel capability. Directory display uses get, opening uses only the resolved root, and reselection is installed-mode only. No fake-success restore/layout method is exposed.

### 8.3 Publication and future wiring

Each file has one serial queue. Checkpoints coalesce for approximately 500 ms; preference calls await publication. Flush waits for in-flight and subsequently accepted revisions. Publication uses an exclusive random same-directory `wx` temporary file, full write, sync, close, parent/target fingerprint checks, and session validation immediately followed by synchronous rename without an event-loop yield. Targets are never truncated or deleted first. Failure preserves the old file, pending in-memory values, and an explicit error.

Missing files use defaults without automatic creation on startup/get/unchanged flush. Corrupt, oversized, unsupported, and unreadable files block automatic writes, including default layout, mode changes, and exit flush. Explicit reset handles invalid/too-large files only, preserving and flushing an exclusive `.wenshu-invalid-<uuid>.json` backup. Oversized originals are copied using filesystem identity checks rather than loaded entirely into memory. Unknown versions, links, and read failures are not reset over. External-change checks also apply to reset.

`projectStartupState` and `AppStateStore` are the sole startup-mode policy: only durable settings clear/trim lastWorkspace; reads also project it. Blank clears the workspace and workspace-only clears tabs. The two files are not a transaction. Failed preference writes retain a preview but `effectiveStartupMode` remains durable. WP2 and WP3 reuse this policy.

The main entry drains already accepted metadata only, with Retry/Exit on persistence failure and a one-attempt exit bypass; a cancelled dirty close cannot permanently bypass later flushes. WP4 still owns final snapshots, bounds/sidebar application, screen correction, and saving/dirty-close integration. Main-only `updateWindow` is not wired to window events. WP2 settings/theme/font UI and WP3 `workspace.restoreLast`, restore generations/cancellation, document reads/error tabs, and renderer snapshot suspension remain unimplemented.

Workspace scan/search exclude the precise active data subtree, including real-path boundaries, while retaining same-named user folders. Scan classifies links before directories. E2E uses `.local-data/test/e2e`; capture uses script-relative `.local-data/screenshots/runtime` and redirects session/log/dump paths too. Git ignore, explicit builder exclusions, and actual ASAR/unpacked audits reject data/probes.

### 8.4 Actual commands and evidence

All commands use repository `scripts/npm.cmd` / `scripts/node.cmd`; prefixes are abbreviated below. WP1 did not change global or verification-shell TEMP/TMP. Only native-probe child environments override TEMP/TMP and explicitly isolate appData.

| Command/check                                                                                                                                                | Actual result                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial `npm.cmd run typecheck`                                                                                                                              | Failed on inferred numeric bootstrap version; fixed with BootstrapRecord. Two strongly typed fixtures were updated when selected results gained a session ID                                                                                                                                      |
| Initial targeted tests                                                                                                                                       | 11 failed/49 passed, primarily because Windows Node 22 lstat.dev=0 differs from fstat's volume serial, plus a cyclic junction fixture. Replaced the invalid comparison with bigint file identity/timestamps and same-path validation; corrected the fixture without weakening assertions/timeouts |
| Initial `npm.cmd run check`                                                                                                                                  | Typecheck passed; lint rejected control-character regexes. Replaced them with character-code checks without disabling the rule                                                                                                                                                                    |
| Corrected full `npm.cmd run check`                                                                                                                           | Typecheck/lint/format/NOTICE passed; 76 files, 1226 passed, 10 baseline conditional skips. Subsequent additions are included in the final verification record                                                                                                                                     |
| Subsequent `npm.cmd run build`                                                                                                                               | Passed; later title/path/exit-drain revisions were rebuilt                                                                                                                                                                                                                                        |
| `npm.cmd exec -- vitest run tests/app-state`                                                                                                                 | 4 files, 39 passed, no skips: read-only replacement failure/retry, concurrency/flush, stale sessions, corrupt/oversized/future JSON, extra fields, hard links/junctions, exact exclusion                                                                                                          |
| `npm.cmd run test:e2e`, ordinary desktop                                                                                                                     | Original 4 passed; expanded persistence restart/path/session/bad-file checks passed 6/6. Removed the pre-existing `--no-sandbox`; retained only the test GPU option                                                                                                                               |
| `node.cmd scripts/run-electron-builder.mjs --config electron-builder.yml --win --x64 --dir --publish never`, then `npm.cmd run package:verify -- --mode=dir` | Passed actual ASAR/unpacked exclusion audits. External runtime imports remain docx/jszip/mammoth. Old portable/NSIS artifacts listed by the audit are not newly rebuilt product binaries                                                                                                          |

Reusable real verification entry:

```powershell
.\scripts\node.cmd scripts/verify-task-013-storage.mjs --prepare-package
.\scripts\node.cmd scripts/run-electron-builder.mjs --config .local-data/test/task-013/startup/builder.json --win --x64 --publish never
.\scripts\node.cmd scripts/verify-task-013-storage.mjs --mode=development
.\scripts\node.cmd scripts/verify-task-013-storage.mjs --mode=installed --case=first
.\scripts\node.cmd scripts/verify-task-013-storage.mjs --mode=installed --case=first-cancel
.\scripts\node.cmd scripts/verify-task-013-storage.mjs --mode=installed --case=reselect-cancel
.\scripts\node.cmd scripts/verify-task-013-storage.mjs --mode=installed --case=missing-cancel
.\scripts\node.cmd scripts/verify-task-013-storage.mjs --mode=portable
.\scripts\node.cmd scripts/verify-task-013-storage.mjs --mode=portable --case=unwritable
```

The host bundles production startup/store modules and creates a minimal isolated window. Installed mode uses a real unpacked EXE with `app.isPackaged=true`; portable uses the actual builder launcher. Electron/native dialogs are not mocked. Development projectRoot and installed appData are injected for isolation, so this is not final full-product installation/uninstallation evidence. Native cases require real UI interaction. The unwritable case applies a Windows write-deny ACL only to its newly created fixture and removes it on normal completion. Wrappers record actual native calls/responses and reject selections outside the isolated run.

Evidence is retained in `.local-data/test/task-013/startup/<run>/events.jsonl`, excluded from packages:

| Run                                | Observation                                                                                                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `development-known-0tIKBq`         | userData=`project/.local-data/dev/runtime`; session.storagePath=`…/runtime/session`; zero windows/sessions before ready; second instance has no business initialization                                               |
| `installed-first-plmlyS`           | PID 37776 selects `chosen 中文`, writes a 131-byte locator, and exits with zero business windows/sessions; PID 13800 starts the business branch with all runtime paths under that root; same-root lock/focus observed |
| `installed-first-cancel-JIv7yJ`    | Cancellation exits without business initialization or bootstrap.json                                                                                                                                                  |
| `installed-reselect-cancel-Mk76a6` | Cancellation clears the flag, preserves the old root, and restarts in a new PID; same-root lock passes                                                                                                                |
| `installed-missing-cancel-MKHmXt`  | Real native sequence: Retry/Select/Exit → Select → native cancellation → Retry/Exit → Exit; locator retained and missing root not created                                                                             |
| `portable-known-0w8izI`            | `PORTABLE_EXECUTABLE_DIR=launcher`; EXE=`temp/<random>/WenShu.exe`; actual runtime/session/log/dump paths under `launcher/WenShuData`; same-root lock passes                                                          |
| `portable-unwritable-Y6L00C`       | Real ACL denial produces a move-the-entire-folder message and Exit only; no business initialization or fallback; deny ACL removed after completion                                                                    |

Two early missing-root UI runs lacked a complete targetable interaction record: one isolated host was specifically terminated, the other recorded only exit. Neither establishes cancellation behavior. A clear native message title, visible interactive probe launch, and actual-response recording were added; MKHmXt is the complete accepted evidence. No security option was disabled and no platform conclusion rests only on mocks.

### 8.5 Handoff and remaining conditions

No unresolved prerequisite blocks WP1's core. WP2/WP3 take over `src/shared/app-state.ts`, `DesktopApi.appState`, `AppStateStore`, and the selected `workspaceSessionId`. WP3 reuses `workspace-session.ts` identity/generation ownership for restore commits instead of creating another root authority. WP4 takes over `updateWindow`, existing window-close coordination, and flush.

Remaining work: settings UI; real document restoration/error tabs; snapshot suppression during restore; layout application and final dirty/saving close integration; final full-product portable/NSIS restart, upgrade/uninstall preservation of external settings/state; actual log/crash-dump production; power-loss/forced-exit final-millisecond behavior; cross-user/different-root locking; Windows 10 hardware. WP0's NSIS template/uninstall findings still apply: keeping AppData never protects files inside the installation directory.

Stop after this handoff. Do not automatically implement WP2, WP3, or WP4, and do not mark Task 13 complete.

### 8.6 Final verification record

- Final `npm.cmd run check`: exit 0; 77 test files, 1230 passed, 10 conditional skips inherited from WP0's existing link-permission conditions, no failures. Typecheck, lint, format, and the 103-package NOTICE check passed. Subsequent final build, 6/6 E2E, product dir packaging, and package:verify all exited 0. Final main 193.38 kB, preload 4.96 kB, ASAR 12642170 bytes.
- Final missing-root guard: runtime creates direct children one level at a time and cannot recursively recreate a previously validated data root. The real-filesystem case passed. Its initial empty-directory fixture used rm and failed with EISDIR; corrected to rmdir before the full passing check. WP1 focused coverage now totals 40 cases.
- Latest real development host `development-known-XlzK63` passed with this single-level creation logic; runtime/session locations and same-root locking remained correct.
- Real host `--mode=test` recheck passed: `test-known-or8AXF/events.jsonl`, complementing the product E2E `--user-data-dir` evidence.
- Confirmed bootstrap temporary runtime cleanup, no locator after first cancellation, no recreated missing root, and no residual deny ACE on the ACL fixture. `git diff --check` passed.
- If even a safe runtime directory cannot be established, startup displays an error before ready and terminates without waiting for default-profile initialization. Checked pinned Electron types and the [official showErrorBox documentation](https://www.electronjs.org/docs/latest/api/dialog#dialogshowerrorboxtitle-content). This extreme temporary-directory failure was not separately exercised through native UI.
- Capture-launcher paths and syntax were checked; visual baselines were not regenerated. WP2 must connect the capture host's settings service when it starts reading preferences.

## 9. WP2: basic settings and themes (complete)

This run started on 2026-09-27 from clean commit `ca39bae` (WP1), with no applicable AGENTS.md. The plan, execution prompt, WP0/WP1 startup evidence, and seven appState methods were checked. Directory/storage prerequisites remain valid without a core blocker. Only WP2 was implemented; WP3 was not started. No dependencies, state framework, localStorage, routes, settings activity page, autosave, or drafts were added.

### 9.1 Entry points, persistence, and errors

- AppMenuBar exposes View → Settings…; App handles Ctrl+, without stacking an existing dialog. SettingsDialog reuses ModalDialog with Display / Startup / Data location groups, Tab containment, Escape, and focus restoration. Menu entry first establishes View as the return target. Dialog shortcuts do not reach document commands.
- Fields/defaults remain theme=system (light/dark/system), txtFontPreset=monospace (system/monospace/serif), txtFontSizePx=13 (integer 12–24), startupMode=workspace-and-tabs (blank/workspace/workspace-and-tabs). JSON fields, versions, and budgets remain WP1's.
- main.tsx waits for real appState.get and applies preferences before the first React render. Main chooses the initial background from preferences/nativeTheme; the unloaded page is transparent to reduce opposite-theme flashing. Missing files use defaults. Bad files remain intact with safe defaults and visible warnings. Service failures explicitly allow rereading without a substitute backend.
- use-app-settings manages immediate previews, serialized requests, and feedback. updatePreferences receives exactly four fields without version, followed by existing flush/get verification. Late responses cannot replace newer previews; failure retains display and permits retry. Preference-write and directory-action errors are separate, so successful directory opening does not hide a failed preference write.
- Only snapshot.effectiveStartupMode is durable. WP1 AppStateStore/projectStartupState alone clears/trims lastWorkspace. UI neither checkpoints nor maintains another history; failure shows the old effective mode. This version saves modes but explicitly does not automatically restore workspaces/tabs.
- The real path comes only from snapshot. Fixed opening and installed-mode canReselect actions call openDataDirectory/chooseDataDirectoryOnNextStart without paths, exit, or migration. Explicit second confirmation resets invalid/too-large settings/state; unsupported versions have no reset action. The dialog explains that restoration reopens disk files and unsaved content still requires manual saving.

### 9.2 Display seams and editor boundaries

Root data-theme=light|dark and semantic tokens theme the shell. System mode subscribes to prefers-color-scheme and cleans up on explicit-theme changes/unmount, with one effective listener in StrictMode. Legacy shell, error/disabled, menu/button, and search-panel colors use tokens. CodeMirror cursor, selection, and ordinary/current matches support dark display.

TXT uses only --txt-font-family / --txt-font-size on .cm-scroller. Defaults remain Cascadia Mono / Consolas / Courier New / monospace at 13 px; system/serif stacks include generic fallbacks. No editor transactions, reconstruction, or document formatting commands are added. DOCX ProseMirror keeps a white canvas, dark default text, and light color-scheme; explicit colors remain model-owned. Its match decorations retain white-canvas colors with forced-color outlines. No DOCX zoom was added.

### 9.3 Actual verification and failures

Commands use repository scripts/npm.cmd / scripts/node.cmd. Node os.release reports `10.0.26200`, Windows 11; Electron is 43.6.0. This is not Windows 10 hardware evidence. CIM queries were denied, so no current patch revision is inferred. User/system TEMP/TMP were unchanged. Product tests use isolated --user-data-dir profiles; logs remain in .local-data/wp2-*.log.

| Command/check                                         | Actual result                                                                                                                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-edit check in sandbox                             | 1230 assertions passed, 10 existing conditional skips; worker spawn EPERM caused 56 unhandled errors and exit 1, not a passing baseline                                                   |
| Subsequent baseline build                             | Exit 0; main 193.38 kB / preload 4.96 kB                                                                                                                                                  |
| Same baseline check with ordinary process permissions | Exit 0; 77 files / 1230 passed / 10 conditional skips. Confirmed sandbox worker restriction; no baseline product fix                                                                      |
| Initial affected component/style regression           | 4 files / 79 passed                                                                                                                                                                       |
| New settings/live-editor focused tests                | Initially 12 passed; final count after adding directory-success/write-failure regression follows below                                                                                    |
| Real Electron E2E                                     | Expanded to 8/8 passing: restart persistence, read-only settings failure/retry and old-state preservation, TXT/DOCX selection/history/dirty, original colors/unchanged bytes, bad-file UI |
| node.cmd scripts/capture-ui-baselines.mjs             | Exit 0; child-only WENSHU_CAPTURE_OUTPUT=.local-data/screenshots/wp2 produced four real-product images, leaving Task 11 images untouched                                                  |

Initial mock return types widened to string; typing mocks against AppStateApi fixed them. New E2E tests accidentally used Vitest's five-second default. Matching the existing Electron suite's 30-second budget still failed; diagnosis found nested label/select accessible names included options in real Chromium. Separate label + htmlFor/id fixed this, with the scenario completing in about two seconds and no further timeout increase. Capture lint's browser document reference moved into a page-evaluation string; no lint rule was disabled.

Real windows were inspected at 900×600 and 1280×820. Small settings dialogs scroll vertically without horizontal overflow and keep Close reachable. Evidence includes dark TXT, white DOCX canvas/original red text, toolbar/disabled states, system-theme media changes, and forced-colors. Images remain in .local-data/test/task-013/wp2, excluded from Git/packages; data/sidebar paths are masked only in evidence. Forced-colors is Chromium emulation, not a Windows system-setting change. Unit tests also compare real editor identities, immutable states, selections, models, undo/redo, and notification counts.

### 9.4 Final checks and handoff

Final verification followed check → build → test:e2e: check exited 0 (79 files, 1243 passed, 10 existing conditional skips; typecheck/lint/format/103-package NOTICE passed), build exited 0 (main 193.55 kB, preload 4.96 kB, renderer CSS 61.55 kB / JS 2282.73 kB), and final E2E passed 8/8. Then `node.cmd scripts/run-electron-builder.mjs --config electron-builder.yml --win --x64 --dir --publish never` and `npm.cmd run package:verify -- --mode=dir` both exited 0. Only the local unpacked product was generated; portable/NSIS were not rebuilt or published. All 13 new settings/editor tests are included in the passing check. The actual ASAR is 12669263 bytes with zero forbidden entries; main external imports remain docx/jszip/mammoth. Old portable/NSIS artifacts listed by the audit were not generated in this run. Closeout format:check and git diff --check passed; all 336 local link targets in 14 changed documents exist, and no remaining Electron/WenShu processes were observed. Task 13 remains in progress.

The first full regression had one old search-component assertion fail because its fixture lacked appState.get and the application correctly showed a read-error entry. Adding a normal read fixture preserved every original assertion and passed. The final search-highlight E2E initially used Playwright fill, which emits input, while native CodeMirror search commits on change/keyup; adding the user Enter action preserved highlight assertions and the 30-second budget and passed. Native window close now dismisses settings before the existing dirty/saving confirmation; cancellation preserves two dirty tabs. This is not WP4 final-checkpoint integration.

WP3 takes App.tsx, use-app-settings snapshot/effectiveStartupMode, WP1 DesktopApi.appState, and workspaceSessionId. restoreLast, document scheduling/cancellation/error tabs, and checkpoint suppression during restore are unimplemented. Reuse the main-process policy; never schedule from unpersisted preferences.startupMode.

WP4 takes waitForPendingPreferences() (drain renderer requests before flushing main-process queues), existing dirty/saving close coordination, and final checkpoint/window/sidebar integration. Layout restoration/final close snapshots are not connected; the last request is not guaranteed to reach disk before forced termination.

WP2 changes no preload/shared DTO. Display seams are data-theme, two TXT CSS variables, and semantic tokens. Capture now uses Node + Playwright to start the real product with fresh .local-data/screenshots/profile-* directories. DEVICE_SCALE/HIGH_CONTRAST/ZOOM_FACTOR/MATRIX_ONLY environment options remain; an output-directory override was added.

Later verification remains: complete product portable/NSIS restart/upgrade/uninstall, installed settings-button-to-next-native-bootstrap integration, Windows system high contrast/physical scaling, and Windows 10 hardware. WP0/WP1 path evidence remains valid, not a new final-package acceptance. No substitute storage design was introduced. This run stops at WP2 handoff without starting WP3.

## 10. WP3: workspace and tab restoration (complete)

On 2026-09-27, started from `15d7a90` (WP2), on `TASK-13` with a clean worktree and no applicable AGENTS.md. Reviewed the complete plan/prompt, WP0–WP2 evidence and actual contracts. WP1 directories, queues, durable mode and main-issued identities have no blocking prerequisites. This package retains the two JSON files and existing controllers, without new dependencies, localStorage, state frameworks, body caches or arbitrary-path IPC. WP4 has not started.

### 10.1 Interfaces and safety

- Added zero-argument `DesktopApi.workspace.restoreLast()` → `workspace:restore-last`, checking argument count/main frame. The root comes only from `AppStateStore.getRestoreRecord()`. Success is `{status:'selected',workspace,workspaceSessionId,restore:{tabRelativePaths,activeRelativePath,warnings}}`; other outcomes are `not-recorded`, `cancelled`, or `{status:'error',error:{code,message}}`. Root errors use WORKSPACE_UNAVAILABLE, invalid requests use INVALID_REQUEST, and bad-state errors retain WP1 codes. No raw exceptions/absolute paths in errors.
- Manual open and restore share validation/scanning/commit in workspace-ipc.ts: ordinary root/ancestors/links/realpath checked before and after scanning; current data subtree excluded; generation/window liveness checked before issuing a fresh UUID. Failure/cancellation preserves the old root/record. Refresh preserves identity and rejects stale-root results.
- Syntax/type/4096-character and 512 KiB file budgets remain. Selection deduplicates case-insensitively and caps restoration at 100, retaining the active item and selected items' original order. `validStoredState` accepts bounded duplicates/excess entries and a syntactically valid active path absent from the list for normalization. `validState` still requires canonical unique/capped output. `get()` returns canonical projection; main-only `getRestoreRecord()` retains the bounded original list for TAB_LIMIT reporting. Load/get/unchanged flush never rewrites it. Dangerous syntax, extra fields, corrupt/newer files remain rejected and protected.
- Existing links, wrong types and internal/data paths are filtered with UNSAFE_PATH. Missing/inaccessible/general read failures retain their positions. Actual reads still use the original TXT/DOCX safety checks; no missing-file creation, auto-save or compatibility confirmation. Invalid activity falls back to the first retained tab; no tabs shows welcome.
- `useWorkspace` retains the token from the selected result, with synchronous `isCurrentSession` and `cancelPendingOpen`. Checkpoints capture that token together with paths, never querying a newer token for an old list. Main admission/publication identity guards remain.
- AppStateStore/projectStartupState own the sole mode policy: blank clears/stops workspace recording, workspace retains root only, workspace-and-tabs retains paths. Restore uses durable effectiveStartupMode, never failed preference previews.

### 10.2 Phases, stop and close protection

`use-startup-restore.ts` implements waiting → workspace → tabs → ready, plus error/closing. It schedules once after settings load; a microtask prevents discarded StrictMode setup from starting IPC. Unmount/new batches invalidate generation; workspace generation/session and existing document epoch/tabId/requestId guards reject late results.

After root commit, sequential openFile calls allocate fresh tabs and disk snapshots. Read errors remain in place and subsequent files continue; read-only stays read-only and degraded requires new confirmation. No bodies, old revisions, search, selection/history or confirmations are restored.

- No checkpoint in waiting/workspace/tabs. Main/menu are inert; application shortcuts and file mutations are blocked. TXT uses a public Compartment for temporary readOnly/editable configuration; DOCX uses its existing editable seam. No editor reconstruction/body writes. Native close remains available; Stop Restore appears only in the tab phase.
- Explicit Stop synchronously invalidates the batch, preventing further scheduling/final activation. Open/loading tabs remain, snapshot suppression ends, and the already-started read completes through its original controller without extra tabs or focus changes. No new single-read cancellation protocol.
- Closing incomplete restore invalidates batch/pending scan/read results and submits no partial replacement. Old lastWorkspace remains complete. Ready-state prepareClose submits current metadata and waits for IPC acceptance before existing requestClose. Dirty cancellation never calls it; discard/saving guards remain. Existing main quit drain handles accepted writes.
- Metadata projects only committed paths/order/activity with 500 ms coalescing. Body input, dirty/read completion, search and editor objects do not trigger checkpoints. Separate retryable record-write feedback does not impersonate document saving. Stored sidebar values/window fields are preserved until WP4 applies live layout.

### 10.3 Actual verification

All commands use project scripts/npm.cmd or scripts/node.cmd. No TEMP/TMP changes or real profile access. Electron tests use isolated `.local-data/test/e2e` and `--user-data-dir`. The host remains Windows 11 build 26200, not Windows 10 evidence; WP0/WP1 platform/path evidence remains applicable.

| Command/check                                                                                               | Result                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-edit check, then build                                                                                  | Both exit 0; 79 files, 1243 passes, 10 existing link-permission skips; normal process permissions avoid the previously attributed sandbox worker limitation |
| `npm.cmd exec -- vitest run tests/app-state tests/preload/contract.test.ts`                                 | 7 files, 90 passes; 14 new main restore and 11 renderer restore cases                                                                                       |
| Affected editor/search component verification                                                               | 4 files, 106 passes; existing assertions retained                                                                                                           |
| Full `npm.cmd run check`                                                                                    | Exit 0; 81 files, 1268 passes, 10 existing conditional skips; typecheck/lint/format/103-package NOTICE pass                                                 |
| Subsequent `npm.cmd run build`                                                                              | Exit 0; main 196.82 kB, preload 5.04 kB, renderer CSS 61.83 kB / JS 2297.12 kB                                                                              |
| Subsequent `npm.cmd run test:e2e`                                                                           | Final 11/11 pass; new restore cases about 1.82 / 2.51 / 1.42 seconds; total tests 13.03 seconds                                                             |
| `node.cmd scripts/run-electron-builder.mjs --config electron-builder.yml --win --x64 --dir --publish never` | Exit 0; local unpacked only, no installation/publication or portable/NSIS rebuild                                                                           |
| `npm.cmd run package:verify -- --mode=dir`                                                                  | Exit 0; ASAR 12687281 bytes, no forbidden data/test items. Previously present portable/NSIS files listed by audit are not this run's artifacts              |

Tests cover real missing/junction/wrong-type roots, unsafe paths, duplicate/excess lists and active retention, main scan races/stale tokens, StrictMode, ordered/error/read-only/degraded tabs, close/stop/switch/unmount late results, initial suppression, resumed recording after stop, no body-triggered checkpoint, and metadata failure/retry. Existing safe-read/find/search/compatibility/save/close regressions all pass.

Real E2E manually opens mixed TXT/DOCX, same names at different paths and empty files, closes/restarts normally, then reads external disk changes. It exercises missing-file retry, dirty-close cancellation/discard and all three modes across restarts. Protected DOCX remains uneditable; degraded confirmation made before restart is required again after restart; file bytes stay unchanged. Missing-root UI provides retry/normal-open entry points, and retry succeeds once the synthetic root is recreated.

A real DOCX batch closed during restoration leaves state.json byte-for-byte unchanged. Explicit Stop in a second run permits the in-flight read to finish and saves only retained order/activity. No read mock or cancellation IPC. The inspected 900×600 stopped-state screenshot is `.local-data/test/task-013/wp3/stopped-900x600.png`: text, controls and DOCX are readable, with paths masked only in evidence. WP2's 900×600/1280×820 cases remain in the 11 E2E tests.

Failures retained: early TypeScript union narrowing/Map tuple inference fixes; the first complete regression had 126 failures because old App fixtures interacted before preferences loaded. They now explicitly receive loaded blank-mode preferences, preserving assertions and product gating. Initial E2E selected the wrong same-name file, counted hidden search-panel role=tab nodes, or ambiguously selected Settings versus read-error Retry. Full paths and scoped dialogs fixed the fixtures. Actions use the existing 10-second wait budget and cases remain 30 seconds, with no timeout increase. Filtered `-t` skips do not count as final 11/11.

Logs are `.local-data/wp3-*.log`; data/screenshots/packages remain ignored and uncommitted. No new `.skip`, dependency or security downgrade.

### 10.4 WP4 handoff

- Continue from useStartupRestore.prepareClose/record gating, App dirty/saving coordination and WP2 waitForPendingPreferences(). Complete final layout/checkpoint, renderer-request-to-main-flush draining and retry/continue-exit feedback for all failures. Existing accepted-queue feedback is not complete closing integration.
- Wire AppStateStore.updateWindow, live sidebar and display work-area correction. WP3 neither applies nor records live window/sidebar layout.
- Projection naturally observes committed path models; WP4 still owns systematic persisted rename/move/Save As/delete/partial-failure and final-close integration. Reuse existing transitions and the single main mode policy.
- Future layout/close checkpoints must preserve complete old lastWorkspace during incomplete restore. Only completion or explicit Stop may adopt the visible replacement.
- No unresolved core WP3 prerequisite. Final product portable/NSIS restart/upgrade/uninstall, OS-level high contrast/scaling and Windows 10 hardware remain for WP5/later environment acceptance. Task 13 remains in progress.
