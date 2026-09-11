# TASK-012 WP0 Report: Baseline, Runtime, Identity, and Release Semantics

[简体中文](./TASK_012_WP0_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Recorded: 2026-08-28; branch: `TASK-12`; baseline commit: `fc6309fcf3668905cd2c05f867049601e6abe061`.
>
> This work package completed only investigation, measurement, version selection, and this report.
> It changed no product code, dependencies, lockfile, packaging configuration, tags, or Release.

## 1. Scope and initial state

The Task 12 main prompt, Task 12 plan, and all materials listed in its section 3.1 were read in
full: README, project/environment/testing baselines, Task 9–11 reports, Task 11 information
architecture, package/lock, build configuration, and main/preload/shared APIs. Directly related
startup, screenshot, and runtime tests were also reviewed. There is no applicable `AGENTS.md` in the repository.

The working tree was clean at both start and finish; no user changes needed protection. The
current Electron security baseline is unchanged: `nodeIntegration: false`, `contextIsolation: true`,
`sandbox: true`; preload exposes only a fixed-shape Desktop API.

The repository currently has no `electron-builder`, Playwright, packaging configuration,
`.github/workflows/`, release icons, project LICENSE, CHANGELOG, SECURITY, or third-party NOTICE
files. `package.json` still has version `0.1.0`. This product metadata can change only in WP2;
WP0 does not rewrite it early.

## 2. Measured baseline

### 2.1 Commands and results

| Command                                                                   | Measured result                                                                                                                                                                                                      |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.\scripts\npm.cmd run check`                                             | Exit code 0; 69 test files passed, 1175 passed, 10 skipped, 0 failed; typecheck, lint (0 warnings), and Prettier passed.                                                                                             |
| `.\scripts\npm.cmd run build`                                             | Exit code 0; main 154,951 B, preload 4,103 B, renderer HTML about 0.57 kB, CSS 53.24 kB, JS 2,263.67 kB.                                                                                                             |
| `.\scripts\dev.cmd -- --user-data-dir=<isolated-temp>`                    | Succeeded in a runnable Windows session: Vite loopback server ready, main/preload builds succeeded, Electron launched; 4 Electron processes belonging to this run were observed, with 0 remaining after termination. |
| `.\scripts\npm.cmd exec -- electron . -- --user-data-dir=<isolated-temp>` | Succeeded in a runnable Windows session: 4 Electron processes belonging to this run observed, with 0 remaining after termination.                                                                                    |

Development and production smoke tests both used newly created system-temporary userData
directories. Only path-validated temporary directories were cleaned at completion; workspace files
and existing `out/` data were untouched. The restricted execution sandbox previously exited before
a window appeared because of GPU subprocess dependencies and cache permissions. That is an
environment limitation, not passing evidence, so only the actual Windows-session measurements in
the table are used as this work package's smoke evidence.

All 10 skipped cases are existing conditional symlink/junction permission cases: TXT reads 2,
DOCX reads 2, TXT search 1, mixed search 1, workspace resolution 1, move 1, Recycle Bin 1, reveal
in Explorer 1. Mocks still cover the corresponding rejection paths. This work package added no
skips or timeouts and weakened no assertions.

The machine is Windows `10.0.26200.9168`, AMD64, a 64-bit operating system. It supplies evidence
for only one Windows host and cannot replace WP5's Windows 10/11 standard-user installation,
upgrade, uninstallation, and Office/WPS matrix.

### 2.2 Currently resolved versions and dependency facts

| Item               | `package.json` declaration                | Lock / actual resolved version | WP0 assessment                                                                                                |
| ------------------ | ----------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Node.js            | `.node-version` is `22.15.0`; `>=22.12.0` | `v22.15.0`                     | Fixed; meets the Node 22.12 baseline for later builder v26/v27.                                               |
| npm                | `packageManager: npm@10.9.2`              | `10.9.2`                       | Fixed.                                                                                                        |
| Electron           | `^37.2.0`                                 | `37.10.3`                      | Reached EOL on 2026-01-13; must not generate an Alpha.                                                        |
| electron-vite      | `^4.0.0`                                  | `4.0.1`                        | Retain in WP1 unless official or measured compatibility evidence requires a change for Electron 43 migration. |
| Vite               | `^7.0.0`                                  | `7.3.6`                        | Current build succeeds; do not incidentally upgrade in WP1.                                                   |
| Vitest             | `^3.2.4`                                  | `3.2.7`                        | Current 69-file baseline; do not incidentally upgrade in WP1.                                                 |
| electron-builder   | Not installed                             | Not installed                  | WP3 plans exact `26.15.3`, without a caret.                                                                   |
| `@playwright/test` | Not installed                             | Not installed                  | WP4 plans exact `1.62.1`, without a caret.                                                                    |

Non-Node/Electron external runtime imports in `out/main/index.js` are exactly `jszip@3.10.1`,
`mammoth@1.12.1`, and `docx@9.7.1`. WP3 must include them in the allowlist as main-process
runtime dependencies. Their direct package licenses are respectively `(MIT OR GPL-3.0-or-later)`,
BSD-2-Clause, and MIT. This is an engineering inventory, not a legal licensing audit.

Direct libraries already bundled into the renderer's single Vite asset (2,263.67 kB) include
React/React DOM `19.2.7`, CodeMirror (commands `6.10.4`, search/state `6.7.1`, view `6.43.8`),
and Tiptap `3.29.2` (core/react/starter-kit/pm and current extensions). All these direct libraries
declare MIT. They are still listed as production dependencies, so WP3 must use actual outputs
and main/preload imports to assess whether moving them is safe, rather than guessing from size alone.

The scan found `.node` files only in two dev/build-time Rollup Windows x64 optional binaries
(MSVC, GNU). The three main-process runtime dependency trees, `docx`, `jszip`, and `mammoth`,
contain no `.node` or `.dll`. There is currently no application-native module requiring an
Electron ABI rebuild.

## 3. Current out/ and package-content risks

`out/` is not a release package; there is no `app.asar`, unpacked, portable, or NSIS output yet.
The build's main/preload/renderer total is about 2,476,530 B, but current `out/` totals
68,752,804 B, including 130 files and 66,276,274 B in `out/.capture-user-data/`.

That directory contains Chromium/Electron Cache, Code Cache, GPUCache, Cookies, Local Storage,
Session Storage, Network, Preferences, Local State, and Shared Dictionary. This is explicitly
prohibited data under Task 12 and may contain session or private information. WP0 neither deletes
it nor treats it as a product output. WP3 must use allowlisted files configuration and automated
auditing to deterministically exclude it alongside `src/`, `tests/`, `docs/`, `scripts/`, `.tools/`,
logs, `.env*`, certificates, and other userData. This blocks any distributable package until addressed.

## 4. Official sources checked that day and fixed decisions

All changeable conclusions use only the following official/primary sources, all accessed on 2026-08-28.

### 4.1 Electron

- [Electron release schedule and EOL](https://releases.electronjs.org/schedule): current supported
  stable lines are 44 (EOL 2027-03-02), 43 (EOL 2027-01-05), and 42 (EOL 2026-10-20);
  41 reached EOL on 2026-08-25.
- [Electron stable release records](https://releases.electronjs.org/release?channel=stable) and
  [43.4.1 GitHub release](https://github.com/electron/electron/releases/tag/v43.4.1): the latest
  released patch on the middle supported line is `43.4.1`, so **the WP1 migration target is fixed at `electron@43.4.1`**.
- [Electron 43 release notes and breaking changes](https://www.electronjs.org/blog/electron-43-0/):
  changes requiring review are downloads opening Downloads by default, nativeImage pixels with
  profiles normalized to sRGB, rounded Linux frameless windows and WCO Linux native-title-bar
  layout, and removal of Linux `dialog.showHiddenFiles`. Current code has no downloads,
  nativeImage, frameless/WCO, or that Linux dialog option, and the release target is Windows x64.
  Nevertheless, WP1 must actually test secure windows, native dialogs, Recycle Bin, and TXT/DOCX lifecycles.

Measured Electron 43.4.1 brings runtime upgrades to Chromium 150.0.7871.224, Node 24.18.1, and
V8 15.0.245.28. Application build Node remains project-local `22.15.0`; these are distinct
runtimes. Neither `^43` nor `latest` may replace the pinned version.

### 4.2 electron-builder, NSIS, ASAR, fuses, and signing

- [electron-builder stable release on npm](https://www.npmjs.com/package/electron-builder):
  `latest` that day is **`26.15.3`**; `27.0.0` is still prerelease and cannot be fixed as “current stable.”
- [Windows configuration schema](https://www.electron.build/docs/configuration/),
  [Windows targets](https://www.electron.build/docs/win/), and
  [NSIS/portable](https://www.electron.build/nsis/): the schema supports `nsis`, `portable`,
  `dir`, and other targets. WP3 uses x64 `portable` and assisted per-user NSIS, without web
  installer, MSI, MSIX, ARM64, or ia32.
- [v27 migration notes](https://www.electron.build/docs/migration/whats-new-v27/) and
  [v27 breaking changes](https://www.electron.build/docs/migration/v27-breaking-changes/) are
  future-upgrade references only: v27 requires Node >=22.12, moves to ESM, and changes schema/toolset
  behavior. It is not this work package's intended installation version. If v27 becomes stable
  before WP3, it must be rechecked and an explicit decision must replace this report's `26.15.3`.
- [Electron fuses guide](https://www.electron.build/docs/tutorials/adding-electron-fuses/) and
  [Electron ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity):
  fuses must be read and verified from final EXEs before signing. ASAR integrity and the existing
  `loadFile()` layout must be verified against real outputs in WP4, not assumed enabled in WP0.
- [Windows signing configuration](https://www.electron.build/docs/features/code-signing/code-signing-win/):
  `win.sign` can use signtool, HSM, PKCS#11, or Azure. The publisher name must match the
  certificate subject exactly. Signing, timestamping, and verification must occur in the correct
  order around final bytes and SHA-256.

### 4.3 Playwright

- [Playwright Electron API](https://playwright.dev/docs/api/class-electron) and
  [current stable npm package](https://www.npmjs.com/package/%40playwright/test): **WP4 target
  is fixed at `@playwright/test@1.62.1`** (Apache-2.0). Electron automation is experimental and
  supports Electron v14+. Playwright does not intercept native `dialog`; tests should replace
  dialog methods controllably in the main process. Setting the
  `EnableNodeCliInspectArguments` / `nodeCliInspect` fuse to false causes Electron launch to time out.

WP4 must therefore separate drivable unpacked E2E from final hardened-artifact black-box launch,
package/fuse audits, and Windows manual acceptance. It must not claim full Playwright control of final EXEs.

### 4.4 GitHub Actions and provenance

- [GitHub workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax):
  once a workflow explicitly declares any permission, permissions not listed are none.
- [Artifact Attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations):
  binary attestation requires `contents: read`, `id-token: write`, and `attestations: write`.
  Private or internal repositories on Free/Pro/Team are ineligible and require Enterprise Cloud.
  Eligibility still awaits repository owner/plan confirmation.
- [Official actions/setup-node releases](https://github.com/actions/setup-node/releases),
  [upload-artifact documentation](https://github.com/actions/upload-artifact), and
  [actions/attest documentation](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations):
  WP6 plans exact tags `actions/checkout@v5.0.0`, `actions/setup-node@v6.4.0`,
  `actions/upload-artifact@v4.6.2`, and `actions/attest@v4.1.1`. At implementation, resolve each
  official release again to a full 40-character commit SHA and annotate the readable versions in
  YAML comments. PR jobs need only `contents: read`; signing/Draft Release jobs may receive
  required `contents: write` and signing/OIDC permissions only after protected Environment approval.

### 4.5 Microsoft Authenticode, SmartScreen, and Smart App Control

- [Microsoft SmartScreen reputation explanation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation):
  unsigned and self-signed binaries both produce warnings equivalent to unknown applications.
  Even trusted-signed new files may prompt before reputation builds. Artifact Signing (formerly
  Trusted Signing) is the recommended service for non-Store distribution, but still requires
  identity verification and cannot guarantee no SmartScreen warning on first download.
- [Authenticode timestamping](https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures):
  use SHA-256 and RFC 3161 timestamps. Without a timestamp, a signature expires when its certificate expires.
- [Smart App Control overview](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview):
  Windows 11 Smart App Control may block unknown/unsigned code. A trusted-root CA signature is
  one allowing signal; policy and reputation also affect results. This machine's behavior must
  not be extrapolated to all users.

Conclusion: an internal Alpha may explicitly identify itself as unsigned and be restricted to
controlled testing. **A public Alpha must wait for a trusted Authenticode identity confirmed by
the owner and complete SHA-256, timestamping, and signature verification before release eligibility.**
This work package has no certificates, private keys, tokens, or real signing credentials.

## 5. Fixed product and release semantics

These WP0 decisions are already specified by Task 12 but have not been written into product
configuration; WP2/WP3 will implement them alongside tests:

| Property                     | Fixed value                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| First version / tag          | `0.1.0-alpha.1` / `v0.1.0-alpha.1`                                                                                                       |
| application identity         | `io.github.ravenhu001.wenshu`                                                                                                            |
| Display name / EXE base name | `文枢` / `WenShu`                                                                                                                        |
| Platform and architecture    | Windows 10 / Windows 11, x64                                                                                                             |
| Artifacts                    | ASCII `WenShu-0.1.0-alpha.1-win-x64-portable.exe`, `WenShu-0.1.0-alpha.1-win-x64-setup.exe`, `SHA256SUMS.txt`, `THIRD_PARTY_NOTICES.txt` |
| Installation semantics       | Assisted current-user per-user NSIS; no elevation by default                                                                             |
| Explicit non-goals           | Automatic updates, telemetry, file associations, ia32, ARM64, Store/MSIX/MSI, macOS, Linux                                               |
| Release levels               | Unsigned outputs only for internal Alpha; public Alpha requires trusted Authenticode signing and verification                            |

## 6. Real gates requiring the project owner's decisions

1. **Project license and rights text**: no project LICENSE exists. This work package must not
   infer open-source, source-available, or all-rights-reserved status. Third-party dependencies
   and their transitive NOTICE files also need a traceable WP7 audit.
2. **Brand and icons**: `文枢 / WenShu` is still provisional, and there is currently no release
   ICO with traceable rights. The owner must confirm the name, icon provenance, and external publisher identity.
3. **Public signing identity**: no trusted Authenticode/Artifact Signing identity, account
   authorization, publisher subject, or secure credential entry point exists. Self-signing must
   not be described as trusted by Windows.
4. **Public release authorization and GitHub conditions**: creation/pushing of tags, uploading,
   or creating/publishing Releases is not authorized. Repository visibility, plan, and
   Environment/required-reviewer settings are also unknown, so attestation and public Release eligibility are unconfirmed.

## 7. Subsequent verification plan

- **WP1**: migrate only to `electron@43.4.1`, then run typecheck, lint, format:check, full Vitest,
  check, build, development/production Electron smoke tests, and Windows native, TXT/DOCX,
  backup, conflict, Recycle Bin, and close-protection regressions.
- **WP2**: after the owner confirms name/icon rights, implement the single version source, appId,
  icons, and About consistency tests.
- **WP3**: install exact `electron-builder@26.15.3`, establish a directory allowlist, produce
  unpacked first and then portable/NSIS, and audit package `app.asar`, `app.asar.unpacked`,
  runtime dependencies, prohibited data, and sizes.
- **WP4–WP8**: introduce pinned Playwright Electron E2E, ASAR/fuse verification, the Windows
  lifecycle matrix, least-privilege CI, signing/hashes/attestation, licensing, and Draft Release.
  All public claims depend on subsequent real evidence.

## 8. WP0 conclusion

**Technical investigation, baseline measurements, and runtime selection: passed.** Current
Task 1–11 automated gates, builds, development/production launch, and security boundaries have
a reviewable baseline. Electron 43.4.1 is the exact version on the middle supported line required
by the rules on that date.

**Formal Task 12 WP0 release gate: not passed; WP1 cannot start yet.** The reason is not a code
regression: section 6 owner decisions (at least licensing, brand/icon and external identity,
public signing identity/authorization) are still unconfirmed, and current `out/` contains a
userData risk that WP3's allowlist must block. The latter does not prevent a controlled WP1
Electron migration, but under the strict rule of entering each package only after its predecessor's
gate, WP1 should begin only after the owner resolves those decisions or explicitly authorizes
continuation as an “internal Alpha, with public release still blocked.” Either way, packaging,
signing, or release must not occur early.
