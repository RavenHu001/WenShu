# TASK-012 WP5 Report: Windows Installation, Upgrade, Uninstallation, and Real-Document Acceptance

[简体中文](./TASK_012_WP5_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Recorded: 2026-09-04; this report records actual WP5 execution. WP6 has not started.

## Environment and security state

- Current host: Windows 10 Home x64 (Windows version `2009`), standard user `TieJin\\CodexSandboxOffline`;
- Microsoft Word 16 is present; WPS Office was not detected on the current host; no Windows 11 x64 host is available;
- Defender is not running, and Smart App Control policy state is `0`. This machine cannot provide
  conclusions about Defender allowing execution or SmartScreen reputation;
- Both portable and NSIS are unsigned (Authenticode `NotSigned`). Unsigned-output behavior on this machine cannot be extrapolated to other users.

Current artifact SHA-256: portable `C82EE59A45D372AD2C324C2958A55533734783DB56CA3B397405E9897F1EA92F`;
NSIS `5DC63AA8FDC0B47314BB37DCEDDA2ABEE2075E7F17FDFA2E9F3ABF5F1F472B67`.

## Completed Windows artifact acceptance

- Portable launched from a unique temporary directory containing Chinese characters and spaces.
  The launcher process tree had 5 processes, with a nonzero actual main-window handle and the title
  “文枢”; the test directory and process tree were cleaned;
- NSIS silently installed as a standard user into default per-user path
  `%LOCALAPPDATA%\\Programs\\WenShu`, with installer exit code `0`. The installation contained
  `WenShu.exe`, `Uninstall WenShu.exe`, and Start menu shortcut `文枢.lnk`;
- The installed application launched with a nonzero main-window handle and the title “文枢”;
- Silent reinstallation of the same version exited with code `0` and took `12,359 ms`;
- Silent uninstallation exited with code `0` and took `3,287 ms`; the installation directory and Start menu shortcut were removed;
- Before installation, a unique temporary external workspace and an inventory of file SHA-256
  hashes/lengths were created. They matched exactly after installation, same-version reinstallation,
  and uninstallation; the external workspace was not modified.
- On 2026-09-04, the project owner manually confirmed no issues with installation, ordinary use,
  and deletion/uninstallation in the current Windows 10 environment. This confirmation supplements
  automated installation and external-workspace hash evidence. Windows 11, Alpha upgrade, and
  current-build Office retesting not explicitly reported remain subject to the limitations below.
- The owner subsequently confirmed no issues with basic bidirectional Word/WPS DOCX round trips
  in the current build, individual installed/portable GUI file workflows, and installation upgrading
  `alpha.0-test → alpha.1`. This is a manual acceptance conclusion; no independently reviewable
  Office/WPS versions, operation timings, or screen recordings were provided.
- Basic WPS DOCX bidirectional round trips use the existing Task 7 manual acceptance: they passed
  WPS Office review in a Windows 11 zh-CN environment; see sections 1 and 8.7 of
  `TASK_007_COMPLETION_REPORT.md`. The WPS version was not recorded then, so this WP does not
  describe it as fresh measurement of the current build.

## Known incomplete items

The following limitations have not been misrepresented as automated or cross-environment passes:

- The owner deferred the Windows 11 x64 matrix; that host is currently unavailable, so the two-system matrix cannot be completed;
- WPS is not currently installed, and there is no drivable real Word/WPS GUI session to add
  automated or version-recorded evidence for Office round trips in the current build. The owner
  manually confirmed the workflow had no issues; existing Task 7 WPS manual acceptance is also retained as historical compatibility evidence;
- Installation upgrading `alpha.0-test → alpha.1` has the owner's manual confirmation of no issues;
  the current workspace has no alpha.0-test installer for rerunning it;
- Actual TXT/DOCX opening, editing, saving, backup, external conflicts, read-only/degraded states,
  Recycle Bin restoration, revealing in Explorer, and dirty/saving close protection in final installed
  and portable outputs have manual confirmation of no issues on current Windows 10. WP4 E2E
  separately covers TXT, DOCX, backup, About, and dirty-tab closing. No individually reviewable GUI
  operation log for final hardened binaries was provided;
- Defender is not running and Smart App Control is disabled. Unobserved SmartScreen/Defender
  behavior must not be generalized into a claim that other machines will display no warnings.

**WP5 gate: not passed.** There is evidence for installation, reinstallation, uninstallation,
external-workspace invariance, and portable launch from a Chinese-character path on current
Windows 10, plus owner-confirmed upgrade, final file lifecycle, and Office/WPS round trips.
However, the owner still defers the Windows 11 x64 matrix, so the original two-system gate cannot be met.
