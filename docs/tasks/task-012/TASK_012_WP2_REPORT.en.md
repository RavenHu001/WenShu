# TASK-012 WP2 Report: Application Identity, Version, Icons, and About

[简体中文](./TASK_012_WP2_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Recorded: 2026-08-28; preceding recovery point: `0bc1d4b` (WP1: update to the latest Electron).

## Completed work

- Fixed `package.json.version` at `0.1.0-alpha.1` and `productName` at `文枢`, with
  `appId=io.github.ravenhu001.wenshu` and `executableName=WenShu` fixed in the `wenshu` identity fields.
- Added `app-metadata.config.ts`: at build time, it reads only the committed `package.json` and
  injects the same fixed identity constants into main, preload, and renderer. The version is not read from user environment variables.
- Main sets the Windows AppUserModelID before creating a window; the window title now comes from the fixed product name.
- The existing read-only preload `runtime` snapshot adds only `appVersion`; no IPC channel,
  parameter, path, process, filesystem, or general-purpose invocation capability was added.
- About displays the Alpha designation, product version, platform, and Electron version.
- Added `build/icon.png` and `build/icon.ico`. The ICO contains 32-bit RGBA layers at 16, 20, 24,
  32, 40, 48, 64, 128, and 256 pixels, matching the later electron-builder default resource convention
  of `build/icon.ico`. This work package did not install or configure electron-builder.

## Automated evidence

| Item              | Measured result                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Targeted tests    | 4 files, 35 tests passed: identity/version shape, icon dimensions/formats, About presentation, exact preload runtime shape, and frozen objects. |
| Full Vitest suite | 71 test files, 1179 passed, 0 failed, 10 conditionally skipped. All skips are existing Windows symlink/junction permission cases.               |
| `check`           | Exit code 0.                                                                                                                                    |
| `build`           | Exit code 0; main 155.17 kB, preload 4.30 kB, renderer JS 2,264.13 kB.                                                                          |
| Production launch | Launched 4 Electron processes with isolated userData, without startup errors, then cleaned up.                                                  |

Static inspection confirmed that the build outputs contain `0.1.0-alpha.1`,
`io.github.ravenhu001.wenshu`, `文枢`, and `WenShu`. About component tests cover the version,
Alpha designation, platform, and Electron version. Automatic dialog capture with hidden windows
did not produce usable completion evidence and cannot replace the owner's manual inspection of visible About UI.

## Icon provenance and gate

On 2026-08-28, the project owner explicitly authorized generating an original icon in a suitable
style within WP2. The final asset was generated with OpenAI's built-in ImageGen (`gpt-image-2`),
using a prompt restricted to a dark blue background, a folded-page document, and a vermilion brushstroke.
No assets were downloaded from the web, and neither functional SVGs nor visual baseline screenshots
were presented as a brand icon. The generated PNG retains C2PA provenance metadata; the ICO was
exported from that PNG source without loss. Full provenance is recorded in `build/README.md`.

Automated tests cover icon dimensions and formats. Version, identity, About, the read-only runtime
protocol, and icon resources meet the WP2 automated gate. The owner still needs to inspect visible
production About UI once for the manual acceptance record. WP3 has not started.
