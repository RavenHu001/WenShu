# TASK-003: Controlled UTF-8 TXT reading and a single read-only tab

[简体中文](./TASK_003_TXT_READONLY.md) | English

[Task archives](../README.en.md) · [Documentation center](../../README.en.md)

## Task status

- Status: `Completed`
- Completion report: [TASK-003 completion report](./TASK_003_COMPLETION_REPORT.en.md)
- Priority: `P0`
- Type: `Product vertical slice / local file reading / IPC / React UI`
- Prerequisite: [TASK-002: Workspace folder selection and a read-only file tree](../task-002/TASK_002_WORKSPACE_READONLY.en.md)
- Immediate next task: [TASK-004: Basic single-TXT editing and safe saving](../task-004/TASK_004_TXT_EDIT_SAFE_SAVE.en.md)
- Project baseline: [PROJECT_BASELINE.md](../../architecture/PROJECT_BASELINE.en.md)
- Main execution approach: implement work packages sequentially, accepting each separately

## 1. Task purpose

Task 2 established the read-only workspace flow “select workspace → main-process directory scan → controlled IPC snapshot → React file tree”, but ordinary file nodes remain unselectable and the application does not read file contents.

This task implements the second product vertical slice: the user selects an ordinary UTF-8 TXT file within the workspace, the main process validates and reads its contents within the current workspace’s authorization boundary, and the renderer displays it in a single read-only tab in the central area.

The slice must connect this entire flow:

```text
Select a TXT relative path in the React file tree
  -> Restricted preload API
  -> Fixed document:read-text IPC channel
  -> Main process retrieves current workspace state
  -> Validate path, type, symbolic links, size, and UTF-8
  -> Serializable read-only document snapshot
  -> Single tab in the central React area
```

The core objective is to verify the safe flow “file-tree selection → controlled file reading → central-area display”. Editing, saving, and actual multi-tab support are not provided.

## 2. User experience after completion

After completion, users should be able to:

1. Open a local workspace containing TXT files.
2. Select an ordinary `.txt` file with the mouse or keyboard.
3. See a clear loading state while it is read.
4. See a single read-only tab named after the file in the central area.
5. Read UTF-8 Chinese, English, line breaks, and whitespace.
6. Open empty TXT files normally.
7. Select another TXT file, replacing the current single-tab contents.
8. See recoverable errors for read failures, oversized files, or invalid encoding.
9. Return to the no-document-selected state after successfully switching workspaces.
10. Retain the current read-only snapshot when canceling a workspace switch or refreshing the workspace.

Non-TXT files, directories, symbolic links, and other node types must not have their contents read in this task. The UI may retain read-only display or show a short unsupported-file message, but must not invoke general file-reading capabilities.

## 3. Pre-execution checks

Before modifying product code, the implementing agent must:

1. Read this task, the project baseline, the Task 2 plan, and the Task 2 completion report.
2. Confirm that the branch contains Task 2’s complete implementation and tests.
3. Inspect `git status --short`, identify user changes outside this task, and preserve them.
4. Run and record the baseline commands:

```powershell
.\scripts\npm.cmd run check
.\scripts\npm.cmd run build
```

If a baseline command fails, first record the existing failure and determine whether it blocks this task. Do not continue by deleting tests, relaxing type checks, disabling lint rules, or weakening Electron security.

## 4. Fixed design decisions

### 4.1 Single read-only document snapshot

- Each successful read returns a one-shot, immutable, serializable document snapshot.
- The central area displays at most one TXT tab.
- Selecting another TXT directly replaces that tab; no tab array is maintained.
- The tab has no close button, unsaved indicator, or restored state.
- Contents are read-only, with native browser selection and copying.
- Do not introduce CodeMirror, Monaco, Zustand, or other editor/state-management dependencies.

This design verifies only document reading, without prematurely implementing multi-tab or editor architecture. Later tasks can extend the stable contract without requiring this task to prebuild a complete editor system.

### 4.2 Relative paths are controlled identifiers, not authorization

- The renderer may submit only canonical workspace-relative paths from the tree snapshot.
- Paths use `/` separators, are nonempty, and contain no empty segments, `.`, `..`, backslashes, or null characters.
- The main process must treat all IPC inputs as untrusted and validate them again.
- The main process must not accept a renderer-supplied workspace root or arbitrary absolute path.
- A file’s presence in an old snapshot does not replace live main-process path, type, and boundary checks.

Task 2’s restriction that `relativePath` must not trigger file system reads is revised after this task: only the new fixed TXT-reading use case may use relative paths, and it must pass this task’s main-process validation.

### 4.3 TXT scope, encoding, and size

- Accept only ordinary files with a case-insensitive `.txt` extension.
- Contents must be valid UTF-8.
- UTF-8 BOM is accepted but must not appear as a body character in the returned text.
- Do not guess, convert, or write back GBK, UTF-16, or other encodings.
- Preserve original line endings and text characters without format conversion.
- The maximum file size is `5 MiB` (`5 * 1024 * 1024` bytes).
- Oversized files return a clear error; do not truncate reads or send partial text to the renderer.

The fixed size limit protects main-process, IPC, and renderer memory. Larger-file support, if later required, should use a separately designed streaming/virtualization approach based on measurements, not expand this task.

### 4.4 Coordinating workspace and document state

- The main process continues to own the current workspace root.
- Capture the current workspace root at the start of a document read and use only that snapshot for the read.
- Clear the old renderer document after a successful workspace switch.
- Preserve the old workspace and document if selection is canceled or opening a new workspace fails.
- Manual workspace refresh replaces only the file-tree snapshot; it does not reread or clear the current document.
- If a file has been deleted after refresh, retain the current read-only text as the last successful snapshot and report an error when it is selected again.
- Reads may finish out of order; the UI must accept only the result corresponding to the latest user selection.
- A successful workspace switch must also invalidate unfinished reads from the old workspace.

Do not add file watching, automatic refresh, a request-cancellation protocol, or persisted state.

## 5. Shared data contract

Add `src/shared/document.ts` containing only pure TypeScript types/constants, with no Electron, Node.js, React, or browser runtime dependency.

The following semantically equivalent contract is recommended:

```ts
export interface TextDocumentSnapshot {
  readonly name: string;
  readonly relativePath: string;
  readonly content: string;
  readonly byteLength: number;
}

export type TextDocumentErrorCode =
  | 'NO_WORKSPACE'
  | 'INVALID_PATH'
  | 'OUTSIDE_WORKSPACE'
  | 'UNSUPPORTED_TYPE'
  | 'NOT_FILE'
  | 'NOT_FOUND'
  | 'ACCESS_DENIED'
  | 'TOO_LARGE'
  | 'INVALID_UTF8'
  | 'READ_FAILED';

export interface TextDocumentError {
  readonly code: TextDocumentErrorCode;
  readonly message: string;
}

export type ReadTextDocumentResult =
  | { readonly status: 'loaded'; readonly document: TextDocumentSnapshot }
  | { readonly status: 'error'; readonly error: TextDocumentError };
```

Contract requirements:

- Every field is read-only.
- All return values are safely copyable with Electron structured clone.
- Do not pass `Error`, `Buffer`, file handles, `Stats`, functions, or class instances.
- The main process derives `name` from the final path rather than trusting a renderer-supplied name.
- Return the validated canonical `relativePath`.
- `byteLength` is the original byte count, not JavaScript string length.
- Error messages contain no file text, stack traces, or unnecessary system internals.
- Error codes drive stable UI branches; messages inform users. Do not control logic by matching message strings.

Extend `src/shared/desktop-api.ts` to:

```ts
interface DesktopApi {
  readonly runtime: DesktopRuntimeInfo;
  readonly workspace: {
    readonly open: () => Promise<OpenWorkspaceResult>;
    readonly refresh: () => Promise<RefreshWorkspaceResult>;
  };
  readonly document: {
    readonly readText: (relativePath: string) => Promise<ReadTextDocumentResult>;
  };
}
```

## 6. Main-process implementation requirements

### 6.1 Workspace session state

The current root should no longer remain an unshareable local variable inside `workspace-ipc.ts`. Extract a minimal session module:

```text
src/main/workspace/
├─ scan-workspace.ts
├─ workspace-ipc.ts
└─ workspace-session.ts
```

Its only responsibilities are:

- Retrieve the current workspace root.
- Update it after opening/scanning succeeds.
- Leave it unchanged on failure/cancellation.

Do not introduce a general state container, persistence, recent workspaces, multi-window sessions, or renderer-writable state interfaces.

Injecting a read-only `getCurrentWorkspaceRoot` function into document IPC is also acceptable if it preserves equivalent testability, security boundaries, and a single source of state.

### 6.2 TXT reader

Suggested structure:

```text
src/main/document/
├─ read-text-document.ts
└─ document-ipc.ts
```

The reader should validate in this order:

1. Confirm a workspace is open.
2. Confirm a nonempty relative path conforming to Section 4.2.
3. Confirm the `.txt` extension.
4. Resolve the candidate against the current workspace root.
5. Reject lexical path escape using `path.relative` or equivalent semantics.
6. Check each segment from the workspace root, rejecting any symbolic link/junction and requiring intermediate segments to be directories and the final segment to be an ordinary file.
7. Obtain real paths for the workspace root and candidate file.
8. Confirm the real file remains inside the real workspace root.
9. Check size against 5 MiB before reading contents.
10. Read asynchronously with a bound of `5 MiB + 1 byte`, preventing unbounded allocation if the file grows after prechecking.
11. Recheck the actual length against the limit.
12. Strictly decode UTF-8 in fatal mode.
13. Return the snapshot or map failure to a stable error code.

Implementation must:

- Use asynchronous `node:fs/promises` APIs.
- Handle Windows path casing and separators through Node.js `path` semantics.
- Map common errors such as `ENOENT`, `EACCES`, and `EPERM` to stable codes.
- Catch external deletion/replacement between validation and reading without rejecting IPC.
- Never perform an unbounded `readFile` after a size precheck on a potentially growing file.
- Never record contents or write them into logs.
- Call no write, create, rename, delete, or permission-change APIs.
- Build no general file-handler registry or dependency-injection container.

Static symbolic-link/junction escape must be prevented. For OS-level TOCTOU races caused by malicious concurrent replacement by local processes, this task requires minimizing the validation/read window and remaining read-only; it does not require a platform-native handle-level race prevention solution. Record this limitation in the completion report.

### 6.3 IPC registration

Register only one new fixed request/response channel:

- `document:read-text`

Requirements:

- Use `ipcMain.handle`.
- Accept only one string relative-path argument.
- Validate argument count and type at handler entry.
- Accept no root path, encoding, size limit, or arbitrary options.
- Retrieve and capture the workspace root when the handler starts.
- Convert expected and unexpected failures into `ReadTextDocumentResult`.
- Register no `file:read`, `fs:*`, general command dispatch, or dynamic channel proxy.
- Keep registration idempotent to avoid duplicate handlers.

## 7. Preload and renderer boundaries

### 7.1 Preload API

Add only this closure interface to preload:

```ts
document: Object.freeze({
  readText: (relativePath: string) => ipcRenderer.invoke('document:read-text', relativePath),
});
```

Continue prohibiting exposure of:

- `ipcRenderer`.
- General `invoke(channel, ...args)`.
- Arbitrary absolute-path reads.
- Control over encoding, file-size limits, or Node.js options.
- Node.js `fs`, `path`, `process`, or Electron objects.

Update `DesktopApi` and the `window.desktop` global type together; main, preload, and renderer must share the same result contract.

### 7.2 File tree interaction

Add minimal, explicit callback propagation to `FileTreeNode`, `FileTree`, and `WorkspaceSidebar`:

- Render ordinary `.txt` nodes as accessible buttons.
- Pass the node’s `relativePath` on click or keyboard activation.
- Give the selected file a recognizable selected state.
- Temporarily highlight the requested TXT while loading; if reading fails and the previous successful document is retained, restore selection to that document.
- Non-TXT files, links, directories, and other nodes do not call `document.readText`.
- Tree components report user intent only and do not call preload directly.
- Preserve directory expansion/collapse, empty states, and local errors.

Extension checks only determine UI interaction and cannot replace main-process validation.

### 7.3 Central read-only document area

Suggested additions:

```text
src/renderer/components/document/
├─ DocumentPane.tsx
└─ ReadonlyTextDocument.tsx
```

The central area represents at least:

- `welcome`: no document selected; display the existing welcome content.
- `loading`: display the requested filename and loading state.
- `loaded`: display one active tab and read-only contents.
- `error`: display an understandable, recoverable read error.

Use a read-only `<textarea>` or semantically equivalent element preserving whitespace/line breaks. It must:

- Be explicitly read-only.
- Preserve line breaks and whitespace.
- Support native selection/copying.
- Not simulate read-only using `contentEditable`.
- Not inject contents into `innerHTML`.
- Show an open tab and empty content area for an empty file.
- Keep the central area as the main layout area.

If reading fails with a previous successful document, retain its text and show a nonblocking error. Without one, show an error panel. A new successful read clears the old error.

### 7.4 React state and asynchronous races

Continue using React’s built-in state. Let `App` or a small document container own current-document state and pass these props to the workspace sidebar:

- `onTextFileOpen(relativePath)`.
- `selectedTextFilePath`.
- `onWorkspaceSelected(workspace)` or an equivalent successful-switch notification.

The sidebar may keep its existing scan state; lifting all workspace state or introducing Context is not required.

Use an incrementing request number, current request token, or equivalent mechanism so that:

- After selecting A then B, only B is displayed even if A returns last.
- Unfinished old-workspace reads cannot reappear after a workspace switch.
- Unexpected IPC Promise rejection becomes a UI error rather than an unhandled rejection.
- Stale results are not committed after unmount.

## 8. Testing requirements

Continue with Vitest and React Testing Library and add no production dependencies. Test user-visible behavior and security branches, not extensive CSS-class/internal implementation assertions.

### 8.1 TXT reader tests

Cover at least:

- Reading a UTF-8 TXT in the root.
- Reading a nested TXT.
- Correct Chinese/multiline contents and byte length.
- Empty-file results.
- UTF-8 BOM is not displayed as text.
- No open workspace.
- Rejection of empty paths, absolute paths, backslashes, and `..`.
- Consistent handling of differently cased `.txt` extensions.
- Rejection of non-TXT files.
- Rejection of directories/other nonordinary files.
- Rejection of links/junctions pointing outside the workspace.
- Stable errors for missing files, denied access, and disappearance during reading.
- Rejection before reading contents for files over 5 MiB.
- Rejection of invalid UTF-8.
- No leaked raw `Error` or stack trace on unexpected exceptions.

Windows link creation may require privileges. Do not request administrator rights; use Vitest mocks for a few `realpath`, `stat`, or read-adapter functions, or conditional tests when privileges exist, while keeping executable coverage of the core boundary logic at all times.

### 8.2 Preload and contract tests

Confirm through type checks, lightweight unit tests, or review that:

- `document.readText()` maps only to fixed `document:read-text`.
- Callers cannot specify a channel, root, encoding, or read options.
- `DesktopApi`, preload, and renderer global types agree.
- Result objects contain only serializable data.

Do not introduce a full Electron end-to-end framework solely to test preload.

### 8.3 UI tests

Cover at least:

- Mouse clicks on TXT nodes.
- Keyboard activation of TXT nodes.
- No content reads for non-TXT files, directories, or links.
- Loading state during reads.
- Filename, single tab, and contents after success.
- Empty read-only content area for empty files.
- Selecting a second file replaces the first.
- Read failures show errors without crashing.
- A failed read retains existing document text.
- Unexpected IPC Promise rejections are handled.
- Out-of-order A/B requests display only B.
- Successful workspace switching clears the old document.
- Cancellation/failed switching preserves the old document.
- Workspace refresh preserves the document snapshot.
- Task 2 expansion, refresh, and error-state tests still pass.

### 8.4 Manual desktop smoke verification

After implementation, manually verify at least:

1. Start development and open a workspace with nested directories.
2. Open a UTF-8 TXT in the root.
3. Expand a subdirectory and open a nested TXT.
4. Open Chinese, multiline, and empty TXT files.
5. Rapidly select two TXT files; the last selection is ultimately displayed.
6. Selecting non-TXT files does not read contents.
7. Delete an unopened TXT externally, then click it; an error appears without a crash.
8. Opening an over-5-MiB or invalid-UTF-8 file gives a clear message.
9. Current read-only text remains visible after refreshing.
10. Successful workspace switching clears old text.
11. Canceling a switch preserves old text.
12. Text cannot be edited and the developer console has no unhandled exceptions.
13. The application has not created, modified, or deleted test files.

## 9. Explicitly out of scope

- TXT editing, saving, Save As, and autosave.
- Unsaved state, close confirmation, and safe writes.
- Multiple tabs, tab closing/reordering, and restoration.
- Current-document find, replace, undo, redo, and word counts.
- File creation, renaming, moving, or deletion.
- File watching and automatic refresh.
- Recent files/workspaces and startup restoration.
- DOCX, Markdown, PDF, or other content reading.
- Encoding selection, guessing, or non-UTF-8 conversion.
- CodeMirror, Monaco, Tiptap, Mammoth, docx, and JSZip.
- Zustand or other global state libraries.
- General file system APIs, general IPC, or file-type plugins.
- Windows installers, automatic updates, and release processes.
- Playwright/Electron end-to-end facilities.
- AI, Agents, cloud services, and accounts.

Do not incidentally add capabilities outside Sections 5–8, even if easy.

## 10. Work packages and execution order

Implement one package at a time; do not proceed if its gate fails.

### WP0: Baseline confirmation and implementation locations

- Read the required documents and relevant source.
- Inspect the working tree and identify existing user changes.
- Run existing `check` and `build`.
- List planned file modifications.
- Do not modify product code.

Acceptance gate: the Task 2 baseline and existing failures are recorded, with unambiguous scope.

### WP1: Shared contract, workspace session, and TXT reader

- Add shared document contracts.
- Adjust Task 2’s `relativePath` contract documentation.
- Extract/provide read-only workspace session access.
- Implement path, realpath, type, size, and UTF-8 validation.
- Add reader security-branch tests.

Acceptance gate: reader tests, full `check`, and `build` pass; IPC is not yet registered and the React UI is unchanged.

### WP2: Fixed IPC and narrow preload interfaces

- Register `document:read-text`.
- Extend `DesktopApi`.
- Map the fixed interface in preload.
- Update renderer global types.
- Add necessary lightweight contract tests.

Acceptance gate: the renderer requests TXT only through `document.readText(relativePath)`; no general IPC/arbitrary-path API exists; full `check` and `build` pass.

### WP3: TXT selection in the file tree

- Add selection callbacks and selected state to tree components.
- Make TXT nodes mouse/keyboard activatable.
- Keep non-TXT and nonordinary files unreadable.
- Update existing tree component tests.

Acceptance gate: the tree reports only supported TXT selections and does not access preload directly; Task 2 behavior still passes.

### WP4: Central read-only document area and races

- Implement welcome, loading, loaded, and error states.
- Display a single read-only tab and contents.
- Handle switching, refresh, and failure semantics.
- Prevent stale asynchronous results from overwriting the newest selection.
- Add central-area user behavior tests.

Acceptance gate: component tests, full `check`, and `build` pass; no editing, multiple tabs, or saving.

### WP5: Overall acceptance and documentation

- Run all automated checks.
- Complete development/production desktop smoke verification.
- Update current capabilities in README/testing guidance.
- Write `docs/tasks/task-003/TASK_003_COMPLETION_REPORT.md`.
- Record dependency changes, results, limitations, and the next entry point.
- Change status to `Completed` and check acceptance items only after all acceptance passes.

Acceptance gate: all of Section 11 is satisfied, with actual command/manual verification evidence in the report.

## 11. Final acceptance criteria

Task 3 may be marked complete only when all conditions are satisfied.

### 11.1 Functional acceptance

- [x] Ordinary TXT nodes are mouse/keyboard selectable.
- [x] UTF-8 TXT files in root/nested directories can be read.
- [x] The central area displays filename, one active tab, and read-only contents.
- [x] Chinese, multiline, whitespace, empty-file, and UTF-8 BOM behavior is correct.
- [x] A new TXT selection replaces the current single-tab contents.
- [x] Non-TXT files, directories, links, and other nodes do not read contents.
- [x] Loading, oversized files, invalid encoding, and general errors have clear states.
- [x] A failed new read does not clear the last successful snapshot.
- [x] Old requests finishing out of order do not overwrite the latest selection.
- [x] Successful workspace switching clears the old document.
- [x] Cancellation/failed switching preserves the old document.
- [x] Refresh preserves the current read-only snapshot.
- [x] Contents are not editable and the application does not write user files.

### 11.2 Security acceptance

- [x] `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true` are unchanged.
- [x] The renderer imports no Node.js, Electron, or file system modules directly.
- [x] Preload exposes no `ipcRenderer`, general `invoke`, or general file reads.
- [x] IPC accepts no workspace root, absolute path, encoding, or read options.
- [x] The main process fully validates relative paths as untrusted input.
- [x] `..`, absolute paths, backslashes, and noncanonical paths are rejected.
- [x] Realpath checks prevent static link/junction workspace escape.
- [x] The target must be an ordinary workspace TXT no larger than 5 MiB.
- [x] Cross-process results contain no raw exceptions, Buffer, handles, or stacks.
- [x] Contents are not logged.
- [x] No user-file write operations exist.

### 11.3 Quality acceptance

- [x] Reader tests cover Section 8.1’s key security branches.
- [x] UI tests cover Section 8.3’s key states/races.
- [x] Existing Task 2 tests pass.
- [x] `.\scripts\npm.cmd run typecheck` succeeds.
- [x] `.\scripts\npm.cmd run lint` succeeds with 0 warnings.
- [x] `.\scripts\npm.cmd run format:check` succeeds.
- [x] `.\scripts\npm.cmd test` succeeds.
- [x] `.\scripts\npm.cmd run check` succeeds.
- [x] `.\scripts\npm.cmd run build` succeeds.
- [x] The Electron development build completes manual smoke verification.
- [x] The Electron production build completes key-path verification.
- [x] README matches implemented capabilities.
- [x] `TESTING.md` matches actual acceptance steps.
- [x] The completion report accurately records results and limitations.

## 12. Failure handling and decision rules

- With no workspace, return `NO_WORKSPACE`; do not try a renderer-provided root.
- For invalid/escaping paths, return stable rejection rather than normalizing and attempting a best-effort read.
- Reject targets that are not ordinary TXT files; do not fall back to arbitrary text preview.
- Reject all contents above 5 MiB rather than displaying a truncated result.
- Return an encoding error for invalid UTF-8, without silent replacement-character decoding.
- Convert external modification/replacement/deletion during reads to recoverable errors, without retry loops.
- Retain the successful snapshot and show an error if a new read fails.
- Discard out-of-order stale UI results without treating them as user errors.
- Use mocks/pure-logic tests rather than elevating privileges for Windows link tests.
- If the 5 MiB, UTF-8-only, single-tab, or read-only boundary must change, stop the affected implementation and explain benefits, risks, complexity, and migration costs to the project owner.
- Do not manufacture passes by deleting useful tests, weakening Electron security, disabling strict typing, or ignoring lint rules.

## 13. Execution prompt template

Use this fixed prompt for each package, replacing only the package number and content:

> Read `docs/architecture/PROJECT_BASELINE.md`, `docs/tasks/task-002/TASK_002_COMPLETION_REPORT.md`, `docs/tasks/task-003/TASK_003_TXT_READONLY.md`, and source directly relevant to the current package. Implement only TASK-003 WPx, no later packages, unrelated refactoring, editing, saving, multiple tabs, file watching, or DOCX. Strictly preserve Electron security boundaries, allowing only controlled reads of ordinary workspace UTF-8 TXT; expose no general IPC, arbitrary path reads, or writes. Run required package tests, `.\scripts\npm.cmd run check`, and `.\scripts\npm.cmd run build`. Report modified files, key decisions, command results, unresolved issues, and whether the gate is met.

Execution rules:

- Complete only one package per conversation.
- Review the diff before proceeding to the next package.
- After WP1/WP2, specifically review path validation, error serialization, IPC arguments, and preload exposure.
- After WP4, specifically review out-of-order results and workspace switching.
- Only WP5 may write the report, check final acceptance items, and change status to `Completed`.

## 14. Deliverables

The implementing agent must deliver:

1. Shared TXT document contracts.
2. Minimal shareable current-workspace session state.
3. An asynchronous UTF-8 TXT reader within workspace boundaries.
4. The fixed `document:read-text` handler.
5. Controlled `document.readText(relativePath)` preload API.
6. TXT-selectable tree interaction.
7. A central single read-only tab and document-state UI.
8. Reader, contract, and UI behavior tests.
9. Updated README/testing guidance.
10. `TASK_003_COMPLETION_REPORT.md`, covering at least:
    - Implementation summary.
    - Key new/modified files.
    - Data contracts, path validation, and security boundaries.
    - New dependencies and reasons.
    - Actual automated checks/results.
    - Desktop smoke verification.
    - Known limitations, including TOCTOU.
    - Whether all criteria are satisfied.

## 15. Entry point for the next task

The immediate next task is [TASK-004: Basic single-TXT editing and safe saving](../task-004/TASK_004_TXT_EDIT_SAFE_SAVE.en.md): add basic editing state and explicit saving to the current single TXT document, with safe writes ensuring failures lose neither original files nor unsaved contents.

The next task should focus on modified state, save shortcuts, failure semantics, external-file conflicts, and “write temporary file → flush → atomic replacement”. It should still not simultaneously add multiple tabs, workspace search, or DOCX.
