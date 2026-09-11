# TASK-010: find and replace within the current DOCX

[简体中文](./TASK_010_DOCX_FIND_REPLACE.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

## Task status

> **Status: complete (2026-08-20).**
>
> WP0–WP7 completed and passed individual acceptance; see the [completion report](./TASK_010_COMPLETION_REPORT.en.md) and [WP0 report](./TASK_010_WP0_REPORT.en.md). All 45 acceptance items in section 11 were checked against evidence. Full `check`, with 62 files / 1133 passes / 10 conditional skips, all for real symlink/junction permissions, and `build` passed sequentially with exit 0. Development/production Windows smoke tests passed, and the owner executed and passed section 8's manual UI checklist.
>
> This builds on Task 6 TXT current-file find/replace, Task 7 structured DOCX editing/safe saving, Task 8 canonical DOCX body projection/ProseMirror navigation, and Task 9 stable `tabId`/file management. All Task 1–9 behavior is the regression baseline.

## 1. Purpose

Complete current-DOCX find/replace so TXT and DOCX both have a complete current-file search flow. Users should find literal text, navigate/highlight matches in the active DOCX's live editing content, and safely replace the current or all matches when editing is permitted.

The task addresses:

1. Find and Replace currently works only for TXT and reports unavailable for active DOCX.
2. Task 8 maps canonical DOCX ranges to ProseMirror positions, but current-document sessions, decorations, and replacement transactions are missing.
3. Matches can span runs with different marks, requiring deterministic formatting inheritance.
4. Replace All must form one undo step, respect model budgets, and never partially replace.
5. Read-only, degraded, saving, dirty, external reload, multiple tabs, and path migration require deterministic behavior.
6. New features must preserve DOCX models, compatibility confirmation, safe saving, backups, and conflict protection.

No new main-process file capability is added. Do not search disk snapshots or directly parse OOXML, Mammoth HTML, or editor DOM. The sole source of truth is the active Tiptap/ProseMirror live document; canonical text semantics continue using Task 8's text-block projection rules.

## 2. Resulting user experience

After Task 10, users should be able to:

- Press `Ctrl+F` in active DOCX to open the existing sidebar's Find and Replace view and focus query input.
- Press `Ctrl+H` to focus replacement in that view. Nonreplaceable DOCX still supports finding, with explicitly disabled replacement and an explanation.
- Enter ordinary single-line text to immediately search live DOCX content, including unsaved edits.
- Toggle case sensitivity and navigate with Enter / Shift+Enter, F3 / Shift+F3, or previous/next buttons.
- See current index / match count, no-match notices, and too-many-results notices.
- See all matches highlighted, with stronger styling for the current one.
- Match paragraphs, headings, continuous text across marks runs, bulleted/numbered/nested lists, Chinese, and emoji.
- Navigate by selecting, scrolling to, and focusing the current match.
- Replace current/all matches in editable DOCX and enter normal dirty state.
- Undo an entire Replace All in one step, then redo it.
- Save through existing Save or `Ctrl+S`, retaining revision-conflict, rolling-backup, output-validation, and safe-replacement protection.
- Find normally in read-only DOCX without replacing.
- Find in degraded DOCX without confirmation, but replace only after compatibility confirmation tied to the current revision.
- Preserve each TXT/DOCX tab's query, options, current match, and edit history when switching.
- Preserve find sessions after rename/move/Save As without recreating editors for path changes.
- Safely recalculate after edits, external reload, or invalidated matches, without guessing positions or modifying wrong ranges.

## 3. Pre-execution checks

### 3.1 Required reading

Read and review completely:

- `README.md`.
- `docs/architecture/PROJECT_BASELINE.md`.
- `docs/development/DEVELOPMENT_ENVIRONMENT.md`.
- `docs/development/TESTING.md`.
- `docs/tasks/task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.md`.
- `docs/tasks/task-006/TASK_006_COMPLETION_REPORT.md`.
- `docs/tasks/task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md`.
- `docs/tasks/task-007/TASK_007_COMPLETION_REPORT.md`.
- `docs/tasks/task-008/TASK_008_DOCX_WORKSPACE_SEARCH.md`.
- `docs/tasks/task-008/TASK_008_COMPLETION_REPORT.md`.
- `docs/tasks/task-009/TASK_009_BASIC_FILE_MANAGEMENT.md`.
- `docs/tasks/task-009/TASK_009_COMPLETION_REPORT.md`.
- `src/shared/docx.ts`.
- `src/shared/docx-convert.ts`.
- `src/shared/docx-search-text.ts`.
- `src/main/search/match-text.ts`, only to compare existing literal semantics; do not import the main-process searcher into the renderer.
- `src/renderer/lib/document-tabs.ts`.
- `src/renderer/lib/use-documents.ts`.
- `src/renderer/lib/use-editor-sessions.ts`.
- `src/renderer/components/document/EditorSessionHost.tsx`.
- `src/renderer/components/document/DocxEditorSessionHost.tsx`.
- `src/renderer/components/document/DocumentPane.tsx`.
- `src/renderer/components/search/SearchSidebar.tsx`.
- `src/renderer/App.tsx`.
- `tests/document/find-replace.test.tsx`.
- `tests/document/docx-editor.test.tsx`.
- `tests/document/docx-locate-host.test.tsx`.
- `tests/docx/docx-search-projection.test.ts`.
- `tests/search/result-locate-docx.test.tsx`.
- Task 9 path-migration, save-as, mutation-epoch, and lifecycle tests.

### 3.2 Working tree and quality baseline

At WP0 start:

1. Report branch, HEAD, working tree, and existing user changes.
2. Run full `npm run check`.
3. Run `npm run build`.
4. Record test-file/pass/failure/conditional-skip counts and reasons.
5. Confirm development and production can at least launch the main window.
6. Manually verify no regressions in TXT current find/replace, DOCX edit/save, workspace DOCX navigation, and editor sessions after rename/move.
7. Establish an auditable Git recovery point without overwriting or cleaning user changes.

First determine the cause of a baseline failure. Report existing issues separately and decide whether to fix them first. Do not weaken, skip, or disguise an existing failure as expected Task 10 behavior.

### 3.3 Required WP0 technical validation

Actually verify and record with minimal Tiptap/ProseMirror fixtures:

- Depth-first `node.isTextblock` collection from live ProseMirror matches `joinDocxTextBlocks` / `projectDocxModelSearchText` order and text.
- A match across adjacent text nodes/marks runs maps reliably to one selection.
- Matches do not cross synthetic `\n` inserted by canonical projection; query and replacement are single-line.
- JavaScript UTF-16 offsets and ProseMirror positions agree for Chinese, emoji, surrogate pairs, and combining characters.
- Decorations mark all/current matches and safely update after transactions through mapping or recalculation.
- Actual marks behavior of `insertText`, `replaceWith`, or equivalent public transactions for one run, same-marks cross-run, different-marks cross-run, and empty replacements.
- Public transactions deterministically implement starting-character marks inheritance while preserving paragraph/heading/list structure.
- Reverse-order replacements in one transaction do not shift positions, and one undo restores all.
- Candidate transaction `doc.toJSON()` passes `tiptapJsonToDocxModel` and existing budgets before dispatch; failures permit no dispatch and no dirty state.
- Read-only editors support decorations, selection, and scrolling while rejecting replacement.
- Unconfirmed degraded supports finding only; confirmation enables replacement without editor recreation.
- Replacing during saving is not cleared by completion of the earlier save.
- Search, decorations, and input response near `DOCX_MAX_MODEL_SERIALIZED_BYTES` and 20,000 textblocks meet section 4.10 budgets.
- Implementation needs no third-party dependency. Otherwise first submit an evaluation and update the plan; do not install directly.

If any fixed semantic cannot be implemented reliably, update this plan and `TASK_010_WP0_REPORT.md`, then obtain owner confirmation before WP1.

## 4. Fixed product and technical decisions

### 4.1 Live editor content is the only search source

- Search active Tiptap/ProseMirror editor's live `state.doc`.
- Include unsaved edits; do not read disk, call main-process search IPC, or compare disk revisions.
- Do not search old React `DocxDocumentModel` snapshots, avoiding transient staleness between input transactions and React updates.
- Do not read DOCX ZIP, OOXML, Mammoth HTML, or editor DOM.
- Images/tables/headers/footers/comments/revisions absent from the structured editor are outside scope.

### 4.2 Reuse Task 8 canonical body projection

- Collect all live `textblock` nodes in document order.
- Each paragraph/heading is one text block; list containers produce no text themselves.
- Concatenate all text-node `textContent` within a block, allowing matches across marks runs.
- Insert one synthetic `\n` only in the projection between adjacent blocks.
- Reject queries containing `\r` or `\n`; single-line matches stay inside one real block.
- Offsets are UTF-16 code units: block content begins at `nodePos + 1`, plus the within-block offset.
- Main and renderer must not introduce a second DOCX body definition.

### 4.3 Find semantics

- Promise only literal find and case sensitivity.
- Default to case-insensitive. WP0 records measured differences from CodeMirror current-file search for ASCII, Chinese/English, and combining characters.
- No Unicode normalization, language-dependent tokenization, or fuzzy matching.
- Collect non-overlapping matches left-to-right in document order.
- Query is nonempty, at most `4096` UTF-16 code units; newlines produce stable input errors.
- Initially prefer the first match after editor selection/cursor, wrapping to the first if none follows.
- Next/previous wrap; query/case changes reselect the current match.
- After ordinary edits, prefer the nearest valid match after the old current position; no matches means current null.
- Closing removes decorations and restores editor focus, while retaining tab query/replacement/case for reopening.
- Workspace-result navigation must not change current-file query; an open panel only recalculates decorations from current content.

### 4.4 Match and resource budgets

- Retain/decorate at most `2000` matches per tab; finding match `2001` sets `truncated`.
- Truncation displays “匹配超过 2000 处” (More Than 2000 Matches) and allows navigation within the collected 2000 without claiming completeness.
- Disable Replace All when truncated; never replace only the first 2000. Users can narrow the query and retry.
- Replace Current remains available for a valid current match.
- Recalculation must not visibly stall input. Measure in WP0, then freeze synchronous, microtask, `requestAnimationFrame`, or short-debounce strategy in WP2.
- No workers, indexes, databases, persistent caches, or main-process computation.
- Destroying editors releases decorations, listeners, timers, and controls references.

### 4.5 Highlights and navigation

- Use ProseMirror Plugin / PluginKey for find state and DecorationSet.
- Ordinary/current matches use different classes; current identity must not rely only on color.
- Never write content marks, change the DOCX model, or mark dirty for highlights.
- Use only public ProseMirror state, transactions, traversal, selection, view dispatch, and Tiptap commands.
- Do not parse editor text through `querySelector` or depend on private Tiptap fields.
- Navigation sets TextSelection, scrolls, and focuses; read-only can navigate without gaining edit permission.
- Find/navigation/case toggling/panel toggling must not enter undo history or save.

### 4.6 Fixed Replace Current semantics

- Replacement is ordinary single-line text, at most `4096` UTF-16 code units; reject newlines.
- Reproject live `state.doc` at execution and validate query/options/current range/match text, never trusting stale UI ranges.
- Matches stay inside one block; mapping failure leaves the document unchanged and recalculates.
- Nonempty replacement inherits starting-character marks, even across different marks runs.
- Empty replacement deletes.
- Preserve paragraph/heading type, alignment, list type/depth, and surrounding unmatched marks.
- Convert/validate the candidate as a legal `DocxDocumentModel` before dispatch. Budget failure shows a nondestructive error with no dispatch/dirty.
- Success is a normal undoable edit through existing `editDocxTab`, dirty, editRevision, and saving.
- Select the next valid match afterward and keep panel-focus policy explicit.

### 4.7 Fixed Replace All semantics

- Rescan the complete live projection at execution rather than reusing input-time ranges.
- Process non-overlapping matches only.
- Zero matches is a no-op: no dispatch, dirty, or false success.
- More than 2000 rejects the entire operation without partial replacement.
- Apply all replacements from document end to start in one transaction to prevent position drift.
- Each replacement inherits its own starting marks.
- Convert and budget-check the final transaction document before dispatch; any failure aborts all.
- Success dispatches once and creates one undo-history event. One undo restores all prior content/formatting; one redo restores all replacements.
- Recalculate, update counts, and report the actual replacement count.
- Do not autosave; users save explicitly through existing entry points.

### 4.8 Editability and compatibility

- DOCX with a usable editor/model in loaded, dirty, saving, save-error, conflict, or snapshot-retaining read-error can be searched.
- `read-only` permits find/navigation/highlights but disables all replacement entries.
- `degraded` permits finding without confirmation; replacement requires `compatibilityConfirmationRevision === document.revision`.
- Reuse existing compatibility confirmation; the find controller must not write confirmation revision itself.
- Saving follows ordinary typing semantics: replacement advances editRevision and remains dirty after the earlier save.
- Loading or read-error without a usable editor/model must not show a falsely usable panel.
- Derive replacement permission from shared selectors/controller state instead of inconsistent component-specific status checks.

### 4.9 One shared TXT/DOCX sidebar entry

- Retain Global Search / Find and Replace pages under the Search activity.
- TXT retains CodeMirror search extension, panel state, and undo history; do not rewrite its matcher.
- DOCX uses a project-owned React panel and ProseMirror plugin.
- `SearchSidebar` shows either TXT's external panel host or DOCX's panel by active kind, never both.
- `Ctrl+F` / `Ctrl+H` from either kind first activates Search and Find and Replace, then focuses the correct field.
- Active controls switch atomically with tabs; late old-editor callbacks cannot operate on new tabs.
- Bind every session to stable `tabId`; do not infer editor identity from text, filenames, or relative paths.

### 4.10 Performance and refresh strategy

- Ordinary queries should show results on roughly a 100 ms scale. This is a target, not an unstable CI wall-clock assertion.
- Observe a 20,000-textblock / near-serialization-limit fixture once and record hardware, size, query, match count, scan time, and decoration time.
- Schedule only one recalculation after edit transactions, invalidating previous pending work rather than scanning on every React render.
- Hidden inactive DOCX must not recalculate because another tab receives input; retain its own editor/query state.
- Avoid incremental indexes or complex transaction mapping unless WP0 proves full recalculation unacceptable.
- Performance work must preserve range validation, model budgets, Replace All atomicity, and resource limits.

### 4.11 Dependencies, processes, and security

- Prefer existing `@tiptap/core`, `@tiptap/pm`, React, and project pure modules.
- Add no main-process IPC, preload methods, DesktopApi, filesystem access, or Electron permissions.
- Editors, ProseMirror Nodes, transactions, Decorations, and document content never cross IPC.
- Find writes no disk/temp/backup data. Replacement edits memory only; saving follows existing Task 7/9 paths.
- Do not expand supported DOCX formats or remove read-only/degraded protection.
- Do not log queries, replacement text, content, full models, or absolute system paths.
- If a dependency is necessary, first record package/version/license/maintenance/bundle impact/alternatives/security risk and obtain confirmation before adding it.

## 5. State model, interfaces, and invariants

### 5.1 Suggested per-tab find state

Renderer state may use an equivalent shape. Names may change after WP0, but semantics must remain:

```ts
interface DocxCurrentSearchState {
  readonly open: boolean;
  readonly query: string;
  readonly replacement: string;
  readonly caseSensitive: boolean;
  readonly matches: readonly DocxCurrentSearchMatch[];
  readonly currentIndex: number | null;
  readonly truncated: boolean;
  readonly validationError: string | null;
  readonly operationMessage: string | null;
}

interface DocxCurrentSearchMatch {
  readonly from: number;
  readonly to: number;
  readonly matchedText: string;
  readonly blockOrdinal: number;
  readonly pmFrom: number;
  readonly pmTo: number;
}
```

`pmFrom` / `pmTo` may exist only within one live computation, never as persistent identity across editor lifecycles. Map or recompute them after every edit; stale positions cannot be assumed valid.

### 5.2 Suggested active-editor controls

App/Sidebar receives only narrow active-editor controls, not general `Editor` or `EditorView`:

```ts
interface DocxCurrentSearchControls {
  readonly tabId: string;
  readonly getSnapshot: () => DocxCurrentSearchSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly open: (mode: 'find' | 'replace') => void;
  readonly close: () => void;
  readonly setQuery: (query: string) => void;
  readonly setReplacement: (replacement: string) => void;
  readonly setCaseSensitive: (value: boolean) => void;
  readonly selectNext: () => void;
  readonly selectPrevious: () => void;
  readonly replaceCurrent: () => void;
  readonly replaceAll: () => void;
}
```

Use `useSyncExternalStore` or an equivalent stable subscription. Do not dispatch ProseMirror transactions during React render or leave old-tab controls active after switching.

### 5.3 Required invariants

1. Find state binds one-to-one to stable `tabId`, not mutable `relativePath`.
2. One DOCX editor registers at most one current-search plugin/controller.
3. Active controls' `tabId` equals the active mounted DOCX tab.
4. Find/navigation/decorations/panel closure do not modify `state.doc`, dirty, or editRevision.
5. Replacement acts only on live matches revalidated at execution.
6. One replacement command dispatches at most one document-changing transaction.
7. Replace All fully succeeds or makes 0 changes.
8. Exceeding match budgets never permits partial Replace All.
9. Invalid candidate models never dispatch.
10. Read-only/unconfirmed degraded never dispatch replacement transactions.
11. Earlier save completion never clears replacements made during saving.
12. Find/editor sessions survive rename/move/Save As.
13. Tab closure, successful workspace changes, or editor destruction leave no dangling subscriptions, timers, or active controls.
14. DOCX integration must not regress TXT current search, panels, or shortcuts.
15. Workspace search/navigation/mutationEpoch and current-file search never impersonate one another's identity.
16. Renderer capabilities do not expand Electron/IPC/preload permissions.

### 5.4 Async and late-result rules

- Debounce/microtask/animation-frame callbacks bind to editor/controller generation.
- Before running, verify editor is alive, tabId unchanged, and sequence still latest.
- New queries, edit transactions, external setContent, and destruction cancel/invalidate old work.
- Switching tabs retains editors, but old tabs cannot update the current sidebar; subscriptions follow active controls.
- External model replacement retains query/replacement/caseSensitive, clears old matches/currentIndex, then recomputes against the new document.
- Do not infer freshness from wall-clock timestamps, relative paths, or display names.

## 6. Suggested module and file responsibilities

These are suggested boundaries, not mandatory filenames. Explain deviations in the completion report.

### 6.1 Pure current-DOCX-search module

Suggested new `src/renderer/lib/docx-current-search.ts`:

- Canonical projection from ProseMirror text-block descriptions.
- Query/replacement validation.
- Literal, case-sensitive, non-overlapping, bounded matching.
- Projection-range to textblock/PM mapping.
- Current-index selection, next/previous, and nearest-match policy after edits.
- Keep functions pure where possible for deterministic UTF-16, marks, lists, and budget tests.

### 6.2 ProseMirror plugin and controller

Suggested `src/renderer/lib/docx-current-search-plugin.ts` or equivalent:

- PluginKey, plugin state, DecorationSet.
- Editor transaction/selection listeners.
- Recalculation scheduling and stale generations.
- Narrow controls and subscribed snapshots.
- Navigation selection/scroll/focus.
- Replacement transactions, marks inheritance, reverse-order Replace All, model prevalidation.
- Destruction cleanup.

The plugin must not hold React component instances or directly call main-process APIs.

### 6.3 DOCX find/replace panel

Suggested `src/renderer/components/search/DocxCurrentSearchPanel.tsx`:

- Controlled query, replacement, and case inputs.
- Previous, Next, Close, Replace, Replace All.
- Current/total counts, truncation, validation errors, operation feedback.
- Disabled reasons for read-only, unconfirmed degraded, and no editor.
- Enter, Shift+Enter, Escape, and focus restoration.
- Only narrow controls; no direct Tiptap editor access.

### 6.4 DOCX editor host

`DocxEditorSessionHost.tsx` handles:

- Installing one search plugin/controller per editor.
- Connecting current `tabId`, replacement permission, model-prevalidation boundary, and save/edit lifecycle.
- Registering/unregistering search controls.
- Preserving content sync, toolbar, save shortcuts, and workspace-result navigation.
- No editor recreation for query changes.

### 6.5 DocumentPane, SearchSidebar, and App

- `DocumentPane` forwards control registration under stable tabId and exposes only active DOCX controls to App.
- `SearchSidebar` renders CodeMirror panel host or `DocxCurrentSearchPanel` by kind.
- `App` coordinates shortcut-triggered activity/page switches and active-control identity.
- Read-only active DOCX still has current-document-search availability; only replacement capability is false.
- Existing `EditorSearchControls` may become a discriminated union, or TXT/DOCX may keep separate narrow interfaces. Never expose a general editor.

### 6.6 Styles

Add only minimal required styles to `src/renderer/styles/app.css`:

- Ordinary/current DOCX matches.
- Query/replacement forms, counts, errors, truncation, and disabled reasons.
- Keyboard focus-visible and minimum-window overflow.
- Current-match distinction under high contrast.
- Do not also perform the design-system refactor from the future UI plan.

## 7. Electron, data, and saving boundaries

### 7.1 No new cross-process protocol

- Task 10 adds no IPC channel.
- Do not change preload exposure or `DesktopApi` methods.
- Do not send queries, replacement text, match ranges, or content to main.
- Do not implement current find through workspace-search IPC.
- Preload contract tests must prove the API set did not expand.

### 7.2 Replacement is not saving

- Replacement creates memory edit transactions only.
- Reuse `document-tabs` / `use-documents` dirty, editRevision, and continued-editing-during-save semantics.
- Explicit user saving continues calling existing `saveDocx`.
- Revision, compatibility confirmation, rolling backup, output validation, temporary write, flush, and safe replacement stay unchanged.
- Failed replacement must not save, back up, refresh the tree, or affect mutationEpoch.
- Successful unsaved replacement remains invisible to disk-based workspace search, which still reflects prior saved content; preserve this existing behavior.

### 7.3 No sensitive content logging

- Automated tests use repository fixtures or temporary generated text.
- Logs/errors/reports record only lengths, counts, stable error categories, and anonymous scenarios.
- Never record real queries/replacements, content, full models, or absolute workspace paths.

## 8. Testing requirements

### 8.1 Full Task 1–9 regressions

Run existing typecheck, lint, format, all Vitest tests, and build completely. Do not:

- Remove/weaken assertions.
- Use `.only`.
- Change stable tests to unconditional `.skip`.
- Hide loops/leaks behind longer timeouts.
- Change TXT search semantics to accommodate DOCX.
- Change DOCX safe-save, file management, or workspace-search contracts.

### 8.2 Pure search and mapping tests

Cover at least:

- Empty, oversized, and newline queries.
- Case-sensitive/insensitive matching.
- Zero, one, multiple non-overlapping, and adjacent matches.
- Non-overlap rules for repeated characters.
- Chinese, emoji, surrogate pairs, combining characters.
- Matches across marks runs.
- Paragraphs, headings, empty paragraphs, bulleted/numbered/nested lists.
- No matches across synthetic `\n`.
- Projection ranges and `pmFrom` / `pmTo`.
- 2000 boundary and 2001 truncation.
- Initial current match, cyclic navigation, nearest match after content changes.

### 8.3 Plugin, decoration, and navigation tests

Cover at least:

- Panel open/close does not change content or dirty.
- Decoration counts, classes, and ranges for ordinary/current matches.
- Query/case changes refresh decorations.
- Next/previous, Enter/Shift+Enter, F3/Shift+F3.
- Selection, scrolling, focus.
- Read-only navigation.
- Recalculation after transactions without incorrect decorations.
- External setContent invalidates old asynchronous recalculation.
- Destruction cleans subscriptions/timers.
- No content-DOM reading or document-mark insertion.

### 8.4 Replace Current tests

Cover at least:

- Single-run replacement.
- Cross-run replacement with same/different marks.
- Starting-mark inheritance.
- Shorter, longer, identical, and empty replacements.
- Chinese, emoji, combining characters.
- Replacement in headings/list items, preserving block structure/attributes.
- Invalid old ranges cause no edits and trigger recalculation.
- No match means no dirty.
- Success marks dirty, advances editRevision, and supports correct undo/redo.
- Model-budget/conversion failure means 0 dispatch and 0 dirty.
- Next-match selection and count updates afterward.

### 8.5 Replace All tests

Cover at least:

- Zero, one, and multiple matches.
- Reverse-order replacements of differing lengths without drift.
- Independent starting marks for each match.
- One transaction, one undo restoring all, one redo reapplying all.
- 2000 allowed, 2001 wholly rejected.
- Over-budget candidate wholly rejected, without partial changes.
- Results still containing the query safely recalculate without recursive replacement.
- Rapid repeat clicks do not resubmit the same command.
- Operation messages report actual counts.

### 8.6 Compatibility and lifecycle tests

Cover at least:

- Read-only find works, replacement UI disables, and commands defensively reject.
- Unconfirmed degraded finds but cannot replace; current-revision confirmation enables it.
- Changed compatibility revision invalidates prior confirmation.
- Replacing during saving remains dirty after save completion.
- Deterministic save-error, conflict, and snapshot-retaining read-error.
- Independent DOCX queries/replacements/decorations/history.
- Mixed TXT/DOCX switching atomically changes panels/controls.
- Closing cleans up; reopening starts a new session.
- Rename/move/save-as preserve stable tabId and search state.
- Workspace switching closes all tabs and cleans controls.
- Workspace-result navigation and current-search panel coexist without state contamination.
- MutationEpoch affects workspace search without wrongly clearing current-tab search.

### 8.7 Component, shortcut, and accessibility tests

Cover at least:

- `Ctrl+F` / `Ctrl+H` switch from Files or Global Search to the correct current-search panel.
- Query/replacement inputs receive focus automatically.
- Tab order, accessible button names, disabled reasons, and status live region.
- Escape closes and restores editor focus.
- Narrow-sidebar controls remain reachable without obstructive horizontal overflow.
- Current-match identity uses more than color.
- Accurate loading/no-active-document/TXT/DOCX/read-only/degraded text.
- Never render query/replacement through `dangerouslySetInnerHTML`.

### 8.8 Performance and leak observations

Record at least:

- Query recalculation and decoration time in a typical 100-paragraph DOCX.
- No-match/few-match/2000+ timings for 20,000 textblocks / near-model-budget documents.
- Transaction construction, model prevalidation, and dispatch for 2000 replacements.
- Rapid input commits only the latest recalculation.
- Repeated panel open/close and 20 tab switches leave no duplicate subscriptions, console errors, or obvious continuous memory growth.
- Renderer bundle increase; explain any substantial growth.

### 8.9 Manual Windows desktop smoke tests

Separately verify in development and production:

- Ordinary DOCX Ctrl+F/H, navigation, highlights, Replace/All, undo, redo, save.
- Inheritance for matches crossing bold/color/font-size runs.
- Headings, lists, Chinese, emoji.
- Read-only and degraded.
- Two DOCX and one TXT mixed tabs.
- Dirty/saving, external Word/WPS conflicts, reload.
- Search-state retention after rename/move/Save As.
- Minimum window, keyboard use, focus restoration.
- No unhandled console exceptions or new workspace temporary residue.

## 9. Explicitly out of scope

- Regex, whole-word, fuzzy, pinyin, semantic, or AI search.
- Multiline queries/replacements across paragraphs/headings/list items.
- Workspace/cross-file/bulk replacement or preview.
- Finding in images/tables/headers/footers/comments/revisions/textboxes absent from the model.
- Direct OOXML search/modification.
- Fully lossless Word replacement, fields, hyperlink targets, comments, or change tracking.
- Rewriting TXT current find or replacing it with a shared custom matcher.
- Reworking workspace-search semantics, indexes, caches, or main-process protocol.
- Filesystem watching, automatic refresh, autosave, startup restoration.
- Tab dragging, pinning, bulk closure, split panes.
- Future UI plan's design variables, sidebar scaling, full icon/screenshot system.
- Windows installers and formal releases.
- New file types, plugins, cloud sync, AI/Agents.
- New IPC, preload, general editor/filesystem APIs.

## 10. Work packages and execution order

Implement one package at a time. After each, review diff, run targeted tests plus full `check` and `build`, and retain an auditable recovery point. Do not proceed while current gates fail.

### WP0: freeze baseline, editor transactions, and resource semantics

- Run/record Task 9's full quality and desktop-launch baseline.
- Complete all minimal-fixture checks in 3.3.
- Freeze textblock projection, literal matching, UTF-16, marks inheritance, single-transaction Replace All, model prevalidation, read-only/degraded/saving, and performance strategy.
- Evaluate dependencies but add none by default.
- Add `docs/tasks/task-010/TASK_010_WP0_REPORT.md`.
- Do not expose current-DOCX find in product UI or implement WP1+.

**Gate for WP1:** repeatable baseline, actual evidence for key ProseMirror behavior, no unresolved fixed semantics, agreement between plan and WP0 report.

### WP1: pure find, textblocks, and mapping

- Add renderer pure modules/types.
- Implement validation, literal/case matching, non-overlapping bounded results, truncation, current index, and cyclic navigation.
- Reuse `joinDocxTextBlocks` for live projection/PM range mapping.
- Cover paragraphs/headings/marks/lists/empty blocks/Chinese/emoji/combining characters/2000–2001 boundary.
- No editor plugin, UI integration, or document transactions.

**Gate for WP2:** complete pure tests, projection matches Task 8, no duplicate body semantics, full regressions pass.

### WP2: plugin, decorations, and per-tab controller

- Install project-owned current-search plugin/controller.
- Implement per-tab state, snapshots/subscriptions, recalculation generations, DecorationSet, and ordinary/current highlight state.
- Implement open/close/query/case/next/previous/selection/scroll/focus.
- Recalculate safely after transactions/external setContent.
- Clean on destruction.
- No replacement commands or production sidebar UI yet.

**Gate for WP3:** find/navigation do not edit or dirty, editor sessions isolate, stale work/destruction are safe, performance strategy has targeted evidence.

### WP3: sidebar, shortcuts, active-editor integration

- Add the DOCX current-search React panel.
- Connect `DocxEditorSessionHost`, `DocumentPane`, `SearchSidebar`, `App`.
- Support Ctrl+F/H, Enter/Shift+Enter, F3/Shift+F3, Escape, buttons.
- TXT keeps CodeMirror's panel; DOCX uses the new panel.
- Complete counts/truncation/input errors/no-document/read-only/degraded reasons/focus restoration.
- Replacement buttons may appear but cannot look functional before WP4.

**Gate for WP4:** complete DOCX find flow, no TXT/DOCX control cross-wiring, passing keyboard/accessibility tests, no TXT regression.

### WP4: Replace Current/All and model prevalidation

- Validate replacement input.
- Revalidate live current matches, inherit starting marks, replace once.
- Implement up to 2000 reverse-order replacements in one transaction.
- Convert/budget-check final doc before dispatch.
- Connect dirty, editRevision, undo/redo, and feedback.
- Nondestructively reject 2001+, invalid models, stale ranges, and noneditable states.
- No autosave or main-process protocol change.

**Gate for WP5:** automated evidence for atomicity, formatting inheritance, one undo, zero changes on budget failure, and existing safe-save entry points.

### WP5: compatibility, saving-time edits, path migration, cross-feature regressions

- Cover read-only, degraded confirmation revision, saving, save-error, conflict, read-error.
- Cover replacement during saving and dirty afterward.
- Cover tabs, closure, workspace changes, rename/move/save-as, stable tabId.
- Cover coexistence with workspace navigation/mutationEpoch/current panel.
- Fix in-scope races, dangling controls, late subscriptions, and focus.
- Add no product feature or completion report.

**Gate for WP6:** lifecycle matrix passes, no path-identity fallback, late-controller cross-wiring, or lost edits; Task 1–9 regressions pass.

### WP6: performance, Windows smoke tests, and risk resolution

- Perform 8.8 performance/leak observations.
- Perform development/production Windows manual smoke tests.
- Verify Word/WPS changes, read-only/degraded, inheritance, mixed tabs, and file management migration.
- Inspect console, bundle, listeners, timers, residue, preload/IPC exposure.
- Fix only evidenced Task 10 issues.
- Do not mark completion early.

**Gate for WP7:** recorded baseline/performance/desktop/safety evidence; no unresolved corruption, partial replacement, permission expansion, or obvious stalling.

### WP7: final acceptance, documentation, completion report

- Verify section 11 item-by-item, never guessing checkmarks.
- Run typecheck/lint/format/all tests/full `check`/`build`.
- Recheck development/production Windows smoke tests.
- Update README capabilities/unimplemented/Roadmap/docs/structure.
- Update `PROJECT_BASELINE.md` and `TESTING.md`.
- Add `docs/tasks/task-010/TASK_010_COMPLETION_REPORT.md`.
- Mark complete and check section 11 only when every criterion is satisfied.
- Otherwise retain planned/in-progress state and list blockers, without substituting Basically Complete for acceptance.

## 11. Final acceptance criteria

These begin unchecked. Only WP7 verifies each against actual evidence.

### 11.1 Find and navigation

- [x] Active DOCX Ctrl+F/H opens correct sidebar/field.
- [x] Find uses live unsaved ProseMirror content, not disk.
- [x] Literal/case/non-overlap/single-line/length rules are deterministic.
- [x] Paragraphs/headings/cross-marks/lists/Chinese/emoji match.
- [x] Matches do not cross synthetic block newlines.
- [x] Cyclic previous/next, counts, selection, scrolling, focus are correct.
- [x] Ordinary/current decorations are identifiable without editing content.
- [x] 2000/2001 budgets and truncation are correct.
- [x] Find/navigation/panel close do not dirty or enter undo history.

### 11.2 Replacement

- [x] Replace Current revalidates live ranges at execution.
- [x] Empty/short/long/Chinese/emoji replacements work.
- [x] Cross-marks replacement inherits starting marks.
- [x] Paragraph/heading/list structure and unmatched formatting remain.
- [x] Replace All runs in reverse order in one transaction.
- [x] One undo/redo restores/reapplies all replacements.
- [x] Zero matches makes no changes; 2001+ wholly rejects without partial replacement.
- [x] Conversion/budget failure means 0 dispatch and 0 dirty.
- [x] Success enters dirty/editRevision without autosaving.
- [x] Saving results uses existing revision/backup/safe-replacement flows.

### 11.3 Compatibility and lifecycle

- [x] Read-only finds but cannot replace.
- [x] Unconfirmed degraded finds only; current-revision confirmation permits replacement.
- [x] Earlier save completion does not clear saving-time replacement.
- [x] Save-error/conflict/read-error are deterministic.
- [x] TXT/DOCX tab states/decorations/selections/history isolate.
- [x] Closure/reopening/workspace switching clean up completely.
- [x] Stable tabId search state survives rename/move/save-as.
- [x] Workspace navigation/mutationEpoch/current search do not contaminate one another.
- [x] No late controls, duplicate subscriptions, timers, or editor leaks.

### 11.4 UI, accessibility, and safety

- [x] TXT retains existing CodeMirror current-search behavior.
- [x] DOCX inputs/buttons/counts/errors/truncation/disabled reasons are accurate.
- [x] Shortcuts, focus entry/restoration, keyboard order, screen-reader names work.
- [x] Current identity is not color-only; minimum-window controls remain reachable.
- [x] No content-DOM parsing or private editor APIs.
- [x] No query/replacement/content logging.
- [x] No added IPC/preload/DesktopApi/filesystem permissions.
- [x] No unevaluated dependencies.

### 11.5 Quality, performance, documentation

- [x] Complete pure/plugin/component/replacement/compatibility/lifecycle/regression tests.
- [x] Full `check` passes; skips have justified, recorded conditions.
- [x] `build` passes.
- [x] Development/production Windows smoke tests pass.
- [x] Typical/limit fixtures show no clearly unacceptable stalls.
- [x] No unhandled console exceptions, obvious leaks, or temporary residue.
- [x] README, PROJECT_BASELINE, TESTING, and structure are synchronized.
- [x] Complete `TASK_010_WP0_REPORT.md` and `TASK_010_COMPLETION_REPORT.md`.
- [x] No regression in Task 1–9 capabilities.

## 12. Failure handling and decisions

- Unreliable ProseMirror mapping: make no edit, clear old matches, recalculate; never guess nearby identical text.
- Newline/overlength input: show validation errors, never silently truncate.
- More than 2000 matches: bounded navigation, disabled Replace All, no partial execution.
- Invalid/over-budget candidate: abort entirely without dispatch or bypassing validation.
- Read-only/unconfirmed degraded: defensively reject inside commands, not only disabled buttons.
- Editor destroyed before asynchronous work: discard results/release resources without writing React state.
- Active tab changes: old controls cannot operate on new tabs.
- Replacement during saving: retain normal continued-editing semantics without canceling/overwriting existing saves.
- Save conflict after replacement: preserve local replacements and use existing reload confirmation, never automatic disk overwrite.
- Insufficient performance: measure scan/mapping/decorations/React subscription stages before choosing debounce or less duplicate work; do not start with indexes/workers.
- New dependency: written evaluation and confirmation before installation.
- TXT regression: restore CodeMirror behavior first, not a forced shared-engine rewrite.
- Safety versus convenience: prioritize model validity, compatibility, Replace All atomicity, unsaved content, and nondestructive failure.

## 13. Prompt templates for actual development

These are complete templates to copy directly to the implementing Agent, not summaries or slogans. Use only one work-package template per conversation. Replace `[当前分支]` (current branch), `[上一包提交或恢复点]` (previous package commit/recovery point), and `[已知用户修改]` (known user changes) with actual values. Do not combine work packages into one oversized implementation.

### 13.1 Shared execution rules

- Read this entire plan, the directly relevant source/tests listed in the template, and the preceding package report.
- First report branch, HEAD, working tree, user changes, previous recovery point, current scope/non-goals, expected files, tests, and rollback method.
- Protect user changes; do not run `git reset --hard`, overwrite via checkout, or clean unrelated files.
- Implement only the current WP, with no later packages or unrelated refactoring.
- After edits, run targeted tests, then full `npm run check` and `npm run build`.
- After each package review `git diff`, `git status --short`, dependencies, IPC/preload exposure, sensitive logging, `.only` / unconditional `.skip`, listener/timer cleanup.
- Report actual changes, decisions, plan deviations, commands, manual evidence, performance, limitations, and gate status.
- Stop on failed gates; do not enter the next package independently.
- Only WP7 adds the completion report, checks section 11, and marks the task complete.

### 13.2 WP0 execution prompt

> Execute `TASK-010` `WP0: freeze baseline, editor transactions, and resource semantics`. Current branch: `[当前分支]`; previous recovery point: `[上一包提交或恢复点；首包写 Task 9 完成提交]` (for the first package, use Task 9's completion commit); known user changes: `[已知用户修改]`. First read all of `README.md`, `docs/architecture/PROJECT_BASELINE.md`, `docs/development/DEVELOPMENT_ENVIRONMENT.md`, `docs/development/TESTING.md`, Task 6/7/8/9 plans and completion reports, and `docs/tasks/task-010/TASK_010_DOCX_FIND_REPLACE.md`. Then read `src/shared/docx.ts`, `docx-convert.ts`, `docx-search-text.ts`, `src/renderer/lib/document-tabs.ts`, `use-documents.ts`, `use-editor-sessions.ts`, `EditorSessionHost.tsx`, `DocxEditorSessionHost.tsx`, `DocumentPane.tsx`, `SearchSidebar.tsx`, `App.tsx`, and direct tests. Report branch, HEAD, working tree, Task 9 test baseline, non-goals, minimum fixtures, verification checklist, and planned report content. Actually run full `check`/`build`, record files/tests/conditional skips, and establish development/production main-window launch baselines. Perform only technical validation and planning freezes. Minimal Tiptap/ProseMirror fixtures must validate live textblock projection against Task 8, cross-marks ranges, Chinese/emoji/combining-character UTF-16 mapping, Decoration, read-only navigation, degraded permission, edits during saving, starting-mark inheritance, empty replacement, reverse-order single-transaction Replace All, one undo, predispatch `tiptapJsonToDocxModel` budget checks, 2000/2001 limits, and near-limit performance. Add no dependency by default; do not connect product UI, implement production matcher/plugin/controller/replacement, or change final acceptance checks. Add `docs/tasks/task-010/TASK_010_WP0_REPORT.md`, recording actual commands, environment, fixtures, API behavior, timings, failures, frozen decisions, and gate status. If fixed assumptions fail, update the Task 10 plan and stop. Before finishing, review diff and run full `check`/`build`; report whether the baseline is repeatable, key ProseMirror behavior has evidence, and replacement/budget semantics have no unresolved issues.

### 13.3 WP1 execution prompt

> Execute `TASK-010` `WP1: pure find, textblocks, and mapping`. Branch: `[当前分支]`; previous commit/recovery point: `[上一包提交或恢复点]`; known user changes: `[已知用户修改]`. Read `docs/tasks/task-010/TASK_010_DOCX_FIND_REPLACE.md`, `docs/tasks/task-010/TASK_010_WP0_REPORT.md`, `src/shared/docx-search-text.ts`, `src/shared/docx.ts`, `src/main/search/match-text.ts` only for semantic comparison, Task 8 navigation in `DocxEditorSessionHost.tsx`, and projection/locate/find-replace tests. Report WP0 decisions, pure-module API, non-goals, files, and test matrix. Implement only renderer pure functions: query/replacement validation, literal + caseSensitive matching, left-to-right non-overlapping bounded results, 2000/2001 truncation, initial current index, cyclic next/previous, nearest matches after edits, and live textblock projection with `joinDocxTextBlocks` plus UTF-16 range-to-ProseMirror mapping. Do not install a plugin, create Decorations, connect React UI, register controls, dispatch transactions, implement replacement, or change IPC/preload. Tests cover paragraphs/headings/empty paragraphs/cross-marks/bulleted-numbered-nested lists/Chinese/emoji/combining characters/artificial-newline rejection/repeated-character non-overlap/length and match budgets. Do not duplicate incompatible Task 8 body projection. Run new pure tests and existing projection/locate tests, then full `check`/`build`. Report exports, complexity, budgets, measured differences from CodeMirror/workspace matcher, diff, and WP1 gate status; do not proceed to WP2.

### 13.4 WP2 execution prompt

> Execute `TASK-010` `WP2: ProseMirror plugin, decorations, and per-tab controller`. Branch: `[当前分支]`; previous commit/recovery point: `[上一包提交或恢复点]`; known user changes: `[已知用户修改]`. Read this plan, WP0 report, WP1 pure modules/tests, `DocxEditorSessionHost.tsx`, Tiptap creation/destruction/external setContent paths, resident DOCX hosts in `DocumentPane.tsx`, and existing editor/locate tests. Report plugin state, PluginKey, DecorationSet, controller snapshot/subscriptions, generation, and cleanup strategy. Implement only the project-owned current-search plugin/controller: per-stable-tabId queries, scheduling, ordinary/current decorations, open/close, setQuery, setCaseSensitive, next/previous, TextSelection, scroll/focus, safe recalculation after transactions/external setContent, active-match selection, subscriptions, and destruction. Test-host registration is allowed, but do not connect production SearchSidebar/App, implement replacement transactions, or add dependencies/IPC/preload. Find/navigation/panel toggles must not alter doc, dirty, or undo history. Async callbacks require generations; stale editors/computations must not report. Hidden editors must not recalculate because other tabs change. Test decoration ranges/classes, cyclic navigation, selection/focus, read-only, edits, setContent, rapid-query latest results, editor isolation, and destruction without dangling listeners. Use WP0 data for minimal refresh scheduling; no premature workers/indexes. Run targeted plugin/editor tests, then full `check`/`build`. Report state transitions, scheduling timings, cleanup, diff, and WP2 gate status; do not proceed to WP3.

### 13.5 WP3 execution prompt

> Execute `TASK-010` `WP3: sidebar, shortcuts, and active-editor integration`. Branch: `[当前分支]`; previous commit/recovery point: `[上一包提交或恢复点]`; known user changes: `[已知用户修改]`. Read this plan, WP0, WP1/WP2 code/tests, `EditorSessionHost.tsx`, `use-editor-sessions.ts`, `DocxEditorSessionHost.tsx`, `DocumentPane.tsx`, `SearchSidebar.tsx`, `App.tsx`, `app.css`, existing `find-replace.test.tsx`, `docx-editor.test.tsx`, and search-sidebar tests. Report how TXT CodeMirror panels remain, how DOCX controls are discriminated, atomic active-tabId switching, focus, and shortcuts. Add only the DOCX current-find React panel and connect WP2 controls through DocxEditorSessionHost/DocumentPane/SearchSidebar/App. Support Ctrl+F/H, Enter/Shift+Enter, F3/Shift+F3, Escape, buttons, query/case/counts/truncation/input errors/decorations/focus restoration. TXT keeps its existing CodeMirror panel host and matcher; SearchSidebar shows only the active kind. Read-only/degraded can find and explain replacement unavailability. Replacement fields/buttons must not become falsely executable before WP4. Old controls must not act on new tabs, and editor identity must not derive from names/paths. Add only minimum styles/accessibility, not the future comprehensive UI rework. Add component, shortcut, mixed-kind, focus, no-active/loading/read-only/degraded tests. Run targeted component tests then full `check`/`build`. Report flow, controls lifecycle, accessibility, TXT regressions, diff, and WP3 gate; do not proceed to WP4.

### 13.6 WP4 execution prompt

> Execute `TASK-010` `WP4: Replace Current/All and model prevalidation`. Branch: `[当前分支]`; previous commit/recovery point: `[上一包提交或恢复点]`; known user changes: `[已知用户修改]`. Read this plan, WP0 transaction/marks/budget evidence, WP1 matcher, WP2 plugin/controller, WP3 UI, `docx-convert.ts`, `docx.ts`, `document-tabs.ts` `editDocxTab`/editRevision, `use-documents.ts`, host content reporting, and DOCX undo/save tests. Report live revalidation, inheritance, reverse transactions, prevalidation, dirty/undo, and errors. Implement only replacement input, replaceCurrent, replaceAll, and UI enablement: reproject/revalidate at execution, keep matches within one textblock, inherit starting marks for nonempty text, delete for empty text, and preserve paragraph/heading/list structure. Replace All handles at most 2000 matches from end to start in one transaction. Before dispatch, `transaction.doc.toJSON()` passes `tiptapJsonToDocxModel` and existing budgets. Failure means 0 dispatch/0 dirty overall; success dispatches once, uses existing editDocxTab/dirty/editRevision, and supports one undo/redo. Reject 2001+ Replace All, do nothing for zero matches, prevent rapid duplicate application, and do not autosave or change saveDocx/IPC/preload. Enforce permissions inside commands, not only disabled buttons. Test single/same-marks/different-marks runs, starting format, headings/lists, Chinese/emoji, empty/short/long text, drift, invalid models, 2000/2001, one-transaction undo/redo, and actual counts. Run targeted replacement/editor/model tests, existing DOCX save tests, full `check`/`build`. Report transaction evidence, formatting, budget-failure atomicity, diff, and WP4 gate; do not proceed to WP5.

### 13.7 WP5 execution prompt

> Execute `TASK-010` `WP5: compatibility, saving-time edits, path migration, and cross-feature regressions`. Branch: `[当前分支]`; previous commit/recovery point: `[上一包提交或恢复点]`; known user changes: `[已知用户修改]`. Read this plan, WP0, WP1–WP4 code/direct tests, especially compatibility/save transitions in `document-tabs.ts`, `use-documents.ts`, `use-file-management.ts`, `DocumentPane.tsx`, `App.tsx`, workspace navigation/mutationEpoch, and Task 9 path-migration/save-as/lifecycle tests. First list the complete read-only/degraded-revision/loaded/dirty/saving/save-error/conflict/read-error/close/workspace/path/navigation matrix. Complete only compatibility/lifecycle behavior: read-only find with defensive replacement rejection; unconfirmed degraded find only, confirmation enabling replacement in the same editor, and new revisions invalidating old confirmation; saving-time replacement advances editRevision and remains dirty; deterministic save-error/conflict/read-error; correct mixed tabs, close/reopen, workspace switch, rename/move/save-as retention/cleanup; independent workspace navigation/mutationEpoch/current search; safe old controls, subscriptions, generations, and focus callbacks. Add no search type, workspace replacement, watching, autosave, protocol, or completion report. Run targeted lifecycle/path/search-interaction tests then full `check`/`build`. Report matrix evidence, races fixed, stable-tabId proof, saving-time edits, diff, and WP5 gate; do not proceed to WP6.

### 13.8 WP6 execution prompt

> Execute `TASK-010` `WP6: performance observations, Windows smoke tests, and risk resolution`. Branch: `[当前分支]`; previous commit/recovery point: `[上一包提交或恢复点]`; known user changes: `[已知用户修改]`. Read this plan, WP0, and all WP1–WP5 code/tests; inspect controller/plugin/UI subscriptions, timers, generations, model prevalidation, and styles. Add no product capability, protocol expansion, unrelated refactoring, or completion report. Fix only evidenced Task 10 problems. With deterministic fixtures, observe 100 paragraphs, 20,000 textblocks, near-serialization-limit documents, few matches, 2000/2001 matches, and 2000-item Replace All. Measure scanning/mapping/Decoration/transaction/model-validation/dispatch and record environment, without unstable CI wall-clock assertions. Rapid typing, repeated panel toggling, and tab switching must reveal no duplicate subscriptions, late results, or obvious memory growth. Actually run Windows development/production smoke paths covering Ctrl+F/H, navigation/highlights, different-marks inheritance, Replace All/undo/redo/save, headings/lists/Chinese/emoji, read-only/degraded, mixed TXT/DOCX, dirty/saving, external Word/WPS conflicts, rename/move/save-as, minimum window, and keyboard focus. Audit bundle increase, console, IPC/preload set, sensitive logs, residue, `.only`/unconditional `.skip`. Run targeted tests and full `check`/`build`. Report commands, mode, hardware/fixtures, performance, manual evidence, fixes, remaining risks, and WP6 gate; do not proceed to WP7.

### 13.9 WP7 execution prompt

> Execute `TASK-010` `WP7: final acceptance, documentation, and completion report`. Branch: `[当前分支]`; previous commit/recovery point: `[上一包提交或恢复点]`; known user changes: `[已知用户修改]`. Read all of `docs/tasks/task-010/TASK_010_DOCX_FIND_REPLACE.md`, `docs/tasks/task-010/TASK_010_WP0_REPORT.md`, WP1–WP6 commits/recovery points, all added source/tests, README, PROJECT_BASELINE, TESTING, and Task 9 completion. Add no feature; fix only in-scope acceptance issues. Verify every section 11 item using automated tests, review, performance, or manual smoke evidence, never guesses. Actually run typecheck, lint, format check, all tests, full `check`/`build`, recording file/pass/failure/conditional-skip counts and reasons; run final development/production Windows smoke tests. Review literal/UTF-16/2000 limits, nonediting Decorations, live revalidation, starting marks, one-transaction Replace All, prevalidation, read-only/degraded/saving, stable tabId, old-control/subscription cleanup, TXT/workspace regressions, unchanged IPC/preload, no sensitive logging, and no `.only`/unconditional `.skip`. Update README capabilities/unimplemented/Roadmap/docs/structure, PROJECT_BASELINE, TESTING. Add `docs/tasks/task-010/TASK_010_COMPLETION_REPORT.md` describing implementation, files, fixed semantics, search/mapping, plugin/controller/UI, transactions/inheritance/budget atomicity, compatibility/lifecycle, safety, tests, performance, Windows evidence, and limitations. Mark complete and change section 11 to `[x]` only if all criteria are actually met; otherwise keep planned/in-progress and list blockers. Finish with final diff, command evidence, unresolved issues, and whether all Task 10 standards are met.

## 14. Deliverables

On completion deliver:

1. Pure current-DOCX literal search, validation, budgets, and mapping modules.
2. ProseMirror current-search plugin, PluginKey, DecorationSet, per-tab controller.
3. Narrow controls, stable subscriptions, generations, destruction cleanup.
4. DOCX current-find/replace React panel and shortcuts.
5. Kind-based shared-sidebar routing for TXT CodeMirror / DOCX ProseMirror.
6. Replace Current, starting-mark inheritance, model prevalidation.
7. Up to 2000 reverse-order replacements in one undoable transaction.
8. Read-only/degraded/saving/conflict/external-reload lifecycle.
9. Stable-tabId multi-tab/rename/move/save-as session retention.
10. Pure/plugin/component/replacement/compatibility/lifecycle/performance/regression tests.
11. `docs/tasks/task-010/TASK_010_WP0_REPORT.md`.
12. Updated README, PROJECT_BASELINE, TESTING, and project structure.
13. `docs/tasks/task-010/TASK_010_COMPLETION_REPORT.md`, including at least:
    - Implementation summary and key files.
    - Literal/case/single-line/non-overlap/2000-match budget.
    - Live ProseMirror projection, UTF-16, textblock/PM mapping.
    - Plugin, Decoration, controller, controls, sidebar.
    - Live replacement revalidation, starting marks, reverse single transaction, prevalidation.
    - Read-only/degraded/saving/dirty/conflicts/path migration.
    - TXT/workspace-search regressions and IPC/preload safety.
    - Automated tests, performance, Windows development/production smoke tests.
    - Known limitations and whether all acceptance criteria are satisfied.

## 15. Entry point for the next task

After Task 10, compare these candidates using actual feedback and plan separately:

- Filesystem watching, external-change notices, safe automatic refresh.
- Basic settings, themes, startup/session recovery.
- Tab dragging, pinning, bulk closure, state restoration.
- UI-1 design baseline and component states from the future UI plan.
- Windows installers, signing, formal release process.

Prioritize comparing filesystem watching/external-change notices with UI-1 design baseline. Task 10 must not also implement any of these.
