# TASK-012 WP7 Report: Signing Integration, Licensing, and Alpha Release Documentation

[简体中文](./TASK_012_WP7_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Recorded: 2026-09-07; branch: `main`; starting commit:
> `2d84bc111e9c3aea01b8c7c580c24c942170a490`. This report covers WP7 only and does not proceed to WP8.

## 1. Conclusion and actual release level

**The currently approved scope is public MIT source code on GitHub; portable/NSIS remain unsigned
internal Alpha / Draft outputs. WP7 satisfies this revised owner gate but does not authorize public binaries.**

Safe local engineering, third-party NOTICE, changelog, security policy, Alpha Release Notes,
v27 configuration migration, unsigned-signature verification/final hashes, and Draft workflow
hardening are complete. The owner selected the MIT License (Copyright 2026 Jinxi Hu) and public
GitHub source only; the root license and project metadata are in place. Binaries are for internal
Draft testing only, so current `win.sign: false` is intentional and accurate. Artifact Signing +
GitHub OIDC is documented as optional future work for public binaries, not a current blocker.
No publisher, PFX, Azure configuration values, or credentials were written, and the existing Draft
was not converted to a public Pre-release.

Success evidence for the remote `Build internal Alpha draft` action and Draft comes from the WP6
report and the owner's statement in this round. GitHub CLI was not installed in this session,
and the remote Release was not modified. Existing `v0.1.0-alpha.1` points to
`c073f1fbb4b2bef3370d0e9b10d21d74de974d87`, while this work package's starting HEAD is already
a later commit; the existing Draft therefore lacks WP7 files and v27 outputs. The existing tag
must not be moved, nor current HEAD outputs presented as its artifacts. The owner decided to
retain the old internal Draft. Current HEAD outputs are solely for local final verification,
without increasing the version, creating a new tag, or publishing Windows binaries. This work
package did not tag, push, or publish without authorization.

## 2. electron-builder v27 and signing boundaries

When npm and official documentation were checked on 2026-09-07, stable `latest` was still v26,
and the newest v27 was prerelease `27.0.0-alpha.8`. Because WP7 explicitly required the current
v27 `win.sign` shape, builder was upgraded and exactly locked to that version, with these migrations:

- Removed the `asar: true` sentinel removed in v27 and used `asar: {}`;
- Removed `win.signExecutable`, removed in v27; the accurate current state uses `win.sign: false`;
- Changed the builder CLI wrapper to v27's `electron-builder/cli.js`;
- `migrate-schema --dry-run` confirmed v27 configuration shape; no legacy `signtoolOptions`,
  `azureSignOptions`, or other removed fields were introduced.

Official sources:

- [electron-builder v27 Windows signing](https://www.electron.build/docs/features/code-signing/code-signing-win/)
- [electron-builder v27 breaking changes](https://www.electron.build/docs/migration/v27-breaking-changes/)
- [Microsoft Artifact Signing integrations](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)
- [Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)
- [Authenticode timestamping](https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures)
- [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)

`scripts/verify-windows-release.ps1` processes portable and NSIS individually. Internal mode
requires `NotSigned`; trusted mode requires `Valid`, an exactly matching certificate subject,
and a timestamp certificate before generating/reverifying SHA-256. The workflow currently fixes
internal mode, so an unexpectedly signed file causes failure. After selecting a real backend,
`win.sign` must be replaced with v27's single discriminated union and the workflow gate switched
to `Trusted`; changing release wording alone is insufficient.

Trusted signing is not integrated now. If public binaries are approved later, the preferred
optional solution is Artifact Signing + GitHub OIDC because no private key is stored locally.
Only then should the Azure account, Public Trust identity, account/profile, publisher subject,
and minimal `Artifact Signing Certificate Profile Signer` role be established. No credentials
were read or printed in this round.

## 3. Fixed build order and artifact evidence

Actual order: allowlisted package contents → ASAR integrity/fuses → explicitly disabled signing
→ `NotSigned` verification → final SHA-256 → local black-box execution. EXEs were only read/run
after final hashing, without modification.

| Item       | Bytes       | Authenticode | Timestamp | Final SHA-256                                                      |
| ---------- | ----------- | ------------ | --------- | ------------------------------------------------------------------ |
| portable   | 103,523,141 | `NotSigned`  | None      | `9844ee5110918928575999c274161d906a32748fbc10fc5f29f0c1492b847dc3` |
| NSIS setup | 103,829,941 | `NotSigned`  | None      | `8ad601192eff646a377c1c39962438d933da9df3cef6f636c9689e76969dc088` |

Package audit detected x64 PE machine `0x8664`: unpacked 387,691,896 B, `app.asar`
12,603,336 B, and `app.asar.unpacked` 748,156 B. External main-process imports remain only
`docx`, `jszip`, and `mammoth`. `THIRD_PARTY_NOTICES.txt` is included in `app.asar`;
Electron's `LICENSE.electron.txt` and `LICENSES.chromium.html` remain in the final runtime directory.

Actual fuse readings from final EXEs have not regressed: RunAsNode, Node options, Node CLI
inspect, and browser-specific V8 snapshot are Disabled; embedded ASAR integrity and
OnlyLoadAppFromAsar are Enabled; file protocol privileges needed by current `loadFile()` are
Enabled. Final portable black-box smoke testing created 4 isolated processes that remained
running, and the NSIS installer remained running. Only processes created in this run were
stopped. Temporary userData was verified to be under system TEMP before cleanup. The real
WP5 installation/uninstallation matrix was not repeated.

## 4. Third-party license and NOTICE audit

The new generator resolves the actual dependency graph from full `package-lock.json` and clean
`node_modules`, covering main-process runtime dependencies and explicit renderer bundle roots
while excluding build/test/lint/package-only tools. The generated inventory contains 103 npm
packages used by or bundled into the product, with exact versions, lockfile license expressions,
repositories, and all LICENSE/NOTICE/COPYING texts in each package. Every `check` uses `--check`
to prevent an outdated inventory.

Manual exceptions: published npm packages `dingbat-to-unicode@1.0.1` (BSD-2-Clause),
`hash.js@1.1.7` (MIT), and `isarray@1.0.0` (MIT) contain only license metadata without standalone
license text. The inventory preserves that gap; copyright and exact text must be confirmed
from the corresponding upstream tags/commits before public distribution. Electron/Chromium's
nested third-party notices are carried by the two official license files in the final runtime
directory. This audit is an engineering inventory, not comprehensive legal advice.

The project itself now uses the MIT License, with Jinxi Hu as copyright holder and 2026 as the
year. The MIT text agrees with the `package.json` SPDX identifier. This does not change
third-party components' licenses or present an engineering inventory as legal advice. The
existing tag predates the license commit and therefore may only remain a historical internal
Draft, not represent current source. Future public binaries require a new owner-approved
version and exact tag.

## 5. Documentation and workflow

- `CHANGELOG.md` records the first Alpha's capabilities and actual signing/release state;
- `LICENSE` uses standard MIT text and is distributed with the application package and Draft attachments;
- `SECURITY.md` explains private reporting, minimal synthetic reproductions, log/path/document privacy, and manual-update boundaries;
- `docs/releases/v0.1.0-alpha.1.md` explains system/architecture, portable/NSIS, SHA-256, core
  capabilities, limitations, local document semantics, no automatic updates/telemetry, feedback
  privacy, and downgrading without touching the workspace;
- The release workflow carries NOTICE and Release Notes and creates a Draft through
  `--notes-file`. It does not currently publish publicly or mislabel unsigned outputs as trusted-signed;
- Only GitHub source code is public now; GitHub Releases binaries remain in an internal Draft.
  No Microsoft Store listing or automatic updates are planned. Artifact Signing + GitHub OIDC
  remains optional future work for public binaries.

## 6. Actual commands and results

| Command / check                                                       | Result                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm install --save-dev --save-exact electron-builder@27.0.0-alpha.8` | Succeeded; npm updated the lockfile.                                                                                                                                                                                                       |
| `electron-builder migrate-schema -c electron-builder.yml --dry-run`   | Configuration is already v27; no migration needed.                                                                                                                                                                                         |
| `npm ci`                                                              | Succeeded; clean installation of 559 packages.                                                                                                                                                                                             |
| First `npm run check` after clean installation                        | 71 files/1174 tests passed; 2 suites failed during collection because the Electron binary was not installed. Reran after `npx install-electron --no`, as in the workflow.                                                                  |
| Final `npm run check`                                                 | 73 files passed; 1184 passed, 10 skipped, 0 failed. All 10 skips are existing symlink/junction permission conditions. Typecheck, lint, Prettier, and NOTICE freshness all passed.                                                          |
| `npm run build`                                                       | Passed; main 155.17 kB, preload 4.30 kB, renderer HTML 0.57 kB, CSS 53.24 kB, JS 2,264.13 kB.                                                                                                                                              |
| `npm run test:e2e`                                                    | 1 file, 4/4 passed: launch/About, TXT byte saving, DOCX/backup, dirty close.                                                                                                                                                               |
| `npm run package:dir`                                                 | v27 succeeded; ASAR, NOTICE, x64, dependency, and package-content audits passed.                                                                                                                                                           |
| `npm run package:win`                                                 | Ultimately succeeded with a clean dependency tree; portable/NSIS generated. The first restricted-network attempt could not download the v27 toolset; after authorized official-source download and verification, a cached rerun succeeded. |
| `npm run package:verify -- --mode=win`                                | Passed; prohibited paths/credentials/userData, runtime dependencies, x64, ASAR, and notices all passed.                                                                                                                                    |
| `npm run release:manifest:unsigned`                                   | Both EXEs `NotSigned`, no timestamp; generated and reverified final SHA-256.                                                                                                                                                               |
| Final portable/NSIS black-box launch + hash reverification            | Passed; hashes still matched the manifest after process cleanup.                                                                                                                                                                           |

## 7. Credential, path, and privacy review

The repository contains only public configuration key names and placeholder explanations, no
credential values, PFX, certificate base64, private keys, GitHub/Azure tokens, or unredacted logs.
No absolute user paths were added to configuration or documentation. Release outputs and package
audits remain in ignored `release/`. Task 1–11 product code and user workspaces were not changed.

## 8. Blockers and gates

1. Public binaries are not currently authorized, and the actual signing level is intentionally
   unsigned. Trusted-signature, timestamp, and publisher testing become gates only after public
   binaries are approved and Artifact Signing enabled in the future.
2. The MIT project license is in place. Upstream evidence for the three npm packages missing
   standalone license texts should be completed before future public binaries.
3. The existing Alpha tag predates WP7. Local final outputs are not tied to a new exact tag
   eligible for upload. Creating/pushing a new tag is unauthorized, and an already-used tag should not be moved.
4. The owner moved the Windows 11 x64 matrix to optional future work. WP5 has no evidence for
   that platform, so no Windows 11 support claim is made now, but it no longer blocks current WP7/WP8 scope.
5. v27 is currently an Alpha prerelease, pinned and passing local internal-engineering gates.
   It does not block current unsigned internal outputs, but the then-current stable version,
   migration risk, and official support status must be reassessed before future public binaries.

Therefore, **the WP7 gate for public MIT source is satisfied; binaries must remain “unsigned
internal Alpha/Draft, not public.”** Azure/OIDC is no longer a current blocker; it is explicit
optional future work for public binaries. This work package does not proceed to WP8.
