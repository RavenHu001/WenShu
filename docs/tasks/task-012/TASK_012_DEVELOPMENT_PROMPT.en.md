# TASK-012 Development Execution Prompts

[简体中文](./TASK_012_DEVELOPMENT_PROMPT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> This document is for Codex or the development Agent implementing
> [TASK-012: Windows Alpha Release Engineering](./TASK_012_WINDOWS_ALPHA_RELEASE.en.md).
> Use the complete “main prompt” for the whole task, or copy the matching WP0–WP8 prompt for each package.
> For package-by-package execution, subsequent Agents must first read the main prompt, Task 12 plan,
> WP0 report, preceding changes, and current Git diff.

---

## 1. Main prompt

You are continuing development of the WenShu Windows desktop application in the `WenShu`
repository. Fully implement **TASK-012: Windows Alpha Release Engineering**, but proceed in
small steps from WP0 through WP8. Each package must pass targeted verification and its gate
before the next starts. Do not stop early after generating one EXE. The revised final goal is
MIT source publishable on GitHub and Windows 10 x64 unsigned internal Alpha engineering that is
reproducibly buildable, has auditable package contents, runs installed/portable, verifies
`NotSigned`/hashes/provenance, and preserves Task 1–11 data-safety and lifecycle semantics.
Do not publish Windows binaries or claim Windows 11 has been validated.

### 1.1 Required before starting

1. Read these files in full, not only headings, summaries, or another Agent's paraphrase:
   - `README.md`
   - `docs/architecture/PROJECT_BASELINE.md`
   - `docs/development/DEVELOPMENT_ENVIRONMENT.md`
   - `docs/development/TESTING.md`
   - `docs/tasks/task-009/TASK_009_COMPLETION_REPORT.md`
   - `docs/tasks/task-010/TASK_010_COMPLETION_REPORT.md`
   - `docs/tasks/task-011/TASK_011_UI_SHELL_INFORMATION_ARCHITECTURE.md`
   - `docs/tasks/task-011/TASK_011_COMPLETION_REPORT.md`
   - `docs/tasks/task-012/TASK_012_WINDOWS_ALPHA_RELEASE.md`
   - `package.json`, `package-lock.json`, `.node-version`, `.gitignore`
   - `electron.vite.config.ts`
   - `src/main/index.ts`, `src/preload/index.ts`, `src/shared/desktop-api.ts`
   - Every repository `AGENTS.md` applicable to the current directory, if any.
2. Check the current branch and `git status`. Existing user changes belong to the user: do not
   reset, overwrite, delete, or mix unrelated changes into them.
3. Read directly relevant source/tests, confirming external main-process dependencies, renderer
   bundle, preload boundaries, BrowserWindow security configuration, runtime info, and existing
   startup/screenshot scripts.
4. Before changing product code or dependencies, actually run:
   - `.\scripts\npm.cmd run check`
   - `.\scripts\npm.cmd run build`
5. Record test-file/passed/failed/skipped counts and reasons; record main/preload/renderer output sizes.
6. If baseline fails, distinguish mainline, environment, user-change, or real-regression causes.
   Do not manufacture passing gates through weaker assertions, new skips, larger timeouts, or disabled security.

### 1.2 Changeable facts requiring fresh verification at implementation

Electron, electron-builder, Playwright, GitHub Actions, Windows signing, and SmartScreen rules
change. Use official sources listed in section 3.4 of
`docs/tasks/task-012/TASK_012_WINDOWS_ALPHA_RELEASE.md` to reverify:

- That day's three latest supported stable Electron series and each EOL;
- Latest patch/breaking changes on the middle supported series;
- Current stable electron-builder major, Node.js requirements, configuration schema, NSIS/portable,
  fuses, and `win.sign`;
- Playwright Electron support status, native-dialog restrictions, and `nodeCliInspect` relationship;
- Current official GitHub Actions, least privilege, and Artifact Attestations eligibility;
- Current Microsoft Authenticode, SmartScreen, and Smart App Control explanations. Check Artifact
  Signing only when future public-binary work starts.

Use only official documentation, official release pages, or primary sources. If the support
window differs from the plan at implementation, update Task 12/WP0 decisions first; do not
mechanically install obsolete exact versions from documentation.

### 1.3 Fixed product decisions

Unless the owner explicitly changes them before implementation begins, use:

- First Alpha: `0.1.0-alpha.1`;
- Git tag: `v0.1.0-alpha.1`;
- `appId`: `io.github.ravenhu001.wenshu`;
- Display name: `文枢`;
- Executable/artifact base name: `WenShu`;
- Current internal validation platform: Windows 10 x64; Windows 11 acceptance is optional future work;
- Architecture: x64;
- Outputs: portable + per-user NSIS;
- Current-user installation, no elevation by default;
- No automatic updates, telemetry, file associations, ARM64, ia32, Store/MSIX/MSI, macOS, or Linux;
- Do not use Electron 37 for final Alpha outputs;
- By default select the latest patch of the middle of the three latest supported Electron series that day;
- Project license: MIT License, `Copyright (c) 2026 Jinxi Hu`;
- Current public deliverables are only GitHub source, licensing, and documentation; portable/NSIS
  are `NotSigned` internal experimental artifacts;
- Do not create or make public a current Windows binary Release. Microsoft Artifact Signing +
  GitHub OIDC, trusted publisher, timestamps, and public binaries together remain optional future work;
- Existing `v0.1.0-alpha.1` is a historical internal Draft tag; do not move it or present current
  HEAD outputs as its artifacts.

### 1.4 Task 1–11 baseline that must not regress

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`;
- Renderer cannot directly access Node.js, filesystem, shell, process, or generic IPC;
- Preload exposes only exact-shape narrow APIs, never `ipcRenderer`, arbitrary invoke/on/send,
  arbitrary paths, or command execution;
- Main continues validating sender, exact request shape, workspace boundaries, symlink/junction,
  realpath, and pre-publication races;
- TXT save revision, same-directory temporary writing, sync/close, and safe replacement are unchanged;
- DOCX intermediate model, resource budgets, compatibility, output reverification, and `.wenshu.bak` are unchanged;
- Delete goes only to Windows Recycle Bin, without permanent-delete fallback;
- Stable `tabId`, `mutationEpoch`, dirty/saving/conflict/read-only/degraded, and close protection are unchanged;
- No regressions in find/replace, workspace search, result locating, or path migration;
- Logs contain no document content, query/replacement text, absolute user paths, file handles,
  raw OOXML, certificates, or tokens;
- Installation, upgrade, and uninstallation must not modify/delete external user workspaces.

If any item truly must change, report necessity, impact, data-safety risks, migration, and test
plan before coding, and wait for owner confirmation.

### 1.5 Matters requiring owner permissions or decisions

These are already decided by the owner and must not be reset to pending decisions: MIT License,
copyright holder Jinxi Hu, public source, unsigned binaries for internal use only, no public
Windows binaries, and deferral of Windows 11/Artifact Signing/OIDC.

Do not infer or fabricate these matters still needing separate authorization:

- Final confirmation of “文枢 / WenShu” name, icon, and external publisher identity;
- Future Authenticode certificate, Microsoft Artifact Signing/HSM/certificate-store purchases,
  identity verification, and credential authorization;
- Actual creation/pushing of new Git tags, pushing code, or creating/publishing GitHub Releases;
- Public distribution of unsigned binaries;
- Windows session-wide scaling/security-policy changes, or installing/uninstalling outputs on
  real hosts when existing applications may be affected.

You may complete local unsigned internal Alpha work, `NotSigned` verification, hashes, and release
workflow dry-runs. Current scope configures no real signing credentials and creates/replaces/makes
public no Windows binary Release. General development authorization does not expand that boundary.
Without explicit authorization in the current user request, do not push, tag, upload, or create
Releases. When credentials are needed, never request plaintext private keys/passwords pasted
into the conversation; provide only secure local/cloud signing-configuration entry points.

### 1.6 Work-package order

#### WP0: Fix baseline, runtime, identity, and release semantics

- Remeasure baseline and official version information;
- Pin Electron, electron-builder, Playwright, and GitHub Action versions;
- Confirm identity, version, architecture, outputs, signing level, and licensing decision points;
- Add `docs/tasks/task-012/TASK_012_WP0_REPORT.md`;
- Change no product functionality or install new dependencies in this package.

#### WP1: Migrate to a supported Electron runtime

- Runtime migration and necessary compatibility fixes only;
- Restore full Task 1–11 regressions, native Windows capabilities, and WPS/Word smoke;
- Do not proceed to packaging before passing.

#### WP2: Application identity, version, icons, and About

- Fix `0.1.0-alpha.1`, appId, display/executable names, and artifact naming;
- Add multi-size Windows ICO with traceable rights;
- About shows the product version consistent with package metadata;
- Do not expose broad runtime/process capabilities to read a version.

#### WP3: electron-builder, artifact allowlist, and dependency reduction

- Introduce exact electron-builder version and separate configuration;
- Generate unpacked first, portable/NSIS second;
- Establish content allowlist and prohibited-file audits;
- Retain only real main-process runtime dependencies, preventing duplicate renderer dependencies.

#### WP4: ASAR, fuses, package verification, and Electron E2E

- Enable ASAR integrity/fuses suitable for current `loadFile()` architecture;
- Add Playwright Electron E2E;
- Separate drivable unpacked E2E from hardened final-artifact black-box smoke;
- Add no generic product test IPC.

#### WP5: Windows installation, upgrade, uninstallation, and real-document acceptance

- Verify unpacked, portable, and NSIS in controlled test directories/hosts;
- Cover Windows 10 x64, standard users, Chinese/space-containing paths, installation/upgrade/
  uninstallation; Windows 11 is optional future work;
- Cover TXT/DOCX, backups, conflicts, Recycle Bin, and WPS/Word with temporary workspaces;
- Any workspace data change immediately stops release.

#### WP6: Windows CI, release workflow, and provenance evidence

- Add least-privilege PR/push CI and a separate release workflow;
- Use `npm ci`, version/tag validation, rebuilds, SHA-256, and Draft Pre-release structure;
- Current release workflow generates only unsigned internal Drafts without automatic publication.
  Only future signing/public jobs require OIDC, least privilege, and manual Environment approval;
- Without current user authorization, submit only workflows and local verification; no push/tag/release.

#### WP7: Signing boundaries, licensing, and Alpha release documentation

- Implement MIT, `NotSigned` internal outputs, and public-source boundaries;
- Accept, print, or store no plaintext private keys/passwords;
- Handle unsigned-state verification after package contents/fuses, final SHA-256, and reverification;
- Generate owner-confirmed LICENSE/rights files, NOTICE, CHANGELOG, SECURITY, and Release Notes;
- Do not move historical tags or publish binaries; document Artifact Signing + GitHub OIDC only as optional future work.

#### WP8: Overall acceptance, scope review, documentation, and completion report

- Run final `check`, `build`, package, verify, and release rehearsal from a clean checkout;
- Audit package contents, fuses, `NotSigned`, hashes, CI, Windows 10 matrix, licensing, privacy, and known limitations;
- Update README, PROJECT_BASELINE, DEVELOPMENT_ENVIRONMENT, TESTING, and Roadmap;
- Add `docs/tasks/task-012/TASK_012_COMPLETION_REPORT.md`;
- Only with complete evidence conclude “MIT source release readiness complete; Windows 10 x64
  unsigned internal Alpha engineering complete”, explicitly stating Windows binaries were not
  made public. Unexecuted Windows 11/Artifact Signing/OIDC must not be labeled current blockers.

### 1.7 Code, script, and configuration requirements

- Use separate `electron-builder.yml`, not extensive release configuration piled into `package.json`;
- Use package allowlists, not “include everything by default + a few exclusions”;
- Explicitly exclude `src/`, `tests/`, `docs/`, `scripts/`, `.git/`, `.github/`, `.tools/`, `.env*`,
  logs, test fixtures, `out/.capture-user-data/`, and all userData;
- Actual external imports in `out/main` and clean-artifact launch are the facts for packaged dependencies;
- Move to `devDependencies` only dependencies fully bundled in renderer and not externally referenced by main/preload;
- Prohibit local phantom dependencies; reproduce in clean `npm ci`;
- Tests/audits use isolated temporary directories and validate cleanup targets first;
- No recursive deletion against workspace root, user home, or unresolved variables;
- PowerShell scripts use `-LiteralPath` for variable paths; verify resolved absolute paths remain
  inside dedicated temporary/artifact directories before deletion/moving;
- GitHub workflows use least privilege, fully separating release jobs from PR CI;
- Release workflow third-party Actions should use full commit SHAs with readable-version comments;
- Never write certificates, passwords, tokens, release credentials, or their values into command
  output, logs, fixtures, repository, or artifacts;
- Keep strict TypeScript; no unexplained `any`, broad assertions, `eslint-disable`, or error-swallowing catch;
- No generic command execution, filesystem, or arbitrary-URL capabilities for release convenience.

### 1.8 Tests and quality gates

Each package first runs targeted tests, then according to risk:

```powershell
.\scripts\npm.cmd run typecheck
.\scripts\npm.cmd run lint
.\scripts\npm.cmd run format:check
.\scripts\npm.cmd test
.\scripts\npm.cmd run check
.\scripts\npm.cmd run build
```

From WP3 onward, also run the unpacked/package/verify commands actually introduced by then.
From WP4 onward, run Electron E2E and final-artifact smoke.

Automated tests must cover:

1. Version, tag, About, metadata, and artifact-name consistency;
2. Package allowlist, prohibited paths, blocking keys/environment files/userData;
3. Complete external main-process dependencies, no unexpected duplicate renderer dependencies;
4. Parsable ASAR, integrity metadata, correct fuses read from final EXE;
5. Unpacked and drivable-build Playwright E2E;
6. Final hardened portable/NSIS black-box launch, process cleanup, independence from source environment;
7. TXT/DOCX reads, edits, saves, backups, dirty-close, and disk bytes;
8. NSIS/portable names, architectures, sizes, and SHA-256;
9. Current portable/NSIS `NotSigned` and final-hash reverification; substitute trusted-signature,
   timestamp, and publisher checks only for future public binaries;
10. Full Task 1–11 regressions.

Do not:

- Add unconditional `.skip`, `.only`, or delete safety/data assertions;
- Substitute snapshots for assertions on contents, processes, file bytes, or installation state;
- Mask residual processes, unhandled dialogs, failed Playwright connections, or build deadlocks
  with excessive timeouts;
- Run destructive tests in real user document directories, project root, or uncleared installation directories;
- Substitute a process surviving 10 seconds for actual open/save/install/uninstall acceptance;
- Fabricate Windows 10, SmartScreen, WPS/Word, Authenticode-state, or GitHub workflow success
  that cannot be executed in the current environment;
- Describe unexecuted Windows 11, Artifact Signing/OIDC, or public binaries as currently completed or blocking.

### 1.9 Working method and per-package reports

- Investigate before modifying; use current code, lockfile, official docs, and measurements as facts;
- Use a reviewable work plan with only one package under implementation at a time;
- After each package, review `git diff`, tests, and outputs, then report:
  1. Actual changes;
  2. Exact added/modified files;
  3. Actual commands/results;
  4. Test counts/skip reasons;
  5. Artifacts, sizes, contents, or Windows evidence when applicable;
  6. Known limitations, unresolved questions, and next-package entry;
  7. Whether the package gate is actually met.
- No destructive Git operations, push, merge, tag, or release without explicit current-request authorization;
- Independently investigate/fix routine implementation issues decidable from code/tests;
- MIT, copyright holder, public source, and internal-binary scope are confirmed. Pause for
  decisions only when changing those, confirming brand/icons, publishing externally, or affecting user/system state;
- Missing Azure/OIDC/signing conditions are not current blockers; complete safe local engineering,
  dry-runs, and documentation;
- Do not end Task 12 as “packaging succeeded” or “main workflow complete” before all acceptance finishes.

### 1.10 Final deliverables

After completion, provide:

1. Exact supported Electron version, migration rationale, and Task 1–11 regression evidence;
2. `electron-builder.yml`, icons/build resources, local package/verify scripts;
3. Windows x64 unpacked/portable/NSIS artifacts and size/content audits;
4. Playwright Electron E2E, hardened-artifact black-box smoke, ASAR/fuse verification;
5. Windows 10 x64 installation/upgrade/uninstallation, Chinese/space-containing paths, Recycle Bin,
   WPS/Word manual evidence, and the record that Windows 11 support is not claimed;
6. Permissions, caching, artifacts, and release semantics of `.github/workflows/ci.yml` and `.github/workflows/release.yml`;
7. Actual `NotSigned`, no timestamp/publisher, SHA-256, and attestation states, plus the boundary
   that future trusted signing is unexecuted;
8. LICENSE/rights files, `THIRD_PARTY_NOTICES.txt`, `CHANGELOG.md`, `SECURITY.md`, Release Notes;
9. `docs/tasks/task-012/TASK_012_WP0_REPORT.md` and `docs/tasks/task-012/TASK_012_COMPLETION_REPORT.md`;
10. Updated README, PROJECT_BASELINE, DEVELOPMENT_ENVIRONMENT, TESTING, Roadmap;
11. Complete command results, test counts, skip reasons, limitations, unresolved issues;
12. Explicit conclusion: “MIT source release readiness complete; Windows 10 x64 unsigned internal
    Alpha engineering complete” or “blockers remain”, explicitly stating no public Alpha binaries.

The final response should lead with the actual release level achieved, then key changes,
artifacts, tests, signing/release evidence, limitations, and important file links.

---

## 2. Per-work-package execution prompts

These prompts suit package-by-package execution. Replace bracketed placeholders with real
values when copying. If there is no corresponding content, enter “none”; do not remove baseline
or authorization restrictions.

### 2.1 WP0 execution prompt

```text
You are executing TASK-012 WP0 in the WenShu repository: fix the baseline, runtime, identity, and release semantics.

Current branch: [current branch]
Previous recovery point: [commit SHA or “none”]
Known user changes: [user changes or “none”]
Public target: GitHub MIT source
Internal target: Windows 10 x64 unsigned portable/NSIS
Signing conditions: currently `NotSigned`; Artifact Signing + GitHub OIDC is optional future work
Project license decision: MIT License, Copyright (c) 2026 Jinxi Hu

First read the main prompt in docs/tasks/task-012/TASK_012_DEVELOPMENT_PROMPT.md, docs/tasks/task-012/TASK_012_WINDOWS_ALPHA_RELEASE.md, and every required material in its section 3.1 in full. Check all applicable AGENTS.md and git status; preserve user changes.

This package covers only investigation, measurements, fixed decisions, and the WP0 report. Do not install dependencies, upgrade Electron, add packaging configuration, modify product features, or create tags/Releases.

Actually run check, build, and development/production Electron launch smoke, recording counts and outputs. Inspect actual Electron, electron-vite, Vite, Vitest, Node/npm versions in package/lock; external main-process bundle dependencies; bundled renderer dependencies; native modules; prohibited data in out/; and current package size.

Use official primary sources from Task 12 section 3.4 to check that day's Electron support window, latest patch of the middle supported series, breaking changes, current stable electron-builder and Node/schema/NSIS/portable/fuses/signing, Playwright Electron limitations, GitHub Actions, and Microsoft signing/SmartScreen rules. Fix exact versions rather than broad major or caret ranges.

Check appId=io.github.ravenhu001.wenshu, version=0.1.0-alpha.1, Windows 10 x64, portable + per-user NSIS, ASCII artifact names, and public MIT-source/internal unsigned-binary levels. Windows 11, trusted signing, and public binaries are outside current gates. Unknown brand icons or future public publisher identity are future decisions, not matters to guess.

Add docs/tasks/task-012/TASK_012_WP0_REPORT.md, recording official links, exact versions, baseline commands, dependencies/licenses, package-content risks, Windows/CI/signing decisions, test plan, known blockers, and whether WP0 passes. Finish by reviewing diff, checking documentation formatting, and reporting whether WP1 may start. Do not start WP1.
```

### 2.2 WP1 execution prompt

```text
You are executing TASK-012 WP1 in the WenShu repository: migrate to a supported Electron runtime.

Current branch: [current branch]
Previous recovery point: [commit SHA]
Known user changes: [user changes or “none”]
Exact Electron version fixed by WP0: [version]
WP0 direct compatible-dependency decision: [decision]

Read the main prompt, Task 12 plan, TASK_012_WP0_REPORT.md, candidate Electron's official breaking changes, package/lock, main/preload/renderer entries, and all Electron IPC/window/Recycle Bin/dialog source and tests in full. Check git status and preserve user changes.

This package only migrates Electron from 37.10.3 to WP0's exact supported version and minimally fixes compatibility issues caused by official breaking changes. Upgrade electron-vite/Vite/type tools only with official requirements or measured evidence, not incidental wholesale dependency upgrades. Introduce no electron-builder, packaging configuration, icons, E2E, CI, signing, or new product features.

Update dependencies using the project lockfile and official npm packages. If network/downloads are restricted, request necessary approval under execution-environment rules. Do not use unofficial mirrors or manually change the lockfile to fabricate installation.

After migration, actually run typecheck, lint, format:check, all test, check, build, development Electron smoke, and production-build Electron smoke. Manually verify the main window, Chinese input, directory dialog, TXT/DOCX opening/editing/saving, DOCX backups, external conflicts, Recycle Bin, reveal-in-Explorer, dirty/saving close protection, and basic WPS/Word round trips. Record actual Electron/Chromium/Node runtime versions and all test counts.

If any Task 1–11 data-safety, IPC, file-management, save, backup, or close semantics regress, remain in WP1 and fix them; do not proceed to packaging. Finish by reviewing diff and reporting exact upgrades, breaking-change handling, automated/manual evidence, unresolved issues, and whether the WP1 gate is met. Do not start WP2.
```

### 2.3 WP2 execution prompt

```text
You are executing TASK-012 WP2 in the WenShu repository: application identity, version, icons, and About.

Current branch: [current branch]
Previous recovery point: [commit SHA]
Known user changes: [user changes or “none”]
Owner-confirmed icon source/design: [file/generation description/pending confirmation]
Owner-confirmed project license decision: MIT License, Copyright (c) 2026 Jinxi Hu

Read the main prompt, Task 12 plan, WP0 report, WP1 changes/evidence, package/lock, DesktopRuntimeInfo/preload/About, and related tests in full. Check git status and preserve user changes.

Fix package.json.version at 0.1.0-alpha.1. Prepare a single identity source for later electron-builder with appId=io.github.ravenhu001.wenshu, productName=文枢, executableName=WenShu, and ASCII artifact naming. Change “关于文枢” (About WenShu) to show product version, Alpha designation, platform, and Electron version. Never read version from user-controlled environment variables. Any added IPC must be parameterless, read-only, exact-shape runtime info, without generic app/path/process capabilities. Prefer a testable single version source.

Use an owner-confirmed original icon with traceable rights to generate multi-resolution Windows ICO and necessary build/ resources. Do not download unknown icons from the web or automatically pass existing functional SVG icons off as brand icons. If icon design is not confirmed, complete version/About work but retain the icon as a WP2 gate; do not decide branding independently.

Add/update tests for version shape, About display, read-only protocol, preload contract, icon presence/dimensions/formats, and prevention of version divergence. Do not install electron-builder, generate installers, or implement CI/signing in this package.

Run targeted tests, full check and build, and launch production to inspect About. Finish by reviewing diff, icon rights/provenance, version uniqueness, and IPC exposure; report whether WP2 passes. Do not start WP3.
```

### 2.4 WP3 execution prompt

```text
You are executing TASK-012 WP3 in the WenShu repository: electron-builder, artifact allowlist, and dependency reduction.

Current branch: [current branch]
Previous recovery point: [commit SHA]
Known user changes: [user changes or “none”]
Exact electron-builder version fixed by WP0: [version]
Current exact Electron version: [version]

Read the main prompt, Task 12 plan, WP0 report, WP1/WP2 changes/evidence, current official electron-vite distribution documentation, current official electron-builder schema/Windows/NSIS/portable documentation, package/lock, electron.vite.config.ts, external imports in out/ artifacts, and .gitignore in full. Check git status and preserve user changes.

Use project npm to install WP0's exact electron-builder dev dependency and update the lockfile; do not edit lock manually. Add separate electron-builder.yml and clearly named package:dir/package:win/package:verify scripts. Configure appId, productName, executableName, buildResources, separate artifact output directory, x64 portable, and per-user assisted NSIS. No signing or publish integration in this package.

Use a package allowlist containing only out/main, out/preload, out/renderer, necessary package metadata, and actual external main-process runtime dependencies. Deterministically block src, tests, docs, scripts, .git/.github/.tools/.env*, logs, test fixtures, screenshot baselines, out/.capture-user-data, and all userData/credentials.

Confirm from actual out/main external imports that jszip, mammoth, docx, and indirect dependencies must ship. Individually assess whether fully renderer-bundled React/CodeMirror/Tiptap dependencies may move to devDependencies, using clean npm ci + build + packaged launch evidence, rather than guessing from source imports alone.

Generate unpacked first and launch after moving source-repository dependencies away, confirming no missing modules. Add repeatable package-content audits: necessary files, prohibited paths/extensions/secret patterns, package main/version, external dependencies, architecture, and sizes. Then generate portable/NSIS, recording unpacked/app.asar/app.asar.unpacked/portable/NSIS sizes, file inventories, and duplicate dependencies.

Clean only exact paths verified as project-dedicated artifact directories. Never recursively delete repository root, user directories, or unresolved variables.

Run targeted package-audit tests, full check/build, package:dir, package:win, package:verify, and launch smoke for all three output types. No fuses/Playwright/CI/signing in this package. Finish by reviewing contents, dependencies, prohibited data, sizes, diff, and temporary leftovers; report whether WP3 passes. Do not start WP4.
```

### 2.5 WP4 execution prompt

```text
You are executing TASK-012 WP4 in the WenShu repository: ASAR, fuses, package verification, and Electron E2E.

Current branch: [current branch]
Previous recovery point: [commit SHA]
Known user changes: [user changes or “none”]
Exact Playwright version fixed by WP0: [version]
Current exact Electron/electron-builder versions: [versions]

Read the main prompt, Task 12 plan, WP0 report, WP1–WP3 changes/evidence, current official electron-builder fuses/ASAR integrity documentation, Electron fuses/security/ASAR documentation, Playwright Electron documentation, all packaging scripts, and window/preload/IPC/document tests in full. Check git status and preserve user changes.

For every Electron fuse, record project-specific reasons for enabled/disabled/default retained. At minimum, measure runAsNode=false, enableNodeOptionsEnvironmentVariable=false, enableEmbeddedAsarIntegrityValidation=true, onlyLoadAppFromAsar=true. The renderer uses loadFile/file://; do not blindly copy templates that disable file-protocol capabilities. Minimally test the nodeCliInspect/Playwright conflict. Prefer disabling it in final artifacts without fabricating evidence of full Playwright control after disabling.

Use current official electron-builder fuse integration, or an explicitly justified official @electron/fuses afterPack approach, not both simultaneously. After enabling ASAR integrity, read and verify it from final EXE/app.asar, and test observable startup rejection for tampered/missing ASAR without damaging the user's environment.

Install WP0's pinned Playwright dev dependency. Add dedicated tests/e2e and isolated temporary workspaces/userData. Use ElectronApplication.evaluate to replace native open/save/message dialogs, not coordinate-click OS dialogs. Cover launch, workspace opening, TXT edit/save bytes, basic DOCX save/valid OOXML/backup, dirty-close protection, About version, no unhandled exceptions, and process/temporary cleanup. Expose no generic test IPC or arbitrary paths in product DesktopApi.

If Playwright cannot drive final hardened artifacts, retain drivable unpacked-build E2E, then implement final portable/NSIS black-box launch, window/process survival, absence of main-process dialogs, exit cleanup, fuse reads, ASAR integrity, and source-directory-independent smoke. Explicitly state automation boundaries in the report.

Run targeted E2E/package verification, full check/build/package/verify, and final-artifact smoke. Check for no residual Electron processes, temporary workspaces/userData, or log leaks. Finish by reporting every fuse, ASAR evidence, E2E coverage/limitations, artifact results, and whether WP4 passes. Do not start WP5.
```

### 2.6 WP5 execution prompt

```text
You are executing TASK-012 WP5 in the WenShu repository: Windows installation, upgrade, uninstallation, and real-document acceptance.

Current branch: [current branch]
Previous recovery point: [commit SHA]
Known user changes: [user changes or “none”]
Available Windows acceptance environment: Windows 10 x64 host or VM
Available Office programs: [WPS/Word and versions]

Read the main prompt, Task 12 plan sections 8.5/8.6, WP0 report, WP1–WP4 changes/evidence, packaging configuration, package verification/E2E, and Task 7/9/11 Windows manual checklists/completion reports in full. Check git status and preserve user changes.

This package only accepts real Windows artifacts and fixes acceptance findings within Task 12 scope. No CI, signing, automatic updates, or new product features. Use exact validated temporary directories and privacy-safe fixtures; never run install/uninstall/delete tests against the repository, real user documents, or broad system directories. If installing/uninstalling on real hosts, changing Windows settings, or using GUI requires approval, request it under execution-environment rules.

Verify unpacked, portable, and per-user NSIS separately: portable starts from ordinary/Chinese/space-containing directories; standard-user NSIS does not proactively elevate, with correct installation path, Start menu, shortcuts, About version, and uninstall entry; same-version reinstall and alpha.0-test → alpha.1 retain installation identity; no unexpected processes, shortcuts, or installation directories remain after exit/uninstallation.

Before installation, generate byte/directory hash manifests for a temporary external workspace and reverify after installation, upgrade, and uninstallation. Then use installed and portable variants separately to cover workspace opening, TXT/DOCX opening/editing/saving, DOCX backup, external conflicts, read-only/degraded, Recycle Bin delete/restore, reveal-in-Explorer, dirty/saving close protection, and bidirectional WPS/Word round trips.

Repeat the key matrix under a Windows 10 x64 standard user. Record startup/installation/uninstallation timings, sizes, residual processes, Defender, SmartScreen, and actual Authenticode behavior. Do not claim no warnings for all users from one machine. Explicitly mark Windows 11 acceptance as optional future work; neither fabricate it nor make it a current WP5 blocker or claim support.

If any installation/upgrade/uninstallation modifies/deletes external workspaces, elevates unsafely, or breaks Task 1–11 data semantics, stop release immediately, preserve evidence, fix first, and rerun affected matrices. Finally run full check/build/package/verify, review leftovers, and report environments, operations, results, limitations, and whether WP5 passes. Do not start WP6.
```

### 2.7 WP6 execution prompt

```text
You are executing TASK-012 WP6 in the WenShu repository: Windows CI, release workflow, and provenance evidence.

Current branch: [current branch]
Previous recovery point: [commit SHA]
Known user changes: [user changes or “none”]
Repository visibility/plan and attestation eligibility: [confirmed information/to investigate]
Has the current user authorized push/tag/Draft Release creation: [yes/no]

Read the main prompt, Task 12 plan section 7, WP0 report, WP1–WP5 changes/evidence, all package/verify/E2E scripts, and current official GitHub Actions/workflow permissions/dependency caching/release/artifact-attestation documentation in full. Check git status and preserve user changes.

Add .github/workflows/ci.yml: on a fixed Windows runner, use exact Node matching .node-version, npm ci, check, build, and defined Electron E2E. Default permissions: contents: read, no signing credentials or publication. Cache npm downloads only; do not trust node_modules/out/packaged artifacts across commits.

Add separate .github/workflows/release.yml: trigger only via workflow_dispatch or v* tags strictly matching package version; rerun npm ci/check/build/package/verify from the tag's single commit. Currently generate/verify only `NotSigned` internal artifacts. Only the Draft upload job receives `contents: write`. Generate SHA256SUMS.txt, verify, then upload a Draft Pre-release without automatically making it public. Azure/OIDC, signing jobs, and public-release permissions are outside current scope.

Prefer official GitHub checkout/setup-node/upload-artifact/attest. Pin third-party Actions in the release workflow to full commit SHAs with readable versions in adjacent comments. Record every Action's purpose, permissions, maintainer, and alternatives. Add artifact attestation if the repository/plan supports it; otherwise record the limitation truthfully.

Use unsigned internal test artifacts to verify local workflow semantics, YAML, commands, paths, permissions, and names. Without explicit current-user authorization for external actions, do not push, create tags, start remote workflows, or create Releases. Retain actual remote execution as an acceptance item requiring authorization in the completion report. Even with authorization, first check exact repository, branch/tag, and Draft status; do not publish directly. Existing tags must not move; current HEAD must not masquerade as old-tag artifacts.

Run local targeted checks, full check/build/package/verify/E2E. Check for no plaintext workflow credentials, no PR write/signing permissions, and non-bypassable version/tag checks. Finish by reporting workflow structure, Action pins, permissions, caching, attestation eligibility, actual local/remote evidence, unauthorized items, and whether WP6 passes. Do not start WP7.
```

### 2.8 WP7 execution prompt

```text
You are executing TASK-012 WP7 in the WenShu repository: signing boundaries, licensing, and Alpha release documentation.

Current branch: [current branch]
Previous recovery point: [commit SHA]
Known user changes: [user changes or “none”]
Owner-confirmed current signing approach: internal unsigned only (`win.sign: false`)
Owner-confirmed optional future approach: Microsoft Artifact Signing + GitHub OIDC
Owner-confirmed project license: MIT License, Copyright (c) 2026 Jinxi Hu
Public deliverables: GitHub source, licensing, and documentation
Public Windows binary authorization: no

Read the main prompt, Task 12 plan sections 4.5/6.5/7.4/8.7/8.8, WP0 report, WP1–WP6 changes/evidence, current electron-builder v27 configuration documentation, current Microsoft Authenticode/SmartScreen documentation, lockfile, and all workflow/package scripts in full. Artifact Signing documentation is only for accurately recording the optional future approach, not integrating Azure/OIDC. Check git status and preserve user changes.

Do not ask the user to paste plaintext private keys, PFX passwords, Azure/GitHub tokens, or certificate base64 into conversation. Do not currently integrate Azure/OIDC, GitHub Environment, publisher, or certificate placeholder configuration. Retain `win.sign: false`. Use current electron-builder v27 configuration shape, without reviving deleted legacy fields.

Current order must be: fixed package contents → fuses/ASAR integrity → individually confirm portable/NSIS `NotSigned` → final SHA-256 → reverification. Do not modify artifacts after hashing. Only future public binaries switch to “signing → signature/timestamp/publisher verification → final SHA-256 → upload”. Self-signing is not trusted public signing, and a signature does not guarantee no SmartScreen warnings.

Add standard MIT LICENSE per the confirmed owner decision, with Jinxi Hu as copyright holder. Generate dependency/version/license/NOTICE inventories from package-lock and final artifacts; review exceptions, nested licenses, and required notices. Do not present tool output as comprehensive legal advice.

Add/complete THIRD_PARTY_NOTICES.txt, CHANGELOG.md, SECURITY.md, and Alpha Release Notes. Explain system/architecture, portable/NSIS, signing status, SHA-256 verification, core capabilities, limitations, no automatic updates/telemetry, local-document semantics, issue-reporting privacy, and downgrading.

Existing `v0.1.0-alpha.1` is a historical internal Draft tag. Do not move it or replace its attachments with current HEAD. Complete safe local engineering and docs while explicitly retaining “public MIT source; unsigned Windows binaries for internal experiments only”. Artifact Signing/OIDC, Windows 11, and public binaries are optional future work, not current blockers.

Run full check/build/package/verify/E2E, `NotSigned`/hash checks, and package-content review. Audit Git/logs for no credentials, absolute user paths, or private information. Finish by reporting actual signing level, hashes, licensing audit, historical Draft/public status, optional future items, real blockers, and whether WP7 passes. Do not start WP8.
```

### 2.9 WP8 execution prompt

```text
You are executing TASK-012 WP8 in the WenShu repository: overall acceptance, scope review, documentation, and completion report.

Current branch: [current branch]
Previous recovery point: [commit SHA]
Known user changes: [user changes or “none”]
Expected final level: MIT source release readiness complete; Windows 10 x64 unsigned internal Alpha engineering complete
Public Windows binary authorization: no
Optional future work: Windows 11; Microsoft Artifact Signing + GitHub OIDC; trusted signing and public binaries

Read the main prompt, full Task 12 plan, TASK_012_WP0_REPORT.md, all WP1–WP7 changes/recovery points/tests/artifacts/Windows/CI/signing/licensing evidence, and current README, PROJECT_BASELINE, DEVELOPMENT_ENVIRONMENT, TESTING, CHANGELOG, SECURITY, LICENSE/rights, NOTICE, and Release Notes in full. Check git status and preserve user changes.

The owner's 2026-09-08 scope revision overrides old planning gates in historical WP reports: Windows 11, trusted signing, and public binaries are explicitly optional future work. Historical reports retain contemporary evidence and are not rewritten to fabricate facts. WP8 explains in its completion report which old blockers were superseded by revised scope.

Add no product features in this package; fix only final-acceptance findings within Task 12. Check all 33 current-scope acceptance criteria in Task 12 section 11 individually. Every checkbox requires automated tests, package audit, final-artifact inspection, Windows 10 manual evidence, or `NotSigned`/hash/provenance evidence. Do not check items merely because configuration looks right, or replace current evidence with “optional future work”.

First confirm working-tree state and preserve user changes. Clean-install dependencies from current exact commit/lockfile, then actually run: typecheck, lint, format:check, all test, check, build, package:dir, package:win, package:verify, Electron E2E, final hardened-artifact black-box smoke, ASAR/fuse reads, package audit, portable/NSIS `NotSigned` verification, final SHA-256 generation/reverification, and release workflow dry-run. Record every exit code, test-file/case/skip count, artifact filename/bytes/hash/size, and residual processes. Confirm remote PR/push CI actually passed for the current commit; without remote evidence, leave the item pending truthfully rather than assuming green.

Rerun the Windows 10 x64 standard-user portable/NSIS installation, installation over existing version, uninstallation, Chinese/space-containing paths, unchanged external-workspace hashes, TXT/DOCX/backup/conflict/Recycle Bin/WPS/Word core matrix, and actual Defender/SmartScreen/Authenticode states. Do not fabricate platform evidence unavailable in the current environment. Explicitly record Windows 11 as optional future work and “no support claim”; neither check it as validated nor treat it as a current blocker.

Review all release-write paths, cleanup paths, workflow permissions, Action SHAs, caches, package allowlists, app.asar.unpacked, version/tags, `.only`, unconditional `.skip`, relaxed timeouts, weakened assertions, credential/environment-file/absolute-path/privacy leaks, and existing user changes.

Update README capabilities/unimplemented items/installation verification/Roadmap/docs/structure; PROJECT_BASELINE public-source/internal-binary baseline; DEVELOPMENT_ENVIRONMENT build/internal-verification/public-release distinctions; TESTING CI/package/E2E/Windows 10/`NotSigned` checklist; CHANGELOG, SECURITY, LICENSE, NOTICE, and Release Notes. Add docs/tasks/task-012/TASK_012_COMPLETION_REPORT.md with exact runtime/tool versions, packages, key files, identity/version, allowlist/dependencies, ASAR/fuses, E2E, artifacts/sizes/hashes, Windows 10 matrix, CI/permissions/attestation, `NotSigned`/no timestamp/no publisher/SmartScreen, licensing, limitations, optional future work, and final release level.

Only when all 33 current criteria have evidence may Task 12 be recorded as “MIT source release readiness complete; Windows 10 x64 unsigned internal Alpha engineering complete”. The final report must also state “Windows binaries not made public; Windows 11, Artifact Signing + GitHub OIDC, and trusted public binaries are optional future work”. Do not conclude “public Alpha released”. Real current-scope blockers retain unchecked items; optional future items are neither blockers nor completed items.

Do not push, create/move tags, create/replace/make public a Windows binary Release, establish Azure/OIDC, or read real signing credentials. Existing `v0.1.0-alpha.1` and historical Draft stay unchanged; current HEAD rebuilds serve local final verification only. If the owner separately authorizes a future new binary Draft/Release, use a new owner-approved version and exact tag, never reuse or move the old one.

Finish with final diff, command evidence, internal artifact paths, `NotSigned`/hashes, Windows 10/CI evidence, limitations, current blockers, optional future items, satisfied acceptance criteria, and final release level. Do not proceed to future Windows 11, signing, or public-release work.
```

---

## 3. Usage guidance

- For one Agent implementing end-to-end, use the complete main prompt in section 1, still
  requiring separate WP0–WP8 gate reports;
- For separate packages, use the relevant section 2 prompt and fill in branch, recovery point,
  user changes, and owner decisions;
- WP0 should be an independent recovery point; WP1 migration completes separately before
  packaging; WP3 completes unpacked before installers;
- WP5 currently requires real Windows 10 installation/uninstallation and WPS/Word evidence only;
  Windows 11 is an optional future matrix;
- The owner has settled MIT, public source, and unsigned-internal-binary scope; do not make them pending again;
- Git-tag creation, push, remote release-workflow start, Draft Release creation, and public
  Pre-release are different permission levels; each needs explicit current-task authorization;
- Current WP8 performs none of those external release actions; existing `v0.1.0-alpha.1` tag
  and historical Draft must not move or be replaced;
- At any time, credential/userData leakage in packages, installation/uninstallation modifying
  external workspaces, post-final-hash artifact changes, or Electron outside its support window
  must stop the current completion conclusion until the root cause is fixed.
