# TASK-011 development prompt

[简体中文](./TASK_011_DEVELOPMENT_PROMPT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Copy the complete Main Prompt below to the Codex or development Agent implementing Task 11. It requires freezing the baseline before implementation, testing, and acceptance by work package. Do not stop after a visual mockup or a few style changes.

---

## Main prompt

You are continuing development of the WenShu Windows desktop application in the `WenShu` repository. Fully implement **TASK-011: desktop shell, information architecture, and editing experience rework** until code, automated tests, builds, documentation, and executable acceptance evidence are complete.

### 1. Required before starting

1. Read these files completely, not just summaries or headings:
   - `README.md`
   - `docs/architecture/PROJECT_BASELINE.md`
   - `docs/plans/FUTURE_UI_OPTIMIZATION_PLAN.md`
   - `docs/tasks/task-009/TASK_009_BASIC_FILE_MANAGEMENT.md`
   - `docs/tasks/task-009/TASK_009_COMPLETION_REPORT.md`
   - `docs/tasks/task-010/TASK_010_DOCX_FIND_REPLACE.md`
   - `docs/tasks/task-010/TASK_010_COMPLETION_REPORT.md`
   - `docs/tasks/task-011/TASK_011_UI_SHELL_INFORMATION_ARCHITECTURE.md`
   - `docs/development/TESTING.md`
   - Every repository `AGENTS.md` applicable to the current directory, if any.
2. Inspect `git status`. Preserve and work around existing user changes; do not reset, overwrite, or clean unrelated content.
3. Read renderer components, hooks/controllers, shared protocols, preload, main-process file management, and related tests. Understand stable `tabId`, `mutationEpoch`, saving/dirty/conflict, accompanying DOCX backups, and path-migration semantics.
4. Before modifying product code, run the current baseline:
   - `./scripts/npm.cmd run check`
   - `./scripts/npm.cmd run build`
5. If it fails, first determine whether the cause is current main, the environment, or existing user changes. Record evidence; never conceal failure by weakening assertions, skipping tests, or broadening tolerance.

### 2. Task goals

Rework the functionally complete but prototype-like interface into a consistent, clear Windows Pre-alpha product suitable for sustained desktop use, preserving every product, safety, and lifecycle semantic from Tasks 1–10.

Complete all of the following:

1. Unified CSS design variables, component states, and project-local SVG icons.
2. Resolve simultaneous native English and application Chinese menus, retaining one consistently localized menu with real behavior.
3. Remove the large file-operation button area at the lower left of the workspace sidebar.
4. Provide file management through tree context menus, keyboard commands, and internal dragging.
5. Support sidebar resizing/collapsing, long paths, and deep directories.
6. Rework activity bar, tabs, save status, status bar, and notifications.
7. Improve DOCX column width, canvas, toolbar grouping, and overflow.
8. Unify visual and interaction language across TXT, DOCX, workspace search, and current find.
9. Complete accessibility, Windows scaling, and key-page visual baselines.
10. Add automated tests for all new interactions and pass full quality gates.

### 3. Immutable baseline

These constraints outrank visual convenience and must not change without authorization:

- Windows desktop first; Electron + React + TypeScript remain the baseline.
- `nodeIntegration: false`, `contextIsolation: true`, sandbox, and narrow preload/IPC boundaries remain.
- Renderer must not directly access Node.js filesystem APIs.
- Add no general invoke, arbitrary paths, force, overwrite, permanent deletion, or arbitrary file-writing capability.
- File operations continue through existing controllers, shared contracts, and main-process safety services.
- Do not weaken path boundaries, segment symlink/junction checks, realpath, revision, CAS, temporary files, or prepublication revalidation.
- Deletion goes only to the system Recycle Bin, without permanent-delete fallback.
- DOCX `.wenshu.bak` migration, rollback, and partial-failure semantics remain.
- Stable `tabId` stays separate from mutable paths.
- Moving retains tab order, active state, dirty, saving, text/model, selection, scrolling, undo history, and current-find sessions.
- Successful file mutations still increment `mutationEpoch` and invalidate workspace search; failures, cancellation, and reveal must not increment it incorrectly.
- Dirty/saving/conflict/read-only/degraded, close protection, window closure, and workspace switching remain unchanged.
- TXT/DOCX find/replace, workspace search, navigation, and save safety must not regress.
- Do not bypass public interfaces through private DOM properties or editor APIs.
- Do not log document text, queries, absolute user paths, or sensitive content.

If changing any baseline is necessary, explain the problem, benefits, risks, added complexity, migration cost, and affected scope before coding, then wait for owner confirmation. Never change it silently.

### 4. Interaction requirements

#### 4.1 File-tree context menus

Support at least:

- Workspace root/blank area: New TXT, New DOCX, New Folder, Refresh, Reveal in File Explorer.
- Ordinary file: Open/Activate, Rename, Move To, Reveal, Delete to Recycle Bin.
- Folder: create TXT/DOCX/folder inside it, Rename, Move To, Reveal, Delete to Recycle Bin.
- Current-document Save, Save As, and Close live in the File menu or tab context menu, not permanently at the tree bottom.

Menus must:

- Enable/disable correctly by object type, saving state, and capabilities.
- Use stable object identity and canonical relative paths, never parsed display text.
- Support right-click, `Shift+F10`, or Menu key.
- Support arrows, Enter, Escape, focus trapping, and restoration on close.
- Provide explicit text and accessible names.
- Group dangerous operations at the bottom, communicating risk beyond red alone.
- Close safely on outside clicks, workspace changes, target unmount, or window blur.
- Leave no global listeners, timers, or stale menu state.

Prefer a testable, accessible renderer implementation. If choosing native Electron menus, explain why and retain fixed command protocols and testability, without exposing general IPC.

#### 4.2 Keyboard equivalents

At minimum support:

- `Enter`: open files or expand/collapse directories.
- `F2`: rename.
- `Delete`: open deletion confirmation.
- `Shift+F10` or Menu key: context menu.
- `F5`: refresh.
- `Ctrl+Shift+S`: Save As Current Document.
- `Escape`: close menus, cancel dragging, or exit the current nonmodal interaction.

Shortcuts must preserve saving, dirty, conflict, confirmation, path, and permission gates and existing editor shortcut semantics.

#### 4.3 Internal tree dragging

Implement only moves inside one workspace tree:

- Files to directories.
- Folders to other directories.
- Files/folders to the workspace root drop zone.
- Drops call existing `relocate`, never direct filesystem operations.

Handle:

- Acceptable-target highlighting.
- Forbidden state for invalid targets.
- Lightweight drag previews.
- Complete cleanup after `Escape`, dragend, drop, unmount, and workspace switching.
- Pending state after drop to prevent duplicate submission.
- No-op current-location drops.
- Rejection of self/descendants, same-name targets, invalid types, saving, stale workspaces, and changed paths.
- Stable error feedback and state restoration after main-process rejection.
- Stable tabId, accompanying-backup migration, and mutationEpoch after success.

Do not add Explorer drag-in, drag-out, cross-workspace/cross-drive operations, copying, or overwrite moves.

### 5. Visual and layout requirements

#### 5.1 Visual direction

- Preserve WenShu's restrained, quiet feel suitable for long writing sessions.
- Favor neutral surfaces and one primary accent; avoid large gradients, glass effects, excessive shadows, and decorative animation.
- Prioritize hierarchy, spacing, contrast, and state recognition over visual showmanship.
- Use project-local SVG, not emoji, single letters, or remote images as production feature icons.
- Do not introduce a large UI framework or icon dependency just for this task. Prove necessity and size impact before adding dependencies.

#### 5.2 Design variables and component states

Define and actually use:

- Background, surfaces, borders, primary/secondary text.
- Primary, success, warning, danger, info.
- Hover, active, selected, focus-visible, disabled, loading.
- Spacing, sizes, radii, shadows, layers, durations.
- High-contrast and `prefers-reduced-motion` entry points.

Unify buttons, icon buttons, inputs, selects, checkboxes, menus, tooltips, toasts, banners, empty states, dialogs, scroll areas, and sidebar handles.

Do not mechanically rewrite all CSS at once. Establish tokens and component boundaries, then migrate by work package, running relevant tests and checking visual states each time.

#### 5.3 Application shell

- One top menu only.
- Activity bar uses consistent SVG, tooltips, and accessible names.
- Unimplemented Settings must not appear usable.
- Tabs express active, dirty, saving, error, and close capability together.
- Save state stays compact; backup paths do not permanently occupy a full row.
- Reduce status-bar height/color emphasis and move Electron version into About.

#### 5.4 Sidebar and editor

- Return all vertical space freed by the button wall to the tree.
- Sidebar resizes/collapses within reasonable min/max values.
- DOCX uses a centered, limited-width canvas surrounded by workspace background.
- Do not simulate or promise precise Word pagination.
- TXT retains a full-height plain-text editing layout.
- Group DOCX toolbar history, character formatting, paragraph styles, lists, and alignment.
- Use stable narrow-window overflow without creating editor horizontal scrolling.

#### 5.5 Search and feedback

- Workspace search/current find share control language while retaining distinct semantics.
- Results use file → match hierarchy, snippets first and coordinates second.
- Simplify query explanations; detailed limits are available through Help or expandable text.
- Success uses nonblocking, timed, dismissible toasts.
- Errors, conflicts, and partial completion remain traceable and do not disappear automatically.
- Current matches, ordinary matches, input focus, and button focus must not share one indistinguishable visual state.

### 6. Implementation order

Follow these work packages strictly. Run targeted tests and record results after each before moving on.

#### WP0: freeze baseline

- Build the current UI state matrix.
- Fix `1280×820` and `900×600` baselines.
- Review existing menus, shortcuts, focus, file management controllers, and test assumptions.
- Write a WP0 report if needed, recording technical choices, event model, drag state machine, and risks.

#### WP1: design variables, icons, and primitives

- Establish tokens.
- Separate style responsibilities into shell/workspace/document/search/common.
- Complete SVG icons, buttons, inputs, menus, toasts, dialogs, and focus baseline.
- Do not change application behavior.

#### WP2: application shell

- Resolve duplicate menus.
- Rework activity bar, tabs, document state, and status bar.
- Complete About and migrate runtime information.
- Preserve close and shortcut semantics.

#### WP3: sidebar, context menus, and dragging

- Remove bottom buttons.
- Complete context menus and keyboard equivalents.
- Complete sidebar resizing/collapsing.
- Complete internal moves and safe rejection paths.
- Add controller, lifecycle, and accessibility tests.

#### WP4: editor and search

- Centered DOCX canvas.
- Grouped toolbar and overflow.
- Unified TXT/DOCX tabs and states.
- Improved workspace-search, current-find, and feedback hierarchy.

#### WP5: acceptance and documentation

- Accessibility, high contrast, reduced motion, scaling, and minimum-window checks.
- Key-page screenshot baselines.
- Full regressions, build, development/production smoke tests.
- Update README, PROJECT_BASELINE, TESTING, Task 11 documents, and write the completion report.

### 7. Code structure requirements

- Keep only necessary top-level coordination in `App.tsx`; stop accumulating presentation details there.
- Extract shell, menu, toast, sidebar resize, context menu, and drag state by stable responsibility.
- Do not create meaningless tiny components merely to reduce file line counts.
- Prefer independently testable pure functions for state machines, path calculations, menu capabilities, and drop-target decisions.
- UI should not duplicate main-process safety logic, only necessary immediate capability checks.
- Manage global listeners centrally and clean them on unmount.
- React keys and interaction identity use stable tabId or canonical relativePath, never display names.
- Keep strict TypeScript; introduce no `any`, unnecessary assertions, or unexplained `eslint-disable`.
- Avoid private editor APIs and silently swallowed failures.

### 8. Tests and quality gates

Add or update tests for:

1. Context-menu items, enabled states, and arguments for each object type.
2. Menu keyboard navigation, Escape, outside clicks, and focus restoration.
3. F2/Delete/F5/Ctrl+Shift+S compatibility with editor shortcuts.
4. File/directory dragging, directory/root drops, and pending duplicate prevention.
5. Self/descendant, same-name, saving, invalid-type, and late-result rejection.
6. No residue after cancellation, unmount, or workspace switching.
7. Stable tabId, editor sessions, backups, and mutationEpoch after moving.
8. Sidebar min/max width, collapsing, and narrow layouts.
9. Toolbar overflow, tab state, toasts, and search hierarchy.
10. Accessible names for menus, icon buttons, drop targets, toasts, and dialogs.

Do not:

- Delete or weaken existing Task 1–10 tests.
- Add unconditional `.skip`, `.only`, or broad snapshots replacing behavior assertions.
- Hide event leaks or races with excessively long timeouts.
- Test only CSS-class presence without checking key interactions and state transitions.

Finally pass, in order:

- Targeted tests.
- `./scripts/npm.cmd run typecheck`
- `./scripts/npm.cmd run lint`
- `./scripts/npm.cmd run format:check`
- `./scripts/npm.cmd test`
- `./scripts/npm.cmd run check`
- `./scripts/npm.cmd run build`
- Windows development smoke tests.
- Windows production smoke tests.

If real Electron screenshots cannot be automated reliably, do not fabricate a pass. Retain deterministic component/layout tests and provide explicit manual capture steps, sizes, scaling levels, and result records.

### 9. Required manual scenarios

- `1280×820`, `900×600`.
- Windows 100%/125%/150% display scaling.
- 200% text scaling, high contrast, reduced motion.
- Empty workspaces, long trees, deep directories, long names, multiple tabs.
- TXT, DOCX, read-only, degraded, dirty, saving, save-error, conflict.
- Large search results, truncation, and current-DOCX find/replace.
- Mouse, keyboard, context menus, internal dragging, and cancellation.
- Tab/search lifecycle after rename, move, delete, and Save As.
- Window closure, workspace switching, and saving protection.

### 10. Explicit non-goals

Do not implement in Task 11:

- Explorer drag-in or drag-out.
- Cross-workspace/cross-drive actions, copying, overwrite moves, or bulk operations.
- Autosave, session recovery, filesystem watching.
- Dark theme, full settings, or theme plugins.
- Workspace replacement or regular-expression/fuzzy/semantic search.
- Complex DOCX, precise pagination, or fully lossless Word editing.
- Installers, automatic updates, or formal releases.
- AI, Agents, cloud, or accounts.

Record adjacent needs as follow-up suggestions instead of expanding current scope without authorization.

### 11. Working method

- Investigate before modifying; use current code/tests as the source of truth.
- Maintain a reviewable work plan.
- Prefer small, regression-tested packages over a single broad rewrite.
- After each package, report completed work, test evidence, remaining risks, and next steps.
- Diagnose ordinary implementation problems independently instead of asking users questions answerable by code/tests.
- Pause for confirmation only when changing product baselines, expanding permissions, adding major dependencies, or encountering a product choice that cannot reasonably be inferred.
- Do not perform destructive Git actions, overwrite user changes, or push/merge/publish without authorization.
- Do not finish with merely Main Features Complete before all acceptance is done.

### 12. Final deliverables

Provide:

1. `docs/tasks/task-011/TASK_011_COMPLETION_REPORT.md`, mapping every work package and completion criterion.
2. Updated `README.md`, `docs/architecture/PROJECT_BASELINE.md`, and `docs/development/TESTING.md`.
3. Key screenshots or an explicitly reproducible screenshot-baseline location.
4. Added/modified file list and important architecture explanations.
5. Actual results, case counts, and conditional-skip reasons for every quality command.
6. Windows development/production smoke records.
7. Known limitations, unresolved issues, and follow-up suggestions.
8. An explicit statement of whether all Task 11 criteria are met; never describe unverified items as complete.

Lead the final response with actual outcomes, then briefly list key changes, test evidence, limitations, and important file links.

---

## Usage suggestions

- To complete Task 11 in one run, use the entire Main Prompt above.
- For work-package development, retain every safety baseline at each continuation and explicitly restrict execution to `WP0`, `WP1`, or another current package. Later Agents must first read previous reports and the current `git diff`.
- UI implementation requires visual judgment. Fix screenshots and the state matrix in WP0, establish tokens in WP1, then migrate pages in batches so individual pages do not invent incompatible colors and spacing.
