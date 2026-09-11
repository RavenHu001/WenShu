# TASK-005: Multiple TXT tabs and independent editing sessions

[简体中文](./TASK_005_MULTI_TXT_TABS.md) | English

[Task archives](../README.en.md) · [Documentation center](../../README.en.md)

## Task status

- Status: `Completed`
- Priority: `P0`
- Type: `Product vertical slice / multi-document state / editor sessions / unsaved protection`
- Prerequisite: [TASK-004: Basic single-TXT editing and safe saving](../task-004/TASK_004_TXT_EDIT_SAFE_SAVE.en.md)
- Prerequisite report: [TASK-004 completion report](../task-004/TASK_004_COMPLETION_REPORT.en.md)
- Completion report: [TASK-005 completion report](./TASK_005_COMPLETION_REPORT.en.md)
- Immediate next task: [TASK-006: Workspace TXT search and current-file find/replace](../task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.en.md)
- Project baseline: [PROJECT_BASELINE.md](../../architecture/PROJECT_BASELINE.en.md)
- Main execution approach: sequential work packages with individual acceptance; WP0–WP6 all complete, as recorded in the report

## 1. Task purpose

Task 4 established “workspace tree → controlled TXT read → CodeMirror editing → revision conflict detection → safe saving” for one document. Without changing main-process file privileges or introducing search, autosave, file management, or DOCX, this task extends that state into reliable multi-tab sessions:

```text
Open multiple ordinary workspace UTF-8 TXT files from the tree
  -> One tab per canonical relative path
  -> Independent read, text, revision, dirty, saving, error, and conflict state
  -> Switching retains CodeMirror cursor, selection, scrolling, and undo history
  -> Explicitly save the current tab through existing controlled APIs
  -> Protect all unsaved text on tab close, workspace switch, or window close
```

The goal is a multi-document foundation capable of later supporting search, DOCX, and restoration, while preserving Task 4 data safety and Electron boundaries—not merely a row of tabs.

## 2. User experience after completion

Users should be able to:

1. Open multiple UTF-8 `.txt` files consecutively, each in a tab.
2. Switch by clicking tabs without extra disk reads or noticeable delay.
3. Activate an existing tab when reopening its file, without duplication.
4. Edit independently; text, unsaved markers, save state, errors, and conflicts do not contaminate other tabs.
5. Retain each cursor, selection, scroll position, and undo/redo history across switches.
6. Save the active tab with Save or `Ctrl+S`.
7. Save different tabs in parallel without concurrent saves of one tab.
8. Close ordinary tabs, with Discard Changes / Cancel before closing unsaved ones.
9. Use `Ctrl+W` through the same protected active-tab close flow.
10. Activate a deterministically chosen neighbor after closing the active tab, or return to Welcome after the last tab.
11. Receive aggregate protection for all unsaved tabs when switching workspaces or closing the window.
12. Continue editing/saving other tabs when one encounters read/save failure or conflict.

## 3. Pre-execution checks

Complete WP0 and record actual results before product changes.

### 3.1 Required reading

- `README.md`.
- `docs/architecture/PROJECT_BASELINE.md`.
- `docs/development/DEVELOPMENT_ENVIRONMENT.md`.
- `docs/development/TESTING.md`.
- `docs/tasks/task-004/TASK_004_TXT_EDIT_SAFE_SAVE.md`.
- `docs/tasks/task-004/TASK_004_COMPLETION_REPORT.md`.
- `src/renderer/App.tsx`.
- `src/renderer/lib/use-text-document.ts`.
- `src/renderer/components/document/DocumentPane.tsx`.
- `src/renderer/components/document/TextEditor.tsx`.
- `src/renderer/components/workspace/WorkspaceSidebar.tsx`.
- `src/shared/document.ts` and `src/shared/desktop-api.ts`.
- Existing document/workspace/window-close tests.

### 3.2 Working tree and quality baseline

- Inspect `git status --short` and protect user changes.
- Confirm Task 4 is merged and the baseline commit includes `TASK_004_COMPLETION_REPORT.md`.
- Run `typecheck`, `lint`, `format:check`, `test`, `check`, and `build` in order.
- Never run `check`/`build` concurrently: electron-vite temporary configuration can race with ESLint scanning.
- Record test-file/pass/conditional-skip counts, build output, and expected logs.
- Do not mistake Task 4 environment limits for regressions or hide new problems by deleting tests, whole-file skips, or longer timeouts.

### 3.3 Confirmed baseline

Confirmed on 2026-08-06 in the controlled Windows environment:

- `main` contains Task 4; the tree is clean and matches `origin/main`.
- `check` exits `0`.
- 9 test files passed, with 224 passing cases and 2 actual-link cases conditionally skipped for local privileges.
- `build` exits `0`.
- Task 4 TXT reading, safe saving, conflicts, and the narrow window-close protocol form the regression baseline.

Final results after WP0–WP6—11 test files, 305 passing cases, development/production smoke checks and owner manual acceptance—are in the [TASK-005 completion report](./TASK_005_COMPLETION_REPORT.en.md).

## 4. Fixed design decisions

### 4.1 Multiple TXT tabs within one workspace

- Still support only one workspace root.
- Create tabs only for currently supported ordinary UTF-8 `.txt` files.
- Tabs hold canonical relative paths, no workspace roots/arbitrary absolute paths.
- Successful switching invalidates all old tabs/runtime sessions.
- No cross-workspace tabs, recent files, or persisted restoration.

### 4.2 Tab identity and deduplication

- Within a workspace session, use tree-provided, canonically normalized `relativePath` as stable identity.
- A path has only one tab whether loading, loaded, or errored.
- Reselecting an open path only activates it: no reread, text reset, error clearing, or undo reset.
- Same-name files at different paths coexist. Expose full paths in tooltips/accessibility names; optionally show a shortest parent suffix visually.
- Array indices are not identities.

### 4.3 Order, activation, and closing

- Append new tabs and activate immediately.
- Clicking tabs only changes activation; no discard confirmation.
- Closing an inactive tab preserves the active one.
- Closing active selects the right neighbor first, otherwise the left.
- Closing the last tab shows Welcome and clears document tree highlight.
- Support horizontal scrolling. The baseline recommends up to 20 simultaneous tabs; no complex eviction/virtualization.
- Drag-reordering, pinning, bulk closing, groups, and split views are out of scope.

### 4.4 Independent state per tab

Each tab independently maintains at least:

- `id` / `relativePath`.
- `name`.
- `status`.
- Last successful read/save `document` snapshot.
- Current `content`.
- `dirty`.
- `saving`.
- Last read/save `error`.
- Edit revision, read request number, and save context.
- CodeMirror session state.

States include at least:

- `loading`.
- `loaded-clean`.
- `loaded-dirty`.
- `saving`.
- `save-error`.
- `conflict`.
- `read-error`.

No tabs is an empty top-level collection; do not create a fake Welcome document.

### 4.5 State-management boundary

- Centralize collection/activation in a controller/hook instead of making `App.tsx` handle arrays, races, and rendering together.
- Prefer pure TypeScript transitions or a React reducer so opening, activation, editing, save completion, closing, and invalidation can be unit-tested.
- `EditorView`, `EditorState`, Promises, functions, and timers never enter shared IPC/persistence data.
- No Zustand/global state library by default. Only if actual implementation proves React state unmaintainable, document the issue, benefits, and migration costs for the owner’s decision.
- Do not prebuild a general document framework for future DOCX/plugins.

### 4.6 CodeMirror session isolation

- Each tab owns independent state; switching never transfers undo history.
- Restore cursor, selection, scrolling, and undo/redo when returning.
- Prefer a renderer-only nonserializable cache such as `Map<tabId, EditorState>` in `TextEditor` or a dedicated host; save on exit and restore on entry.
- Avoid simultaneously mounting/hiding up to 20 complete `EditorView` instances, which wastes DOM/memory for large files.
- Initial load, confirmed conflict reload, or explicit disk-content replacement creates fresh state/history for that tab.
- Ordinary switching must not recreate editor state.
- Closing/switching workspaces releases caches, unreachable editors, and closures.

### 4.7 Reads, failed opening, and races

- Create/activate a unique loading tab for a new path before `document.readText(relativePath)`.
- Initial failure retains a closable `read-error` tab with stable error/retry; other tabs remain intact.
- Failed rereads of loaded tabs retain text, dirty, saved snapshot, and show nonblocking errors.
- Read requests are numbered independently per tab; A/B results commit only to their own tabs.
- Ignore late results after close/workspace switch/newer request.
- Ordinary activation never reads; only explicit Retry or conflict Reload starts another read.

### 4.8 Saves and concurrency

- Save/`Ctrl+S` default to the active tab only.
- Clean tabs invoke no save IPC.
- One in-flight save maximum per tab.
- Different tabs may each save once concurrently; no global save lock.
- Capture target tab, text, edit counter, and saved `revision`.
- Clear dirty only if the current edit counter equals the captured value; preserve new edits during saving.
- Success updates only the target snapshot/revision, without changing other tabs or activation.
- Failure, IPC rejection, and `CONFLICT` affect only the target and retain text/dirty.
- Delayed mixed-ending confirmation/conflict reload binds to the originating `tabId`, never the newly active tab.
- No Save All, autosave, force overwrite, Save As, or save queue.

### 4.9 Unsaved and in-progress-save protection

- Switching/opening another TXT no longer asks to discard because the original tab remains.
- Closing dirty tabs uses in-app Discard Changes / Cancel bound to the requested tab, not whatever is active at confirmation time.
- Clean closes without confirmation.
- `Ctrl+W` and Close use one entry point.
- Workspace switching with any dirty tabs uses aggregate confirmation including the count; clear only after actual success, preserving everything on cancel/picker failure.
- Report `tabs.some(tab => tab.dirty)` through `window.setDirtyState()`; main still stores only a boolean.
- Window close shows the unsaved count; confirmed discard calls existing `requestClose()`, cancel calls `cancelClose()`.
- A saving tab cannot close or be discarded with workspace/window transitions. Cancel the transition and ask users to wait; do not describe an already-started disk write as retractable discard.
- Keep Discard Changes / Cancel; no Save and Close or multi-document save orchestration.

### 4.10 Refresh and external changes

- Refresh closes no tabs, rereads no text, and clears no dirty/errors/history.
- Missing files after refresh retain tabs; later save/explicit reread returns stable main-process errors.
- Tree highlight follows the active canonical-path tab, including error tabs.
- No watching, automatic refresh, or background conflict notifications.

## 5. Suggested renderer data model

These types specify semantics; names need not be copied literally:

```ts
type TextTabStatus =
  'loading' | 'loaded-clean' | 'loaded-dirty' | 'saving' | 'save-error' | 'conflict' | 'read-error';

interface TextDocumentTabState {
  readonly id: string;
  readonly relativePath: string;
  readonly name: string;
  readonly status: TextTabStatus;
  readonly document: TextDocumentSnapshot | null;
  readonly content: string;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly error: TextDocumentError | SaveTextDocumentError | null;
}

interface TextDocumentsUiState {
  readonly tabs: readonly TextDocumentTabState[];
  readonly activeTabId: string | null;
}
```

Separate runtime race metadata from renderable state:

```ts
interface TextTabRuntime {
  editRevision: number;
  readRequestId: number;
  saveInFlight: boolean;
  latestContent: string;
}
```

Fixed invariants:

1. `id` and `relativePath` are unique in `tabs`.
2. Empty `tabs` implies `activeTabId === null`.
3. Nonempty `tabs` requires `activeTabId` to reference an existing tab.
4. `saving === true` means that tab exists with exactly one in-flight save.
5. Dirty clears only through success matching the current edit counter or explicit discard/reload.
6. Before committing any async result, verify workspace session, target tab, and request number are still valid.

## 6. Suggested component/file responsibilities

### 6.1 Multi-document controller

Rework/replace `use-text-document.ts`, for example:

- `use-text-documents.ts`: async reads/saves, runtime references, UI commands.
- `text-document-tabs.ts`: optional pure transitions, reducer, selectors, invariants.
- Delete, rename, or retain a thin compatibility layer for `use-text-document.ts`; never maintain two actual state stores.

Expose at least:

- `openTextFile(relativePath)`.
- `activateTab(tabId)`.
- `editTab(tabId, content)`.
- `saveTab(tabId, options?)`.
- `retryRead(tabId)`.
- `reloadTab(tabId)`.
- State needed by `requestCloseTab(tabId)`.
- `closeTab(tabId)`.
- `invalidateWorkspace()`.
- `hasDirtyTabs`, `dirtyTabCount`, `hasSavingTabs` selectors.

### 6.2 Tab bar

Add a separate tab bar rather than accumulating all tab/body branches in `DocumentPane`:

- Focusable, keyboard-activatable tab controls.
- `aria-selected` or equivalent active semantics.
- Close-button accessible names include filenames.
- Dirty is accompanied by accessible text, not only a marker.
- Full relative path discoverable via `title` or equivalent.
- Horizontal overflow must not squeeze/cover the Save toolbar.

### 6.3 Document pane and editor host

- `DocumentPane` renders only the active tab or Welcome.
- Tab bar/body share the same `activeTabId` snapshot to prevent mismatched labels/text.
- Save state, errors, reload, and mixed-ending confirmation derive from the target tab.
- Encapsulate session caches in the host and clean on close/invalidation.
- `App.tsx` coordinates pages/dialogs, not document transitions directly.

### 6.4 Confirmation targets

Pending confirmation carries a stable target:

```ts
type PendingDocumentAction =
  | { readonly kind: 'close-tab'; readonly tabId: string }
  | { readonly kind: 'switch-workspace'; readonly dirtyTabCount: number }
  | { readonly kind: 'reload'; readonly tabId: string }
  | { readonly kind: 'close-window'; readonly dirtyTabCount: number }
  | { readonly kind: 'mixed-line-endings'; readonly tabId: string };
```

- Confirmation/cancellation must not query the current tab again to choose targets.
- Closed targets/invalid workspaces make confirmation a safe no-op.
- Only one in-app confirmation at a time; later requests cannot overwrite pending targets.
- Switching while a dialog is open never changes its target.

## 7. Main process, preload, and security

### 7.1 No new desktop capability by default

Reuse:

- `workspace.open()`.
- `workspace.refresh()`.
- `document.readText(relativePath)`.
- `document.saveText(request)`.
- `window.setDirtyState(dirty)`.
- `window.requestClose()`.
- `window.cancelClose()`.
- `window.onCloseRequested(callback)`.

Multi-tab support is renderer session functionality and normally needs no new filesystem API, IPC channel, or preload method.

### 7.2 Required safety properties

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- No direct renderer Node.js/Electron/filesystem imports.
- No exposed `ipcRenderer`, general `invoke/send/on`, dynamic channels, or arbitrary paths.
- Saves retain Task 4 workspace/relative-path/per-segment-link/realpath/ordinary-file/size/UTF-8/revision/safe-replacement checks.
- Tab state must not carry/log absolute roots, body logs, temporary names, handles, or raw exceptions.
- One tab’s error must not crash the window or lose other state.

If main/preload/contracts truly need changes, first record the reason, minimal interface, risks, and tests in the current package. Renderer convenience never justifies expanded desktop privileges.

## 8. Testing requirements

### 8.1 Task 4 regression

- Actually execute existing reader 49, saver 51, document IPC 33, preload 13, and close 8 tests.
- Execute all scanner/workspace/runtime/Task 4 document component tests.
- Do not weaken revision/BOM/LF/CRLF/mixed-confirmation/conflict/replacement semantics.
- Conditional skips only for previously explained actual-link privilege cases.

### 8.2 Pure state and invariants

Cover at least:

- First/new appended tabs and activation.
- Path deduplication including loading/error.
- Same names at different paths.
- Inactive closing.
- Active closing: right, else left, else Welcome.
- Unknown tabId operations safely do nothing.
- dirty/saving/error/conflict update only targets.
- Workspace invalidation clears all tabs/runtime metadata together.
- Every transition preserves Section 5 invariants.

### 8.3 Read/open races

Cover at least:

- A/B open concurrently, B returns first, both enter their proper tabs.
- Rapid repeated opening of one path reads once.
- Ignore reads arriving after close.
- Ignore old reads after switching workspaces.
- Initial failure makes an independent error tab without affecting others.
- Retry success turns that tab editable in place.
- Failed loaded-tab reread preserves text/dirty.

### 8.4 Editor sessions

Cover at least:

- A/B contents are independent.
- Build history in A, edit B, return to A; undo affects only A.
- Switching restores cursor/selection.
- External replacement rebuilds only the target state.
- Closing cleans cache; reopening creates fresh disk state.
- Workspace switching clears all caches.
- Switching itself triggers no `onContentChange`, edit-counter increment, or dirty.

For CodeMirror scroll details that JSDOM cannot reliably assert, combine testable cache boundaries with manual desktop acceptance. Do not fake passes using fragile internal DOM selectors.

### 8.5 Saves and conflicts

Cover at least:

- Save/`Ctrl+S` targets only active.
- Clean invokes no save IPC.
- Same-tab duplicate saves suppressed.
- A/B each may have one in-flight save.
- A’s result never changes B’s text/state/revision.
- New A edits during save remain dirty after old success.
- After switching to B, A’s completion commits to A without stealing activation.
- Failure/conflict affect only target.
- Mixed-ending confirmation remains bound to original tab after switching.
- Conflict reload remains bound to original tab.
- Late saves after workspace invalidation do not update the new session.

### 8.6 Closing and workspaces

Cover at least:

- Clean closes directly.
- Dirty close discard/cancel branches.
- Closing an inactive dirty tab keeps the correct target despite activation changes.
- `Ctrl+W` equals Close.
- Last close returns Welcome.
- Multiple dirty tabs cause aggregate workspace confirmation.
- Cancel opens no picker; confirmed action followed by picker cancellation retains all tabs.
- Only successful switching clears tabs.
- `window.setDirtyState` equals aggregate dirty.
- Window confirmation includes unsaved count.
- Saving safely blocks tab/workspace/window destructive transitions.
- Invalidated confirmation targets do not close other tabs.

### 8.7 Manual desktop smoke verification

Verify in both development and production:

1. Open three TXT files from different folders; order matches clicks.
2. Repeated selection only activates existing tabs.
3. Distinguish same-name/different-path files by path hints.
4. Type different text in three tabs; text/dirty remain correct while switching.
5. Independent cursor/selection/scroll/history.
6. Saving one preserves others’ unsaved markers.
7. While saving A, edit B; both final states correct.
8. Externally change A; A conflicts while B saves normally.
9. clean/dirty/saving close behavior matches rules.
10. Verify workspace/window confirmation/cancel with multiple dirty tabs.
11. Tree refresh preserves tabs.
12. Open nearly 20 TXT files; tab bar scrolls and switches promptly.
13. No unhandled errors or text/absolute-path/temporary-name logs.
14. No `.wenshu-*` leftovers.

## 9. Explicitly out of scope

- Workspace TXT/DOCX full-text search.
- Current-file find/replace.
- Autosave, blur/timed save, and Save All.
- New files, Save As, rename, move, delete, reveal in Explorer.
- Drag-reordering, pinning, bulk closing, groups, splits, preview tabs.
- Recent files/workspaces, persisted tabs, startup restoration.
- Watching, automatic refresh, background external-change notices.
- DOCX, Markdown, PDF, or other types.
- Word counts, cursor-position status, editor settings.
- Force overwrite, history versions, backups.
- General document plugins, global event bus, general filesystem API.
- Premature Zustand/other state libraries for future features.

## 10. Work packages and execution order

One package at a time; do not proceed while its gate fails.

### WP0: Lock Task 4 baseline and invariants

- Complete Section 3 checks.
- Record `check`, `build`, counts/skips.
- Review single-document state, CodeMirror lifecycle, close protocol, and workspace guard.
- Turn Section 5 invariants into pure-test scaffolding.
- No product-feature changes.

Gate: reproducible baseline; evidenced known issues; no unresolved identity/activation/closing/race rules.

### WP1: Pure multi-tab state

- Establish array, active tab, selectors.
- Implement opening placeholders, deduplication, activation, target updates, closing, invalidation.
- Deterministic adjacent selection.
- Unit-test every invariant/transition.
- No real IPC/full UI yet.

Gate: Section 8.2 covered; no index identity/cross-tab contamination; full `check`/`build` pass.

### WP2: Read controller and basic tab bar

- Rework single-document hook into multi-document controller.
- Per-tab reads/deduplication/errors/retry/late-result protection.
- Accessible tab bar, activation, close buttons.
- Tree becomes Open or Activate; current dirty no longer blocks new tabs.
- Highlight follows active.
- Add read-race/basic component tests.

Gate: multiple read-only-state tabs open/deduplicate/switch/close; stale reads safe; full `check`/`build` pass.

### WP3: Per-tab CodeMirror sessions

- Cache state by tabId.
- Save/restore cursor, selection, scroll, undo.
- Commit edits precisely to targets.
- Define creation/reuse/destruction for initial read, switching, rereading, closing.
- Add session tests/memory cleanup checks.

Gate: Section 8.4 passes; switches create no dirty/history loss; no retained closed/invalid sessions; full `check`/`build` pass.

### WP4: Per-tab saving, conflicts, delayed confirmation

- Migrate Task 4 save races into per-tab runtimes.
- Parallel across tabs, never within one.
- Target-only saving/failure/conflict/revision updates.
- Stable-tabId mixed-ending/reload confirmation.
- Add Section 8.5 tests without changing safe-save protocol.

Gate: no cross-tab contamination; late results/switches safe; Task 4 safety regression passes; full `check`/`build` pass.

### WP5: Closing, workspace, and window protection

- Close buttons/`Ctrl+W`.
- Dirty close confirmation/neighbor selection.
- Aggregate workspace dirty confirmation.
- Aggregate window dirty state/count.
- Block destructive transitions involving saving tabs.
- Clean stale confirmations/runtime refs/session caches.
- Add Section 8.6 tests.

Gate: no silent unsaved loss; stable confirmation targets; minimal window IPC; full `check`/`build` pass.

### WP6: Overall acceptance and documentation

- Run all checks.
- Verify development then production desktop smoke.
- Update README/testing/structure capabilities.
- Mark Task 5 complete in Roadmap; retain workspace search as separate [TASK-006](../task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.en.md).
- Add `TASK_005_COMPLETION_REPORT.md` recording state/cache/races/results/limitations/next task.
- Mark `Completed` and check criteria only after all Section 11 passes.

Gate: documents match behavior; checks/both builds accepted; verifiable report evidence.

## 11. Final acceptance criteria

Task 5 completes only when every condition is met.

### 11.1 Functional acceptance

- [x] Multiple UTF-8 TXT tabs open/switch.
- [x] No duplicate paths; same names/different paths coexist.
- [x] Append/activate/neighbor-after-close rules hold.
- [x] Last close returns Welcome.
- [x] Tree highlight follows active.
- [x] Nearly 20 tabs scroll without noticeable lag.
- [x] Accessible titles/full paths/active/dirty/close semantics.
- [x] `Ctrl+W` and Close share a flow.

### 11.2 Editing and saving

- [x] Per-tab contents/dirty/saving/error/conflict/revision.
- [x] Independent cursor/selection/scroll/undo/redo.
- [x] Ordinary switching reads no disk, creates no dirty, clears no history.
- [x] Save/`Ctrl+S` saves active only.
- [x] Same-tab concurrency forbidden; independent saves allowed.
- [x] New edits/switching/out-of-order completion never incorrectly clear dirty.
- [x] Failure/conflict/mixed confirmation/reload affect target only.
- [x] Task 4 BOM/endings/revision/size/replacement unchanged.

### 11.3 Unsaved state and lifecycle

- [x] Opening/switching tabs no longer asks to discard.
- [x] Dirty closing confirms; cancel preserves all state.
- [x] Clean closes directly.
- [x] Workspace switching protects all dirty tabs.
- [x] Window closing protects all dirty tabs.
- [x] Saving tabs cannot be closed/discarded before write outcome.
- [x] Late results after close/switch/unmount safely ignored.
- [x] Stale confirmations affect neither other tabs nor new workspaces.

### 11.4 Electron and security

- [x] No new main filesystem capabilities, IPC, or preload API by default.
- [x] `nodeIntegration: false`, `contextIsolation: true`, sandbox retained.
- [x] Renderer has no direct Node.js/Electron/filesystem privileges.
- [x] Tabs hold canonical relatives, no roots/arbitrary absolute paths.
- [x] Read/save retains full Task 4 checks/error sanitization.
- [x] Multi-tab state/logs/results do not leak text, temporary names, or raw exceptions.

### 11.5 Quality

- [x] Section 8 pure-state/read-race/session/save/close tests complete.
- [x] Existing Task 1–4 tests actually execute/pass.
- [x] Conditional skips only explained environmental cases with mocks.
- [x] `typecheck`, `lint`, `format:check`, `test`, full `check` pass.
- [x] `build` passes.
- [x] Development/production desktop checklist completed.
- [x] README/testing/task/report match behavior.
- [x] No Section 9 excluded features added.

## 12. Failure handling and decisions

- Safely ignore async results/confirmations for missing or closed tabIds.
- Duplicate paths activate existing tabs without merging text or creating sessions.
- Reject broken active-tab invariants in pure state, rather than guessing repairs in components.
- Read failure affects only target: panel without snapshot, retained text/banner with snapshot.
- Save failure never clears text, dirty, or saved revision.
- One conflict does not block other editing/saving.
- Delayed confirmation retains original tabId after switching; invalid target is a no-op.
- Block destructive transitions for saving tabs; do not claim an ongoing replacement can be canceled.
- If public CodeMirror APIs cannot restore view state reliably, document it and use a minimal wrapper, not private fields/internal DOM.
- If twenty 5-MiB tabs produce reproducible performance issues, measure memory/switch times before changing caches; no premature virtualization/workers.
- If Task 4 IPC/safety must change, stop the package and write a design note before owner confirmation permits expanded privileges.

## 13. Execution prompt template

Use this prompt per package, replacing its number/content:

> Read `README.md`, `docs/architecture/PROJECT_BASELINE.md`, `docs/development/DEVELOPMENT_ENVIRONMENT.md`, `docs/development/TESTING.md`, `docs/tasks/task-004/TASK_004_COMPLETION_REPORT.md`, `docs/tasks/task-005/TASK_005_MULTI_TXT_TABS.md`, and relevant source. Implement only TASK-005 WPx, no later packages/unrelated refactoring/search/autosave/file management/restoration/DOCX. Reuse Task 4 controlled reads/safe saves/revision conflicts/narrow close protocol. All async operations/dialogs bind stable tabId, never the active tab at confirmation time. Run package tests, full `check`/`build`; report files, decisions, results, issues, and gate status.

Execution rules:

- One package per conversation.
- Read relevant files/tests first; do not repeatedly scan unrelated dependencies.
- Preserve user changes.
- Do not weaken assertions, delete tests, skip whole files, disable security, or expand IPC to pass.
- Keep an auditable Git recovery point after each package.
- Do not mark complete before WP6.

## 14. Deliverables

Deliver:

1. TXT tab collection, active tab, selectors, pure invariants.
2. Per-tab read/edit/save/error/conflict controller.
3. Accessible horizontally scrolling tab bar.
4. Independent CodeMirror session cache/cleanup.
5. Stable-tabId close/reload/mixed-ending confirmations.
6. Aggregate workspace/window unsaved protection.
7. Pure-state/race/component/session/save/lifecycle tests.
8. Updated README/testing/structure.
9. `TASK_005_COMPLETION_REPORT.md`, recording:
   - Implementation summary.
   - Key new/modified files.
   - Identity/invariants/close-selection rules.
   - Session saving/cleanup.
   - Per-tab read/save races.
   - Aggregate dirty/target binding.
   - Whether Electron/IPC changed.
   - Actual checks/results.
   - Windows development/production evidence.
   - Performance observations/limitations.
   - Whether all criteria pass.

## 15. Entry point for the next task

The next planned task is [TASK-006: Workspace TXT search and current-file find/replace](../task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.en.md). It reuses opening/activation so result clicks locate unique tabs/matches, separately designing main traversal, concurrency limits, cancellation, result budgets, link boundaries, and responsive asynchronous protocols.

It still should not simultaneously add DOCX, file management, autosave, or restoration. Complete multi-document TXT find/search before adding file types.
