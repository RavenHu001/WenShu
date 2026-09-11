# TASK-007: Basic DOCX Reading, Editing, and Safe Saving

[简体中文](./TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

## Task status

- Status: `Completed` (latest regression and manual WPS acceptance completed on 2026-08-11; see the [TASK-007 completion report](./TASK_007_COMPLETION_REPORT.en.md))
- Priority: `P0`
- Type: `Product vertical slice / New file type / Rich-text editing / High-risk file writes`
- Prerequisite: [TASK-006: Workspace TXT Search and Current-File Find and Replace](../task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.en.md)
- Prerequisite completion report: [TASK-006 completion report](../task-006/TASK_006_COMPLETION_REPORT.en.md)
- Recommended next task: Workspace DOCX body-text search and result navigation
- Project baseline: [PROJECT_BASELINE.md](../../architecture/PROJECT_BASELINE.en.md)
- Execution: Implement and accept work packages in order; only the final package may change the status to `Completed`.

## 1. Purpose

Task 6 completed the TXT workflow: workspace file tree → multiple TXT tabs → independent CodeMirror sessions → safe saving → current-file find and replace → workspace TXT search and safe navigation. This task adds the first structured document type, basic DOCX, while preserving TXT capabilities and Electron security boundaries.

```text
Regular .docx in the workspace
  -> Main process reads raw bytes through controlled access and calculates revision
  -> Check file size, basic ZIP/OOXML structure, and resource budgets
  -> Import the supported content into DocxDocumentModel
  -> Read and edit in an independent Tiptap/ProseMirror rich-text session
  -> Edits set dirty, support undo/redo, and receive close protection
  -> Revalidate the disk revision before saving
  -> Create a same-directory rolling backup, then generate and validate a temporary DOCX
  -> Flush, close, and safely replace the target
  -> On failure, retain the original file, backup, and unsaved edits
```

The task establishes the following complete boundaries, beyond allowing the file tree to accept the `.docx` extension:

1. TXT and DOCX share tab lifecycles but have separate content models, editors, and file handlers.
2. An explicit structured intermediate model connects DOCX import, editor state, and export.
3. Only basic formatting is promised; complex content requires a compatibility report and safe degradation.
4. DOCX saving must combine external-change conflict detection, a pre-save backup, temporary writes, output validation, and safe replacement.
5. Adding DOCX must not expose arbitrary file reads, writes, ZIP operations, or IPC to the renderer.

## 2. User experience after completion

Users should be able to:

1. Identify and select regular `.docx` files in the workspace file tree.
2. Open each DOCX in a unique central tab with an explicit loading state.
3. Read regular paragraphs, headings, bold, italic, underline, basic font sizes, text colors, bulleted and numbered lists, and basic alignment.
4. Edit this supported content and use copy, cut, paste, undo, and redo.
5. Open TXT and DOCX together and switch between mixed tabs without contaminating their text, selection, scrolling, history, or dirty state.
6. See the current DOCX compatibility status; unsupported content must not silently appear fully compatible.
7. Click “保存” (Save) or press `Ctrl+S` for safely editable documents and see an explicit saving state.
8. Replace the original with basic DOCX output after a successful save while retaining a rolling backup of the most recent pre-save version.
9. Receive a conflict prompt after an external program changes the document; external content is not overwritten by default.
10. Retain editor content and dirty state after a save failure, without deletion, truncation, or damage to the original.
11. Keep unsaved-change protection when closing a dirty DOCX, switching workspaces, or closing the window.
12. Receive a stable error or read-only degradation for damaged, oversized, encrypted, or unsupported complex DOCX files instead of an application crash.
13. Open saved basic DOCX files in Microsoft Word, WPS Office, or LibreOffice and reopen them in Wenshu.

## 3. Prerequisite checks

Complete WP0 and record actual results before modifying product code.

### 3.1 Required reading

- `README.md`;
- `docs/architecture/PROJECT_BASELINE.md`;
- `docs/development/DEVELOPMENT_ENVIRONMENT.md`;
- `docs/development/TESTING.md`;
- `docs/tasks/task-004/TASK_004_TXT_EDIT_SAFE_SAVE.md` and its completion report;
- `docs/tasks/task-005/TASK_005_MULTI_TXT_TABS.md` and its completion report;
- `docs/tasks/task-006/TASK_006_TXT_SEARCH_FIND_REPLACE.md` and its completion report;
- `src/main/index.ts`;
- TXT reading, saving, and IPC in `src/main/document/`;
- Scanner, IPC, and workspace session in `src/main/workspace/`;
- `src/preload/index.ts`;
- `src/shared/desktop-api.ts`, `document.ts`, and `workspace.ts`;
- `src/renderer/App.tsx`;
- `src/renderer/components/document/` and `components/workspace/`;
- `src/renderer/lib/text-document-tabs.ts`, `use-text-documents.ts`, and `use-editor-sessions.ts`;
- Existing tests for TXT reading/saving, multiple tabs, window closing, preload, and search navigation.

### 3.2 Working tree and quality baseline

- Check `git status --short`; identify and protect existing user changes.
- Confirm that `main` includes Task 6 and `TASK_006_COMPLETION_REPORT.md`.
- Run `typecheck`, `lint`, `format:check`, `test`, the full `check`, and `build` in sequence.
- Do not run `check` and `build` concurrently.
- Record test-file, passing-test, and conditional-skip counts, build outputs, and all warnings.
- If Windows temporary-junction cleanup reproduces `EBUSY`, or React reports asynchronous `act(...)` warnings, identify the cause and repair test reliability in WP0.
- Do not create a passing baseline by deleting tests, skipping whole files, weakening assertions, or simply extending timeouts.

### 3.3 DOCX fixtures and compatibility environment

WP0 must prepare minimal, auditable DOCX fixtures without private information:

- Plain paragraphs and an empty document;
- Heading levels 1 through 3;
- Bold, italic, underline, and their combinations;
- Supported font sizes and hexadecimal text colors;
- Bulleted, numbered, and nested lists;
- Left, center, right, and justified alignment;
- Chinese, English, emoji, empty paragraphs, and multiple paragraphs;
- Complex samples with unsupported features such as images, simple tables, headers/footers, comments, or tracked changes;
- Failure samples including damaged ZIP, disguised extensions, excess size, encryption, or missing essential OOXML parts;
- Round-trip samples exported by Wenshu and imported again.

Prefer fixed scripts or test constructors for fixtures. If binary fixtures must be committed, record their source, purpose, and expected structure. Never commit real user documents.

Manual compatibility testing must cover at least one locally available external Office application. Microsoft Word is recommended; otherwise record the exact WPS Office or LibreOffice version.

### 3.4 Technical verification required from WP0

Before product implementation, WP0 must use fixtures to confirm:

1. Mammoth's actual import results for headings, emphasis, lists, font sizes, colors, and alignment.
2. Whether supported formatting that Mammoth cannot express requires JSZip to read a limited set of supplementary OOXML attributes.
3. The minimum Tiptap/ProseMirror schema and extension set.
4. Whether the `DocxDocumentModel -> docx` export mapping reliably generates files that external Office applications can open.
5. Whether import/export messages, warnings, and formatting loss can form a deterministic compatibility matrix.
6. Whether ordinary-document parsing, rendering, and export meet the goal of finishing within a few seconds.
7. Whether dependency licenses, package sizes, and runtimes are compatible with Electron 37, React 19, and TypeScript 5.

If the selected libraries cannot support a format without building a large OOXML engine, downgrade it to “readable, saving not guaranteed” or “unsupported” and update the compatibility matrix. Do not silently expand implementation complexity.

## 4. Fixed product and protocol decisions

### 4.1 Supported-format matrix

Task 7's editable and exportable scope is fixed as follows:

| Content                                      | Import                                         | Editing                          | Export                    |
| -------------------------------------------- | ---------------------------------------------- | -------------------------------- | ------------------------- |
| Regular and empty paragraphs                 | Supported                                      | Supported                        | Supported                 |
| Heading levels 1–3                           | Supported                                      | Supported                        | Supported                 |
| Bold, italic, underline                      | Supported                                      | Supported                        | Supported                 |
| Basic font sizes                             | Limited values or mapping from original values | Allowlisted values               | Supported                 |
| Text colors                                  | Ordinary RGB                                   | `#RRGGBB`                        | Supported                 |
| Bulleted and numbered lists                  | Basic nesting                                  | Supported                        | Supported                 |
| Paragraph alignment                          | Left/center/right/justified                    | Supported                        | Supported                 |
| Hyperlinks                                   | Degraded to visible text                       | Link attributes are not editable | Plain text                |
| Images and tables                            | Compatibility warning; degrade/omit            | Unsupported                      | Preservation not promised |
| Headers/footers, footnotes/endnotes          | Excluded from the editing model                | Unsupported                      | Preservation not promised |
| Comments, tracked changes, fields, equations | Excluded from the editing model                | Unsupported                      | Preservation not promised |
| Floating objects, text boxes, SmartArt       | Excluded from the editing model                | Unsupported                      | Preservation not promised |
| Macros, embedded scripts or objects          | Never executed                                 | Unsupported                      | Not preserved             |

WP0 must verify the font-size allowlist, maximum list depth, and color normalization against Tiptap and `docx`, then encode them in shared constants and tests. They must not exist only as implicit UI conventions.

### 4.2 Compatibility levels and editing policy

Every import must return a compatibility level and stable warning codes:

- `supported`: Contains only declared supported content; editing and saving are immediately available.
- `degraded`: Body content is usable, but unsupported content that may be lost was detected. Reading is available by default; editing or the first save requires explicit confirmation.
- `read-only`: The structure cannot be mapped safely, editing protection is explicitly enabled, or high-risk complex content is present. Extractable body text is displayed read-only.
- `rejected`: Invalid DOCX, actual encryption, resource-budget overflow, missing essential parts, or parsing failure; no editable tab body is created. A zero-byte `.docx` is the sole exception as a Windows/WPS lazy placeholder: it loads as a blank document and is materialized on the first save.

Confirmation must bind to stable tabId, relative path, revision, and the current compatibility report. It applies only to that revision; reading a different revision requires confirmation again.

Do not substitute a generic “may be incompatible” message for testable warnings. The shared contract must distinguish at least images, tables, headers/footers, comments, tracked changes, fields, equations, embedded objects, unknown styles, encryption/protection, and other unrecognized content.

### 4.3 Structured DOCX intermediate model

IPC and renderer document state use a project-owned structured model. None of the following may be the sole source of truth:

- Raw OOXML;
- Unsanitized HTML;
- Private Mammoth objects;
- Internal Tiptap/ProseMirror instances;
- `docx` library instances;
- `Buffer`, file handles, or ZIP objects.

The suggested shared model is a versioned discriminated union:

```ts
interface DocxDocumentModel {
  readonly schemaVersion: 1;
  readonly blocks: readonly DocxBlock[];
}

type DocxBlock = DocxParagraphBlock | DocxHeadingBlock | DocxBulletListBlock | DocxOrderedListBlock;

interface DocxTextRun {
  readonly text: string;
  readonly marks: readonly DocxTextMark[];
}
```

WP1 freezes the actual fields, which must meet these requirements:

- Independently runtime-validatable;
- No prototype objects, circular references, or executable content;
- Fixed limits for text, node count, list depth, mark count, and serialized size;
- Unit-testable conversions from model to editor, editor to model, and model to export library;
- Unknown schemaVersion is rejected; migration must not be guessed.

### 4.4 File identity, revision, and tab deduplication

- DOCX continues to use the normalized workspace-relative path as file identity.
- TXT and DOCX share a single tab-path namespace; a path has at most one tab.
- `tabId` stays stable for the tab's lifetime and is not an array index or filename.
- DOCX revision is the SHA-256 of the complete original bytes read.
- Reads, saves, compatibility confirmations, and asynchronous conversion results bind to `tabId + requestId + workspaceEpoch + relativePath + revision`.
- Late results are committed only while that identity still matches; otherwise discard them silently or show a non-destructive notice.

### 4.5 Resource limits and untrusted input

Fixed basic limits:

- A regular compressed DOCX is at most 20 MiB.
- ZIP entry count, total uncompressed size, individual critical XML size, and model node count have independent budgets.
- WP0 verifies exact budgets with fixtures, freezes them as shared constants, and records them in the completion report.
- Reaching a budget returns stable `FILE_TOO_LARGE` or `RESOURCE_LIMIT_EXCEEDED`; do not continue with partial editing.
- Do not read network relationships or fetch remote images, templates, OLE objects, or linked resources.
- Never execute macros, scripts, fields, embedded objects, or any document-provided code.
- Accept only case-insensitive `.docx`, excluding `.docm`, `.dotm`, `.rtf`, and disguised extensions.

### 4.6 Rich-text editor and state ownership

- TXT retains CodeMirror 6; DOCX uses the baseline's Tiptap/ProseMirror.
- Install only the minimum extensions needed for section 4.1; do not add collaboration, cloud services, AI, pagination, or a full Word UI.
- Tiptap instances exist only in renderer DOCX sessions and never cross IPC.
- React/controllers own serializable document, save, and compatibility state.
- Determine dirty through a monotonic content version or an equivalent stable mechanism; avoid unbounded deep comparisons of large JSON on each keystroke.
- Saving captures a content version. Completion clears dirty only if that version is unchanged; edits made while saving remain unsaved.
- Switching tabs preserves each selection, scroll position, and undo/redo history; closing tabs or switching workspaces cleans up their sessions.

### 4.7 DOCX saving and rolling backups

Before overwriting an existing DOCX, complete these steps in order:

1. Revalidate workspace, relative path, extension, symbolic links, real path, regular-file status, and disk revision.
2. Create or refresh the same-directory rolling backup `<文件名>.wenshu.bak` from the current verified original file.
3. Write the backup to its own exclusive temporary file; complete writes, flush, close, and safely replace the backup.
4. Generate new DOCX bytes from the submitted structured model.
5. Validate generated size, basic ZIP/OOXML structure, and successful reimport.
6. Write the generated bytes to an exclusive temporary file alongside the target; complete writes, flush, and close.
7. Confirm again that the target still has the same revision immediately before replacement.
8. Replace safely without deleting or truncating the target first.
9. On success, return the new revision, file size, compatibility information, and relative backup name.
10. On any failure, retain the original target and renderer's unsaved content; clean up this operation's temporary files on a best-effort basis.

The rolling backup retains only the latest pre-save version. Task 7 adds no version history. A backup-creation or validation failure aborts saving; there is no “save without backup” mode. Backup files must not appear as ordinary `.docx` in editable-file filters.

### 4.8 Export is basic reconstruction, without a lossless round-trip promise

- Saved DOCX is regenerated from the supported intermediate model, without modifying arbitrary nodes in the original OOXML package.
- `supported` documents preserve semantics and basic formatting within section 4.1.
- Saving `degraded` documents may lose content excluded from the model; confirmation is required before first editing or saving.
- Do not merge unknown OOXML fragments into newly exported content.
- Do not implement pagination, Word layout, or a complete style-inheritance engine.
- Opening successfully in external Office, correct supported content, and honest preservation claims take priority over apparently warning-free saving.

### 4.9 Boundaries for creation, Save As, and DOCX search

- Task 7 only opens and overwrites existing regular DOCX files within the workspace.
- Generating save output with `docx` constitutes this task's “basic export”; it adds no Save As operation to arbitrary target paths.
- Creating DOCX, Save As, renaming, moving, and deletion belong to later file-management tasks.
- Current-DOCX find/replace and workspace DOCX body-text search are outside this task.
- Task 6's TXT candidates, matching semantics, limits, and navigation protocol remain unchanged. Do not implicitly insert DOCX into the TXT searcher.

## 5. Suggested data model and invariants

### 5.1 Shared snapshots and requests

Suggested independent shared contracts:

```ts
interface DocxDocumentSnapshot {
  readonly kind: 'docx';
  readonly relativePath: string;
  readonly name: string;
  readonly revision: string;
  readonly size: number;
  readonly model: DocxDocumentModel;
  readonly compatibility: DocxCompatibilityReport;
}

interface SaveDocxDocumentRequest {
  readonly relativePath: string;
  readonly expectedRevision: string;
  readonly model: DocxDocumentModel;
  readonly compatibilityConfirmationRevision?: string;
}
```

Keep final fields minimal. Requests must not include workspace roots, absolute paths, target temporary paths, backup paths, arbitrary XML/HTML, replacement strategies, or filesystem options.

### 5.2 Tabs with multiple content types

Evolve `TextDocumentTabState` into a discriminated union with a shared lifecycle and type-specific content, for example:

```ts
type DocumentTabState = TextDocumentTabState | DocxDocumentTabState;
```

Shared fields include `tabId`, `kind`, `relativePath`, `name`, `status`, `dirty`, `requestId`, `workspaceEpoch`, and errors. TXT-specific `lineEnding`, BOM, plain text, and CodeMirror runtime must not enter the DOCX branch. DOCX-specific structured models, compatibility reports, confirmation revisions, and Tiptap runtime must not enter TXT.

### 5.3 Required invariants

1. All tab `tabId` values are unique.
2. All normalized tab-relative paths are unique.
3. Active tabId is empty or references an existing tab.
4. Each live TXT tab has at most one CodeMirror session.
5. Each live DOCX tab has at most one Tiptap session.
6. Combinations of loading, saving, conflict, error, and dirty obey the corresponding file-type state machine.
7. A tab cannot save concurrently with itself; different tabs may save in parallel.
8. Save completion applies only to an existing tab whose identity, requestId, epoch, path, and baseline revision still match.
9. An old save success cannot clear newer dirty edits made while saving.
10. `degraded` documents cannot be written without user confirmation for the current revision.
11. `read-only` and `rejected` documents cannot initiate saving.
12. Multi-type abstractions must not change TXT behavior or Task 6 search navigation.

## 6. Suggested module and file responsibilities

### 6.1 Shared contracts

Suggested additions:

- `src/shared/docx.ts`: DOCX model, compatibility, snapshots, read/write results, error codes, fixed limits, and runtime validation;
- `src/shared/document.ts`: Retain common document identity or aggregate existing TXT/DOCX types through small exports, avoiding a wholesale rewrite of TXT contracts;
- `src/shared/desktop-api.ts`: Fixed narrow `readDocx` / `saveDocx` interfaces.

### 6.2 Main-process DOCX handler

Add `src/main/docx/` or group the following in `src/main/document/docx/`:

- `inspect-docx-package.ts`: ZIP/OOXML structure, relationships, and resource-budget checks;
- `import-docx.ts`: Mammoth plus limited supplementary reads into the intermediate model;
- `export-docx.ts`: Intermediate model to `docx` output;
- `read-docx-document.ts`: Workspace path security, controlled reading, revision, and import;
- `save-docx-document.ts`: Conflicts, backup, generation, validation, temporary writes, and safe replacement;
- `docx-ipc.ts`: Fixed IPC and request runtime validation.

TXT path checks, complete reads/writes, and replacement steps may become small internal helpers. This does not permit exposing a generic renderer filesystem API or broad refactoring unrelated to Task 7.

### 6.3 preload and DesktopApi

Keep the new capabilities narrow:

```ts
document.readDocx(relativePath);
document.saveDocx(request);
```

preload only forwards arguments and returns results. It does not parse DOCX, process paths, or retain Buffer objects. Main-process IPC rejects extra fields and applies bounded runtime validation to structured models.

### 6.4 Renderer multi-document controller

- Gradually evolve existing pure multi-TXT state into multi-type tab state.
- Share opening, activation, closing, workspace invalidation, dirty counts, and protection during saves.
- Existing branches continue to handle TXT reading/saving.
- The DOCX controller owns reading, compatibility confirmation, edit versions, saving, and conflicts.
- App dispatches by file type without embedding import/export details.
- Search results still dispatch only TXT opening and navigation.

### 6.5 Rich-text editor components

Suggested additions:

- `DocxEditorSessionHost.tsx`: Tiptap lifecycle, transactions, selection, scrolling, and history;
- `DocxToolbar.tsx`: Supported formatting actions only;
- `DocxCompatibilityNotice.tsx`: Compatibility levels, warnings, and confirmation entry;
- Pure conversion module: `DocxDocumentModel <-> Tiptap JSON`.

The generic `DocumentPane` must not manipulate private Tiptap state. It selects the TXT/DOCX host by `kind` and displays shared tab/save state.

## 7. Electron and security boundaries

### 7.1 Minimum interface for new capabilities

The renderer may submit only:

- A normalized workspace-relative path;
- Read/save request identity;
- Expected revision;
- A bounded, runtime-validated `DocxDocumentModel`;
- The current compatibility-confirmation revision when necessary.

The renderer must not submit:

- Workspace roots or arbitrary absolute paths;
- Backup, temporary-file, or replacement-target paths;
- Raw ZIP/OOXML or arbitrary HTML;
- Shell commands, external programs, network URLs, or library configuration;
- Dangerous policies such as force overwrite, skip backup, or ignore validation.

### 7.2 Security properties to preserve

- `nodeIntegration: false`;
- `contextIsolation: true`;
- Renderer sandbox remains enabled;
- Renderer does not directly import filesystem capabilities from Node.js, Mammoth, JSZip, or `docx`;
- The main-process workspace root comes only from `workspace-session`;
- Every read and save revalidates paths, symbolic links, real paths, and file types;
- Treat DOCX as untrusted ZIP, with resource limits on all parsing and model conversion;
- No external relationships, macro execution, or remote-resource loading;
- Error results reveal no raw exceptions, absolute paths, file content, XML, Buffer, handles, or stack traces;
- Logs contain no document body, full model, absolute paths, backup content, or temporary names;
- Saving never deletes or truncates the original first; backup failure means save failure.

## 8. Testing requirements

### 8.1 Task 1–6 regression

- Execute and pass every existing test.
- Preserve TXT reads, saves, conflicts, line endings, BOM, temporary replacement, and error semantics.
- Preserve multiple TXT tabs, independent CodeMirror sessions, close protection, and window coordination.
- Preserve current-file find/replace, workspace TXT search, and result navigation.
- New DOCX tests do not replace existing regression coverage.

### 8.2 Model, compatibility, and conversion tests

- Runtime validation of valid models and every invalid structure;
- schemaVersion, node counts, text lengths, marks, list depths, and serialization budgets;
- Import of paragraphs, headings, marks, font sizes, colors, lists, and alignment;
- Mammoth/limited supplementary OOXML results to the project model;
- Project model to Tiptap JSON and back;
- Project model to `docx` output and reimport;
- Stable compatibility warnings for unsupported content;
- Exclusion of unsanitized HTML, unknown nodes, and dangerous attributes from the model.

### 8.3 Main-process reading and security tests

- Root and nested `.docx` reads;
- Extension case variations;
- No workspace, invalid/absolute paths, `..`, empty segments, drive letters, and NUL;
- Directories, symbolic links, junctions, intermediate links, and workspace escape;
- Missing files, permission failures, changes during reading, and non-regular files;
- Exactly at and above limits;
- Non-ZIP, missing essential OOXML parts, damaged relationships, encryption, and resource-budget overflow;
- SHA-256 revision based on raw bytes;
- Stable errors for expected and unexpected failures.

### 8.4 Save, backup, and failure-recovery tests

- No save call without dirty content;
- Successful save with matching expectedRevision;
- External revision mismatch returns conflict with zero writes;
- Backup bytes equal the pre-save original;
- Backup failure prevents target generation or replacement;
- Export/output-validation failures and temporary open/write/sync/close/replace failures;
- Target changes again during saving, aborting replacement;
- Every failure preserves the original without deletion/truncation and keeps dirty;
- Best-effort temporary cleanup does not replace the primary error with cleanup errors;
- Success returns a new revision; output can be reimported and opened in external Office;
- Old save success does not clear dirty edits made during saving;
- Reject unconfirmed `degraded`, expired confirmation revisions, `read-only`, and invalid models.

### 8.5 IPC and preload contract tests

- Only fixed DOCX read/write channels are registered;
- Argument count, field allowlists, field types, model budgets, and requestId validation;
- Reject root/absolute/temporary/backup paths, raw HTML/XML, and dangerous strategy fields;
- preload exposes only narrow interfaces, with no `ipcRenderer`, Buffer, or arbitrary invoker;
- Main-process results expose no internal objects or raw exceptions.

### 8.6 Multi-type tabs and rich-text component tests

- File tree selects only regular `.txt` and `.docx` files;
- Path deduplication and correct mixed TXT/DOCX ordering and activation;
- DOCX loading, loaded, degraded, read-only, error, dirty, saving, and conflict states;
- Basic formatting toolbar and disabled states;
- Editing, undo, redo, copy/paste, and no-change transactions;
- Per-tab selection, scrolling, and history isolation;
- Saving, editing during saving, conflicts, and rereading;
- Dirty close, workspace switch, window close, and protection while saving;
- Safely ignore late read/save/confirmation results after closing, switching, or new requests;
- Task 6 search results still open only TXT and locate accurately.

### 8.7 Manual desktop and external Office smoke tests

- Run the same critical paths in development and production builds;
- Open ordinary, complex, damaged, and near-20-MiB DOCX files;
- Edit and save every supported format;
- Open outputs in external Office and check body text, headings, marks, lists, and alignment;
- Modify externally and verify Wenshu's conflict handling;
- Verify `.wenshu.bak` contains the pre-save version and can restore it;
- Verify external Office can still open the original after save failure;
- Verify mixed TXT/DOCX tabs, dirty close, workspace switching, and window closing;
- Confirm no temporary `.wenshu-*` files from the operation remain in the workspace, except rolling backups;
- Console/terminal contain no unhandled exceptions or logs of body text, XML, absolute paths, or temporary names.

## 9. Explicit exclusions

- DOCX creation, Save As, rename, move, delete, and reveal in File Explorer;
- TXT/DOCX autosave, Save All, save on blur, or timed saving;
- Current-DOCX find/replace and workspace DOCX body-text search;
- Workspace replacement, regex search, persistent indexing, and search caching;
- Editing images, tables, headers/footers, footnotes/endnotes, comments, tracked changes, fields, or equations;
- Exact pagination, paper, margins, page breaks, sections, printing, or PDF export;
- Floating objects, text boxes, SmartArt, charts, OLE, and embedded files;
- Macro execution, external templates, remote resources, and scripts;
- Fully lossless Microsoft Word round-tripping;
- Tab dragging, pinning, split views, batch closing, and session restoration;
- Themes, font settings, automatic-backup toggles, or backup-history management;
- A generic Office-processing framework, plugins, cloud services, collaboration, or AI;
- Premature worker pools, databases, or background services for performance; plan them separately only if measurements prove a need.

## 10. Work packages and execution order

Implement one package at a time. Do not proceed when the current package's gate fails.

### WP0: Stable baseline, fixtures, and compatibility verification

- Complete every prerequisite in section 3.
- Fix or explicitly resolve current Windows junction-cleanup and React `act(...)` test warnings.
- Establish minimal DOCX fixtures and an external Office verification environment.
- Install or verify Tiptap/ProseMirror, Mammoth, `docx`, and JSZip in an isolated spike.
- Produce measured conclusions for section 4.1, fixed budgets, and a dependency list.
- Do not yet expose DOCX in the product UI.

Gate: Task 6's baseline is stable and repeatable; fixtures are auditable; import, editing schema, export, and reopening form a minimal working loop; every unmet format has an explicit degradation decision.

### WP1: Shared DOCX model, contracts, and pure conversions

- Add versioned, bounded `DocxDocumentModel`.
- Add compatibility reports, read/write requests/results, and stable errors.
- Implement runtime validation.
- Implement pure conversions from import results to model, model to Tiptap JSON, Tiptap JSON to model, and model to export descriptions.
- Add section 8.2 tests.
- Do not yet register IPC or read/write user files.

Gate: The model is library-independent, serializable, validatable, and bounded; conversions and compatibility results are deterministic; full `check` and `build` pass.

### WP2: Controlled main-process reading, inspection, and import

- Validate paths, extension, symbolic links, regular-file status, size, and revision.
- Check ZIP/OOXML structure and resource budgets.
- Implement Mammoth import and necessary limited attribute supplements.
- Generate compatibility levels and warnings.
- Add section 8.3 tests.
- Do not yet register renderer IPC.

Gate: No boundary escape, link following, network requests, or document execution; ordinary and complex samples give stable results; full `check` and `build` pass.

### WP3: Safe export, rolling backup, and replacement

- Convert the intermediate model into basic DOCX bytes.
- Reinspect output and validate by reimporting.
- Implement expectedRevision conflicts, rolling backup, exclusive temporary writes, sync, close, and safe replacement.
- Detect additional changes during saving and clean up.
- Add section 8.4 tests.
- Do not yet expose writes to the renderer.

Gate: Every failure point is injectable; never delete/truncate the target first; backup failure blocks overwrite; successful output reimports and opens in external Office; full `check` and `build` pass.

### WP4: Fixed IPC, preload, and multi-type tab state

- Register fixed DOCX read/write IPC and extend DesktopApi/preload.
- Apply field allowlists and runtime validation to every request.
- Evolve tab state into a TXT/DOCX discriminated union.
- Preserve TXT controllers, CodeMirror runtime, and search navigation.
- Implement DOCX opening, asynchronous validity, dirty, saving, conflicts, and confirmation state.
- Add section 8.5 and state-invariant tests.

Gate: Renderer exposure remains narrow without arbitrary-path capability; mixed-tab state is deterministic; full TXT regression and full `check`/`build` pass.

### WP5: DOCX rich-text editor and compatibility UI

- Integrate minimal Tiptap/ProseMirror extensions.
- Implement paragraph, heading, marks, font-size, color, list, and alignment toolbar actions.
- Implement per-tab rich-text sessions, selection, scrolling, undo/redo, and content versions.
- Implement compatibility levels, warnings, read-only states, and revision-bound confirmation.
- Allow selecting regular `.docx` in the file tree.
- Add section 8.6 component and interaction tests.

Gate: Supported content is editable and undoable; unsupported content is not silently saved; sessions are isolated without TXT regressions; full `check` and `build` pass.

### WP6: Complete saving, lifecycle protection, and mixed scenarios

- Connect the Save button and `Ctrl+S`.
- Implement saving, success, failure, conflict, reread, and backup notices.
- Reuse and verify dirty-close, workspace-switch, and window-close protection.
- Verify editing during saving and parallel saves across tabs.
- Verify TXT search results coexist with DOCX tabs.
- Complete section 8.6 cross-component tests.

Gate: DOCX opening through safe saving works end to end; failures lose neither originals nor edits; mixed-tab lifecycles are reliable; full `check` and `build` pass.

### WP7: Overall acceptance, compatibility observations, and documentation

- Run all automated checks and the production build.
- Complete development and production desktop smoke tests in section 8.7.
- Record reading, rendering, and export timings for ordinary, complex, and near-limit DOCX.
- Record external Office application/version, formatting round-trip results, and known differences.
- Update actual capabilities in README, project baseline, testing guide, and project structure.
- Mark Task 7 complete in the Roadmap.
- Add `TASK_007_COMPLETION_REPORT.md`.
- Change this file's status to `Completed` and check acceptance items only after all of section 11 is satisfied.

Gate: Documentation matches behavior; automated checks, build, desktop smoke, external Office verification, and backup restoration have verifiable evidence.

## 11. Final acceptance criteria

Task 7 can be marked complete only when every condition below is satisfied.

### 11.1 Reading and compatibility

- [x] File tree selects regular `.docx`; directories, links, `.docm`, and other types cannot be read.
- [x] Regular paragraphs, headings, marks, sizes, colors, lists, and alignment import according to the matrix.
- [x] Chinese, English, emoji, empty paragraphs, and multiple paragraphs are correct.
- [x] Ordinary DOCX opens within seconds without an unresponsive UI.
- [x] Damage, encryption, disguised types, excess size, and budget overflow produce stable errors.
- [x] Complex documents return deterministic compatibility levels and warnings.
- [x] `degraded` requires revision-bound confirmation; `read-only` cannot edit/save.
- [x] No network relationships, macros, or embedded content are executed/read.

### 11.2 Editor and multiple tabs

- [x] Basic paragraphs, headings, bold, italic, underline, sizes, colors, lists, and alignment are editable.
- [x] Copy, cut, paste, undo, and redo work.
- [x] No actual change means no dirty; editing sets dirty.
- [x] Mixed TXT/DOCX tabs have unique paths and correct order, activation, and closing.
- [x] Each DOCX tab has independent model, selection, scrolling, history, dirty, and errors.
- [x] Ordinary switching preserves history/model and does not reread.
- [x] Closing or workspace switching cleans up corresponding rich-text sessions.
- [x] TXT CodeMirror, multiple tabs, and search navigation have no regressions.

### 11.3 Saving and data safety

- [x] Validate expectedRevision before saving; do not overwrite external changes by default.
- [x] Create `<文件名>.wenshu.bak` successfully before each overwrite, containing the pre-save original.
- [x] Backup failure aborts saving and preserves the original and dirty state.
- [x] Output passes size, OOXML structure, and reimport checks before replacement.
- [x] Temporary writes complete all bytes, sync, close, and safe same-directory replacement.
- [x] Check again for external changes during saving before replacement.
- [x] No failure point deletes, truncates, or damages the original first.
- [x] Editing during saving preserves later edits and does not incorrectly clear dirty.
- [x] Success returns a new revision; Wenshu and external Office can reopen the output.
- [x] Dirty-close, workspace-switch, window-close, and saving protection are complete.

### 11.4 Electron and security

- [x] DOCX paths derive only from the current main-process workspace session and normalized relative paths.
- [x] Every read/write revalidates boundary, links, real path, type, and size.
- [x] IPC field allowlists and model runtime budgets are complete.
- [x] Renderer has no Node.js, filesystem, ZIP, OOXML, or arbitrary IPC capability.
- [x] `nodeIntegration: false`, `contextIsolation: true`, and sandbox are preserved.
- [x] DOCX is untrusted and cannot trigger network access, scripts, macros, or embedded objects.
- [x] Errors, logs, and cross-process results reveal no body text, XML, absolute paths, Buffer, handles, or stack traces.
- [x] No new persistent workspace outputs exist except target DOCX, rolling backups, and temporary files during saves.

### 11.5 Quality

- [x] Section 8 model, conversion, safe-read, save, backup, IPC, state, and component tests are complete.
- [x] Task 1–6 tests were actually run and passed.
- [x] Conditional skips cover only documented environment capabilities with deterministic mock coverage.
- [x] `typecheck`, `lint`, `format:check`, `test`, and full `check` pass.
- [x] `build` passes.
- [x] Development and production desktop smoke tests are complete.
- [x] At least one external Office application verified opening exports and external conflicts.
- [x] Backup restoration, original-file preservation after save failure, and temporary cleanup were manually verified.
- [x] README, baseline, testing guide, task document, and completion report match actual behavior.
- [x] No functionality explicitly excluded by section 9 was added.

## 12. Failure handling and decision rules

- No workspace, invalid paths, or non-`.docx` return stable errors; do not guess or repair paths.
- Budget overflow, damaged structure, encryption, or missing essential parts must not return a partially editable model.
- Unknown content belongs in the compatibility report; do not silently ignore it and claim full support.
- Reject saves for unconfirmed `degraded`, expired confirmation revisions, and `read-only`.
- External revision conflicts trigger no automatic overwrite/merge and do not replace local edits.
- Backup failure prevents target replacement.
- Generation or reimport-validation failure prevents target writes.
- If the target changes during saving, clean up this operation's temporary files and return conflict.
- The primary save error takes precedence; cleanup errors are safe diagnostics and do not replace it.
- If existing Windows rename semantics are unreliable, establish a safe replacement approach with adapter tests first; never delete the target first.
- If Mammoth cannot support a listed format, narrow the matrix or supplement limited attributes instead of implementing a complete OOXML engine.
- If Tiptap extensions introduce out-of-scope UI/state, use a minimal schema and command wrappers without exposing extra features.
- For parsing/export performance issues, measure ZIP, import, model conversion, rendering, and export before deciding whether to plan a worker.
- Any proposal requiring arbitrary paths, force overwrite, skipped backups, network access, or external-program execution stops the current package for separate review.
- Do not obtain passing results by disabling security, deleting tests, weakening assertions, or extending timeouts.

## 13. Execution-prompt template

Use this fixed prompt for each package, replacing only its number and content:

> Read `README.md`, `docs/architecture/PROJECT_BASELINE.md`, `docs/development/DEVELOPMENT_ENVIRONMENT.md`, `docs/development/TESTING.md`, `docs/tasks/task-006/TASK_006_COMPLETION_REPORT.md`, `docs/tasks/task-007/TASK_007_DOCX_BASIC_EDIT_SAFE_SAVE.md`, and the source/tests directly related to the current package. Implement only WPx of TASK-007; do not implement later packages early, perform unrelated refactoring, or add creation/Save As, file management, autosave, DOCX search, complex Word formatting, macros, cloud services, or AI. DOCX import, editing, and export use the project's structured intermediate model; roots come only from the main-process workspace session; every read/write follows path, link, resource-budget, revision, compatibility-confirmation, rolling-backup, temporary-write, output-validation, and safe-replacement decisions. Do not weaken TXT, multiple tabs, search navigation, Electron sandbox, or unsaved-change protection. After changes, run the package's required tests, full `check`, and `build`. Report changed files, key decisions, command results, fixture/compatibility evidence, unresolved issues, and whether the package gate is satisfied.

Execution rules:

- Complete one work package per conversation.
- Read directly relevant files/tests first; do not repeatedly scan unrelated dependencies.
- Do not overwrite existing user changes.
- Review diff and retain an auditable Git restore point after each package.
- WP0 exposes no DOCX capability in product UI.
- After WP1, review model boundaries, budgets, and library independence.
- After WP2, review untrusted ZIP, paths, links, network access, and compatibility.
- After WP3, inject every backup/save failure point.
- After WP4, review IPC exposure, tab invariants, and TXT regression.
- After WP5, review formatting matrix, session isolation, and compatibility confirmation.
- After WP6, review editing during saving, conflicts, and lifecycle protection.
- Only WP7 may write the completion report, check final acceptance items, and mark the task `Completed`.

## 14. Deliverables

On completion, deliver:

1. A versioned, budgeted structured DOCX intermediate model;
2. Compatibility levels/warnings, read/save request/results, and stable error contracts;
3. Basic DOCX ZIP/OOXML structure and resource-budget checks;
4. Importer from Mammoth/limited supplementary attributes to the model;
5. Basic model-to-`docx` exporter and reimport validation;
6. Workspace-controlled DOCX reader;
7. Saver with revision conflicts, rolling backup, temporary writes, and safe replacement;
8. Fixed DOCX IPC and controlled preload API;
9. TXT/DOCX discriminated tab state and multi-document controller;
10. Tiptap/ProseMirror editor, basic formatting toolbar, and compatibility UI;
11. Model, conversion, reading, security, saving, backup, IPC, state, component, and regression tests;
12. Non-private DOCX fixtures or deterministic constructors;
13. Updated README, project baseline, testing guide, and project structure;
14. `TASK_007_COMPLETION_REPORT.md`, recording at least:
    - Implementation summary and final compatibility matrix;
    - Added dependencies, versions, purposes, and license checks;
    - Intermediate model, budgets, and runtime validation;
    - ZIP/OOXML checks, import, and unsupported-content detection;
    - Rich-text schema, sessions, and dirty strategy;
    - Export, reimport validation, revision, backup, and safe replacement;
    - Multi-type tabs, asynchronous identity, and lifecycle protection;
    - Electron/IPC security boundaries;
    - Automated tests, build, and Windows smoke evidence;
    - External Office application/version and round-trip observations;
    - Performance, known limitations, and whether all acceptance criteria are satisfied.

## 15. Entry point for the next task

The next task is [TASK-008: Workspace DOCX Body-Text Search and Rich-Text Result Navigation](../task-008/TASK_008_DOCX_WORKSPACE_SEARCH.en.md). It reuses Task 6's proven request, cancellation, budget, statistics, and stale-result principles, with DOCX-specific canonical body-text projection, block-position mapping, result revision, and rich-text editor navigation. DOCX is not read as UTF-8 TXT.

Do not add DOCX to workspace search in parallel before Task 7 is complete. Verify the single-file workflow—controlled reading → compatibility classification → structured editing → backup → safe export—before expanding to cross-document search.
