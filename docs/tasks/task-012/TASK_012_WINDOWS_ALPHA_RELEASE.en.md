# TASK-012: Windows Alpha Release Engineering

[简体中文](./TASK_012_WINDOWS_ALPHA_RELEASE.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

## Task status

> **Status: 33/33 current-scope items passed; MIT source release readiness complete; Windows 10
> x64 unsigned internal Alpha engineering complete.**
>
> Planned: 2026-08-27; scope revisions: 2026-09-08 and 2026-09-10. Task 1–11 completed the
> core product workflow, safe file writes, Windows manual final acceptance, and desktop-shell
> finishing. Task 12's current public deliverable is fixed as MIT source on GitHub. Windows 10
> x64 portable/NSIS outputs are unsigned internal experimental artifacts, not public downloads.
> Windows 11 acceptance, Microsoft Artifact Signing + GitHub OIDC, trusted publisher identity,
> and public binaries move to optional future work, outside current Task 12 completion gates.

Implementation can use the companion [TASK-012 development execution prompts](./TASK_012_DEVELOPMENT_PROMPT.en.md).

## 1. Purpose

Convert the current “Windows Pre-alpha that can be developed and built from source” into two
clearly bounded deliverables: MIT source publishable on GitHub, and unsigned internal Alpha
engineering reproducibly buildable from a fixed Git commit, auditable, and theoretically
compatible with Windows 10 x64. The owner's 2026-09-10 decision defers Windows 10 physical-machine
validation to a later development stage. This task does not publish Windows binaries or claim
completed Windows 10/11 physical-machine support, trusted publisher identity, or SmartScreen reputation.

Completion means more than “`electron-builder` exited with 0”; all of the following must be resolved:

1. Migrate Electron 37, whose official support ended, to a supported stable series;
2. Fix application identity, version, icons, installation, and artifact naming;
3. Package only files needed to run the product, without leaking source directories, test
   fixtures, logs, environment files, or screenshot user data;
4. Generate Windows x64 portable and current-user NSIS outputs;
5. Establish verification gates for package contents, ASAR, Electron fuses, launch, installation,
   upgrade, and uninstallation;
6. Establish Windows CI, unsigned-state verification, SHA-256, internal Draft rehearsals, and traceable evidence;
7. Preserve Task 1–11 path safety, save conflicts, DOCX backups, Recycle Bin, unsaved protection, and IPC boundaries.

## 2. Resulting user and maintainer experience

### 2.1 Source users and internal testers

- Source users can obtain MIT-licensed source, licensing, third-party notices, and build instructions on GitHub;
- Internal testers can use portable or installed outputs with explicit filenames, versions,
  and architectures, but must see “未签名、仅内部实验” (unsigned, internal experiments only);
- Internal outputs' theoretical Windows 10 x64 compatibility has been audited. Existing current-user
  installation results require no administrator privileges. Physical-machine validation is
  deferred; no measured Windows 10/11 support claim is made;
- “关于文枢” (About WenShu) and EXE properties show a version consistent with internal verification records;
- `SHA256SUMS.txt` verifies internal artifacts;
- Alpha limitations, signing state, SmartScreen expectations, and issue-reporting entry points are clear;
- Installing, upgrading, or uninstalling the application does not delete, move, or modify workspace documents.

### 2.2 Maintainers

- Repeatedly execute `check → build → package → verify` from a clean checkout and lockfile;
- PR/push runs only quality gates, without signing credentials or publication;
- Tag or manual release workflows can produce internal Draft artifacts from a single commit, without automatic publication;
- Artifact inventories, file hashes, Authenticode states, automated/manual acceptance, and known limitations have fixed records.

## 3. Pre-execution checks

### 3.1 Required reading

WP0 must read in full:

1. `README.md`;
2. `docs/architecture/PROJECT_BASELINE.md`;
3. `docs/development/DEVELOPMENT_ENVIRONMENT.md`;
4. `docs/development/TESTING.md`;
5. `docs/tasks/task-009/TASK_009_COMPLETION_REPORT.md` (file writes, Recycle Bin, Windows behavior);
6. `docs/tasks/task-010/TASK_010_COMPLETION_REPORT.md` (current DOCX search and save lifecycle);
7. `docs/tasks/task-011/TASK_011_UI_SHELL_INFORMATION_ARCHITECTURE.md`;
8. `docs/tasks/task-011/TASK_011_COMPLETION_REPORT.md`;
9. `package.json`, `package-lock.json`, `.node-version`, `.gitignore`;
10. `electron.vite.config.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/desktop-api.ts`;
11. All new files concerning packaging tools, CI, signing, E2E, and versions.

Implementation must also check official documentation matching pinned versions for Electron,
electron-vite, electron-builder, Playwright, GitHub Actions, and Microsoft Authenticode state
verification. Do not use outdated blog configuration or unverified snippets. Recheck Artifact
Signing documentation only when future public-binary work starts.

### 3.2 Current baseline

Confirmed at planning time:

- Actual Electron is `37.10.3`, outside Electron's policy of supporting the latest three stable major versions;
- Development runtime Node.js `22.15.0` / npm `10.9.2` meets electron-builder v27's Node.js `>=22.12.0` baseline;
- `check`: 69 test files, 1175 passed / 10 conditional skips;
- `build`: main/preload/renderer build successfully;
- No `electron-builder`, `.github/workflows/`, release icons, LICENSE, CHANGELOG, SECURITY, or third-party NOTICE yet;
- External runtime dependencies of `out/main/index.js` include `jszip`, `mammoth`, and `docx`;
- Renderer React, CodeMirror, and Tiptap are bundled, but all are currently declared as production
  dependencies, risking duplicate copies in packaging;
- `out/.capture-user-data/` may contain extensive Electron screenshot-session data and must be
  excluded through a package-content allowlist;
- Local validation host is Windows x64. Original planning covered Windows 10/11; the 2026-09-08
  revision restricted current gates to Windows 10 x64 and made Windows 11 optional future work.
  On 2026-09-10, the Windows 10 physical-machine matrix was also deferred and the current gate
  became a theoretical compatibility audit.

### 3.3 WP0 must measure again

- Initial branch, Git working tree, and existing user changes;
- Full `check`, `build`, and development/production Electron launch smoke;
- That day's supported Electron series, latest patch on the middle stable series, and EOL dates;
- Candidate Electron's Windows 10 x64 support and breaking changes; recheck Windows 11 when that future work starts;
- Candidate electron-builder version, Node requirements, NSIS/portable, fuses, ASAR integrity, and signing-configuration shape;
- Current production bundle external dependencies, licenses, sizes, and native-module presence;
- Playwright Electron support for candidate Electron, native-dialog replacement approach, and fuse restrictions;
- Download, cache, permission, and release conditions locally and on GitHub Windows runners.

### 3.4 Official reference entry points for implementation

These are WP0 starting points, not permanent version decisions. At implementation, use official
documentation and migration notes matching pinned versions:

- [Electron release schedule and EOL](https://releases.electronjs.org/schedule);
- [Current Electron stable releases](https://releases.electronjs.org/);
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security);
- [Electron ASAR Integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity);
- [electron-vite production build](https://electron-vite.org/guide/build);
- [electron-vite distribution guide](https://electron-vite.org/guide/distribution.html);
- [electron-builder Windows configuration](https://www.electron.build/docs/win/);
- [electron-builder NSIS / portable](https://www.electron.build/docs/nsis/);
- [electron-builder Electron fuses](https://www.electron.build/docs/tutorials/adding-electron-fuses/);
- [electron-builder Windows code signing](https://www.electron.build/docs/features/code-signing/code-signing-win/);
- [Electron Playwright testing guide](https://www.electronjs.org/docs/latest/tutorial/automated-testing);
- [Playwright Electron API](https://playwright.dev/docs/api/class-electron);
- [GitHub Release management](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository);
- [GitHub Artifact Attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations);
- [Microsoft SmartScreen application reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

## 4. Fixed product and release decisions

### 4.1 Version, tag, and single version source

- First Alpha version is fixed at `0.1.0-alpha.1`;
- Git tag is fixed at `v0.1.0-alpha.1`;
- `package.json.version` is the only manually maintained product-version source;
- Automatically verify consistency across About, EXE version resources, installer, artifact
  names, Git tag, and Release title;
- The release workflow must not use temporary CLI overrides to generate a version differing
  from committed `package.json`.

Existing `v0.1.0-alpha.1` is a historical internal Draft tag predating WP7 licensing/NOTICE
changes. Do not move it or represent current HEAD's local outputs as its artifacts. WP8
portable/NSIS rebuilds from current HEAD are solely local final-verification outputs. Future
upload of a new binary Draft or Release first requires an owner-approved new version and exact tag.

### 4.2 Application identity and naming

Fixed for the first release:

| Property                         | Value                                      |
| -------------------------------- | ------------------------------------------ |
| `appId`                          | `io.github.ravenhu001.wenshu`              |
| `productName`                    | `文枢`                                     |
| executable name                  | `WenShu`                                   |
| Current internal target platform | Windows 10 x64 (theoretical compatibility) |
| Architecture                     | x64                                        |
| Installation scope               | Current user (per-user)                    |

After the first externally delivered artifact, `appId` becomes a persistent identity and must
not change casually to fix installation paths or naming. Current public source uses that
project identity. Before future public binaries, the owner must still confirm the release
account and signing-publisher identity.

### 4.3 Target artifacts

Internal engineering generates only Windows x64:

```text
WenShu-0.1.0-alpha.1-win-x64-portable.exe
WenShu-0.1.0-alpha.1-win-x64-setup.exe
SHA256SUMS.txt
THIRD_PARTY_NOTICES.txt
```

- Portable is for internal experiments without installation;
- NSIS installs for the current user, without proactively requesting administrator privileges;
- The first release generates no ia32, ARM64, MSI, MSIX, AppX, web installer, or combined multi-architecture package;
- Artifact filenames use ASCII; UI and Windows display names retain “文枢”.

### 4.4 Electron migration decision

- Do not generate final Alpha outputs with Electron 37;
- WP0 must select the latest patch of the middle series among that day's latest three stable series;
- The 2026-08-27 planning reference is the latest Electron 43 patch, not newly stable 44.0.0;
- Record and pin the final exact version in the WP0 report;
- If the support window changes by implementation, update this section and WP0 decisions first,
  rather than mechanically installing an outdated version;
- Separate major Electron migration and release packaging gates: no packaging implementation
  until migration regressions pass.

### 4.5 Current release level and optional future signing

Current Task 12 scope is fixed as:

1. **Public deliverables**: MIT source, licensing, and project documentation on GitHub;
2. **Internal engineering deliverables**: Windows 10 x64 portable/NSIS, expected Authenticode
   state `NotSigned`, prominently labeled “未签名，仅内部实验” (unsigned, internal experiments
   only), never public downloads;
3. **Optional future work**: Windows 11 acceptance, Microsoft Artifact Signing + GitHub OIDC,
   trusted-signature verification, timestamps, publisher identity, public Pre-release/Release,
   and public Windows binaries.

Do not currently create Azure resources, OIDC federated credentials, or signing secrets, or list
them as Task 12 blockers. Even future self-signed certificates for test pipelines cannot be
described as “trusted by Windows.” Trusted-signing work starts only after separate future owner
approval of public binaries, restoring this gate order: package contents → fuses/ASAR integrity
→ signing → signature/timestamp/publisher verification → SHA-256 → upload.

### 4.6 No automatic updates

- Do not introduce `electron-updater`, update services, differential packages, or startup update checks;
- Internal Alpha updates use new installers or portable outputs through controlled channels;
  binary updates are not provided to the public now;
- Signing, appId, version, and NSIS installation identity must provide a stable future-update
  foundation, but Task 12 does not perform network updates.

## 5. Build, package-content, and application-identity invariants

### 5.1 Build-stage separation

```text
source + package-lock
  -> npm ci
  -> typecheck / lint / format:check / vitest
  -> electron-vite build (out/)
  -> electron-builder unpacked
  -> package content audit + packaged smoke
  -> portable / NSIS
  -> fuses / ASAR integrity verification
  -> verify Authenticode is NotSigned (current internal scope)
  -> SHA-256
  -> local/internal workflow artifact or Draft rehearsal
```

Current hashes must be calculated from final bytes after `NotSigned` verification, with no
subsequent artifact modifications. A future trusted-signing workflow must calculate final
SHA-256 after signing and verification, without any further modification of signed files.

### 5.2 electron-builder configuration

Use separate `electron-builder.yml`, rather than placing extensive release configuration in
`package.json`. Configuration must:

- Explicitly specify `appId`, `productName`, `executableName`, `directories.output`, and `directories.buildResources`;
- Explicitly specify x64 `portable` and `nsis` targets;
- Use artifact-name templates including product, version, platform, architecture, and target;
- Use ASAR; do not disable integrity for “easier inspection”;
- Avoid implicit publish; a separate workflow must explicitly execute publication;
- Validate configuration changes through schema validation or electron-builder's own validation,
  not unknown fields that are silently ignored.

### 5.3 Package-content allowlist

Start from an allowed set, rather than adding a few exclusions over broad defaults. The allowed
set must at least include:

- `out/main/**`;
- `out/preload/**`;
- `out/renderer/**`;
- `package.json` metadata required for packaged execution;
- Necessary unbundled main-process production dependencies and their runtime dependencies.

Deterministically prove absence of:

- `src/`, `tests/`, `docs/`, `scripts/`, `.git/`, `.github/`, `.agents/`, `.codex/`;
- `.tools/`, `coverage/`, `.vite/`, logs, `*.tsbuildinfo`, `.env*`;
- `docs/visual-baselines/`, DOCX test fixtures, temporary workspaces;
- `out/.capture-user-data/` or any Chromium/Electron user-data;
- Signing certificates, passwords, tokens, absolute build-machine paths, or private documents.

### 5.4 Dependencies and package size

- Include `jszip`, `mammoth`, and `docx` as external main-process runtime dependencies;
- For React, CodeMirror, Tiptap, and other dependencies fully bundled into the renderer, use
  measured electron-vite outputs to move them into `devDependencies` or otherwise deterministically prevent duplication;
- Do not incorrectly move real runtime dependencies into `devDependencies` merely to shrink package size;
- Reproduce from `npm ci` after clearing packaging directories, without local phantom dependencies;
- Record unpacked, portable, NSIS, `app.asar`, and `app.asar.unpacked` sizes;
- If size grows unexpectedly, audit file inventories rather than raising limits.

### 5.5 Version and About

- UI shows product version and Alpha designation, rather than generic “Pre-alpha” alone;
- Version values must not come from user-controlled environment variables;
- Development and packaged About versions must both match `package.json.version`;
- If IPC is added to read `app.getVersion()`, it may only be a parameterless, read-only,
  exact-shape runtime-info protocol, exposing no arbitrary app/path/process capabilities.
  Build-time constants require consistency tests if used instead.

## 6. Installation, runtime, and security boundaries

### 6.1 Fixed NSIS semantics

- Current-user installation without elevation by default;
- An assisted installer with visible steps, not silent implicit installation as the first Alpha default;
- Installation locations and shortcuts must not be written into the user workspace;
- Installation over an existing version or upgrade uses the same appId and installation identity;
- Uninstallation removes only application/installer-owned resources, never arbitrary external TXT/DOCX workspaces;
- Retention of user-data directories must have explicit, testable semantics. There is no session
  recovery now; do not claim workspace sessions are retained.

### 6.2 Fixed portable semantics

- Portable installs no shortcuts, registers no file associations, and requires no administrator privileges;
- Portable does not promise all runtime state resides beside the EXE; record measured Chromium userData semantics;
- Portable and installed variants must have identical workspace read/write, backup, conflict, and Recycle Bin semantics.

### 6.3 ASAR and Electron fuses

After verification with candidate Electron and electron-builder, fix at least:

- `runAsNode: false`;
- `enableNodeOptionsEnvironmentVariable: false`;
- `enableEmbeddedAsarIntegrityValidation: true`;
- `onlyLoadAppFromAsar: true`;
- For every other fuse, record product reasons for enabled/disabled/default retained, rather than
  copying an unsuitable template.

Verify `enableNodeCliInspectArguments` together with Playwright Electron's connection mechanism.
Prefer disabling it in final release outputs. If disabled fuses prevent Playwright from driving
final binaries, separate “drivable unpacked E2E” from “hardened final-artifact black-box smoke”;
do not weaken public artifacts by default for test convenience.

The renderer currently uses `BrowserWindow.loadFile()`. Do not disable every file-protocol-related
fuse without verification. Migration from `file://` to a custom protocol can be planned separately;
do not break production launch to achieve an “all on/all off” checklist.

### 6.4 Existing security baseline must not regress

- `nodeIntegration: false`;
- `contextIsolation: true`;
- `sandbox: true`;
- Reject web permission requests, new windows, and unexpected navigation;
- Preload exposes only fixed narrow APIs, never `ipcRenderer`, `process`, paths, shell, or generic invoke;
- Main-process IPC continues validating sender, exact argument shapes, and workspace boundaries;
- Add no general filesystem, PowerShell, or external-URL invocation entry point to packaging/release scripts;
- Logs contain no document content, queries, replacement text, absolute user paths, certificates,
  tokens, or signing-command-line passwords.

### 6.5 Signing order and credentials

- Current order: fixed package contents → fuses/ASAR integrity → confirm portable/NSIS both
  `NotSigned` → SHA-256;
- Current `win.sign: false` is intentional internal scope; configure no Azure/OIDC, certificates,
  or placeholder publisher values;
- When future public binaries are approved, first evaluate Microsoft Artifact Signing + GitHub
  OIDC, using only the then-supported electron-builder v27 `win.sign` shape, without reviving removed fields;
- Future key material/passwords reside only in controlled certificate stores, cloud signing
  identities, or GitHub Environments/Secrets;
- Fork/PR workflows must not receive signing credentials;
- Record actual Authenticode state for every EXE; current expectation is `NotSigned`, no publisher, no timestamp;
- Signed does not mean immediate freedom from SmartScreen warnings. README/Release Notes must
  not promise reputation outcomes that cannot be guaranteed.

## 7. CI, artifacts, and GitHub Release

### 7.1 PR/push CI

Add `.github/workflows/ci.yml`, at minimum:

- Run on `windows-latest` or a Windows runner fixed by WP0;
- Use the exact Node.js version in `.node-version`;
- Use `npm ci`, not install commands that modify the lockfile;
- Run `check`, `build`, and Electron E2E requiring no signing credentials;
- Cache only npm downloads, never restore `node_modules/`, `out/`, or packaging directories
  across commits as trusted inputs;
- Default to `permissions: contents: read`;
- No publication, signing, or production credentials.

### 7.2 Release workflow

Add `.github/workflows/release.yml` with fixed behavior:

- Trigger only through manual `workflow_dispatch` or a `v*` tag matching `package.json.version`;
- Rerun `npm ci`, `check`, `build`, package, and verify from the single commit referenced by the tag;
- GitHub Environment, OIDC, and manual approval belong to future public-release/signing steps;
  do not integrate those permissions now;
- Minimize permissions per job; only the Draft Release upload job may receive `contents: write`;
- Do not mix signed and unsigned outputs under identical filenames in one release;
- Generate `SHA256SUMS.txt` and reverify from disk before upload;
- Internal Drafts are workflow rehearsals, not automatically public. Current source updates do
  not move historical Draft tags or replace their attachments;
- The workflow never automatically changes a Draft into a public Release. Public binaries are
  explicitly prohibited in current scope.

### 7.3 Third-party Actions and dependency security

- Prefer GitHub official Actions such as `checkout`, `setup-node`, `upload-artifact`, and `attest`;
- Pin third-party Actions in release workflows to full commit SHAs, retaining readable versions in comments;
- Record permissions, maintainer, version, purpose, and alternatives for every new Action;
- If repository/plan eligibility permits, generate artifact attestations for public binaries;
  otherwise document the actual limitation in the completion report without fabricating provenance success.

### 7.4 Release Notes

Internal Alpha records must contain:

- Version, exact commit SHA, build date, Windows, and architecture; any tag must match the commit exactly;
- Portable/NSIS purposes and installation/uninstallation steps;
- Signing publisher or a prominent “未签名内部 Alpha” (unsigned internal Alpha) statement;
- SHA-256 verification instructions;
- Core capabilities and known limitations;
- Current local-document-storage, no-telemetry/no-automatic-update boundaries;
- Issue-reporting entry points and privacy reminders for logs;
- Downgrade instructions: download a previous artifact without rolling back, replacing, or
  deleting workspace documents.

## 8. Testing and acceptance requirements

### 8.1 Full Task 1–11 regressions

Every work package changing Electron, electron-vite, dependency classification, main entry,
preload, BrowserWindow, CSP, IPC, or artifact layout must:

- Run relevant targeted tests;
- Run full `typecheck`, `lint`, `format:check`, `test`, `check`, and `build`;
- Record test-file, passed, failed, skipped counts and skip reasons;
- Never delete, relax, or unconditionally skip Task 1–11 security/lifecycle assertions.

### 8.2 Runtime migration tests

- Development mode and production `loadFile()` both show the main window;
- `app.isPackaged` branches behave correctly;
- BrowserWindow security settings and permission rejection are unchanged;
- Chinese input, clipboard, native dialogs, Recycle Bin, and reveal-in-Explorer work;
- TXT/DOCX reading, saving, backups, conflicts, external locks, and WPS/Word round trips do not regress;
- About shows correct Electron and Node runtime versions without exposing build-machine paths.

### 8.3 Package-content audit tests

Add a script repeatable locally and in CI, asserting at least:

- Application entry, renderer HTML/CSS/JS, and external main-process dependencies exist;
- Packaged `package.json` has correct name, version, and main entry;
- Prohibited directories and file types are absent;
- No `.env`, PEM/PFX/P12, token patterns, test content, user paths, or `.capture-user-data`;
- ASAR parses, integrity metadata exists, and prohibited files are not hidden in `app.asar.unpacked`;
- Portable/NSIS filenames, versions, architectures, and sizes are within reasonable bounds;
- Release artifact SHA-256 exactly matches `SHA256SUMS.txt`.

### 8.4 Playwright Electron E2E

Use dedicated `tests/e2e/` and isolated temporary workspace/user-data directories, covering:

- Launch and wait for the main window;
- Simulate `dialog.showOpenDialog()` through controlled main-process replacement, not coordinate clicks on OS dialogs;
- Open a temporary workspace and TXT, edit/save, reread, and verify disk bytes;
- Open a basic DOCX, modify/save, and verify valid OOXML and backup;
- Dirty-close cancellation/discard and blocking while saving;
- About product version, Electron version, and Alpha designation;
- No unhandled exceptions in windows/main process, and no document-content/absolute-path logs;
- No residual Electron processes or temporary workspaces after tests.

Playwright Electron has explicit limitations for native dialogs and certain hardened fuses.
Anything not stably drivable in final hardened outputs must be covered jointly by automated
package/fuse checks, black-box launch smoke, and Windows manual acceptance. Do not fabricate
“full E2E of final binaries.”

### 8.5 Final-artifact black-box smoke

Verify unpacked, portable, and NSIS-installed outputs separately:

- Real artifact EXE starts and remains stable;
- Main-window title, process name, icon, and About version are correct;
- No dependence on project `.tools/`, global Node.js, npm, or source directories;
- After independent userData use and termination, no crash, main-process JavaScript-error dialog,
  or residual process;
- Still runs with the source repository moved away or from a temporary directory;
- Final artifacts are the same bytes as the signature-verified/hashed files.

### 8.6 Windows installation, upgrade, and uninstallation

On 2026-09-10, the owner deferred the Windows 10 x64 physical-machine matrix to later development;
the current gate is a theoretical backward-compatibility audit of final packages. Existing
manual/automated results below remain installation/data-safety evidence but must not masquerade
as Windows 10 physical-machine validation. The Windows 11 matrix is also optional future work;
without execution, make no Windows 11 support claim:

- Portable launches from ordinary directories, Chinese-character directories, and paths with spaces;
- NSIS requires no administrator; installation path, Start menu, and uninstall entry are correct;
- Same-version reinstall and test `alpha.0-test → alpha.1` installation over the old version retain stable appId;
- External workspace bytes and directory structure established before installation remain
  unchanged after installation, upgrade, and uninstallation;
- Both installed and portable versions complete TXT/DOCX opening, editing, saving, backups,
  conflicts, and Recycle Bin restoration;
- Use WPS or Word with release artifacts for basic bidirectional DOCX round trips;
- Uninstallation leaves no application processes, shortcuts, or installation directories
  (except userData permitted by fixed NSIS semantics);
- Record actual Defender, SmartScreen, and Authenticode state. Do not generalize local lack of
  prompts to all users; Smart App Control is recorded only in a future Windows 11 matrix.

### 8.7 Signatures, hashes, and provenance

- Verify current portable/NSIS individually as `NotSigned`; documentation cannot claim trusted
  publishers or timestamps;
- Generate final SHA-256 only after package contents, fuses/ASAR integrity, and `NotSigned` are confirmed;
- Do not modify EXEs after hashing;
- Generate `SHA256SUMS.txt` from final artifacts and obtain consistent local/post-download verification;
- If internal workflows generate artifact attestations, verify correct repository, workflow,
  commit, and artifacts; truthfully document lack of support;
- Only future public binaries require pre/post-signing byte changes, trusted Authenticode,
  timestamps, exact publisher matching, and post-signing SHA-256. Unconfigured Artifact Signing/OIDC is not a current blocker.

### 8.8 Licensing, NOTICE, and privacy

- The owner selected MIT License, copyright line `Copyright (c) 2026 Jinxi Hu`;
- Generate a third-party dependency/version/license inventory consistent with the lockfile;
- Review how artifacts carry required copyright/NOTICE for dependencies;
- Do not present one `npm ls` output as a legal audit; record manual exceptions and unresolved items;
- Release Notes state current no telemetry, no automatic document upload, no automatic updates;
- User issue submissions should not include private documents, absolute paths, or unredacted logs.

## 9. Explicitly outside this task

- Windows 11 acceptance or support claims;
- Microsoft Artifact Signing + GitHub OIDC, other trusted-signing backends, and public Windows binaries;
- Automatic, differential, forced updates or update services;
- Microsoft Store, MSIX, MSI, AppX, Squirrel, or web installer;
- ARM64, ia32, universal multi-architecture installers;
- macOS/Linux packaging, signing, or publication;
- `.txt` / `.docx` file associations, double-click opening, custom URL protocols, or context-menu Shell extensions;
- Crash collection, telemetry, behavior analytics, or remote logging;
- Filesystem watching, session recovery, autosave, settings, themes, or new editor features;
- Changing Task 9 file-write/Recycle Bin semantics, Task 10 find/replace semantics, or Task 11 information architecture;
- Brand registration, trademark legal advice, commercial licensing/pricing, or an official website;
- Promising fully lossless Word round trips or enterprise deployment support.

## 10. Work packages and execution order

Execute WP0 through WP8 in order. Each package must pass targeted tests and its own gate before
the next starts. Do not debug NSIS, signing, and CI simultaneously while runtime migration is unstable.

### WP0: Fix baseline, runtime, identity, and release semantics

- Perform every prerequisite in section 3;
- Pin Electron, electron-builder, Playwright, and GitHub Action versions;
- Confirm appId, version, x64, portable/NSIS, per-user, `NotSigned`, and public MIT-source boundaries;
- Establish dependency/license, bundle, size, launch, and Windows baselines;
- Add `docs/tasks/task-012/TASK_012_WP0_REPORT.md`.

Gate: no unresolved identity, version, architecture, target, runtime, or current public-source/internal-binary boundary.

### WP1: Migrate to a supported Electron runtime

- Upgrade Electron separately, plus direct compatible dependencies required for building;
- Make minimal main/preload/renderer compatibility fixes from official breaking changes;
- Run all automated gates, development/production launch, native Windows capabilities, and WPS/Word smoke;
- Introduce no new product features beyond packaging configuration or release UI.

Gate: full Task 1–11 baseline restored on supported Electron; any security or file-data regression blocks WP2.

### WP2: Application identity, version, icons, and About

- Add release icons and `build/` resource structure;
- Fix metadata, appId, product/executable names, and version mapping;
- About displays product version and Alpha designation;
- Add version-consistency, icon-existence, and metadata tests;
- Add owner-selected MIT License (Copyright 2026 Jinxi Hu).

Gate: development/build About, package version, and release-configuration identity agree; icon provenance/rights are traceable.

### WP3: electron-builder, artifact allowlist, and dependency reduction

- Add exact electron-builder dependency, `electron-builder.yml`, and local package scripts;
- Generate unpacked first, settle package allowlist and runtime dependencies;
- Add package audit scripts and prohibited-file tests;
- Then generate x64 portable and per-user NSIS;
- Record artifact sizes, file inventories, and dependency composition.

Gate: all three output types launch; necessary dependencies complete; prohibited directories,
private data, and development tools absent.

### WP4: ASAR, fuses, package verification, and Electron E2E

- Enable/verify ASAR integrity and project-appropriate Electron fuses;
- Implement Playwright Electron E2E for a drivable unpacked build;
- Implement final hardened-artifact black-box launch, fuse reading, package integrity, and process-cleanup verification;
- Cover minimal TXT/DOCX, save/backup, dirty-close, and About-version E2E;
- Expose no generic product test IPC or arbitrary-path capability for E2E.

Gate: actual records define automated-E2E/final-artifact-smoke boundaries; hardened artifacts
launch without disabling security gates merely to pass tests.

### WP5: Windows installation, upgrade, uninstallation, and real-document acceptance

- Execute unpacked/portable/NSIS matrices in 8.5 and 8.6;
- Use privacy-safe temporary workspaces to verify Chinese/space-containing paths, Recycle Bin,
  external locking, and WPS/Word;
- Verify installation/installation over existing version/uninstallation leave external workspaces unchanged;
- Record startup/installation timings, sizes, residual processes, and actual SmartScreen/Defender behavior.

Gate: Windows 10 x64 installation lifecycle and Task 1–11 core document operations pass. Any
loss/modification of workspace data stops release. Windows 11 is outside current gates and cannot
be claimed supported.

This gate is WP5's historical plan. The owner's 2026-09-10 decision deferred the Windows 10
physical-machine matrix; WP8 does not fabricate WP5 evidence retroactively and instead closes
against the current theoretical compatibility gate in 11.3.

### WP6: Windows CI, release workflow, and provenance evidence

- Implement PR/push CI and a separate release workflow;
- Complete version/tag consistency, clean builds, artifact upload, SHA-256, and Draft Pre-release;
- Audit Action versions, permissions, caches, and artifact-retention policies;
- Add artifact attestation if conditions permit;
- Verify complete CI structure with unsigned test outputs; do not publish without approval.

Gate: release workflow reproducibly generates internal Draft artifacts from a version-matching
exact tag; PRs cannot access signing/release permissions. Historical tags must not move, and
current HEAD need not receive a new tag.

### WP7: Signing boundaries, licensing, and Alpha release documentation

- Implement the owner's current unsigned internal scope without accepting/configuring plaintext credentials;
- Verify portable/NSIS both `NotSigned`, then generate final hashes and reverify;
- Generate project license, `THIRD_PARTY_NOTICES.txt`, `CHANGELOG.md`, `SECURITY.md`, and Alpha notes;
- Record historical Draft exact tag/commit boundaries, without moving tags or presenting current
  HEAD artifacts as old-tag outputs;
- Explicitly retain Artifact Signing + GitHub OIDC and public binaries as optional future work.

Gate: every unsigned-state, licensing, public-source, and nonpublic-binary claim has verifiable
evidence; no credentials in repository, logs, or artifacts.

### WP8: Overall acceptance, scope review, documentation, and completion report

- Review all WP0–WP7 commits, artifacts, tests, Windows evidence, Authenticode states, hashes, licenses, and CI;
- Actually run final `check`, `build`, package, verify, and release rehearsal from a clean checkout;
- Check `.only`, unconditional `.skip`, relaxed timeouts, weakened assertions, key/absolute-path/privacy leaks, and artifact contamination;
- Decide from evidence whether “MIT source release readiness complete; Windows 10 x64 unsigned
  internal Alpha engineering complete” or real blockers remain;
- Update README, PROJECT_BASELINE, DEVELOPMENT_ENVIRONMENT, TESTING, and Roadmap;
- Add `docs/tasks/task-012/TASK_012_COMPLETION_REPORT.md`, recording exact versions, artifacts,
  commands, `NotSigned`, hashes, CI, Windows 10 matrix, limitations, and release conclusion.

Gate: every current-scope section 11 checkbox rests on automated tests, package audits,
theoretical compatibility, existing manual results, unsigned/hash/provenance evidence. Future
Windows 10 physical-machine matrix, Windows 11, signing, and public binaries are neither
misrepresented as complete nor blockers to the current conclusion.

## 11. Final acceptance criteria

Every checkbox requires actual evidence; a configuration file that “looks right” is insufficient.

### 11.1 Runtime and regressions

- [x] Final artifacts use an exact stable Electron version still officially supported at release time;
- [x] After migration, all Task 1–11 automated tests, `check`, and `build` pass;
- [x] Development, production build, unpacked, portable, and NSIS-installed outputs all launch;
- [x] BrowserWindow, preload, IPC, permissions, navigation, and sandbox security baseline does not regress;
- [x] No regression in TXT/DOCX, backups, conflicts, Recycle Bin, unsaved protection, and WPS/Word round trips.

### 11.2 Identity, packaging, and artifacts

- [x] appId, productName, executable name, version, About, and EXE agree; any tag/Draft has a strictly matching commit/version;
- [x] Icons are clear, traceable, and correct in files, taskbar, installer, and uninstall entry;
- [x] Reproducibly generate Windows x64 portable/NSIS with fixed naming;
- [x] Artifacts contain complete runtime dependencies without source repository, `.tools/`, global Node.js, or npm dependence;
- [x] Automated package allowlist verification finds no source directories, tests, logs, `.env`, credentials, private fixtures, or userData;
- [x] ASAR, integrity, and all fixed fuses have been read and verified from final artifacts;
- [x] Artifact sizes, file composition, `app.asar.unpacked`, and dependency duplicates have audit records.

### 11.3 Installation, upgrade, and uninstallation

- [x] Final portable/NSIS theoretical Windows 10 x64 compatibility audit passes; physical-machine
      validation is deferred without a completed-validation claim; no Windows 11 support claim;
- [x] Per-user NSIS requires no administrator by default, with explicit installation/reinstallation/upgrade/uninstallation semantics;
- [x] Acceptance passes for Chinese paths, paths with spaces, standard-user directories, and Start menu entries;
- [x] Installation, upgrade, uninstallation, and switching portable versions do not modify/delete external workspaces;
- [x] No unexpected Electron processes, shortcuts, or installation directories remain after exit/uninstallation;
- [x] Actual Defender, SmartScreen, and Authenticode behavior is recorded; Smart App Control awaits
      the optional Windows 11 matrix, with no overstated wording.

### 11.4 CI, signing, hashes, and release

- [x] PR/push CI runs `npm ci`, `check`, `build`, and defined E2E from a clean checkout;
- [x] PR/fork has no signing, Release write, or other production-credential permissions;
- [x] Release workflow validates tag/version/commit and rebuilds rather than reusing unknown-origin artifacts;
- [x] Internal artifact records contain exact commit, SHA-256, `NotSigned`, system requirements,
      known limitations, and verification instructions; any Draft matches its exact tag;
- [x] Portable/NSIS both verified `NotSigned`, without trusted-publisher, timestamp, or public-binary claims;
- [x] SHA-256 generated after final `NotSigned` confirmation matches subsequent reverification;
- [x] If artifact attestation is supported, provenance verification succeeds; otherwise the real reason is recorded;
- [x] No Windows binary Release currently created or made public; historical internal Draft not incorrectly updated/published.

### 11.5 Licensing, documentation, and quality

- [x] Owner selected the project's own license, which is correctly included;
- [x] Third-party dependencies, versions, licenses, and NOTICE match lockfile/artifacts;
- [x] `README`, `PROJECT_BASELINE`, `DEVELOPMENT_ENVIRONMENT`, `TESTING`, `CHANGELOG`, and `SECURITY` match the actual Alpha;
- [x] No claims of unimplemented automatic updates, telemetry, session recovery, file associations, or multiplatform support;
- [x] No `.only`, new unconditional `.skip`, weakened assertions, timeout masking, credential/privacy/absolute-path leakage;
- [x] `TASK_012_WP0_REPORT.md` and `TASK_012_COMPLETION_REPORT.md` contain reviewable commands,
      versions, artifacts, tests, Windows, signing, and release evidence;
- [x] Final conclusion is “MIT source release readiness complete; Windows 10 x64 unsigned internal
      Alpha engineering complete” or real blockers are recorded, with explicit absence of public Alpha binaries.

## 12. Failure handling and decision rules

- Candidate Electron unsupported officially: do not package; reselect and update WP0 decisions;
- Migration breaks Task 1–11 semantics: stop at WP1, repair or select another supported series;
- Packaged module missing: do not evade with broad `**/*`; investigate externalized dependencies and allowlist;
- Prohibited files/userData in package: release blocker; discard artifact and repair rules/tests;
- Fuses/ASAR integrity prevent production launch: first check official versions and project
  file/load semantics; do not blindly disable all hardening;
- Playwright cannot drive hardened EXE: retain drivable unpacked E2E, use black-box smoke/manual
  checklist for final artifacts, and state limitations;
- Future Windows 10 physical-machine validation fails: stop measured-support claims and fix,
  without fabricating the current theoretical audit retroactively; keep no Windows 11 support
  claim while unverified;
- Installation/uninstallation touches external workspace: stop release immediately, preserve
  the scene, and do not retry destructive workflows;
- Artifact Signing/OIDC absent: not a current blocker; retain `NotSigned`/internal scope, with
  no public binaries without new authorization;
- SmartScreen still warns: verify signature/publisher and record truthfully; do not evade through
  self-signing, certificate changes, or misleading wording;
- CI/local artifacts differ: check commit, lockfile, Node/Electron/builder versions, environment,
  and package inventory; do not casually accept differences;
- MIT/NOTICE inconsistent or missing: block source-release-readiness completion, repair and reaudit first.

## 13. Shared rules for actual development execution

1. Before each WP, report branch, working tree, prior recovery point, user changes, package scope,
   and verification checklist;
2. Read this task, WP0 report, preceding WP outputs, and directly relevant source/tests first;
3. Use only that day's official documentation for changeable Electron, builder, Playwright,
   GitHub Actions, signing, and other tools;
4. Before adding dependencies, record exact version, license, maintenance status, download size,
   artifact impact, security exposure, and alternatives;
5. Implement runtime upgrades, packaging, E2E, CI, signing, and docs in separate packages; do
   not prematurely declare final success across packages;
6. Each package runs targeted tests, then full `check` / `build`; package-related WPs also run package / verify;
7. Use separate validated directories for temporary workspaces, userData, certificates, and
   release outputs; never recursively delete the repository root;
8. Do not modify, delete, or commit unrelated user changes;
9. Do not log document content, absolute user paths, signing credentials, or private fixtures;
10. Check section 11 only with complete evidence. Missing current-scope external evidence must
    remain explicitly incomplete; future Azure/OIDC or Windows 11 conditions are not current blockers.

## 14. Deliverables

### Must add or complete

- `docs/tasks/task-012/TASK_012_WP0_REPORT.md`;
- `docs/tasks/task-012/TASK_012_COMPLETION_REPORT.md`;
- `electron-builder.yml`;
- `build/icon.ico` and necessary Windows build resources with traceable rights;
- `.github/workflows/ci.yml`;
- `.github/workflows/release.yml`;
- Package/verify/SHA-256/Authenticode-state-verification scripts;
- Playwright Electron E2E configuration/tests;
- `CHANGELOG.md`;
- `SECURITY.md`;
- MIT `LICENSE` (Copyright 2026 Jinxi Hu);
- `THIRD_PARTY_NOTICES.txt`;
- Local x64 portable, NSIS, `SHA256SUMS.txt`, and internal verification records; historical Draft
  only as existing workflow evidence;
- README, PROJECT_BASELINE, DEVELOPMENT_ENVIRONMENT, TESTING, and Roadmap updates.

### Allowed modifications

- `package.json` / `package-lock.json`;
- `.gitignore`;
- `src/main/index.ts`, `src/preload/index.ts`, `src/shared/desktop-api.ts`, About component and related tests;
- Minimal product code directly relevant to Electron migration;
- Build, package-audit, E2E, CI, signing, and release documentation.

## 15. Next-task entry points after completion

After Task 12, prefer separately planning these directions, without expanding this task:

1. Windows 11 x64 installation, upgrade, uninstallation, document semantics, and security-policy matrix;
2. If the owner chooses public Windows binaries, integrate Microsoft Artifact Signing + GitHub
   OIDC, trusted verification, timestamps, publisher, post-signing SHA-256, and explicitly
   approved GitHub Pre-release;
3. Filesystem watching, external-change notices, and safe refresh;
4. Workspace/tab session recovery, basic settings, and themes;
5. Manual-update experience after Alpha and a future automatic-update threat model;
6. Native Windows ARM64 builds and separate acceptance;
7. Fix release blockers based on real feedback rather than preemptively expanding features.
