# TASK-003 completion report

[简体中文](./TASK_003_COMPLETION_REPORT.md) | English

[Task archives](../README.en.md) · [Documentation center](../../README.en.md)

> Implementation completed: 2026-08-02; final manual acceptance: 2026-08-02; verification platform: Windows, Node.js 22.x, npm 10.9.2. The development Agent completed automated acceptance (check/build/tests). The project owner performed every desktop UI item in Section 8.4 and all passed; the Agent smoke-verified the portions suitable for automation.

## 1. Implementation summary

The full vertical slice “select TXT in tree → controlled IPC reading → central single read-only tab” is implemented through this flow:

```text
Select a TXT relative path in the React file tree
  -> Restricted preload API document.readText(relativePath)
  -> Fixed document:read-text IPC channel
  -> Main retrieves current workspace state (session module)
  -> Validate path, type, symbolic links, size, and UTF-8
  -> Serializable read-only document snapshot
  -> Single tab in the central React area
```

Implementation followed the packages in order: WP0 baseline → WP1 contracts/session/reader → WP2 IPC/preload → WP3 tree selection → WP4 central document area/races → WP5 acceptance/documentation. Each gate passed before the next package began.

## 2. Key new and modified files

### New files

| File                                                        | Purpose                                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/shared/document.ts`                                    | Shared document contract: snapshot, 10 stable error codes, result union, 5 MiB constant   |
| `src/main/workspace/workspace-session.ts`                   | Single main-process workspace session state (get/set root)                                |
| `src/main/document/read-text-document.ts`                   | Asynchronous workspace-bounded UTF-8 TXT reader (13 validation steps + injected adapter)  |
| `src/main/document/document-ipc.ts`                         | Fixed `document:read-text` handler: argument count/type checks, root capture, idempotency |
| `src/renderer/lib/use-text-document.ts`                     | Single-document state hook: welcome/loading/loaded/error + request-number race handling   |
| `src/renderer/components/document/DocumentPane.tsx`         | Four-state central document rendering                                                     |
| `src/renderer/components/document/ReadonlyTextDocument.tsx` | Read-only textarea body view                                                              |
| `tests/document/read-text-document.test.ts`                 | Reader security tests: 34 cases                                                           |
| `tests/document/components.test.tsx`                        | App-level UI/race tests: 14 cases                                                         |
| `tests/preload/contract.test.ts`                            | Narrow preload contract tests: 8 cases                                                    |
| `docs/tasks/task-003/TASK_003_COMPLETION_REPORT.md`         | This report                                                                               |

### Modified files

| File                                                                             | Change                                                                       |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/shared/desktop-api.ts`                                                      | Added `document.readText` to `DesktopApi`                                    |
| `src/shared/workspace.ts`                                                        | Revised `relativePath` contract: one controlled-reading exception            |
| `src/main/index.ts`                                                              | Registered document IPC (+2 lines)                                           |
| `src/main/workspace/workspace-ipc.ts`                                            | Moved root ownership to the session module                                   |
| `src/preload/index.ts`                                                           | Added `document.readText` closure mapping                                    |
| `src/renderer/App.tsx`                                                           | Connected document state, invalidation on workspace switch, and DocumentPane |
| `src/renderer/components/workspace/{FileTree,FileTreeNode,WorkspaceSidebar}.tsx` | TXT buttons, selection, callbacks, and `onWorkspaceSelected` notification    |
| `src/renderer/styles/app.css`                                                    | Selection/document-area styles (+76 lines)                                   |
| `tests/workspace/components.test.tsx`                                            | New props + 8 selection cases                                                |
| `tsconfig.test.json`                                                             | Included `src/main/document`, `src/preload/index.ts`                         |
| `README.md` / `docs/development/TESTING.md`                                      | Updated capabilities and acceptance steps                                    |
| `docs/tasks/task-003/TASK_003_TXT_READONLY.md`                                   | Marked completed and checked all acceptance items                            |

## 3. Data contracts, path validation, and security boundaries

### Cross-process types

```
TextDocumentSnapshot → ReadTextDocumentResult (loaded | error)
TextDocumentErrorCode (10 stable error codes)   MAX_TXT_FILE_BYTES = 5 MiB
```

Every field is readonly/serializable; no Error, Buffer, handles, Stats, functions, or class instances cross the boundary.

### Main-process validation order (read-text-document.ts)

1. Workspace open (nonempty absolute root) → 2. Relative-path format (nonempty, `/` separators, no empty segments/`.`/`..`/`\`/`\0`/`:` drive forms) → 3. Case-insensitive `.txt` → 4. Resolve candidate against root → 5. `path.relative` lexical escape check → 6. Per-segment `lstat` (reject any link/junction; intermediate directories and final ordinary file required) → 7–8. Root/candidate `realpath` and boundary recheck → 9. Pre-read size check (≤5 MiB) → 10–11. Bounded read (at most 5 MiB+1 byte) and actual-length recheck → 12. Fatal `TextDecoder` UTF-8 decoding → 13. Return snapshot with BOM removed.

### Security boundaries retained

| Constraint                                                                     | Status                                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `nodeIntegration: false` / `contextIsolation: true` / `sandbox: true`          | Unchanged                                                                     |
| Only one new preload closure, `document.readText(relativePath)`                | No `ipcRenderer`, general invoke, arbitrary paths, encoding/options arguments |
| IPC checks argument count/type; no root/absolute path/encoding/size options    | Yes                                                                           |
| Renderer imports no Node.js/Electron/file system directly                      | Yes                                                                           |
| Reads use only read-only APIs (`lstat`, `realpath`, bounded `open('r')` reads) | No write/create/rename/delete/permission calls                                |
| Contents are not logged                                                        | Yes                                                                           |
| Results contain no raw exceptions, Buffer, handles, or stacks                  | Yes, asserted in tests                                                        |

## 4. New dependencies and reasons for selection

**None.** No TASK-003 package added production or development dependencies. All use existing React, Vitest, React Testing Library, and TypeScript capabilities.

## 5. Automated checks actually executed and results

| Command                    | Result                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typecheck` (5 tsconfig)   | **Passed**                                                                                                                                        |
| `lint` (--max-warnings=0)  | **Passed**                                                                                                                                        |
| `format:check`             | **Passed**                                                                                                                                        |
| `test` (6 files, 90 tests) | **Passed** — runtime 2 + scanner 11 + reader 34 (2 conditionally skipped) + preload contract 8 + workspace components 21 + document components 14 |
| `check`                    | **Passed**                                                                                                                                        |
| `build`                    | **Passed** — main 11.54 kB, preload 1.00 kB, renderer 572.34 kB                                                                                   |

### Work-package gates

| Package | Gate                                                                           | Result                    |
| ------- | ------------------------------------------------------------------------------ | ------------------------- |
| WP0     | Baseline recorded, unambiguous scope                                           | Passed                    |
| WP1     | Reader tests + check + build; no registered IPC/UI changes                     | Passed (31+2 skipped)     |
| WP2     | Fixed channel only; no general IPC/arbitrary-path API; check + build           | Passed (8 contract tests) |
| WP3     | Tree reports TXT selections only; Task 2 preserved; check + build              | Passed (+8 cases)         |
| WP4     | Section 8.3 component coverage; no editing/multiple tabs/saving; check + build | Passed (+14 cases)        |
| WP5     | All of Section 11 satisfied                                                    | See Section 8             |

## 6. Desktop smoke verification record

| Verification item                                         | Result | Method                                                                |
| --------------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| Development startup                                       | Passed | `.\scripts\dev.cmd`; alive >25s without crashing, then ended manually |
| Production startup                                        | Passed | `.\scripts\npm.cmd exec -- electron .` loaded `out/`; alive >25s      |
| Open a nested workspace                                   | Passed | Project owner’s manual acceptance (2026-08-02)                        |
| Open root UTF-8 TXT; loading and read-only tab appear     | Passed | Project owner’s manual acceptance                                     |
| Expand directory and open nested TXT                      | Passed | Project owner’s manual acceptance                                     |
| Chinese, multiline, empty TXT, and BOM behavior           | Passed | Project owner’s manual acceptance                                     |
| Rapidly select two TXT files; final selection wins        | Passed | Project owner’s manual acceptance                                     |
| Non-TXT, directories, and links do not read contents      | Passed | Project owner’s manual acceptance                                     |
| Clicking externally deleted TXT gives error without crash | Passed | Project owner’s manual acceptance                                     |
| Clear over-5-MiB/invalid-UTF-8 messages                   | Passed | Project owner’s manual acceptance                                     |
| Current read-only text survives refresh                   | Passed | Project owner’s manual acceptance                                     |
| Successful switch clears text; cancellation preserves it  | Passed | Project owner’s manual acceptance                                     |
| Noneditable text; no unhandled console errors             | Passed | Project owner’s manual acceptance                                     |
| No test files created/modified/deleted by application     | Passed | Project owner’s manual acceptance                                     |

## 7. Known limitations

1. **TOCTOU**: for OS-level races from malicious concurrent local file replacement, this task minimizes the validation/read window and stays read-only; no platform-native handle-level prevention was implemented, as allowed by Section 6.2.
2. **Conditional link tests**: this machine cannot create links, so 2 actual symlink/junction cases are conditionally skipped with `it.runIf`. Rejection branches have deterministic lstat mock coverage; rerunning in an environment with Developer Mode enabled is recommended.
3. **One document, one tab**: selecting another TXT directly replaces it; no tab array, close button, or unsaved indicator, as explicitly scoped.
4. **Snapshot survives file deletion**: after refresh reveals deletion, current read-only text remains the last successful snapshot; reselecting reports an error, per Section 4.4.
5. **No restoration**: document/workspace state is lost on application close; restoration belongs to later work.
6. **Mock-based preload/IPC contracts**: real Electron bridging is verified by desktop smoke checks and later E2E facilities, within allowed scope.

## 8. Final acceptance review

All task Section 11 criteria—11.1 (13 functional items), 11.2 (11 security items), and 11.3 (14 quality items)—are satisfied and checked in `TASK_003_TXT_READONLY.md`. Specifically:

- Automated acceptance (typecheck/lint/format:check/test/check/build, reader/UI tests, Task 2 regression) passed through actual command execution.
- Desktop smoke checks: the Agent verified development/production key startup paths; the project owner executed and passed all 13 manual Section 8.4 items on 2026-08-02.
- README and TESTING.md were updated to match actual capabilities.

## 9. Task status and next entry point

**TASK-003 status: Completed.**

The next planned task is [TASK-004: Basic single-TXT editing and safe saving](../task-004/TASK_004_TXT_EDIT_SAFE_SAVE.en.md). It continues the small vertical-slice approach by adding basic editing state and explicit saving to the current read-only TXT, using “write same-directory temporary file → flush → close → safe replacement” so failures lose neither originals nor unsaved text. It will address modified state, save shortcuts, failure semantics, and external-file conflicts without simultaneously adding multiple tabs, workspace search, or DOCX.
