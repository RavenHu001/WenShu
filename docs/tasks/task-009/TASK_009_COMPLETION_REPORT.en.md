# TASK-009 Completion Report: Basic File Management

[简体中文](./TASK_009_COMPLETION_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Implemented on 2026-08-16 (WP0–WP8). Verification platform: Windows 11 (zh-CN, build 10.0.26200), Node.js 22.15.0, npm 10.9.2, Electron 37.10.3, TypeScript 5.9.3, Vitest 3.2.7.
> WP0–WP7 were implemented/accepted individually; WP8 covered final acceptance, documentation, and reporting. The development Agent performed automated acceptance (typecheck/lint/format:check/all tests/check/build), development/production smoke, Recycle Bin restoration, external locking, and Windows filesystem measurements.
> The owner passed the task section 9 manual UI checklist and WP7 functional testing, confirming “手动功能测试已通过” (manual functional testing passed). WP7 fixed missing extension preservation/completion during rename/create.

## 1. Implementation summary

Completed packages in order: WP0 baseline/Windows/fixed semantics → WP1 stable tabId/pure path migration → WP2 contracts/name/source-target safety → WP3 create/reveal/fixed IPC → WP4 TXT/DOCX Save As/revision confirmation → WP5 rename/move/companion backup/trash → WP6 controller/tree/dialog UI → WP7 lifecycle/search invalidation/Windows smoke/risk resolution → WP8 acceptance/docs/report. The read-only tree became a complete basic workspace file-management workflow:

```text
Workspace tree (TXT/DOCX/folders/regular files/directories)
  -> Fixed narrow IPC (create-entry / relocate / trash / reveal / save-text-as / save-docx-as)
  -> Main-process source/target segment checks (no symlink/junction following, realpath boundary, authoritative casing)
  -> Per-window serialized writes + pre-publication recheck (exclusive creation, absent target, unchanged source type)
  -> Create TXT/DOCX/folder; two-phase Save As overwrite (TARGET_EXISTS -> expectedTargetRevision CAS)
  -> Rename/move (Windows case-only two-step intermediate name + rollback; companion DOCX .wenshu.bak moves)
  -> Windows Recycle Bin deletion (shell.trashItem, no permanent-delete fallback)
  -> Successful mutation refreshes workspace/increments mutationEpoch: cancel search, clear results/navigation
  -> Stable tabId migrates tabs in place (exact file / directory segment-prefix), preserving editor sessions/dirty/saving
```

## 2. Key added and modified files

### Added files

| File                                                          | Purpose                                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/shared/file-management.ts`                               | Fixed request/result contracts, stable errors/messages, Windows leaf-name validation, pure case-only/same-descendant/internal-name helpers |
| `src/main/workspace/resolve-workspace-entry.ts`               | Source/target resolution: segment lstat/realpath, reject links, root parent `''`, absent targets, pre-publication revalidation             |
| `src/main/workspace/create-workspace-entry.ts`                | Exclusive TXT/DOCX/folder creation, empty-model DOCX export/validation, same-directory exclusive temporary files, no-overwrite publication |
| `src/main/workspace/relocate-workspace-entry.ts`              | Rename/move, case-only intermediate steps/rollback, reject directory self/descendant targets, companion backup/rollback/PARTIAL_FAILURE    |
| `src/main/workspace/trash-workspace-entry.ts`                 | Injectable `shell.trashItem`, nontransactional main/backup PARTIAL_FAILURE                                                                 |
| `src/main/workspace/reveal-workspace-entry.ts`                | Revalidated fixed `showItemInFolder`, no generic shell                                                                                     |
| `src/main/workspace/mutation-coordinator.ts`                  | Serialized per-window writes, at most one active write/window                                                                              |
| `src/main/workspace/file-management-ipc.ts`                   | Fixed `workspace:create-entry` / `relocate` / `trash` / `reveal`, exact shape validation                                                   |
| `src/main/document/save-text-document-as.ts`                  | TXT Save As with BOM/line endings, two-phase overwrite, exclusive create/safe replace                                                      |
| `src/main/docx/save-docx-document-as.ts`                      | DOCX Save As with compatibility, export validation, target rolling backup, two-phase overwrite                                             |
| `src/renderer/lib/use-file-management.ts`                     | mutationId controller, input/target selection/confirmation, success effects/mutationEpoch notification                                     |
| `src/renderer/components/workspace/FileManagementToolbar.tsx` | Create/rename/move/delete/reveal/Save As toolbar and banners                                                                               |
| `src/renderer/components/workspace/FileManagementDialogs.tsx` | Name input, directory selection, overwrite/delete/partial-failure dialogs                                                                  |
| `tests/file-management/contract.test.ts`                      | 22 contract cases: shapes/stable errors/Windows names/path lexical rules                                                                   |
| `tests/file-management/resolve-workspace-entry.test.ts`       | 13 cases, 1 skip: parent segments/link rejection/case conflicts/realpath boundary                                                          |
| `tests/workspace/create-workspace-entry.test.ts`              | 13 cases: exclusivity/temp pipeline/DOCX validation/parent races/cleanup                                                                   |
| `tests/workspace/relocate-workspace-entry.test.ts`            | 15 cases, 1 skip: case-only/descendant rejection/backup/rollback/partial failure                                                           |
| `tests/workspace/trash-workspace-entry.test.ts`               | 7 cases, 1 skip: adapter/companion backup/dirty-saving results                                                                             |
| `tests/workspace/reveal-workspace-entry.test.ts`              | 5 cases, 1 skip: existence/type/link checks/one shell call                                                                                 |
| `tests/workspace/mutation-coordinator.test.ts`                | 4 serialized-write cases                                                                                                                   |
| `tests/workspace/file-management-ipc.test.ts`                 | 10 cases: shape rejection/roots/NO_WORKSPACE/serialization                                                                                 |
| `tests/document/save-text-document-as.test.ts`                | 10 cases: BOM/line endings/two phases/absent-existing targets/CAS                                                                          |
| `tests/docx/save-docx-document-as.test.ts`                    | 9 cases: compatibility/export validation/backup/overwrite CAS                                                                              |
| `tests/document/save-as-ipc.test.ts`                          | 5 Save As IPC cases                                                                                                                        |
| `tests/document/tab-path-migration.test.ts`                   | 22 pure cases: exact-file/directory-boundary migration/Save As completion/batch close/invariants                                           |
| `tests/document/save-as-controller.test.tsx`                  | 7 saveAsTab cases: migration/continued editing/TARGET_OPEN/two phases/preservation on failure                                              |
| `tests/workspace/relocate-trash-controller.test.tsx`          | Tab migration/closing and saving guards                                                                                                    |
| `tests/workspace/file-management-ui.test.tsx`                 | 22 WP6/WP7 UI cases: selection/expansion/create/rename/delete/extensions/mutationEpoch                                                     |
| `tests/workspace/mutation-epoch-lifecycle.test.tsx`           | 7 WP7 App integrations: success clears search/navigation; failure/cancel/reveal retain; manual refresh                                     |
| `docs/tasks/task-009/TASK_009_WP0_REPORT.md`                  | Baseline, Windows measurements, frozen decisions                                                                                           |
| `docs/tasks/task-009/TASK_009_COMPLETION_REPORT.md`           | This report                                                                                                                                |

### Modified files

| File                                                                                                            | Change                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/renderer/lib/document-tabs.ts`                                                                             | Decouple stable tabId/path; pure migration/batch close/Save As completion; invariants                    |
| `src/renderer/lib/use-documents.ts`                                                                             | Stable-tabId openFile, two-phase saveAsTab, commitRelocateResult/commitTrashResult, invalidateWorkspace  |
| `src/renderer/lib/use-workspace.ts`                                                                             | `mutationEpoch`, `notifyMutationCommitted`; refresh returns whether snapshot replacement succeeded       |
| `src/renderer/lib/use-workspace-search.ts`                                                                      | mutationEpoch commit guards cancel in-flight search/clear old results; triple late-result checks         |
| `src/renderer/App.tsx`                                                                                          | mutationEpoch wiring, manual-refresh success guard, clearing navigation/notices, file-management dialogs |
| `src/renderer/components/workspace/FileTree.tsx` / `FileTreeNode.tsx`                                           | Separate selection, controlled expansion, TXT/DOCX opening; directories/other files selectable only      |
| `src/renderer/components/workspace/WorkspaceSidebar.tsx`                                                        | Toolbar integration, broader refresh callback type                                                       |
| `src/preload/index.ts` / `src/shared/desktop-api.ts`                                                            | Fixed `createText/createDocx/createDirectory/reveal/relocate/trash/saveTextAs/saveDocxAs`                |
| `src/main/index.ts`                                                                                             | Register management/Save As IPC                                                                          |
| `tests/document/document-tabs.test.ts`, `tests/preload/contract.test.ts`, `tests/document/docx-editor.test.tsx` | Adapt existing contract/state tests to stable tabId/new capabilities                                     |

## 3. Fixed scope and explicit exclusions

- Scope: workspace TXT/basic DOCX/folder creation; TXT/DOCX Save As with two-phase overwrite; regular-file/directory rename/move including case-only; Windows Recycle Bin deletion; reveal in File Explorer; safe tab migration with dirty/saving retained; invalidate old search/navigation.
- Exclusions: copy/paste, batch operations, dragging, permanent deletion, cross-workspace/drive actions, filesystem watching/automatic refresh, untitled memory documents, generic Save As dialogs, dangerous `force`/`overwrite`/`skipValidation` switches, arbitrary shell.

## 4. Windows names, paths, links, boundaries, and case-only rules

Measured with real fixtures; see WP0 report sections 5–6 at `docs/tasks/task-009/TASK_009_WP0_REPORT.md`.

- Illegal `< > : " / \ | ? *` and control characters return `INVALID_NAME` through main-process allowlist validation, independent of OS codes.
- Reserved `CON/PRN/AUX/NUL/COM1-9/LPT1-9`, including extension forms, can actually be created through Node `\\?\` semantics; `validateWindowsLeafName` explicitly rejects them.
- Reject trailing dots/spaces to avoid Explorer/Win32 ambiguity and backup-name conflicts.
- Case collisions: exclusive creation determines `TARGET_EXISTS` for create/Save As. Never probe with writeFile, which measurably overwrites.
- Case-only rename uses an unpredictable exclusive same-directory intermediate name, two rename steps, rollback on either failure, and `PARTIAL_FAILURE` if rollback fails. One-step rename worked locally but is not universally guaranteed.
- Resolve target parent segment by segment from root, explicitly allowing root parent `''`; reject symlink/junction, require ordinary directories, then check realpath boundary. Missing leaves use dedicated absent-target resolution.
- A directory cannot move into itself/descendants; use segment-aware `isSameOrDescendantPath`, not unreliable OS EPERM.
- Internal recovery/temp names (`.wenshu.bak`, `.wenshu-*`) cannot be management targets and stay hidden.

## 5. Stable tabId, descendant migration, and editor sessions

- tabId is a stable renderer-session identity from a monotonic counter, not derivable from path. relativePath/name migrate; deduplication remains normalized-path based, with main process authoritative for case.
- File migration matches exactly. Directory migration updates all descendants in one linear pass using segment prefixes: `a/b` → `x` maps `a/b/c.txt` → `x/c.txt`, excluding `a/b2.txt`/`a.txt`; no editor DOM scanning.
- Preserve TXT CodeMirror `EditorState`, selection, scroll, undo, find panel/query; DOCX Tiptap/PM instance, selection, scroll, undo, toolbar binding; tab order/active tab/dirty/saving/editRevision/read-save identity. Assertions exist in `tests/document/tab-path-migration.test.ts` and WP1 regressions.
- A save captured before migration cannot later write back to the old path. Affected saving tabs block relocate/trash on controller and main-process sides. After migration, saving targets only the new path, tested by `completeSave` after `migrateTabPath`.

## 6. Creation and Save As

- TXT creation: valid zero-byte BOM-free UTF-8; exclusive same-directory temporary write → sync → close → recheck absent target → same-filesystem rename publication. Clean up best-effort after failure.
- DOCX creation: correct-version blank model with at least one empty paragraph → export → size/ZIP/OOXML/reimport validation → same temporary pipeline. Failure returns `VERIFICATION_FAILED`, preserving target.
- Folder creation: nonrecursive single-level mkdir; EEXIST → `TARGET_EXISTS`; no implicit parents.
- None of the three overwrites, auto-renames, or adds numeric suffixes; users explicitly resolve conflicts.
- TXT Save As reuses BOM, newline, mixed-newline confirmation, and safe replacement; absent target is exclusively created.
- DOCX Save As reuses revision-bound degraded confirmation, read-only rejection, export/validation. Overwrite first backs up the target's original bytes; backup failure preserves target. New targets need no meaningless backup.
- Two-phase overwrite: existing target first returns `TARGET_EXISTS` plus controlled revision, with zero writes. Confirmed retry must carry `expectedTargetRevision`, compared again before publication; change returns `CONFLICT` and requires new confirmation. Reject `overwrite: true` / `force: true`.
- Successful Save As leaves source unchanged and migrates the same stable tabId to target. Editing during saving remains dirty after migration. Failure retains source path and body/model.
- If another tab has target open, renderer sends no request and reports `TARGET_OPEN`.

## 7. DOCX target/companion backup policy

- Save As overwrite: `<目标>.wenshu.bak` contains pre-replacement target bytes; backup failure preserves target.
- Single-DOCX rename/move: existing `<源>.wenshu.bak` moves to `<目标>.wenshu.bak`. Existing target backup gives pre-operation `TARGET_EXISTS`. Companion failure attempts main-file rollback; success returns `BACKUP_FAILED` with target unchanged; rollback failure returns `PARTIAL_FAILURE`.
- Directory rename/move/delete naturally carries contained backups without separate enumeration/exposure.
- Deleting one DOCX sends main and backup to Recycle Bin nontransactionally. Partial success gives `PARTIAL_FAILURE` and immediate refresh; do not recreate an already-trashed main file to fake rollback.

## 8. Relocate, trash, rollback, and partial failure

- Identical path strings are a safe relocate no-op. Use same-volume atomic rename, never copy then delete. Recheck source type/absent target before publication. Case-only uses two steps plus rollback (section 4).
- Trash exclusively uses injectable `shell.trashItem`, never unlink/rm/rmdir fallback. Reject roots/links/other/internal files. Keep tabs until main-process success; close the file's tab or all directory-descendant tabs afterward.
- Partial failure returns stable error, forces refresh, and retains diagnostic information without absolute paths/body. Renderer shows “操作部分完成” (operation partially completed) and cannot assume source/target state.
- One management write per window through `mutation-coordinator`; Save As and ordinary saving obey target-tab `saveInFlight`.

## 9. Refresh, selection/expansion, and search invalidation (mutationEpoch)

- Successful create/Save As/relocate/trash rescan and increment `mutationEpoch` via `use-workspace.notifyMutationCommitted`. Partial failures with disk changes also increment.
- Epoch changes cancel active search, clear completed/cancelled/error results, navigation targets, and stale notices via controller guards/App effect. Late results validate requestId + workspaceEpoch + mutationEpoch.
- Failure, user cancel, and reveal do not increment; valid results remain, each asserted in App integration tests.
- Successful manual snapshot refresh invalidates search too; failed refresh retains snapshot/results.
- Selection migrates to new path on success and clears after deletion; expanded-directory sets migrate by segment boundary. Never replace old-result path strings because content/revision/ranges may also change.

## 10. Electron / IPC / preload security boundaries

- Preserve `nodeIntegration: false`, `contextIsolation: true`, sandbox. preload exposes only fixed methods: workspace 8 + document 6 + search 2 + window-close coordination; no ipcRenderer/generic invoke/arbitrary channels.
- Exact request shapes reject extra fields/wrong types/unknown discriminators as `INVALID_REQUEST`. Renderer cannot submit roots, absolute paths, drives, UNC, temporary/backup paths, shell arguments, or `force`/`overwrite`/`skipValidation`. Roots come only from `workspace-session`; handlers bind to sender window.
- All main-process writes use segment lstat/realpath, reject links/junctions, check boundaries, use same-directory exclusive `wx` temporaries with sync/close, revalidate before publication, and publish without overwrite. Clean up best-effort after failure.
- Deletion uses no permanent-delete API; `rm(tempPath, { force: true })` is temporary-file cleanup only.
- Cross-process results contain stable code/message/normalized relative paths. Logs reveal no body/model/absolute paths/temp names/raw exceptions/stacks; contracts assert serialized JSON.
- All 17 IPC handles are fixed: workspace 6 (open/refresh/create-entry/relocate/trash/reveal), document 4 (read-text/save-text/read-docx/save-docx), Save As 2, search 2, window 3.

## 11. Automated checks and final baseline

| Command                        | Result                                          |
| ------------------------------ | ----------------------------------------------- |
| `typecheck` (5 tsconfig files) | **Passed** each package                         |
| `lint` (--max-warnings=0)      | **Passed**, 0 warnings                          |
| `format:check`                 | **Passed**, fixed Windows checkout line endings |
| `test` (54 files, 1026 cases)  | **Passed**: 1016 passed / 10 skipped            |
| `check`                        | **Passed**, exit 0                              |
| `build`                        | **Passed**, exit 0                              |

- All 10 skips are real-symlink/junction permission conditions using `it.runIf` in restricted Windows: read-text-document 2, read-docx-document 2, search-text-workspace 1, search-mixed-workspace 1, resolve-workspace-entry 1, relocate-workspace-entry 1, trash-workspace-entry 1, reveal-workspace-entry 1. Mock adapters deterministically cover rejection.
- All Task 1–8 tests ran unchanged and passed; no `only`, unconditional `skip`, or weakened assertions.
- Only expected stderr: saver/create cleanup-failure injection logs `wenshu: 清理临时文件失败 (EACCES/EPERM)`.
- WP7 fixed missing extension preservation/completion during rename/create. Section 4.3 requires case-insensitive TXT `.txt` / DOCX `.docx`; renderer completes the required extension before submission, rejects cross-type rename as `TYPE_CHANGE_NOT_ALLOWED`, and does not force extensions for other files/directories. Commit `1586ec6`.

## 12. Windows development/production smoke and measured evidence

| Verification                         | Result                                                                                                                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development, `scripts\dev.cmd`       | 4 Electron processes alive ≥26s; title “文枢”; no error/Uncaught/failed logs; 0 remaining after cleanup                                                                                                                                                               |
| Production, `npm exec -- electron .` | 4 processes alive ≥26s; title “文枢”; no errors; 0 remaining after cleanup                                                                                                                                                                                            |
| Recycle Bin restore, WP8             | Temporary file sent with `SendToRecycleBin`, restored through Shell `R&estore`, content intact. App deletion uses injectable `shell.trashItem`; WP0 measured success for regular file/nonempty/empty directory/read-only attribute, stable rejection for missing path |
| External locking, WP8                | `FileShare.None` exclusive handle blocks another process's write with “文件正由另一进程使用” (file in use). Saver maps EACCES/EPERM to stable `ACCESS_DENIED`/`WRITE_FAILED`, deterministically adapter-tested, without fallback/overwrite                            |
| Case-only rename, WP0                | One-step `fs.rename` worked locally and preserved content; frozen two-step intermediate + rollback, with failures/rollback failure → `PARTIAL_FAILURE` automated                                                                                                      |
| Temporary residue                    | No `.wenshu-*` residue in repository/fixtures; backups follow target or companion-source `.wenshu.bak` rules                                                                                                                                                          |
| Search invalidation, WP7 + App tests | Completed search + successful delete/create → cleared to idle; failure/cancel/reveal → retained; mutation while searching cancels in-flight request                                                                                                                   |
| Electron exposure review             | 17 fixed channels correspond to preload methods; no generic invoke/ipcRenderer leakage/absolute-path request fields                                                                                                                                                   |

- WP0 also verified real fixtures for illegal/reserved names, trailing dots/spaces, case-collision overwrite, parent segments, nonempty-directory rename, descendant rejection, and blank DOCX export validation; see `TASK_009_WP0_REPORT.md`.

## 13. Performance observations (one-off, not benchmark gates)

| Scenario                          | Result                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------- |
| Create/rename/delete-confirm UI   | Immediate interaction, millisecond IPC round-trips, no serialized-write backlog |
| Refresh after successful mutation | Matches existing scanning, <10ms order for small workspaces, no added overhead  |
| Full tests                        | 54 files in approximately 23–24s, same order as Task 8                          |
| Production build                  | Approximately 2s, renderer 2,173 kB                                             |

## 14. Known limitations

1. The controlled environment has no interactive GUI. Manual-click scenarios (real create/Save As/Recycle Bin restore/Word locks/Explorer popup) use App integrations, filesystem measurements, and startup smoke. The owner executed and passed task section 9, confirming manual functional tests passed.
2. Restore/locking evidence comes from Windows Shell/filesystem measurements. App deletion uses `shell.trashItem`, with deterministic injected-failure coverage.
3. One-step case-only rename worked locally without universal guarantee; use two steps/rollback. If both operation and rollback fail, return `PARTIAL_FAILURE`, force refresh, and never guess paths.
4. No filesystem watching; external changes require manual refresh, whose success invalidates search.
5. Rename/move/delete stay within current workspace, without cross-workspace/drive or batch actions.

## 15. Satisfaction of all Task 9 criteria

- All 40 criteria in task sections 11.1–11.5 were individually checked `[x]`, each backed by automation, WP0 measurements, or manual/Shell evidence here; none were guessed.
- `check` and `build` passed sequentially with exit 0; development/production Windows smoke passed; no unresolved data-loss, out-of-bound write, or permanent-delete issues.
- Task status is Completed, with README / PROJECT_BASELINE / TESTING / project structure synchronized.

**Conclusion: All Task 9 acceptance criteria are satisfied.**
