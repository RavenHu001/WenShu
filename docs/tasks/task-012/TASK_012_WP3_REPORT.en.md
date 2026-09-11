# TASK-012 WP3 Report: electron-builder, Artifact Allowlist, and Dependency Reduction

[简体中文](./TASK_012_WP3_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Recorded: 2026-09-01; preceding recovery point: `7179e2e` (WP2: release package ICO icon).
>
> This report records the actual WP3 build results. All WP3 packaging and launch gates are complete; WP4 has not started.

## Completed work

- Installed the exact `electron-builder@26.15.3` through npm and locked it in `package-lock.json`; the lockfile was not edited manually.
- Added standalone `electron-builder.yml`. It fixes the WP2 `appId`, `productName`, `executableName`,
  `build/icon.ico`, the `release/` output directory, and `asar`, and declares only Windows x64 portable
  and assisted, per-user NSIS targets. It does not configure signing, publish, file associations,
  MSI/MSIX, ia32, or ARM64.
- `files` uses an allowlist containing only `out/main/**`, `out/preload/**`, `out/renderer/**`, and
  `package.json`. electron-builder recursively includes actual external main-process dependencies only
  from production dependencies. The audit deterministically rejects source, tests, documentation,
  scripts, `.git`, `.github`, `.tools`, `.env*`, logs, fixtures, visual baselines,
  `out/.capture-user-data`, userData, and common credential filenames.
- Actual third-party imports in `out/main` are `docx`, `jszip`, and `mammoth`, so those three remain
  in `dependencies`. React, React DOM, CodeMirror, and Tiptap are fully included in the renderer
  bundle and were moved to `devDependencies`. This conclusion was verified through clean installation,
  a build, an ASAR audit, and launching with source `node_modules` hidden, rather than inferred solely from source imports.
- Added `package:dir`, `package:win`, `package:verify`, and a launcher wrapper using a project-local
  builder cache. `electronDist` explicitly reuses the postinstall runtime from locked
  `electron@43.4.1`, avoiding another Electron download by builder. The official source was unreachable
  during clean `npm ci`; under the owner's prior authorization, the official Electron installation
  script was run with temporary `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`.
  npm package and lockfile sources were not changed, and installation completed without a checksum error.
- Both packaging scripts explicitly pass `--publish never` and upload no artifact. electron-builder
  still creates `latest.yml` and an NSIS blockmap in local `release/`; these are update-description
  metadata that were not uploaded and do not mean that automatic updates or publish were enabled.
  The entire `release/` directory is ignored.
- Added repeatable `scripts/verify-package.mjs` and configuration tests to check package metadata,
  the ASAR main entry, the three direct runtime dependencies, absence of duplicate renderer
  dependencies, prohibited allowlist entries, x64 PE machine type, output sizes, and final artifact
  names. A complete file inventory is written to ignored `release/package-audit.json` for local
  review without committing artifact data to the repository.

## Measured evidence

| Item                                            | Measured result                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact versions                                  | Build Node `22.15.0`, npm `10.9.2`, Electron `43.4.1`, electron-builder `26.15.3`; final Electron CLI output `v43.4.1`.                                                                                                                                                                                                                                                     |
| clean install                                   | `npm ci --cache .tools\\npm-cache` succeeded, installing 596 packages. The first restricted-sandbox attempt hit an internal npm error triggered by mirror-network `EACCES`; it succeeded with the same lock after network approval.                                                                                                                                         |
| Targeted audit tests                            | `tests/package-audit-config.test.ts`: 2 passed.                                                                                                                                                                                                                                                                                                                             |
| Full `check`                                    | 72 test files passed, 1181 passed, 10 existing conditional skips, 0 failed; typecheck, lint, and Prettier all passed.                                                                                                                                                                                                                                                       |
| `build`                                         | Exit code 0; main 155.17 kB, preload 4.30 kB, renderer CSS 53.24 kB, renderer JS 2,264.13 kB.                                                                                                                                                                                                                                                                               |
| clean-install `package:dir`                     | Succeeded; automatic `package:verify -- --mode=dir` passed.                                                                                                                                                                                                                                                                                                                 |
| unpacked smoke test without source dependencies | Moved exactly `node_modules` to a temporary project-local stash, then launched `release/win-unpacked/WenShu.exe`. The source dependency directory was confirmed hidden; after 8 seconds the launcher was alive with 4 matching application processes. Only those processes were then stopped, the directory restored, and temporary userData cleaned after path validation. |
| `package:win`                                   | Succeeded after downloading and verifying `nsis-resources-3.4.1` from owner-authorized `https://npmmirror.com/mirrors/electron-builder-binaries/`; both automatic and separately executed `package:verify -- --mode=win` passed.                                                                                                                                            |
| portable smoke test                             | Launched `WenShu-0.1.0-alpha.1-portable-x64.exe` with isolated temporary userData. The launcher remained alive with 4 matching application processes; only that process group was then terminated and temporary userData cleaned.                                                                                                                                           |
| NSIS launch smoke test                          | Launched `WenShu-0.1.0-alpha.1-setup-x64.exe` without installation arguments. After 6 seconds the installer remained alive (1 exact matching process). Installation was not clicked; that process was then closed.                                                                                                                                                          |

Actual sizes in the last `package:dir` audit: `win-unpacked` 387,495,662 B,
`resources/app.asar` 12,440,474 B, and `app.asar.unpacked` 748,156 B. At the `package:win`
audit, `win-unpacked` was 387,603,274 B; ASAR and unpacked module sizes were unchanged.
Final portable size was 94,254,976 B, NSIS setup 94,554,175 B, and NSIS blockmap 101,102 B.
The ASAR `node_modules` inventory contains `docx`, `jszip`, `mammoth`, and their indirect dependencies.
Files from `jszip` requiring unpacking physically reside in `app.asar.unpacked`; the audit explicitly
marks them as unpacked modules indexed by ASAR, without counting them as additional application
dependency copies. The detected direct external main-process imports are exactly `docx`, `jszip`,
and `mammoth`; the PE machine value is `0x8664`.

## Recovering portable/NSIS downloads

The earlier blocker was missing `nsis-resources-3.4.1` plugin resources. After the project owner
explicitly authorized a mainland-China mirror on 2026-09-01, `package:win` was rerun with temporary
`ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`.
The exact resource URL returned HTTP 200 and a 730,800 B download. electron-builder 26.15.3
verified and extracted it using its built-in SHA-256
`593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103`, then produced both `.exe` files.
The mirror variable was used only for this build-tool resource download. It was not written into
project configuration, the package manifest, or the lockfile, and no cache was fabricated manually.

## Artifact security conclusion and gate

The successfully generated unpacked package contains no `src`, `tests`, `docs`, `scripts`, `.git`,
`.github`, `.tools`, `.env*`, logs, test fixtures, screenshot baselines, or `out/.capture-user-data`;
none of the credential filename patterns covered by the audit were detected. No code changes
were introduced to Task 1–11 IPC, file management, saving, backups, Recycle Bin, or close semantics.
The existing full test suite remains green.

Sources used include the [electron-vite production build guide](https://electron-vite.org/guide/build),
[electron-vite dependency troubleshooting guide](https://electron-vite.org/guide/troubleshooting),
[electron-builder application contents](https://www.electron.build/docs/contents/),
[configuration schema](https://www.electron.build/docs/configuration/),
[Windows targets](https://www.electron.build/docs/win/), and
[NSIS/portable guide](https://www.electron.build/nsis/).

**WP3 gate: passed.** Packaging, content audits, and launch smoke tests for unpacked, portable,
and NSIS outputs all have measured evidence. The allowlist and external dependencies are settled;
source, tests, and user data are excluded from the application package, and packaging scripts do
not upload artifacts. WP4 has still not started.
