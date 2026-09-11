# TASK-012 Completion Report: Windows Alpha Release Engineering

[简体中文](./TASK_012_COMPLETION_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> WP8 acceptance dates: 2026-09-09 through 2026-09-10. This document records actual execution
> results. Historical WP0–WP7 reports remain unchanged; later scope decisions and this round's
> results are not retroactively written into historical facts.

## 1. Conclusion

WP8 code auditing, building, packaging, artifact inspection, and documentation closeout have
been executed. Under the latest owner scope decision of 2026-09-10, all 33 current Task 12
items have evidence and are checked, reaching “MIT source release readiness complete; Windows
10 x64 unsigned internal Alpha engineering complete.” No public Windows binary release is
currently authorized or has been executed.

This completion level rests on a **theoretical Windows 10 x64 compatibility audit**, not a
claim of testing on an actual Windows 10 machine. The current host kernel is `10.0.26200.9445`,
which belongs to Windows 11 25H2. The owner currently has no Windows 10 environment and explicitly
deferred the Windows 10 physical-machine matrix to a later development stage. Future test failures
must be fixed, but absence of that future matrix no longer blocks the current engineering-completion conclusion.

The owner's 2026-09-08 scope revision superseded three old gates in historical reports:
Windows 11 acceptance, trusted signing, and public Windows binaries are all optional future
work, not current-scope gates. Historical “not passed” conclusions in WP5 for lacking Windows
11 and WP7 for lacking trusted signing remain as contemporary records, but no longer serve
as reasons for current failure.

A further scope revision on 2026-09-10 moved the Windows 10 physical-machine launch matrix to
a later development stage, requiring only a theoretical compatibility audit now. That decision
does not rewrite historical WP reports or fabricate Windows 10 measurements from Windows 11 results.

## 2. Scope, baseline, and working tree

- Branch: `main`; initially `main...origin/main` with a clean working tree; no user changes found.
- WP8 starting baseline: `0a474b92e73c9d9bb0bcfcf8b4a96ce2d7a61ab5`; exact product-input
  commit for final outputs: `98b05b416bd00ce21cc465cea8be66ea02a90236`; current `HEAD` and
  locally tracked `origin/main`: `8ebe524d35b74b8d0b76739f825c6e08af9f368e`. The latter adds
  only Action Node 24 upgrades and corresponding tests/documentation, without changing artifact inputs.
- Remote tag: `v0.1.0-alpha.1` → `0a474b92e73c9d9bb0bcfcf8b4a96ce2d7a61ab5` (confirmed
  read-only with `git ls-remote` during WP8). The unrefreshed local ref of the same name still
  points to `c073f1fbb4b2bef3370d0e9b10d21d74de974d87`. This round did not fetch, move, or
  rewrite tags, or overwrite the existing Draft.
- Current version: `0.1.0-alpha.1`; `appId`: `io.github.ravenhu001.wenshu`; product name “文枢”;
  executable name `WenShu`.
- Toolchain: Node.js `22.15.0`, npm `10.9.2`, Electron `43.6.0`, electron-vite `4.0.1`,
  electron-builder `27.0.0-alpha.8`, Playwright `1.62.1`.
- Electron 43.6.0 embedded runtime: Chromium `150.0.7871.250`, Node.js `24.20.0`, V8
  `15.0.245.31` (official Electron release metadata; build Node and embedded Node are kept distinct).
- Final lockfile SHA-256: `DCDDD42A75BF1FC07D6D12622559726197D5918BDCFB26399C4BA5CEED92ADE8`.
- The executing assistant performed no push, tag, GitHub Release, signing, certificate, OIDC, or
  Windows 11 support work. The owner subsequently pushed WP8 product commit `98b05b4` to `main`
  and supplied a successful CI screenshot, then committed and pushed `8ebe524`, containing only
  workflow/test/documentation changes.

Acceptance found and fixed two issues within Task 12 scope: the Electron 43 middle line was
not on that day's latest patch and was upgraded exactly `43.4.1 → 43.6.0`; builder inferred an
update source from the Git remote and wrote `resources/app-update.yml` outside the ASAR package.
It now explicitly uses `publish: null` and prohibits that file in package audits. The audit
also verifies every file in `app.asar.unpacked` has a corresponding ASAR index entry. No product
features were added.

## 3. Clean installation and command record

Initial commands started from the clean baseline above and its committed `package-lock.json`.
After the Electron patch upgrade, final gates restarted from a clean installation using the
updated lockfile. Failed attempts are retained too:

| Command/action                                                           |   Exit code | Actual result                                                                                                                  |
| ------------------------------------------------------------------------ | ----------: | ------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci` (system npm cache)                                              |           1 | npm 10.9.2 reported `Exit handler never called`; log directory was also unwritable                                             |
| `npm ci --cache .tools/npm-cache` (controlled environment)               | Interrupted | Electron download waited without progress; manually interrupted, not counted as passing                                        |
| Same command, temporary `ELECTRON_MIRROR`, standard-user network session |           0 | 559 packages; only 3 known transitive-dependency deprecated warnings                                                           |
| First `npm ci` after Electron upgrade                                    | Interrupted | Electron runtime download made no progress; manually interrupted                                                               |
| Post-upgrade clean `npm ci`, temporary mirror                            |           0 | 559 packages; lockfile installation succeeded                                                                                  |
| `npm run notices:generate`                                               |           0 | 103 third-party packages; Electron updated to 43.6.0                                                                           |
| `npm run typecheck`                                                      |           0 | All 5 tsconfigs passed                                                                                                         |
| `npm run lint`                                                           |           0 | `--max-warnings=0`                                                                                                             |
| `npm run format:check`                                                   |           0 | All files conform to Prettier                                                                                                  |
| `npm test`                                                               |           0 | 73 test files, 1184 passed, 10 conditional skips, 0 failed                                                                     |
| `npm run check`                                                          |           0 | Types, lint, formatting, NOTICE, and full ordinary tests passed                                                                |
| `npm run build`                                                          |           0 | main 155.17 kB; preload 4.30 kB; renderer JS 2264.13 kB                                                                        |
| First final `npm run package:dir`                                        |           1 | Correctly blocked because Electron dist was absent after clean installation                                                    |
| `npx install-electron --no` (temporary mirror)                           |           0 | Installed and measured Electron `v43.6.0`                                                                                      |
| `npm run package:dir` (retry)                                            |           0 | Generated unpacked output and passed automatic audit                                                                           |
| `npm run package:win`                                                    |           0 | Generated portable/NSIS and passed automatic audit                                                                             |
| `npm run package:verify -- --mode=win`                                   |           0 | Final package contents, architecture, ASAR, and dependency audits passed                                                       |
| `npm run test:e2e`                                                       |           0 | 1 file, all 4 cases passed; residual processes before and after were 0                                                         |
| `npm run release:manifest:unsigned`                                      |           0 | Verified `NotSigned` before generating a two-entry SHA-256 manifest                                                            |
| `npm run release:verify:unsigned`                                        |           0 | Both EXE states and hashes matched on reverification                                                                           |
| Local release workflow dry-run                                           |           0 | Version/tag/manifest structure passed; detected historical tag did not point to current baseline and refused misrepresentation |
| Full final-package PE header read                                        |           0 | 10 unpacked PE files, 0 native `.node` files; all minimum OS/subsystem versions at most 10.0                                   |
| Windows platform-gate and production-dependency scan                     |           0 | No Windows 11 build gate, WinRT, exclusive API, or native Node addon                                                           |

All 10 conditional skips are real symlink/junction cases following capability probes for local
permissions: read text 2, read DOCX 2, workspace search 2, resolve 1, relocate 1, trash 1,
reveal 1. Mock adapters deterministically cover the same rejection branches. There is no `.only` or
unconditional `.skip` in the repository, and no timeout was added or relaxed.

The first development launch in the controlled sandbox exited with code 1 and Chromium GPU/cache
permission errors. It still exited with code 1 after adding independent userData and
`--disable-gpu`. Running the same development command in a standard-user desktop session
produced 4 observed Electron processes and a main window titled “文枢”; after `Ctrl+C`, 0
processes remained and temporary userData was deleted. E2E launches the production build using
`electron .`; unpacked, portable, and installed outputs separately underwent black-box process/window checks.

## 4. Final outputs, signatures, and hashes

These files came from the WP8 product inputs subsequently committed as
`98b05b416bd00ce21cc465cea8be66ea02a90236`, and are for local acceptance only, not the historical
tag or Draft. Post-commit review confirmed current differences from that commit are limited to
documentation, release workflow Action upgrades, and their tests. `package.json`, lockfile,
builder configuration, package audit, LICENSE/NOTICE, source, and build resources all match that commit:

| File                                    |       Bytes | SHA-256                                                            | Authenticode              |
| --------------------------------------- | ----------: | ------------------------------------------------------------------ | ------------------------- |
| `WenShu-0.1.0-alpha.1-portable-x64.exe` | 104,083,530 | `7e4845bd05c93d43c59cb9fe792d739d92935cdd385a5b63f447421af017e91f` | `NotSigned`, no timestamp |
| `WenShu-0.1.0-alpha.1-setup-x64.exe`    | 104,390,327 | `3f43e84e1935e4e77b7c75088395914cd4408e41d3cc36af24341ad63b215c2d` | `NotSigned`, no timestamp |

`SHA256SUMS.txt` contains exactly those two entries. Generation first confirms `NotSigned`,
then writes the manifest, then rereads files, signature states, and hashes for verification.
Both PE machine values are `0x8664` (x64). Hashes must not be interpreted as publisher identity
or trusted signing.

Unpacked total size is 391,191,778 bytes; `app.asar` is 12,603,302 bytes with 1021 index
entries; `app.asar.unpacked` is 748,156 bytes with 51 files and 0 unindexed files. The entire
unpacked tree contains 128 files and 0 prohibited entries. Package LICENSE,
`THIRD_PARTY_NOTICES.txt`, product package metadata, main/preload/renderer, and runtime dependencies
are present. Source directories, tests, logs, environment files, credentials, private fixtures,
userData, and `app-update.yml` are absent. A copy detached from the source repository launches.
A destructive copy with `app.asar` removed exits with code 1 and no remaining processes,
demonstrating no fallback to external source.

Fuses read from final unpacked output: RunAsNode disabled, NODE_OPTIONS disabled, Node CLI
inspect disabled, ASAR integrity enabled, only-load-app-from-ASAR enabled; cookie encryption
and browser-specific V8 snapshot disabled; file-protocol extra privileges enabled. These match
Task 12's fixed policy.

## 5. Electron E2E and black-box results

The 4 Electron E2E cases cover launch/About identity and version; exact TXT-byte opening/saving;
valid DOCX generation, saving, and `.wenshu.bak`; and cancellation protection when closing a
dirty tab. Matching Electron/WenShu processes are 0 before and after E2E.

Final files in this round also completed the following automated black-box checks in the current
host's standard-user session. Because the host is actually Windows 11 25H2, **these results do
not count toward the Windows 10 gate**:

- Portable launched from an independent path containing Chinese characters and spaces: 4 processes,
  1 “文枢” window, 0 remaining after exit;
- First NSIS installation exited with code 0; default per-user installation directory and Start
  menu “文枢” shortcut existed;
- Installed application launched with 4 processes and 1 “文枢” window; same-version installation
  over the existing version exited with code 0;
- Uninstallation exited with code 0 and removed the installation directory and shortcut; external
  synthetic-workspace manifest/hashes matched exactly before and after;
- Unpacked launched detached from the repository with 4 processes and 1 “文枢” window; all temporary
  directories were cleaned, with 0 final residual processes.

### 5.1 Theoretical Windows 10 x64 compatibility audit

Under the current gate revised by the owner on 2026-09-10, final artifacts underwent binary
and source auditing beyond superficial configuration values:

- Electron 43.6.0 belongs to the Electron 43 series. Official Electron requires Windows 10 or
  later from v23; v43 officially provides prebuilt Windows x64 runtimes. No breaking change was
  found raising this series' minimum to Windows 11;
- Final `win-unpacked/WenShu.exe` is PE32+ x64 (machine `0x8664`), with minimum PE OS and
  subsystem versions both `10.0`. It explicitly does not target Windows 7/8 and has not raised
  the minimum major version to 11;
- Actual reads of all PE files in unpacked found 10 EXE/DLL files and 0 native `.node` extensions.
  All PE minimum OS and subsystem versions are at most `10.0`; no binary minimum above Windows 10 was found;
- Portable and NSIS outer layers are standard 32-bit NSIS bootstrappers (machine `0x014c`, minimum
  OS/subsystem `4.0`), with x64 application payloads inside. Windows 10 x64 WoW64 can run this installer bootstrap layer;
- Builder produces only `portable` and `nsis` x64. NSIS is per-user, `perMachine: false`, with
  elevation prohibited; it configures neither MSIX/Store nor Windows 11-exclusive deployment capabilities;
- Production dependencies are JavaScript document-processing libraries, and the final package
  has no native Node addon. Source scans found no Windows 11 build gate, WinRT, or Windows
  11-exclusive API. Recycle Bin uses Electron `shell.trashItem`, with platform adaptation provided
  by the same Electron runtime.

Conclusion: final portable/NSIS outputs are **theoretically compatible with Windows 10 x64**.
Windows 10 22H2 build 19045 is recommended as a future physical-machine baseline. PE major-version
fields and upstream support scope cannot prove behavior for specific device drivers, security
policies, patch levels, or SmartScreen. This report therefore closes only the current theoretical
compatibility gate and does not claim completed Windows 10 physical-machine validation.

On 2026-09-10, the owner additionally confirmed items 11.3.2–11.3.6 were checked without issues:
per-user, no elevation, installation/installation over an existing version/uninstallation;
Chinese-character and space-containing paths, standard-user directories and Start menu entries;
external-workspace invariance; exit/uninstallation leftovers; and actual Defender, SmartScreen,
and Authenticode behavior. This is recorded as owner manual acceptance evidence, not written
back into historical WP5. Neither these results nor the current theoretical audit are described
as final-package Windows 10 x64 physical-machine evidence.

The owner's post-uninstallation Task Manager screenshot showed multiple Node.js, `node_repl.exe`,
and `cmd.exe` entries. A subsequent executable-path audit found 0 `WenShu.exe` and 0
`electron.exe`. `node_repl.exe` and most Node.js processes came from the OpenAI Codex runtime;
the remaining Node.js/command processors came from local development tools or Windows. They
are not WenShu uninstallation leftovers and should not be forcibly ended to verify WenShu.
Together with the owner's manual confirmation, item 11.3.5 is marked passed.

Local Microsoft 365 Word `16.0.20326.20132` could open a synthetic DOCX and read the expected
text, but the document was reported read-only and `Save` unavailable. A hanging `SaveAs2`
attempt was interrupted and Word processes cleaned. WPS was not installed. These failures/absences
were not recorded as a successful Office round trip in this round. The owner subsequently
explicitly confirmed reuse of the Word/WPS, backup, conflict, Recycle Bin, and complete file
lifecycle manual acceptance performed when those features were actually built. Combined with
current 1184 automated regressions and final E2E, 11.1.5 is therefore marked passed and is no longer a current blocker.

Defender status queries returned Access Denied; group-policy SmartScreen queries provided no
usable value. Locally generated files had no Zone.Identifier, so the download-reputation path
was not triggered. Both EXEs' `NotSigned` state is definite evidence; Defender/SmartScreen allowing
execution is not. Windows 11 Smart App Control support was neither tested nor claimed this round.

WP5 recorded “Windows 10 Home version 2009” and owner manual acceptance, but no OS build.
This round found that the same product-name interface conflicts with kernel `10.0.26200.9445`.
The old report remains historical evidence but is insufficient to prove final 43.6.0 outputs
passed in a Windows 10 build 19045 standard-user environment.

## 6. CI, provenance, and release boundaries

CI/release workflow static auditing passed: Actions use full commit SHAs; PR/push jobs have
only `contents: read`, without signing or Release write permission; the Draft job separately
receives `contents: write`. No signing credentials exist. The release path reinstalls, checks,
builds, packages, and verifies from the triggering commit, without reusing `node_modules`,
`out`, or unknown binaries.

The local dry-run confirmed package version expects tag `v0.1.0-alpha.1`. The unrefreshed local
tag still pointed to `c073f1f...` at that time, so the rehearsal correctly refused to continue.
The user then supplied a pre-WP8 GitHub Actions screenshot: `Build internal Alpha draft #6`,
triggered by a tag push, showed ref `v0.1.0-alpha.1`, commit `0a474b9`, Success, total duration
9 minutes 47 seconds, and 1 artifact. “Rebuild and verify release artifacts” took 9 minutes
12 seconds; “Upload approved Draft pre-release” took 27 seconds; both were green. A read-only
`git ls-remote` additionally confirmed the remote tag currently points to full SHA
`0a474b92e73c9d9bb0bcfcf8b4a96ce2d7a61ab5`.

The screenshot also showed 2 annotations. The visible one stated old
`actions/upload-artifact@v4.6.2` targets Node.js 20 and was forced by GitHub to run on Node.js 24. Based on official GitHub release metadata, WP8 upgraded upload to
`actions/upload-artifact@v6.0.0` (`b7c566a...`) and download in the same transfer chain to
`actions/download-artifact@v8.0.1` (`3e5f45b...`). Both use full pinned SHAs and Node.js 24
by default; targeted workflow tests passed. The second annotation was not expanded in the
screenshot, so its wording is not inferred.

Cross-checking the screenshot against `release.yml` at repository commit `0a474b9` establishes
execution from a tag checkout of `npm ci`, Electron runtime installation, build, check, Electron
E2E, package, `NotSigned`, and SHA-256 workflow steps. But this occurred before WP8 and excludes
this round's Electron 43.6.0, `publish: null`, and package-audit fixes.

The user subsequently supplied a separate newly uploaded `Continuous integration #11`
screenshot: main push commit `98b05b4`, Status Success, total duration 5 minutes 46 seconds;
the sole “Check, build, and Electron E2E” job took 5 minutes 43 seconds and was green. Local
HEAD and `origin/main` both resolved to full SHA
`98b05b416bd00ce21cc465cea8be66ea02a90236`. That commit includes Electron 43.6.0,
`publish: null`, the new package audit, NOTICE, and the initial WP8 report, closing 11.4.1.
Package auditing, both EXE SHA-256 checks, and `NotSigned` reverification were rerun after the
commit and remained consistent; package inputs had no differences from that commit, closing
11.4.4 as well. The later Action Node 24 upgrade is in current commit `8ebe524`; it changes
only workflows, tests, and documentation, not the two local outputs' inputs or hashes.

REST workflow-runs queries still return HTTP 404. This machine has no `gh`, and screenshots
do not establish whether attestation actually ran. Anonymous GitHub API queries for `8ebe524`
in the private repository also return HTTP 404, and the available browser has no GitHub tab
with access to that repository. Remote CI for `8ebe524` is therefore not presumed green;
obtained remote-green evidence is still restricted exactly to product commit `98b05b4`.
No external writes have been performed; authorization for public Windows binaries remains “no.”

On 2026-09-10, the owner confirmed the current account plan is GitHub Free, and the repository
page established WenShu is Private. Current official GitHub rules state artifact attestation
on Free, Pro, and Team applies only to public repositories; private/internal repositories need
GitHub Enterprise Cloud. This combination therefore does not support attestation, and 11.4.7
is closed as “conditionally unsupported, with the real reason recorded.” No variable was
enabled, fake provenance generated, OIDC established, release workflow run, or existing Draft modified.

## 7. Licensing, dependencies, and documentation

- `LICENSE` is the owner-selected MIT License, Copyright 2026 Jinxi Hu; package metadata is MIT.
- `THIRD_PARTY_NOTICES.txt` was regenerated and reverified from the current lockfile and packaged
  runtime roots, covering 103 packages. Final ASAR includes the same LICENSE/NOTICE. The
  upstream limitations disclosed in WP7 are retained: npm packages `dingbat-to-unicode@1.0.1`,
  `duck@0.1.12`, and `xmlbuilder@11.0.1` lack standalone license-body files. NOTICE preserves
  registry-metadata license identifiers and project links. This is not legal advice.
- README, PROJECT_BASELINE, DEVELOPMENT_ENVIRONMENT, TESTING, CHANGELOG, SECURITY, and this report
  align with current supported Electron, unsigned status, no update source, the theoretical Windows
  10 target, and physical-machine validation boundaries.
- No credentials, certificate private keys, real document content, userData, or absolute user paths
  were found in tracked files/artifacts. Reports use generic path descriptions without actual username paths.

## 8. Mapping of 33 acceptance items

| ID     | Status | Main evidence or retained reason                                                                                      |
| ------ | ------ | --------------------------------------------------------------------------------------------------------------------- |
| 11.1.1 | Passed | Electron 43.6.0; official stable/release schedule rechecked that day; actual final EXE/ASAR reads                     |
| 11.1.2 | Passed | 73 files, 1184 passed, 10 conditional skips; check/build both 0                                                       |
| 11.1.3 | Passed | Actual windows appeared in development, production E2E, unpacked, portable, and installed runs                        |
| 11.1.4 | Passed | Security configuration, contract tests, E2E, and actual fuse reads                                                    |
| 11.1.5 | Passed | Owner confirmed reuse of existing manual acceptance; current full regressions and E2E cover core semantics            |
| 11.2.1 | Passed | Package metadata, About, window, EXE, and audit report agree; no misrepresentation of the old tag                     |
| 11.2.2 | Passed | WP2 icon provenance/manual evidence; final installation files and shortcut resources present                          |
| 11.2.3 | Passed | Actual package:dir/package:win/verify success and fixed names                                                         |
| 11.2.4 | Passed | Detached unpacked launch; no source/Node/npm dependence                                                               |
| 11.2.5 | Passed | Two-level prohibited-content audit of ASAR and full unpacked output, 0 hits                                           |
| 11.2.6 | Passed | Actual final ASAR index, integrity, and fuse wire reads                                                               |
| 11.2.7 | Passed | Bytes, file counts, unpacked dependencies, and duplicates recorded                                                    |
| 11.3.1 | Passed | Owner revised to theoretical gate; PE/Electron/NSIS/dependency audit supports Win10 x64; physical machine later       |
| 11.3.2 | Passed | Owner confirmed no issues with per-user, no elevation, installation/installation over existing version/uninstallation |
| 11.3.3 | Passed | Owner confirmed no issues with Chinese/space-containing paths, standard-user directories, and Start menu entries      |
| 11.3.4 | Passed | Automated hashes match before/after; owner confirmed external workspace was neither modified nor deleted              |
| 11.3.5 | Passed | Owner confirmed no leftovers; current WenShu/Electron audit count 0; shown processes belong to development tools      |
| 11.3.6 | Passed | Owner confirmed Defender/SmartScreen behavior; both EXEs NotSigned, no timestamps                                     |
| 11.4.1 | Passed | Continuous integration #11 for main push `98b05b4` succeeded; sole CI job green                                       |
| 11.4.2 | Passed | Static workflow-permission and Action SHA audit; historical WP6 remote evidence                                       |
| 11.4.3 | Passed | Workflow structure, tests, and local dry-run rejecting the old tag                                                    |
| 11.4.4 | Passed | Packaging inputs match `98b05b4`; complete hashes, NotSigned, limitations, and reverification records                 |
| 11.4.5 | Passed | Both final EXEs actually measured NotSigned/no timestamp                                                              |
| 11.4.6 | Passed | Manifest generated after signature checks; reverification matched exactly                                             |
| 11.4.7 | Passed | Owner confirmed Private + GitHub Free; official rules require Enterprise Cloud for private repositories               |
| 11.4.8 | Passed | No external writes; old tag not moved; historical Draft boundaries recorded in WP6/WP7                                |
| 11.5.1 | Passed | Owner's MIT decision, actual LICENSE/package/ASAR reads                                                               |
| 11.5.2 | Passed | Lockfile-generated 103-package NOTICE, notices:check, and actual ASAR reads                                           |
| 11.5.3 | Passed | Specified documents individually updated and formatting checked                                                       |
| 11.5.4 | Passed | Documentation explicitly states no updater/telemetry/session restore/file association/multiplatform                   |
| 11.5.5 | Passed | Static scan, all tests, and timeout audit; all 10 skips are conditional capability probes                             |
| 11.5.6 | Passed | WP0 and this report contain commands, versions, packages, Windows, signatures, hashes, and CI boundaries              |
| 11.5.7 | Passed | This report distinguishes theoretical/physical-machine boundaries and explicitly states no public Alpha binaries      |

## 9. Optional future verification

These items do not block current Task 12 completion or authorize Windows 11, signing, or public-release work:

1. On a standard-user host provably running Windows 10 x64 build 19045, launch this exact commit's
   portable and NSIS-installed outputs and record OS build, windows/processes, and normal exit.
   The owner currently lacks this development environment, so this round explicitly skips it;
   it must not be claimed measured before execution;
2. If outputs are rebuilt for that future action, rerun `NotSigned → SHA-256 → verify` and
   update this report. Moving old tags, publishing binaries, or beginning signing remains prohibited.

## 10. Official references checked that day

- Electron [release schedule](https://releases.electronjs.org/schedule) and
  [stable releases](https://releases.electronjs.org/?channel=stable): checked supported lines and
  the latest stable Electron 43 patch on 2026-09-09;
- Electron [breaking changes](https://www.electronjs.org/docs/latest/breaking-changes/) and
  [Electron 43 release](https://releases.electronjs.org/release/v43.0.0): checked the Windows 10
  minimum-platform boundary, Windows x64 runtime, and v43 support lifecycle;
- electron-builder [NSIS documentation](https://www.electron.build/docs/nsis/): checked NSIS
  architecture, Unicode, and Windows installer semantics;
- Microsoft [Running 32-bit Applications](https://learn.microsoft.com/en-us/windows/win32/winprog64/running-32-bit-applications):
  checked x64 Windows WoW64 execution boundaries for standard 32-bit NSIS bootstrappers;
- electron-builder [publish documentation](https://www.electron.build/publish/): checked automatic
  repository detection, update metadata, and explicit publishing boundaries;
- Microsoft [Windows 11 release information](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information):
  checked that OS build 26200 belongs to Windows 11 25H2;
- GitHub [REST workflow runs](https://docs.github.com/en/rest/actions/workflow-runs) and
  [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax):
  checked remote run queries and least-privilege semantics.
