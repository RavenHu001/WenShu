# TASK-005 completion report

[简体中文](./TASK_005_COMPLETION_REPORT.md) | English

[Task archives](../README.en.md) · [Documentation center](../../README.en.md)

> Implementation completed: 2026-08-07; final manual acceptance: 2026-08-07; verification platform: Windows 11, Node.js 22.15.0, npm 10.9.2, Electron 37.x.
> WP0–WP6 were implemented and accepted separately. The development Agent completed automated acceptance (typecheck/lint/format:check/all tests/check/build) and development/production desktop smoke checks.
> The project owner performed all Section 8.7 manual UI items and all passed; component tests and Agent smoke checks also verified the automatable portions.

## 1. Implementation summary

WP0 baseline → WP1 pure state → WP2 read controller/tab bar → WP3 per-tab CodeMirror → WP4 per-tab saves/conflicts → WP5 tab/workspace/window protection → WP6 acceptance/documentation established “multiple ordinary workspace TXT selections → unique tab per path → independent read/edit/save/conflict state → tabId-bound delayed confirmation → aggregate unsaved protection”:

```text
Select ordinary workspace UTF-8 TXT files repeatedly
  -> One tab per canonical relative path (unique in loading/loaded/error)
  -> Independent reads (global request number + workspace + target checks)
  -> Independent CodeMirror sessions (cached cursor/selection/scroll/history; rebuild on external replacement)
  -> Save / Ctrl+S targets active only; one save per tab, parallel across tabs
  -> revision conflicts, mixed-ending confirmation, and reload bind to original tabId
  -> Aggregate confirmation and saving guards for dirty close / workspace switch / window close
```

## 2. Key new and modified files

### New files

| File                                                     | Purpose                                                                                                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/lib/text-document-tabs.ts`                 | Pure model: types/Section 5 invariant validator (WP0), open/dedup/activate/edit/target-update/close/invalidate transitions/selectors (WP1), pure transition rules |
| `tests/document/text-document-tabs.test.ts`              | Invariant scaffolding (WP0): 23 cases                                                                                                                             |
| `tests/document/text-document-tabs-transitions.test.ts`  | Pure transitions/invariant preservation (WP1): 32 cases                                                                                                           |
| `src/renderer/lib/use-text-documents.ts`                 | Per-tab read/save/retry/conflict-reload race controller (WP2/WP4)                                                                                                 |
| `src/renderer/lib/use-editor-sessions.ts`                | State/scroll/notification session cache; cleanup on close/invalidation (WP3)                                                                                      |
| `src/renderer/components/document/TabBar.tsx`            | Accessible tablist/tab, aria-selected, named close buttons, full-path title, horizontal scroll (WP2)                                                              |
| `src/renderer/components/document/EditorSessionHost.tsx` | Restore on mount/capture on unmount, rebuild for external replacement, Mod-s (WP3/WP4)                                                                            |
| `docs/tasks/task-005/TASK_005_COMPLETION_REPORT.md`      | This report (WP6)                                                                                                                                                 |

### Modified files

| File                                                                                           | Change                                                                                                                            |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/components/document/DocumentPane.tsx`                                            | TabBar + active body + save toolbar + status/error banners (WP2/WP4)                                                              |
| `src/renderer/App.tsx`                                                                         | Open/activate, aggregate guards, close subscription, tabId-bound close/reload/mixed confirmation, Ctrl+W, saving guards (WP2–WP5) |
| `src/renderer/components/common/ConfirmDialog.tsx`                                             | Optional `cancelLabel` for single-button Wait for Save notices                                                                    |
| `src/renderer/styles/app.css`                                                                  | Scrolling/close-button/toolbar/host styles                                                                                        |
| `tests/document/components.test.tsx`                                                           | 64 read-race/session/save/conflict/tab/workspace/window cases                                                                     |
| `README.md` / `docs/development/TESTING.md` / `docs/tasks/task-005/TASK_005_MULTI_TXT_TABS.md` | Capabilities/acceptance/status synchronization (WP6)                                                                              |

### Deleted files

| File                                              | Reason                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/renderer/lib/use-text-document.ts`           | Replaced by multi-document controller; no duplicate state stores               |
| `src/renderer/components/document/TextEditor.tsx` | Its rebuild-on-content-change behavior loses history; replaced by session host |

## 3. Identity, invariants, and close selection

- **Identity**: canonical tree `relativePath` is stable identity per Section 4.2, with `id === relativePath`. Paths are unique across loading/loaded/error; same-name/different-path files coexist with full `title` hints. Array indices select neighbors on close, never identity.
- **Invariants** from Section 5, all validated by `validateTextDocumentsState` and tested:
  1. Unique `id`/`relativePath` in `tabs`.
  2. Empty `tabs` implies `activeTabId === null`.
  3. Nonempty `tabs` requires an existing active reference.
  4. `saving === true` means one in-flight save, consistent in both directions with runtime `saveInFlight`.
  5. Dirty clears only after matching successful save or explicit discard/reload (`saveCompletionClearsDirty`).
  6. Async commits validate workspace, target, and request (`asyncResultStillValid`).
- **Closing selection**: inactive closing preserves active; active closing prefers right, then left; last close shows Welcome. Saving tabs cannot close, enforced by both pure-state rejection and UI guards.

## 4. CodeMirror session saving and cleanup

- `Map<tabId, EditorSession>` stores `EditorState`, including contents/selection/undo/redo, and the `scrollSnapshot()` effect. On mount, matching cached state/serialized contents/endings restore with scroll dispatch; otherwise disk text creates fresh state/history.
- `EditorState.lineSeparator` and `sliceDoc()` explicitly retain consistent LF/CRLF. Mixed snapshots use the defined dominant representation in-editor, while original metadata still requires confirmation before IPC, preventing the first edit from bypassing normalization notices.
- Switching remounts with `key={tabId}`: capture state/scroll before unmount and restore on mount. Ordinary switches report no content change, create no dirty, and clear no history, as tested.
- External replacement after successful retry/confirmed reload rebuilds only the target when cached text differs.
- Content/Mod-s report through mutable session outlets `notify` / `requestSave`, retaining current callbacks after remount without stale component closures in editor state.
- After close/invalidation, liveTabIds pruning releases absent sessions; DocumentPane unmount clears all.
- Scroll values unreliable in JSDOM are covered by manual acceptance, as declared in Section 8.4.

## 5. Per-tab read/save races

- **Reading**: globally increasing request numbers prevent close/reopen collisions. New paths create loading placeholders and one read; repeated loading clicks do not reread. Retry/conflict reload makes the target noneditable while loading so results cannot overwrite intervening input. Before commit, validate mounted state, workspace epoch, target existence, and newest number. Ignore every stale out-of-order/closed/switched/unmounted result.
- **Saving**: per-tab `saveInFlight` prevents same-tab concurrency without a global lock; A/B each may save once. Capture target, runtime `latestContent`, edit counter, and saved `revision`. Success clears dirty only when counters still match while updating the baseline revision; failures/conflicts/mixed-ending states update only the target.
- **Workspace invalidation**: epoch increment invalidates all unfinished old results. UI blocks every destructive transition while saving; controller epoch guards remain defense in depth and are directly harness-tested.

## 6. Aggregate dirty and confirmation target binding

- `window.setDirtyState` reports `tabs.some(tab => tab.dirty)`; workspace/window messages include the unsaved count.
- Every in-app confirmation—tab close, conflict reload, mixed endings, Wait for Save—carries stable `tabId` or an aggregate count. Confirmation/cancel never reselects the active tab; only one flow is allowed, later requests cannot replace it, and switching leaves its target unchanged. Tests assert only the original tab is saved/reloaded/closed.
- If a target is invalid before confirmation, unknown-tab pure transitions safely do nothing rather than affect others.

## 7. Electron / IPC boundaries

- **No new main-process filesystem capabilities, IPC channels, or preload APIs**: `src/main/`, `src/preload/`, and `src/shared/desktop-api.ts` have zero changes from Task 4; multi-tab support is renderer session behavior.
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` remain; `src/main/index.ts` is unchanged.
- Reuse `workspace.open()` / `workspace.refresh()`, `document.readText()` / `document.saveText()`, and narrow close coordination (`setDirtyState` / `requestClose` / `cancelClose` / `onCloseRequested`).
- Main retains complete Task 4 checks/sanitization; tabs hold only canonical relative paths; multi-tab state/logs/results contain no text, temporary names, or raw exceptions.

## 8. Automated checks actually executed and results

| Command                      | Result                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `typecheck` (5 tsconfig)     | **Passed**                                                                                                  |
| `lint` (--max-warnings=0)    | **Passed**, 0 warnings                                                                                      |
| `format:check`               | **Passed**, Windows checkout with fixed endings                                                             |
| `test` (11 files, 307 cases) | **Passed**: 305 passed / 2 skipped; actual-link privilege conditions, deterministic mock rejection retained |
| `check`                      | **Passed**, exit 0                                                                                          |
| `build`                      | **Passed**, exit 0: main 24.23 kB, preload 1.95 kB, renderer 1,171.75 kB + CSS 11.89 kB                     |

Distribution: runtime 2 · scanner 11 · reader 49 · saver 51 · read/save IPC 33 · preload 13 · window close 8 · workspace components 21 · invariants 23 · transitions 32 · multi-tab components 64. Every package ran full `check` then `build`, never concurrently.

## 9. Windows development/production smoke evidence

| Item                                                          | Result                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development (`.\scripts\dev.cmd`, captured redirected output) | **Passed**: dev server + Electron, 30s alive (4 processes), no preload/React/resource errors                                                                                                                                                                    |
| Production (`npm exec -- electron .`, captured output)        | **Passed**: loaded `out/`, 30s alive (4 processes), empty logs/no errors                                                                                                                                                                                        |
| Section 8.7 manual checklist                                  | **All passed**: owner checked every item on 2026-08-07. Component tests also cover order/dedup/same-name paths/independent edits and dirty/independent saves/nonblocking conflicts/close rules/refresh/no exceptions/no `.wenshu-*` leftovers where automatable |

## 10. Performance observations and known limitations

- The editor uses one view with cached sessions rather than multiple hidden EditorViews, per Section 4.6, with no state reconstruction on switching. `overflow-x: auto` scrolls tabs; no virtualization was added because up to 20 tabs does not require it.
- **Known limitations**:
  1. JSDOM cannot reliably assert scroll values; cache-boundary tests and owner desktop acceptance cover restoration.
  2. Real-link cases conditionally skip for local privileges; lstat mocks deterministically cover rejection.
  3. CodeMirror groups adjacent edits within 500ms into one undo group, its standard behavior; tests use different insertion positions for separate history steps.
  4. Drag-reordering, bulk closing, restoration, and other Section 9 items remain out of scope.

## 11. Satisfaction of all acceptance criteria

TASK-005 Section 11—11.1 (8 functional), 11.2 (8 editing/saving), 11.3 (8 unsaved/lifecycle), 11.4 (6 Electron/security), 11.5 (8 quality)—is fully satisfied and checked. Actual commands passed automated acceptance, the Agent verified both build smoke checks, and the owner executed/passed the entire Section 8.7 list on 2026-08-07.

## 12. Task status and next entry point

**TASK-005 status: Completed.**

The next formal plan is [TASK-006: Workspace TXT search and current-file find/replace](../task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.en.md). It reuses tab opening/activation to locate unique tabs/matches while separately designing main traversal, concurrency, cancellation, result limits, link boundaries, and responsive async protocols. Task 6 still excludes simultaneous DOCX, file management, autosave, and restoration.
