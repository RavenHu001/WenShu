# TASK-007 Completion Report: Basic DOCX Reading, Editing, and Safe Saving

[简体中文](./TASK_007_COMPLETION_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Implementation completed: 2026-08-10; latest regression and manual acceptance: 2026-08-11. Verification platform: Windows 11 (zh-CN), Node.js 22.15.0, npm 10.9.2, Electron 37.x, Microsoft Word 16.0.20228.20158, and WPS Office (external Office verification; WPS version was not recorded).
> WP0–WP6 were implemented and accepted package by package. The development Agent performed automated acceptance (typecheck/lint/format:check/all tests/check/build), development and production desktop smoke tests, performance observations, and external Office verification.
> The project owner finally rechecked and passed the section 8.7 manual UI checklist in WPS Office.

## 1. Implementation summary

The complete controlled-read-to-safe-save DOCX workflow was implemented in package order:

```text
Regular .docx in the workspace
  -> Controlled path/link/real-path/20 MiB validation + SHA-256 revision of raw bytes
  -> ZIP/OOXML structure and fixed budgets (entries/uncompressed size/critical XML/model nodes)
  -> Limited supplementary reads (run colors, headers/footers, revisions, protection, embedded objects)
  -> Mammoth semantic import -> structured DocxDocumentModel + compatibility report
  -> Per-tab Tiptap/ProseMirror editing (paragraphs/headings/marks/sizes/colors/lists/alignment)
  -> Content-version dirty tracking, undo/redo, and close/switch/window-close protection
  -> Revalidate disk revision before saving + degraded confirmation gate
  -> Same-directory rolling backup <文件名>.wenshu.bak -> generate DOCX -> size/structure/reimport validation
  -> Exclusive temporary write -> sync -> close -> revision recheck -> safe replacement
  -> Every failure preserves original, backup, and unsaved edits
```

## 2. Key added and modified files

| Module           | Files                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared contracts | `src/shared/docx.ts` (model/budgets/runtime validation/compatibility/read-write contracts/stable errors), `src/shared/docx-convert.ts` (import source→model, model↔Tiptap JSON, model→export description), `src/shared/desktop-api.ts` (readDocx/saveDocx)                                                                                                               |
| Main process     | `src/main/docx/`: `inspect-docx-package.ts` (ZIP budgets + limited attributes), `import-docx.ts` (Mammoth→model), `export-docx.ts` (model→output + validation), `read-docx-document.ts`, `save-docx-document.ts`, `docx-ipc.ts`; `src/main/document/path-validation.ts`, `write-safety.ts` (shared TXT/DOCX safety helpers); `src/main/index.ts`, `src/preload/index.ts` |
| Renderer         | `src/renderer/lib/document-tabs.ts` (TXT/DOCX discriminated union), `use-documents.ts` (combined controller); `components/document/`: `DocxEditorSessionHost.tsx`, `DocxToolbar.tsx`, `DocxCompatibilityNotice.tsx`, `DocumentPane.tsx`, `TabBar.tsx`; `components/workspace/` (`.docx` file-tree selection); `App.tsx`                                                  |
| Tests            | `tests/docx/`: fixture-builder, fixture-suite, model, convert, inspect, import, read, save, export, ipc; `tests/document/`: document-tabs, docx-editor, docx-lifecycle; changes to `tests/preload/contract.test.ts`, `tests/workspace/components.test.tsx`                                                                                                               |
| Documentation    | `docs/tasks/task-007/TASK_007_WP0_REPORT.md`, this report; synchronized README, PROJECT_BASELINE, TESTING, and task document                                                                                                                                                                                                                                             |

## 3. Added dependencies, versions, purposes, and licenses

| Dependency                                      | Version | License                             | Purpose                                                            |
| ----------------------------------------------- | ------- | ----------------------------------- | ------------------------------------------------------------------ |
| `mammoth`                                       | 1.12.1  | BSD-2-Clause                        | DOCX semantic import (document tree + warnings)                    |
| `jszip`                                         | 3.10.1  | MIT (dual-licensed; used under MIT) | ZIP/OOXML structure, resource budgets, limited supplementary reads |
| `docx`                                          | 9.7.1   | MIT                                 | Intermediate model → basic DOCX export                             |
| `@tiptap/core` / `@tiptap/pm` / `@tiptap/react` | 3.29.2  | MIT                                 | Tiptap/ProseMirror editor                                          |
| `@tiptap/starter-kit`                           | 3.29.2  | MIT                                 | Minimum extensions (v3 includes underline/lists/history)           |
| `@tiptap/extension-text-style`                  | 3.29.2  | MIT                                 | textStyle mark (required by Color/FontSize)                        |
| `@tiptap/extension-color`                       | 3.29.2  | MIT                                 | Text color                                                         |
| `@tiptap/extension-text-align`                  | 3.29.2  | MIT                                 | Paragraph alignment                                                |
| `@tiptap/extension-underline`                   | 3.29.2  | MIT                                 | Reserve (already in StarterKit v3; not registered twice)           |

The added dependencies introduced no `npm audit` alerts. Existing high-severity findings were pre-existing (pinned Electron 37 and brace-expansion in the eslint toolchain). Tiptap v3.29.2 peer dependencies support React 19. Under strict `exactOptionalPropertyTypes`, `docx` requires conditional spreads for constructor arguments, handled in fixture code.

## 4. Intermediate model, budgets, and runtime validation

- `DocxDocumentModel` (schemaVersion 1): paragraph/heading (levels 1–3)/bullet-list/ordered-list blocks plus runs (text + marks: bold/italic/underline/font-size/color). Colors normalize to uppercase `#RRGGBB`; sizes are points (≤1638); lists are nested with explicit level (0–4).
- Fixed budgets: file 20 MiB; ZIP entries ≤128; critical XML uncompressed ≤1 MiB; total uncompressed ≤64 MiB; model blocks ≤20000; runs per block ≤512; run text ≤4096 UTF-16; list depth ≤5; marks ≤8; serialized size ≤8 MiB. Overflow returns stable `TOO_LARGE` / `RESOURCE_LIMIT_EXCEEDED`.
- `validateDocxDocumentModel` performs deep runtime validation: rejects unknown schemaVersion, canonicalizes mark ordering, forbids extra fields, and catches circular references. IPC revalidates model structure and budgets.

## 5. ZIP/OOXML inspection, import, and unsupported-content detection

- Inspection order: size (20 MiB, before parsing) → ZIP metadata budgets → critical parts (`[Content_Types].xml` + `word/document.xml`) → limited scans (top-level paragraph run-color sequence; `w:ins`/`w:del`; header/footer parts; explicitly enabled `w:documentProtection` in settings.xml; embeddings/vbaProject).
- Import: document tree from `mammoth.convertToHtml({buffer}, {transformDocument})` (options are the second argument) → library-independent `DocxImportSource` → `importSourceToDocxModel`. Inline line breaks become `\n`; long runs split losslessly; adjacent runs with equal marks merge. Colors merge by sequence, conservatively abandoned if counts differ.
- Stable, testable warning codes: image/table/header-footer/comment/revision/field/formula/embedded-object/hyperlink/unknown-style/heading-level-unsupported/encrypted-protected/other-unrecognized. Any read-only code (encrypted-protected/embedded-object) yields `read-only`; other warnings yield `degraded`; no warnings yields `supported`.
- No external-relationship access or macro/script/embedded-content execution. Dangling hyperlink relationships return stable `INVALID_DOCX`.

## 6. Rich-text schema, sessions, and dirty strategy

- Minimum extensions: StarterKit (heading 1–3, `link: false`) + TextStyle + Color + FontSize + TextAlign. StarterKit v3 supplies underline.
- One Tiptap Editor per tab. All DOCX hosts stay mounted; inactive hosts use `hidden`, so switching does not destroy sessions. Selection, scrolling, and undo history remain isolated. Editor instances never cross IPC.
- Report content changes only on `transaction.docChanged`; no-change transactions do not create dirty. Models convert through `tiptapJsonToDocxModel`, rejecting unknown nodes/marks/dangerous attributes. External replacement (reread/save baseline writeback) checks body-text equality and does not reset history when equal.
- Dirty uses a monotonic edit revision, avoiding unbounded deep comparisons on every input. Saving captures that revision and clears dirty on completion only if it still matches.

## 7. Export, reimport validation, revision, backup, and safe replacement

- Export rebuilds through `docx` from the model (headings/marks/half-point sizes/colors without `#`/alignment/numbering levels 0–4/bullets). Known limitation: core.xml timestamps are nondeterministic, without affecting revision semantics.
- Output validation: size ≤20 MiB → ZIP/OOXML structure → reimport (Mammoth); return the generated output's compatibility.
- Save order (section 4.7): request/model validation → revalidate paths/links/real path → revision conflict → disk compatibility (`read-only` rejected; `degraded` requires `compatibilityConfirmationRevision === expectedRevision`) → rolling backup (its own exclusive temporary file→flush→close→replace) → generate → validate → target temporary write → pre-replacement recheck → safe replacement. Failures never delete/truncate the original; temporary files are cleaned up best-effort.
- `<文件名>.wenshu.bak` contains the pre-save original and retains only the latest version.

## 8. Multi-type tabs, asynchronous identity, and lifecycle protection

- `DocumentTabState = TextDocumentTabState | DocxDocumentTabState`, discriminated by kind. TXT matches its existing implementation; DOCX owns model/compatibility/confirmation revision/backup notice.
- All asynchronous commits use three checks (workspace-session epoch / target tab / request number) plus in-flight save consistency. Confirmation binds to revision and resets after rereading.
- Dirty close, workspace switching, aggregate window-close confirmation, and saving-tab protection are shared uniformly across TXT/DOCX and fixed by component tests.

## 9. Electron / IPC security boundaries

- `nodeIntegration: false`, `contextIsolation: true`, and sandbox remain. preload adds only `document.readDocx(relativePath)` / `document.saveDocx(request)`, exposing no ipcRenderer, Buffer, or arbitrary invoker.
- `document:read-docx` accepts one string; `document:save-docx` uses a field allowlist (relativePath/expectedRevision/model/compatibilityConfirmationRevision) plus model runtime validation. Reject roots, absolute paths, temporary/backup paths, raw HTML/XML, and dangerous force/skipBackup fields. Roots come only from the main-process workspace-session snapshot.
- Cross-process results contain only stable codes/displayable messages. Errors/logs contain no body text, OOXML, absolute paths, Buffer, handles, or temporary names; tests assert no leakage after JSON serialization.

## 10. Automated checks, build, and desktop smoke evidence

| Command                        | Result                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `typecheck` (5 tsconfig files) | **Passed** in each work package                                                                                                |
| `lint` (--max-warnings=0)      | **Passed**, 0 warnings                                                                                                         |
| `format:check`                 | **Passed**, fixed Windows checkout line-ending policy                                                                          |
| `test` (32 files, 742 cases)   | **Passed**: 737 passed / 5 skipped (real-symlink permission conditions; rejection branches deterministically covered by mocks) |
| `check`                        | **Passed**, exit code 0                                                                                                        |
| `build`                        | **Passed**, latest production build on 2026-08-11 exited 0                                                                     |

Coverage includes runtime, workspace scanning, TXT/DOCX reading and safe saving, IPC/preload, window lifecycle, search, DOCX fixtures/model/conversion/inspection/import/export, mixed tabs, editor visual styles, and external-model synchronization. Added regressions include zero-byte DOCX, WPS `enforcement="0"`, hidden backup files in the tree, synthesized Chinese italics, inactive-tab visual isolation, and external rereads with identical text but different marks.
`check` and `build` were not concurrent. React component tests had no unawaited `act(...)` warnings after WP0's diagnosis and fix.

Development and production desktop smoke: `.\scripts\dev.cmd` remained alive for 18s; `npm exec -- electron .` for 15s. Neither logged preload/React/resource errors.

## 11. Performance observations (one-off, not benchmark gates; temporary scripts removed afterward)

| Scenario                               | Result                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary DOCX read including import    | 10–34 ms (ok-plain 33.9 / ok-lists 13.4 / ok-font-size-color 12.0 / complex-image 14.8 / complex-table 11.2 / complex-header-footer 9.9) |
| Model → Tiptap JSON                    | 0.0–0.5 ms                                                                                                                               |
| Export + output validation             | 11.6–20.7 ms                                                                                                                             |
| Read near-20-MiB document              | 135.5 ms                                                                                                                                 |
| Reject above 20 MiB                    | 0.7 ms                                                                                                                                   |
| 900 KB document.xml, near 1 MiB budget | 4.8 ms                                                                                                                                   |

All met the “open within seconds” goal. Main-process parsing/export were bounded throughout and did not block the event loop.

## 12. External Office applications, versions, and round-trip observations

- External Office: Microsoft Word 16.0.20228.20158 (`C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE`) and WPS Office (manual owner testing; version not recorded).
- Word COM opened Wenshu exports **successfully**: 5 paragraphs; heading (WENSHU-H1), centered bold body, italic 14pt text, bullet item, and numbered item all recognized as True.
- Word COM write automation was affected by local Protected View/recovery dialogs. This environment limitation no longer counted as an acceptance gap because the owner completed the latest bidirectional manual tests in WPS Office.
- WPS manual acceptance **passed**: initial materialization of zero-byte placeholder DOCX, ordinary WPS document reading/editing, reopening Wenshu saves in WPS, external-change conflicts, rolling-backup restoration, Chinese italics, and isolation when switching TXT/DOCX and multiple DOCX tabs.
- External-process conflict workflow (equivalent semantic verification): an external program appended bytes; Wenshu saving with the old revision returned `CONFLICT` with zero writes, preserving external content and creating no backup. Reread then save succeeded with new revision `a12564fc...`. Rolling backup `a.docx.wenshu.bak` equaled the pre-save version including external changes and reimported successfully. Saved output reimported with WENSHU-SAVED body text. No `.wenshu-*` temporary files remained.

## 13. Known limitations

1. `docx@9` uses current time for core.xml timestamps, so output bytes are not fully deterministic; revision uses actual bytes and is unaffected.
2. Inline line breaks export as `\n` text; Mammoth silently drops tabs. Word-level layout fidelity is not promised.
3. Non-ASCII case folding is unimplemented, an existing TXT-search limitation. TXT search excludes DOCX.
4. External-change TOCTOU races are rechecked at save time, without a real-time filesystem-watch promise, as with TXT.
5. Backups retain only the latest version, with no history or restoration UI. Internal `.wenshu.bak` files are hidden in the file tree.

## 14. Satisfaction of all acceptance criteria

All TASK-007 section 11.1–11.5 acceptance items are checked in the task document. Automated items passed through actual command execution. The Agent completed development/production desktop smoke, performance observations, and Word opening verification. The owner completed the final section 8.7 checklist in WPS Office, verifying bidirectional opening/saving, conflicts, backup restoration, and recent UI fixes.

## 15. Task status and next entry point

**TASK-007 status: Completed.**

The next task is [TASK-008: Workspace DOCX Body-Text Search and Rich-Text Result Navigation](../task-008/TASK_008_DOCX_WORKSPACE_SEARCH.en.md): reuse Task 6's verified search requests, cancellation, budgets, statistics, and stale-result principles while separately designing DOCX canonical body-text projection, block-position mapping, result revisions, and a second rich-text-editor validation. DOCX is not implicitly added to the TXT searcher before Task 7 completes.
