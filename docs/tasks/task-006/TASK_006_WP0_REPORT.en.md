# TASK-006 WP0 report: Lock Task 5 baseline and search semantics

[简体中文](./TASK_006_WP0_REPORT.md) | English

[Task archives](../README.en.md) · [Documentation center](../../README.en.md)

> Package scope: TASK-006 Section 10 WP0: prerequisites, baseline records, semantic review/freeze, and test planning.
> Implemented: 2026-08-08; platform: Windows 11, Node.js 22.15.0, npm 10.9.2, Electron 37.x.
> This package changes no product functionality; this report is its only artifact.

## 1. Prerequisite results (task Section 3)

### 1.1 Required reading (3.1)

Read in full: `README.md`, `docs/architecture/PROJECT_BASELINE.md`, `docs/development/DEVELOPMENT_ENVIRONMENT.md`, `docs/development/TESTING.md`, `docs/tasks/task-005/TASK_005_MULTI_TXT_TABS.md`, `docs/tasks/task-005/TASK_005_COMPLETION_REPORT.md`, `docs/tasks/task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.md`, and all specified source:

- `src/main/index.ts`, `src/main/workspace/scan-workspace.ts`, `workspace-ipc.ts`, `workspace-session.ts`.
- `src/main/document/read-text-document.ts`, `document-ipc.ts`.
- `src/preload/index.ts`.
- `src/shared/desktop-api.ts`, `document.ts`, `workspace.ts`.
- `src/renderer/App.tsx`, `components/workspace/WorkspaceSidebar.tsx`, `components/document/DocumentPane.tsx`, `components/document/EditorSessionHost.tsx`.
- `src/renderer/lib/use-text-documents.ts`, `text-document-tabs.ts`, `use-editor-sessions.ts`.
- Existing tests: `tests/document/` (reader 49, saver 51, IPC 33, invariants 23, transitions 32, components 64), `tests/workspace/` (scanner 11, components 21), `tests/preload/contract.test.ts` (13), `tests/window/window-close.test.ts` (8), `tests/runtime-info.test.ts` (2).

### 1.2 Working tree and quality baseline (3.2)

- `git status --short`: **clean**, no uncommitted user changes to protect.
- Current branch: `TASK-006工作区TXT搜索与当前文件查找替换`; `TASK_005_COMPLETION_REPORT.md` exists, and Task 5 is merged (`5e96885 Merge pull request #5 ...task5多TXT标签页与独立编辑会话`).
- Full `check` then `build` ran sequentially, not concurrently, and both passed with exit 0.

### 1.3 Planning baseline reverified (3.3; fresh measurements)

| Planning assertion                                         | Fresh verification                                                                                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tasks 1–5 complete; main contains Task 5                   | Passed: clean tree and Task 5 merge in history                                                                                                                    |
| Full `check` exits 0                                       | Passed: typecheck (5 tsconfig), lint (--max-warnings=0), format:check, and tests all green                                                                        |
| 11 files, 305 passed, 2 conditional skips                  | Passed: 11 passed, 305 passed / 2 skipped; only real-link privilege cases, with mock rejection coverage                                                           |
| Files/Search/Settings are static placeholders              | Passed: `activityItems` in `App.tsx` uses static `div`, no search entry                                                                                           |
| WorkspaceSidebar owns state internally                     | Passed: `WorkspaceSidebar.tsx` uses internal `useState` for status/workspace/error                                                                                |
| CodeMirror lacks find/replace                              | Passed: `EditorSessionHost.createEditorState` configures only lineSeparator/history/keymap/lineWrapping/updateListener; no `@codemirror/search` in `package.json` |
| `openTextFile` opens/activates uniquely without navigation | Passed: `openTextFile(relativePath)` in `use-text-documents.ts` returns `void`, with no returned tabId/navigation input                                           |
| No preload/main search protocol                            | Passed: `desktop-api.ts` has runtime/workspace/document/window only; no main search module                                                                        |

## 2. Command results (individually verified)

| Command                      | Result                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `typecheck` (5 tsconfig)     | **Passed**                                                                              |
| `lint` (--max-warnings=0)    | **Passed**, 0 warnings                                                                  |
| `format:check`               | **Passed**, Windows checkout with pinned endings                                        |
| `test` (11 files, 307 cases) | **Passed**: 305 passed / 2 skipped, real-link privilege conditions                      |
| `check`                      | **Passed**, exit 0                                                                      |
| `build`                      | **Passed**, exit 0: main 24.23 kB, preload 1.95 kB, renderer 1,171.75 kB + CSS 11.89 kB |

Distribution: runtime 2 · scanner 11 · reader 49 · saver 51 · read/save IPC 33 · preload 13 · window close 8 · workspace components 21 · invariants 23 · transitions 32 · multi-tab components 64. The only expected log was the saver test’s “wenshu: 清理临时文件失败 (EACCES)” (temporary cleanup failed), required by that assertion case. `check`/`build` ran sequentially; `out/` is Git-ignored.

## 3. Key source review conclusions

### 3.1 Workspace state (root source, 4.7)

- `workspace-session.ts` is main’s sole root source: `setCurrentWorkspaceRoot` is called only after `workspace:open` scanning succeeds in `workspace-ipc.ts`; cancellation/failure retains it. `document-ipc.ts` captures the root at read/save start. WP3 search IPC must follow the same pattern, obtaining roots only through `getCurrentWorkspaceRoot()`; requests contain no roots/absolute paths.
- Renderer holds `WorkspaceSnapshot` including display-only `rootPath`, with no root write-back ability. `WorkspaceSidebar` has no epoch; renderer epoch currently lives in `useTextDocuments.epochRef`, incremented by `invalidateWorkspace` after successful switching. Search will reuse those semantics; see frozen item 11.

### 3.2 Controlled TXT reading (candidate reuse, 4.7)

- `readTextDocument` performs all 13 steps: relative format, case-insensitive `.txt`, lexical bounds, per-segment lstat rejecting links/junctions, real bounds, ordinary file, 5 MiB, bounded read, strict UTF-8, BOM removal, and SHA-256 of complete bytes including BOM/original endings.
- `ReadTextAdapters` function injection (`lstat`/`realpath`/`readTextBytes`) can be reused directly for search tests; stable codes such as `NOT_FOUND`/`ACCESS_DENIED`/`TOO_LARGE`/`INVALID_UTF8` classify skips.
- Frozen conclusion: candidates reuse `readTextDocument` or equivalent WP2 primitives, never skip read-time checks because scanning saw the file; mappings remain consistent with the reader.

### 3.3 Multi-tab identity (navigation target, 4.9)

- `id === relativePath` in `text-document-tabs.ts`; loading/loaded/read-error paths remain unique. `openTab` opens or activates, with existing tabs activated without reads; same names/different paths coexist. Stable navigation tabId is the result’s `relativePath`, so open/activation can be reused.
- WP5 gap: `openTextFile` returns no tabId/navigation input, and `EditorSessionHost` has no consumption protocol to prevent repeated focus. These are recorded required WP5 interface changes.

### 3.4 Editor sessions (find/replace host, 4.2)

- `useEditorSessions` caches per-tab `EditorState` (text/selection/undo) plus scrolling; liveTabIds prune on close/invalidation, DocumentPane unmount clears all. Panel/query/selection/history will naturally remain isolated in cached state, providing the foundation for Section 4.2.
- External replacement from retry/conflict reload rebuilds state/history; ordinary switching restores cache. Search is absent; WP6 adds `@codemirror/search` and keymap in `createEditorState`.

### 3.5 Async validity (search/navigation gates, 5.3)

- Reads/saves already use `asyncResultStillValid` for workspace/target/request checks. `mountedRef` protects unmount; epoch increments invalidate unfinished old results.
- Frozen conclusion: search uses mounted + epoch + latest ID + not-canceled checks; navigation adds target/path/latest navigation ID/loaded text/revision/range requirements from 4.9.

## 4. Frozen decisions from task Section 4

These semantics are frozen, including WP0 clarifications; WP1–WP6 must not deviate:

1. **Query**: 1–256 UTF-16 code units, one line; reject empty, `\r`/`\n`, `\0`, nonstrings. `Array.from` is not a valid length measure; use `query.length`.
2. **Matching**: literal + case toggle only, no regex/whole-word; nonoverlapping, increasing `from`; offsets reference complete BOM-stripped text. Positions start at 1; `\r\n`, `\n`, standalone `\r` each count as one boundary, CRLF only once.
3. **Case-insensitive matching**, WP0 decision: ASCII letters only (A–Z ↔ a–z), preserving UTF-16 length and original ranges/text. Non-ASCII folding is outside first-version scope and recorded as a limitation.
4. **Preview**: one line, at most 160 UTF-16 units. Use the entire line if ≤160, otherwise start at `clamp(matchStart - 80, lineStart, lineEnd - 160)`, centering where possible without escaping bounds. `previewMatchFrom/To` reference preview and may clip actual match length; authoritative ranges remain `from/to`. Splitting can cut surrogate pairs/emoji, a display-only limitation.
5. **Shared constants**, `src/shared/search.ts`: query 256, candidates 1000, per-file 200, total 2000, preview 160, concurrency 4. Reasons are `file-limit` / `matches-per-file-limit` / `total-matches-limit`; limits return `truncated: true` plus reason, not silent loss.
6. **Statistics**: `scannedFiles` counts attempted candidate reads; `matchedFiles`, `totalMatches`, `skippedFiles` (unreadable subdirectories + failed candidate reads). Unreadable root is a search error with a stable new code besides `NO_WORKSPACE` and no absolute path; other errors are isolated/skipped.
7. **Requests/cancel**: monotonically increasing nonnegative safe-integer renderer `requestId`, never query identity. One active search per window; new cancels old. Preload only `search.textWorkspace(request)` / `search.cancelTextWorkspace({requestId})`. Main tracks sender + ID; unknown/other-window cancellation is a no-op. In-flight reads may finish but cannot submit canceled results; cancel is not error and partials never become completed.
8. **Paths/traversal**: root only from `workspace-session`; no links/junctions/reparse following; only ordinary case-insensitive `.txt`. Check cancellation/workspace changes while traversing/reading; renderer also validates ID + epoch.
9. **Results**: freeze Section 4.8 shapes (`WorkspaceTextSearchRequest`, `WorkspaceTextSearchMatch`, `WorkspaceTextSearchFileResult`). Add `status` / `requestId` / `files`, naturally ordered like `scan-workspace`’s `Intl.Collator(numeric)` / `statistics` / `truncated` / `truncatedReason` / display error. One group per path; completion order cannot affect final file/match order.
10. **Navigation**: bind navigation ID + epoch + search ID + relative path + revision + from/to + actual text; follow all seven 4.9 rules. Dirty may navigate if the original range still matches live text; otherwise stale-only notice, no nearest-text guessing/overwrite.
11. **Workspace epoch**, WP0 decision: WP3 search controller accepts external workspace availability/epoch only, initially minimal App epoch incremented on successful `onWorkspaceSelected`, with no root ownership. After WP4 `useWorkspace` extraction, one epoch serves documents/search without duplicate increments.
12. **Module locations**: `src/shared/search.ts` for runtime-independent contracts/constants; `src/main/search/match-text.ts` for matcher. WP5 only needs `content.slice(from,to)` comparisons, so renderer does not need matcher/shared placement. WP1 adds `src/main/search/**/*.ts` to `tsconfig.test.json`; tests live in `tests/search/`.
13. **Dependencies**: only WP6 adds direct `@codemirror/search` and records lock changes; no ripgrep/database/Zustand/search service/global state.
14. **Logs/leaks**: no query/matched text/absolute paths/raw exceptions/stacks/Buffer/handles in logs or cross-process returns; previews use React text, never `dangerouslySetInnerHTML`.

## 5. Test-file and directory plan (WP1–WP7)

New directories: `src/main/search/`, `src/renderer/components/search/`, `tests/search/`.

| Package | Planned tests                                                                                                                                                      | Section 8 coverage                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| WP1     | `tests/search/match-text.test.ts`, `tests/search/search-contract.test.ts`                                                                                          | 8.2 query checks/positions/previews/budgets/order/Chinese/emoji/CRLF/long lines/case |
| WP2     | `tests/search/search-text-workspace.test.ts`                                                                                                                       | 8.3 boundaries/links/isolation/1000 limit/concurrency ≤4/cancel phases/no leaks      |
| WP3     | `tests/search/search-ipc.test.ts`; update `tests/preload/contract.test.ts` for narrow search                                                                       | 8.4 IPC/preload/identity; controller races through WP4 components                    |
| WP4     | New jsdom `tests/search/search-sidebar.test.tsx` for activity/empty/results/races/switching; update `tests/workspace/components.test.tsx` for ownership regression | 8.5 sidebar/controller                                                               |
| WP5     | New `tests/search/result-locate.test.tsx` or merge into `tests/document/components.test.tsx`                                                                       | 8.6 open/activate/post-load/stale/dirty/rapid navigation                             |
| WP6     | Update `tests/document/components.test.tsx` for find/replace/undo/dirty/isolation; `tests/preload/contract.test.ts` if needed                                      | 8.6 current-file find/replace                                                        |
| WP7     | No new test files; Section 8.7 manual smoke including nearly-1000-TXT workspace and documentation                                                                  | 8.7                                                                                  |

Matcher/searcher follow existing pure-functions-plus-adapters patterns in `scan-workspace.ts`/`read-text-document.ts`. Inject adapters for deterministic concurrency/cancel/error tests, no DI container. Component files use `// @vitest-environment jsdom`, matching `tests/document/components.test.tsx`.

## 6. Modified files

| File                                         | Change                                                             |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `docs/tasks/task-006/TASK_006_WP0_REPORT.md` | This report, WP0’s only artifact; no product functionality changed |

## 7. Unresolved issues and known limitations

1. **No blocking ambiguity**: task Section 4 and this report’s freeze eliminate all search/navigation ambiguity; no unresolved design questions.
2. **Accepted first-version limitations**, all frozen: no non-ASCII case folding; previews may split surrogate pairs; JSDOM scroll values need Task 5’s boundary-test-plus-manual-acceptance approach.
3. **Later-package gaps**, outside WP0: no `openTextFile` tabId/navigation-return protocol (WP5); unify epoch ownership in WP4 with a minimal App epoch for WP3 (item 11); add `src/main/search/**/*.ts` to `tsconfig.test.json` in WP1.

## 8. Gate conclusion

WP0 gate in task Section 10: **all satisfied**.

- Reproducible Task 5 baseline: 11 files / 305 passed / 2 conditional skips; typecheck/lint/format/full `check`/`build` all exit 0 sequentially; artifacts match Task 5 report.
- No unresolved search/navigation semantics: Section 4 decisions frozen here, including WP0 additions.
- Existing changes identified/protected: `git status --short` clean, no user changes, no WP0 product modifications.
