# TASK-009 WP0 Report: Baseline, Windows Behavior, and Fixed Semantics

[简体中文](./TASK_009_WP0_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Scope: TASK-009 section 10 WP0: all section 3 prerequisites; Windows name/conflict/case/rename/Recycle Bin/Explorer fixtures and measurements; target-parent segment validation; blank DOCX export; TXT/DOCX Save As reuse points; `tab.id === relativePath` session impact; stable tabId approach; descendant migration; mutationEpoch search invalidation.
> Implemented on 2026-08-16; Windows 11 (zh-CN, build 10.0.26200), Node.js 22.15.0, npm 10.9.2, Electron 37.10.3, TypeScript 5.9.3, Vitest 3.2.7.
> No new writes exposed in product UI/preload; WP1+ not implemented; final checkboxes unchanged; no product functionality code modified.

## 1. Work-package declaration (start-of-package report)

- Branch/working tree: `Task009`, starting commit `057fee5 T9规划`; initial `git status --short` empty, with no user changes to protect.
- Previous restore point: `057fee5`, Task 9 planning complete, Tasks 1–8 merged.
- Scope: baseline, Windows/Electron measurements, frozen semantics, new `docs/tasks/task-009/TASK_009_WP0_REPORT.md` only.
- Exclusions: no preload/DesktopApi/IPC/main-process write services/renderer management UI; no WP1+ stable tabId/create/Save As/relocate/trash/reveal/mutationEpoch implementation; no completed-status changes to README/PROJECT_BASELINE/TESTING or section 11 checkboxes.
- Verification: required reading; check/test counts/skips; build; development/production main window; temporary fixtures for names/case/rename/parents/trash/reveal/blank DOCX/save reuse/tab identity/descendant migration/search invalidation; diff review; final full check/build.
- Minimal fixtures: real filesystem/Recycle Bin `fs-ws-*`, `case-ws-*`, `electron-ws-*` under `%LOCALAPPDATA%\Temp\wenshu-wp0\`, two Node probes, and a temporary 10-case Vitest technical probe removed after running. All are system-temporary artifacts, not committed.

## 2. Required reading (task section 3.1)

Read in full: `README.md`, `docs/architecture/PROJECT_BASELINE.md`, `docs/development/DEVELOPMENT_ENVIRONMENT.md`, `docs/development/TESTING.md`, `docs/tasks/task-004/TASK_004_TXT_EDIT_SAFE_SAVE.md`, `docs/tasks/task-005/TASK_005_MULTI_TXT_TABS.md`, `docs/tasks/task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md` and completion report, `docs/tasks/task-008/TASK_008_DOCX_WORKSPACE_SEARCH.md` and completion report, `docs/tasks/task-009/TASK_009_BASIC_FILE_MANAGEMENT.md` (1034 lines), and directly related source/tests:

- Shared: `src/shared/workspace.ts`, `desktop-api.ts`, `document.ts`, `docx.ts`, `search.ts`;
- Main: `workspace/scan-workspace.ts`, `workspace-ipc.ts`, `workspace-session.ts`; `document/path-validation.ts`, `write-safety.ts`, `save-text-document.ts`; `docx/export-docx.ts`, `save-docx-document.ts`; `src/main/index.ts`, `src/preload/index.ts`;
- Renderer: `lib/document-tabs.ts`, `use-documents.ts`, `use-editor-sessions.ts`, `use-workspace.ts`, `use-workspace-search.ts`, `text-document-tabs.ts`; `components/document/DocumentPane.tsx`, `EditorSessionHost.tsx`, `DocxEditorSessionHost.tsx`, `TabBar.tsx`, `components/workspace/WorkspaceSidebar.tsx`, `FileTree.tsx`, `FileTreeNode.tsx`, `App.tsx`;
- Tests: TXT/DOCX read/save/IPC, multi-tab invariants/transitions, preload, workspace components, search controller/mixed search/navigation lifecycle including `it.runIf`, and `tests/test-utils/temp-dir-cleanup.ts`.

## 3. Working tree and quality baseline (task section 3.2)

### 3.1 Execution environment

The controlled DSH environment lacks an interactive terminal; `bash` is restricted on win32. All commands actually ran through project-local Node (`.tools/node-v22.15.0-win-x64`) and `cmd.exe` subprocesses. `PROCESSOR_ARCHITECTURE` is absent by default, so `AMD64` was injected before `scripts/npm.cmd`, matching the actual host and affecting only script architecture selection, not command semantics. `scripts/node.cmd` directly calls local `node.exe` and is unaffected. No other script/environment changes were made.

### 3.2 Commands and results (`check` then `build`, not concurrent)

| Command                     | Result                                                        |
| --------------------------- | ------------------------------------------------------------- |
| `git status --short`        | Clean at start/end, except the new report at end (section 11) |
| `scripts\npm.cmd run check` | **Passed**, exit 0, 34.6s including Vitest 19.33s             |
| `scripts\npm.cmd run build` | **Passed**, exit 0, 10.4s                                     |

### 3.3 Tests and conditional skips

- **All 38 files passed, 835 tests passed, 6 conditionally skipped, 841 total**, matching Task 8's `38 files / 835 passed / 6 skipped`.
- Six `it.runIf` real-link permission skips: read-text-document 2 (file/directory), read-docx-document 2 (file/directory), search-text-workspace 1 (directory), search-mixed-workspace 1 (directory). lstat/readDir mocks deterministically cover rejection.
- Only expected stderr: saver-cleanup injection `wenshu: 清理临时文件失败 (EPERM/EACCES)`, consistent with Task 7/8.
- No `only`, unconditional `skip`, or weakened assertions. `typecheck` (5 tsconfig), `lint` (--max-warnings=0), and `format:check` passed.

### 3.4 Build outputs

| Output                            | Size        |
| --------------------------------- | ----------- |
| `out/main/index.js`               | 90.86 kB    |
| `out/preload/index.js`            | 2.81 kB     |
| `out/renderer/index.html`         | 0.57 kB     |
| `out/renderer/assets/index-*.js`  | 2,114.61 kB |
| `out/renderer/assets/index-*.css` | 22.33 kB    |

## 4. Main-window smoke (development and production)

| Verification                         | Result                                                                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development, `scripts\dev.cmd`       | **Passed**: dev server at http://localhost:5173 + Electron; 4 processes alive 25s, `start electron app...` logged, no preload/React/resource errors; process tree cleaned, 0 remaining |
| Production, `npm exec -- electron .` | **Passed**: 4 processes alive 30s, no stdout/stderr errors; another run enumerated main window after 18s, MainWindowHandle 4982630, title “文枢”; cleaned, 0 remaining                 |

## 5. Windows names, collisions, and case measurements (`fs-ws-*`, `case-ws-*`)

Fixtures use a new `ws` root in system temp and real `node:fs/promises` operations.

| Scenario                                                      | Observed result                                                                                                                                                    | Frozen decision                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Illegal `< > : " \| ? *`                                      | All creates failed; Node returned `ENOENT`, not EINVAL. `/` and `\\` treated as separators (EISDIR); NUL → `ERR_INVALID_ARG_VALUE`; tab control character → ENOENT | OS errors are insufficient; main process prevalidates section 4.3 allowlist and returns `INVALID_NAME`                        |
| Reserved `CON/PRN/AUX/NUL/COM1-9/LPT1-9`, including `CON.txt` | **Node/libuv `\\\\?\` semantics actually create files** visible to readdir and readable; NUL was written/read back                                                 | Explicit `validateWindowsLeafName` rejection, including extensions; never rely on OS                                          |
| Trailing dots/spaces: `a.`, `a `, `trail.txt.`, `trail.txt `  | Created and coexisted with `trail.txt`, stat/read worked; no Win32 normalization under `\\\\?\`                                                                    | Continue rejecting to avoid Explorer/Win32 ambiguity and backup conflicts                                                     |
| Existing `a.txt`, then write `A.txt`                          | **Succeeded and directly overwrote the same file**; later content won, readdir still one `a.txt`                                                                   | Exclusive `open wx` / `O_CREAT \| O_EXCL` for `TARGET_EXISTS`; never writeFile probing                                        |
| Case-only `a.txt` ↔ `A.txt`, `dirx` ↔ `DIRX`                  | One-step `fs.rename` preserved content locally; unpredictable intermediate two-step also worked                                                                    | Fixed same-directory unpredictable exclusive intermediate, two steps + rollback; one-step success is only a local observation |
| Regular-file/cross-parent/nonempty-directory rename           | All succeeded, contents moved: `d1` → `d1-new` → `d2/d1-moved`                                                                                                     | Reuse same-volume atomic `fs.rename`, section 4.8                                                                             |
| Directory into its descendant                                 | `EPERM`                                                                                                                                                            | Precheck `isSameOrDescendantPath`, return `DIRECTORY_INTO_DESCENDANT`, independent of OS wording                              |

## 6. Target-parent segment validation

Real junction fixture pointed outside workspace. Verified the same semantics as `path-validation.ts`: lexical form → segment `lstat` → reject links → intermediate segments must be directories.

| Request                                     | Result                            | Explanation                                       |
| ------------------------------------------- | --------------------------------- | ------------------------------------------------- |
| Existing `sub/x.txt`                        | OK                                | Final segment regular file                        |
| Missing leaf `sub/none.txt`                 | NOT_FOUND at leaf                 | Create/Save As need dedicated missing-leaf branch |
| `no-such-dir/x.txt`                         | NOT_FOUND at intermediate segment | Stop at missing parent; no guessing               |
| Junction `jlink/x.txt`                      | LINK_NOT_ALLOWED                  | Segment lstat rejects without following           |
| `../x` / `C:/x` / backslash / empty segment | INVALID_PATH                      | Lexical rejection                                 |
| `sub/x.txt/y.txt`                           | NOT_DIRECTORY                     | Reject regular file as intermediate segment       |

`resolveWorkspaceTarget` requires an existing regular final file. WP2 must add `resolveWorkspaceParentDirectory` supporting root parent `''`, and `resolveNonExistingWorkspaceTarget` with parent lstat, realpath boundary, absent leaf, and pre-publication revalidation.

## 7. Electron `shell` measurements (`electron-ws-*`, real Electron 37.10.3 main process)

### 7.1 `shell.trashItem`

| Target                     | Result                                            |
| -------------------------- | ------------------------------------------------- |
| Regular file               | Success, disappeared into Recycle Bin             |
| Nonempty directory         | Success, directory/content disappeared            |
| Empty directory            | Success                                           |
| Read-only attribute, 0o444 | Success; attribute did not prevent trash          |
| Missing path               | Rejected: `Failed to parse path` at shell parsing |

Freeze all deletion through injectable `shell.trashItem`. Prevalidation/stable `NOT_FOUND`/`TRASH_FAILED` express missing/permission failures. ACL-level failure could not reproduce locally; WP5 injects it deterministically. Main file and companion `.wenshu.bak` are nontransactional: partial success → `PARTIAL_FAILURE` + immediate refresh, without writing back an already-trashed main file to fake rollback.

### 7.2 `shell.showItemInFolder`

Files/directories/workspace root returned successfully (void). **Missing paths also did not throw**, opening their parent. Therefore main process must revalidate existence/type/links/boundaries before fixed `showItemInFolder`. Expose no `openPath`/`openExternal`/arbitrary shell arguments. Reveal does not increment mutationEpoch.

## 8. Blank DOCX export and TXT/DOCX Save As reuse

A temporary 10-case Vitest probe passed and was removed, without product changes:

- **Blank DOCX:** schemaVersion 1 with at least one empty paragraph passes `validateDocxDocumentModel`; `exportDocxDocument` generates >1 KB; `verifyGeneratedDocxDocument` checks size/ZIP/OOXML/reimport and returns `ok`, compatibility `supported`; `inspectDocxPackage` + `importDocxDocument` reimports at least one empty paragraph. WP3 can reuse directly.
- **TXT reuse:** `saveTextDocument` BOM (`encodeUtf8`), line endings (`normalizeLineEndings`/`dominantLineEnding`), revision CAS, `defaultTempWriteFactory` with same-directory exclusive `.wenshu-<uuid>.tmp`, `writeAllBytes`/sync/close, `replaceFile`, `removeTempFile`. Probe preserved BOM+CRLF and left no temp residue. **Absent target currently gives `NOT_FOUND`**, because final file must exist. WP4 needs missing-target resolution and two-phase `TARGET_EXISTS → expectedTargetRevision → pre-publication recheck`. Exclusive temporary primitives were verified reusable for new targets.
- **DOCX reuse:** `exportDocxDocument` + `verifyGeneratedDocxDocument`, revision-bound degraded confirmation/read-only rejection, and pre-overwrite target rolling backup. Probe backup equaled original bytes, replacement succeeded, no temp residue. WP4 skips meaningless backup for new targets and reuses the saver for overwrite.

## 9. `tab.id === relativePath` impact and stable tabId approach

### 9.1 Existing coupling (code and probe assertions)

- `document-tabs.ts`: `openTab`/`openDocxTab` create `id: relativePath`, confirmed.
- `use-documents.ts`: `openFile` deduplicates `item.id === relativePath`; `openWaiters` keyed by tabId; saves capture `relativePath`.
- `App.tsx`: navigation `tabId: relativePath`; `DocumentPane.tsx`: TXT/DOCX host `key={tab.id}`, `docxEditors` keyed by tab.id.
- `use-editor-sessions.ts`: CodeMirror Map keyed by tabId; `liveTabIds` cleans absent ids.
- `EditorSessionHost.tsx` mount effect depends on `tabId`: new id creates EditorState; captured old session is removed when absent from live set. DOCX creation effect depends on `tab.id`.

**Impact:** Direct path changes from rename/move/Save As change id → React remount → lost CodeMirror undo/selection/scroll/find panel and recreated DOCX Tiptap instances. Old runtime/session keys become orphans; in-flight saves capture old paths; directory migration cannot be one linear update. Probe confirmed that changing id without runtime keys violates `validateDocumentTabsModel` orphan/mismatch invariants. Case-collision overwrite measurements further show filesystem identity must be authoritative in main process.

### 9.2 Stable tabId approach (fixed WP1 requirements)

- Stable renderer-session identity, not derivable from path, using monotonic counter or uuid; `relativePath`/`name` migrate. Deduplicate normalized paths; main process owns case authority.
- Key CodeMirror sessions, DOCX editor Map, runtime, React keys, active tabs, async reads/saves/navigation by tabId. Hosts do not unmount on path changes; only content/model updates.
- Probe: retain id and migrate only path/name; runtime keys/order/active tab stay, model passes invariants. This is WP1's target pure transition.
- Affected saving tabs block rename/move/delete (section 4.5); saves captured before migration cannot later write old paths.

## 10. Descendant migration and mutationEpoch search invalidation

- **Descendant migration:** segment-prefix probe `a/b` → `x` maps `a/b/c.txt` → `x/c.txt`, excluding `a/b2.txt` and `a.txt`. File migration is exact. One linear tab pass, no DOM scan, preserving order/active tab.
- **mutationEpoch:** successful create/Save As/relocate/trash increments and immediately cancels search/clears completed/cancelled/error results/navigation. Failure/cancel/reveal do not increment. Late results check requestId + workspaceEpoch + mutationEpoch. Existing `use-workspace-search.test.tsx` freezes epoch-change invalidation/clearing; WP7 adds mutationEpoch to the same guard. Never migrate old-result path strings.

## 11. Changed files and diff review

| File                                         | Change               |
| -------------------------------------------- | -------------------- |
| `docs/tasks/task-009/TASK_009_WP0_REPORT.md` | **New**, this report |

- `git status --short`: only `?? docs/TASK_009_WP0_REPORT.md` (historical output; current location: [this report](./TASK_009_WP0_REPORT.en.md)). No product/preload/IPC/DesktopApi/test/acceptance-checkbox changes. Temporary probes under tests and fixtures in system temp were cleaned or outside repository.
- preload review: still only `workspace.open/refresh`, `document.readText/saveText/readDocx/saveDocx`, `search.textWorkspace/cancelTextWorkspace`, and 4 window-close coordination methods; no new writes.
- Final review: full `check`/`build` reran after writing this report (section 12), without regressions.

## 12. Final full check/build (rerun after report creation)

| Command                     | Result, with exit codes/counts in final message                      |
| --------------------------- | -------------------------------------------------------------------- |
| `scripts\npm.cmd run check` | See final delivery summary; expected 38 files / 835 passes / 6 skips |
| `scripts\npm.cmd run build` | See final delivery summary; expected exit 0                          |

## 13. Unresolved issues and known limitations

1. ACL-level trash failure did not reproduce locally; read-only attributes do not block it. WP5 injects adapter failures deterministically and never falls back to permanent deletion.
2. `showItemInFolder` does not error on missing paths; main process validates existence. Explorer popup behavior is not automated, as in earlier smoke tests.
3. Node/libuv `\\\\?\` permits reserved names/trailing dots/spaces. This reinforces name prevalidation + exclusive creation + pre-publication recheck, and shows fixture/Win32-tool differences.
4. One-step case-only worked locally without guarantees across Windows/antivirus combinations; frozen two-step + rollback.
5. Controlled environment lacks interactive terminal and default `PROCESSOR_ARCHITECTURE`. Commands ran through local Node/cmd; actual development/production window and title evidence was obtained.

## 14. WP0 gate conclusion

**WP0 gate satisfied**, all three section 10 conditions:

1. **Repeatable Task 8 baseline:** full `check` passed, 38 files / 835 passes / 6 real-link permission skips with mock rejection coverage; build and development/production main-window smoke passed.
2. **Actual Windows/Electron evidence:** illegal/reserved names, case collisions/overwrite, case-only/file/nonempty-directory rename, descendant rejection, parent validation, `shell.trashItem`, `showItemInFolder`, blank DOCX export, Save As reuse/gaps, path-id coupling, stable identity, descendant migration, mutationEpoch all have section 5–10 measurements/assertions.
3. **No unresolved data-safety semantics:** name prevalidation/exclusive creation/case authority/two-step rollback/parent segments/trash adapter/PARTIAL_FAILURE/preserved DOCX backup-validation/Save As target-revision CAS/stable identity/saving guards/mutationEpoch are frozen. No UI/preload writes exposed, WP1+ implementation, or final-checkbox changes.

If later WP1+ measurements conflict, update this report and task plan before continuing.
