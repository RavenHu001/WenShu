# WenShu future UI optimization plan

[简体中文](./FUTURE_UI_OPTIMIZATION_PLAN.md) | English

[Design plans and records](./README.en.md) · [Documentation](../README.en.md)

> **Status: implemented by [TASK-011: desktop shell, information architecture, and editing experience rework](../tasks/task-011/TASK_011_UI_SHELL_INFORMATION_ARCHITECTURE.en.md). See the [completion report](../tasks/task-011/TASK_011_COMPLETION_REPORT.en.md).**
>
> This plan records the direction for systematic UI improvements after Task 9. At that stage, work was limited to missing styles, scrolling areas, selection states, and message presentation in the file management UI; fixes were not to restructure file management flows that had already passed acceptance.

Task 11 also incorporated observations of the actual main pages and the interaction direction confirmed by the project owner: remove the file-operation button area at the bottom of the workspace sidebar, and provide file management through context menus, keyboard commands, and internal file-tree dragging. The Task 11 document defines the detailed scope, safety semantics, work packages, and acceptance criteria.

## 1. Goals

Establish a consistent, clear visual and interaction system suitable for a Windows desktop, without weakening local file safety, stable tab identity, unsaved-change protection, or accessibility semantics:

1. Unify colors, spacing, font sizes, corner radii, shadows, focus, and disabled states.
2. Reduce information density in the workspace sidebar and document toolbars.
3. Clearly distinguish the active document, file management selection, keyboard focus, and hover state.
4. Support different window sizes and Windows display scaling at 100%/125%/150%.
5. Establish repeatable visual acceptance so completed functionality does not conceal missing styles.

## 2. Planned work packages

### UI-1: design baseline and component states

- Establish CSS design variables for base and semantic colors, spacing, font sizes, radii, shadows, and layers.
- Unify buttons, inputs, selection lists, banners, dialogs, and empty states.
- Replace the file tree's `F`/`D` letter placeholders with project-local SVG icons.
- Complete the hover, active, selected, focus-visible, disabled, loading, success, and error state matrix.
- Check text contrast, keyboard focus, and 200% text scaling.

### UI-2: workspace sidebar information architecture

- Evaluate an adjustable sidebar width and reasonable minimum widths for small windows.
- Group frequent creation actions separately from actions on selected items, reducing permanently disabled buttons.
- Evaluate inline overflow menus and context menus while preserving complete keyboard entry points and identifiable labels.
- Move Save As for the current document into the File menu or document toolbar to separate file-tree responsibilities.
- Improve layout and scrolling for long paths, deeply nested directories, long filenames, and large item counts.

### UI-3: editor and navigation consistency

- Unify TXT/DOCX tabs, save states, and error notices.
- Reorganize DOCX formatting toolbar groups, overflow, and narrow-window behavior.
- Improve the visual hierarchy of welcome, loading, empty-document, read-only, and compatibility states.
- Unify icons, colors, and density across the activity bar, sidebar, editor, and status bar.

### UI-4: feedback and desktop interaction

- Use nonblocking, timed, dismissible toasts for success, and retain traceable information for errors and partial completion.
- Distinguish dangerous operations from ordinary actions without relying only on color.
- Check dialog focus trapping, focus restoration after cancellation, keyboard order, and screen-reader names.
- Verify Windows high contrast, system-font differences, and scaling changes between displays.

### UI-5: visual quality gates

- Fix screenshot baselines for at least `1280×820` and `900×600` windows.
- Cover empty workspaces, long file trees, file management selections, success/failure messages, name input, directory selection, and deletion confirmation.
- Perform manual acceptance at Windows scaling levels of 100%, 125%, and 150%.
- Include key-page screenshot comparisons in release checks while retaining existing behavior tests and the complete `check`/`build` gates.

## 3. Implementation boundaries

- UI optimization must not change main-process path validation, write safety, Recycle Bin deletion, revision conflicts, or IPC permission boundaries.
- Interaction rearrangement must reuse existing controllers, without reconstructing paths or operation identities from displayed text.
- Moving commands into menus or hiding them must preserve keyboard access, explicit labels, and focus restoration.
- Visual tests supplement existing type, behavior, and safety tests; they cannot replace them.
- Before a broad refactor, create wireframes and a state inventory, then split work into independently verifiable tasks.

## 4. Completion criteria

- Workspace, search, TXT, DOCX, and file management share a consistent design language.
- Discovering common actions does not depend on accidental wrapping or scrolling to the end of the file tree.
- All selection, focus, disabled, loading, success, and error states are identifiable.
- At the minimum window size and common Windows scaling levels, there is no horizontal overflow, obscured control, or unreachable action.
- Key interfaces have repeatable screenshot baselines that can reveal missing styles before release.
