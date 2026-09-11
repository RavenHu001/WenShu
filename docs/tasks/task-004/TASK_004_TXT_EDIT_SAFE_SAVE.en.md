# TASK-004: Basic single-TXT editing and safe saving

[简体中文](./TASK_004_TXT_EDIT_SAFE_SAVE.md) | English

[Task archives](../README.en.md) · [Documentation center](../../README.en.md)

## Task status

- Status: `Completed`
- Priority: `P0`
- Type: `Product vertical slice / text editing / safe file writes / conflict protection`
- Prerequisite: [TASK-003: Controlled UTF-8 TXT reading and a single read-only tab](../task-003/TASK_003_TXT_READONLY.en.md)
- Prerequisite report: [TASK-003 completion report](../task-003/TASK_003_COMPLETION_REPORT.en.md)
- Completion report: [TASK-004 completion report](./TASK_004_COMPLETION_REPORT.en.md)
- Immediate next task: [TASK-005: Multiple TXT tabs and independent editing sessions](../task-005/TASK_005_MULTI_TXT_TABS.en.md)
- Project baseline: [PROJECT_BASELINE.md](../../architecture/PROJECT_BASELINE.en.md)
- Main execution approach: sequential work packages with individual acceptance

## 1. Task purpose

Task 3 established the full read-only flow “select TXT in tree → narrow preload API → fixed IPC → safe main-process read → central single read-only tab”. Without expanding into multiple tabs, autosave, file management, or DOCX, this task extends it into the first editing workflow that safely persists to disk:

```text
Select ordinary workspace UTF-8 TXT from the file tree
  -> Main returns text, format metadata, and content revision
  -> Edit one document with CodeMirror 6
  -> Modified state and Ctrl+S / Save button
  -> Fixed document:save-text IPC
  -> Main revalidates path and disk revision
  -> Same-directory temporary write, flush, close, atomic replacement
  -> Return new text snapshot and revision
  -> Clear unsaved state only for the version actually saved
```

The primary objective is to prove these properties together, rather than add rich editor features:

- Users can edit the current single TXT and save explicitly.
- Failed saves, save races, and external modifications never clear unsaved text.
- Writes never truncate or delete the original file first.
- The renderer still has no direct Node.js, arbitrary-path, or general IPC access.
- Task 2/3 workspace and read-safety boundaries do not regress.

## 2. User experience after completion

Users should be able to:

1. Open an ordinary workspace UTF-8 `.txt` from the tree.
2. Edit text in the central single-tab editor.
3. Save explicitly with the button or Windows `Ctrl+S` shortcut.
4. See saved, unsaved, saving, save failure, or external conflict states in the tab/status area.
5. Continue editing after saving, correctly distinguishing the saved version from new changes.
6. See and retain all local edits after a failed save.
7. Receive a conflict message after another program modifies the file, rather than silently overwriting it.
8. Receive explicit discard confirmation before opening another TXT, switching workspaces, or closing with unsaved changes.
9. Cancel and remain in the document without losing text, selection, or modified state.
10. Receive clear errors for files that cannot be edited safely rather than fall back to arbitrary writes.

This task retains one document and one tab. Selecting another TXT replaces it only after unsaved-change protection.

## 3. Pre-execution checks

Complete WP0 and record actual results before modifying product code.

### 3.1 Required reading

- `README.md`.
- `docs/architecture/PROJECT_BASELINE.md`.
- `docs/development/DEVELOPMENT_ENVIRONMENT.md`.
- `docs/development/TESTING.md`.
- `docs/tasks/task-003/TASK_003_TXT_READONLY.md`.
- `docs/tasks/task-003/TASK_003_COMPLETION_REPORT.md`.
- Task 3 contracts, reader, IPC, preload, single-document hook, central area, and related tests.

### 3.2 Working tree and baseline

- Inspect `git status --short` and protect existing user changes.
- Run `typecheck`, `lint`, `format:check`, `test`, `check`, and `build`.
- Do not misclassify existing Task 3 failures as Task 4 regressions.
- Do not manufacture passes by deleting tests, relaxing types, ignoring lint, adding arbitrarily long timeouts, or weakening Electron security.
- Do not implement file-writing capabilities before WP0 passes.

### 3.3 Known baseline issues to investigate

Observed in the controlled Windows development environment on 2026-08-04:

- The Git tree was clean and type checking/ESLint passed, but Prettier reported multiple files because of on-disk line endings. Git currently uses `core.autocrlf=true`; checkout line endings were not pinned.
- Vitest encountered worker communication and file-system initialization timeouts; some reader tests did not execute.
- The production build passed.

WP0 must distinguish repository configuration, test design, and controlled-runtime limitations. Establish a reproducible all-green baseline in normal Windows development. If the controlled environment has unavoidable external limitations, provide reproduction evidence from a normal local environment, deterministic alternatives, and explicit records; do not simply skip an entire test file.

## 4. Fixed design decisions

### 4.1 One document and one tab

- Maintain only one current document.
- Do not add a tab array, ordering, split views, recent files, or restoration.
- Handle unsaved changes before selecting a second TXT.
- Replace the first document state after the second opens successfully.
- Save state belongs only to the current workspace, relative path, and content version.

### 4.2 CodeMirror 6 as the TXT editor

- Follow the technical baseline and use CodeMirror 6 rather than extending the read-only `textarea`.
- Configure only plain text editing, native selection, copy/cut/paste, undo/redo, and the save shortcut.
- The editor must not read/write files directly.
- Editor changes update only renderer memory.
- Do not add syntax highlighting, current-file find/replace, custom multicursor behavior, completion, or complex shortcut infrastructure.
- Use stable compatible dependencies in `package-lock.json`; do not bypass conflicts with `--force` or `--legacy-peer-deps`.

### 4.3 Explicit saving only

- Save entry points are the button and `Ctrl+S`.
- Saving an unchanged document performs no disk write.
- At most one save per document may be in flight.
- Editing may continue while saving, but old success confirms only its submitted text version.
- If text changes after submission, successful saving still leaves unsaved changes.
- No timed, blur-triggered, or switch-triggered autosave.

### 4.4 Content revisions and external conflicts

- Hash the original complete bytes with SHA-256 when the main process reads a file.
- A revision is a conflict token, not authorization, and never replaces path revalidation.
- Saves carry the expected revision from the last successful read/save.
- Before saving, main rereads disk with bounds and computes its revision.
- A mismatch returns `CONFLICT` without creating/replacing the target.
- Conflict UI preserves local text and lets users discard it before reloading.
- No force-overwrite-external-version entry point in this task.

This detects external changes already present at save time. It is not live watching and does not promise to solve every OS-level TOCTOU race from malicious local processes.

### 4.5 UTF-8, BOM, and line endings

- Strict UTF-8 only, still limited to 5 MiB.
- Read snapshots record UTF-8 BOM presence.
- Preserve the original BOM policy when saving, without silently removing it on entry into the editor.
- Preserve consistent LF/CRLF style after saving.
- New files are out of scope.
- Mixed endings require a compatibility notice and explicit confirmation before first save, then normalization under the chosen rule; do not silently rewrite every line ending.
- Specify mixed-ending detection, confirmation, and serialization in tests before implementation; do not rely on implicit browser/editor conversion.

### 4.6 Safe-write protocol

TXT saving follows this fixed order:

1. Obtain the root from the current main-process session.
2. Treat renderer arguments as untrusted; revalidate canonical relative path, extension, and lexical workspace boundary.
3. `lstat` each segment from root, rejecting links/junctions and requiring intermediate directories and an ordinary target file.
4. Recheck real paths against the real workspace root.
5. Read the current file with bounds and check the expected revision.
6. Encode UTF-8 with defined BOM/line-ending rules; reject over-5-MiB output.
7. Create an unpredictable, exclusive temporary file in the target’s directory.
8. Write all bytes and `sync` the temporary file.
9. Close its handle.
10. Replace the target through a same-filesystem replacement operation.
11. Return a new snapshot/revision based on actual saved bytes.
12. Convert every failure to a stable error and attempt cleanup of this temporary file.

Prohibited approaches:

- Truncating writes directly to the target.
- Deleting the target before renaming the temporary file.
- Writing in the system temporary directory and moving across filesystems.
- Using renderer-supplied absolute paths, temporary names, encoding, or write options.
- Falling back to unsafe overwrite after replacement failure.
- Leaking text, absolute system paths, temporary names, or stacks in errors/logs.

Windows is the primary acceptance platform. If Node.js cannot provide the required replacement semantics on supported Windows versions, stop WP2, record evidence, and explain alternatives, data-safety risks, and migration costs to the owner. Never adopt delete-then-rename independently.

### 4.7 Save failure and unsaved-change protection

- Failed saves must not revert editor contents.
- Failed saves must not update the saved revision.
- Save failure, conflict, or IPC rejection preserves the unsaved indicator.
- Opening another TXT, switching workspaces, and closing must not silently discard changes.
- Use “Discard Changes / Cancel”: users who need to save cancel the operation, save explicitly, then retry.
- Cancellation performs no subsequent file read/workspace switch.
- Window-close protection uses narrow interfaces or explicit window-state coordination, not a general event bus, `ipcRenderer`, or dynamic channels.

### 4.8 Workspace switching and refresh

- With no unsaved changes, a successful switch clears the document.
- With unsaved changes, neither open the native picker nor change workspaces before discard confirmation.
- After confirmation, clear the document only if the switch actually succeeds; canceled selection/failed switching retains it.
- Manual refresh does not reread, save, or discard current edits.
- If the target disappears from the tree after refresh, retain edits; later saves return stable errors.
- No file watching.

## 5. Shared data contract

Keep contracts pure TypeScript, read-only, serializable, and independent of Electron, Node.js, React, and browser runtimes.

Extend `TextDocumentSnapshot` with these fields or equivalent semantics:

```ts
interface TextDocumentSnapshot {
  readonly name: string;
  readonly relativePath: string;
  readonly content: string;
  readonly byteLength: number;
  readonly revision: string;
  readonly hasUtf8Bom: boolean;
  readonly lineEnding: 'lf' | 'crlf' | 'mixed' | 'none';
}
```

Suggested save request/result:

```ts
interface SaveTextDocumentRequest {
  readonly relativePath: string;
  readonly content: string;
  readonly expectedRevision: string;
  readonly confirmMixedLineEndingNormalization?: true;
}

type SaveTextDocumentResult =
  | { readonly status: 'saved'; readonly document: TextDocumentSnapshot }
  | { readonly status: 'error'; readonly error: SaveTextDocumentError };
```

Fields may be reorganized with equivalent safety semantics, but:

- Main generates/validates filename, revision, BOM, and line-ending metadata.
- Requests accept no workspace root, absolute path, target/temporary name, encoding, size limit, or write strategy.
- Results contain no `Error`, `Buffer`, `Uint8Array`, handles, `Stats`, functions, or class instances.
- TypeScript alone is insufficient; IPC validates runtime shape and argument count.
- Main enforces maximum contents by encoded UTF-8 bytes, not JavaScript string length.

At minimum, save errors distinguish:

- `NO_WORKSPACE`.
- `INVALID_REQUEST`.
- `INVALID_PATH`.
- `OUTSIDE_WORKSPACE`.
- `UNSUPPORTED_TYPE`.
- `NOT_FILE`.
- `NOT_FOUND`.
- `ACCESS_DENIED`.
- `TOO_LARGE`.
- `CONFLICT`.
- `MIXED_LINE_ENDINGS_CONFIRMATION_REQUIRED`.
- `WRITE_FAILED`.

Messages inform users; control logic uses codes rather than string matching.

## 6. Main-process implementation requirements

### 6.1 Extend the TXT reader

- Hash original bytes with SHA-256 without weakening Task 3’s validation order.
- Detect BOM and line-ending type.
- Continue rejecting invalid UTF-8 and files over 5 MiB.
- Retain bounded reads; do not use unbounded `readFile` to compute revisions.
- Snapshot text serves the editor; original bytes do not cross processes.
- Keep all Task 3 safety tests passing and extend metadata assertions.

### 6.2 Add a safe TXT saver

- Put it in the main document module, separate from React/IPC registration.
- Use a lightweight filesystem adapter for deterministic temporary-create/write/`sync`/close/replace/cleanup tests.
- Temporary files are same-directory, exclusive, and not renderer-named.
- Handle short writes until all bytes are written or failure occurs.
- Finish conflict checking and flushing before target replacement.
- Return a disk-byte-consistent revision after replacement succeeds.
- Failures before replacement leave original contents/metadata unchanged.
- Replacement failure must not delete the original.
- Cleanup failure does not replace the primary error; record safe diagnostic codes without paths/text.
- Never log contents.

### 6.3 Fixed IPC

- Add only the specific `document:save-text` channel.
- Accept one structured request.
- Validate count, object shape, required types, and forbidden extra dangerous arguments.
- Capture the current root at handler start.
- Let the saver perform all path/revision/write checks.
- Return `SaveTextDocumentResult` for expected/unexpected failures.
- No `file:write`, `fs:*`, general command runner, or dynamic proxy.
- Keep registration idempotent.

### 6.4 Window-close protection

- Main stores only minimal state indicating whether the current window has an unsaved document.
- Coordinate modified state/close requests through a fixed narrow protocol.
- Closing while unsaved displays Discard Changes / Cancel.
- Cancel leaves the window open; discard permits only this close attempt.
- Coordination receives no file text, workspace root, or general IPC capability.
- Cover “type then close immediately”; a potentially stale fire-and-forget dirty boolean is insufficient close authorization.
- Prevent recursive confirmations and exit deadlocks.

## 7. Preload and renderer boundaries

### 7.1 Preload API

Add to `DesktopApi.document` alongside `readText(relativePath)`:

```ts
saveText(request: SaveTextDocumentRequest): Promise<SaveTextDocumentResult>
```

Window-close protection may use a separate fixed namespace with boolean interfaces; naming is up to implementation. Requirements:

- Each function maps to a fixed channel.
- No dynamic channel names.
- No `ipcRenderer`, Node.js modules, or arbitrary filesystem operations.
- API objects/namespaces remain frozen.
- Global types, shared contracts, and preload implementation agree.

### 7.2 Editor state model

Distinguish at least:

- `welcome`.
- `loading`.
- `loaded-clean`.
- `loaded-dirty`.
- `saving`.
- `save-error`.
- `conflict`.
- `read-error`.

Maintain, preferably:

- Last successful read/save snapshot.
- Current editor contents.
- Edit revision counter.
- Text/edit counter captured by the in-flight save.
- Last read/save error.
- Current selected tree path.
- Read request number and save request state.

A successful save may clear unsaved state only if its result belongs to the current workspace/document and the current edit counter still equals the captured counter. Otherwise update only the saved baseline and retain subsequent edits.

### 7.3 CodeMirror React integration

- Encapsulate instance creation/update/destruction in a separate component.
- Replace editor state explicitly on document switch; do not transfer old undo history.
- Send React only necessary text-change/shortcut callbacks.
- Avoid destroying/recreating the editor per keystroke.
- Commit no state after unmount.
- Never inject editor contents through `innerHTML`.
- Empty files can focus and accept input.
- Read-only loading/error states must not create an editor capable of writing to an erroneous file.

### 7.4 Protection and interaction

- Use a stable unsaved marker such as `●` after the filename.
- Show save state/recoverable errors in the status area.
- Use in-app confirmation before opening another TXT/switching workspaces.
- Use controlled main-process confirmation for window closing.
- Cancel preserves edits, current file, workspace, and selection.
- Discard affects only the explicitly confirmed transition.
- Conflict never triggers automatic discard/overwrite.
- Rapid repeated Save clicks never create parallel writes.

## 8. Testing requirements

### 8.1 Baseline and read regression

- Execute and pass all Task 2 scanner/component tests.
- Execute and pass all Task 3 reader/preload/document tests.
- Link-capability probe failure must not skip a whole test file.
- Environments without actual symlink/junction support still cover rejection deterministically with mocks.
- A fresh Windows checkout reproducibly passes `format:check` under the line-ending policy.

### 8.2 Read metadata tests

Cover at least:

- BOM absent/present.
- Empty files and newline-only files.
- LF, CRLF, mixed, and no line endings.
- Byte counts/revisions for Chinese/multibyte text.
- Identical bytes produce identical revisions; different bytes produce different revisions.
- Metadata does not weaken size, encoding, or path checks.

### 8.3 Safe saver tests

Cover at least:

- Successful root/nested TXT saves.
- Correct Chinese, empty-text, BOM, LF, and CRLF serialization.
- No write for unconfirmed mixed endings.
- Returned revision matches the actual saved file.
- Rejection of no workspace, invalid requests, absolute paths, backslashes, `.`, `..`, and empty segments.
- Rejection of non-TXT, directories, links/junctions, and nonordinary files.
- Rejection of realpath escape.
- Exactly 5 MiB encoded can save; larger output is rejected before temporary creation.
- Stable missing-file/permission errors.
- Different disk revision returns `CONFLICT` without temporary/target writes.
- Exclusive same-directory temporary creation.
- Short writes loop to completion rather than truncate.
- Write, `sync`, close, or replace failures never delete/truncate the original.
- Best-effort temporary cleanup after failure.
- No direct-overwrite fallback after replacement failure.
- No paths/text/temporary names/stacks leak from unexpected exceptions.

Do not request administrator rights for link tests. Mock difficult Windows failures through adapters; successful saving/replacement must also have real temporary-directory integration tests.

### 8.4 IPC and preload contract tests

Confirm at least:

- `saveText` maps only to `document:save-text`.
- Exactly one structured request is passed.
- Runtime IPC rejects wrong count/field types.
- APIs cannot specify channels, roots, absolute targets, temporary paths, encoding, or replacement options.
- `DesktopApi`, preload, and global types agree.
- Window dirty/close coordination accepts only fixed-shape data and fixed channels.
- No general `invoke`, `send`, `on`, or `ipcRenderer` exposure.
- Results contain only serializable data.

### 8.5 Editing and UI tests

Cover at least:

- Editable CodeMirror after opening TXT.
- Input/deletion/paste/undo/redo update text.
- First edit displays the unsaved indicator.
- Button and `Ctrl+S` use one save flow.
- Saving clean state invokes no IPC.
- Saving state appears and duplicate saves do not run concurrently.
- Success without new edits clears dirty.
- Editing during save remains dirty after old success.
- Failure/IPC rejection preserves text and dirty.
- Conflict preserves local text without automatic reload.
- Discard conflict text only after reload confirmation.
- Cancel/discard branches when opening another TXT.
- Cancel/discard/picker-cancel/switch-failure branches for workspaces.
- Refresh preserves current edits.
- Successful switching invalidates old read/save results.
- Empty TXT can accept input/save.
- Non-TXT, directories, and links still do not open editors.

### 8.6 Window-close tests

Cover at least:

- Clean closes directly.
- Dirty triggers confirmation.
- Closing immediately after typing still confirms despite synchronization delay.
- Cancel preserves window/document.
- Discard continues closure exactly once.
- Repeated close events cause no recursive confirmations, duplicate listeners, or exit deadlock.
- Destroying the window cleans its dirty state.

### 8.7 Manual desktop smoke verification

Verify in both development and production builds:

1. Open LF, CRLF, BOM, Chinese, multiline, and empty TXT.
2. Input, delete, copy/paste, undo, and redo.
3. Save with the button and `Ctrl+S`.
4. Reopen in another editor and confirm encoding/BOM/endings.
5. Continue typing after saving and confirm the unsaved marker returns.
6. Rapid saves cause no errors or temporary leftovers.
7. Induce read-only/permission failure and retain originals/edits.
8. Modify externally, then save; conflict appears and external text is not overwritten.
9. Cancel conflict reload and retain local edits.
10. While dirty, open another TXT, switch workspace, and close; test cancel/discard for each.
11. Refresh retains edits.
12. Over-5-MiB saves are rejected without target changes.
13. No task temporary files remain in the workspace.
14. No unhandled exceptions or content logs appear in console/terminal.

## 9. Explicitly out of scope

- Multiple tabs, closing, ordering, dragging, and restoration.
- Autosave, timed save, or blur save.
- Save As, new TXT/folders, rename, move, and delete.
- Force-overwriting external modifications.
- File watching/automatic refresh.
- Current-file find/replace, workspace search, and word counts.
- Markdown, DOCX, PDF, or other type editing.
- Non-UTF-8 selection, guessing, or conversion.
- File history, backups, undoing disk saves, or version control.
- Zustand/other global state unless evidence proves current local state unmaintainable.
- General filesystem/IPC, plugins, or a command bus.
- Windows installers, updates, release processes, and full Electron E2E infrastructure.
- AI, Agents, cloud services, and accounts.

Do not incidentally add capabilities outside Sections 5–8, even if easy.

## 10. Work packages and execution order

Implement one package at a time; do not proceed while its gate fails.

### WP0: Repair and lock the engineering baseline

- Read required documents/source.
- Inspect the tree and record user changes.
- Fix Windows line-ending/Prettier reproducibility.
- Reproduce and fix/isolate worker, temporary-directory, and link-probe timeouts.
- Ensure Task 2/3 tests actually execute, not whole-file skip.
- Run full `check` and `build`.
- Record fresh-checkout/equivalent normalized-environment evidence.
- Do not modify Task 4 product features.

Gate: clear working-tree origin; typecheck, lint, format, all tests, check/build reproducibly pass; no unexplained whole-file skips/timeouts.

### WP1: Shared contracts and read revision metadata

- Extend snapshot/save request/result/stable errors.
- Add original-byte SHA-256 revisions.
- Detect BOM/endings.
- Extend reader/contract tests.
- No writes, save IPC, or editable UI yet.

Gate: Task 3 reads remain compatible; metadata tests/full `check`/`build` pass.

### WP2: Main-process safe TXT saver

- Implement full path/type/realpath/revision-conflict validation.
- Implement encoded-size/mixed-ending confirmation gates.
- Implement same-directory exclusive temporary write, flush, close, replace, cleanup.
- Add mocked safety tests and real temporary-directory integration.
- No IPC registration or React changes yet.

Gate: all saver safety tests pass; real Windows replacement verified; no failure deletes/truncates originals; full `check`/`build` pass.

### WP3: Fixed save IPC and narrow preload

- Register `document:save-text`.
- Extend `DesktopApi.document.saveText(request)`.
- Add runtime validation/stable unexpected-error fallback.
- Update preload/global types/contracts.
- No general IPC/arbitrary write API.
- No editable UI yet.

Gate: only controlled TXT save requests; no renderer-selected root/absolute target/strategy; full `check`/`build` pass.

### WP4: CodeMirror editing and save state

- Add minimal CodeMirror 6 dependencies.
- Implement a separate TXT editor.
- Rework the single-document hook for contents/revision/dirty/saving/errors.
- Add Save/`Ctrl+S`.
- Correctly handle edits during saving and repeated saves.
- Add editing/save-state component tests.
- No multiple tabs/workspace search yet.

Gate: editing/explicit saving works; failure retains text; old success cannot clear new edits; full `check`/`build` pass.

### WP5: Conflicts, unsaved protection, and window coordination

- Implement conflict messages and confirmed reload.
- Implement discard/cancel before opening another TXT/switching.
- Implement minimal window dirty sync and close confirmation.
- Handle switch/refresh/close/in-flight results.
- Add all interaction/window tests.

Gate: every edit-discarding transition confirms; cancel preserves everything; conflicts overwrite neither disk nor local text; full `check`/`build` pass.

### WP6: Overall acceptance and documentation

- Run all automated checks.
- Complete development/production desktop smoke verification.
- Update README/testing/structure capabilities.
- Write `docs/tasks/task-004/TASK_004_COMPLETION_REPORT.md`.
- Record dependencies, protocol, Windows replacement evidence, tests/manual acceptance, limitations, and next task.
- Mark `Completed` and check criteria only after all acceptance passes.

Gate: all Section 11 satisfied; documents match implementation; report includes verifiable safe-write/conflict evidence.

## 11. Final acceptance criteria

Task 4 may be marked complete only when all conditions are met.

### 11.1 Functional acceptance

- [x] A single UTF-8 TXT is editable in CodeMirror.
- [x] Save and `Ctrl+S` save explicitly.
- [x] clean/dirty/saving/saved/save-error/conflict are clear.
- [x] Success without new edits clears unsaved state.
- [x] Edits during save remain unsaved.
- [x] Failed saves/IPC rejection preserve all text.
- [x] External modifications cause conflict without overwrite.
- [x] Conflict preserves local text until confirmed reload.
- [x] BOM and consistent LF/CRLF are preserved as specified.
- [x] Mixed endings require explicit confirmation; afterward dominant normalization applies.
- [x] Opening TXT, switching, and closing have unsaved protection.
- [x] Canceling discard preserves complete state.
- [x] Refresh preserves edits.
- [x] One document/tab remains, with no multi-tab or autosave.

### 11.2 Data-safety acceptance

- [x] Save revalidates workspace/path/per-segment links/realpath/type/size.
- [x] Revision hashes complete original bytes; external changes return `CONFLICT`.
- [x] Temporary files are exclusive and same-directory.
- [x] Full write/flush/close precedes replacement.
- [x] Targets are never truncated directly.
- [x] Targets are never deleted first.
- [x] Write/flush/close/replace failures preserve originals.
- [x] Failure attempts temporary cleanup.
- [x] No unsafe overwrite fallback.
- [x] Failed saves do not update revision or clear dirty.
- [x] Text/absolute paths/temporary names/stacks never enter IPC errors/logs.
- [x] Windows normal saves/key failures have actual verification evidence.

### 11.3 Electron boundary acceptance

- [x] `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` are unchanged.
- [x] No direct renderer Node.js/Electron/filesystem imports.
- [x] No exposed `ipcRenderer`, general `invoke/send/on`, or general writes.
- [x] Save IPC accepts no workspace root/absolute target/temp path/encoding/strategy.
- [x] IPC arguments are runtime-validated.
- [x] Window dirty coordination exposes only the minimum necessary interface.
- [x] Cross-process objects are serializable without Node.js objects.

### 11.4 Quality acceptance

- [x] WP0 issues resolved or supported by reproducible, auditable environment findings.
- [x] All existing Task 2/3 tests actually run/pass.
- [x] Metadata/saver/IPC/editing/window tests complete.
- [x] Deterministic rejection coverage without real symlink support.
- [x] `typecheck` succeeds.
- [x] `lint` succeeds with 0 warnings.
- [x] `format:check` passes in Windows checkout.
- [x] All tests pass without unexplained skips/unhandled errors.
- [x] `check` succeeds.
- [x] `build` succeeds.
- [x] Development desktop manual smoke completed.
- [x] Production key paths verified.
- [x] README/TESTING.md match actual capabilities.
- [x] Report accurately records results/limitations.

## 12. Failure handling and decision rules

- No workspace returns `NO_WORKSPACE`, without renderer root fallback.
- Invalid request shape returns stable failure without guessing/repairing dangerous fields.
- Reject paths/types/links/realpaths violating constraints.
- Revision mismatch returns `CONFLICT` before temporary creation.
- Reject encoded output over 5 MiB without truncation.
- Reject unconfirmed mixed endings without silent normalization.
- Any temporary-write failure preserves original and renderer text.
- Old successful saves do not clear dirty when text changed afterward.
- Switching successfully invalidates old-workspace read/save results.
- If Windows replacement safety cannot be demonstrated, stop/report rather than delete originals.
- Do not delete useful tests, expand timeouts to hide deadlocks, weaken security, or disable strict checks to pass.
- Before changing 5 MiB/UTF-8-only/single-tab/explicit-save/revision-conflict/no-force-overwrite boundaries, explain benefits, risks, complexity, migration costs, and data-safety impact to the owner.

## 13. Execution prompt template

Use this fixed prompt per package, replacing only its number/content:

> Read `README.md`, `docs/architecture/PROJECT_BASELINE.md`, `docs/development/DEVELOPMENT_ENVIRONMENT.md`, `docs/development/TESTING.md`, `docs/tasks/task-003/TASK_003_COMPLETION_REPORT.md`, `docs/tasks/task-004/TASK_004_TXT_EDIT_SAFE_SAVE.md`, and source directly relevant to the current package. Implement only TASK-004 WPx; no later packages, unrelated refactoring, multiple tabs, autosave, file management, search, or DOCX. Preserve Electron security; saving must validate workspace ordinary UTF-8 TXT paths/revisions and use same-directory temporary write, flush, close, and safe replacement. Run required tests, full `check`, and `build`. Report files, decisions, commands/results, issues, and gate satisfaction.

Execution rules:

- One package per conversation.
- Review diff before proceeding.
- WP0 changes no product functionality.
- After WP1, review compatibility/revisions/BOM/endings.
- After WP2, review original integrity/temporary lifecycle/Windows evidence.
- After WP3, review IPC/preload exposure.
- After WP4, review edits during save/races.
- After WP5, review all discard transitions/cancellation.
- Only WP6 writes the report/checks final criteria/marks `Completed`.

## 14. Deliverables

The implementing agent must deliver:

1. Shared editable-TXT/revision/metadata/save-result contracts.
2. Extended bounded UTF-8 reader.
3. Workspace-bounded safe TXT saver with revision conflicts.
4. Same-directory temporary write/flush/close/replace/cleanup.
5. Fixed `document:save-text` IPC.
6. Controlled `document.saveText(request)` preload API.
7. CodeMirror 6 single-TXT editor.
8. dirty/saving/error/conflict/save-race state management.
9. File/workspace/window unsaved protection.
10. Metadata/save-safety/contract/UI/window tests.
11. Updated README/baseline/testing guide.
12. `TASK_004_COMPLETION_REPORT.md`, including:
    - Implementation summary.
    - Key new/modified files.
    - Revision/BOM/line-ending rules.
    - Temporary-file/replacement protocol.
    - Electron/IPC boundaries.
    - Dependencies/reasons.
    - Actual checks/results.
    - Windows development/production smoke evidence.
    - Failure-injection/conflict/original-integrity evidence.
    - Limitations including TOCTOU/mixed endings.
    - Whether all criteria pass.

## 15. Entry point for the next task

The immediate next task is [TASK-005: Multiple TXT tabs and independent editing sessions](../task-005/TASK_005_MULTI_TXT_TABS.en.md). It reuses verified revision, dirty, saving, and unsaved-protection semantics, focusing on tab uniqueness, switching/closing, independent CodeMirror sessions, save concurrency, confirmation-target binding, and aggregate workspace/window protection without adding DOCX or workspace full-text search simultaneously.
