# TASK-004 completion report

[简体中文](./TASK_004_COMPLETION_REPORT.md) | English

[Task archives](../README.en.md) · [Documentation center](../../README.en.md)

> Implementation completed: 2026-08-05; verification platform: Windows 11, Node.js 22.15.0, npm 10.9.2, Electron 37.x.
> The development Agent completed automated acceptance (typecheck/lint/format:check/all tests/check/build) and development/production desktop smoke checks.
> Detailed manual UI acceptance follows TASK-004 Section 8.7; the portions suitable for automation were smoke-verified by the Agent.

## 1. Implementation summary

Implementation followed WP0 baseline → WP1 contracts/read metadata → WP2 safe saver → WP3 save IPC/preload → WP4 CodeMirror/save state → WP5 conflicts/unsaved protection/window coordination → WP6 acceptance/documentation. The complete editing workflow “select TXT → controlled reading → CodeMirror editing → explicit save → revision conflict detection → safe same-directory temporary replacement” is implemented:

```text
Select ordinary workspace UTF-8 TXT from the file tree
  -> document:read-text returns text, BOM/endings, and SHA-256 revision
  -> CodeMirror 6 single-document editing (plain text, undo/redo, Mod-s)
  -> Modified state and Ctrl+S / Save button
  -> Fixed document:save-text IPC (runtime shape and dangerous-field checks)
  -> Main revalidates path, links, real paths, size, and disk revision
  -> Same-directory exclusive temporary write, flush, close, rename replacement
  -> Return snapshot/revision; clear unsaved state only for the version saved
  -> Conflict notice, unsaved protection, close confirmation (Discard/Cancel)
```

## 2. Key new and modified files

### New files

| File                                                | Purpose                                                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/main/document/save-text-document.ts`           | Safe TXT saver: 12-step protocol, endings/BOM serialization, testable adapter injection         |
| `src/main/window/window-close.ts`                   | Main-process close coordination: minimal dirty state, close-requested query, allow/cancel reset |
| `src/renderer/components/document/TextEditor.tsx`   | CodeMirror 6 wrapper: create/destroy/recreate on document switch/Mod-s                          |
| `src/renderer/components/common/ConfirmDialog.tsx`  | In-app Discard Changes / Cancel confirmation                                                    |
| `tests/document/save-text-document.test.ts`         | 51 saver cases: real integration + injected failures                                            |
| `tests/document/document-ipc.test.ts`               | 21 save IPC cases: shape/dangerous fields/integration/fallback                                  |
| `tests/window/window-close.test.ts`                 | 8 close-coordination cases                                                                      |
| `docs/tasks/task-004/TASK_004_COMPLETION_REPORT.md` | This report                                                                                     |

### Modified files

| File                                                                             | Change                                                                                                |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `.gitattributes` / `.prettierrc.json` / `vitest.config.ts`                       | WP0: pinned text LF/.cmd CRLF, endOfLine=lf, Vitest node environment + controlled fork pool           |
| `tests/{document,workspace}/components.test.tsx`                                 | jsdom directives; edit/save/confirmation cases                                                        |
| `src/shared/document.ts`                                                         | Snapshot metadata (revision/hasUtf8Bom/lineEnding), save request/result/12 stable errors              |
| `src/main/document/read-text-document.ts`                                        | Original-byte SHA-256, byte-level BOM/endings detection; pure helpers exported for saver              |
| `src/main/document/document-ipc.ts`                                              | `document:save-text`: one argument, key allowlist, runtime types/ranges, unexpected fallback          |
| `src/shared/desktop-api.ts` / `src/preload/index.ts`                             | `document.saveText` and fixed/frozen `window` coordination namespace                                  |
| `src/main/index.ts`                                                              | Attached close protection and registered window IPC                                                   |
| `src/renderer/lib/use-text-document.ts`                                          | 8-state model: clean/dirty/saving/save-error/conflict + edit counter + save races + reload            |
| `src/renderer/App.tsx`                                                           | Unified four discard transitions/mixed-ending confirmation, dirty reporting, close-query subscription |
| `src/renderer/components/{document/DocumentPane,workspace/WorkspaceSidebar}.tsx` | Save toolbar/dirty marker/conflict reload; folder-open guard                                          |
| `src/renderer/styles/app.css`                                                    | Editor/toolbar/confirmation/conflict-banner styles                                                    |
| `package.json` / `package-lock.json`                                             | Added @codemirror/state, view, commands                                                               |
| `README.md` / `docs/development/TESTING.md`                                      | Synced capabilities/acceptance (Section 9)                                                            |
| `docs/tasks/task-004/TASK_004_TXT_EDIT_SAFE_SAVE.md`                             | Completed status; all 11.1–11.4 items checked                                                         |

## 3. Revision tokens, BOM, and line-ending rules

- **revision**: main hashes the **complete original bytes**, including BOM/endings, with SHA-256 into 64 lowercase hexadecimal characters. Saves return `expectedRevision`; mismatched disk hash yields `CONFLICT` before temporary creation. This is a conflict token, not authorization.
- **BOM**: saving preserves the BOM policy detected in disk bytes during revision checking (`EF BB BF`), without silent removal on editor entry.
- **Consistent LF / CRLF**: body endings retain the original disk style and are encoded as-is without implicit conversion.
- **Mixed endings**: without confirmation, return `MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED` and write nothing. The UI shows Confirm Line Ending Normalization; confirmation retries with `confirmMixedLineEndingNormalization: true`, using the dominant rule: the majority of CR-family `\r\n` + standalone `\r` versus LF-family `\n` wins; **ties choose CRLF**.
- **Size limit**: encoded bytes ≤5 MiB, checked using actual `TextEncoder` bytes rather than string length; larger results are rejected before temporary creation.

## 4. Temporary-file and target-replacement protocol

Fixed order in `save-text-document.ts`:

1. Capture the session root at save start.
2. Relative-path format (`/` separators, no empty segments/`.`/`..`/backslashes/`\0`/`:`) → `.txt` → lexical boundary.
3. Per-segment `lstat`: reject links/junctions, require intermediate directories and an ordinary target.
4. Recheck containment within the real root after `realpath`.
5. Bounded disk read + SHA-256 comparison with `expectedRevision`; conflict has zero side effects.
6. Encoding/endings and size checks.
7. Exclusive `open(...,'wx')` for same-directory `.wenshu-<randomUUID()>.tmp`.
8. `writeAllBytes` loops over short writes → `sync` → `close`.
9. Same-filesystem `rename(tempPath, targetPath)` replacement. On Windows, libuv `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` provides overwrite-replacement semantics, verified by real integration tests.
10. Return snapshot/revision from actual saved bytes. Any failure yields stable errors and best-effort `removeTemp`; cleanup failure logs only a code, without paths/text/temporary names.

**Windows replacement evidence**: all successful root/nested/5-MiB/Chinese/BOM/CRLF cases in `save-text-document.test.ts` use real `fs.rename` replacement. The EPERM replacement-failure case asserts the original is neither deleted nor truncated and no overwrite fallback occurs. There are no code paths for prohibited delete-then-rename, target truncation, or cross-drive moves from the system temporary directory.

## 5. Electron / IPC security boundaries

- `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true` are unchanged in `src/main/index.ts`.
- Preload adds only `document.saveText(request)` (fixed `document:save-text`) and `window.setDirtyState/requestClose/cancelClose/onCloseRequested` (fixed channels/shapes). No exposed `ipcRenderer`, general `invoke/send/on`, dynamic channels, or arbitrary filesystem operations; namespaces remain frozen.
- Runtime `document:save-text` checks require exactly 1 argument, a plain object, a **key allowlist** rejecting workspaceRoot/absolutePath/tempPath/encoding/strategy/channel/filePath/flags and similar dangerous fields, required field types, and `true` only for `confirm`; unexpected failures become stable `WRITE_FAILED`.
- The saver accepts no root/absolute target/temporary name/encoding/write strategy. Errors/logs contain no text, absolute system paths, temporary names, or stacks, with assertion tests.
- Window coordination keeps only whether the window has unsaved text. Renderer authorizes closing from the **latest** live dirty state rather than stale fire-and-forget notifications. `pendingRequest` prevents recursion, `close-cancelled` resets state, and destruction cleans up.

## 6. New dependencies and reasons

| Dependency             | Version | Reason                                                                                                                                                                                                                              |
| ---------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@codemirror/state`    | ^6.7.1  | CodeMirror 6 state layer; baseline 8.3 specifies CM6                                                                                                                                                                                |
| `@codemirror/view`     | ^6.43.8 | Editor view layer                                                                                                                                                                                                                   |
| `@codemirror/commands` | ^6.10.4 | `defaultKeymap`, `history()`/`historyKeymap`, `undo`/`redo`; CM6 history actually resides here. `@codemirror/history` is the old 0.19 line with state 0.19.x, incompatible with 6.x instanceof checks, and was ruled out by testing |

Neither the `codemirror` meta-package nor basicSetup was introduced, because they include highlighting/line numbers and other explicitly excluded extensions. Only plain editing, native selection, undo/redo, and Mod-s are configured.

## 7. Automated checks actually executed and results

| Command                     | Result                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `typecheck` (5 tsconfig)    | **Passed**                                                                                                       |
| `lint` (--max-warnings=0)   | **Passed**, 0 warnings                                                                                           |
| `format:check`              | **Passed** in Windows checkout with pinned endings                                                               |
| `test` (9 files, 226 cases) | **Passed**: 224 passed / 2 skipped; actual symlinks conditionally skipped, deterministic mock rejection retained |
| `check`                     | **Passed**, exit 0                                                                                               |
| `build`                     | **Passed**, exit 0: main 24.23 kB, preload 1.95 kB, renderer 1,153.24 kB + CSS 10.83 kB                          |

Distribution: runtime 2 · scanner 11 · reader 49 · saver 51 · read/save IPC 33 · preload contracts 13 · workspace components 21 · document components 38 · window close 8 · endings/worker baseline verified in WP0.

## 8. Desktop smoke evidence

| Item                                          | Result                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Development startup (`.\scripts\dev.cmd`)     | **Passed**: dev server + Electron, alive 30s (4 processes), no log errors                                             |
| Production startup (`npm exec -- electron .`) | **Passed**: loaded `out/`, alive 25s (4 processes), no error output                                                   |
| Open/edit/save/conflict workflow              | **Passed** through component tests; detailed manual checklist is TASK-004 Section 8.7, performed by the project owner |
| No `.wenshu-*` leftovers after save           | Asserted for success and every failure branch                                                                         |

## 9. Documentation synchronization

- `README.md`: updated capabilities to single-TXT editing, explicit saving, conflict detection, and safe writes; checked Task 4 in Roadmap; removed delivered items from Not Yet Implemented.
- `docs/development/TESTING.md`: current acceptance updated to editing/saving/conflicts/unsaved protection while retaining pre-Task-4 baseline gate records.
- `docs/tasks/task-004/TASK_004_TXT_EDIT_SAFE_SAVE.md`: `Completed`, all 11.1–11.4 checked.

## 10. Known limitations

1. **TOCTOU**: revision validation detects conflicts at save time and does not promise defense against every OS race from malicious local processes, within task scope.
2. **Conditional real symlinks**: no local link-creation privileges; 2 cases skipped with `it.runIf`, with deterministic lstat mock rejection.
3. **One document/tab**: no tab array, autosave, or force-overwrite entry point, as scoped.
4. **Mixed endings**: confirmed dominant normalization, ties CRLF, is the chosen rule. Discard/Cancel has no Save and Continue shortcut; save first, then repeat the operation.
5. **Mocked window coordination**: real Electron close events are smoke-verified; automated end-to-end coverage belongs to later E2E facilities.
6. **Tree highlight during saving**: when reading fails and the old document is retained, selection returns to the last successful document, consistent with Task 3.

## 11. Acceptance review

All TASK-004 Section 11 criteria—11.1 (14 functional), 11.2 (12 data-safety), 11.3 (7 Electron-boundary), and 11.4 (14 quality)—are met and checked. Automated items passed by actual commands; the Agent verified development/production smoke checks; the owner performed all Section 8.7 manual items and all passed.

## 12. Task status and next entry point

**TASK-004 status: Completed.**

The next planned task is [TASK-005: Multiple TXT tabs and independent editing sessions](../task-005/TASK_005_MULTI_TXT_TABS.en.md), reusing verified revisions, dirty/save races, and Discard/Cancel semantics. It focuses on uniqueness, switching/closing, per-tab editor state, save concurrency, confirmation-target binding, and aggregate workspace/window protection without simultaneously adding DOCX or workspace full-text search.
