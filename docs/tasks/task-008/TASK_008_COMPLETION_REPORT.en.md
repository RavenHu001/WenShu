# TASK-008 Completion Report: Workspace DOCX Body-Text Search and Rich-Text Result Navigation

[简体中文](./TASK_008_COMPLETION_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Implementation and post-completion audit fixes completed on 2026-08-15. Verification platform: Windows 11, Node.js 22.15.0, npm 10.9.2, Electron 37.x, and Microsoft Word 16.0 (external Office probing; COM write automation was restricted by local environment policies, see section 10). WPS Office was not installed locally.
> WP0–WP7 were implemented and accepted individually. The development Agent performed automated acceptance (typecheck/lint/format:check/all tests/check/build), performance observations, development/production desktop smoke tests, and external-change revision verification.
> The owner executed and passed the section 8.7 manual UI checklist on 2026-08-15, confirming “手动测试无问题” (no issues in manual testing).

## 1. Implementation summary

Packages were completed in order: WP0 baseline/projection/concurrency verification → WP1 canonical body projection and shared contracts → WP2 main-process mixed search → WP3 IPC/preload/controller/sidebar → WP4 generic result opening and DOCX navigation → WP5 lifecycle/compatibility/mixed regressions → WP6 performance/smoke/risk resolution → WP7 overall acceptance/documentation/report. The workflow expanded from TXT-only search to a single query across TXT and DOCX bodies, with safe DOCX result navigation:

```text
Saved regular TXT and basic DOCX on workspace disk
  -> Controlled main-process mixed traversal without following links; reuse TXT reader and readDocxDocument
  -> DOCX search text only from canonical DocxDocumentModel projection (depth-first text blocks + artificial \n)
  -> First 1000 candidates in global natural relative-path order (DOCX 200), total concurrency 4 (DOCX 2)
  -> Cooperative cancellation and per-file error isolation
  -> File-grouped results carry kind (txt/docx), revision, 1-based line/column, and safe snippets
  -> TXT results reuse safe CodeMirror navigation; DOCX results open or activate a unique tab
  -> Validate kind/revision/projection range/matched text; DOCX host revalidates an equivalent projection
  -> Public ProseMirror commands set selection, scroll, and focus; stale/changed/unmappable results only show a notice
```

## 2. Key added and modified files

### Added files

| File                                                 | Purpose                                                                                                                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/docx-search-text.ts`                     | Framework-independent pure canonical projection: depth-first text blocks, artificial `\n`, UTF-16 block mapping (`projectDocxModelSearchText` / `joinDocxTextBlocks`)                                                                 |
| `tests/docx/docx-search-projection.test.ts`          | 16 pure tests: empty/single/multiple/empty paragraphs, headings 1–3, cross-mark text, lists/nesting, artificial newlines, UTF-16/emoji/combining characters, linear maximum-model traversal                                           |
| `tests/search/search-mixed-workspace.test.ts`        | 26 main-process mixed-search tests, 1 conditional skip: TXT-only/DOCX-only/mixed/empty workspace, kind/order, budgets/truncation priority, dual concurrency, cancellation stages, real-filesystem mixed search and read-only behavior |
| `tests/search/result-locate-docx.test.tsx`           | 12 DOCX result/navigation tests: unopened/open/loading unique tab, read-only/degraded/dirty, format changes, stale text/structure/revision, replacement navigation, unchanged model                                                   |
| `tests/document/docx-locate-host.test.tsx`           | 5 DocxEditorSessionHost protocol tests: equivalent projection revalidation, PM position mapping, stale reporting, apply each target once                                                                                              |
| `tests/search/result-locate-docx-lifecycle.test.tsx` | 16 WP5 lifecycle/compatibility/mixed regressions: read-error/loading close/workspace switch/saving/marks/deleted blocks/degraded confirmation/read-only/kind defense/TXT+DOCX/tab isolation/late reads/search cancellation            |
| `tests/docx/docx-search-locate-assumptions.test.tsx` | 9 WP0 verification tests: public PM navigation API, UTF-16/emoji/empty paragraphs, read-only navigation, near-20-MiB read window, cooperative cancellation, dual concurrency pool                                                     |
| `docs/tasks/task-008/TASK_008_WP0_REPORT.md`         | WP0 baseline, frozen projection semantics, public APIs, concurrency/cancellation assumptions                                                                                                                                          |
| `docs/tasks/task-008/TASK_008_COMPLETION_REPORT.md`  | This report                                                                                                                                                                                                                           |

### Modified files

| File                                                                                                                                            | Change                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/search.ts`                                                                                                                          | Required file-result `kind` (`txt`/`docx`), `docx-file-limit` truncation reason, priority constant, updated comments (“Text” means canonical searchable text)                                            |
| `src/main/search/search-text-workspace.ts`                                                                                                      | Mixed classification/controlled reads; global relative-path min-heap for first 1000 candidates; DOCX 200 budget; projection into matcher; total 4 / DOCX 2 concurrency; cancellation checks              |
| `src/main/search/match-text.ts`                                                                                                                 | Same pure matcher semantics; input now TXT body or DOCX projection, with no logic change                                                                                                                 |
| `src/main/search/search-ipc.ts`                                                                                                                 | Preserved start/cancel protocol/lifecycle; result validation adapts to kind/new truncation reason                                                                                                        |
| `src/preload/index.ts` / `src/shared/desktop-api.ts`                                                                                            | Preserved fixed `textWorkspace` / `cancelTextWorkspace` shapes; comments only                                                                                                                            |
| `src/renderer/lib/use-workspace-search.ts`                                                                                                      | Forwards mixed results with kind; preserves requestId/epoch/mount triple protection                                                                                                                      |
| `src/renderer/components/search/SearchSidebar.tsx`                                                                                              | TXT/DOCX canonical-body scope, unsaved-edit notice, extracted-DOCX coordinate explanation, unavailable current-DOCX find/replace notice, docx-file-limit message                                         |
| `src/renderer/components/search/SearchResults.tsx`                                                                                              | Accessible TXT/DOCX type labels and DOCX extracted-text explanation                                                                                                                                      |
| `src/renderer/App.tsx`                                                                                                                          | Generic `openFile`; navigation bound to epoch + requestId + locateId and current-result membership; new search/cancel invalidates late navigation; kind/revision/live projection/matched-text validation |
| `src/renderer/components/document/DocxEditorSessionHost.tsx`                                                                                    | Public-node projection, second validation, block-position mapping, `setTextSelection`/`scrollIntoView`/`focus`, applied/stale reports, apply-once guard                                                  |
| `src/renderer/components/document/DocumentPane.tsx`                                                                                             | Sends navigation targets only to the matching active-tab kind                                                                                                                                            |
| Shared contract and IPC/preload tests                                                                                                           | Expanded kind/truncation/mixed-result assertions in `search-contract` (17), `search-ipc` (27), `search-sidebar` (17), `use-workspace-search` (14), `preload/contract` (18)                               |
| `README.md` / `docs/architecture/PROJECT_BASELINE.md` / `docs/development/TESTING.md` / `docs/tasks/task-008/TASK_008_DOCX_WORKSPACE_SEARCH.md` | WP7 capability/baseline/testing/status/acceptance synchronization                                                                                                                                        |

## 3. Canonical DOCX projection and unsupported-content boundaries

- Projection implements all 10 task section 4.3 rules in `src/shared/docx-search-text.ts`: depth-first document-order traversal; each paragraph/heading becomes a text block; list containers generate no text, while their paragraphs/headings do; concatenate each block's run `text` unchanged, excluding marks/sizes/colors/alignment/heading levels/list numbers; insert exactly one artificial `\n` between adjacent blocks; retain empty paragraphs as empty blocks; add no leading/trailing newline; use UTF-16 code-unit offsets, matching JavaScript strings and PM text positions; projection carries only block index, projected from/to, and block body, never model/PM nodes across IPC; the pure function depends on no Electron/Node/Mammoth/Tiptap/PM/DOM/filesystem.
- Queries still reject line breaks, so matches never cross artificial block separators. Run boundaries are not search boundaries; continuous text across marks matches normally.
- Excluded from search: image alt text, tables, headers/footers, footnotes/endnotes, comments, deleted tracked-change content, fields, equations, embedded objects, and macros that never enter the structured model. `supported`/`degraded`/`read-only` search only modeled body content. Zero-byte DOCX placeholders are blank, with no matches/errors. Damaged/encrypted/disguised/oversized/unreadable/import-failing DOCX are isolated per-file errors and counted as skipped.

## 4. Contract compatibility and resource limits

- Retain `WorkspaceTextSearchRequest` / `WorkspaceTextSearchResult` and `search.textWorkspace`; “Text” means each supported type's canonical searchable text. `WorkspaceTextSearchFileResult` requires `kind: 'txt' | 'docx'`. Requests are unchanged, adding no roots, extension lists, glob, parsing options, concurrency, or budgets. preload reuses fixed start/cancel methods without generic IPC.
- Shared limits, used by main process/tests: query 256 UTF-16 units; 1000 total TXT+DOCX candidates, including at most 200 DOCX; 200 matches/file; 2000 total matches; preview 160; concurrency 4 total, 2 DOCX. Truncation priority: `file-limit` > `docx-file-limit` > `total-matches-limit` > `matches-per-file-limit`. Budget exclusions are not read failures.
- No added production dependencies; Mammoth/JSZip/Tiptap/ProseMirror/matcher/search controller are reused.

## 5. Mixed traversal, dual concurrency, cancellation, and error isolation

- Root comes only from main-process `workspace-session`. Traversal follows no symlink/junction/other reparse points; check `isSymbolicLink` before `isDirectory`. Candidates are regular case-insensitive `.txt`/`.docx` only. Each controlled read revalidates path/links/real path/size/type/revision.
- A global relative-path min-heap drives directories/candidates, so subdirectories cannot exhaust the 1000 budget before global ordering. At most 4 reads are in flight, including 2 DOCX reads/imports. Completion order does not affect final sorting.
- Cooperative cancellation checks directory batches, every entry, before/after reads, before/after DOCX projection, and matcher loops (`shouldYield`). Started controlled reads may finish but cannot commit results. Cancellation never marks partial results completed.
- Unreadable root → stable overall `SEARCH_FAILED`. Subdirectory/per-file errors (NOT_FOUND/ACCESS_DENIED/TOO_LARGE/INVALID_UTF8/INVALID_DOCX/RESOURCE_LIMIT_EXCEEDED, etc.) increment `skippedFiles` and continue; budget exclusions do not.
- Search is entirely read-only: no write/create/rename/delete APIs or backup/temp/index/cache creation. Real-filesystem tests assert identical before/after file inventories.

## 6. Revision, dirty, second validation, and stale navigation

- Navigation binds unique `locateId` + workspace epoch + search `requestId` + file `kind` + normalized relative path + search-time disk `revision` + projected `from/to` + actual `matchedText`. Clicked groups/matches must belong to the current completed result.
- Fixed flow (task section 4.8): verify current completed membership → generic `openFile` opens/activates a unique tab (loading awaits the original read; read-error retains error) → revalidate epoch + requestId + locateId at every asynchronous commit → match kind to actual tab type → exact tab disk-baseline revision match → regenerate live-model projection, check from/to and exact matchedText → dispatch target → DOCX host creates equivalent projection from public PM nodes and revalidates → match must fit entirely in one real block → map block content start + within-block UTF-16 offset → public selection/scroll/focus commands → host reports applied/stale. New search, cancel, or replacement completed results immediately invalidate old targets/late reports.
- Dirty semantics: allow navigation if the original projected slice remains identical, keeping dirty. Inserting/deleting before a match changes offsets and makes it stale even if identical text exists elsewhere. Mark/size/color/alignment-only changes permit navigation if projection is unchanged. List/paragraph structure changes that invalidate projection/block mapping are stale. External formatting-only changes alter raw-byte revision and fail revision validation first.
- Any failure only activates the tab and displays the non-destructive “搜索结果已过期” (search result is stale) notice. Do not guess nearest text, force a block-index jump, clear dirty, change body, save, or reread. Navigation adds neither undo history nor dirty.

## 7. Electron / IPC security boundaries

- `nodeIntegration: false`, `contextIsolation: true`, and sandbox stay unchanged. preload only reuses fixed `search.textWorkspace` / `search.cancelTextWorkspace`, with no ipcRenderer/generic invoke.
- Renderer cannot submit roots, absolute paths, glob, extensions, encodings, ZIP/XML options, concurrency, or budgets; receive raw DOCX bytes, OOXML, unsanitized HTML, Buffer, ZIP entries, or handles; or submit shell commands, network URLs, or ignore-revision/skip-compatibility/guess-navigation switches.
- Main-process candidate reads revalidate paths, segment links, real paths, regular-file status, and extensions. DOCX remains untrusted ZIP with all 20 MiB/ZIP-entry/decompression/critical-XML/model-node budgets preserved. No external relationships or macro/script/field/embedded-object execution.
- Logs and cross-process errors reveal no queries, matched body, full projection/model, absolute paths, raw exceptions, or stack traces. Tests assert serialized JSON contains no paths/internal messages.
- Old workspace/request/navigation results cannot enter a new session: epoch + requestId + locateId invalidate all three.

## 8. Automated checks and final test baseline

| Command                        | Result                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `typecheck` (5 tsconfig files) | **Passed** for every package                                                                                          |
| `lint` (--max-warnings=0)      | **Passed**, 0 warnings                                                                                                |
| `format:check`                 | **Passed**, fixed Windows checkout line endings                                                                       |
| `test` (38 files, 841 cases)   | **Passed**: 835 passed / 6 skipped, all real-symlink permission conditions with deterministic mock rejection coverage |
| `check`                        | **Passed**, exit 0                                                                                                    |
| `build`                        | **Passed**, exit 0                                                                                                    |

Added/expanded Task 8 tests: `docx-search-locate-assumptions` (9), `docx-search-projection` (16), `search-mixed-workspace` (27, 1 conditional skip), `search-contract` (17), `search-ipc` (27), `search-sidebar` (17), `use-workspace-search` (14), `result-locate-docx` (12), `docx-locate-host` (5), `result-locate-docx-lifecycle` (17). All Task 1–7 tests ran unchanged and passed. No unconditional skip, only, or weakened assertions. `check`/`build` were sequential. Only expected saver-test EACCES/EPERM cleanup logs appeared on stderr.

One WP6 `check` encountered junction-cleanup `EBUSY`, a brief Windows indexing/antivirus lock on a new junction documented in DEVELOPMENT_ENVIRONMENT.md. Existing `removeDirWithRetry` uses bounded 10×250ms retries. A rerun passed without test-infrastructure changes.

## 9. Near-limit workspace performance (one-off observations, not benchmark gates; temporary scripts removed)

| Scenario                                                          | Result                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Ordinary mixed workspace: 10 TXT + 10 DOCX, sparse query          | **140 ms**, all 20 files matched                                                     |
| Near limit: 800 TXT + 200 DOCX = 1000 candidates, query `English` | **1698 ms**: 1000 scanned, 650 matching files, 2000 matches, `file-limit` truncation |
| Near-limit dense case-insensitive `e` query                       | **1551 ms**, per-file/total-match limits reached, `truncated: true`                  |
| Cancel flag set at 30 ms                                          | Returned `cancelled` at **38 ms**, approximately 8 ms after flag                     |
| Cancel at 80 ms with reads in flight                              | Returned `cancelled` at **88 ms**; started reads finished without committing         |
| Memory before/after                                               | rss −28.6 MB / heapUsed −12.4 MB; no growth signal                                   |
| Read-only search                                                  | File inventory 1001 == 1001; no `.wenshu`/temporary/index residue                    |

Main-process traversal/reads/matching stayed asynchronous and bounded. Near-limit mixed search did not freeze the main UI; development/production smoke windows remained usable without error logs.

## 10. Desktop smoke and external Office verification

- Development (`dev.cmd` → electron-vite dev): **passed**. main 89.23 kB / preload 2.81 kB built; dev server ready; “start electron app...”; 4 Electron processes alive after 30s; no preload/React/resource errors.
- Production (`npm exec -- electron .`, loading `out/`): **passed**. Four processes alive after 20s, no errors, all cleaned up afterward.
- External Office probe: Microsoft Word **16.0** installed and COM-startable, but local policies restricted write automation: existing documents opened read-only, creation/saving hung. This matched TASK-007's Protected View/recovery-dialog limitation. WPS Office was not installed locally.
- Equivalent revision-staleness verification through production main-process paths, using a temporary evidence test removed afterward: an external program replaced the same path with a valid different-content DOCX, equivalent to Word/WPS resaving. Disk revision changed `554a5a1a…` → `a714ea07…`; `readDocxDocument` still imported it and `searchTextWorkspace` returned the new revision with 1 match. Appending raw bytes changed SHA-256 `821f1e91…` → `562a944e…`. Renderer external-change→stale-notice behavior is automated in `result-locate-docx.test.tsx`.
- The owner passed section 8.7 on 2026-08-15: mixed search; Chinese/English/emoji; cancellation/repeated submissions/no results; unopened/open/loading/dirty/read-only/degraded result clicks; paragraphs/headings/cross-run/lists/nested lists; stale external changes; workspace switch/window close while searching; near-limit performance/UI usability; clean console and workspace.

## 11. Known limitations

1. Local policy restricted Word COM write automation, as in TASK-007; WPS was absent. External writing used equivalent external-program changes plus production-path evidence, and renderer staleness was automated. Actual Word/WPS write evidence requires an interactive/activated Office environment.
2. No non-ASCII case folding, matching the existing TXT limit. Case-insensitive search folds only ASCII letters without changing offsets.
3. Preview windows may split surrogate pairs (emoji), affecting display only; `from`/`to` remain authoritative.
4. Real-symlink tests are skipped under local permission conditions; lstat/readDir mocks deterministically cover rejection.
5. JSDOM cannot reliably assert scroll values; boundary tests and manual acceptance cover scrolling.
6. `docx@9` core.xml timestamps are nondeterministic, inherited from Task 7; actual-byte SHA-256 search revisions are unaffected.
7. Rare transient junction-cleanup `EBUSY`, mitigated by bounded retries; reproduced once in WP6 and passed on rerun.
8. Search excludes image alt text, tables, headers/footers, footnotes/endnotes, comments, deleted tracked-change content, fields, equations, embedded objects, and macros. Unsaved dirty-tab text does not participate; UI explains this.
9. Navigation applies only when the exact projected range equals matched text. Changed text/structure/external revision is stale; it never searches for the nearest identical text.
10. Current-file find/replace still supports TXT only. Active DOCX shows an unavailable explanation, without appearing usable.

## 12. Satisfaction of all acceptance criteria

TASK-008 sections 11.1 (8 items), 11.2 (12), 11.3 (8), 11.4 (9), and 11.5 (9) are satisfied and checked. Automated criteria passed through actual commands. The Agent completed performance, development/production smoke, and external-change revision verification; the owner passed section 8.7 on 2026-08-15. No excluded section 9 functionality was added: current-DOCX find/replace, workspace replace, regex/fuzzy/semantic search, persistent indexing, database, autosave, creation/Save As, file management, or AI.

## 13. Post-completion audit fixes (2026-08-15)

Independent review after the initial completion report found and fixed two medium issues:

1. **Late navigation from an old search**: asynchronous navigation originally rechecked only workspace epoch and `locateId`. Submitting a new search while waiting for a loading DOCX could still apply the old selection. App targets now carry `requestId`; clicked items must belong to current completed results; all asynchronous commits/host reports check epoch + requestId + locateId. New search/cancel/replacement results clear old targets.
2. **Candidate budget before global sorting**: depth-first collection originally stopped at 1000, and later sorting could not recover root candidates that should have ranked earlier. A natural relative-path min-heap now jointly schedules directories/candidates; expanded directories reenter global ordering. The budget applies to the actual first 1000 without collecting an unbounded list.

Two regressions were added: submitting a new search while navigation awaits a loading DOCX, and root files plus a same-prefix subdirectory exceeding 1000 candidates. Targeted tests, full `check`, and `build` passed; section 12 remains valid.

## 14. Task status and next entry point

**TASK-008 status: Completed.**

The next planned task is basic file management: create TXT/DOCX/folders, Save As, rename, move, delete, and reveal in File Explorer. It requires separate target-path validation, conflicts, overwrite confirmation, unsaved-tab migration, search-result invalidation, and recoverable deletion. Current-DOCX find/replace can be scheduled separately after comparing its user value with file management.
