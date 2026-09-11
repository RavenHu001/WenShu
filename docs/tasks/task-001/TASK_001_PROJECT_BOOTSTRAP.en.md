# TASK-001: Establish a runnable, testable desktop application skeleton

[简体中文](./TASK_001_PROJECT_BOOTSTRAP.md) | English

[Task archives](../README.en.md) · [Documentation center](../../README.en.md)

## Task status

- Status: `Completed`
- Priority: `P0`
- Type: `Project initialization / architectural foundation`
- Prerequisites: none
- Immediate next task: workspace folder selection and a read-only file tree
- Project baseline: [PROJECT_BASELINE.md](../../architecture/PROJECT_BASELINE.en.md)

## 1. Why this is the first step

The repository currently contains only a project overview, with no source code, dependencies, build scripts, testing facilities, or process boundaries. Future workspace access, TXT editing, DOCX processing, and state persistence all depend on a stable Electron main process, a controlled preload interface, and a React renderer.

This task establishes only the minimum engineering foundation and a complete development workflow; it does not implement product features ahead of time. After completion, subsequent agents should be able to develop incrementally within explicit boundaries without deciding the directory structure, execution method, or security model again.

## 2. Task objectives

Create an Electron + React + TypeScript desktop application for Windows 10/11 that supports this minimum workflow:

1. Start the development environment and display a desktop window with one command.
2. Complete a production build with one command.
3. Display a placeholder “文枢” application shell in the React renderer.
4. Maintain clear, controlled security boundaries between the main process, preload, and renderer.
5. Provide executable type checks, lint checks, format checks, and basic tests.
6. Provide a directory structure capable of accommodating later modules without premature complex abstractions.

## 3. Fixed technical constraints

The implementing agent must observe these constraints:

- Use Electron, React, TypeScript, and Vite.
- Manage dependencies with `npm` and commit the lockfile.
- Enable TypeScript strict mode.
- Establish the testing entry point with Vitest.
- Use ESLint and Prettier.
- Set `nodeIntegration: false` for the renderer.
- Enable `contextIsolation: true`.
- The renderer must not directly import or call Node.js file system APIs.
- Desktop capabilities may be exposed only through narrow preload interfaces using `contextBridge`.
- Do not introduce SQLite, cloud services, accounts, a plugin framework, or an AI SDK.
- Do not create microservices, a dependency-injection container, or a general plugin system for future requirements.
- Select dependency versions that are stable and mutually compatible at execution time, and record the key choices in the completion report.

## 4. In-scope work

### 4.1 Project and scripts

- Initialize `package.json` and the npm lockfile.
- Configure development and build flows for the Electron main process, preload, and Vite React renderer.
- Provide at least these npm scripts; equivalent names are acceptable, but all responsibilities must be covered:
  - `dev`: start the Electron development environment.
  - `build`: generate production build output.
  - `typecheck`: run TypeScript type checks.
  - `lint`: run static checks.
  - `format:check`: check formatting.
  - `test`: run the basic tests once.
- Configure `.gitignore` to exclude dependencies, build output, caches, and local temporary files.
- Write a short `README.md` covering requirements, installation, development, checks, and build commands.

### 4.2 Process structure

Establish at least these responsibility boundaries:

- `main`: Electron lifecycle, window creation, and security configuration.
- `preload`: the renderer’s only entry point for controlled desktop APIs.
- `renderer`: React UI without direct file system privileges.
- `shared`: shared types only when cross-process types are genuinely required; no environment-dependent implementations.

For this task, preload needs only one minimal, side-effect-free interface, such as retrieving the platform or application version, to prove that typed bridging works. Do not expose a general IPC caller, arbitrary channel access, or file system APIs in this task.

### 4.3 Minimal application shell

The renderer displays a simple placeholder workspace to demonstrate that React and styles load correctly. It must include at least:

- The product name “文枢”.
- A left sidebar placeholder.
- A central editor placeholder that remains the main visual area.
- A bottom status bar placeholder.
- One read-only environment value retrieved through preload.

This task does not require a finished visual design. The layout only needs to be stable, recognizable, and clearly structured for later replacement with real components.

### 4.4 Quality baseline

- Add at least one Vitest test that actually runs.
- Test pure logic or lightweight React rendering; do not introduce complex Electron end-to-end facilities for a placeholder test.
- Type checks must separately cover main/preload and renderer so that globals from different runtime environments do not contaminate one another.
- Build and check commands must be repeatable after a clean installation.

## 5. Explicitly out of scope

- Opening or restoring a workspace.
- A folder picker, file tree, or file watching.
- Reading, editing, or saving TXT or DOCX.
- Multi-tab state.
- Zustand application state.
- CodeMirror, Tiptap, Mammoth, docx, or JSZip.
- Search, settings persistence, or `electron-store`.
- Windows installers or automatic updates.
- Playwright/Electron end-to-end tests.
- Complete menus, keyboard shortcuts, a theme system, or finished UI design.
- AI or Agent features.

Do not add any of these capabilities incidentally if they are unnecessary for starting the project.

## 6. Suggested directory structure

The following structure is a suggestion, not a requirement to copy literally. Any adjustments must preserve equivalent responsibilities and be explained in the completion report.

```text
.
├─ src/
│  ├─ main/
│  │  └─ index.ts
│  ├─ preload/
│  │  └─ index.ts
│  ├─ renderer/
│  │  ├─ components/
│  │  ├─ App.tsx
│  │  ├─ main.tsx
│  │  └─ styles/
│  └─ shared/
│     └─ desktop-api.ts
├─ tests/                 # Tests may also be colocated with source
├─ index.html
├─ package.json
├─ tsconfig*.json
├─ vite.config.*
├─ eslint.config.*
├─ .prettierrc*
├─ .gitignore
└─ README.md
```

## 7. Suggested execution order

1. Inspect the local Node.js/npm environment and record the actual versions.
2. Initialize the npm project and install the minimum dependencies.
3. Configure isolated TypeScript compilation environments.
4. Establish the Electron main process and secure BrowserWindow configuration.
5. Establish the typed preload bridge and renderer global type declarations.
6. Establish the Vite + React page and minimal shell.
7. Configure ESLint, Prettier, Vitest, and npm scripts.
8. Add basic tests and the README.
9. Run all acceptance commands in order and fix errors before submitting the task result.

## 8. Acceptance criteria

The task may be marked complete only when all of these conditions are met:

- [ ] `npm install` succeeds in a clean environment and creates/uses the lockfile.
- [ ] `npm run dev` starts an Electron window.
- [ ] The window shows a minimal React-rendered “文枢” shell rather than a blank page.
- [ ] The page displays one read-only environment value through the typed preload API.
- [ ] BrowserWindow explicitly uses `nodeIntegration: false` and `contextIsolation: true`.
- [ ] The renderer has no direct Node.js file system access.
- [ ] Preload does not expose general `ipcRenderer`, arbitrary IPC channels, or other broad-privilege objects.
- [ ] `npm run typecheck` succeeds.
- [ ] `npm run lint` succeeds.
- [ ] `npm run format:check` succeeds.
- [ ] `npm test` succeeds with at least one meaningful test.
- [ ] `npm run build` succeeds.
- [ ] README installation and execution instructions match the actual commands.
- [ ] No product features outside Sections 4 and 5 have been implemented.

## 9. Deliverables

The implementing agent must deliver:

1. Runnable project source code and configuration.
2. The npm lockfile.
3. Basic tests.
4. Instructions for running the project.
5. A short completion report covering at least:
   - Key files added/changed.
   - Key dependencies and reasons for choosing them.
   - Verification commands actually executed and their results.
   - Unresolved issues or known limitations.
   - Whether all acceptance criteria in this document are satisfied.

## 10. Failure handling and decision rules

- If scaffolding defaults violate Electron security constraints, modify the scaffolding configuration; do not lower security standards.
- If dependencies are incompatible, prefer a stable, compatible combination; do not use `--force` or retain unresolved dependency conflicts.
- If configuring a tool substantially expands the task, use the smallest configuration that meets the acceptance criteria.
- If deviation from the project baseline or this task’s fixed constraints is necessary, stop the affected implementation, describe the issue, alternatives, benefits, risks, and migration costs in the completion report, and await the project owner’s decision.
- Do not fabricate passing results by deleting meaningful tests, disabling strict type checking, or ignoring lint rules.

## 11. Entry point for the next task

After this task, the next development task should be a minimal vertical slice: open a local folder through controlled preload/IPC, read its directory structure safely, and display a read-only file tree in the left sidebar. That follow-up task is not part of this delivery.
