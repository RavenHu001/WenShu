# TASK-009: Basic File Management

[简体中文](./TASK_009_BASIC_FILE_MANAGEMENT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

## Task status

> **Status: Completed (2026-08-16).**
>
> Priority: `P0`. Start with WP0 and implement/accept each package in order. Only WP8 may add the completion report, check final acceptance items, and mark this file Completed.
>
> WP0–WP8 are complete and individually accepted (see [completion report](./TASK_009_COMPLETION_REPORT.en.md) and [WP0 report](./TASK_009_WP0_REPORT.en.md)). Section 11 was checked item by item. The owner passed section 9 manual UI testing, confirming “手动功能测试已通过” (manual functional testing passed). Full `check` (54 files / 1016 passes / 10 conditional skips) and `build` passed sequentially, exit 0.
>
> This builds on Task 2's read-only tree, Task 4/5's safe TXT saving/multiple tabs, Task 7's structured DOCX editing/safe saving, and Task 8's mixed search/navigation. All Task 1–8 behavior forms the regression baseline.

## 1. Purpose

Complete the remaining core success criterion—managing files through the tree—without turning renderer into a general filesystem client or weakening data safety. Add these current-workspace operations:

1. Create empty TXT;
2. Create valid basic DOCX;
3. Create folders;
4. TXT / DOCX Save As;
5. Rename regular files/folders;
6. Move regular files/folders within current workspace;
7. Delete to Windows Recycle Bin;
8. Reveal entries in Windows File Explorer;
9. Safely migrate tabs, editor sessions, dirty/saving, and selection after path changes;
10. Deterministically invalidate old search results/in-flight navigation, leaving no clickable old-path results.

This is not a complete file explorer: no copy/paste, batch actions, dragging, permanent deletion, or cross-workspace actions. Every write/path change binds to the main-process current workspace through fixed narrow IPC, strict requests, source/target validation, and recoverable failures.

## 2. User experience after completion

Users should be able to:

- Create TXT/basic DOCX/folders in workspace root or selected folder;
- See created entries immediately; created TXT/DOCX automatically open as unique clean tabs;
- Use “另存为” (Save As) on writable current TXT/DOCX, selecting a workspace folder and filename;
- Safely create absent targets; explicitly confirm existing-target overwrite bound to the same version;
- Migrate the current tab/session after Save As while leaving source in place;
- Rename files/folders, including Windows case-only changes;
- Move within workspace ordinary directories, excluding self/descendant destinations;
- Preserve order/active state/dirty/body-model/cursor/selection/scroll/undo-redo/find state when renaming/moving open documents;
- Migrate all open descendant paths together when a directory moves;
- See deletion confirmation with path/type/affected dirty-tab count; wait for saving tabs so in-flight saves cannot write deleted/old paths;
- Remove successful deletions from tree, close affected tabs, restore via Recycle Bin;
- Reveal regular files/folders in Explorer;
- Receive stable conflict/permission/external-change/invalid-path/partial-failure/refresh-failure errors without losing edits;
- Immediately invalidate old search results after successful writes, preventing old-path navigation.

## 3. Prerequisite checks

### 3.1 Required reading

Read and verify:

- `README.md`;
- `docs/architecture/PROJECT_BASELINE.md`;
- `docs/development/DEVELOPMENT_ENVIRONMENT.md`;
- `docs/development/TESTING.md`;
- `docs/tasks/task-004/TASK_004_TXT_EDIT_SAFE_SAVE.md` and completion report;
- `docs/tasks/task-005/TASK_005_MULTI_TXT_TABS.md` and completion report;
- `docs/tasks/task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md` and completion report;
- `docs/tasks/task-008/TASK_008_DOCX_WORKSPACE_SEARCH.md` and completion report;
- `src/shared/workspace.ts`;
- `src/shared/desktop-api.ts`;
- `src/shared/document.ts`;
- `src/shared/docx.ts`;
- `src/main/workspace/scan-workspace.ts`;
- `src/main/workspace/workspace-ipc.ts`;
- `src/main/workspace/workspace-session.ts`;
- `src/main/document/path-validation.ts`;
- `src/main/document/write-safety.ts`;
- `src/main/document/save-text-document.ts`;
- `src/main/docx/export-docx.ts`;
- `src/main/docx/save-docx-document.ts`;
- `src/renderer/lib/document-tabs.ts`;
- `src/renderer/lib/use-documents.ts`;
- `src/renderer/lib/use-editor-sessions.ts`;
- `src/renderer/lib/use-workspace.ts`;
- `src/renderer/lib/use-workspace-search.ts`;
- `src/renderer/components/workspace/WorkspaceSidebar.tsx`;
- `src/renderer/components/workspace/FileTree.tsx`;
- `src/renderer/components/workspace/FileTreeNode.tsx`;
- `src/renderer/components/document/DocumentPane.tsx`;
- `src/renderer/App.tsx`.

### 3.2 Working tree and quality baseline

At WP0 start:

1. Check branch/`git status --short`, protect user changes.
2. Confirm Task 8 merged and report exists.
3. Run full `npm run check`.
4. Run `npm run build`.
5. Record files/passes/conditional skips and every skip reason.
6. Open main window in development and production.
7. Smoke-test workspace open/refresh, TXT/DOCX open/edit/save, multi-tab sessions, unsaved protection, search/navigation.

Planning observations on 2026-08-16: clean tree; passing check, 38 files, 835 tests, 6 environment skips; build passed. This planning reference does not replace actual-branch WP0 execution.

Diagnose baseline failure first. Do not mix existing failures into Task 9 or manufacture passes by deleting tests, increasing timeouts, disabling strict checks, or unconditional skips.

### 3.3 WP0 technical verification

Before product writes, use minimal fixtures to verify/record:

- Windows reserved/illegal names, trailing dots/spaces, controls, collisions, case-only rename;
- Validating absent target leaves through parents without following symlink/junction;
- Same-volume file/directory/nonempty/cross-parent/case-only `rename`;
- `shell.trashItem` with files/nonempty directories/permission failures/missing targets and injectable testing boundaries;
- File/directory `shell.showItemInFolder`, without generic shell;
- TXT Save As reuse of BOM/newlines/revision/safe replacement;
- Blank canonical DOCX generates, validates, and reimports;
- DOCX Save As reuse of export/validation/compatibility/target backups;
- Actual path-id coupling impact on CodeMirror, resident DOCX, React keys, async saves;
- Stable tabId separate from path preserves selection/scroll/history/find/toolbar instances;
- Linear descendant migration without DOM scans;
- Successful actions share a deterministic mutation epoch for cancelling search/clearing results/rejecting late navigation.

If findings conflict, update fixed decisions/tests/risks before WP1.

## 4. Fixed product and protocol decisions

### 4.1 Current workspace only

- All operations target the current main-process `workspace-session`.
- Renderer submits no roots, absolute paths, drive letters, UNC, `file://`, temporary paths, shell arguments.
- Create/Save As stay inside workspace; no generic boundary-crossing dialog.
- Move stays within workspace; no cross-workspace/drive or root moves.
- Root may be create-parent/reveal target, never renamed/moved/deleted.
- Symlinks/junctions/other reparse points/`other` are display-only, not manageable.
- Hide `.wenshu.bak`/`.wenshu-*`; renderer cannot directly target them.

### 4.2 Fixed operations, no generic filesystem commands

Allowed cross-process capabilities:

- `workspace.createText`;
- `workspace.createDocx`;
- `workspace.createDirectory`;
- `workspace.relocate`, workspace rename/move only;
- `workspace.trash`;
- `workspace.reveal`;
- `document.saveTextAs`;
- `document.saveDocxAs`.

Do not expose:

- Arbitrary `fs` names or `execute(operation, args)`;
- Renderer-selected IPC channels;
- Absolute source/target paths;
- Arbitrary shell/executable/argument lists/URLs;
- `force`, `recursiveDelete`, `skipValidation`, `skipBackup`, `allowOutsideWorkspace`;
- Renderer-controlled permissions/concurrency/timeouts/path/temp strategies.

Exact object shapes/runtime validation reject extra fields, wrong types, unknown discriminators.

### 4.3 Names, relative paths, and target parents

Represent target as `parentRelativePath + name`:

- Root parent is `''`.
- Other parents use normalized `/`-separated relative paths.
- `name` is a leaf, without `/`, `\`, NUL, controls, or path segments.
- Reject empty, `.`, `..`, trailing dots/spaces.
- Reject Windows `< > : " / \ | ? *`.
- Reject case-insensitive `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, including extension forms.
- No silent trimming/substitution/Unicode normalization/numeric suffix; user fixes invalid names/conflicts.
- TXT create/Save As requires `.txt`, DOCX `.docx`, case-insensitive.
- Renaming open TXT/DOCX cannot change to another supported or unsupported type; extension changes are not conversion.
- Independently validate source, target parent, leaf. Existing `resolveWorkspaceTarget` requires regular-file final segment and cannot pretend to support absent/directory targets.
- Parent validation: root-to-leaf `lstat`, reject symlink/junction, require ordinary directory for every parent, then realpath boundary.
- Source similarly checked by segment and permitted type.
- Filesystem is final conflict authority; renderer snapshots are UI data, not operation-time validation.

### 4.4 Workspace epoch, mutationId, serialization

- Each renderer action has monotonically increasing `mutationId`, only a late-result UI guard, not authority.
- Main process maintains a per-window write queue, at most one management write/window.
- Save As obeys tab `saveInFlight`; no simultaneous normal save/Save As on one tab.
- Capture workspace identity at start; before commit confirm unchanged root, live window, and request not invalidated.
- Renderer commits only while mounted, mutationId current, epoch unchanged, target tab existing/matching.
- Repeated clicks cannot create concurrent rename/double delete/double create/old overwrite of new state.
- If disk succeeds but scanning fails, never report “not executed”; return stable completed-but-refresh-failed result with retry refresh.

### 4.5 Stable tab identity and path uniqueness

First decouple `tab.id === relativePath`:

- tabId is stable renderer-session identity, not path-derived.
- relativePath/name/disk-snapshot paths migrate.
- Runtime Maps, CodeMirror cache, DOCX editor Map, React keys, active tab, async requests use stable tabId.
- Deduplicate current normalized path; stable identity does not permit duplicate tabs/path.
- Windows comparisons cover case insensitivity/case-only rename; filesystem in main is authoritative.
- Migration preserves order/active tab/dirty/saving/body-model/edit revision/read-save identities.
- TXT preserves CodeMirror `EditorState`, selection, scroll, undo, find panel/query.
- DOCX preserves Tiptap/PM instance, selection, scroll, undo, toolbar binding.
- Directory prefixes are segment-aware: `a/b` never matches `a/b2`.
- After migration saves use new path; earlier captured saves completing later cannot write old paths.

To prevent divergent data, affected saving tabs block rename/move/delete and prompt waiting. Dirty, nonsaving tabs may rename/move with edits preserved.

### 4.6 Creation

- TXT exclusively creates a regular zero-byte valid BOM-free UTF-8 file; first read uses existing semantics.
- DOCX uses correct-version blank `DocxDocumentModel`, at least one empty paragraph; export, size/ZIP/OOXML/reimport validation, then exclusive write. Zero-byte placeholders are not successful new DOCX creation.
- Folder creation is single-level, without implicit missing parents.
- Never overwrite/auto-rename; return `TARGET_EXISTS`.
- File writes use same-directory exclusive temporary files, complete writes, `sync`, close, validation, no-overwrite publication, best-effort cleanup.
- Return normalized path/type after success and rescan.
- After successful refresh, open TXT/DOCX as unique clean tabs via `openFile`; select new folder and expand parent.
- No editable ghost tabs before disk success; no untitled memory documents.

### 4.7 Save As and overwrite confirmation

- Separate fixed TXT/DOCX requests/services, no generic byte-copy API.
- Only settled, loaded, savable tabs; disallow loading/read-error/saving/in-flight save-error stages.
- TXT uses latest body/BOM/newline/mixed-newline confirmation.
- DOCX uses latest valid model/compatibility/export/validation; read-only cannot Save As, and byte-copy duplicates are excluded.
- Degraded confirmation remains bound to baseline revision.
- Missing target: exclusive safe create. Existing target: first call returns `TARGET_EXISTS`/controlled revision, zero writes.
- Confirmed second request includes `expectedTargetRevision`; re-read/compare before publication; change returns `CONFLICT` and requires reconfirmation.
- Reject `overwrite: true` / `force: true`.
- TXT overwrite reuses temporary write/safe replacement.
- DOCX overwrite first creates/refreshes `<目标文件名>.wenshu.bak` with target pre-replacement bytes; backup failure preserves target.
- No meaningless backup for absent target.
- Success leaves source unchanged and migrates current tab into the target session.
- Another tab open at target: renderer rejects before IPC, main still checks disk conflicts; never merge states.
- Existing edit-during-save rules apply: captured content saves, later edits keep dirty after target migration; next save uses target.

### 4.8 Rename and move

Unify as controlled `relocate`:

- Request normalized source, target parent/name, no absolute paths.
- Source regular file/directory only; no root/link/junction/other/internal recovery file.
- Parent must exist as ordinary directory.
- No directory into self/descendant.
- Existing target always `TARGET_EXISTS`; no file overwrite/directory replace/merge. Overwrite belongs only to explicit Save As.
- Same actual path and identical name is safe no-op.
- Windows case-only uses unpredictable same-directory exclusive intermediate name, rollback on either failure.
- Ordinary same-volume move uses atomic rename, never copy/delete.
- Recheck source type/absent target/unchanged root before publication.
- For open files/descendants, renderer commits migration once after main success; failure preserves paths.
- Update selection/expansion/pending-dialog targets; invalidate search/navigation without guessed migration.
- `.wenshu.bak` is companion recovery data. Single DOCX rename/move migrates existing backup to new companion name; existing target backup conflicts before operation. Companion failure attempts main rollback and returns stable error.
- Directory moves carry contained backups naturally, without separate enumeration/exposure.
- Failed rollback returns `PARTIAL_FAILURE`, forces refresh, preserves diagnostics without absolute paths/body; completion report records actual recovery.

### 4.9 Recycle Bin deletion

- Use `shell.trashItem` or WP0-verified equivalent Windows Recycle Bin API; never unlink/rm/rmdir for user deletion.
- Confirm relative path, file/folder type, affected dirty-tab count before calling.
- Affected saving tabs block; no force-delete continuation.
- Dirty tabs require explicit discard confirmation; cancellation sends no deletion IPC.
- Successful file deletion closes its tab; directory deletion closes all descendants.
- No early tab closure/optimistic snapshot removal before main success.
- Reject root/link/junction/other/internal/outside-workspace targets.
- Single DOCX trashes main/existing backup; directory trash naturally includes backups; never permanently delete.
- Multi-entry trash is nontransactional; partial main/backup success returns `PARTIAL_FAILURE` and refreshes. Never recreate trashed main to fake rollback.
- No in-app undo-delete/Recycle Bin browser; explain Windows Recycle Bin restoration.

### 4.10 Reveal in File Explorer

- Accept normalized workspace-relative path or explicit root discriminator only.
- Main rechecks path/boundary/type/links then fixed `shell.showItemInFolder`.
- No `shell.openExternal`/`shell.openPath`/arbitrary URL/command.
- Missing/moved/link/workspace-switched entries return stable error without guessing.
- Reveal changes no tree/tab/dirty/search state.

### 4.11 Workspace snapshots, selection, and search invalidation

- Every successful create/Save As/rename/move/delete rescans workspace.
- Add monotonic `mutationEpoch` or equivalent, incrementing only after confirmed disk success.
- Changes immediately cancel search, clear completed/cancelled/error results, targets, stale notices.
- Late results validate search requestId, workspace epoch, mutationEpoch.
- Never substitute new paths into old results; content/revision/directory scope/identity may all change.
- Reveal/failure/user cancellation do not increment.
- After scan success, select new path; after deletion select nearest existing parent or clear.
- Separate operation selection from active document. Directories/unsupported regular files can be selected for management; only regular TXT/DOCX open for editing.
- Centrally own expanded normalized-directory paths; migrate by boundary to avoid recursive local state loss from changed keys.
- Manual refresh replacing snapshot also invalidates search; no automatic watcher.

### 4.12 UI and accessibility

- Accessible sidebar entries for new TXT/DOCX/folder.
- Independent row selection; clear selection/open behavior that preserves keyboard TXT/DOCX opening.
- Rename/move/delete/reveal via row menu or selected-item toolbar, with keyboard access, focus restoration, recognizable labels.
- Controlled create/rename inputs, not HTML assembled with `contentEditable`.
- Move/Save As use workspace directory selector returning relative directory/leaf only.
- Explicit overwrite/delete/discard/saving-blocked dialogs; do not conflate risks in vague confirmation.
- Disable duplicate target submissions during operations, show creating/saving-as/moving/deleting.
- Stable product messages, never raw Node exceptions/absolute paths/temp names/stacks.
- On success focus new/moved entry or active editor; on cancel restore triggering control.
- No `dangerouslySetInnerHTML` or reverse-parsing path/type/confirmation identity from display text.

### 4.13 Dependencies and state

- No production dependencies expected.
- Reuse `fs/promises`, Electron `shell`, TXT/DOCX savers, DOCX validator, React controllers/dialogs.
- No Redux/Zustand/database/index/generic commands/file-management component library/extra native binary.
- If necessary, record dependency version/purpose/license/size/security exposure and evidence existing capabilities are insufficient before that package.

## 5. Shared contracts, state, and invariants

### 5.1 Suggested shared result model

Add explicit discriminated unions in `src/shared/file-management.ts`:

```ts
type ManagedEntryKind = 'text' | 'docx' | 'directory' | 'file';

interface WorkspaceTargetName {
  readonly parentRelativePath: string; // 根目录为 ''
  readonly name: string;
}

interface RelocateWorkspaceEntryRequest extends WorkspaceTargetName {
  readonly mutationId: number;
  readonly sourceRelativePath: string;
}

type WorkspaceMutationResult =
  | {
      readonly status: 'succeeded';
      readonly mutationId: number;
      readonly relativePath: string;
      readonly kind: ManagedEntryKind;
    }
  | {
      readonly status: 'succeeded-refresh-failed';
      readonly mutationId: number;
      readonly relativePath: string;
      readonly kind: ManagedEntryKind;
      readonly error: FileManagementError;
    }
  | {
      readonly status: 'error';
      readonly mutationId: number;
      readonly error: FileManagementError;
    };
```

Actual responsibilities may use narrower requests/results, preserving:

- Echo mutationId unchanged;
- Return normalized relative paths only;
- Stable code/message, no Error/Stats/handles/stacks across IPC;
- Distinguish `PARTIAL_FAILURE` from ordinary failures;
- Save As carries new snapshot/revision for in-place migration;
- Runtime validation rejects extra fields.

### 5.2 Stable errors

Freeze and test at least:

- `NO_WORKSPACE`;
- `INVALID_REQUEST`;
- `INVALID_PATH`;
- `INVALID_NAME`;
- `OUTSIDE_WORKSPACE`;
- `NOT_FOUND`;
- `NOT_FILE`;
- `NOT_DIRECTORY`;
- `LINK_NOT_ALLOWED`;
- `ROOT_OPERATION_NOT_ALLOWED`;
- `TARGET_EXISTS`;
- `TARGET_CHANGED` / `CONFLICT`;
- `TARGET_OPEN`, renderer product state not necessarily trusted by main;
- `DIRECTORY_INTO_DESCENDANT`;
- `TYPE_CHANGE_NOT_ALLOWED`;
- `COMPATIBILITY_CONFIRMATION_REQUIRED`;
- `BACKUP_FAILED`;
- `VERIFICATION_FAILED`;
- `ACCESS_DENIED`;
- `WRITE_FAILED`;
- `TRASH_FAILED`;
- `REVEAL_FAILED`;
- `PARTIAL_FAILURE`.

Reuse codes/messages for equal causes across create/Save As/relocate/trash/reveal where possible. Never drive flow from English OS exception wording.

### 5.3 Operation UI state

Controller distinguishes at least:

- `idle`;
- `editing-input`: create/rename name;
- `choosing-target`: move/Save As directory;
- `confirming-overwrite`;
- `confirming-trash`;
- `running`: unique mutationId;
- `succeeded`: brief feedback, then idle;
- `error`: preserve input/stable error for correction/retry/cancel;
- `partial-failure`: assume neither source nor target state; refresh before further writes.

### 5.4 Required invariants

1. Main-process session is sole root source.
2. Renderer never submits absolute source/target.
3. At most one management write/window.
4. No concurrent normal save/Save As per tab.
5. Affected saving tabs block rename/move/delete.
6. One open tab/normalized path.
7. Rename/move/Save As preserve tabId.
8. Migration preserves dirty/content/edit revision/editor state/order.
9. Main failure causes no premature renderer migration/close/snapshot change.
10. No automatic overwrite/rename on collision.
11. Confirmation binds target revision; changes require reconfirmation.
12. Created/Save As DOCX output passes validation.
13. Failed pre-overwrite DOCX backup preserves target.
14. Delete only to Recycle Bin, never permanently.
15. No directory into self/descendant.
16. No segment follows symlink/junction.
17. Successful mutation invalidates search/navigation.
18. Failure/cancel/reveal preserve mutationEpoch.
19. IPC/logs reveal no body/model/absolute paths/temp names/raw exceptions.
20. Exclusive unpredictable same-directory temporary files, best-effort cleanup on failure.

### 5.5 Asynchronous commit conditions

Operation commits require all:

- Controller mounted;
- Current running mutationId;
- Same starting epoch;
- Unchanged main root;
- Existing stable tabId when involved;
- Current tab path equals operation source;
- Operation/source kind/target kind match current state;
- Not superseded by cancelled pure-UI stage or newer operation.

Save As additionally validates:

- Same stable-tabId save request;
- Captured/current editRevision determine dirty clearing;
- No other tab owns target;
- Returned document/model/revision pass shared validation.

Migration is one model transition. Do not change tab path then runtime/search/selection next frame, exposing inconsistent state to shortcuts/saving.

## 6. Suggested module responsibilities

### 6.1 Shared management contracts

Add `src/shared/file-management.ts`:

- Names/targets/create/relocate/trash/reveal/Save As requests/results;
- Stable errors/product messages;
- Pure runtime validators;
- Pure path-prefix migration types;
- No Electron/Node/React/browser dependency.

### 6.2 Main-process source/target safety

Extend `src/main/document/path-validation.ts` or add `src/main/workspace/resolve-workspace-entry.ts`:

- `resolveExistingWorkspaceFile`;
- `resolveExistingWorkspaceDirectory`;
- `resolveWorkspaceParentDirectory`, supporting root `''`;
- `validateWindowsLeafName`;
- `resolveNonExistingWorkspaceTarget`;
- `isSameOrDescendantPath`;
- Case-only detection;
- Internal recovery/temp-name rejection.

Preserve existing read/save validation; do not ambiguously make required-existing-final helpers optional.

### 6.3 Main-process services

Add:

- `src/main/workspace/create-workspace-entry.ts`;
- `src/main/workspace/relocate-workspace-entry.ts`;
- `src/main/workspace/trash-workspace-entry.ts`;
- `src/main/workspace/reveal-workspace-entry.ts`;
- Small per-window serialized mutation coordinator if needed.

Inject adapters for deterministic permissions/conflicts/case-only steps/backup/trash/rollback failures. Do not expose production backdoors for testing.

### 6.4 TXT / DOCX Save As

Add separately:

- `src/main/document/save-text-document-as.ts`;
- `src/main/docx/save-docx-document-as.ts`.

Extract genuinely shared safe-write helpers without merging types/compatibility/backup semantics into a generic blob API.

### 6.5 IPC, preload, DesktopApi

Suggested:

- Extend workspace IPC or add `file-management-ipc.ts`, fixed channels;
- Explicit registration in main index;
- Narrow DesktopApi methods;
- One-to-one fixed preload mapping;
- Runtime validate, then fetch current root, then call service;
- Sender-window-bound handlers, no global generic filesystem router.

### 6.6 Stable tabs and path migration

Extend `document-tabs.ts`/`use-documents.ts`:

- Generate stable tabId;
- Replace `id === relativePath` dedup with independent lookup;
- Pure exact-file/directory-prefix transitions;
- Migrate tab/snapshot/runtime/activeTabId/save target;
- Save As start/complete transitions;
- Batch affected-tab closure after file/directory delete;
- Pure tests before IPC integration.

Update `use-editor-sessions.ts`, `DocumentPane.tsx`, DOCX editor Map to key only by stable tabId without path-triggered editor recreation.

### 6.7 Management controller

Add `src/renderer/lib/use-file-management.ts`:

- Own section 5.3 state/mutationId;
- Compose name/directory/overwrite/delete UI;
- Call fixed DesktopApi;
- On success rescan, increment epoch, migrate selection/expansion/document paths;
- Preserve recoverable input on failure without changing disk-mirror state;
- No direct Node/Electron objects.

### 6.8 Tree and dialogs

Extend/add:

- `WorkspaceSidebar`: entries/running state;
- `FileTree` / `FileTreeNode`: selection, row actions, central expansion;
- `WorkspaceTargetDialog`: workspace directory selection;
- `EntryNameDialog` or inline editing;
- Explicit overwrite/delete/partial-failure/saving-blocked dialogs.

Keep presentation pure; App/controllers inject actions, not recursive-node IPC.

### 6.9 App coordination/search invalidation

`App.tsx` coordinates:

- Dirty/saving guards;
- Workspace/management/document controllers;
- Post-mutation migration/batch close;
- Search cancel/clear/navigation invalidation;
- Workspace-switch/file-operation exclusion;
- Window-close/file-operation confirmations without mutual overwriting.

No filesystem details/absolute paths/Node errors in App.

## 7. Electron and data-safety boundaries

### 7.1 Suggested minimum API

```ts
interface DesktopApi {
  readonly workspace: {
    readonly open: () => Promise<OpenWorkspaceResult>;
    readonly refresh: () => Promise<RefreshWorkspaceResult>;
    readonly createText: (request: CreateWorkspaceEntryRequest) => Promise<WorkspaceMutationResult>;
    readonly createDocx: (request: CreateWorkspaceEntryRequest) => Promise<WorkspaceMutationResult>;
    readonly createDirectory: (
      request: CreateWorkspaceEntryRequest,
    ) => Promise<WorkspaceMutationResult>;
    readonly relocate: (request: RelocateWorkspaceEntryRequest) => Promise<WorkspaceMutationResult>;
    readonly trash: (request: TrashWorkspaceEntryRequest) => Promise<WorkspaceMutationResult>;
    readonly reveal: (request: RevealWorkspaceEntryRequest) => Promise<RevealResult>;
  };
  readonly document: {
    // 既有 read/save 方法保持
    readonly saveTextAs: (request: SaveTextDocumentAsRequest) => Promise<SaveTextDocumentAsResult>;
    readonly saveDocxAs: (request: SaveDocxDocumentAsRequest) => Promise<SaveDocxDocumentAsResult>;
  };
}
```

This defines exposure only, not final type names. WP0/WP2 may refine without increasing permissions.

### 7.2 Required security properties

- Preserve `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- Renderer imports no Electron/Node/`fs`/`path`/`child_process`/PowerShell.
- preload exposes no ipcRenderer/shell/generic invoke-send-on/arbitrary channel.
- Roots only from main session.
- Revalidate all relative paths as untrusted.
- Separately recheck source/parent/target/pre-publication state.
- No link/junction following or realpath escape.
- Renderer snapshot/kind/revision/confirmation booleans are never sole safety authority.
- Overwrite requires target revision compare-and-swap.
- Exclusive unpredictable same-directory temporary files, sync/close before publication.
- Preserve DOCX validation/pre-overwrite backups.
- Delete only to Recycle Bin.
- Reveal calls only fixed Explorer capability.
- Logs contain only operation code, stable errors, necessary counts; no body/model/absolute paths/user filenames/temp names/raw exceptions.

## 8. Testing requirements

### 8.1 Full Task 1–8 regression

- Actually execute all current tests.
- Preserve TXT path/UTF-8/BOM/newline/revision/safe-replace/multi-tab coverage.
- Preserve DOCX ZIP/OOXML/compatibility/model/backup/validation/save/lifecycle coverage.
- Preserve search traversal/cancellation/budgets/navigation/staleness coverage.
- Keep sandbox/preload allowlist/window-close/unsaved tests passing.

### 8.2 Names, paths, contracts

Cover at least:

- Root parent `''`, nested ordinary parents;
- Empty, `.`, `..`, slash/backslash/NUL/control/illegal Windows names;
- Reserved device names with extensions;
- Trailing dots/spaces;
- Absolute paths/drives/UNC/ADS/traversal;
- Symlink/junction in any source/parent segment;
- Missing/nonfile/nondirectory/other;
- Workspace/realpath escape;
- Case collision/case-only/unchanged Unicode names;
- Missing/extra fields/wrong types/unknown operation-kind;
- Structured-clone-safe results without runtime error objects.

### 8.3 Creation

Cover at least:

- TXT/DOCX/folder at root/subdirectory;
- TXT readable as empty UTF-8;
- DOCX inspect/import/open/save;
- No overwrite on file/directory collisions;
- Parent disappears/becomes link after validation;
- Inject exclusive-create/short-write/sync/close/validation/publication/cleanup failures;
- Failure leaves no target/temp residue;
- Success refreshes/opens unique clean tab.

### 8.4 Save As

Cover at least:

- TXT BOM/no-BOM, LF/CRLF/mixed;
- Continued editing during save, correct dirty after migration;
- DOCX supported/degraded/read-only;
- Expired degraded-confirmation revision;
- DOCX export/validation/target-backup/safe-replace failures;
- No backup for new target; overwrite backup equals prior bytes;
- First collision zero writes; confirmation bound to revision;
- Target changes after confirmation → conflict;
- Another tab owns target → no IPC;
- Success preserves tabId/editor/order/source file;
- Failure preserves source path/body/model.

### 8.5 Rename and move

Cover at least:

- File rename/cross-parent/directory/nonempty-directory move;
- Case-only;
- Same-path no-op;
- No overwrite/merge on existing target;
- Reject self/descendant destinations;
- Reject root/link/other/internal;
- External delete/replace/permission changes during action;
- Companion backup move/target-backup conflict/second-step/rollback failure;
- All descendant tabs migrate with correct prefix boundary;
- Dirty retained, saving blocked;
- TXT/DOCX selection/scroll/undo/find preserved;
- Later saves only use new path.

### 8.6 Recycle Bin and Explorer

Cover at least:

- Injectable trash for file/empty/nonempty directory;
- No IPC on cancel;
- Aggregate dirty confirmation/saving guard;
- File tab or all descendant tabs close after deletion;
- No premature close on trash failure;
- Companion DOCX backup/partial failure;
- No permanent-delete API calls;
- Reveal file/directory/root; reject missing/link;
- No arbitrary preload shell.

### 8.7 IPC and preload contracts

Cover at least:

- Fixed channels/exact argument counts;
- `NO_WORKSPACE`;
- Renderer cannot submit roots/absolute paths;
- Reject extra/dangerous fields;
- Main session roots/sender-window handlers;
- Serialized per-window writes;
- Late actions after workspace switch cannot commit old snapshot;
- DesktopApi only section 4.2 capabilities;
- No ipcRenderer/shell/handles/Node-error leakage.

### 8.8 Renderer state, components, cross-feature tests

Cover at least:

- Stable tabId/path dedup;
- Pure file/directory migration;
- Save As editRevision/dirty;
- All regular entries selectable, TXT/DOCX openable only;
- Central expansion survives refresh/migration;
- Create/rename/move/overwrite/delete/error/cancel focus;
- Repeated clicks send one mutation;
- Action and close/switch/window confirmations do not overwrite each other;
- Successful mutation cancels/clears search/navigation;
- Failure/cancel/reveal preserve valid search;
- Late search/navigation rejected by workspace epoch + mutationEpoch + requestId/locateId;
- Partial failure forces refresh without guessed paths.

### 8.9 Windows manual desktop smoke

At least once each in development/production:

- Root/nested TXT/DOCX/folder creation;
- Chinese/English/spaces/emoji/case names, invalid feedback;
- Save As new target/overwrite confirmation/external target changes;
- Dirty TXT/DOCX rename/move then continued edit/save;
- Directory move with multiple open TXT/DOCX;
- Saving blocks rename/move/delete;
- Trash files/nonempty directories and restore;
- Reveal files/directories/workspace;
- No content loss for Word/WPS-open DOCX permissions/sharing conflicts;
- Case-only rename;
- Consistent tree/tabs/selection/search/navigation;
- Rapid repeat submissions/workspace switch/window close;
- No unhandled console/terminal exceptions;
- No `.wenshu-*` residue; correct DOCX backups.

## 9. Explicit exclusions

- Outside-workspace Save As/cross-workspace/drive moves;
- Copy/paste/copy path/copy file/shortcuts/duplicates;
- Multiselect/batch rename/move/delete;
- Drag sorting/moving;
- Permanent delete/secure erase/in-app trash/undo delete;
- Filesystem watch/automatic refresh/external notices;
- Untitled memory docs/templates/recent files/startup restore;
- TXT/DOCX autosave;
- Read-only DOCX byte-copy Save As;
- TXT↔DOCX conversion or extension-based conversion;
- Current-DOCX find/replace/workspace/batch replacement;
- Complex Word formats/full lossless round-trip/Office automation;
- Tab dragging/pinning/batch closing/split views;
- Markdown/PDF/images/other editors;
- Generic filesystem/system terminal/plugins/cloud sync/AI-Agent.

## 10. Work packages and order

One package at a time; do not advance after failed gates.

### WP0: Baseline, Windows behavior, fixed semantics

- Complete section 3.
- Record check/build/test counts/skips.
- Temporary workspaces/Windows names/collisions/case/trash fixtures.
- Verify all 3.3 assumptions.
- Freeze section 4 protocols/errors/backup/partial-failure rules.
- Add `TASK_009_WP0_REPORT.md`.
- No product write UI exposure.

Gate: Repeatable Task 8 baseline; real Windows/Electron evidence; no unresolved data-safety semantics.

### WP1: Stable tabId and pure migration

- Decouple identity/path.
- Adapt dedup/runtime/CodeMirror/DOCX Map/React keys.
- Pure file/directory migration/batch-close/Save As completion.
- Cover dirty/saving/editRevision/async reads-saves/prefixes.
- No new write IPC/UI.

Gate: No tab regressions, editor recreation, or session loss; complete pure tests; full check/build pass.

### WP2: Contracts, names, source/target safety

- Contracts/stable errors/runtime validation.
- Windows leaf validation.
- Separate existing-file/directory/parent/absent-target resolution.
- Boundary/link/root/internal/descendant/case-only checks.
- Section 8.2 tests.
- No real write IPC yet.

Gate: Deterministic dangerous-name/path rejection; unchanged read/save safety; contracts/path tests/full check/build pass.

### WP3: Creation, reveal, fixed IPC

- TXT/DOCX/folder services.
- Reuse blank DOCX export/validation.
- Reveal service.
- Fixed IPC/DesktopApi/preload.
- Main write serialization/request identity.
- Related 8.3/8.6/8.7 tests.
- No renderer operation UI yet.

Gate: Exclusive safe creation/no residue, valid DOCX, narrow reveal shell; full check/build pass.

### WP4: TXT / DOCX Save As and revision confirmation

- Separate services/contracts/fixed IPC.
- Reuse TXT encoding/newlines/replacement.
- Reuse DOCX compatibility/export/validation/target backup.
- TARGET_EXISTS → expectedTargetRevision → pre-publication recheck.
- Stable-tabId Save As start/complete.
- Cover continued edits/open target.
- Section 8.4 tests.
- No rename/move/delete yet.

Gate: Unchanged source, safe target, no force overwrite, correct migration/dirty; full check/build pass.

### WP5: Rename, move, companion backup, trash

- Relocate/case-only intermediate/descendant checks.
- Companion backup migration/rollback.
- Shell trash adapter/file-directory deletion.
- Results/controller interfaces for aggregate dirty/saving guards.
- Partial-failure results.
- Fixed IPC/preload.
- Related 8.5/8.6/8.7 tests.
- No final tree UI yet.

Gate: No overwrite/escape/permanent delete; diagnosable directory/backup failures; migrate/close only after main success; full check/build pass.

### WP6: Controller, tree, dialogs

- Controller/mutationId state machine.
- Separate selection/active document.
- Central expansion set.
- Connect create/Save As/rename/move/delete/reveal.
- Target directories/name inputs/risk-specific confirmations.
- Preserve keyboard/focus/loading/error/cancel.
- Section 8.8 components.

Gate: UI → narrow IPC → refresh/migration for every action; no duplicate submissions/open-edit regressions; full check/build pass.

### WP7: Lifecycle, search invalidation, Windows smoke, risks

- mutationEpoch cancels/clears search/navigation.
- Cover switch/tab-close/window-close/saving/late results/exclusive confirmations.
- Partial-failure refresh.
- Section 8.9 development/production smoke.
- Word/WPS or equivalent external lock for permissions/sharing.
- Record duration/UI response/residue.
- Evidence-based fixes only, no scope growth.

Gate: Verifiable async identity/lifecycle; no old search paths; resolved Windows data-safety risks; full check/build pass.

### WP8: Final acceptance, documentation, report

- Full check/build.
- Final Windows manual checklist.
- Audit write paths/errors/temp cleanup/logs.
- Update README/baseline/testing/structure.
- Mark Roadmap Task 9 complete.
- Add `TASK_009_COMPLETION_REPORT.md`.
- Record protocols/names/tabId/confirmation/backups/trash/partial failure/search invalidation/tests/smoke.
- Mark complete only after all section 11.

Gate: Documentation matches behavior, verifiable automated/manual evidence, no open P0/P1 data-loss/escape-write/permanent-delete issues.

## 11. Final acceptance criteria

> WP8 checked every item below against automation, WP0 measurements, or manual/Shell evidence in the [completion report](./TASK_009_COMPLETION_REPORT.en.md). No item was checked from speculation.

### 11.1 Creation and Save As

- [x] Root/ordinary-subdirectory TXT/valid DOCX/folder creation.
- [x] No overwrite/auto-rename on create conflicts.
- [x] New DOCX reimports/opens/edits/saves.
- [x] TXT Save As preserves BOM/newlines/edit-during-save.
- [x] DOCX preserves compatibility/export validation/target backups.
- [x] Target-revision confirmation, reconfirm on changes.
- [x] Save As leaves source, migrates current tab.
- [x] Failure preserves source path/body/model.

### 11.2 Rename, move, delete, reveal

- [x] Regular files/directories rename/move within workspace.
- [x] Windows case-only rename works.
- [x] No overwrite/merge on existing target.
- [x] Reject root/link/other/internal/descendant moves.
- [x] Companion backup follows rules, rollback or explicit partial failure.
- [x] File/nonempty-directory deletion enters Recycle Bin.
- [x] Dirty deletion confirmed; saving blocked.
- [x] Failure causes no early tab close.
- [x] Reveal file/directory/workspace without generic shell.

### 11.3 Tabs, editors, lifecycle

- [x] Stable tabId decoupled from path.
- [x] One tab/path retained.
- [x] All affected paths migrate together with correct prefixes.
- [x] TXT cursor/selection/scroll/undo/find preserved.
- [x] DOCX instance/selection/scroll/undo/toolbar preserved.
- [x] Dirty/saving/editRevision/read-save identity/order preserved.
- [x] Later saves only use new path.
- [x] Switch/close/action confirmations do not contaminate each other.

### 11.4 Paths, IPC, data safety

- [x] No renderer roots/absolute paths/arbitrary shell/dangerous switches.
- [x] Deterministic illegal/reserved names/traversal/ADS/escape rejection.
- [x] No source/target segment follows symlink/junction.
- [x] Serialized writes/pre-publication recheck.
- [x] Exclusive same-directory temp, sync/close then publish, best-effort cleanup.
- [x] DOCX validation/backups preserved.
- [x] No permanent-delete API.
- [x] No body/model/absolute paths/temp names/raw exception leakage.
- [x] Partial failure never disguised as ordinary success/failure.

### 11.5 Workspace, search, quality, documentation

- [x] Successful mutation refreshes/updates selection/expansion.
- [x] Success cancels/clears search/navigation.
- [x] Failure/cancel/reveal preserve valid results.
- [x] Full Task 1–8 regression passes.
- [x] Section 8 tests complete, no only/unconditional skip.
- [x] typecheck/lint/format/test/check/build pass.
- [x] Windows development/production smoke passes.
- [x] Actual restore/external-lock/case-only evidence.
- [x] No temporary residue, correct backup paths.
- [x] README/baseline/testing/structure/report synchronized.

## 12. Failure handling and decisions

- Windows assumptions fail: stop, update WP0 with minimal temp/adapters first.
- Unsafe absent-target validation: improve parent/pre-publication checks, never direct write after string join.
- Case-only intermediate failure: rollback; failed rollback → partial failure/refresh.
- Nontransactional companion backups: prioritize main recovery/explicit partial failure, no silent wrong paths.
- Target changes after confirmation: conflict/reconfirm, no overwrite retry.
- Editor state lost on migration: complete identity decoupling; remounting is not acceptable functionality.
- Saving tab affected: block action without cancelling/preempting save.
- Dirty deletion: explicit discard; cancel means no IPC.
- Trash unavailable: stable error/preserved state, no permanent fallback.
- Success/refresh failure: report both; never repeat destructive operation to refresh.
- Partial failure: stop subsequent writes, refresh, recovery guidance, auditable record.
- Unreliable search migration: invalidate, never guess paths.
- New dependency needed: documented evaluation first.
- Safety versus convenience: prioritize workspace/revision/backups/trash/unsaved content/non-destructive failure.

## 13. Prompts for actual development execution

These are directly reusable package prompts, not illustrative slogans. Use one per conversation; replace bracketed branch/restore-point information with actual values and do not combine packages.

### 13.1 Rules shared by every package

- Read the entire task and template-specified source/tests first.
- Report branch/tree/previous restore point/scope/exclusions/expected files/tests/rollback.
- Protect user changes; no overwrite/reset/unrelated cleanup.
- Implement current WP only, without later UI/IPC/refactoring/completion checks.
- After edits, targeted tests then full `npm run check` and `npm run build`.
- Review diff/status/new IPC/write paths/temp residue.
- Report actual changes/decisions/plan differences/commands/manual evidence/limits/gate.
- Stop on failed gate; never advance yourself.
- Only WP8 adds report/checks section 11/marks complete.

### 13.2 WP0 execution prompt

> Execute TASK-009 WP0: baseline, Windows behavior, fixed semantics. Fully read `README.md`, `docs/architecture/PROJECT_BASELINE.md`, `docs/development/DEVELOPMENT_ENVIRONMENT.md`, `docs/development/TESTING.md`, Task 7/8 plans/reports, `docs/tasks/task-009/TASK_009_BASIC_FILE_MANAGEMENT.md`, then relevant workspace/path/TXT-DOCX save/tab/session/search source/tests. Report branch/tree/restore point/exclusions/checklist/minimal fixtures. Actually run full `check`/`build`, record files/tests/skips, smoke development/production main windows. Use temporary workspaces/injectable adapters to verify illegal/reserved names, collisions, case-only/file/nonempty-directory rename, target-parent segments, `shell.trashItem`, `shell.showItemInFolder`, blank DOCX export, Save As reuse, `tab.id === relativePath` impact, stable identity, descendant migration, mutationEpoch. Expose no UI/preload writes, implement no WP1+, change no final checkboxes. Add `docs/tasks/task-009/TASK_009_WP0_REPORT.md` with actual commands/environment/fixtures/evidence/failures/frozen decisions/gate. If assumptions fail, update plan/report before WP1. Finally review diff, rerun full `check`/`build`, report repeatable Task 8 baseline, Windows/Electron evidence, and absence of unresolved data-safety semantics.

### 13.3 WP1 execution prompt

> Execute TASK-009 WP1: stable tabId and pure path migration. Fully read `docs/tasks/task-009/TASK_009_BASIC_FILE_MANAGEMENT.md`, `docs/tasks/task-009/TASK_009_WP0_REPORT.md`, `src/renderer/lib/document-tabs.ts`, `use-documents.ts`, `use-editor-sessions.ts`, `DocumentPane.tsx`, `EditorSessionHost.tsx`, `DocxEditorSessionHost.tsx`, `TabBar.tsx`, `App.tsx`, and document/docx/search tests. Report branch/tree/WP0 restore point/invariants/migration steps. Only decouple tabId/path, adapt dedup/runtime/session/editor Maps/React keys, implement pure file/directory-prefix migration, Save As completion, batch close, and tests. No write IPC/preload/tree UI/real Save As/rename/move/delete. Existing opening/switching/saving/navigation/close protection must use stable identity, never path-triggered editor recreation; directory prefixes are segment-aware. Cover dirty/saving/editRevision/late reads-saves/order/active tab/CodeMirror find-undo-scroll/resident DOCX. Run targeted state/components then full `check`/`build`. Audit remaining implicit `id === relativePath`; report files/strategy/regression/gate; do not enter WP2.

### 13.4 WP2 execution prompt

> Execute TASK-009 WP2: contracts, names, source/target safety. Read Task 9, WP0, WP1 implementation/tests, `src/shared/workspace.ts`, `desktop-api.ts`, `document.ts`, `docx.ts`, `src/main/document/path-validation.ts`, `src/main/workspace/scan-workspace.ts`, `workspace-session.ts`. Only add/refine pure contracts/stable errors/strict validation/Windows leaf names and main-process existing-file/directory/parent/absent-target/root/internal/case-only/same-descendant resolution. No real write IPC/write-rename-trash-shell/UI/WP3+. Explicitly support root parent `''`; source/parent/target each use segment lstat/realpath without links/junctions; preserve existing final-file read/save checks. Test reserved/illegal/trailing names, ADS, absolute/UNC/drives/traversal/links/boundaries/types/case collisions/extra fields/structured clone. Targeted contract/path tests then full `check`/`build`. Report API/errors/order/helper boundaries/commands/gate; do not enter WP3.

### 13.5 WP3 execution prompt

> Execute TASK-009 WP3: creation, reveal, fixed IPC. Read task/WP0/WP1-WP2/tests, `write-safety.ts`, DOCX export/verify, workspace IPC/preload/DesktopApi/main registration. Only implement exclusive TXT/basic DOCX/folder creation, fixed reveal, minimal per-window mutation coordinator, matching fixed IPC/DesktopApi/preload. No tree UI/Save As/relocate/trash/WP4+. TXT is valid empty UTF-8; DOCX exports from canonical blank model, validates/reimports before publication. Use same-directory exclusive temporaries, complete writes, sync, close, no-overwrite publication/cleanup. Reveal only fixed `showItemInFolder` after current-relative-path checks, no generic shell. IPC rejects roots/absolute/extra/dangerous fields, obtains session root, binds sender. Adapter-test short writes/sync/close/validation/publication/cleanup/conflicts/permissions/parent races/reveal failure; update preload contracts. Targeted then full `check`/`build`. Review temp residue/new IPC; report gate, do not enter WP4.

### 13.6 WP4 execution prompt

> Execute TASK-009 WP4: TXT/DOCX Save As and revision confirmation. Read task/WP0/WP1 identity/WP2 paths/WP3 IPC, existing TXT-DOCX save/write-safety/export-verify/compatibility/document-tabs-use-documents tests. Only implement `saveTextAs`/`saveDocxAs` contracts/services/fixed IPC-preload/stable-tabId start-complete controller transitions. No relocate/trash/final tree UI. Exclusively create absent targets; first existing-target call returns TARGET_EXISTS/revision without writes. Confirm with expectedTargetRevision, compare before publication, no force/overwrite shortcut. Preserve TXT BOM/newlines/mixed confirmation/edit-during-save. Preserve DOCX degraded confirmation/export validation/target rolling backup, reject read-only Save As. Success leaves source, migrates stable tabId; later edits remain dirty; failure keeps source path. No request when another tab owns target. Inject generation/validation/backup/temp-write/target-recheck/replace/cleanup failures and external races. Targeted Save As/state/IPC then full `check`/`build`. Report source-target byte evidence/backups/CAS/dirty/gate; do not enter WP5.

### 13.7 WP5 execution prompt

> Execute TASK-009 WP5: rename/move/companion backup/trash. Read task/WP0/WP1 migration/WP2 resolution/WP3-4 IPC, relevant shell/session/DOCX backups/App dirty-saving code/tests. Only implement controlled relocate, Windows intermediate case-only rename, self-descendant rejection, backup migration/rollback, file-directory trash, partial failures, fixed IPC/preload/controller interfaces; no final UI/WP6+. Never overwrite/merge existing targets; reject root/link/other/internal; recheck before same-volume rename. Saving affected tabs block; dirty requires discard only for deletion. Trash uses injectable `shell.trashItem`, never unlink/rm/rmdir fallback; no migration/closing before main success. Explicit nontransactional DOCX main/backup partial failures; directories carry backups naturally. Test file/nonempty-directory/case-only/races/permissions/backup conflicts/second-step/rollback/trash failure/dirty-saving/descendants. Targeted then full `check`/`build`; verify no permanent-delete path. Report failure points/recovery/partial semantics/gate; do not enter WP6.

### 13.8 WP6 execution prompt

> Execute TASK-009 WP6: controller/tree/dialog UI. Read task/WP0/WP1-5 contracts-state-IPC, `use-workspace.ts`, `use-workspace-search.ts`, WorkspaceSidebar/FileTree/FileTreeNode, DocumentPane, ConfirmDialog, App, component tests. Only implement renderer controller/mutationId/independent regular-entry selection/central expansion/name input/workspace-directory selection/create-Save As-rename-move-delete-reveal UI/risk-specific confirmation. No permission/type expansion or early report. Preserve TXT/DOCX mouse/keyboard opening/accessibility; directories/other regular files select without erroneous opening. All disk actions use completed narrow APIs; no optimistic migration/close before success; block duplicates, restore cancel focus, retain error input, refresh partial failure. Save As/overwrite/delete/dirty/saving messages must be specific. Add controller/component/keyboard/focus/repeat/error tests; targeted then full `check`/`build`. Report user flows/accessibility/state/diff/gate; do not enter WP7.

### 13.9 WP7 execution prompt

> Execute TASK-009 WP7: lifecycle/search invalidation/Windows smoke/risks. Read task/WP0/WP1-6 implementation/tests, focusing App/workspace-management-document-search controllers/window close/navigation/dialogs. Integrate mutationEpoch: successful create/Save As/relocate/trash cancel search/clear completed/locate; failure/cancel/reveal retain validity. Cover switches/saving/tab-window close/late mutation-search-locate/exclusive confirmations/partial refresh. No new features/unrelated refactors/report. After lifecycle/cross-feature regressions, actually smoke Windows development/production: create, Save As overwrite/external target change, dirty rename/move, directory descendants, saving guard, trash/restore, reveal, case-only, rapid submissions, switch, Word/WPS/equivalent locking. Record commands/mode/Office-environment/verifiable results/timings/residue, never commit private files. Fix only evidenced in-scope issues. Targeted/full `check`/`build`. Report resolved risks/manual evidence/limits/gate; do not enter WP8.

### 13.10 WP8 execution prompt

> Execute TASK-009 WP8: final acceptance/docs/report. Fully read task/WP0/WP1-7 commits-restore points/all new source-tests/README-PROJECT_BASELINE-TESTING. No new functionality; fix only in-scope acceptance findings. Check section 11 individually without guessing. Actually run typecheck/lint/format check/all tests/full `check`/`build`; record files/passes/skips/reasons. Final Windows development/production smoke verifies restore/locking/case-only/residue/DOCX backups/search invalidation/Electron exposure. Audit writes/absolute-path leakage/dangerous switches/permanent deletion/skip-only/weakened assertions/user changes. Update README capabilities/unimplemented/Roadmap/docs/structure, baseline, testing. Add `docs/tasks/task-009/TASK_009_COMPLETION_REPORT.md`: summary/files/protocol/names-paths/tabId/create-Save As/revision overwrite/relocate-backup-trash-partial failure/search invalidation/IPC/tests/Windows/performance/limits. Only if all criteria actually pass mark complete/check `[x]`; otherwise retain planned/in-progress and list blockers. Report final diff/commands/unresolved issues/all-criteria status.

## 14. Deliverables

Deliver:

1. Shared requests/results/stable errors/runtime validation;
2. Windows leaf/source/parent/absent-target/descendant safety;
3. Multi-type tabs with stable tabId/mutable path;
4. Pure file-directory migration/Save As completion/batch close;
5. Safe TXT/basic DOCX/folder creation;
6. TXT/DOCX Save As/target-revision confirmation/DOCX backup;
7. File-directory rename/move/case-only/companion backup;
8. Recycle Bin deletion/Explorer reveal;
9. Fixed IPC/controlled preload/DesktopApi;
10. Renderer controller/tree selection-expansion/risk-specific dialogs;
11. mutationEpoch/refresh/search cancel/navigation invalidation;
12. Name/path/create/Save As/overwrite/migration/backup/trash/IPC/state/component/lifecycle/regression tests;
13. `TASK_009_WP0_REPORT.md`;
14. Updated README/baseline/testing/structure;
15. `TASK_009_COMPLETION_REPORT.md`, recording at least:
    - Summary/key files;
    - Fixed scope/exclusions;
    - Windows names/paths/links/boundaries/case-only;
    - Stable identity/descendant migration/editor evidence;
    - TXT/DOCX/folder creation;
    - Save As/target revision/confirmation;
    - DOCX target/companion backups;
    - Relocate/trash/rollback/partial failure;
    - Refresh/selection-expansion/search invalidation;
    - Electron/IPC/preload safety;
    - Tests/build/Windows development-production smoke;
    - Office-locking/restore/residue evidence;
    - Performance/limits/all-criteria status.

## 15. Next task after completion

Compare user value and risk before separately planning:

- Current-DOCX find/replace;
- Filesystem watching/automatic refresh;
- Basic settings/themes/startup restore;
- Tab dragging/pinning/batch close;
- Windows installers/formal release workflow.

Do not implement these incidentally in Task 9. Tentatively prioritize current-DOCX find/replace, but reconfirm in the completion report using actual user feedback.
