# TASK-006: Workspace TXT search and current-file find/replace

[简体中文](./TASK_006_TXT_SEARCH_FIND_REPLACE.md) | English

[Task archives](../README.en.md) · [Documentation center](../../README.en.md)

## Task status

- Status: `Completed`
- Priority: `P0`
- Type: `Product vertical slice / workspace search / editor find and replace / asynchronous tasks and navigation`
- Prerequisite: [TASK-005: Multiple TXT tabs and independent editing sessions](../task-005/TASK_005_MULTI_TXT_TABS.en.md)
- Prerequisite report: [TASK-005 completion report](../task-005/TASK_005_COMPLETION_REPORT.en.md)
- Next task: [TASK-007: Basic DOCX reading, editing, and safe saving](../task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.en.md)
- Project baseline: [PROJECT_BASELINE.md](../../architecture/PROJECT_BASELINE.en.md)
- Main execution approach: sequential packages and acceptance; WP0–WP7 all complete, see report.
- Final results after WP0–WP7 and the 2026-08-09 review—19 test files, 463 passing cases, 3 conditional skips, development/production smoke checks, performance observations, and owner manual acceptance—are in the [TASK-006 completion report](./TASK_006_COMPLETION_REPORT.en.md).

## 1. Task purpose

Task 5 established “workspace tree → multiple TXT tabs → independent CodeMirror sessions → safe saving”. This task completes TXT find/search without adding DOCX, workspace replacement, autosave, file management, or restoration:

```text
Live text in the active TXT
  -> Find matches, previous/next
  -> Replace current or all
  -> Normal dirty state, undo history, and explicit saving

Saved ordinary UTF-8 TXT in the current workspace
  -> Controlled main-process async traversal and bounded reads
  -> Per-file positions, previews, revision, and match ranges
  -> Click results to open or activate unique tabs
  -> Select and scroll only while revision and text range remain valid
  -> Stale notice only, without incorrect navigation or overwriting
```

The objective is bounded, cancellable, responsive, workspace-contained TXT search that reliably integrates with multi-tab sessions, not merely a search box.

## 2. User experience after completion

Users should be able to:

1. Open Find with `Ctrl+F` in active TXT and navigate matches.
2. Open Replace with `Ctrl+H` and replace current/all matches.
3. See replacement immediately in text/dirty and undo it.
4. Switch tabs without mixing queries, current matches, selection, or history.
5. Open workspace Search from the activity bar or `Ctrl+Shift+F`.
6. Search saved ordinary UTF-8 `.txt` within the workspace.
7. See progress and cancel; new search invalidates old search automatically.
8. See grouped relative paths, line/column, and single-line context.
9. See scanned/hit-file/match/skipped counts and truncation.
10. Open/activate the unique tab and select/scroll valid result ranges.
11. Receive nondestructive stale-result notices after external changes or edits invalidate ranges.
12. See no old-workspace/old-query late results after switching, canceling, or rapid submissions.

## 3. Pre-execution checks

Complete WP0 and record actual results before product changes.

### 3.1 Required reading

- `README.md`.
- `docs/architecture/PROJECT_BASELINE.md`.
- `docs/development/DEVELOPMENT_ENVIRONMENT.md`.
- `docs/development/TESTING.md`.
- `docs/tasks/task-005/TASK_005_MULTI_TXT_TABS.md`.
- `docs/tasks/task-005/TASK_005_COMPLETION_REPORT.md`.
- `src/main/index.ts`.
- `src/main/workspace/scan-workspace.ts`, `workspace-ipc.ts`, `workspace-session.ts`.
- `src/main/document/read-text-document.ts`, `document-ipc.ts`.
- `src/preload/index.ts`.
- `src/shared/desktop-api.ts`, `document.ts`, `workspace.ts`.
- `src/renderer/App.tsx`.
- `src/renderer/components/workspace/WorkspaceSidebar.tsx`.
- `src/renderer/components/document/DocumentPane.tsx`, `EditorSessionHost.tsx`.
- `src/renderer/lib/use-text-documents.ts`, `text-document-tabs.ts`, `use-editor-sessions.ts`.
- Existing scan/read/preload/multi-tab/session tests.

### 3.2 Working tree and quality baseline

- Inspect `git status --short` and protect user changes.
- Confirm Task 5 is merged with `TASK_005_COMPLETION_REPORT.md` present.
- Run `typecheck`, `lint`, `format:check`, `test`, full `check`, then `build`.
- Never run `check`/`build` concurrently because electron-vite temporary config races with ESLint.
- Record test files/passes/skips/build output/expected logs.
- Do not hide races, leaks, or regressions by deleting tests, weakening assertions, whole-file skips, or longer timeouts.

### 3.3 Confirmed planning baseline

Confirmed on 2026-08-08 in controlled Windows:

- `main` contains Task 5; Tasks 1–5 are complete.
- Full `check` exits `0`.
- 11 files, 305 passing cases, 2 real-link privilege skips; mock rejection remains deterministic.
- Task 5 report records passing build and both desktop smoke modes.
- Files/Search/Settings are still static activity placeholders; `WorkspaceSidebar` owns workspace state.
- CodeMirror has only editing, undo/redo, and Save, with no find/replace.
- `openTextFile` opens/activates unique tabs but has no post-open match navigation protocol.
- No preload search or main search-task/cancel/limit protocol exists.

WP0 must rerun/record the baseline, not merely cite these planning results.

## 4. Fixed product and protocol decisions

### 4.1 Two complementary search surfaces

Implement both:

- **Current-file find/replace**: active editor’s live text, including unsaved edits.
- **Workspace TXT search**: saved ordinary UTF-8 TXT on disk only, without implicitly merging unsaved text.

They share query/match/navigation concepts but have different data sources, permissions, and lifecycles; do not mix them in ambiguous global state.

### 4.2 Current-file boundary

- Use public CodeMirror 6 search extensions/commands; add `@codemirror/search` directly if appropriate.
- `Ctrl+F` opens Find; `Ctrl+H` opens Replace; preserve `Ctrl+S`/`Ctrl+W`.
- Guarantee literal queries, case options, previous/next, replace current/all.
- Regex/whole-word offered by CodeMirror may remain locally, without extending workspace protocol.
- Replace via normal editor transactions/history, never direct React-state mutation.
- No actual text change means no dirty; Replace All should undo as one predictable operation.
- Cached EditorState isolates panel/query/selection/history by tabId on ordinary switching.
- Closing/switching workspaces cleans search with the session.

### 4.3 Workspace source

- Search **saved disk snapshots**, with no promise to include dirty-tab edits.
- Sidebar explicitly explains this so results are not mistaken for a live unsaved index.
- Search triggers no save/autosave/reload/conflict overwrite.
- Files can change afterward; every result carries read-time `revision`.
- No persisted index, workspace writes, or hidden caches.

### 4.4 Initial query semantics

- A single-line query of 1–256 UTF-16 code units; reject empty/newline-only/`\0` values.
- Literal workspace matching with case-sensitive toggle; no user regex.
- Ranges use original UTF-16 offsets consistent with JavaScript/CodeMirror.
- Nonoverlapping matches, increasing start positions; files in natural canonical-relative-path order.
- 1-based line/column; CRLF is one boundary.
- Case-insensitive matching returns actual original ranges/text without folding-induced offset changes.
- Never log query text; render previews as React text, not `dangerouslySetInnerHTML`.

### 4.5 Fixed resource limits

Initial auditable constants:

| Item                           |                 Limit |
| ------------------------------ | --------------------: |
| Query length                   | 256 UTF-16 code units |
| Candidate TXT files per search |                  1000 |
| One TXT file                   |  Existing 5 MiB limit |
| Matches per file               |                   200 |
| Total returned matches         |                  2000 |
| Preview length                 | 160 UTF-16 code units |
| Concurrent file reads          |                     4 |

- At file/per-file-match/total-match limits, return `truncated` and explicit reasons; no silent loss.
- No premature database, inverted index, worker thread, or resident service for 1,000 files.
- If main-loop/memory performance fails, record scale/timing/bottlenecks before adjustment.

### 4.6 Requests and cancellation

- Renderer assigns monotonically increasing `requestId`; query text is not identity.
- At most one active workspace search per window; new search cancels old first.
- Preload exposes fixed start/cancel only, no `ipcRenderer`, arbitrary channels, or event bus.
- Main tracks sender window + `requestId`; canceling another window/unknown request is a safe no-op.
- Cancellation is cooperative: an already-started controlled read may finish, but cannot submit its result afterward.
- Check cancel/workspace changes between directory batches, before/after reads, and inside matching loops.
- Renderer checks both ID and workspace epoch, not main cancellation alone.
- Window destruction, successful workspace switch, and unmount clear active references.

### 4.7 Workspace/path security

- Roots come only from main `workspace-session`; requests carry no roots/absolute paths.
- Traverse only current workspace, following no links/junctions/other reparse points.
- Ordinary case-insensitive `.txt` candidates only.
- Reuse `readTextDocument` or equivalent controlled primitives: relative-path/per-segment `lstat`/realpath/ordinary-file/5-MiB/strict-UTF-8/BOM/revision checks.
- Seeing a file during scanning does not waive read-time revalidation.
- Unreadable root fails search; subdirectory/file permission, invalid UTF-8, oversized/missing files are isolated and counted as skipped.
- IPC errors contain stable codes, display messages, counts only; no absolute paths, raw exceptions, stacks, Buffer, or handles.

### 4.8 Result model and grouping

Suggested minimum contract:

```ts
interface WorkspaceTextSearchRequest {
  readonly requestId: number;
  readonly query: string;
  readonly caseSensitive: boolean;
}

interface WorkspaceTextSearchMatch {
  readonly from: number;
  readonly to: number;
  readonly line: number;
  readonly column: number;
  readonly matchedText: string;
  readonly preview: string;
  readonly previewMatchFrom: number;
  readonly previewMatchTo: number;
}

interface WorkspaceTextSearchFileResult {
  readonly relativePath: string;
  readonly revision: string;
  readonly matches: readonly WorkspaceTextSearchMatch[];
  readonly truncated: boolean;
}
```

Final results also include `status`, `requestId`, groups, scanned/hit/skipped statistics, total matches, and truncation reasons. Names may change in WP1, but:

- Requests carry no roots, absolute paths, or contents.
- Canonical relative paths are the only file identity.
- Match ranges reference complete file text.
- Preview ranges reference `preview` itself.
- Requests/responses are read-only, serializable, runtime-validatable data.

### 4.9 Result navigation and staleness

Create a stable navigation request binding at least:

- Unique navigation ID.
- Workspace epoch.
- Search `requestId`.
- Canonical relative path.
- File `revision`.
- `from` / `to`.
- Actual matched text.

Fixed navigation rules:

1. Open/activate through the multi-document controller; one tabId per path remains.
2. Wait for a loading tab; no duplicate tab.
3. Require a successful snapshot whose disk-baseline revision equals the result, then validate live text range.
4. If `tab.content.slice(from, to)` matches actual result text, select/scroll/focus.
5. Revision mismatch/out-of-bounds/text mismatch only activates the tab and shows a nondestructive stale notice.
6. `read-error` retains error state, never fake navigation success.
7. Close/switch/new navigation/unmount invalidates old requests.

Dirty tabs are not categorically rejected: exact live-range matches may navigate. Otherwise never guess the nearest identical text.

### 4.10 Sidebar state ownership

- Separate workspace state from sidebar presentation, preferably `useWorkspace` owned by `App`.
- Files/Search share snapshot/open/refresh state; activity switching loses neither workspace nor expanded tree.
- Files/Search become real buttons with active/focus/`aria-pressed` or equivalent semantics.
- Settings remains an unavailable placeholder; no settings system.
- No-workspace Search shows an empty state without IPC.
- Successful workspace switching clears results; canceled/failed opening preserves workspace/search.

### 4.11 Dependencies and state management

- May add direct `@codemirror/search`; record lock changes/rationale.
- No ripgrep binary, database, service, Zustand, or global state library.
- Keep matcher/validation/grouping/navigation checks as testable pure functions where possible.
- Hooks coordinate async work, components render, main searches files; no traversal/Node APIs in renderer.

## 5. State model and invariants

### 5.1 Workspace search state

Suggested states:

```ts
type WorkspaceSearchStatus = 'idle' | 'searching' | 'completed' | 'cancelled' | 'error';
```

Store current input, submitted query, case option, active requestId, results/statistics/display error. Changed input is not a completed result, preventing mismatched result headings.

### 5.2 Required invariants

1. Searching has exactly one active requestId; other states retain no active task handle.
2. Results commit only when both ID and epoch match.
3. Canceled/switched/unmounted old results cannot restore searching or overwrite new results.
4. Result paths/revisions/ranges remain immutable throughout their lifetime.
5. One group per relative path.
6. File/match order is deterministic, independent of completion order.
7. Counts agree with results/skips/truncation semantics.
8. Navigation binds one result/stable tabId, never reselecting the active result on async completion.
9. Local replacement changes only the target, not others’ text/dirty/selection/search.
10. Workspace search never writes, clears dirty, saves, or reloads.

### 5.3 Async commit conditions

Before committing search, require all:

- Still mounted.
- Unchanged workspace epoch.
- ID still current.
- Not canceled.
- Returned ID matches requested ID.

Before navigation, also require:

- Target exists.
- Same relative path.
- Navigation ID is the target’s current request.
- Editable text has loaded.
- Revision/range pass Section 4.9.

## 6. Suggested modules and responsibilities

### 6.1 Shared contracts

Add `src/shared/search.ts`:

- Request/cancel/match/group/statistics/result unions.
- Stable errors/truncation reasons.
- Cross-process resource constants.
- No Electron/Node.js/React imports.

### 6.2 Pure matcher

Add `src/main/search/match-text.ts` or a directly testable pure main module:

- Literal sensitive/insensitive matching.
- UTF-16 ranges, 1-based positions, single-line previews.
- Per-file/total budgets.
- CRLF, Chinese, emoji, long lines, boundaries.
- No filesystem reads/cancellation-controller ownership.

If renderer navigation also needs it, move it to runtime-independent `src/shared/`.

### 6.3 Main searcher

Add `src/main/search/search-text-workspace.ts`:

- Async traversal from main’s current root.
- No link/junction following.
- Ordinary TXT and 1,000-candidate budget.
- Fixed read concurrency.
- Controlled reading/revisions reused.
- Isolated subdirectory/file failures.
- Stable sorted groups/statistics.
- Cancel/workspace checks at key boundaries.

Use lightweight adapters/function parameters to test concurrency/errors/cancellation, not a DI container.

### 6.4 IPC and preload

Add `src/main/search/search-ipc.ts` and extend:

- `src/main/index.ts`: fixed registration.
- `src/preload/index.ts`: fixed start/cancel mappings.
- `src/shared/desktop-api.ts`: narrow API.

Runtime-check object type, exact keys, requestId, query, booleans; extras return stable invalid requests.

### 6.5 Workspace controller

Extract open/refresh/snapshot/errors to `src/renderer/lib/use-workspace.ts`:

- Sidebar still renders the tree.
- App switches Files/Search.
- Search controller depends only on workspace presence/epoch, not absolute root.
- Preserve Task 2/5 cancel/failure/refresh/switch semantics.

### 6.6 Search controller/components

Suggested additions:

- `src/renderer/lib/use-workspace-search.ts`: identities/cancellation/late results/counts/errors.
- `src/renderer/components/search/SearchSidebar.tsx`: input/options/state/results container.
- `src/renderer/components/search/SearchResults.tsx`: groups/match buttons/accessibility.

Components use no Node APIs and never parse paths/positions/ranges from display strings.

### 6.7 Editor find/navigation

Extend `EditorSessionHost`/`DocumentPane`:

- Search extensions/keymap in each EditorState.
- Public testable navigation input.
- CodeMirror transaction selection plus `EditorView.scrollIntoView`.
- Consume success so rerenders do not repeatedly steal focus.
- External text replacement still rebuilds/history-clears; ordinary switching restores.
- No private CodeMirror DOM manipulation.

## 7. Electron and security boundaries

### 7.1 Minimal new interfaces

Suggested renderer API:

```ts
readonly search: {
  readonly textWorkspace: (
    request: WorkspaceTextSearchRequest,
  ) => Promise<WorkspaceTextSearchResult>;
  readonly cancelTextWorkspace: (
    request: WorkspaceTextSearchCancelRequest,
  ) => Promise<void>;
};
```

Naming may change, but use fixed use cases/arguments/results, never general `invoke(channel, payload)`.

### 7.2 Required safety properties

- Retain `nodeIntegration: false`, `contextIsolation: true`, sandbox.
- No renderer Node.js/Electron/filesystem/worker_threads imports.
- Requests accept no root/absolute path/glob/arbitrary extension/command/script/encoding/read limit.
- Cancel refers only to the current window’s known requestId, not generic tasks.
- Main executes no user regex/shell commands.
- Only read-only APIs; no create/modify/delete/rename.
- Old-root results cannot enter a new workspace.
- Never log queries/matched text/absolute paths/full contents.
- IPC contains no Node objects/raw exceptions/internal absolute paths.

## 8. Testing requirements

### 8.1 Tasks 1–5 regression

- Execute all 11 files.
- Do not reduce read path/link/size/UTF-8/BOM/endings/revision tests.
- Do not reduce safe-save/conflict/replacement/protection tests.
- Do not reduce identity/read-save-race/session/window tests.
- Only real-link privilege conditional skips remain, with mock rejection.

### 8.2 Contracts and pure matching

Cover at least:

- Exact keys/types/extras/requestId/query length/illegal characters.
- Empty/no/single/multiple/nonoverlapping matches.
- Sensitive/insensitive.
- Chinese/emoji/combining characters/CRLF/LF/empty/long lines.
- Consistent positions/full ranges/preview ranges/actual text.
- Per-file 200/total 2000 and reasons.
- Stable sorting across inputs/concurrent completion.

### 8.3 Traversal, safety, cancellation

Cover at least:

- No workspace/unreadable root/empty workspace.
- Root/nested TXT, mixed-case extensions.
- Skip non-TXT/directories/links/junctions/other types.
- Isolated subdirectory permissions.
- Isolated disappearing/denied/nonordinary/oversized/invalid-UTF-8 files.
- Every candidate rechecks realpath/workspace.
- 1,000-candidate limit.
- At most 4 reads.
- Cancel before search/during traversal/read/match and repeat cancellation.
- New search cancels old; switch invalidates; destroy cleans.
- Canceled/late tasks never mark partial results completed.
- No path/raw-exception/content-log leaks.

### 8.4 IPC/preload

Cover at least:

- Fixed channels/methods/return types.
- Renderer cannot choose roots/absolute paths/limits/concurrency/channels.
- Reject nonobjects/arrays/extras/wrong types.
- Cancel only same-sender known requestId.
- Stable serializable unexpected-error conversion.
- No `ipcRenderer`, general invoke/send/on, or Node objects.

### 8.5 Sidebar/controller

Cover at least:

- Activity activation/keyboard/accessibility.
- No-workspace empty state without IPC.
- Search button/`Ctrl+Shift+F` open Search.
- Separate input/submitted query.
- loading/completed/cancelled/error/empty/truncated.
- Correct groups/paths/positions/previews/statistics.
- New/cancel/switch/unmount invalidates old results.
- Activity switching preserves workspace/tabs/tree.
- Canceled/failed opening preserves valid search; success clears.

### 8.6 Current find/replace and navigation

Cover at least:

- `Ctrl+F`, `Ctrl+H`, previous/next, current/all replacement.
- Find changes neither text nor dirty.
- Replacement changes target only, dirty/undo/explicit save work.
- Isolated per-tab search/selection/history.
- Close/switch cleans search sessions.
- Unopened result creates one loading tab and navigates after reading.
- Open result activates without reread/duplication.
- Loading/read-error/late closed results/rapid multiple clicks.
- Matching revision/range selects/scrolls/focuses.
- Changed revision/dirty range/out-of-bounds/text mismatch gives stale notice without selection.
- Dirty with unchanged range can navigate without clearing dirty.
- Navigation changes no text/revision/dirty/saving/history.

### 8.7 Manual desktop smoke verification

Prepare at least:

- Multiple UTF-8 TXT in root/nested folders.
- Same names/different paths.
- Chinese/emoji/LF/CRLF/empty/long lines.
- Empty TXT/non-TXT/non-UTF-8/over-5-MiB/links/unreadable directories/files.
- A nearly 1,000-small-TXT performance workspace.

Verify in order:

1. Active `Ctrl+F`/`Ctrl+H`, replace/undo/dirty/save.
2. Per-tab search preserved.
3. Activity switching retains workspace/tabs.
4. Chinese/English/emoji positions/previews.
5. No-results/cancel/rapid submissions/limits.
6. Per-file failure does not block others; skip counts shown.
7. Unopened/open/same-name/loading result clicks.
8. External change after search yields stale-only notice.
9. Edits changing a range prevent incorrect navigation.
10. Switch during search; old results never appear.
11. Nearly 1,000 files remain interactive and cancel promptly.
12. No unhandled exceptions or query/match/path/handle logs.
13. No new caches/indexes/temporary files.
14. Both development/production verify the same key paths.

## 9. Explicitly out of scope

- DOCX/Markdown/PDF/other search, reading, editing.
- Workspace/multi-file replacement or writing from results.
- Workspace regex/whole-word/fuzzy/pinyin/advanced filters.
- Persistent indexes/SQLite/inverted indexes/ripgrep/resident services.
- Merging unsaved dirty text into workspace search.
- Autosave/Save All/blur/timed saving.
- New/Save As/rename/move/delete/reveal.
- Watching/automatic refresh/background indexing.
- Recent workspaces/persisted tabs/startup/search-history restoration.
- Tab dragging/pinning/splits/bulk close.
- Word count/cursor status/themes/editor settings.
- General type handlers/plugins/global bus/filesystem API.

## 10. Work packages and execution order

One package at a time; do not proceed while its gate fails.

### WP0: Lock Task 5 baseline/search semantics

- Complete Section 3.
- Record `check`, `build`, counts/skips.
- Review workspace/reads/identity/sessions/async validity.
- Freeze Section 4 query/disk/budgets/cancel/stale rules.
- Plan tests/directories; no product code.

Gate: reproducible baseline; no unresolved search/navigation semantics; user changes identified/protected.

### WP1: Shared contracts and matcher

- Add request/cancel/result/statistics/error/truncation types.
- Pure runtime validation.
- Literal matching/positions/previews/budgets.
- Section 8.2 tests.
- No IPC/real reads/UI.

Gate: no dangerous paths/arbitrary powers; deterministic ranges/counts; full `check`/`build` pass.

### WP2: Safe main searcher

- Async traversal/budgets/stable sorting.
- Reuse controlled read/UTF-8/size/revision.
- Bounded concurrency 4.
- Error isolation/cancel/workspace checks/truncation counts.
- Section 8.3 tests.
- No renderer exposure yet.

Gate: no escape/link following/writes; deterministic cancel/concurrency; full `check`/`build` pass.

### WP3: IPC/preload/search controller

- Register fixed start/cancel.
- Extend controlled DesktopApi/preload.
- Main lifecycle by sender/requestId.
- Renderer controller/epoch/late protection.
- Section 8.4/controller-race tests.

Gate: no renderer root/arbitrary powers; cancel/old results safe; full `check`/`build` pass.

### WP4: Workspace extraction/activity/Search sidebar

- Shared controller preserving open/cancel/failure/refresh/switch.
- Accessible Files/Search buttons.
- Input/case/start/cancel/state/stats/groups.
- `Ctrl+Shift+F`.
- Section 8.5 tests.

Gate: no tree/workspace regression; all states render; switching loses nothing; full `check`/`build` pass.

### WP5: Open/activate/safely navigate results

- Extend opening to return/bind stable tabId.
- Navigation identity/defer until loaded.
- Public CodeMirror selection/scroll/focus.
- Revision/range/actual-text validation.
- Stale notice/lifecycle cleanup.
- Section 8.6 navigation tests.

Gate: open/activate → validate → navigate works; stale cases never misnavigate/change text; full `check`/`build` pass.

### WP6: Current-file find/replace

- Add/configure direct search dependency.
- Find/replace/shortcuts/styles.
- Isolate per-tab search/history/save semantics.
- Section 8.6 local tests.
- Regress Task 4/5 sessions/shortcuts.

Gate: find never dirties; replace/undo/dirty/save consistent; no contamination; full `check`/`build` pass.

### WP7: Acceptance/performance/documentation

- All checks.
- Development then production smoke.
- Record search/cancel/UI behavior in ordinary/nearly-1,000-TXT workspaces.
- Update README/baseline/testing/structure.
- Mark Task 6 complete in Roadmap.
- Add `TASK_006_COMPLETION_REPORT.md` with protocol/budgets/traversal/cancel/navigation/staleness/tests/performance/limits.
- Mark `Completed`/check criteria only after all Section 11 passes.

Gate: documents match behavior; checks/build/smoke pass; verifiable report evidence.

## 11. Final acceptance criteria

All following conditions are met; Task 6 was marked complete on 2026-08-08, see [completion report](./TASK_006_COMPLETION_REPORT.en.md).

### 11.1 Current-file find/replace

- [x] `Ctrl+F` opens active Find and previous/next.
- [x] `Ctrl+H` opens Replace current/all.
- [x] Find changes no text/dirty.
- [x] Replace uses transactions, dirties, and undoes.
- [x] Replaced text uses existing explicit safe saving.
- [x] Per-tab query/current match/selection/history isolation.
- [x] Ordinary switching retains search; close/workspace switch cleans.
- [x] No regression in `Ctrl+S`/`Ctrl+W`/undo/redo/session restoration.

### 11.2 Workspace search

- [x] Activity Search/`Ctrl+Shift+F` opens sidebar.
- [x] No-workspace empty state without IPC.
- [x] Search saved ordinary UTF-8 workspace TXT.
- [x] Groups with paths/1-based positions/safe previews.
- [x] Clear case/no-result/error/cancel/truncation.
- [x] Accurate scanned/hit/matched/skipped counts.
- [x] Verified 1,000 files/200 per file/2,000 total limits.
- [x] Isolated directory/file failures.

### 11.3 Navigation and async behavior

- [x] Unique-tab open/activation.
- [x] Navigation waits for loading.
- [x] Valid range selection/scroll/focus.
- [x] Dirty unchanged ranges navigate without clearing dirty.
- [x] Invalid revision/range/text only reports stale; no wrong selection/changes.
- [x] New cancels old; user cancellation works.
- [x] Switch/close/destroy/unmount invalidates search/navigation.
- [x] Completion order does not change final sorting.

### 11.4 Electron, safety, performance

- [x] Root only from main session, no request roots/absolute paths.
- [x] No links/junctions followed; controlled candidate revalidation.
- [x] No user regex/shell/arbitrary filesystem execution.
- [x] Narrow fixed preload start/cancel only.
- [x] `nodeIntegration: false`, `contextIsolation: true`, sandbox retained.
- [x] Read-only: no indexes/caches/temp files/workspace writes.
- [x] No query/matched-text/path/raw-exception logs/IPC errors.
- [x] Nearly 1,000 TXT remains responsive with timely cancellation.

### 11.5 Quality

- [x] Section 8 contract/matcher/traversal/cancel/IPC/UI/editor/navigation coverage complete.
- [x] Existing Tasks 1–5 actually run/pass.
- [x] Only explained environmental conditional skips with mocks.
- [x] `typecheck`, `lint`, `format:check`, `test`, full `check` pass.
- [x] `build` passes.
- [x] Both desktop smoke modes complete.
- [x] README/baseline/testing/task/report match behavior.
- [x] No Section 9 exclusions added.

## 12. Failure handling and decisions

- No workspace means no searcher or stable `NO_WORKSPACE`, never renderer-root fallback.
- Invalid requests fail without guessing/truncating/repairing dangerous fields.
- Empty queries blocked by UI and rejected by IPC.
- Root failure ends search; subdirectory/file failures skip/continue.
- At limits, return valid partial results with explicit truncation; no unbounded accumulation.
- Cancel is not error; never label canceled partials completed.
- Safely ignore old results after new requests/workspaces.
- Concurrent workers release task references/text after completion/cancel/error.
- Stale results do not automatically reload dirty tabs, guess positions, overwrite, or save.
- Failed/no-match local replacements preserve text/dirty/history.
- If public CodeMirror APIs cannot retain search/navigate reliably, document limits/use a minimal wrapper, not private DOM.
- Before expanding IPC/absolute paths/workspace writes/5-MiB/UTF-8 boundaries, stop and write a design note.
- For reproducible near-1,000-file issues, measure traversal/read/match/serialization/render stages before indexing.
- Do not delete tests/weaken Electron/disable strict checks/expand timeouts to pass.

## 13. Execution prompt template

Use this fixed prompt per package, replacing its number/content:

> Read `README.md`, `docs/architecture/PROJECT_BASELINE.md`, `docs/development/DEVELOPMENT_ENVIRONMENT.md`, `docs/development/TESTING.md`, `docs/tasks/task-005/TASK_005_COMPLETION_REPORT.md`, `docs/tasks/task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.md`, and relevant source. Implement only TASK-006 WPx: no later packages/unrelated refactoring/DOCX/workspace replacement/autosave/file management/restoration/persistent indexing. Workspace search reads only saved ordinary UTF-8 TXT; roots come only from main sessions. Follow fixed traversal/read/concurrency/cancel/limit/error rules. Bind all async search/navigation to requestId, workspace epoch, relativePath, revision, and stable tabId; stale results only notify, never misnavigate/overwrite. Run package tests/full `check`/`build`; report files/decisions/results/issues/gates.

Execution rules:

- One package per conversation.
- Read directly relevant files/tests; no repeated unrelated dependency scans.
- Preserve user changes.
- Review diff and retain auditable Git recovery points per package.
- WP0 changes no functionality.
- After WP1 review ranges/positions/previews/budgets.
- After WP2 review boundaries/links/concurrency/cancel/isolation.
- After WP3 review IPC/identity/late results.
- After WP4 review workspace ownership/sidebar regression.
- After WP5 review revision/dirty/staleness.
- After WP6 review replace/undo/dirty/save/sessions.
- Only WP7 writes completion/checks criteria/marks `Completed`.

## 14. Deliverables

Deliver:

1. Shared request/cancel/match/statistics/error/truncation contracts.
2. Pure literal matcher/UTF-16 ranges/positions/safe previews.
3. Safe async traversal/bounded reads/concurrency/cancel/error isolation.
4. Fixed start/cancel IPC and preload.
5. Renderer search controller/late protection.
6. Files/Search activity/sidebar/groups/statistics UI.
7. Unique-tab result open/activation and revision-safe navigation.
8. CodeMirror local find/replace/per-tab sessions.
9. Contract/matcher/traversal/safety/cancel/IPC/UI/editor/navigation tests.
10. Updated README/baseline/testing/structure.
11. `TASK_006_COMPLETION_REPORT.md`, recording:
    - Summary.
    - Key new/modified files.
    - Queries/budgets/result model.
    - Traversal/links/controlled reads/error isolation.
    - Concurrency/cancel/epoch/late results.
    - Revisions/dirty/stale rules.
    - CodeMirror/per-tab strategy.
    - Electron/IPC/dependencies.
    - Actual checks/results.
    - Windows development/production smoke.
    - Nearly-1,000-file performance.
    - Limitations/all-criteria status.

## 15. Entry point for the next task

Next is [TASK-007: Basic DOCX reading, editing, and safe saving](../task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.en.md). It separately designs import/export intermediate models, supported formatting, degradation, rolling backups, temporary writes, output validation, and safe replacement; TXT search must not implicitly expand file-type privileges.

Do not add DOCX product capability in parallel before Task 6 completes. Verify the full multi-document editing/current-find/workspace-search/navigation loop before new file types.
