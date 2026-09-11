# TASK-008 WP0 Report: Baseline, DOCX Body-Text Projection, and Technical Assumptions

[简体中文](./TASK_008_WP0_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Scope: TASK-008 section 10 WP0: all section 3 prerequisites, Windows junction-cleanup EBUSY reliability repair, expanded DOCX fixtures, model-projection ↔ ProseMirror block mapping, public-API navigation/read-only assumptions, near-20-MiB reads, dual concurrency/cancellation assumptions, and frozen section 4 protocol/budgets.
> Implemented on 2026-08-15; verified on Windows 11 (zh-CN), Node.js 22.15.0, npm 10.9.2, Electron 37.x.
> No DOCX search capability was exposed in product UI; no product functionality code changed. Changes were limited to fixtures/verification/report and one test-reliability fix, see section 3.

## 1. Prerequisite results (task sections 3.1 / 3.2)

### 1.1 Required reading (3.1)

Read in full: `README.md`, `docs/architecture/PROJECT_BASELINE.md`, `docs/development/DEVELOPMENT_ENVIRONMENT.md`, `docs/development/TESTING.md`, `docs/tasks/task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.md`, `docs/tasks/task-006/TASK_006_COMPLETION_REPORT.md`, `docs/tasks/task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md`, `docs/tasks/task-007/TASK_007_COMPLETION_REPORT.md`, `docs/tasks/task-008/TASK_008_DOCX_WORKSPACE_SEARCH.md`, and directly related source/tests:

- `src/shared/search.ts`, `src/main/search/match-text.ts`, `search-text-workspace.ts`, `search-ipc.ts`;
- `src/shared/docx.ts`, `docx-convert.ts`; `src/main/docx/read-docx-document.ts`, `inspect-docx-package.ts`; `src/main/search/`, `src/main/workspace/workspace-session.ts`;
- `src/renderer/lib/use-workspace-search.ts`, `use-documents.ts`, `document-tabs.ts`;
- `src/renderer/components/document/EditorSessionHost.tsx`, `DocxEditorSessionHost.tsx`, `DocumentPane.tsx`; `src/renderer/App.tsx`;
- Existing full regression: Task 6 search contracts/matcher/searcher/IPC/controller/sidebar/navigation; Task 7 DOCX fixture suite/model/conversion/inspection/import/export/read/save/IPC; TXT read/save, multiple tabs, window close, and preload contracts.

### 1.2 Working tree and quality baseline (3.2)

- `git status --short`: one existing user change in `docs/tasks/task-008/TASK_008_DOCX_WORKSPACE_SEARCH.md`, an addition to section 13's execution-prompt template. It was **identified, protected, and untouched**. All other changes came from this package (section 8).
- Branch `TASK-008`, at `cb65410 Task 8：DOCX 正文搜索与富文本结果定位，完成当前文档路线。`.
- Baseline commands ran sequentially; `check` and `build` were not concurrent:

| Command                        | Result                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typecheck` (5 tsconfig files) | **Passed**                                                                                                                                         |
| `lint` (--max-warnings=0)      | **Passed**, 0 warnings                                                                                                                             |
| `format:check`                 | **Passed**, fixed Windows checkout line endings                                                                                                    |
| `test` (32 files, 742 cases)   | Initial run: **2 suites failed from junction-cleanup EBUSY** (section 3). After repair, 3 consecutive full runs passed: **737 passed / 5 skipped** |
| `check`                        | **Passed** after repair, exit 0                                                                                                                    |
| `build`                        | **Passed**: main 84.94 kB, preload 2.70 kB, renderer 2,107.16 kB + CSS 21.86 kB                                                                    |

- All 5 skips were real-symlink permission cases. Junction creation worked locally; file symlinks required elevation. Real-link integration skips: `read-text-document` 2, `read-docx-document` 2, `search-text-workspace` 1. lstat/readDir mocks deterministically covered rejection.
- Desktop smoke: development `.\scripts\dev.cmd` alive 22s; production `npm exec -- electron .` alive 18s, without preload/React/resource errors (section 6).
- Full regression passed for Task 6 TXT search/cancellation/navigation and Task 7 DOCX opening/editing/saving/compatibility notices. Every test actually executed; no assertions weakened.

### 1.3 Initial baseline failure and repair (section 3.2: junction cleanup must not skip a whole file)

The first full `check` reproduced the Windows junction-cleanup issue known from TASK-007 planning but not reproduced then:

```
EBUSY: resource busy or locked, rmdir '...\wenshu-reader-probe-*\alias-dir'   （2 套件）
```

**Cause:** `beforeAll` in `tests/document/read-text-document.test.ts`, `tests/search/search-text-workspace.test.ts`, and `tests/docx/read-docx-document.test.ts` created a temporary junction probe and immediately cleaned it with `fs.rm(dir, {recursive:true, force:true})`. Under the full parallel load (vitest forks 4), Windows antivirus/indexing briefly locked newly created junctions and caused transient `rmdir` failures. Single-file/lower-load runs did not fail; 40 junction-only stress iterations all passed, identifying a transient parallel-load lock rather than permissions or a structural Node recursive-rm defect. A throwing `beforeAll` skipped the whole test file (49 cases) or real-filesystem integration group (7), violating the gate against whole-reader-file skips from EBUSY.

**Test-reliability repair, without product changes:** new `tests/test-utils/temp-dir-cleanup.ts` provides `removeDirWithRetry`, with at most 5 retries 200ms apart for transient `EBUSY`/`EPERM` only. Other errors throw immediately; exhaustion rethrows the original. It does not swallow real failures, increase timeouts, or skip whole files. The three junction-probe test files use it for probe directories and workspace roots containing junction cases. Three consecutive full `test` runs then passed (737/5).

## 2. DOCX fixtures (task section 3.3)

Reuse TASK-007's 18 deterministic, non-private fixtures. Add 4 in `tests/docx/docx-fixture-builder.ts`:

| Fixture id            | Purpose and expected structure                                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok-read-only`        | Regular document with settings.xml injected `<w:documentProtection w:edit="readOnly" w:enforcement="1"/>`; inspector classifies `encrypted-protected` → `read-only`: readable/searchable, not editable/savable |
| `ok-combining-emoji`  | Combining accent (`e\u0301`), astral emoji (🎉🚀), CJK extension character (𠮷), native within-run newline; verifies unchanged UTF-16 offsets without normalization/surrogate splitting                        |
| `ok-projection-mixed` | Heading 1 + three-run paragraph (bold/italic/plain) + empty paragraph + nested bullet lists (level 0/1) + nested numbered lists (level 0/1) + emoji paragraph; freezes projection structure                    |
| `ok-large`            | Valid DOCX padded to exactly 20 MiB while remaining parseable; verifies near-limit read duration and the window where a started read may finish                                                                |

Four added `tests/docx/docx-fixture-suite.test.ts` assertions fix read-only inspector features, unchanged combining characters/surrogates/newlines in the model, mixed-projection structure (heading level/run order/nested grouping), and exactly-20-MiB parseability.

## 3. DOCX body projection verification (task section 3.3)

### 3.1 Frozen projection rules (all 10 rules in task section 4.3)

Test scaffold `tests/docx/docx-search-projection-scaffold.ts` implements these rules; WP1 ports them into `src/shared/docx-search-text.ts`:

1. Traverse depth-first in document order.
2. Each regular paragraph and heading forms one text block.
3. List containers produce no text; their paragraphs/headings form blocks in depth-first order.
4. Concatenate each block's run `text` unchanged; exclude marks, sizes, colors, alignment, heading levels, and list numbering.
5. Insert exactly one artificial `\n` between adjacent blocks.
6. Retain empty paragraphs as empty blocks and preserve adjacent separators.
7. Add no extra leading/trailing document newline.
8. Use UTF-16 code-unit offsets, matching JavaScript strings and ProseMirror text positions.
9. Carry block index, projected `from/to`, and body text only for in-process mapping.
10. Depend on no Electron, Node.js, Mammoth, Tiptap, ProseMirror, DOM, or filesystem.

**Additional measured constraint:** product import/conversion generates no empty text runs: `importRuns` and `parseInlineContent` skip them. ProseMirror `nodeFromJSON` directly rejects empty text nodes with `RangeError: Empty text nodes are not allowed`, confirmed in WP0. Projection treats empty runs as contributing nothing, matching real-model output.

### 3.2 Projection ↔ ProseMirror block equivalence (section 3.3 findings 1/2)

`tests/docx/docx-search-projection.test.ts`, 16 Node-environment cases, uses the **real ProseMirror schema**, with the same chain as product `DOCX_EDITOR_EXTENSIONS`: StarterKit(levels 1-3, link:false)

- TextStyle + Color + FontSize + TextAlign. It verifies public node APIs (`schema.nodeFromJSON` → `doc.descendants` / `isTextblock` / `textContent` / `textBetween` / `nodeSize`):

* Empty model/single/multiple/empty paragraphs: projection text/block ranges match PM blocks individually.
* Heading levels 1–3 each form a block; levels/marks/sizes/colors/alignment are excluded.
* Bulleted/numbered/nested lists: PM block order exactly matches depth-first model order; list-item paragraphs are also textblocks.
* UTF-16: Chinese, emoji surrogate pairs (2 units), and combining characters (base + U+0301 as separate units) have identical projection/PM offsets.
* Native within-run newlines remain within block text without creating additional blocks.
* Every match of a valid newline-free query lies wholly within one block, never across an artificial separator.
* At the 20,000-block model budget, projection took 7ms (section 5); adjacent `from/to` chains are continuous and final `to` equals text length.
* **Real-fixture workflow:** models imported from 9 fixtures, including 4 new ones, through product `inspectDocxPackage` + `importDocxDocument` match PM body text and UTF-16 lengths block by block.

### 3.3 Public navigation APIs and read-only assumptions (section 3.3 findings 3/4)

`tests/docx/docx-search-locate-assumptions.test.tsx`, 9 jsdom cases, uses a real Tiptap Editor:

- `editor.commands.setTextSelection` / `scrollIntoView` / `focus` work through public commands without private DOM reads; selection is asserted through public `view.state.selection`.
- Mapping holds: `PM position = textblock start + 1 + within-block UTF-16 offset`, with start obtained through `doc.descendants`. Emoji, combining characters, empty paragraphs, and nested-list offsets precisely match `textBetween`.
- Read-only (`editable: false`) allows selection/scrolling while leaving body/history unchanged and DOM `contenteditable=false`.

**Three measured public-API semantics frozen for the WP4 host:**

1. **Returning false from `doc.descendants` skips only that node's subtree, not the entire traversal.** After a match, mapping must short-circuit with a flag such as `done`; otherwise later blocks overwrite the result. A measurement incorrectly mapped block 1 to the last block's start. WP4's second-validation mapping must include this guard.
2. **Tiptap `focus` defers `view.focus()` through `requestAnimationFrame`**, confirmed in source and behavior. Browser focus completes next frame; tests/host assertions wait a frame. A separate case confirms jsdom RAF dispatch works.
3. **PM `view.focus()` is a safe no-op for noneditable views**, neither setting DOM focus nor allowing editing. Read-only navigation prioritizes selection/scrolling without editing, consistent with task section 12; do not assert DOM focus in read-only mode.

### 3.4 Near-20-MiB reads and cancellation (section 3.3 finding 5)

- Real filesystem: `ok-large`, exactly 20 MiB, loaded through default `readDocxDocument` adapters in **164ms**, with a 64-digit hexadecimal revision. This is the observed started-read completion window.
- Existing `searchTextWorkspace` verified cooperative cancellation: set `shouldStop` while three slow controlled reads are in flight; return `cancelled` after all three complete in fixed `start→done` order, without partial completed results. WP2 DOCX reuses before/after-read and matcher-loop checkpoints; reads themselves are not interrupted.

### 3.5 Dual concurrency (section 3.3 finding 6)

Test scaffold `runMixedSearch` follows the frozen design: total semaphore 4 + DOCX semaphore 2, sequential candidate acquisition, post-read cancellation checks. Latch verification:

- 12 candidates (6 TXT + 6 DOCX): peak total 4, peak DOCX 2, never exceeded. Completion follows all reads; read completion order does not affect commits, sorted outside the pool by natural candidate order.
- Cancel with 4 candidates in flight: all 4 reads finish, overall result is `cancelled`, with no partial results.

Frozen memory analysis: worst-case in-flight buffers ≈2 × 20 MiB DOCX + 2 × 5 MiB TXT = 50 MiB. Bounded reads use 20 MiB+1 and 5 MiB+1; DOCX ZIP/model have Task 7's separate budgets. Streaming bounded traversal/matching keeps memory/event-loop pressure acceptable; WP6 makes final UI/cancellation observations.

## 4. Frozen protocol and budgets (task section 4; all confirmed in WP0)

| Item                                                    | Frozen value                                                                                                     | Explanation                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Query length                                            | 256 UTF-16 units                                                                                                 | Task 6 contract                                                                                    |
| Combined TXT + DOCX candidates                          | 1000                                                                                                             | Combined, not 1000 of each                                                                         |
| DOCX candidates within total                            | 200                                                                                                              | Controls ZIP/import/model-memory pressure                                                          |
| Individual TXT size                                     | Existing 5 MiB                                                                                                   | Task 6                                                                                             |
| Individual DOCX compressed size / model and ZIP budgets | All Task 7 limits                                                                                                | 20 MiB / 128 entries / critical XML 1 MiB / total decompression 64 MiB / model 20 000 blocks, etc. |
| Matches returned per file                               | 200                                                                                                              | Task 6                                                                                             |
| Total returned matches                                  | 2000                                                                                                             | Task 6                                                                                             |
| Preview length                                          | 160 UTF-16 units                                                                                                 | Task 6                                                                                             |
| Total candidate-read concurrency                        | 4                                                                                                                | In flight ≤4, measured peak exactly 4                                                              |
| DOCX concurrent reads/imports                           | 2                                                                                                                | In flight ≤2, measured peak exactly 2                                                              |
| New truncation reason                                   | `docx-file-limit`                                                                                                | Priority: `file-limit` > `docx-file-limit` > `total-matches-limit` > `matches-per-file-limit`      |
| Candidate classification/order                          | Regular case-insensitive `.txt`/`.docx`; apply budgets after normalized relative-path natural ordering           | No following links/junctions; both controlled readers revalidate                                   |
| Data source                                             | Saved disk snapshots; DOCX only from successfully imported `DocxDocumentModel` projection                        | Excludes unmodeled content; zero-byte placeholder is blank without matches/errors                  |
| Navigation validation                                   | locateId + epoch + requestId + kind + relative path + revision + from/to + matchedText + host projection recheck | Failure only shows stale; no guessing/block-index jump/body change/dirty clearing                  |
| Added dependencies                                      | **None**                                                                                                         | Reuse matcher and public Tiptap/PM APIs; no database/index/worker                                  |
| Search-result commit                                    | Cancellation carries no partial completed results                                                                | Task 6 triple validation + epoch                                                                   |

## 5. Performance observations (one-off, not benchmark gates; temporary script removed)

| Scenario                                            | Result                                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Controlled near-20-MiB DOCX read on real filesystem | **164ms**, loaded, 64-digit hexadecimal revision                                                               |
| 20,000-block model-limit body projection            | **7ms**, 20 000 blocks, approximately 3.8 million UTF-16 units                                                 |
| Peak dual concurrency                               | Total 4 / DOCX 2, deterministic latch verification                                                             |
| Cancellation during reading                         | Cooperative: return `cancelled` after reads complete, without partial results; injected slow-read verification |

## 6. Desktop smoke evidence

| Verification                                 | Result                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| Development startup, `.\scripts\dev.cmd`     | **Passed**: dev server + Electron, alive 22s, no preload/React/resource errors |
| Production startup, `npm exec -- electron .` | **Passed**: loads `out/`, alive 18s, clean stdout/stderr                       |

## 7. Semantic conclusions and fixed WP1+ requirements

1. Projection and PM block order match exactly, including empty paragraphs, nested lists, cross-run marks, and within-run newlines. WP1 follows section 3.1; WP4 mapping includes the `descendants` termination guard.
2. Mapping is `PM position = textblock start + 1 + within-block offset`, also applicable to read-only editors.
3. Focus is delayed one frame; read-only views receive no DOM focus, an accepted platform behavior.
4. Dual concurrency is frozen at total 4 / DOCX 2. WP2 preserves sequential candidate acquisition, post-read cancellation checks, and natural sorting outside the pool.
5. Budgets, truncation priorities, and no partial results on cancellation are frozen in section 4.
6. Search is entirely read-only. This verification created no persistent files; temporary directories/scripts were cleaned up without workspace residue.

## 8. Changed files

| File                                                       | Change                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `tests/test-utils/temp-dir-cleanup.ts` (new)               | `removeDirWithRetry`: bounded EBUSY/EPERM junction cleanup retries, section 1.3                  |
| `tests/document/read-text-document.test.ts` (modified)     | Bounded retry for probe-directory/workspace-root cleanup, unchanged assertions                   |
| `tests/search/search-text-workspace.test.ts` (modified)    | Bounded retry for probe/workspace/link-case cleanup, unchanged assertions                        |
| `tests/docx/read-docx-document.test.ts` (modified)         | Same preventive fix for the potential flake, unchanged assertions                                |
| `tests/docx/docx-fixture-builder.ts` (modified)            | New `ok-read-only` / `ok-combining-emoji` / `ok-projection-mixed` / `ok-large`                   |
| `tests/docx/docx-fixture-suite.test.ts` (modified)         | 4 new fixture assertions: protection/combining characters/mixed structure/large file             |
| `tests/docx/docx-search-projection-scaffold.ts` (new)      | Frozen projection-rule scaffold, shared by tests and ported to product in WP1                    |
| `tests/docx/docx-search-projection.test.ts` (new)          | 16 cases: projection/PM equivalence/UTF-16/non-cross-block queries/budget-level linearity        |
| `tests/docx/docx-search-locate-assumptions.test.tsx` (new) | 9 cases: public navigation/read-only/near-20-MiB reads/cooperative cancellation/dual concurrency |
| `docs/tasks/task-008/TASK_008_WP0_REPORT.md` (new)         | This report                                                                                      |

No product functionality code or product DOCX-search UI exposure changed. `git status --short` contained only these files and the protected existing user modification to `docs/tasks/task-008/TASK_008_DOCX_WORKSPACE_SEARCH.md`.

## 9. Unresolved issues and known limitations

1. **Read-only DOM focus:** PM `view.focus()` safely does nothing for noneditable views. Selection + scrolling determine read-only navigation, consistent with task section 12 and recorded in 3.3.
2. **jsdom scroll values cannot be asserted:** `scrollIntoView` has no layout effect, with zero coordinates. Real-browser manual smoke covers scrolling, analogous to Task 6 limitation 4.
3. **File symlinks require elevation:** junctions work locally, but file-symlink creation returns EPERM. Existing conditional skips cover real-link integrations; mocks deterministically cover rejection.
4. **Near-20-MiB read/projection timings**, 164ms / 7ms, are one-off observations, not benchmark gates.
5. **Empty-run semantics:** conversions keep empty runs out of product models. Projection ignores them; PM `nodeFromJSON` rejects any empty text node. WP1 follows this frozen rule without affecting real models.
6. The projection scaffold is retired/replaced after WP1's product module lands, preserving equivalence assertions.

## 10. Gate conclusion

WP0 gates in task section 10: **all satisfied**.

- Repeatable Task 7 baseline: initial junction EBUSY was diagnosed/fixed, then 3 consecutive full `test` runs passed (32 files / 737 passes / 5 conditional skips). `typecheck`/`lint`/`format:check`/full `check`/`build` passed in sequence; development/production smoke passed.
- Projection/public-API verification recorded: projection ↔ PM equivalence through real fixtures/product importer; UTF-16/empty paragraphs/marks/nested lists; public selection/scroll/focus; read-only semantics; `descendants` guard. All measured findings are frozen in sections 3 and 7.
- No unresolved semantics: total 4 / DOCX 2 concurrency, cooperative cancellation, near-20-MiB read window, truncation priority, budgets, and navigation chain are frozen in section 4.
- No DOCX-search UI exposure or product functionality changes; working-tree changes cover only fixtures/verification/reliability/report.
