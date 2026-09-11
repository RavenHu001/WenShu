# TASK-010 Completion Report: Find and Replace in the Current DOCX

[简体中文](./TASK_010_COMPLETION_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Implementation dates: 2026-08-19/20 (WP0-WP7 implemented and accepted individually); validation
> platform: Windows 11 (zh-CN, build 10.0.26200), Node.js 22.15.0, npm 10.9.2, Electron 37.10.3,
> TypeScript 5.9.3, Vitest 3.2.7, Tiptap 3.29.2 (@tiptap/core / @tiptap/pm / @tiptap/starter-kit).
> Automated acceptance (typecheck/lint/format:check/all tests/check/build), development and
> production-build launch smoke tests, and WP6 performance/leak observations were completed by
> the development Agent. The owner performed and passed manual UI acceptance in task section 8
> and Windows manual smoke testing, confirming “手动测试已通过，测试手动跑了一遍没有报错”
> (manual testing passed; a manual run produced no errors).

## 1. Implementation summary

“Find and replace in the current DOCX” was delivered in work-package order: WP0 baseline,
editor transactions, and resource semantics → WP1 pure search, text blocks, and position mapping
→ WP2 ProseMirror plugin, decorations, and per-tab controller → WP3 search sidebar, shortcuts,
and active-editor integration → WP4 replace current, replace all, and model prevalidation →
WP5 compatibility, editing during save, path migration, and cross-feature regressions → WP6
performance observations, Windows smoke tests, and risk resolution → WP7 overall acceptance,
documentation, and completion report:

```text
Active DOCX (live Tiptap/ProseMirror document)
  -> Install current-search plugin once per editor (PluginKey + DecorationSet + generation scheduling)
  -> Live textblock projection (reuse joinDocxTextBlocks) → UTF-16 literal matches (≤2000, truncate at 2001+)
  -> Ordinary/current match dual-class highlights; F3/Shift+F3, Enter/Shift+Enter cyclic navigation; Escape closes and restores focus
  -> Replace current: execution-time rescan/revalidation + starting-character marks inheritance
  -> Replace all: ≤2000 matches, reverse-order single transaction; tiptapJsonToDocxModel + serialization-budget validation before dispatch
  -> Existing editDocxTab / dirty / editRevision / save workflow (revision conflicts, rolling backup, safe replacement)
  -> Defined read-only / degraded confirmation / saving / save-error / conflict / read-error / path-migration lifecycle
```

## 2. Key added and modified files

### Added files (product code)

| File                                                                  | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/lib/docx-current-search.ts` (WP1)                       | Pure-function layer: query/replacement validation (nonempty, ≤4096 UTF-16, single line), literal + ASCII case folding, non-overlapping bounded matching, 2000/2001 budget and truncation, live textblock projection (reusing `joinDocxTextBlocks`), projection range → PM position mapping, initial current-index selection, cycling, and nearest-match selection                                                                                                                |
| `src/renderer/lib/docx-current-search-plugin.ts` (WP2/WP4)            | ProseMirror current-search plugin (PluginKey, plugin state, DecorationSet, single microtask scheduling + generation-based stale-computation rejection, destruction cleanup) and narrow controller per stable tabId (snapshot subscription, open/close/setQuery/setReplacement/setCaseSensitive/selectNext/Previous, replaceCurrent/replaceAll, focusEditor); replacement transaction construction (start-character marks, reverse-order single transaction, model prevalidation) |
| `src/renderer/components/search/DocxCurrentSearchPanel.tsx` (WP3/WP4) | DOCX find/replace panel: controlled query/replacement inputs, case option, previous/next/close buttons, count/truncation/input errors/operation feedback, read-only/degraded disabled reasons, Enter/Shift+Enter/F3/Shift+F3/Escape, and focus restoration; uses only narrow controls, never Editor/EditorView                                                                                                                                                                   |

### Modified files (product code)

| File                                                         | Change                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/components/document/DocxEditorSessionHost.tsx` | Installs search plugin/controller once per tab (bound to stable tabId), registers narrow controls, Ctrl+F/Ctrl+H/F3/Shift+F3 shortcuts, derives replace permission (editable + non-degraded or confirmation bound to current revision), and synchronizes it to the controller      |
| `src/renderer/components/document/DocumentPane.tsx`          | Keeps DOCX hosts mounted (inactive ones hidden), maintains per-tab search-controls registry, and atomically supplies active controls to App (cleanup on switch/mount/unmount)                                                                                                      |
| `src/renderer/components/search/SearchSidebar.tsx`           | Dispatches by active kind: TXT keeps the CodeMirror panel host; DOCX renders `DocxCurrentSearchPanel`; only the active kind's panel is shown at any time                                                                                                                           |
| `src/renderer/App.tsx`                                       | Ctrl+F/Ctrl+H requests switch to the search sidebar and focus the field (including supplementary window-level shortcuts for read-only state), active DOCX controls state, replacement availability/reason derivation, and separation of locating/mutationEpoch from current search |
| `src/renderer/styles/app.css`                                | Minimal styling: ordinary/current match classes, find/replace form, counts, errors, truncation, disabled reasons, and visible focus                                                                                                                                                |

### Added test files

| File                                                            | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/docx/docx-current-search-assumptions.test.tsx` (WP0)     | Minimal Tiptap/ProseMirror verification (22 cases): projection consistency, ranges spanning marks, UTF-16 (Chinese/emoji/combining characters), Decoration, measured replacement marks, reverse-order single transaction, model-budget failure, read-only/degraded/saving semantics, performance observations                                                                                                                                      |
| `tests/docx/docx-current-search.test.ts` (WP1)                  | Pure module (23 cases): input validation, literal/case/non-overlap/truncation, projection and PM mapping, headings/lists/Chinese/emoji, cycling/nearest match, 2000/2001 (including exactly 2000 followed by a nonmatching suffix)                                                                                                                                                                                                                 |
| `tests/document/docx-current-search-plugin.test.tsx` (WP2)      | Plugin/controller (15 cases): state/snapshots/decoration ranges and classes, no dirty/history, cyclic navigation and selection/focus (editable and read-only), recalculation scheduling after edits/external setContent/rapid typing, editor isolation, destruction cleanup and generation                                                                                                                                                         |
| `tests/search/docx-current-search-panel.test.tsx` (WP3)         | Panel components (8 cases): controlled inputs, counts/truncation/errors, case and buttons, keyboard navigation, Escape focus restoration, read-only/degraded disabling, WP4 replacement wiring and truncation disabling                                                                                                                                                                                                                            |
| `tests/search/docx-current-search-app.test.tsx` (WP3/WP4)       | App integration (12 cases): Ctrl+F/H, immediate search/decorations, navigation, Escape, mixed TXT/DOCX panel switching, multiple-DOCX isolation, read-only/degraded/loading, tab-close cleanup, replace current/all → dirty and one undo                                                                                                                                                                                                           |
| `tests/document/docx-current-search-replace.test.tsx` (WP4)     | Replacement (15 cases): start-format inheritance within/across marks, empty/short/long/Chinese/emoji, structural preservation, live revalidation rejecting stale matches, command-level permission rejection, input validation, reverse-order single transaction without drift, one undo/redo, no-op at 0 matches, 2000/2001, rapid repeated clicks, advancing when the replacement still contains the query, model-budget failure with 0 dispatch |
| `tests/search/docx-current-search-lifecycle.test.tsx` (WP5)     | Compatibility/lifecycle (15 cases): read-only/degraded confirmation and revision invalidation, replacement during saving, save-error/conflict/read-error, close/reopen, workspace switch, stale controls from two DOCXs cannot pollute, session retention through rename/move/save-as, workspace locating/mutationEpoch independence                                                                                                               |
| `tests/docx/docx-current-search-wp6-observation.test.tsx` (WP6) | Performance/leak observations (7 cases): typical 100 paragraphs, 20,000 textblocks (0/200/20000 matches), near serialization limit, replace-all timing at 2000 matches, rapid-input coalescing, 20 panel open/close cycles without duplicate subscriptions, 20 tab switches without console errors/with one input/heap observation                                                                                                                 |
| `docs/tasks/task-010/TASK_010_WP0_REPORT.md` (WP0)              | WP0 baseline, technical verification, fixed decisions, and performance observations                                                                                                                                                                                                                                                                                                                                                                |

## 3. Fixed semantics implemented (task section 4)

- **Search source**: active Tiptap/ProseMirror live `state.doc`; no disk reads or search of stale
  model snapshots/editor DOM/OOXML.
- **Projection**: depth-first textblocks, exactly one artificial \n between adjacent blocks,
  UTF-16 offsets. Mapping formula: block content start pos+1 + in-block offset (shares
  `joinDocxTextBlocks` with Task 8; no second body-text semantics).
- **Inputs**: nonempty query, ≤4096 UTF-16, single line (reject \r/\n); replacement ≤4096 UTF-16,
  single line (empty replacement = deletion).
- **Matching**: literal + caseSensitive; case-insensitive mode folds ASCII A-Z only (consistent
  with Task 6 matcher, no Unicode normalization); left-to-right, non-overlapping; at most 2000
  matches, truncated from the 2001st onward.
- **Replace current**: reproject at execution time and revalidate both pmFrom/pmTo; invalidation
  → reject with a recalculation message, 0 dispatch.
- **Marks inheritance**: nonempty replacement inherits marks from the text node containing the
  match's starting **character** (WP0 F1: not the preceding-boundary semantics of
  `resolve(from).marks()`). Empty replacement deletes. Paragraph/heading/list/alignment structure
  and surrounding formatting remain intact.
- **Replace all**: 0 matches is a no-op; truncated or >2000 rejects the entire operation (0 partial
  replacements). Process end-to-start in one transaction; each match inherits its own starting
  marks. Before dispatch, run `tiptapJsonToDocxModel` and serialization-budget validation on
  `tr.doc.toJSON()`. Any failure means 0 dispatch/0 dirty; success dispatches once and requires
  one undo/redo.
- **Permissions**: defensive command-level rejection for read-only, unconfirmed degraded, or
  non-editable editor states (not dependent on disabled buttons). Degraded confirmation binds
  to `document.revision`; rereading a new revision invalidates the old confirmation.
- **Saving**: replacement is an ordinary undoable edit transaction through
  `editDocxTab`/dirty/editRevision. An older save completion does not clear replacement made
  during saving. No automatic save; saving retains existing revision conflicts, rolling backup,
  output verification, and safe replacement.

## 4. Plugin, controller, and UI

- Install `createCurrentSearchPlugin` once per editor (PluginKey `wenshu-current-search`). Plugin
  state includes open/query/replacement/caseSensitive/matches/currentIndex/truncated/validationError/operationMessage/decorations/generation.
- Recalculation: one scheduled microtask after edit transactions/input changes (`scheduled`
  coalescing), reading latest doc/query at execution. Async callbacks carry `requestGeneration`
  and a destruction guard; old editors/computations never report. No debounce timer, worker,
  index, or cache.
- DecorationSet resides in plugin state. Ordinary/current matches use different classes (current
  has both classes, so differentiation is not color-only). Document transactions update safely
  through `mapping`; recalculation replaces the set. Find/navigation/close do not alter body
  content, dirty the document, or enter undo history.
- Controller exposes `getSnapshot/subscribe` (useSyncExternalStore-compatible) and narrow
  operations. UI (panel/App) interacts only through `DocxCurrentSearchControls`, without exposing Editor/EditorView.
- Sidebar: TXT retains its CodeMirror panel host and behavior; DOCX shows the project panel.
  Only the active kind's panel appears at any time. Ctrl+F/H enters consistently from both
  sidebars and through read-only window-level shortcuts.

## 5. Compatibility and lifecycle (WP5 evidence)

| Scenario                                 | Fixed behavior                                                                                                                                                                                             | Evidence                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| read-only                                | Find/navigation/decorations available; replacement UI disabled and commands reject (editor not editable)                                                                                                   | app + plugin + lifecycle tests                                                                        |
| Unconfirmed degraded                     | Find but no replacement, with explicit reason; after confirmation bound to current revision, the **same editor** supports replacement (no recreation); rereading new revision invalidates old confirmation | lifecycle tests (editor reference identity + save request carrying confirmation revision)             |
| Replacement during saving                | Same editDocxTab semantics as ordinary typing: higher editRevision, still loaded-dirty after old save completes; disk saves pre-replacement content                                                        | lifecycle tests (disk-request model versus editor-content assertions)                                 |
| save-error / conflict                    | Find/replace remain available and enter dirty; conflict reread returns to disk content                                                                                                                     | lifecycle tests                                                                                       |
| read-error                               | With a snapshot, find/replace available (dirty retained); without snapshot, no editor mount or falsely usable panel                                                                                        | lifecycle tests                                                                                       |
| Multiple tabs / close / workspace switch | Per-tab queries/options/matches/decorations/history isolated; close/reopen creates a new session (new tabId/editor, no retained query); workspace switch clears all tabs/controls                          | app + lifecycle + WP6 20-switch tests                                                                 |
| Rename / move / save-as                  | Stable tabId: editor not recreated, panel/query/decorations retained; path migration is a pure state transition (Task 9 foundation)                                                                        | lifecycle + tab-path-migration tests                                                                  |
| Workspace locating / mutationEpoch       | Result locating does not rewrite current-search query; mutationEpoch invalidates only workspace search, not current DOCX search                                                                            | lifecycle tests                                                                                       |
| Old controls / subscriptions / timers    | Late edit callbacks cannot pollute active panel; destruction cleans subscriptions; no setInterval/setTimeout (microtasks only)                                                                             | WP2 destruction tests + WP6 leak observation (exactly one notification over 20 cycles, no-timer grep) |

## 6. Security boundaries (task section 7)

- No new IPC channel, preload method, or DesktopApi. There remain 17 fixed `ipcMain.handle`
  entries (workspace 6 + document 4 + save-as 2 + search 2 + window 3); preload contract tests
  (23 cases) passed.
- Queries, replacement text, match ranges, and document content do not cross IPC or enter logs;
  product search modules contain no `console.*` calls.
- Search/replacement writes no disk files and creates no temporary files/backups; replacement
  changes only the in-memory editor, with saving retaining Task 7/9 paths.
- No body DOM parsing or private Tiptap fields (code review: only public node/transaction/command APIs).
- No added third-party dependencies (package-lock unchanged); WP0 evaluated and fixed the dependency decision.

## 7. Automated checks and final test baseline

| Command                       | Result                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `typecheck` (5 tsconfigs)     | **Passed**                                                                                          |
| `lint` (--max-warnings=0)     | **Passed** (0 warnings)                                                                             |
| `format:check`                | **Passed**                                                                                          |
| `test` (62 files, 1143 cases) | **Passed**: 1133 passed / 10 skipped                                                                |
| `check`                       | **Passed** (exit code 0, about 30 s, Vitest about 50-63 s)                                          |
| `build`                       | **Passed** (exit code 0; main 154.91 kB / preload 4.10 kB / renderer JS 2,205.76 kB / CSS 27.84 kB) |

- All 10 conditional skips are real symlink/junction permission conditions (`it.runIf`):
  read-text-document 2, read-docx-document 2, search-text-workspace 1, search-mixed-workspace 1,
  resolve-workspace-entry 1, relocate-workspace-entry 1, trash-workspace-entry 1,
  reveal-workspace-entry 1. Mock adapters deterministically cover all rejection branches.
- All existing Task 1–9 tests ran unchanged and passed (WP5 targeted 14 files/196 cases + full
  regressions); no `.only`, unconditional `.skip`, or weakened assertions.
- Only expected stderr: saver/new-file cleanup-failure injection cases emit
  `wenshu: 清理临时文件失败 (EACCES/EPERM)` (existing baseline).

## 8. Windows development/production-build smoke tests and measured evidence

| Verification                                                                | Result                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development mode (`scripts\dev.cmd`, WP7 final acceptance)                  | dev server (renderer :5173) + main/preload builds succeeded; 4 electron processes alive; no error/Uncaught/failed in logs; 0 residual processes after cleanup                                                                                                                            |
| Production build (`node_modules\.bin\electron.cmd .`, WP7 final acceptance) | 4 electron processes alive ≥14 s, no stdout/stderr errors, 0 residual processes after cleanup                                                                                                                                                                                            |
| Manual UI acceptance (task section 8)                                       | Performed and passed by owner: Ctrl+F/H, navigation, highlights, inheritance across different marks, replace all/undo/redo/save, headings/lists/Chinese/emoji, read-only/degraded, mixed TXT/DOCX, dirty/saving, external conflicts, rename/move/save-as, minimum window, keyboard focus |
| Temporary leftovers                                                         | No `.wenshu-*` leftovers in repository; only existing `*.log` (covered by `.gitignore`); `out/` and `.tools/` ignored                                                                                                                                                                    |
| Electron exposure (review)                                                  | 17 fixed IPC channels; no generic invoke/ipcRenderer leak; no added privileges                                                                                                                                                                                                           |

## 9. Performance and leak observations (WP6; one-time observations, not hard CI assertions)

| Scenario                                                                              | Measured (local jsdom, this round)                                                                          |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Typical 100-paragraph DOCX, recalculation + decorations for 100 matches               | 11.8 ms                                                                                                     |
| 20,000 textblocks: 0 matches                                                          | 14.8 ms                                                                                                     |
| 20,000 textblocks: 200 matches                                                        | 39.3 ms                                                                                                     |
| 20,000 textblocks: 20000 matches (truncated to 2000 + decorations)                    | 165.7 ms                                                                                                    |
| Near serialization limit (8,386,188 / 8,388,608 bytes), truncated query + decorations | 93.7 ms                                                                                                     |
| Replace all 2000 matches: construction + model prevalidation + dispatch               | 59.2 ms                                                                                                     |
| Rapid consecutive typing                                                              | 5 inputs coalesced into 1 recalculation                                                                     |
| Open/close panel 20 times                                                             | Decorations clean from 2→0 each cycle; exactly 1 notification per state change (no duplicate subscriptions) |
| Switch between two DOCX tabs 20 times                                                 | Single input, stable queries, 0 console.error calls; heapUsed +7.3 MB (GC noise, observation only)          |

Ordinary documents are far below the 100 ms target. The heaviest near-limit scenarios are about
90-170 ms without perceptible stutter, supporting WP0's fixed synchronous full-recalculation +
single-scheduling + generation strategy.

## 10. Section 11 acceptance review (all 45 items checked)

- **11.1 Find/navigation (9 items)**: Ctrl+F/H and sidebar entry (app/panel tests); live unsaved
  PM document (plugin/code review); literal/case/non-overlap/single-line/length (WP1 pure tests);
  paragraphs/headings/across marks/lists/Chinese/emoji (WP1/assumptions/result-locate); no crossing
  artificial newlines (WP1); cycling/count/selection/scroll/focus (plugin + app); dual-class
  decorations do not alter body content (plugin); 2000/2001 budget/truncation (WP1/replace/panel);
  find/navigation/close do not dirty or enter history (plugin + app).
- **11.2 Replacement (10 items)**: live revalidation (replace); empty/short/long/Chinese/emoji
  (replace); starting marks (replace/assumptions); structural preservation (replace); reverse-order
  single transaction (replace); one undo/redo (replace/assumptions); 0 matches/whole rejection at
  2001+ (replace); model/budget failure with 0 dispatch (replace/assumptions); dirty/editRevision
  without automatic save (app/lifecycle); saving retains revision/backup/safe replacement
  (lifecycle/docx save regressions).
- **11.3 Compatibility/lifecycle (9 items)**: read-only; degraded confirmation and revision
  invalidation; replacement during saving; save-error/conflict/read-error; tab isolation;
  close/reopen/workspace-switch cleanup; rename/move/save-as stable tabId; locating/mutationEpoch
  independence; no late controls/duplicate subscriptions/timer/editor leaks (WP5 lifecycle + WP2
  destruction + WP6 leak observations).
- **11.4 UI/accessibility/security boundaries (8 items)**: TXT CodeMirror regressions (find-replace
  9 cases + mixed switching tests); panel controls/count/errors/truncation/disabled reasons
  (panel); shortcuts/focus/names (panel/app); current match not color-only + minimum window
  (dual class + WP6 smoke); public API review; no document content in logs (grep review);
  no new IPC/preload (contract tests + handle count); no new dependencies (package-lock review).
- **11.5 Quality/performance/documentation (9 items)**: complete tests (62 files, 1133 passed);
  check passes with justified conditional skips; build passes; development/production smoke
  passes; performance observations (WP6); no console exceptions/leaks/leftovers (WP6 + leftover
  review); README/PROJECT_BASELINE/TESTING/project structure synchronized (updated in this work
  package); WP0 and this completion report complete; no Task 1–9 regression.

## 11. Known limitations

1. Case-insensitive matching uses ASCII-only folding without Unicode normalization. Its difference
   from CodeMirror NFKD is fixed known behavior; the TXT engine is unchanged (WP0 F3).
2. Tiptap v3 StarterKit's default TrailingNode appends an empty trailing paragraph when a document
   ends in a non-paragraph block (WP0 F2). The live doc is the sole source; empty blocks have no
   matches, keeping semantics consistent.
3. Replace/replace-all affect only live editor content and existing DOCX-model capabilities.
   Images/tables/headers/footers/comments/revisions and other content outside the structured model
   are not promised.
4. jsdom scroll coordinates and real-browser rendering paths cannot be asserted; real scrolling/focus
   are covered by WP6 manual smoke testing.
5. Performance figures are one-time observations in local jsdom, not CI benchmark gates. Real
   browser scrolling/rendering is observed through smoke testing.
6. This task does not provide workspace replacement, batch replacement, regex/fuzzy search,
   filesystem watching, autosave, or session recovery (explicit non-goals).

## 12. Whether all Task 10 acceptance criteria are met

- Every acceptance item in task sections 11.1–11.5 (45 total) was individually reviewed and
  checked `[x]`. Each has corresponding automated tests, WP0 technical verification, code review,
  performance records, or manual smoke evidence; none was checked on speculation;
- `check` (62 files / 1133 passed / 10 conditional skips) and `build` passed sequentially (exit
  code 0); development and production Windows smoke tests passed; no unresolved data loss,
  partial replacement, privilege expansion, or obvious stutter remains;
- Task status is now “已完成” (completed). README / PROJECT_BASELINE / TESTING / project structure
  were synchronized; WP0 and completion reports are complete.

**Conclusion: all Task 10 acceptance criteria are met.**
