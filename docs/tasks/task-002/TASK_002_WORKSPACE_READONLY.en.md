# TASK-002: Workspace folder selection and a read-only file tree

[简体中文](./TASK_002_WORKSPACE_READONLY.md) | English

[Task archives](../README.en.md) · [Documentation center](../../README.en.md)

## Task status

- Status: `Completed`
- Priority: `P0`
- Type: `Product vertical slice / local file system / IPC / React UI`
- Prerequisite: [TASK-001: Establish a runnable, testable desktop application skeleton](../task-001/TASK_001_PROJECT_BOOTSTRAP.en.md)
- Immediate next task: [TASK-003: Controlled UTF-8 TXT reading and a single read-only tab](../task-003/TASK_003_TXT_READONLY.en.md)
- Project baseline: [PROJECT_BASELINE.md](../../architecture/PROJECT_BASELINE.en.md)
- Main execution approach: a lower-cost model implements work packages sequentially, with acceptance for each package

## 1. Task purpose

Task 1 established the Electron, preload, React, TypeScript, build, and testing baseline, but the application still cannot access a real workspace.

This task implements the first product vertical slice: the user selects a local folder through the system folder picker, the main process safely reads its directory structure, and the renderer displays an expandable/collapsible read-only file tree in the left sidebar.

The slice must connect this entire flow:

```text
React action
  -> Restricted preload API
  -> Fixed IPC channel
  -> Electron main process
  -> System folder picker and Node.js file system
  -> Serializable workspace snapshot
  -> React file tree
```

This task establishes only workspace selection and directory browsing. It neither opens file content nor performs any write operation.

## 2. User experience after completion

After completion, the user should be able to:

1. See a clear “打开文件夹” (Open Folder) entry point when no workspace is open.
2. Click it and select a folder through Electron’s native directory picker.
3. Cancel folder selection and remain in the previous state without an error.
4. See the workspace name, path, and read-only file tree in the left sidebar after a successful selection.
5. Expand or collapse any successfully read directory.
6. See explicit states for empty directories, symbolic links, and local read failures.
7. Manually refresh the current workspace’s directory structure.
8. Select another folder and replace the old workspace with it.
9. Continue using the application or select another workspace after a read failure.

Clicking a file in this task must not read its content or open an editor.

## 3. Pre-execution checks

Before making changes, the implementing agent must:

1. Confirm that Task 1 source code and documentation exist.
2. Confirm that the current development branch is based on a commit containing Task 1, rather than an old `main` containing only initial documents.
3. Confirm that `git status --short` contains no uncommitted changes unrelated to this task.
4. Run these baseline commands and record the results:

```powershell
.\scripts\npm.cmd run check
.\scripts\npm.cmd run build
```

If a baseline command fails, explain the existing failure first. Do not continue by deleting tests, relaxing type checks, or disabling lint rules.

## 4. Fixed design decisions

The following decisions are fixed to reduce ambiguity when a lower-cost model implements the task.

### 4.1 One-shot workspace snapshot

- After the user selects a directory, the main process asynchronously and recursively reads the complete directory tree.
- The result is returned to the renderer all at once as a serializable snapshot.
- Expanding/collapsing changes only local React UI state and does not access the file system again.
- Clicking Refresh makes the main process rescan the current workspace and return a new snapshot.
- Do not implement lazy loading, virtual lists, background indexing, or file watching in this task.

The recommended initial scope is up to 1,000 files, for which a one-shot snapshot is sufficient. If measurements reveal a clear performance problem, record the data before proposing a design change; do not expand the architecture prematurely.

### 4.2 The main process owns the current workspace

- The main process stores the current workspace root path.
- `open` may use only a path returned by the native folder picker.
- `refresh` may rescan only the current root path already stored by the main process.
- The renderer must not pass arbitrary absolute paths to the main process.
- The application currently has one window; this task does not design multi-window workspace state.

This avoids providing general path-reading capabilities to the renderer or introducing a complex path-authorization system in this task.

### 4.3 Read-only boundary

The only permitted file system behavior in this task is:

- Opening the system folder picker.
- Obtaining basic information about the selected directory.
- Reading directory entries.
- Identifying entry types.
- Producing a serializable tree for the UI.

Do not read file contents or create, modify, move, rename, or delete any user files.

## 5. Shared data contract

Cross-process types belong in `src/shared/` and may contain only pure TypeScript data structures and constants, with no dependencies on Electron, Node.js, React, or browser runtimes.

The following semantically equivalent contract is recommended. Small naming adjustments are acceptable, but security boundaries and result states must not change.

```ts
export type WorkspaceEntryKind = 'directory' | 'file' | 'symbolic-link' | 'other';

export interface WorkspaceEntryError {
  readonly code?: string;
  readonly message: string;
}

export interface WorkspaceEntry {
  readonly name: string;
  readonly relativePath: string;
  readonly kind: WorkspaceEntryKind;
  readonly children?: readonly WorkspaceEntry[];
  readonly error?: WorkspaceEntryError;
}

export interface WorkspaceSnapshot {
  readonly rootName: string;
  readonly rootPath: string;
  readonly entries: readonly WorkspaceEntry[];
}

export type OpenWorkspaceResult =
  | { readonly status: 'selected'; readonly workspace: WorkspaceSnapshot }
  | { readonly status: 'cancelled' }
  | { readonly status: 'error'; readonly error: WorkspaceEntryError };

export type RefreshWorkspaceResult =
  | { readonly status: 'refreshed'; readonly workspace: WorkspaceSnapshot }
  | { readonly status: 'not-open' }
  | { readonly status: 'error'; readonly error: WorkspaceEntryError };
```

Contract requirements:

- All cross-process values must be safely copyable by Electron structured clone.
- Do not pass `Error`, `Dirent`, `Stats`, functions, class instances, or Node.js objects.
- `relativePath` is relative to the workspace root and must not be used to trigger new file system reads.
- A root-directory read failure returns a top-level `error`.
- A subdirectory read failure retains the directory node and sets its `error`; it must not fail the entire scan.
- A successfully read empty directory uses empty `children`.
- Files, symbolic links, and other types should not have `children`.

## 6. Main-process implementation requirements

### 6.1 Directory scanner

Separate directory scanning from `src/main/index.ts` into a workspace module with a clear responsibility. Recommended structure:

```text
src/main/
├─ index.ts
└─ workspace/
   ├─ scan-workspace.ts
   └─ workspace-ipc.ts
```

The scanner must:

- Use asynchronous `node:fs/promises` APIs.
- Use `readdir(..., { withFileTypes: true })` or a semantically equivalent approach.
- Recursively read ordinary directories.
- Not follow symbolic links or Windows junctions.
- Return symbolic links as visible leaf nodes.
- Return unknown types as `other` leaf nodes.
- Sort every directory level stably: directories first, other entries afterward, and natural name order within each group.
- Use relative paths as the basis for node identifiers.
- Catch and convert file system errors instead of returning raw exceptions through IPC.
- Preserve sibling entries when one subdirectory cannot be read.
- Neither read file contents nor call write APIs.

Do not build a general dependency-injection container to test the scanner. If a few file system calls need isolation, use simple function parameters, a lightweight adapter, or Vitest mocks.

### 6.2 Folder selection

The main process must use Electron `dialog.showOpenDialog` with at least:

```ts
properties: ['openDirectory'];
```

Requirements:

- Use the current BrowserWindow as the parent where possible.
- Accept only one directory.
- Return `cancelled` when the user cancels; do not throw or clear an existing workspace.
- Update the current main-process workspace root only after selection and scanning succeed.
- Preserve the old workspace if scanning a new one fails, unless the UI explicitly chooses to clear it; preservation is the default for this task.
- Do not record recent workspaces or restore one automatically at startup.

### 6.3 IPC registration

Register only the fixed channels required for this task, for example:

- `workspace:open`
- `workspace:refresh`

Requirements:

- Use `ipcMain.handle` for request/response semantics.
- Handlers do not accept path arguments from the renderer.
- Keep registration logic clearly separate from window creation.
- Avoid registering the same handler twice.
- Catch unexpected errors and convert them to the shared error structure.
- Do not create a general file system router, arbitrary channel proxy, or command dispatcher.

## 7. Preload and renderer boundaries

### 7.1 Preload API

Add narrow interfaces to the existing `DesktopApi`, with these recommended semantics:

```ts
interface DesktopApi {
  readonly runtime: DesktopRuntimeInfo;
  readonly workspace: {
    readonly open: () => Promise<OpenWorkspaceResult>;
    readonly refresh: () => Promise<RefreshWorkspaceResult>;
  };
}
```

Preload may only:

- Call fixed IPC channels for these two methods.
- Expose frozen or read-only APIs.
- Depend on shared types to keep main, preload, and renderer contracts consistent.

Preload must not expose:

- The `ipcRenderer` object.
- A general method such as `invoke(channel, ...args)`.
- Arbitrary file-reading methods.
- Node.js `fs`, `path`, `process`, or Electron objects.
- Interfaces allowing the renderer to specify absolute paths.

### 7.2 React state

React’s built-in state is sufficient for this task; do not introduce Zustand.

The UI must represent at least:

- No workspace open.
- Selecting or scanning.
- A workspace is open.
- The workspace is empty.
- A top-level scan error.
- A local subdirectory read error.
- Refreshing.

While loading, disable buttons that could start duplicate requests. Every asynchronous call must handle success, cancellation, and failure to avoid unhandled Promise rejections.

### 7.3 File tree components

Split the existing placeholder sidebar into small components, for example:

```text
src/renderer/components/workspace/
├─ WorkspaceSidebar.tsx
├─ FileTree.tsx
└─ FileTreeNode.tsx
```

Component requirements:

- Display root workspace information separately from tree nodes.
- Make directory nodes expandable/collapsible through buttons or equivalent accessible controls.
- File nodes display only names and types in this task; they do not read contents.
- Give symbolic links and other types recognizable, simple presentations.
- Display a subdirectory error near its corresponding node.
- Use stable keys, preferably `relativePath`.
- Recursive components only render the existing snapshot and do not call desktop APIs.
- Keep the central editor area as the main visual area.
- Do not implement a formal icon system, theme system, or large CSS rework.

## 8. Testing requirements

Continue using Vitest. React Testing Library, `user-event`, and `jsdom` may be added as needed, but add only the minimum development dependencies actually used by this task’s tests, and commit the lockfile changes.

### 8.1 Scanner tests

Cover at least:

- An empty directory returns an empty entry list.
- Nested directories produce the correct tree and relative paths.
- Directories precede files.
- Natural ordering of names within a type is stable.
- Files are not recursively treated as directories.
- Symbolic links are not recursively followed.
- Subdirectory read failures become node errors while preserving siblings.
- Root-directory read failures become top-level error results or recognizable exceptions.

Creating symbolic links on Windows may require additional privileges. Do not request administrator rights for tests; use mocks or pure-logic tests for directory-entry classification instead.

### 8.2 UI tests

Cover at least:

- The initial state displays “打开文件夹” (Open Folder).
- Canceling selection preserves the old state.
- A successful result displays the root directory and entries.
- An empty directory displays an empty state.
- Directories can expand and collapse.
- Top-level errors display recoverable messages.
- Subdirectory errors do not prevent other nodes from appearing.
- Duplicate-operation entry points are disabled while loading.
- A successful refresh replaces the old snapshot.

Test user-visible behavior rather than extensively asserting component internals or CSS class names.

### 8.3 Manual desktop smoke verification

Automated tests do not replace verification of the Electron desktop flow. After implementation, manually verify at least:

1. Start the development environment.
2. Open a test folder containing multiple nested directories and files.
3. Expand/collapse multiple directory levels.
4. Open an empty folder.
5. Cancel one folder selection.
6. Switch from one workspace to another.
7. Add/delete a file externally, click Refresh, and observe the change.
8. Confirm that clicking an ordinary file neither reads its contents nor opens an editor.
9. Confirm that the developer console has no unhandled exceptions.

## 9. Explicitly out of scope

- Reading/displaying TXT, DOCX, or other file contents.
- Editors, tabs, unsaved state, and saving.
- Creating files, Save As, renaming, moving, or deleting.
- File system watching and automatic refresh.
- Recent workspaces, startup restoration, and `electron-store`.
- Search, filtering, favorites, and document outlines.
- CodeMirror, Tiptap, Mammoth, docx, and JSZip.
- Zustand or other global state libraries.
- Context menus, drag and drop, and a keyboard navigation system.
- Virtual scrolling and lazy loading for large directories.
- Windows installers, automatic updates, and release processes.
- Playwright/Electron end-to-end test facilities.
- AI, Agents, cloud services, and accounts.
- General file system APIs, general IPC, or a plugin system.

Do not add a capability outside Sections 5–8 incidentally, even if it is easy to implement.

## 10. Work packages and execution order

The lower-cost model must implement the following packages in order, taking only one at a time. Do not proceed to the next package if the current package fails acceptance.

### WP0: Baseline confirmation and implementation locations

- Confirm that the branch contains Task 1.
- Run the existing `check` and `build`.
- Read this task, the project baseline, and the Task 1 completion report.
- List the files planned for modification.
- Do not modify product code.

Acceptance gate: baseline results are recorded and task scope is unambiguous.

### WP1: Shared contract and directory scanner

- Add shared workspace types.
- Implement asynchronous recursive scanning.
- Implement directory-first/name sorting.
- Implement rules for symbolic links, unknown types, and local errors.
- Add scanner tests.

Acceptance gate: scanner tests, full `check`, and `build` pass; no Electron IPC or React UI changes are included.

### WP2: Folder selection, main-process state, and IPC

- Implement native folder selection.
- Store the last successfully opened workspace root.
- Register fixed `open` and `refresh` IPC.
- Handle cancellation, top-level errors, and refresh with no open workspace.
- Preserve existing window security policies.

Acceptance gate: handlers accept no path inputs; there is no general IPC; full `check` and `build` pass.

### WP3: Narrow preload interfaces

- Extend `DesktopApi`.
- Map the two fixed IPC channels in preload.
- Update renderer global types.
- Add lightweight contract tests if necessary.

Acceptance gate: the renderer can call only `workspace.open()` and `workspace.refresh()`; full `check` and `build` pass.

### WP4: Workspace sidebar and file tree

- Replace the left sidebar’s placeholder state.
- Implement opening, refreshing, and switching workspaces.
- Implement loading, empty, success, and error states.
- Implement tree-node expansion/collapse.
- Add user-visible behavior tests.

Acceptance gate: component tests, full `check`, and `build` pass; no file contents are read and no global state library is introduced.

### WP5: Overall acceptance and documentation

- Run full automated checks.
- Complete desktop smoke verification.
- Update README instructions for actual user operations.
- Write `docs/tasks/task-002/TASK_002_COMPLETION_REPORT.md`.
- Record dependency changes, verification results, known limitations, and the next-task entry point.

Acceptance gate: the task may be marked complete only when every item in Section 11 is satisfied.

## 11. Final acceptance criteria

Task 2 may be marked complete only when all conditions below are met.

### 11.1 Functional acceptance

- [x] A clear “打开文件夹” (Open Folder) entry point exists when no workspace is open.
- [x] Clicking it opens the native folder picker.
- [x] Canceling selection produces no error and does not clear an existing workspace.
- [x] Successful selection displays the workspace name, path, and directory tree.
- [x] Nested directories expand/collapse.
- [x] Empty directories have an explicit state.
- [x] Directories precede other entries, and name sorting is stable.
- [x] Symbolic links are visible but are not recursively followed.
- [x] Subdirectory read errors appear on their nodes without affecting other entries.
- [x] Top-level read errors do not crash the application.
- [x] Refresh rescans the current workspace.
- [x] Selecting another folder replaces the workspace.
- [x] Clicking a file does not read its contents or open an editor.

### 11.2 Security acceptance

- [x] `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true` remain unchanged.
- [x] The renderer does not directly import Node.js or Electron file system capabilities.
- [x] Preload exposes neither `ipcRenderer` nor a general `invoke`.
- [x] IPC handlers accept no absolute paths from the renderer.
- [x] Only fixed workspace open/refresh capabilities reach the renderer.
- [x] Cross-process results contain no raw `Error` or Node.js objects.
- [x] No user-file write operations exist.

### 11.3 Quality acceptance

- [x] New scanner tests cover the key branches in Section 8.1.
- [x] New UI tests cover the key states in Section 8.2.
- [x] `.\scripts\npm.cmd run typecheck` succeeds.
- [x] `.\scripts\npm.cmd run lint` succeeds with 0 warnings.
- [x] `.\scripts\npm.cmd run format:check` succeeds.
- [x] `.\scripts\npm.cmd test` succeeds.
- [x] `.\scripts\npm.cmd run check` succeeds.
- [x] `.\scripts\npm.cmd run build` succeeds.
- [x] The Electron development window completes manual smoke verification.
- [x] README instructions match actual behavior.
- [x] The completion report accurately records verification results and known limitations.

## 12. Failure handling and decision rules

- If a subdirectory cannot be read, retain its node and error and continue with other entries.
- If scanning the root fails, return a recoverable error and do not update the current workspace.
- If the user cancels folder selection, return normal cancellation and do not log it as an error.
- If a directory is deleted externally during scanning, handle it as a read error without crashing or looping retries.
- Do not follow symbolic-link or junction targets.
- If a test requires administrator privileges, use mocks or pure-logic tests instead; do not elevate privileges.
- If new dependencies conflict, select stable compatible versions rather than using `--force`.
- If implementation requires changing the project security baseline, one-shot snapshot approach, or task scope, stop the affected implementation, explain benefits, risks, complexity, and migration costs, and await the project owner’s decision.
- Do not manufacture passing results by deleting meaningful tests, disabling strict typing, weakening Electron security, or ignoring lint rules.

## 13. Lower-cost model execution prompt template

Use this fixed prompt for each package, replacing only the work-package number and content:

> Read `docs/architecture/PROJECT_BASELINE.md`, `docs/tasks/task-001/TASK_001_COMPLETION_REPORT.md`, `docs/tasks/task-002/TASK_002_WORKSPACE_READONLY.md`, and the source directly related to the current package. Implement only TASK-002 WPx, with no later packages, unrelated refactoring, or out-of-scope features. Strictly preserve Electron security boundaries; expose no general IPC, arbitrary path reads, or file writes. After changes, run the package’s required tests, `.\scripts\npm.cmd run check`, and `.\scripts\npm.cmd run build`. Report modified files, key decisions, command results, unresolved issues, and whether the current package’s gate is satisfied.

Execution rules:

- Complete only one package per conversation.
- Paste the current package’s scope and gate directly into the prompt.
- Do not let the model replan the entire phase itself.
- Review the diff after each package before proceeding.
- After WP2 and WP3, specifically review IPC arguments, error serialization, and preload exposure.
- Only WP5 may write the completion report and change the task status to `Completed`.

## 14. Deliverables

The implementing agent must ultimately deliver:

1. Shared workspace data contracts.
2. An asynchronous read-only main-process directory scanner.
3. Native folder selection and fixed IPC handlers.
4. A controlled preload workspace API.
5. A React workspace sidebar and expandable file tree.
6. Scanner and UI behavior tests.
7. An updated README.
8. `TASK_002_COMPLETION_REPORT.md`, covering at least:
   - Implementation summary.
   - Key new and modified files.
   - Data contracts and security boundaries.
   - New dependencies and reasons for selecting them.
   - Automated checks actually run and their results.
   - Desktop smoke verification record.
   - Known limitations.
   - Whether all acceptance criteria are satisfied.

## 15. Entry point for the next task

After Task 2, the next task is [TASK-003: Controlled UTF-8 TXT reading and a single read-only tab](../task-003/TASK_003_TXT_READONLY.en.md): select a UTF-8 TXT file from the read-only tree, read its contents through new controlled IPC, and display it in a single read-only tab in the central area.

The next task should still not immediately introduce editing/saving, multiple tabs, file watching, or DOCX. First verify the safe flow “file-tree selection → controlled file reading → central-area display”, then incrementally add TXT editing and safe saving.
