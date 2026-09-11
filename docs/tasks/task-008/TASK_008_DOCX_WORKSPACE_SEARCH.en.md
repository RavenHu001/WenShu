# TASK-008: Workspace DOCX Body-Text Search and Rich-Text Result Navigation

[简体中文](./TASK_008_DOCX_WORKSPACE_SEARCH.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

## Task status

> **Status: Completed (2026-08-15; WP0–WP7 implemented and accepted individually; two medium issues found in the post-completion audit were fixed with regression tests; see the [TASK-008 completion report](./TASK_008_COMPLETION_REPORT.en.md)).**
>
> Planned on 2026-08-15. Execution starts with WP0 and proceeds package by package; mark complete only after every section 11 criterion is met.
>
> This builds on Task 6's workspace TXT search/navigation and Task 7's structured DOCX model/rich-text editing workflow. All Task 1–7 behavior is the regression baseline.

## 1. Purpose

Extend workspace search from regular UTF-8 TXT only to one query over saved workspace TXT and basic DOCX body text, with safe DOCX results that:

1. Open or activate a unique DOCX tab;
2. Validate the search-time disk revision;
3. Validate the range and matched text in the current live DOCX body projection;
4. Map projected offsets to public ProseMirror document positions;
5. Set rich-text selection, scroll into view, and focus;
6. Show only a non-destructive notice for stale results, structural changes, or failed mapping, without incorrect navigation or body changes.

Do not build a second search UI, treat DOCX as UTF-8 TXT, or search OOXML, Mammoth HTML, or editor DOM directly. Task 7's verified `DocxDocumentModel` is the sole semantic source of searchable body text.

## 2. User experience after completion

Users should be able to:

- Enter one literal query in the existing sidebar to search saved TXT/DOCX in the current workspace;
- Keep Task 6's case toggle, start, cancel, repeated submissions, grouped results, statistics, and truncation notices;
- See explicit TXT / DOCX labels in file groups;
- Click TXT results through existing safe CodeMirror navigation;
- Click DOCX results to open/activate a unique tab and select, scroll, and focus while the match remains valid;
- Receive deterministic behavior for unopened/open/loading/dirty/read-only/degraded DOCX;
- See “搜索结果已过期” (search result is stale) after external edits, changed body structure, invalid ranges, or tab-lifecycle changes, without guessed navigation;
- Search modeled body text in read-only/degraded documents while retaining compatibility notices;
- Understand that workspace search covers saved disk snapshots, excluding unsaved edits;
- Understand that unmodeled images, tables, headers/footers, comments, tracked changes, and similar content are outside the search promise.

## 3. Prerequisite checks

### 3.1 Required reading

Read and verify before implementation:

- `README.md`;
- `docs/architecture/PROJECT_BASELINE.md`;
- `docs/development/TESTING.md`;
- `docs/tasks/task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.md`;
- `docs/tasks/task-006/TASK_006_COMPLETION_REPORT.md`;
- `docs/tasks/task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md`;
- `docs/tasks/task-007/TASK_007_COMPLETION_REPORT.md`;
- `src/shared/search.ts`;
- `src/main/search/match-text.ts`;
- `src/main/search/search-text-workspace.ts`;
- `src/main/search/search-ipc.ts`;
- `src/shared/docx.ts`;
- `src/shared/docx-convert.ts`;
- `src/main/docx/read-docx-document.ts`;
- `src/renderer/lib/use-workspace-search.ts`;
- `src/renderer/lib/use-documents.ts`;
- `src/renderer/components/document/EditorSessionHost.tsx`;
- `src/renderer/components/document/DocxEditorSessionHost.tsx`;
- `src/renderer/components/document/DocumentPane.tsx`;
- `src/renderer/App.tsx`.

### 3.2 Working tree and quality baseline

At WP0 start:

1. Confirm current branch/working tree and protect existing changes.
2. Run `npm run check`.
3. Run `npm run build`.
4. Record test-file/pass/conditional-skip counts and skip reasons.
5. Confirm development and production can at least open the main window.
6. Verify no regressions in Task 6 TXT search/cancellation/navigation or Task 7 DOCX opening/editing/saving/compatibility notices.

Diagnose and repair baseline failures first; do not mix existing failures into Task 8.

### 3.3 Technical verification required in WP0

Use minimal fixtures to verify and record:

- Model projection and Tiptap/ProseMirror text-block order match exactly;
- Regular paragraphs, headings, empty paragraphs, cross-run marks, bullets, numbering, and nested lists map reliably;
- JavaScript UTF-16 offsets match PM text positions for Chinese, emoji, and combining characters;
- `setTextSelection`, `scrollIntoView`, and `focus` work through public APIs without private DOM access;
- Read-only editors show selection/scrolling without gaining editing capability;
- Cancellation during a near-20-MiB DOCX read follows existing cooperation: started reads may finish, but results no longer commit;
- DOCX concurrency 2 and total-read concurrency 4 have acceptable memory/UI responsiveness.

If any conclusion fails, update fixed decisions and risks before WP1.

## 4. Fixed product and protocol decisions

### 4.1 One search entry for TXT and DOCX

- Existing workspace sidebar remains the only entry.
- A query searches regular `.txt` and `.docx` together by default, without a hidden opt-in.
- TXT query/matching/preview/order/navigation semantics remain Task 6's.
- DOCX uses separate controlled reading/projection, never `readTextDocument`.
- Results follow normalized workspace-relative natural order, independent of type or completion order.
- Each path produces one file group and opens one tab.

### 4.2 Data source and compatibility scope

- Search only saved disk snapshots, excluding dirty-tab edits.
- TXT uses strict UTF-8 body text after BOM removal.
- DOCX reuses `readDocxDocument` for path/type/size/ZIP/OOXML/budgets/revision/import.
- DOCX search text comes only from successfully imported `DocxDocumentModel`.
- `supported`, `degraded`, and `read-only` can search body text present in the model.
- Damaged/encrypted/disguised/oversized/unreadable/unimportable DOCX are isolated per-file errors counted as skipped.
- Zero-byte DOCX placeholders are blank, with no matches or errors.
- Exclude unmodeled image alt text, tables, headers/footers, footnotes/endnotes, comments, deleted tracked-change text, fields, embedded objects, and macros.
- Searching triggers no save, compatibility confirmation, autosave, reread, or backup creation.

### 4.3 Canonical DOCX body projection

Add a pure function projecting `DocxDocumentModel` into deterministic searchable text and block mappings:

1. Traverse depth-first in document order.
2. Each paragraph/heading forms one text block.
3. List containers generate no text; contained paragraphs/headings form blocks depth-first.
4. Concatenate all run `text` unchanged; marks, sizes, colors, alignment, heading levels, and list numbering do not enter search text.
5. Insert exactly one artificial `\n` between adjacent blocks.
6. Retain empty paragraphs and adjacent separators so model order matches editor block indices.
7. Add no extra leading/trailing newline.
8. Use UTF-16 code units, matching JavaScript strings and PM positions.
9. Carry block index, projected `from/to`, and body only for in-process mapping; do not send models, paths, or PM nodes across IPC.
10. Depend on no Electron, Node.js, Mammoth, Tiptap, ProseMirror, DOM, or filesystem.

Queries still reject newlines, so matches cannot cross artificial separators. Run boundaries are not search boundaries: contiguous text split by bold, italic, or other marks still matches.

### 4.4 Query, matching, and preview semantics

- Retain Task 6's single-line literal queries of 1–256 UTF-16 units.
- Retain case-sensitive toggle, without user regex.
- Case-insensitive matching folds ASCII letters only, preserving offsets.
- Matches are non-overlapping and ordered by ascending `from` within each file.
- DOCX `from/to` refer to its entire canonical projection.
- DOCX line/column are 1-based projected coordinates. Explain “line/column in extracted body text,” without pretending to provide Word-page positions.
- Preview remains a safe single-line text snippet rendered by React text nodes.
- Never log queries, full body, model, raw OOXML, or matched content.

### 4.5 Fixed resource limits

Task 8 uses:

| Item                              |             Limit |
| --------------------------------- | ----------------: |
| Query length                      |  256 UTF-16 units |
| Combined TXT + DOCX candidates    |              1000 |
| DOCX candidates within total      |               200 |
| Individual TXT size               |    Existing 5 MiB |
| Individual compressed DOCX size   |   Existing 20 MiB |
| Individual DOCX model/ZIP budgets | All Task 7 limits |
| Matches per file                  |               200 |
| Total matches                     |              2000 |
| Preview length                    |  160 UTF-16 units |
| Total candidate-read concurrency  |                 4 |
| Concurrent DOCX reads/imports     |                 2 |

- 1000 is combined, not 1000 per type.
- DOCX 200 controls ZIP/import/model-memory pressure.
- Add `docx-file-limit` truncation.
- Priority: `file-limit` > `docx-file-limit` > `total-matches-limit` > `matches-per-file-limit`.
- Return explicit truncation at budgets; exclusions are not read failures.
- Add no database, persistent index, worker thread, subprocess, or resident background service.
- If WP0 proves concurrency unacceptable, reduce it; never raise limits without evidence.

### 4.6 Compatible evolution of shared contracts

Retain `WorkspaceTextSearchRequest`, `WorkspaceTextSearchResult`, and `search.textWorkspace`. From Task 8, “Text” means each supported document's canonical searchable text, not only `.txt`. Avoid rewriting the entire chain solely for naming.

Add a required discriminator to `WorkspaceTextSearchFileResult`:

```ts
type WorkspaceSearchDocumentKind = 'txt' | 'docx';

interface WorkspaceTextSearchFileResult {
  readonly kind: WorkspaceSearchDocumentKind;
  readonly relativePath: string;
  readonly revision: string;
  readonly matches: readonly WorkspaceTextSearchMatch[];
  readonly truncated: boolean;
}
```

Other match fields remain compatible:

- TXT `from/to` still target original TXT body.
- DOCX `from/to` target canonical DOCX projection.
- Controlled main-process classification produces `kind`; renderer never guesses from display text.
- Requests add no roots, extension lists, glob, parsing options, concurrency, or budgets.
- preload retains fixed start/cancel methods without generic IPC.

### 4.7 Candidate traversal, reading, and cancellation

- Obtain root from main-process `workspace-session`.
- Follow no symlinks, junctions, or other reparse points.
- Candidates are regular case-insensitive `.txt`/`.docx` only.
- A global natural relative-path priority queue selects the first 1000 and applies deterministic budgets; subdirectory depth-first traversal must not exhaust the budget early.
- Reuse `readTextDocument` for TXT and `readDocxDocument` for DOCX.
- Total pool ≤4; DOCX read/import in flight ≤2.
- New searches cancel old ones; at most one active search per window.
- Check cancellation at directory batches, entries, before/after reads, projection, and matching loops.
- Started TXT/DOCX reads may finish but cannot commit after cancellation.
- Window destruction, workspace switching, unmounting, and updated requests invalidate old tasks.
- Root unreadability fails overall; subdirectory/per-file errors are isolated.
- Search is read-only, without backups, temporary files, indexes, or caches.

### 4.8 DOCX result navigation and second validation

Navigation must bind at least:

- Unique `locateId`;
- Workspace epoch;
- Search `requestId`;
- File `kind`;
- Normalized relative path;
- Search-time disk `revision`;
- Projected `from/to`;
- Actual `matchedText`.

Fixed flow after clicking a DOCX result:

1. Confirm current completed-result membership.
2. Use generic `openFile` to open/activate a unique tab; wait for an existing loading read.
3. Confirm the returned tab is DOCX with a successful snapshot/model.
4. Require exact equality between tab disk-baseline and search revision.
5. Regenerate projection from the current live model.
6. Validate `from/to` bounds and exact projected slice equality to `matchedText`.
7. Send the target with `locateId` to that DOCX host.
8. Host builds equivalent blocks from public nodes of the current PM document.
9. Revalidate full projection/target slice/range against edits between App checking and effect execution.
10. Match must lie entirely inside one real block; map its public PM content start plus within-block UTF-16 offset.
11. Use public selection, scroll, and focus commands.
12. Host reports applied/stale through `locateId`; App accepts only the current request's report.
13. Apply each target once; ordinary rerenders, tab switches, or equivalent model writeback must not repeatedly steal focus.

Post-completion audit additionally froze: click arguments must be the original group/match objects in current completed results. While awaiting DOCX reads/host reports, new search, cancel, or replaced completed `requestId` immediately invalidates old navigation even if workspace epoch is unchanged, preventing old selections and late notices.

Any failed step must not guess nearest text, jump by block index, clear dirty, edit body, or save. Only activate the tab and show a non-destructive stale notice.

### 4.9 Dirty, formatting changes, and compatibility

- Do not reject every dirty DOCX navigation.
- Allow when current projection at original `from/to` still exactly equals `matchedText`.
- Insertion/deletion before a match makes offsets stale even if identical text exists elsewhere.
- Mark/size/color/alignment changes allow navigation when projection remains unchanged.
- Changed list/paragraph structure with inconsistent projection/block mapping is stale.
- Read-only allows selection, scrolling, copying without enabling edits.
- Searching/navigating degraded content is not compatibility-edit confirmation; preserve its gate.
- External formatting-only changes alter raw-byte revision, making old disk-search results stale at revision validation.

### 4.10 UI and accessibility

- Explain search as “搜索工作区中已保存的 TXT 和 DOCX 正文” (search saved TXT/DOCX body text in the workspace).
- Show accessible TXT / DOCX group labels.
- Retain scanned/matching-files/matches/skipped/truncated statistics.
- Explain DOCX extracted-text coordinates without fabricated page numbers.
- Preserve Task 6 no-workspace/searching/cancelled/empty/error/truncated semantics.
- Clearly exclude unsaved changes in the sidebar notice.
- Do not claim complex DOCX results cover unsupported content.
- Current-file find/replace remains TXT-only. With active DOCX, show an unavailable explanation or disabled entry, never an apparently available unresponsive control.
- No `dangerouslySetInnerHTML` or parsing structured fields from display strings.

### 4.11 Dependencies and state management

- No production dependencies expected.
- Reuse Mammoth, JSZip, Tiptap/ProseMirror, matcher, and search controller.
- Add no Zustand, Redux, database, index library, search binary, or generic task framework.
- If a dependency is necessary, record version, purpose, license, size, and why existing capabilities are insufficient before the package starts.

## 5. State model and required invariants

### 5.1 Search state

Retain Task 6 idle / searching / completed / cancelled / error and:

- Current input;
- Submitted query;
- Case option;
- Current requestId;
- Starting workspace epoch;
- Completed results/statistics;
- Current navigation request;
- Non-destructive stale notice.

Result files add `kind`; navigation targets add `locateId` and file type.

### 5.2 Required invariants

1. At most one active workspace search per window.
2. At most one group per path in a result.
3. Group `kind` matches the controlled main-process reading branch.
4. One tab per path.
5. Existing TXT query/matching/order/navigation/stale semantics remain.
6. DOCX search text comes only from valid `DocxDocumentModel`.
7. DOCX queries never cross artificial block separators.
8. Marks do not affect offsets; text/structural order do.
9. Results represent disk revision, not unsaved edits.
10. Navigation validates workspace, request, tab, type, revision, range, and matched text together.
11. DOCX host rechecks live projection before actually changing selection.
12. Stale navigation never changes body, clears dirty, saves, or rereads.
13. Read-only/degraded search preserves editing/save gates.
14. Cancellation carries no partial completed results.
15. Search never writes workspace or leaves `.wenshu-*`, index, or cache files.
16. Renderer cannot submit roots, absolute paths, parsing strategies, or limits.

### 5.3 Asynchronous commit conditions

Search-result commits require:

- Controller still mounted;
- Current requestId;
- Unchanged workspace epoch;
- Main-process task still belongs to sending window;
- Request not cancelled;
- Result shape passes controlled protocol validation.

Navigation commits require:

- Latest locateId;
- Unchanged workspace epoch;
- Search requestId still matches current completed results;
- Existing tab with matching path/type;
- Settled reading;
- Valid revision/range/matched text;
- Host report for the same locateId.

## 6. Suggested module and file responsibilities

### 6.1 DOCX searchable body projection

Add `src/shared/docx-search-text.ts`:

- `projectDocxModelSearchText(model)`;
- Canonical text and block-span mapping types;
- Depth-first traversal/artificial newline rules;
- Pure runtime, without framework dependencies;
- Caller guarantees valid model; development assertions may reuse validation;
- Unit tests for structure, UTF-16, empty blocks, marks, and lists.

Do not embed projection in importers, exporters, or React components.

### 6.2 Main-process mixed searcher

Extend `src/main/search/search-text-workspace.ts`, or extract small candidate readers without duplicating traversal:

- Classify TXT / DOCX;
- Reuse `readTextDocument` for TXT;
- Reuse `readDocxDocument` and projection for DOCX;
- Share the existing literal matcher;
- Enforce total 1000/DOCX 200 candidates and total 4/DOCX 2 concurrency;
- Preserve stable ordering/statistics/error isolation/cooperative cancellation;
- Return groups with `kind`;
- Do not retain full DOCX models in final results;
- Register no generic IPC.

### 6.3 Shared contracts, IPC, and preload

Extend:

- `src/shared/search.ts`: kind, truncation reason, comments, validation;
- `src/main/search/search-ipc.ts`: preserve task identity/cancellation;
- `src/shared/desktop-api.ts`: update only canonical-body search explanations;
- `src/preload/index.ts`: preserve fixed `textWorkspace` / `cancelTextWorkspace` shapes.

Request shape stays unchanged; add no file-type/root/parsing parameters.

### 6.4 Renderer controller and results UI

Extend:

- `use-workspace-search.ts`: accept kind results, preserve epoch/late-result guards;
- `SearchResults.tsx`: type labels and extracted-DOCX positions;
- `SearchSidebar.tsx`: scope, unsaved notices, current-document capability state;
- Styles: necessary labels/notices only, without redesigning the sidebar.

### 6.5 Generic opening and navigation coordination

Extend `App.tsx`:

- Replace TXT-only `openTextFile` result opening with generic `openFile`;
- Match result kind to actual tab type;
- Validate TXT against current live content;
- Validate DOCX through canonical projection;
- Create uniform targets with locateId;
- Receive applied/stale host reports;
- Invalidate old targets on new navigation/workspace switch/tab close/unmount.

If logic grows, extract opening → validation → target dispatch into a renderer helper/hook instead of further expanding `App.tsx`.

### 6.6 TXT and DOCX hosts

- `EditorSessionHost.tsx`: preserve CodeMirror behavior while adopting uniform locateId/outcome;
- `DocxEditorSessionHost.tsx`: public-node projection, revalidation, mapping, selection, scrolling, focus;
- `DocumentPane.tsx`: send targets only to the matching active-tab kind;
- Do not let `DocumentPane` read private CodeMirror/Tiptap state;
- Do not manipulate `.ProseMirror` DOM, browser Range, or unpublished internal fields.

## 7. Electron and security boundaries

### 7.1 Renderer capabilities

Renderer may only:

- Submit fixed query, case toggle, and requestId;
- Submit fixed cancellation requestId;
- Receive normalized relative paths, kind, revision, matches, statistics, and stable errors;
- Open results through existing `document.readDocx(relativePath)`;
- Use public selection/scroll APIs in in-memory editor sessions.

### 7.2 Prohibited capability expansion

Renderer must not submit/receive:

- Workspace roots or absolute paths;
- Glob, arbitrary extensions, encoding, ZIP/XML options;
- Read concurrency, size, or decompression budgets;
- Raw DOCX, OOXML, unsanitized HTML, Buffer, ZIP entries, handles;
- Shell commands, external programs, network URLs;
- Generic IPC invoke/filesystem/task-cancel interfaces;
- Ignore-revision, skip-compatibility, or guess-navigation switches.

### 7.3 Required security properties

- Preserve `nodeIntegration: false`, `contextIsolation: true`, sandbox.
- Roots come only from main-process session.
- Each candidate read revalidates path, segment links, real path, regular-file status, extension.
- Treat DOCX as untrusted ZIP with all budgets active.
- No external relationships or macro/script/field/embedded-object execution.
- Logs/errors reveal no queries, body/model, absolute paths, raw exceptions, stacks.
- Search is read-only, with no backup/temp/index/cache writes.
- Old workspace/request/navigation results never enter new sessions.

## 8. Testing requirements

### 8.1 Full Task 1–7 regression

- All existing typecheck, lint, format, Vitest, and build pass.
- Do not weaken TXT results/statistics/cancel/truncation/navigation tests.
- Do not weaken DOCX reading/compatibility/editing/saving/backup/multi-tab/lifecycle tests.
- Do not manufacture passes through deleted assertions, increased timeouts, unconditional skip, or swallowed errors.

### 8.2 Pure projection tests

Cover at least:

- Empty model, single/multiple/empty paragraphs;
- Heading levels 1–3;
- Run concatenation/cross-mark queries;
- Sizes/colors/bold/italic/underline leave projection unchanged;
- Depth-first bullet/numbered/nested order;
- Exactly one artificial separator, no extra leading/trailing newline;
- No cross-block queries;
- Chinese/English/emoji/combining characters/UTF-16 ranges;
- Native within-run newlines;
- Linear traversal/budgets near maximum valid model;
- Model projection matches Tiptap/PM blocks generated from the same model.

### 8.3 Main-process mixed-search tests

Cover at least:

- TXT-only, DOCX-only, mixed, empty workspaces;
- Case-varied extensions;
- supported/degraded/read-only/zero-byte DOCX;
- Damage/encryption/disguises/oversize/import failure/disappearance during reading;
- Exclude unsupported content; search modeled body;
- Unified natural TXT/DOCX order;
- One query matches paragraphs/headings/marks/lists;
- Total 1000 and DOCX 200 candidates;
- Per-file 200/total 2000 matches and truncation priority;
- Total concurrency ≤4, DOCX ≤2;
- Cancellation before search/during traversal/before-after reads/during projection/matching;
- New-search cancellation, workspace-switch cancellation, destroyed-window cleanup;
- Root-wide failure and subdirectory/per-file isolation;
- No symlink/junction following; real-link tests may conditionally skip with deterministic mock coverage;
- Search creates/modifies no files.

### 8.4 Contracts, IPC, and preload

- Exact request-key validation remains Task 6's.
- Reject extra roots, file types, glob, budgets, parsing fields.
- Result kind accepts only `txt` / `docx`.
- Runtime/type contracts agree on new truncation reason.
- IPC roots come from current main-process session.
- One active task/window, cross-window isolation, safe unknown cancellation.
- preload exposes no ipcRenderer/generic channel.
- Structured-clone data contains no model, Buffer, Error, functions, or class instances.

### 8.5 Search controller and components

- One query displays TXT and DOCX groups.
- Accessible type/path/extracted-line-column/preview/highlight.
- Accurate statistics/truncation.
- No requests without workspace.
- Stable searching/cancelled/empty/error states.
- Repeated submissions show only latest results.
- Workspace switching clears old results.
- Explicit unsaved-body notice.
- Active DOCX shows current-file find/replace unavailable, without fake available buttons.
- All body/previews render as text nodes.

### 8.6 DOCX opening and navigation

Cover at least:

- Unopened DOCX: one tab, navigate after reading;
- Open DOCX: activate existing tab only;
- Loading DOCX: await original read, no duplicate;
- Same names/different paths and mixed TXT/DOCX tabs;
- Paragraph/heading/cross-mark/list/nested positions;
- Chinese/emoji/UTF-16 offsets;
- Read-only navigation without editing;
- Unconfirmed degraded navigation without automatic confirmation;
- Dirty unchanged original slice navigates and remains dirty;
- Format-only changes with unchanged projection navigate;
- Insert/delete before match, changed structure, out-of-range/mismatched text are stale;
- External changes alter revision;
- Read-error, closing, workspace switch, newer navigation superseding old;
- Edit after App validation but before host application rejected by host recheck;
- Each locateId applies once;
- Late stale/applied reports do not override latest state;
- Navigation adds no undo history/model changes/saves.

### 8.7 Manual desktop and performance smoke

Run at least once each in Windows development and production:

- Mixed workspace with TXT, ordinary/WPS/read-only/degraded/damaged DOCX;
- Chinese/English/emoji/case toggle;
- Query/cancel/repeated submissions/no results;
- Unopened/open/loading/dirty/read-only/degraded result clicks;
- Paragraph/heading/cross-run formatting/bullet/numbered/nested navigation;
- Stale results after external Office edits;
- Workspace switch/window close during search;
- Near-1000 total and near-200 DOCX performance;
- Record scan duration, peak-memory observations, cancellation, UI usability;
- No unhandled console/terminal exceptions;
- No new backup/index/cache/temporary workspace residue.

## 9. Explicit exclusions

- Current-DOCX find/replace/panel;
- Workspace/batch replace or direct result writes;
- Merging dirty unsaved text with disk results;
- Regex, whole-word, fuzzy, pinyin, semantic, AI search;
- Filtering by type/path/heading level/compatibility;
- Persistent full-text indexes, SQLite, inverted indexes, background watchers;
- OCR, image alt text, tables, headers/footers, comments, tracked changes, footnotes, fields, equations, embedded-object search;
- Word pages/layout coordinates/full Office layout navigation;
- DOCX creation/Save As/rename/move/delete;
- Autosave, filesystem watching, recent workspaces, tab restore, search history;
- Tab dragging/pinning/split views/batch close;
- Markdown, PDF, other new types;
- Generic handlers, plugins, AI/Agent capabilities.

## 10. Work packages and order

Implement one package at a time; do not advance after a failed gate.

### WP0: Baseline, projection semantics, technical verification

- Complete all section 3 prerequisites.
- Record check/build/test counts/conditional skips.
- Build paragraph/heading/marks/list/read-only/degraded/large fixtures.
- Verify projection↔PM mapping.
- Verify read-only navigation/concurrency/cancellation.
- Freeze all section 4 protocols/budgets.

Gate: Repeatable Task 7 baseline; documented projection/public-API verification; no unresolved semantics.

### WP1: Projection and shared contracts

- Add pure DOCX projection module.
- Extend kind/truncation reason.
- Update runtime validation/comments.
- Complete pure contract tests in 8.2/8.4.
- Do not yet modify real traversal/UI.

Gate: Deterministic, linear, bounded, framework-independent projection; no TXT contract regression; full check/build pass.

### WP2: Main-process mixed search

- Add TXT + DOCX candidates.
- Reuse both controlled readers.
- Connect projection/existing matcher.
- Enforce total/DOCX candidate and dual concurrency limits.
- Complete isolation/cancel/statistics/order/truncation.
- Add 8.3 tests.
- Do not yet change renderer navigation.

Gate: No boundary escape/link following/writes; deterministic results; verifiable concurrency/cancellation; full check/build pass.

### WP3: IPC, preload, controller, sidebar

- Update DesktopApi explanations/IPC result validation.
- Preserve fixed request/cancel API.
- Accept kind-bearing mixed results in renderer.
- Update scope/type labels/statistics/current-DOCX unavailability.
- Add 8.4/8.5 tests.

Gate: No expanded renderer permissions; both types displayed correctly; no TXT search UI regression; full check/build pass.

### WP4: Generic opening and DOCX navigation

- Use generic `openFile` for results.
- Establish uniform locateId/outcome.
- Implement App kind/revision/live-projection validation.
- Implement host public-node projection/recheck/selection mapping.
- Preserve CodeMirror semantics.
- Add 8.6 tests.

Gate: TXT/DOCX opening/activation → validation → navigation works; stale results never misnavigate; full check/build pass.

### WP5: Lifecycle, compatibility, mixed regression

- Cover loading/dirty/saving/read-only/degraded/read-error.
- Cover switching/closing/new navigation/window close/late reports.
- Cover formatting/structure/external changes.
- Regress saving/unsaved protection/cancellation/session isolation.
- Fill component/state test gaps.

Gate: All asynchronous identity invariants testable; search preserves edit/save gates; full check/build pass.

### WP6: Performance, smoke, risk resolution

- Run section 8.7 development/production smoke.
- Record ordinary/near-limit workspace performance.
- Check concurrency/memory/cancellation/main-UI usability.
- Verify stale revision after Word/WPS external edits.
- Fix implementation only from evidence, without expanding scope.

Gate: Usable performance/cancellation; no writes/residue; explicit risk conclusions.

### WP7: Overall acceptance, documentation, report

- Run full check/build.
- Execute final manual checklist.
- Update README/baseline/testing/structure.
- Mark Roadmap Task 8 complete.
- Add `TASK_008_COMPLETION_REPORT.md`.
- Record actual protocol/budgets/projection/navigation/tests/performance/Office verification/limits.
- Mark this file complete only after all section 11 criteria.

Gate: Documentation matches behavior; evidence for all automated/manual acceptance; no open P0/P1 data-safety issues.

## 11. Final acceptance criteria

> All conditions below are satisfied; Task 8 is complete as of 2026-08-15 (see [completion report](./TASK_008_COMPLETION_REPORT.en.md)).
>
> Post-completion review on 2026-08-15 fixed new-search failure to invalidate old navigation and candidate budgeting before global sorting, adding regressions. Checked conclusions remain valid.

### 11.1 Scope and results

- [x] One query searches saved TXT/DOCX together.
- [x] Existing TXT semantics fully preserved.
- [x] DOCX paragraphs/headings/marks/list body searchable.
- [x] No false promise for unsupported DOCX content.
- [x] Deterministic supported/degraded/read-only behavior.
- [x] Correct zero-byte/damaged/encrypted/oversized/failing handling.
- [x] Accurate order/groups/statistics/previews/type labels.
- [x] Unsaved body excluded with explicit UI notice.

### 11.2 Projection and navigation

- [x] Pure projection tests and editor-equivalence coverage.
- [x] Correct UTF-16/Chinese/emoji/empty/nested mapping.
- [x] Unique tabs for unopened/open/loading DOCX.
- [x] Revision/range/text/host recheck all active.
- [x] Dirty unchanged original range can navigate.
- [x] Format-only changes can navigate.
- [x] Text/structure/external-revision changes only show stale.
- [x] Read-only navigable, not editable.
- [x] Degraded navigation does not auto-confirm.
- [x] Public selection/scroll/focus APIs only.
- [x] Apply once; late reports cannot contaminate new state.
- [x] No body change/dirty/undo history from navigation.

### 11.3 Cancellation, budgets, performance

- [x] Total 1000/DOCX 200 candidates, per-file 200/total 2000 matches enforced.
- [x] Concurrency total ≤4 / DOCX ≤2.
- [x] Correct truncation reasons/priority.
- [x] New search cancels old.
- [x] Switch/destroy/unmount clean up tasks.
- [x] Cancel commits no partial completed results.
- [x] Near-limit mixed search does not freeze UI.
- [x] Recorded performance/cancellation observations.

### 11.4 Electron and data safety

- [x] Renderer cannot pass roots/absolute paths/glob/parsing/budgets.
- [x] No symlink/junction following.
- [x] Both types reuse controlled reads/revisions.
- [x] All DOCX ZIP/OOXML budgets preserved.
- [x] No external resources/macros/embedded execution.
- [x] IPC/logs reveal no body/model/paths/raw exceptions.
- [x] Search creates/modifies/deletes/renames no files.
- [x] No index/cache/backup/temp residue.
- [x] Electron isolation/sandbox unchanged.

### 11.5 Quality and documentation

- [x] Full Task 1–7 regression passes.
- [x] Added projection/mixed-search/contract/IPC/component/navigation tests.
- [x] No unconditional skip/only/weakened assertions.
- [x] typecheck/lint/format/test/check/build all pass.
- [x] Development/production desktop smoke passes.
- [x] Word/WPS external-change staleness path verified.
- [x] README/baseline/testing/structure synchronized.
- [x] Report contains verifiable evidence.
- [x] Known limitations match behavior.

## 12. Failure handling and decision rules

- Unclear projection: stop and freeze rules with minimal model/editor fixtures.
- Model/PM order mismatch: fix conversion/mapping, never guess approximate text.
- Uncancellable single DOCX read: let it finish, then check cancellation/discard.
- Poor main-process response: reduce DOCX concurrency and record data first, without immediate workers/indexes.
- Unsupported unmodeled content: do not temporarily parse raw XML to broaden promises.
- Dirty result cannot map exactly: mark stale, never search nearest identical text.
- Unstable read-only focus: retain selection/scrolling, prioritize no editing, record limitation.
- New dependency needed: submit evaluation first; no unexplained additions.
- Baseline failure: diagnose first; do not mislabel as new Task 8 failure or skip.
- Convenience versus safety: prioritize workspace bounds, budgets, revision, non-destructive failure.

## 13. Execution-prompt template

Use the fixed prompt, changing only package number/content:

> Read `README.md`, `docs/architecture/PROJECT_BASELINE.md`, `docs/development/DEVELOPMENT_ENVIRONMENT.md`, `docs/development/TESTING.md`, `docs/tasks/task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.md`, `docs/tasks/task-006/TASK_006_COMPLETION_REPORT.md`, `docs/tasks/task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md`, `docs/tasks/task-007/TASK_007_COMPLETION_REPORT.md`, `docs/tasks/task-008/TASK_008_DOCX_WORKSPACE_SEARCH.md`, and directly relevant source/tests. Implement only TASK-008 WPx, without early later packages, unrelated refactoring, current-DOCX find/replace, workspace replace, regex/fuzzy/semantic search, persistent indexes, databases, autosave, creation/Save As, file management, or AI. DOCX search semantics come only from Task 7 `DocxDocumentModel`, through canonical projection/block mapping; never treat DOCX as UTF-8 TXT or directly search OOXML, Mammoth HTML, or editor DOM. Navigation requires kind/revision/range/matched-text checks and public PM selection/scroll/focus; stale or unmappable results only show non-destructive notices, never misnavigate or change body. Roots come only from main-process session; all reads obey path/link/budget/candidate/dual-concurrency/cooperative-cancellation/stale semantics. Search is entirely read-only, creating no backup/temp/index/cache. Preserve TXT, multiple tabs, DOCX editing/saving, navigation, sandbox, and unsaved protection. Run package tests, full `check`, and `build`. Report files, decisions, commands, fixture/compatibility evidence, unresolved issues, and gate satisfaction.

Execution rules:

- One package per conversation.
- Read directly relevant files/tests first, without repeated unrelated dependency scans.
- Preserve existing user changes.
- Review diff and retain auditable Git restore points after each package.
- WP0 freezes projection/protocol/budgets without DOCX-search UI exposure.
- After WP1, review determinism/UTF-16/empty/marks/lists/TXT contracts.
- After WP2, review classification/dual concurrency/cancel/isolation/read-only search.
- After WP3, review unchanged renderer permissions/type labels/sidebar semantics.
- After WP4, review kind/revision/range/text/host validation and safe staleness.
- After WP5, review loading/dirty/saving/read-only/degraded lifecycle and edit/save gates.
- After WP6, review performance/memory/cancel/residue.
- Only WP7 may write completion report/check final criteria/mark `Completed`.

Record at each package start:

- Branch/working tree;
- Previous commit/restore point;
- Scope and explicit exclusions;
- Files to change;
- Tests to add/update;
- Acceptance commands;
- Risks/rollback.

Record at each package completion:

- Actual changes;
- Plan differences;
- Automated results;
- Manual results;
- Remaining limits;
- Whether the next-package gate is met.

## 14. Deliverables

Deliver on completion:

1. Pure canonical DOCX body projection/block mapping;
2. Shared results with TXT/DOCX kind;
3. Mixed traversal, controlled DOCX reads, bounded concurrency;
4. Reused literal matcher/statistics/cancel/truncation;
5. TXT/DOCX groups in one sidebar;
6. Generic opening and uniform locateId/outcome;
7. DOCX revision/live projection/host validation;
8. Public PM mapping/selection/scroll/focus;
9. Projection/traversal/budget/cancel/IPC/component/lifecycle/navigation tests;
10. Updated README/baseline/testing/structure;
11. `TASK_008_COMPLETION_REPORT.md`, recording at least:
    - Summary/key files;
    - Projection/unsupported-content scope;
    - Compatible contracts/resource limits;
    - Mixed traversal/concurrency/cancellation/isolation;
    - Revision/dirty/recheck/stale navigation;
    - Electron/IPC security;
    - Automated/desktop/Office evidence;
    - Near-limit performance;
    - Limits and complete acceptance status.

## 15. Next task after completion

Prioritize basic file management: create TXT/DOCX/folders, Save As, rename, move, delete, and reveal in File Explorer. Separately design target-path validation, conflicts, overwrite confirmation, unsaved-tab migration, result invalidation, and recoverable deletion.

Schedule current-DOCX find/replace separately after comparing user value with file management; do not include it incidentally in Task 8.
