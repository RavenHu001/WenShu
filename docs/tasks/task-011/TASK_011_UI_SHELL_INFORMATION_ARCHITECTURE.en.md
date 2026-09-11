# TASK-011: desktop shell, information architecture, and editing experience rework

[简体中文](./TASK_011_UI_SHELL_INFORMATION_ARCHITECTURE.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

## 1. Status and background

> **Status: complete. Implementation and automated acceptance finished on 2026-08-22. The owner confirmed final manual acceptance, including physical Windows display scaling, on 2026-08-27.**
>
> WP0–WP5 were implemented in order. See the [WP0 report](./TASK_011_WP0_REPORT.en.md) for frozen technical decisions and the [completion report](./TASK_011_COMPLETION_REPORT.en.md) for implementation, tests, screenshots, and acceptance differences.

The accompanying [TASK-011 development prompt](./TASK_011_DEVELOPMENT_PROMPT.en.md) can be used directly during development.

Tasks 1–10 completed workspace handling, TXT/DOCX editing, safe saving, search, find/replace, and basic file management. Existing features and safety support daily validation, but the interface still resembles an engineering prototype: native and in-app menus coexist, large file-operation buttons permanently occupy the bottom sidebar, the tree uses letter icons, the DOCX toolbar lacks grouping and a narrow-window strategy, and editor/tabs/save states/search/status bar lack a consistent desktop interaction system.

This task turns the existing Future UI Optimization Plan into an implementable, testable, verifiable stage. It does not change filesystem permissions, safe writing, revision conflicts, backups, stable tabId, search invalidation, or unsaved protection.

## 2. Stage goals

Without weakening features, safety, or accessibility, move WenShu from a functionally complete engineering prototype to a Windows Pre-alpha product suitable for sustained daily use:

1. Establish consistent colors, spacing, typography, icons, focus, and component states.
2. Remove duplicate menus and permanent placeholders, clarifying shell hierarchy.
3. Remove the bottom file-operation button wall and provide actions through context menus, keyboard commands, and internal tree dragging.
4. Increase tree space and support sidebar resizing, collapsing, and long paths.
5. Unify navigation, status, and feedback across TXT, DOCX, workspace search, and current find.
6. Improve DOCX content width and toolbar grouping without simulating exact Word pagination.
7. Establish repeatable visual quality gates at fixed window sizes and Windows scaling levels.

## 3. Design principles

### 3.1 Keep actions near their objects

- Put file/folder actions in the corresponding tree object's context menu.
- Put creation actions in the target directory or tree blank-area context menu.
- Put document-level actions in tabs, the File menu, or editor area.
- Do not permanently display every possible operation at the sidebar bottom.

### 3.2 Keep frequent actions direct and group infrequent ones

- Keep discoverable entries for opening workspaces, refreshing, and creating.
- Put selected-item rename/move/delete/reveal operations in context menus.
- Save As belongs to the current document, not bulk tree management.

### 3.3 Mouse efficiency does not replace keyboard access or accessibility

- Context menus and dragging require keyboard equivalents.
- Menu items need explicit text rather than icon guessing.
- Selection, active, focus, and hover must be four distinguishable states.
- Red alone must not communicate dangerous operations.

### 3.4 Reuse existing safety services

- UI must not assemble paths or reconstruct them from display text.
- Context menus, keyboard commands, and drag moves must call existing controllers.
- Add no general filesystem IPC, arbitrary paths, or overwrite/force switches.
- UI prediction is only immediate feedback; main remains the final safety authority.

## 4. Target information architecture

```text
┌ Single title bar / menu ───────────────────────────────────┐
├ Activity ┬ Resizable sidebar ┬ Tabs                        │
│          │                   ├ Compact state / toolbar     │
│ Files    │ File tree         │                             │
│ Search   │ or search         │ Centered DOCX content canvas│
│ Settings │                   │ or TXT editor               │
│          │                   │                             │
├──────────┴───────────────────┴─────────────────────────────┤
│ Compact status: save state, document type, word/char count │
└───────────────────────────────────────────────────────────┘
```

### 4.1 Top area and menus

- Keep only one native or in-app menu, never both English native and Chinese application menus.
- Menu language matches the application language.
- File menu provides open workspace, new, save, Save As, close tab, and other document commands.
- Edit/View/Help show only implemented working entries, without inert placeholders.
- Move runtime versions into About rather than permanently occupying the status bar.

### 4.2 Activity bar

- Replace “文 / 搜 / 设” text placeholders with project-local SVG icons.
- Every icon has a tooltip and accessible name.
- Unimplemented Settings must not appear usable before implementation.
- Active state uses shape, background, and semantic attributes as well as color.

### 4.3 Workspace sidebar

- Support drag resizing between reasonable minimum/maximum widths.
- Support collapsing and restoration through keyboard or menu.
- Retain open-workspace, refresh, and compact New entries in the header.
- Make the tree the main scroll area, no longer squeezed by bottom buttons.
- Long filenames use ellipsis, complete tooltips, and stable indentation.
- Deep directories, many entries, and narrow windows must not make actions unreachable.

### 4.4 Tabs, document state, and editor

- Tabs express active, dirty, saving, error, and close capability together.
- Active tabs must be identifiable beyond a thin top line.
- Emphasize Save only when it can execute.
- Use a compact state area for saved/saving/failed/conflict/backup information.
- Put full backup paths in tooltips, details, or notifications rather than a permanent full row.
- DOCX uses a centered, limited-width canvas surrounded by workspace background.
- The DOCX canvas defines reading width and hierarchy, not exact pagination.
- TXT retains a full-height layout suitable for plain-text editing.

### 4.5 DOCX toolbar

- Group history, character formatting, paragraph styles, lists, and alignment.
- Use consistent icons, tooltips, active states, and separators.
- Move controls into overflow in a fixed priority order at narrow widths, without stretching the editor horizontally.
- Color selection displays the current value and an accessible name.
- All commands continue using public Tiptap/ProseMirror APIs.

### 4.6 Search and current find

- Workspace search and current find retain distinct meanings but share input/button/feedback/focus styling.
- Results establish file heading → match hierarchy.
- Snippets are primary; coordinates and file type are secondary.
- Simplify default search explanations; expose detailed limits through Help.
- Widening the sidebar naturally gives snippets more room.
- Ordinary matches, current matches, input focus, and button focus use distinct consistent visual semantics.

### 4.7 Status bar and feedback

- Reduce status-bar height and color emphasis.
- Move Electron version into About.
- Use nonblocking, timed, dismissible success toasts.
- Keep errors, conflicts, and partial completion traceable without automatic dismissal.
- Communicate danger through icons, text, location, and color together.

## 5. File-tree context menus

### 5.1 Workspace root or blank area

Suggested order:

1. New TXT.
2. New DOCX.
3. New Folder.
4. Separator.
5. Refresh.
6. Reveal Workspace in File Explorer.

### 5.2 Ordinary files

Suggested order:

1. Open or Activate.
2. Rename.
3. Move To.
4. Reveal in File Explorer.
5. Separator.
6. Delete to Recycle Bin.

Save, Save As, and Close for the current document may appear in the tab context menu and File menu. Save As Current Document no longer belongs at the tree bottom.

### 5.3 Folders

Suggested order:

1. New TXT.
2. New DOCX.
3. New Folder.
4. Separator.
5. Rename.
6. Move To.
7. Reveal in File Explorer.
8. Separator.
9. Delete to Recycle Bin.

### 5.4 Keyboard equivalents

- `Enter`: open a file or expand/collapse a directory.
- `F2`: rename.
- `Delete`: request deletion and open confirmation.
- `Shift+F10` or Menu key: open the context menu.
- `F5`: refresh workspace.
- `Ctrl+Shift+S`: Save As for the current document.
- `Escape`: close menus, cancel dragging, or close the current nonmodal interaction.

Shortcuts must not bypass saving, unsaved-state, conflict, path, or deletion-confirmation gates.

## 6. Internal file-tree drag moving

### 6.1 Task scope

Implement only internal moves within the workspace tree:

- Ordinary file onto a directory: move into it.
- Folder onto another directory: move into it.
- File/folder onto the workspace root drop zone: move to root.
- Continue calling the existing `relocate` flow after dragging.

Dragging from Windows Explorer into WenShu involves copy/move selection, cross-drive behavior, overwriting, external paths, and import safety, and is outside this task.

### 6.2 Drag feedback

- Show a lightweight source preview without logging content or absolute paths.
- Highlight acceptable target directories explicitly.
- Provide a discoverable root drop zone without permanently occupying space.
- Show forbidden state on invalid targets.
- Leaving a target or pressing `Escape` immediately clears drag decorations.
- Show Moving after drop to prevent duplicate submission.

### 6.3 Rejection and confirmation rules

Do not submit a move, or require rejection by the existing flow, when:

- Dropping in the current location: a no-op.
- Moving a directory into itself or a descendant.
- A same-name target entry exists.
- Source/target is a prohibited symbolic-link, junction, or other type.
- An affected tab is saving.
- Workspace/source/target changed while dragging.
- Path migration, boundary validation, or prepublication revalidation fails.

Successful moves preserve stable tabId, tab order, active tab, dirty, text/model, cursor, scrolling, undo history, and current-find state. DOCX accompanying `.wenshu.bak` files migrate under existing rules, and workspace search invalidates through mutationEpoch.

## 7. Visual and component baseline

### 7.1 Design variables

At minimum define:

- Base background, surface, border, and text colors.
- Semantic primary, success, warning, danger, and info colors.
- Hover, active, selected, focus-visible, and disabled state colors.
- Spacing variables using a 4/8-pixel rhythm.
- Body, secondary, tab, and heading font sizes.
- Corner radii, shadows, layers, and animation durations.
- High-contrast and `prefers-reduced-motion` adaptation points.

### 7.2 Basic components

Unify sizes and complete state matrices for:

- Icon, text, and dangerous-action buttons.
- Inputs, selects, checkboxes, and color inputs.
- Tabs, menus, tooltips, and toasts.
- Banners, empty/loading/error states.
- Confirmation and name-entry dialogs.
- Separators, scroll areas, and sidebar resize handles.

## 8. Work packages and implementation order

### WP0: freeze baseline and state inventory

- Record three main page types: file workspace, workspace search, and current find/replace.
- Fix `1280×820` and `900×600` screenshots.
- List empty/loading/active/selected/dirty/saving/success/failure/conflict/read-only/degraded/truncated/confirmation states.
- Lock existing controller, IPC, and path-safety semantics.

### WP1: design variables, icons, and primitives

- Establish CSS design variables.
- Gradually split monolithic styling into shell/workspace/document/search/common.
- Introduce project-local SVG icons.
- Unify buttons, inputs, menus, dialogs, toasts, and focus states.

### WP2: shell, menus, and status bar

- Eliminate duplicate menus and mixed Chinese/English.
- Rework activity bar, tabs, document status, and status bar.
- Complete About.
- Verify existing shortcuts and window-close flows.

### WP3: sidebar, context menus, and dragging

- Remove the bottom file-operation button area.
- Add context menus and keyboard equivalents.
- Implement sidebar resizing/collapsing and long-path layout.
- Implement internal tree moves and all rejection, cleanup, and lifecycle semantics.
- Reuse existing file management controllers without a new write protocol.

### WP4: editor, DOCX toolbar, and search

- Complete the centered DOCX canvas.
- Complete toolbar groups and narrow-window overflow.
- Unify TXT/DOCX tabs and save feedback.
- Reorganize workspace results and current-find panel hierarchy.

### WP5: accessibility, scaling, and visual quality gates

- Verify menu focus, keyboard order, restoration, and screen-reader names.
- Verify Windows high contrast and reduced motion.
- Accept at 100%/125%/150% display scaling and 200% text scaling.
- Update screenshots and run complete `check`, `build`, development/production smoke tests.

## 9. Testing requirements

### 9.1 Automated tests

- Correct context commands by object type.
- Menu opening, arrows, Enter, Escape, Shift+F10, and focus restoration.
- F2/Delete/F5/Ctrl+Shift+S preserve gates.
- File/directory dragging and directory/root drops.
- Self/descendant, same-name, saving, late-result, and invalid-type rejection.
- No residual highlights/listeners after drag cancellation, unmount, or workspace switching.
- Stable tabId and editor sessions survive moving.
- MutationEpoch and workspace-search invalidation semantics remain.
- Narrow toolbar overflow and sidebar min/max widths.
- Accessible names for menus, icon buttons, toasts, and dialogs.

### 9.2 Manual acceptance

- `1280×820`, `900×600`.
- Windows 100%/125%/150% display scaling.
- Empty workspaces, long trees, deep directories, long filenames, and multiple tabs.
- TXT, basic DOCX, read-only, degraded, dirty, saving, conflict.
- Large workspace-search result sets and current-DOCX find/replace.
- Complete mouse, keyboard, context-menu, and drag paths.
- High contrast, 200% text scaling, and reduced motion.

## 10. Completion criteria

- One consistently localized top menu, without visible placeholder commands.
- The bottom-left file-operation area is gone, returning its height to the tree.
- New, Rename, Move, Delete, Reveal, and Save As have clear new entry points.
- Files/directories move safely through internal tree dragging, with complete keyboard alternatives.
- Workspace, search, TXT, DOCX, and file management share a consistent design language.
- Active, selected, focus, hover, disabled, loading, success, and error states are identifiable.
- At `900×600`, no horizontal overflow, obscured controls, or unreachable actions.
- Stable layout at common Windows scaling levels.
- Repeatable screenshot baselines for key pages.
- Existing type/behavior/safety/regression tests remain strong; `check` and `build` pass.
- No regression in main-process path validation, safe writing, revision conflicts, backups, Recycle Bin deletion, stable tabId, or search invalidation.

## 11. Explicit non-goals

- Explorer drag-in or dragging files out of the application.
- Cross-workspace/cross-drive copy or move.
- File copy/paste and bulk file operations.
- Autosave, session recovery, and filesystem watching.
- Dark theme, full settings, and theme plugins.
- Workspace bulk replacement and regular-expression/fuzzy/semantic search.
- Exact Word pagination or lossless complex DOCX editing.
- Windows installers, automatic updates, or a formal release process.
- AI and Agent capabilities.

Plan these separately after Task 11 establishes a stable interface and visual gates, avoiding simultaneous changes to information architecture, persistent state, and filesystem semantics within one task.
