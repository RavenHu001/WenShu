# TASK-006 completion report

[简体中文](./TASK_006_COMPLETION_REPORT.md) | English

[Task archives](../README.en.md) · [Documentation center](../../README.en.md)

> Implementation completed: 2026-08-08; final manual acceptance: 2026-08-08; review fixes: 2026-08-09; platform: Windows 11, Node.js 22.15.0, npm 10.9.2, Electron 37.x.
> WP0–WP7 were implemented/accepted separately. The development Agent performed typecheck/lint/format/all tests/check/build, both desktop smoke modes, and performance observations.
> The project owner executed and passed all Section 8.7 manual UI items on 2026-08-08; automatable portions also have component/Agent smoke coverage.
> The 2026-08-09 review fixed conversion of CRLF disk offsets into CodeMirror positions and active-search cancellation on unmount/window destruction. New regression cases and full `check`/`build` passed again.

## 1. Implementation summary

WP0 baseline/semantics → WP1 contracts/matcher → WP2 safe main searcher → WP3 IPC/preload/controller → WP4 workspace extraction/activity/sidebar → WP5 open/activate/safe navigation → WP6 current-file find/replace → WP7 acceptance/performance/docs completed the TXT find/search workflow:

```text
Live text in the active TXT
  -> Ctrl+F / Ctrl+H Find and Replace (case, previous/next, current/all replacement)
  -> Replacement enters undo history, marks dirty, and uses explicit safe saving
  -> Per-tab panel, query, selection, and history restore/clean with session cache

Saved ordinary UTF-8 TXT on workspace disk
  -> Search activity / Ctrl+Shift+F opens the sidebar
  -> Controlled async traversal without links; concurrency 4; 1000 candidates / 200 per file / 2000 total
  -> Cooperative cancellation, sender/requestId task management, isolated file errors
  -> Groups with relative paths, 1-based positions, safe previews, revision, statistics
  -> Unique-tab open/activation; after loading, valid revision/range select, scroll, and focus
  -> Every stale case shows only "Search result is out of date", with no incorrect navigation or text change
```

## 2. Key new and modified files

### New files

| File                                                | Purpose                                                                                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/search.ts`                              | Contracts/frozen constants: request/cancel/match/groups/statistics/errors/results; 256/1000/200/2000/160/4; pure runtime validation                   |
| `src/main/search/match-text.ts`                     | Literal/ASCII-only folding, UTF-16 ranges, 1-based positions, 160-unit previews, 200/2000 budgets, natural grouping, cooperative yielding             |
| `src/main/search/search-text-workspace.ts`          | Async safe traversal/candidate budgets/order/concurrency 4; controlled `readTextDocument`; cancel/workspace checks/isolation/statistics               |
| `src/main/search/search-ipc.ts`                     | Fixed `search:text-workspace` / `search:cancel-text-workspace`; webContents id + requestId lifecycle; new cancels old; destroy cancels before cleanup |
| `src/renderer/lib/use-workspace.ts`                 | Shared open/refresh/errors/epoch (+1 on success), serving document invalidation/search                                                                |
| `src/renderer/lib/use-workspace-search.ts`          | Monotonic ID, unique active handle, mounted/epoch/ID late guards, cancellation/invalidation on epoch/unmount                                          |
| `src/renderer/components/search/SearchSidebar.tsx`  | Draft/case/start/cancel/state/statistics/truncation/no-workspace/disk-snapshot explanation                                                            |
| `src/renderer/components/search/SearchResults.tsx`  | Grouped relative paths, line:column positions, safe text highlights, `onMatchActivate`                                                                |
| `docs/tasks/task-006/TASK_006_WP0_REPORT.md`        | Baseline/frozen semantics/test plan                                                                                                                   |
| `docs/tasks/task-006/TASK_006_COMPLETION_REPORT.md` | This report                                                                                                                                           |

### Modified files

| File                                                                                                                                              | Change                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/main/index.ts`                                                                                                                               | Registered search IPC                                                                                                   |
| `src/preload/index.ts` / `src/shared/desktop-api.ts`                                                                                              | Narrow `search.textWorkspace` / `search.cancelTextWorkspace`                                                            |
| `src/renderer/App.tsx`                                                                                                                            | Real Files/Search buttons, Settings placeholder, `Ctrl+Shift+F`, workspace/search/navigation coordination, stale banner |
| `src/renderer/components/workspace/WorkspaceSidebar.tsx`                                                                                          | Pure presentation injected from useWorkspace                                                                            |
| `src/renderer/components/document/EditorSessionHost.tsx`                                                                                          | Search extension/keymap (`Mod-f`/`Mod-h`/`F3`); CRLF-aware selection/scroll/focus and once-only guard                   |
| `src/renderer/components/document/DocumentPane.tsx`                                                                                               | tabId-bound navigation target and stale banner                                                                          |
| `src/renderer/lib/use-text-documents.ts`                                                                                                          | `openTextFile` returns a read-completion Promise; tabId open-waiters settle null on close/invalidation                  |
| `src/renderer/lib/text-document-tabs.ts` / `use-editor-sessions.ts`                                                                               | Comments only, unchanged semantics                                                                                      |
| `src/renderer/styles/app.css`                                                                                                                     | Activity/sidebar/stale-banner styles                                                                                    |
| `package.json` / `package-lock.json`                                                                                                              | Direct `@codemirror/search@^6.7.1`, recommended by 4.2 for panel/commands/per-state queries without global state        |
| `tsconfig.test.json`                                                                                                                              | Included `src/main/search/**/*.ts`                                                                                      |
| `tests/document/read-text-document.test.ts`                                                                                                       | Bounded link probe; timeout means environment unsupported per DEVELOPMENT_ENVIRONMENT.md, no assertions removed         |
| `README.md` / `docs/architecture/PROJECT_BASELINE.md` / `docs/development/TESTING.md` / `docs/tasks/task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.md` | Capabilities/baseline/status synchronization (WP7)                                                                      |

### Test files (8 added, 3 modified)

`tests/search/search-contract.test.ts` (14) · `match-text.test.ts` (42) · `search-text-workspace.test.ts` (25) · `search-ipc.test.ts` (26) · `use-workspace-search.test.tsx` (14) · `search-sidebar.test.tsx` (13) · `result-locate.test.tsx` (12) · `tests/document/find-replace.test.tsx` (9). Modified: `tests/preload/contract.test.ts` (16), `tests/workspace/components.test.tsx` (22), `tests/document/read-text-document.test.ts`.

## 3. Queries, fixed limits, and result model

- Query: one line, 1–256 UTF-16 units; reject empty/newline/`\0`. Literal + ASCII-only case folding preserves length and original ranges/text; nonoverlapping increasing from; `\r\n`/`\n`/standalone `\r` each count as one boundary; positions start at 1.
- Limits: TXT candidates 1000, per-file 200, total 2000, preview 160, concurrent reads 4, query 256. `file-limit` / `matches-per-file-limit` / `total-matches-limit` return `truncated: true` plus reason without silent loss.
- Model: `WorkspaceTextSearchRequest{requestId,query,caseSensitive}`, `Match{from,to,line,column,matchedText,preview,previewMatchFrom/To}`, `FileResult{relativePath,revision,matches,truncated}`, statistics `{scannedFiles,matchedFiles,totalMatches,skippedFiles}`. Final discriminated states are completed/cancelled/error; natural canonical-path order is independent of completion order; matchedFiles/totalMatches reflect returned results.

## 4. Traversal, links, controlled reading, and error isolation

- Roots only from main `workspace-session`, never requests. Capture at handler start; `shouldStop` combines cancellation/root changes.
- No link/junction following: check `isSymbolicLink` before `isDirectory`, intentionally unlike scan-workspace’s directory-first classification. Natural ordering in each directory makes candidate truncation reproducible.
- Only ordinary case-insensitive `.txt`; reuse full `readTextDocument` checks for format/per-segment lstat/real bounds/type/5-MiB/bounded strict-UTF-8/SHA-256, regardless of prior scanning.
- Unreadable root yields overall `SEARCH_FAILED`, fixed path-free message. Subdirectory/file errors NOT_FOUND/ACCESS_DENIED/TOO_LARGE/INVALID_UTF8/NOT_FILE/OUTSIDE_WORKSPACE/UNSUPPORTED_TYPE increment `skippedFiles` and continue.
- Read-only throughout, with no workspace/index/cache/temporary writes.

## 5. Concurrency, cancellation, epoch, and late results

- Bounded concurrency 4, with latch tests proving maxInFlight ≤4. Sort candidates first; final order ignores read completion order.
- Cooperative `shouldStop` checks directory batches/entries/before-after reads/matcher loops (`shouldYield`). Started reads may finish but canceled results never submit; cancel is not error and partials never become completed. Unknown/other-window cancellation safely does nothing.
- Main stores `Map<webContentsId, {requestId, cancelled}>`: one active task per window, new cancels old. `destroyed` marks canceled before clearing; finally releases only its own reference, not a replacement task.
- Renderer requires mounted ∧ unchanged epoch ∧ current ID before commit. Searching owns exactly one ID; other states retain no handle. Successful switching/unmount cancels in-flight requests and invalidates results.
- Navigation additionally requires existing target, same path, latest navigation ID (global newest invalidates older), loaded text, and validated revision/range.

## 6. Revision, dirty, and stale navigation

- Bind navigation ID + epoch + search ID + relative path + revision + from/to + actual text, captured from completed results at click; async completion checks unchanged epoch/latest navigation.
- Open/activate uniquely, waiting for loading. read-error remains errored with notice. Require same disk-baseline revision and live `slice(from,to)===matchedText`, then convert original UTF-16 offsets across CRLF boundaries to CodeMirror positions. Host selects, `EditorView.scrollIntoView`, and focuses once; rerenders do not steal focus.
- Stale cases show a dismissible nondestructive banner: read-error, revision mismatch/external edits, out-of-bounds/text mismatch including dirty-range changes. Dirty unchanged ranges still navigate without clearing dirty.
- Navigation changes only selection: no history step, text change, save, or reload.

## 7. CodeMirror find/replace and per-tab state

- Direct `@codemirror/search` 6.7.1: `search()` + `searchKeymap` + custom `Mod-h` opens the shared find/replace panel and focuses replacement. CodeMirror has no public replace-open command, so only public panel DOM is used.
- Replacements use normal transactions/history. replaceNext requires a query-matching selection; replaceAll is one transaction/undo. Find changes no text/dirty.
- Panel/query/case/current match/selection live in EditorState, isolated by cached tabId. Close/invalidation cleans with sessions; external replacement rebuilds and clears search state.
- Regex/whole-word stay local, outside workspace protocol.

## 8. Electron / IPC boundaries and dependencies

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` unchanged; only two fixed preload search methods, no `ipcRenderer`/general invoke.
- Exact request keys reject roots/absolutePath/glob/encoding/limits/concurrency/channels/extras. Main runs no user regex/shell.
- Cross-process errors contain stable codes/counts/display messages; query/matched text/paths/raw exceptions never enter logs or IPC errors. JSON assertions verify no paths/internal messages.
- Only `@codemirror/search@^6.7.1` added, lockfile updated; no ripgrep/database/Zustand/service.

## 9. Automated checks actually executed and results

| Command                      | Result                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `typecheck` (5 tsconfig)     | **Passed**                                                                               |
| `lint` (--max-warnings=0)    | **Passed**, 0 warnings                                                                   |
| `format:check`               | **Passed**, Windows checkout with pinned endings                                         |
| `test` (19 files, 466 cases) | **Passed**: 463 passed / 3 skipped, actual-link privilege conditions with mock rejection |
| `check`                      | **Passed**, exit 0                                                                       |
| `build`                      | **Passed**, exit 0: main 38.79 kB, preload 2.41 kB, renderer 1,247.71 kB + CSS 19.11 kB  |

Distribution: runtime 2 · scanner 11 · reader 49 · saver 51 · read/save IPC 33 · preload 16 · close 8 · workspace components 22 · invariants 23 · transitions 32 · multi-tab components 64 · search contracts 14 · matcher 42 · searcher 25 · search IPC 26 · search controller 14 · sidebar 13 · navigation 12 · find/replace 9. `check`/`build` were sequential. Expected stderr was saver EACCES cleanup and one deduplicated React 19 `act` development notice in navigation tests, not functional failure.

## 10. Windows development/production smoke evidence

| Item                                                   | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development (`.\scripts\dev.cmd`, redirected capture)  | **Passed**: dev server/Electron alive 30s, 4 processes; main/preload build and “start electron app...” logs, no preload/React/resource errors                                                                                                                                                                                                                                                                                                              |
| Production (`npm exec -- electron .`, captured output) | **Passed**: `out/` loaded, alive 25s, 4 processes, empty/error-free log                                                                                                                                                                                                                                                                                                                                                                                    |
| Section 8.7 manual checklist                           | **All passed** by owner on 2026-08-08: Ctrl+F/H find/replace/save, per-tab search isolation, activity-state preservation, Chinese/English/emoji, empty/cancel/rapid requests/limits, isolated failures, unopened/open/same-name/loading clicks, stale-only external/edit changes, switching during search, nearly-1000-file usability/cancel, no exceptions/leaks, no caches/indexes/temporary files, both builds. Components also cover automatable items |

## 11. Nearly-1,000-file performance observations

A temporary observation script using the real filesystem and production searcher was measured on 2026-08-08 and deleted afterward:

| Scenario                                                | Result                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 200 TXT, 12 lines × 200 files, case-insensitive “world” | **32.8 ms**; scanned 200, hit 167 files, 2000 matches, total-limit truncation                            |
| 1000 TXT: 500 root + 500 nested, same query             | **66.2 ms**; scanned 1000, hit 167, 2000 matches, `truncated: true` with total-matches-limit as designed |
| Cancel flag set 30 ms into a 1000-file search           | Returned `cancelled` within **3 ms**, approximately 33 ms from start                                     |

UI usability: main traversal/reading/matching are asynchronous and bounded, avoiding event-loop blocking. Frequent cooperative checkpoints at directory batches/entries/reads/matching produced immediate measured cancellation. The owner performed all near-1000-file manual UI items under Section 8.7 on 2026-08-08 and all passed.

## 12. Known limitations

1. No non-ASCII case folding, frozen in WP0 to preserve offsets.
2. Preview windows may split surrogate pairs/emoji; display only, authoritative from/to unchanged.
3. Real-link cases conditionally skip for local privileges; lstat/readDir mocks cover rejection deterministically.
4. JSDOM cannot reliably assert scroll values; boundary tests/manual acceptance cover navigation.
5. One React 19 `act` development notice in navigation tests is stderr noise; assertions pass deterministically.
6. Initial performance is a one-off observation, not a benchmark gate. If workspaces grow substantially, measure stages before adjustment, per 4.5.

## 13. Satisfaction of all acceptance criteria

TASK-006 Section 11—11.1 (8 items), 11.2 (7), 11.3 (8), 11.4 (8), 11.5 (8)—is fully met and checked. Actual commands passed automation, the Agent completed both desktop smoke/performance checks, and the owner executed/passed Section 8.7 on 2026-08-08 with component/Agent coverage for automatable portions.

## 14. Task status and next entry point

**TASK-006 status: Completed.**

The next formal plan is [TASK-007: Basic DOCX reading, editing, and safe saving](../task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.en.md). It separately designs import/export intermediate models, supported formatting, compatibility degradation, rolling backups, temporary writes, output validation, and safe replacement, without implicitly expanding file-type privileges through TXT search.
