# TASK-011 completion report: desktop shell, information architecture, and editing experience rework

[简体中文](./TASK_011_COMPLETION_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Implementation date: 2026-08-22; branch: `TASK-011`; starting commit: `5eea921`; platform: Windows.
> WP0–WP5 completed implementation, targeted tests, and automated quality gates in order. Sections 8–10 record real Electron screenshots, development/production startup smoke tests, and final command results. Physical Windows 100%/125%/150% display scaling changes session-level settings; automation did not change them without permission, leaving final owner confirmation pending at that time.
> Addendum, 2026-08-27: fixed `Ctrl+F` / `Ctrl+H` working only after the editor received focus. The owner confirmed actual interactions, and automated regressions/full quality gates passed; see WP4 and sections 5/8.
> Same-day addendum: fixed brief flicker after successful creation/deletion, moving, and dragging. File management reconciliation now refreshes silently in the background while manual-refresh feedback remains; single-flight refresh and cross-workspace late-result protection were added. Full gates now report 1175 passed / 10 skipped.
> The owner subsequently completed final manual tests and found no issues in interactions, scaling, accessibility, or file-operation UI stability. Task 11's automated and manual acceptance are now complete.

## 1. Actual results

Task 11 product code and automated acceptance are complete. The application moved from a prototype with two menus, a fixed sidebar, and a bottom wall of buttons to one Chinese application menu, SVG activity bar, adjustable/collapsible sidebar, object menus/keyboard/internal dragging in the file tree, compact tabs/status, continuous centered DOCX writing canvas, grouped overflow toolbar, hierarchical search results, and toast feedback.

No third-party dependency, IPC, preload method, or DesktopApi was added; the renderer still does not access Node's filesystem. Task 9's safe file management service and Task 10's current-DOCX-find controller remain unchanged as the sources of application behavior.

## 2. Work-package mapping

### WP0: freeze the baseline

- Read all required documents, renderer/controller/shared/preload/main code, and tests. No applicable `AGENTS.md` existed; the initial working tree was clean.
- Pre-change `check`: 62 files / 1133 passed / 10 conditional skips; `build` exited 0.
- Froze menu events, drag state machine, page-state matrix, screenshot strategy, and risks; see `TASK_011_WP0_REPORT.md`.

### WP1: tokens, SVG, and primitives

- `tokens.css`: surfaces/borders/text, primary/success/warning/danger/info, hover/active/selected/focus/disabled, spacing/sizes/radii/shadows/layers/motion, including forced-colors and reduced-motion.
- `Icon.tsx`: project-local SVG icons, without emoji, remote images, or new icon dependencies.
- `MenuSurface`: arrows, Home/End, Enter, Tab trapping, Escape, outside clicks, window blur, focus restoration, and listener cleanup.
- `ModalDialog`: initial focus, Tab trapping, Escape, and restoration. `ToastRegion`: timed success, persistent errors, live region, and explicit dismissal.

### WP2: application shell

- Main-process `Menu.setApplicationMenu(null)` removes Electron's default English menu. Renderer `AppMenuBar` is the sole Chinese menu, with real controller-backed commands.
- Files/Search use SVG, tooltips, and explicit names; unimplemented Settings is removed.
- Tabs jointly express active, dirty, saving, error/conflict, and close capability; backup paths move into tooltips.
- Status bar becomes a neutral 22 px surface; Electron version moves into “关于文枢” (About WenShu).

### WP3: sidebar, context menus, keyboard, and dragging

- Deleted `FileManagementToolbar.tsx` and the bottom button wall; the file tree receives all remaining height.
- Sidebar supports 180–420 px, pointer dragging, Arrow/Home/End adjustment, double-click reset, collapse, and restoration from activity bar/View menu.
- Root/blank area, file, and folder context menus use stable `WorkspaceEntry`/canonical relativePath targets, never parsed display text.
- F2, Delete, Shift+F10/Menu key, F5, Ctrl+Shift+S, and Escape reuse existing gates.
- Internal same-workspace dragging calls only `workspace.relocate`. Directory/root targets highlight; no-ops, self/descendants, same names, saving, invalid targets, and stale epochs reject. Pending prevents duplicates; Escape/dragend/unmount/workspace switching clean up.
- Success retains commitRelocate → stable tabId path migration → refresh → mutationEpoch. Main-process failure does not migrate optimistically; partial failure forces refresh.
- Reconciliation after file management success preserves the loaded layout and no longer inserts a temporary “正在刷新…” (Refreshing…) row that compresses the tree. Manual F5 still shows progress. Manual/background refresh share one in-flight Promise to avoid duplicate scans; workspace changes invalidate old-root late results. Nested duplicate refresh in Save As success was removed; main-process snapshots remain authoritative for the tree.

### WP4: editor and search

- DOCX uses a continuous centered writing canvas up to 820 px, surrounded by workspace background, without page/page-count semantics.
- Toolbar groups history, character, paragraph, character appearance, lists, and alignment. `ResizeObserver` switches to “更多格式” (More Formatting) at 700 px without causing editor horizontal scrolling.
- TXT retains CodeMirror's full-height layout and shortcuts.
- Current-document `Ctrl+F` / `Ctrl+H` gain an App window-level fallback. With focus in the tree, tabs, toolbar, or another noneditor area, dispatch by active tab to TXT CodeMirror or DOCX current-search controller. Existing editor shortcuts remain, deduplicated through `defaultPrevented`. The window entry excludes Shift/Alt combinations, preserves `Ctrl+Shift+F` workspace search, and opens no empty panel without an active document.
- Results use file card → match hierarchy, separating filename/parent path/type/count, prioritizing snippets over coordinates. Object identity and click arguments retain the original result object.
- Workspace-search limitation text collapses. Current TXT/DOCX find, ordinary/current matches, and focus styles retain their semantics.

### WP5: acceptance, screenshots, and documentation

- Added tests for tokens/forced-colors/reduced-motion, menus/dialogs/toasts, sidebar, dragging, toolbar overflow, canvas, and search hierarchy.
- Added a real Electron capturePage script and fixed screenshot directory. Updated README, PROJECT_BASELINE, TESTING, Task 11/FUTURE UI documents, and this report.

## 3. Key architecture and files

### Added

- `src/renderer/components/common/{Icon,IconButton,MenuSurface,ModalDialog,ToastRegion}.tsx`
- `src/renderer/components/shell/{AppMenuBar,ActivityBar,AboutDialog,StatusBar,SidebarResizeHandle}.tsx`
- `src/renderer/components/workspace/FileTreeContextMenu.tsx`
- `src/renderer/lib/{file-tree-interactions,sidebar-size}.ts`
- `src/renderer/styles/{tokens,common,shell,workspace,document,search}.css`
- `tests/common/ui-primitives.test.tsx`
- `tests/shell/{app-shell,design-system}.test.*`
- `tests/workspace/{file-tree-interactions,file-tree-context-drag,file-management-drag-controller}.test.*`
- `tests/document/docx-toolbar-layout.test.tsx`
- `scripts/capture-ui-baselines.mjs`
- `docs/tasks/task-011/TASK_011_WP0_REPORT.md` and this report.

### Main modifications/deletions

- `src/main/index.ts`: only removes the default menu; secure BrowserWindow settings remain unchanged.
- `src/renderer/App.tsx`: retains top-level lifecycle coordination and moves presentation details to shell/common/workspace components; connects toasts, sidebar width, global F5/Ctrl+Shift+S, and window-level current-document Ctrl+F/Ctrl+H fallback.
- `use-file-management.ts`: adds stable-path menu commands and `relocateByDrop`, with no protocol additions.
- `WorkspaceSidebar/FileTree/FileTreeNode`: complete sidebar/tree interaction rework; deletes `FileManagementToolbar.tsx`.
- `TabBar/DocumentPane/DocxToolbar/SearchSidebar/SearchResults`: shell, canvas, toolbar, and search hierarchy.
- Existing Task 1–10 tests only adapt accessible names, entry points, and compact status text. No safety or behavior assertions were removed or weakened.

## 4. Safety and lifecycle review

- BrowserWindow remains `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`.
- Preload/DesktopApi/IPC did not expand. Dragging gains no Node, absolute paths, external FileList, or force/overwrite arguments.
- Main still rejects segment symlinks/junctions, enforces realpath boundaries and prepublication revalidation; DOCX backup migration and rollback/partial failure remain unchanged.
- Deletion still only calls `shell.trashItem`, without permanent-delete fallback.
- UI/controllers defend saving-state path changes. Dirty files can move with state retained; conflict/read-only/degraded/close protection remain unchanged.
- Drag success uses existing commitRelocate, retaining stable tabId, order, active state, text/model, selection, scrolling, undo, and current find.
- Only successful mutations notify mutationEpoch. Ordinary failures/cancellation/reveal do not; late results with stale workspace epochs do not commit UI state.
- Product code logs no content, queries, absolute user paths, or drag data.

## 5. Added test matrix

- UI primitives: 7; shell/menu/status/resize: 8; design/static security: 4.
- Pure tree drop/geometry: 6; context/keyboard/drag UI: 5; drag controller: 3.
- DOCX toolbar width/overflow: 2; DOCX canvas/style: 1 new case, 3 total in the file.
- Current-document shortcuts: 2 additional cases for TXT and DOCX when an activity-bar button has focus and the editor does not. `Ctrl+F` focuses query; `Ctrl+H` focuses replacement.
- Workspace refresh: 3 additional cases. Pending background reconciliation inserts no temporary row and does not rebuild tree DOM; pending manual refresh retains explicit progress; late old-root results after a workspace switch do not overwrite the new snapshot.
- Full regressions for file management, mutationEpoch, stable tabId, DOCX find/navigation, save/conflict, and window lifecycle.
- No `.only`, new unconditional `.skip`, timeout increases, or broad snapshots replacing state transitions.

## 6. Visual and accessibility evidence

Screenshot directory: `docs/visual-baselines/task-011/`. Normal baselines include:

- `empty-files-1280x820.png`
- `empty-files-900x600.png`
- `empty-search-1280x820.png`
- `about-900x600.png`

The matrix script also generates:

- `empty-files-900x600-scale-125.png`
- `empty-files-900x600-scale-150.png`
- `empty-files-900x600-text-200.png`
- `empty-files-900x600-high-contrast.png`

The implementing Agent inspected each image locally. Normal 1280×820, 900×600, search, and About views had no clipping/occlusion; 125%/150% device-scale proxies were stable. Initial 200% zoom exposed welcome-page horizontal scrolling. Adding padding, font-size, wrapping, and `overflow-x` adjustments at widths ≤600 px removed it after rebuilding/recapturing. The forced-high-contrast image is a Chromium startup-switch proxy and cannot stand in for confirmation in a physical Windows high-contrast session.

Automated behavior evidence covers menu/dialog focus, accessible names, toast live regions, sidebar separator values, keyboard commands, drag targets, and reduced-motion/forced-colors entry points. The owner completed actual-environment manual checks for display scaling, high contrast, reduced motion, and screen readers without finding issues.

## 7. Dependencies and package size

- No dependency changes in `package.json` / lockfile.
- Added renderer code is project TypeScript/CSS/SVG. Final outputs: main 154.95 kB, preload 4.10 kB, renderer CSS 53.24 kB, renderer JS 2,263.67 kB.

## 8. Automated quality commands

| Command                              | Final result                               |
| ------------------------------------ | ------------------------------------------ |
| `.\scripts\npm.cmd run typecheck`    | Passed; 5 tsconfigs; exit 0                |
| `.\scripts\npm.cmd run lint`         | Passed; 0 warnings; exit 0                 |
| `.\scripts\npm.cmd run format:check` | Passed; exit 0                             |
| `.\scripts\npm.cmd test`             | 69 files; 1175 passed / 10 skipped; exit 0 |
| `.\scripts\npm.cmd run check`        | 69 files; 1175 passed / 10 skipped; exit 0 |
| `.\scripts\npm.cmd run build`        | main/preload/renderer all produced; exit 0 |

The 10 conditional skips are real symlink/junction permission conditions already recorded in Tasks 1–10: read-text 2, read-docx 2, TXT search 1, mixed search 1, resolve 1, relocate 1, trash 1, reveal 1. Mocks deterministically cover rejection. No skips were added. Three stderr records are expected temporary-cleanup failures from existing save/create failure injection.

## 9. Windows development/production smoke tests

| Mode                                              | Actual record                                                                                                                                                                                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development `.\scripts\dev.cmd`                   | main 154.95 kB and preload 4.10 kB built; renderer `http://localhost:5173/` ready; `start electron app...`; 4 Electron processes alive ≥10 s; no error/Uncaught; 0 remaining after Ctrl+C                                                                       |
| Production `.\scripts\npm.cmd exec -- electron .` | 4 Electron processes alive ≥10 s; no terminal error/Uncaught; 0 remaining after Ctrl+C                                                                                                                                                                          |
| Screenshot helper                                 | GPU subprocess unavailable inside restricted sandbox; ran outside it with approval. BrowserWindow still used `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`; renderer served by a loopback-only temporary HTTP server; every capture exited 0 |

Startup smoke tests and actual screenshots prove the final main/preload/renderer load. They do not replace manual GUI checks of workspace operations, external Office file locks, or physical display settings.

## 10. Known limitations and follow-up suggestions

1. Automated screenshots cannot fully replace physical Windows display scaling, system text scaling, and accessibility environments. The owner tested the manual checklist and confirmed no issues.
2. Automated screenshots cover empty workspace/search/About states. Real long trees and the complete state matrix passed manual functional tests; privacy-safe manual fixtures can supply further screenshots if a visual archive is needed later.
3. HTML5 dragging only supports moves within WenShu's tree. Explorer drag-in/out, copying, overwriting, and cross-workspace/cross-drive operations remain unsupported.
4. DOCX uses a continuous reading column, not pagination or print preview. Complex Word content scope is unchanged.
5. Suggested later tasks: filesystem watching/external-change notices; basic settings/themes/session recovery; installers and signing.

## 11. Are all Task 11 acceptance criteria satisfied?

- Product code, protocol safety, automated tests, builds, fixed-size real Electron screenshots, and startup smoke tests are complete. Implementation and automated acceptance criteria are satisfied.
- The owner completed actual GUI acceptance and found no issues with interactions, scaling, accessibility, real file operations, or stability after the create/delete/move/drag fixes.

**Current conclusion: Task 11 implementation, automated quality gates, and final manual acceptance are complete. All acceptance criteria are satisfied.**
