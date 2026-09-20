# TASK-013 Completion Report: Basic Settings and Startup Restore

[简体中文](./TASK_013_COMPLETION_REPORT.md) | English

[Task plan](./TASK_013_SETTINGS_STARTUP_RESTORE.en.md) · [Task archive](../README.en.md)

> **Status: in progress.** Only WP0 (baseline and startup verification) was executed on 2026-09-20. Work stops after this handoff; WP1–WP5 have not been implemented.
> The settings UI, production data-directory entry, JSON store, and restoration are not delivered. Task 12's internal-binary/public-source release boundary is unchanged.

## 1. Baseline and scope

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

### WP1 DTO basis (not implemented)

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

Work stops here; WP1 does not start automatically.

## 7. References checked

- Pinned `node_modules/electron/electron.d.ts`: `setPath`, `setAppLogsPath`, `relaunch`, `requestSingleInstanceLock`, `Session.getStoragePath`; compared with [Electron app API](https://www.electronjs.org/docs/latest/api/app#appsetpathname-path): directories must exist and sessionData is overridden before ready.
- Pinned `node_modules/app-builder-lib/templates/nsis/portable.nsi`: `$EXEDIR` environment variable, `ExecWait`, extraction cleanup; compared with [builder portable documentation](https://www.electron.build/docs/nsis/#portable).
- Pinned `uninstaller.nsh`: `RMDir /r $INSTDIR` and separate AppData deletion branch; compared with [NSIS configuration](https://www.electron.build/docs/nsis/#deleteappdataonuninstall). `deleteAppDataOnUninstall:false` does not protect data inside the installation directory.
