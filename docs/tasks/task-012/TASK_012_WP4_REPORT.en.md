# TASK-012 WP4 Report: ASAR, Fuses, Package Verification, and Electron E2E

[简体中文](./TASK_012_WP4_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Recorded: 2026-09-04; this report records final WP4 verification. WP5 has not started.

## Completed fuse measurements

electron-builder `26.15.3` does not accept the `electronFuses` schema added in current documentation,
so the two approaches were not combined. A single `afterPack` hook using official
`@electron/fuses@1.8.0` was used instead. Reading with
`@electron/fuses read --app release/win-unpacked/WenShu.exe` returned:

| Fuse                                  | Final value                | Reason                                                                                          |
| ------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| RunAsNode                             | Disabled                   | The application does not use `ELECTRON_RUN_AS_NODE` or `process.fork()`.                        |
| EnableCookieEncryption                | Disabled                   | Chromium cookie identity state is unused; avoids a one-way migration of existing userData.      |
| EnableNodeOptionsEnvironmentVariable  | Disabled                   | Production does not accept `NODE_OPTIONS` / extra CA injection.                                 |
| EnableNodeCliInspectArguments         | Disabled                   | Final outputs do not accept inspect; E2E must use an unhardened build.                          |
| EnableEmbeddedAsarIntegrityValidation | Enabled                    | Supported by Windows Electron 43; builder has embedded ASAR integrity.                          |
| OnlyLoadAppFromAsar                   | Enabled                    | Blocks sideloading through `app/` and default app fallbacks.                                    |
| LoadBrowserProcessSpecificV8Snapshot  | Disabled                   | No custom V8 snapshot is shipped; preserves the default startup path.                           |
| GrantFileProtocolExtraPrivileges      | Enabled                    | The renderer currently loads through `loadFile()` / `file://`; this cannot be disabled blindly. |
| Ninth unnamed V1 wire bit             | Enabled (default retained) | `@electron/fuses@1.8.0` does not expose this Electron 43 wire item, so it is not flipped.       |

`package:dir`, `package:win`, the ASAR content audit, and fuse reads from final EXEs all passed.
`@playwright/test@1.62.1` was installed as an exact dev dependency and the lockfile updated.

## ASAR integrity startup rejection

All destructive verification used temporary copies only:

- The owner manually confirmed startup rejection when `app.asar` was tampered with;
- After automatically copying `release/win-unpacked` into a unique temporary directory, the copy's
  `resources/app.asar` was deleted. Running the copied EXE exited with code `1` and a main-window
  handle of `0`. Final outputs were not modified, and the temporary copy was deleted.

## Automated E2E and its boundary

All 4 isolated Electron E2E tests in `tests/e2e/electron-smoke.test.ts` passed:

1. Launch, controlled directory selection, and About `0.1.0-alpha.1`;
2. Exact UTF-8 bytes after TXT editing and saving;
3. Valid OOXML after DOCX saving and the original file's `.wenshu.bak`;
4. Dirty TXT close confirmation, with content retained after cancellation.

Tests use `ElectronApplication.evaluate` only to replace the main-process directory dialog's
return value; no test IPC was added to the product API. Each case uses and cleans a unique
workspace/userData. In the current automated desktop session, retaining the product renderer
sandbox causes the Playwright debugging pipe to close the renderer process. Therefore, drivable
unpacked E2E adds `--no-sandbox` and `--disable-gpu` only to test subprocesses. The product
`BrowserWindow` sandbox configuration and final fuses remain unchanged; black-box smoke tests
of final outputs supplement this boundary.

## Final outputs and black-box smoke tests

`package:verify -- --mode=win` passed: x64 unpacked `387,603,274 B`, `app.asar` `12,440,474 B`,
`app.asar.unpacked` `748,156 B`, portable `94,238,789 B`, and NSIS `94,537,943 B`. External
runtime dependencies are limited to `docx`, `jszip`, `mammoth`, and their transitive dependencies.

- unpacked: remained alive after launch, with a nonzero main-window handle and the title “文枢”; isolated userData was cleaned after exit;
- portable: the launcher and 5 matching processes remained alive; the actual application subprocess
  had a nonzero main-window handle and the title “文枢”; isolated userData was cleaned after exit;
- NSIS: the installer launched, then silently installed into a unique temporary directory. Installed
  `WenShu.exe` created a visible main window titled “文枢” (4 matching processes). Silent
  uninstallation followed, leaving no installation directory, userData, or WenShu/Electron processes.

Final EXE fuse reads match the table above. No detectable extra application windows or processes
appeared during black-box launches. Full `npm run check`, production `build`, `package:dir`,
`package:win`, and package audits were all actually run.

**WP4 gate: passed.** The automated E2E sandbox limitation and the evidence boundary of manual
ASAR tampering are explicitly recorded. WP5 has not started.
