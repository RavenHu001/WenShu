# TASK-010 WP0 Report: Fixing the Baseline, Editor Transactions, and Resource Semantics

[简体中文](./TASK_010_WP0_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Scope: TASK-010 section 10 WP0 (all section 3 prerequisites, post-Task 9 quality/desktop
> baseline, all section 3.3 minimal Tiptap/ProseMirror verification, fixed replacement/budget
> semantics, section 4.10 performance observations, dependency assessment, and
> “docs/tasks/task-010/TASK_010_WP0_REPORT.md”).
> Implementation date: 2026-08-20; platform: Windows 11 (zh-CN, build 10.0.26200), Node.js
> 22.15.0 (project-local “.tools/node-v22.15.0-win-x64”), npm 10.9.2, Electron 37.10.3,
> TypeScript 5.9.3, Vitest 3.2.7, Tiptap 3.29.2 (@tiptap/core / @tiptap/pm / @tiptap/starter-kit),
> prosemirror-view 1.42.2, prosemirror-transform 1.12.0 (versions fixed through @tiptap/pm).
> This package exposes no current-DOCX search in product UI and implements no production
> matcher/plugin/controller/replace. No product-feature code or final-acceptance checkboxes were
> changed. README / PROJECT_BASELINE / TESTING completion states were not updated (WP7 responsibility).

## 1. Work-package declaration (items reported at start)

- Current branch and HEAD: branch “TASK-010”, HEAD “7b3d087aa6592ccecec345a356c8f2f38bda95a4”
  (commit message “TASK-010：当前 DOCX 内查找与替换”, the completed Task 10 planning commit).
- Working tree and existing user changes: initial “git status --short” was empty (clean working
  tree, **no existing user changes** to protect). Task 9 completion commit “9d30e2c” (Merge pull
  request #9) is merged into this branch's history.
- Previous recovery point: “7b3d087” (branch HEAD; the first package uses the Task 10 planning commit).
- Scope: baseline fixation and measurement/fixation of editor transaction/resource semantics only;
  add “docs/tasks/task-010/TASK_010_WP0_REPORT.md” and minimal technical-verification tests
  (test scaffolding, not product code).
- Non-goals: no product UI integration (SearchSidebar / DocumentPane / DocxEditorSessionHost /
  App unchanged); no production matcher/plugin/controller/replace; no added/modified IPC,
  preload, or DesktopApi; no dependencies; no final-acceptance checkbox changes; no completion-state documentation updates.
- Minimal fixture: “tests/docx/docx-current-search-assumptions.test.tsx” (22 cases, jsdom,
  retained as regression assets): real Tiptap Editor (same extension chain as product
  “DOCX_EDITOR_EXTENSIONS”) + live textblock projection/range mapping/Decoration/replacement
  transaction scaffolding; “document-tabs” pure-state fixtures (degraded/saving); near-limit
  fixtures (20,000 blocks; 1800 paragraphs × 4096 characters ≈ 7,498,830 serialized bytes,
  about 89% of the 8 MiB limit).
- Verification checklist: required reading; “git status”/branch/HEAD; full “check” and “build”
  (sequential, not parallel); test-file/pass/conditional-skip counts and reasons; development and
  production main-window smoke; all section 3.3 technical checks; section 4.10 performance
  observations; dependency assessment; diff review; another full “check”/“build” before completion.
- Expected report contents: declaration, required-reading review, quality/desktop baseline,
  fixture results and measurements, fixed-decision table, performance observations, dependency
  assessment, changed files, final review, known limitations, and WP0 gate conclusion.

## 2. Required-reading review (task section 3.1)

Read in full: “README.md”, “docs/architecture/PROJECT_BASELINE.md”,
“docs/development/DEVELOPMENT_ENVIRONMENT.md”, “docs/development/TESTING.md”,
“docs/tasks/task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.md” and completion report,
“docs/tasks/task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md” and completion report (including WP0),
“docs/tasks/task-008/TASK_008_DOCX_WORKSPACE_SEARCH.md” and completion report (including WP0),
“docs/tasks/task-009/TASK_009_BASIC_FILE_MANAGEMENT.md” and completion report (including WP0),
“docs/tasks/task-010/TASK_010_DOCX_FIND_REPLACE.md” (entire document), and directly related source/tests:

- Shared contracts: “src/shared/docx.ts”, “docx-convert.ts”, and “docx-search-text.ts” (all in full);
- Main-process reference: “src/main/search/match-text.ts” (in full, only to compare literal matcher semantics);
- Renderer: “lib/document-tabs.ts” (including editDocxTab / startDocxSave / completeDocxSave /
  confirmDocxCompatibility / invariants), “lib/use-documents.ts”, “lib/use-editor-sessions.ts”;
  “components/document/EditorSessionHost.tsx”, “DocxEditorSessionHost.tsx”, “DocumentPane.tsx”,
  “components/search/SearchSidebar.tsx”, “App.tsx”;
- Tests: “tests/document/find-replace.test.tsx”, “docx-editor.test.tsx”, “docx-locate-host.test.tsx”,
  “tests/docx/docx-search-projection.test.ts”, “docx-search-locate-assumptions.test.tsx”,
  “tests/search/result-locate-docx.test.tsx”, Task 9 path-migration/save-as/mutation-epoch tests,
  “vitest.config.ts”, and “tsconfig.test.json”.

## 3. Working tree and quality baseline (task section 3.2)

### 3.1 Execution environment

The controlled execution environment has no interactive terminal. All commands actually ran
through Git Bash calling project-local Node (“.tools/node-v22.15.0-win-x64”) and “cmd.exe”
subprocesses (“PROCESSOR_ARCHITECTURE=AMD64” injected, as in Task 9, affecting only architecture
selection in “scripts/npm.cmd”). Tests actually ran in jsdom/node; no assertions were mocked away.

### 3.2 Commands and results (starting baseline; “check” followed by “build”)

| Command                     | Result                                                         |
| --------------------------- | -------------------------------------------------------------- |
| “git status --short”        | Clean (no existing user changes)                               |
| “scripts\npm.cmd run check” | **Passed** (exit code 0; about 41 s, including Vitest 23.42 s) |
| “scripts\npm.cmd run build” | **Passed** (exit code 0; about 11 s)                           |

### 3.3 Test counts and conditional skips (measured post-Task 9 baseline)

- **All 54 test files passed, 1016 passed, 10 conditionally skipped (1026 total cases)**,
  exactly matching the Task 9 completion report baseline (54 files / 1016 passed / 10 skipped).
- All 10 conditional skips are real symlink/junction permission conditions (“it.runIf”):
  read-text-document 2, read-docx-document 2, search-text-workspace 1, search-mixed-workspace 1,
  resolve-workspace-entry 1, relocate-workspace-entry 1, trash-workspace-entry 1,
  reveal-workspace-entry 1. Mock adapters deterministically cover rejection branches.
- Only expected stderr: “wenshu: 清理临时文件失败 (EPERM/EACCES)” from saver/new-file
  cleanup-failure injection tests, consistent with Task 7/8/9 records.
- No “only”, unconditional “skip”, or weakened assertions; “typecheck” (5 tsconfigs), “lint”
  (--max-warnings=0), and “format:check” passed.

### 3.4 Build outputs (starting baseline)

| Output                            | Size        |
| --------------------------------- | ----------- |
| “out/main/index.js”               | 154.91 kB   |
| “out/preload/index.js”            | 4.10 kB     |
| “out/renderer/index.html”         | 0.57 kB     |
| “out/renderer/assets/index-*.js”  | 2,173.67 kB |
| “out/renderer/assets/index-*.css” | 25.83 kB    |

## 4. Desktop main-window smoke (development and production builds)

| Verification                                          | Result                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Development mode (“scripts\dev.cmd”)                  | **Passed**: dev server + Electron launched, 4 electron processes alive for 26 s, logs show successful preload build and no error/uncaught/failed; main window exists (PID 9188, nonempty title); 0 residual processes after process-tree cleanup |
| Production build (“node_modules\.bin\electron.cmd .”) | **Passed**: 4 electron processes alive for 16 s, no stdout/stderr errors; UTF-8 retest enumerated main window **PID 17660, title “文枢”**; 0 residual processes after process-tree cleanup                                                       |

## 5. Minimal Tiptap/ProseMirror technical verification (task section 3.3)

### 5.1 Fixtures and scaffolding

“tests/docx/docx-current-search-assumptions.test.tsx” (22 cases, all passed) uses real Tiptap
Editor with the product's “DOCX_EDITOR_EXTENSIONS” chain: StarterKit(levels 1-3, link:false) +
TextStyle + Color + FontSize + TextAlign. Verification uses public APIs:
“doc.descendants”/“isTextblock”/“textContent”/“textBetween”/“resolve”/“tr.replaceWith”/“tr.delete”/
“tr.insertText”/“setTextSelection”/“scrollIntoView”/“undo”/“redo”/Plugin/PluginKey/Decoration/
DecorationSet. “document-tabs” pure-state functions verify degraded/saving behavior. All
scaffolding exists only in the test file; WP1/WP2/WP4 must preserve these semantics when porting
it into product modules.

### 5.2 Verification results

| #   | Verification (task section 3.3)                                                                                                                                                                 | Result |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Live textblock projection has the same order/text as “joinDocxTextBlocks”/“projectDocxModelSearchText” (headings, across run marks, empty paragraphs, nested lists, emoji/combining characters) | ✓      |
| 2   | A match spanning marked runs maps consistently to one PM selection (“粗体跨run”)                                                                                                                | ✓      |
| 3   | Matches do not cross artificial “\n”; query/replacement containing newlines or exceeding 4096 rejected                                                                                          | ✓      |
| 4   | UTF-16 offset mapping for Chinese/emoji/surrogate pairs/combining characters (🎉, e+U+0301, 𠮷, 字符)                                                                                           | ✓      |
| 5   | Decoration marks all matches and current match simultaneously (class + DOM span assertions); applying/clearing changes no content or undo history                                               | ✓      |
| 6   | After document transactions, DecorationSet safely updates through “mapping” (shifts on insertion), then recalculation replaces the old set                                                      | ✓      |
| 7   | Single-run replacement (short/long/Chinese/emoji/combining/same text), valid model and undoable                                                                                                 | ✓      |
| 8   | Measured marks behavior of “insertText” and explicit “replaceWith”; fixed explicit “replaceWith” + start-character marks                                                                        | ✓      |
| 9   | Across differently marked runs: replacement inherits starting marks; unmatched formatting retained                                                                                              | ✓      |
| 10  | Empty replacement = deletion; paragraph/heading/list structure retained (including TrailingNode record, 5.3-F2)                                                                                 | ✓      |
| 11  | Each replace-all match inherits its own starting marks (same query in bold/plain/italic contexts)                                                                                               | ✓      |
| 12  | Execution-time revalidation: invalid old range → “stale-range” rejection and 0 dispatch                                                                                                         | ✓      |
| 13  | Invalid candidate model (hardBreak injection) → “tiptapJsonToDocxModel” invalid → 0 dispatch, unchanged document                                                                                | ✓      |
| 14  | Reverse-order single-transaction replace-all (no drift with different replacement lengths); one undo/redo fully restores/reapplies, only one history event                                      | ✓      |
| 15  | 2000 allowed (truncated=false); from the 2001st match, scanning marks truncated, rejects all replace-all, 0 partial replacement                                                                 | ✓      |
| 16  | Replace-all with 0 matches does nothing and does not dispatch                                                                                                                                   | ✓      |
| 17  | Budget failure: near-serialization-limit document + 1,000,000-character candidate replacement → serialization-limit invalid → 0 dispatch, 0 dirty                                               | ✓      |
| 18  | read-only: decorations, selection, scrolling applicable (focus is safe no-op); replacement command defensively rejects, no dispatch                                                             | ✓      |
| 19  | Unconfirmed degraded rejects; confirmation bound to current revision enables replacement in same editor; reading new revision invalidates old confirmation                                      | ✓      |
| 20  | After replacement during saving (editDocxTab), old save completion retains loaded-dirty + new model (does not clear edits made during save)                                                     | ✓      |
| 21  | 20,000 textblocks: projection/scan/decorations/one input transaction (one-time performance observations)                                                                                        | ✓      |
| 22  | Near “DOCX_MAX_MODEL_SERIALIZED_BYTES”: projection/scan/decorations/budget-failing candidate conversion (one-time performance observations)                                                     | ✓      |

### 5.3 WP0 measured findings (all fixed in this section and section 6)

- **F1 (exact starting-marks semantics)**: when a match starts precisely at the boundary of two
  text nodes with different marks, “doc.resolve(from).marks()” returns **preceding-boundary**
  marks from the previous text node. Measured in consecutive bold+plain+italic text: for a match
  starting at a plain character, “resolve().marks()” returns “['bold']”. The fixed rule is
  therefore to inherit marks of the match's starting **character**: obtain marks of the text node
  containing that character (scaffold “startCharMarks”: “$pos.parent.forEach” finds the text
  node containing “from”). “insertText” and explicit “replaceWith” both inherit starting marks
  at a paragraph-start boundary. The uniform rule is **explicit
  “tr.replaceWith(from, to, schema.text(repl, startCharMarks))”**, without dependence on “insertText” internals.
- **F2 (Tiptap v3 StarterKit default TrailingNode)**: when the document ends in a non-paragraph
  block (measured with a list; source confirms “disabledNodes=[paragraph]”, so headings/lists/code
  blocks also trigger it), the editor automatically appends an empty paragraph. Measured doc
  content types: “heading/paragraph/bulletList/paragraph”. This block is at the end and **all
  preceding block ordinal/from/to values stay unchanged**, so Task 8 locating is unaffected.
  Current search uses live doc as its only source (section 4.1); an empty block has no matches,
  keeping semantics consistent. Fixed: WP1 directly uses live textblock projection including
  this empty block, without stripping or guessing. If future requirements demand block-by-block
  equality with model projection, the host may configure “trailingNode:false” (no product change
  in this package; the relevant WP must decide and record it).
- **F3 (measured difference from CodeMirror)**: pinned “@codemirror/search” source confirms
  case-insensitive matching uses “x.normalize("NFKD")” + “toLowerCase” (Unicode-level), with
  normalization enabled by default. Task 6 “matchText” folds only ASCII “A-Z”, without
  normalization. Difference: “É/é” and “e\u0301/é” match in CodeMirror but not matchText;
  Chinese is unaffected. Task 10 section 4.3 already fixes “literal + case toggle, no Unicode
  normalization”, so **retain matchText semantics** (ASCII-only folding, no normalization).
  Record this difference as a known limitation in the WP1 completion report; do not rewrite TXT's engine.
- **F4 (truncated must be explicit)**: after collecting 2000 matches, scanning sets
  “truncated=true” if the body may still contain more matches. Replace-all cannot look only
  at “2000 collected”: 2001+ still collects 2000, and must reject the entire operation using
  truncated. Measured: searching “a”.repeat(4000) for “a” collects 2000/truncated=true →
  reject; searching “aa” yields exactly 2000/truncated=false → allow.
- **F5 (decorations and history)**: a transaction containing only “setMeta(key, DecorationSet)”
  changes no doc and adds no history step (“undo()” has no effect). Document transactions
  without meta update decoration ranges safely through “value.map(tr.mapping, newState.doc)”.
  Decoration spans render synchronously after dispatch in jsdom, allowing class assertions.
- **F6 (save semantics)**: “startDocxSave” is a no-op on a “loaded-clean” tab (existing behavior:
  dirty first, then save). Replacement during saving follows the same “editDocxTab” path as
  ordinary typing. “completeDocxSave” decides whether to clear dirty using the “editRevision”
  at save start; a new revision produced during saving keeps completion “loaded-dirty” and
  retains the new model (measured assertion).
- **F7 (read-only locating)**: retested the Task 8 fixed behavior: read-only views accept
  decorations, “setTextSelection”, and “scrollIntoView”. “focus()” is a safe no-op (no DOM
  focus or editing enabled). Replacement is defensively rejected inside the command, independent of button disabling.

## 6. Fixed decisions (corresponding task section 4 items)

| Item                                      | Fixed value / rule                                                                                                                                                                                                                      | Evidence                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Search source                             | Active Tiptap/ProseMirror live “state.doc” (including unsaved changes), no disk/stale-model search                                                                                                                                      | Task 4.1; all package cases use live doc |
| Body projection                           | Reuse “joinDocxTextBlocks”: depth-first textblocks, exactly one artificial “\n” between blocks, UTF-16 offsets; mapping “block content start pos+1 + in-block offset”; “descendants” needs a termination guard (Task 8 fixed decision)  | Cases 1/2/4; Task 8 WP0                  |
| Inputs                                    | Nonempty query, ≤4096 UTF-16, single line (reject “\r”/“\n”); replacement ≤4096 UTF-16, single line                                                                                                                                     | Case 3                                   |
| Matching                                  | literal + caseSensitive; ASCII-only case folding; left-to-right, non-overlapping; at most 2000; “truncated=true” from match 2001                                                                                                        | Cases 3/15; F3                           |
| Replace all                               | 0 matches no-op; truncated or >2000 rejects all (0 partial replacement); end-to-start in one transaction; each match inherits its own starting-character marks; one undo/redo                                                           | Cases 11/14/15/16; F4                    |
| Replace current                           | Rescan + range revalidation at execution (both pmFrom/pmTo match); invalid → reject and recalculate                                                                                                                                     | Case 12                                  |
| Marks inheritance                         | Nonempty replacement inherits text-node marks of the **starting character** (“startCharMarks”), not preceding-boundary marks; empty = deletion; paragraph/heading/list structure and surrounding formatting retained                    | Cases 8/9/10/11; F1                      |
| Model prevalidation                       | Before dispatch, run “tiptapJsonToDocxModel” + “validateDocxDocumentModel” (including serialization budget) on candidate “tr.doc.toJSON()”; any failure → 0 dispatch, 0 dirty                                                           | Cases 13/17                              |
| read-only                                 | Find/decorate/locate allowed; replacement rejects inside command (independent of disabled state)                                                                                                                                        | Case 18; F7                              |
| degraded                                  | Unconfirmed permits find, not replacement; after “compatibilityConfirmationRevision === document.revision”, replacement allowed (reuse existing confirmation entry, no editor recreation); revision change invalidates old confirmation | Case 19                                  |
| saving                                    | Replacement has ordinary typing semantics (editDocxTab); old save completion must not clear changes made during save                                                                                                                    | Case 20; F6                              |
| Performance strategy (WP2 recommendation) | Synchronous full recalculation (local near-limit scan about 61ms) + single scheduling after edit transactions + generation-based stale-computation discard; no worker/index/persistent cache                                            | Section 7                                |
| Dependencies                              | None added by default; this package uses only installed @tiptap/*, existing matcher, and shared model/conversion                                                                                                                        | Section 8                                |

## 7. Performance observations (section 4.10; one-time, not a benchmark gate)

| Scenario                                                                     | Data (local jsdom/node) |
| ---------------------------------------------------------------------------- | ----------------------- |
| Live projection of 20,000 textblocks (model limit)                           | 10 ms                   |
| Scan 20,000 textblocks (2000 matches, truncated)                             | 8 ms                    |
| Build / apply (DOM render) 2000 decorations in 20,000 textblocks             | 48 ms / 82 ms           |
| One input transaction in 20,000 textblocks (insertText + view update)        | 30 ms                   |
| Live projection near serialization limit (7,498,830 bytes / 8,388,608)       | 1 ms                    |
| Near-limit scan for “aa” (2000 matches, truncated)                           | 61 ms                   |
| Near-limit 2000-decoration construction / application                        | 5 ms / 76 ms            |
| Near-limit budget-failing candidate model conversion (+1,000,000 characters) | 17 ms                   |

Conclusion: local full synchronous recalculation (projection + scanning + decorations) takes
about 70-140 ms for near-limit documents; ordinary documents are well below the 100 ms target.
WP2 should fix “synchronous recalculation + single scheduling + generation discard” as recommended
in section 6, without prematurely introducing debounce/workers/indexes. If WP6 measures stutter,
evaluate in section 4.10 order. These are one-time observations, not hard CI wall-clock assertions;
WP6 smoke testing observes real-browser scrolling/rendering.

## 8. Dependency assessment

- No dependency was installed or modified (“package-lock.json” unchanged).
- Verification uses only “@tiptap/core”, “@tiptap/pm” (state/view/model), “@tiptap/starter-kit”,
  “@tiptap/extension-text-style”, “@tiptap/extension-color”, “@tiptap/extension-text-align”
  (all already installed, version 3.29.2), existing “src/main/search/match-text.ts” (pure-function
  reference semantics), “src/shared/docx.ts”/“docx-convert.ts”/“docx-search-text.ts”.
- Conclusion: **all fixed semantics are achievable without new dependencies** (the last item
  of task section 3.3 holds).

## 9. Changed files and diff review

| File                                                  | Change                                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| “tests/docx/docx-current-search-assumptions.test.tsx” | **Added**: TASK-010 WP0 minimal Tiptap/ProseMirror verification (22 cases, jsdom; test scaffolding, not product code) |
| “docs/tasks/task-010/TASK_010_WP0_REPORT.md”          | **Added**: this report                                                                                                |

- “git status --short”: only the two added files above (“??”). **No product code, preload, IPC,
  DesktopApi, existing tests, or documentation-checkbox changes**. “package-lock.json” unchanged.
  Temporary logs (“*.log”) are covered by .gitignore and located at repository root, not committed.
- Preload/IPC exposure review: still the fixed post-Task 9 set (workspace 6 + document 4 + save-as 2
  - search 2 + window 3 = 17 handles), no additions.
- Final acceptance checkboxes unchanged (all section 11 items still “[ ]”); no current-DOCX search exposed in product UI.

## 10. Full check/build before completion (rerun after writing the report)

| Command                     | Result                                                         |
| --------------------------- | -------------------------------------------------------------- |
| “scripts\npm.cmd run check” | **Passed** (exit code 0; about 45 s, including Vitest 27.42 s) |
| “scripts\npm.cmd run build” | **Passed** (exit code 0; about 11 s)                           |

## 11. Unresolved issues and known limitations

1. jsdom scrolling coordinates cannot be asserted (“scrollIntoView” is a layout no-op); real
   scrolling/focus belongs to WP6 manual smoke testing (retains Task 6/8 limitations).
2. CodeMirror current-search versus Task 6 matcher case/normalization differences
   (NFKD+toLowerCase+normalization versus ASCII-only folding without normalization) are measured
   and confirmed. Task 10 fixes matchText semantics, leaves TXT's engine unchanged, and records
   this as known behavior in the WP1 completion report.
3. Default Tiptap v3 StarterKit TrailingNode appends an empty trailing paragraph when the document
   ends with a non-paragraph block. This package fixes “live doc as sole source, do not strip
   the block”. For block-by-block equivalence with model projection, the relevant WP must decide
   on “trailingNode:false” (no product-code change in this package).
4. Performance figures are one-time local jsdom/node observations, not benchmark gates. Near-limit
   editor creation was not timed separately (shared fixture lazy loading).
5. Read-only view “focus()” is a safe no-op (already fixed in Task 8): read-only locating relies
   on selection + scrolling.
6. All assertions in this package ran in jsdom. Real-browser rendering paths (decoration DOM
   updates, scrolling, focus) are covered by WP6 smoke and WP3/WP4 component tests.

## 12. WP0 gate conclusion

**WP0 gate satisfied** (the three WP0 items in task section 10 + all section 3.3 verification):

1. **Reproducible baseline**: measured post-Task 9 baseline matches its completion report
   (54 files / 1016 passed / 10 conditional skips, all real symlink/junction permission conditions
   with mocked rejection-branch coverage). “typecheck”/“lint”/“format:check”/full “check”/“build”
   passed sequentially; development/production main-window smoke passed (production window PID
   17660, title “文枢”).
2. **Actual test evidence for key ProseMirror behavior**: all section 3.3 verification is fixed
   in 22 real Tiptap/PM cases: projection consistent with Task 8; across-mark run ranges;
   Chinese/emoji/combining-character UTF-16 mapping; Decoration and post-transaction mapping;
   insertText/replaceWith marks; start-character marks inheritance; empty replacement;
   reverse-order single-transaction replace-all and one undo; pre-dispatch model/budget
   validation; read-only/degraded/saving; 2000/2001 and near-limit performance.
3. **No unresolved replacement/budget semantics**: starting marks (F1), TrailingNode (F2),
   truncated whole-operation rejection (F4), model/budget failure with 0 dispatch,
   read-only/degraded/saving permissions, and performance strategy are fixed with assertion
   evidence. The rule “fixed assumption fails → update Task 10 plan first and stop” was not
   triggered: the two findings are supplementary fixed records, not changes to planning semantics.

**Conclusion: TASK-010 WP0 is complete; WP1 may begin.** This package implemented no WP1+ work,
integrated no product UI, and changed no final-acceptance checkboxes.
