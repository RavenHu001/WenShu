# WenShu development environment

[简体中文](./DEVELOPMENT_ENVIRONMENT.md) | English

[Development and testing](./README.en.md) · [Documentation](../README.en.md)

## Goal

Development uses a project-local toolchain. Node.js, npm, and npm dependencies all live in the repository directory; they do not depend on a global Node.js installation on the system PATH:

```text
.node-version                         Pinned Node.js version
.tools/node-v<version>-win-<arch>/     Local Node.js and npm; not committed to Git
node_modules/                         npm dependencies; not committed to Git
package-lock.json                     Dependency resolution; committed to Git
scripts/                              Bootstrap scripts and fixed-environment command entry points
```

This is not a process or operating-system sandbox. For reproducible development, however, it resembles a Python virtual environment: each project uses its own runtime version and dependency directory.

## Initialization

Run from the repository root:

```powershell
.\scripts\bootstrap.cmd
.\scripts\npm.cmd ci
```

`bootstrap.cmd` invokes the internal PowerShell script with process-level `ExecutionPolicy Bypass`, so it works in Windows environments that prohibit direct execution of `npm.ps1`. It does not change the system PowerShell execution policy.

The bootstrap process:

1. Reads the exact version from `.node-version`.
2. Selects the x64 or ARM64 portable package for the Windows host.
3. Downloads the archive and `SHASUMS256.txt` from the official Node.js release directory.
4. Verifies the archive's SHA-256 hash.
5. Extracts it into `.tools/`.
6. Prints the actual Node.js and npm versions.

The script can be run repeatedly. It does not download again when a complete toolchain with the matching version already exists.

## Command entry points

- `scripts/node.cmd`: runs the project-local `node.exe`.
- `scripts/npm.cmd`: runs project-local npm and temporarily places the local Node.js first on the current process PATH.
- `scripts/dev.cmd`: shortcut for starting development.

Examples:

```powershell
.\scripts\node.cmd --version
.\scripts\npm.cmd --version
.\scripts\npm.cmd run check
.\scripts\npm.cmd run build
```

The pinned toolchain is Node.js `22.15.0`, npm `10.9.2`, and Electron `43.6.0`. If the Electron runtime is not yet present after a clean `npm ci`, run this before E2E testing or packaging:

```powershell
.\scripts\npm.cmd exec -- install-electron --no
```

The wrappers change only their own environment and that of their child processes, not the user or system PATH.

## Updating Node.js

Treat a runtime update as an explicit engineering change:

1. Update `.node-version`.
2. Check `engines` and `packageManager` in `package.json` at the same time.
3. Run `scripts\bootstrap.cmd`.
4. Perform a clean installation with `scripts\npm.cmd ci`.
5. Run `scripts\npm.cmd run check` and `scripts\npm.cmd run build`.
6. Launch an actual Electron window.
7. Record the verification results in the task report.

Older version directories remain under `.tools/`. They can be deleted manually after the new version passes all verification.

## Troubleshooting

### Restricted downloads

The bootstrap script downloads from the official Node.js release directory by default. If the network cannot download large files from that source, set a compatible mirror for the current command only:

```powershell
$env:WENSHU_NODE_DIST_URL = 'https://npmmirror.com/mirrors/node'
.\scripts\bootstrap.cmd
Remove-Item Env:WENSHU_NODE_DIST_URL
```

The mirror supplies only ZIP data. The script still retrieves the versioned `SHASUMS256.txt` from the official Node.js directory and checks the ZIP against it; it does not trust hashes supplied by the mirror. This variable is not saved in project configuration and does not permanently change the system environment.

If the official checksum file is also inaccessible, download the matching Windows ZIP and its adjacent `SHASUMS256.txt` in another trusted environment. Check the hash manually, then copy the complete toolchain directory into `.tools/`.

### Incomplete toolchain

If downloading or extraction is interrupted, the script refuses to use the incomplete directory and reports its path. Delete only the indicated version directory, then rerun `scripts\bootstrap.cmd`. Do not delete the whole project or other version directories.

### Broken dependencies

When the toolchain works but npm dependencies are broken, first run:

```powershell
.\scripts\npm.cmd ci
```

`npm ci` rebuilds `node_modules` from the lockfile. Do not bypass dependency conflicts with `--force`.

### Windows line endings and formatting checks

Development takes place on Windows, but source and documentation must follow the repository's shared line-ending policy. Git's `core.autocrlf`, `.gitattributes`, and Prettier's `endOfLine` must agree. Otherwise Git may report a clean working tree while `prettier --check` fails because of CRLF/LF differences on disk.

For diagnosis, inspect:

```powershell
git config --get core.autocrlf
Get-Content .gitattributes
Get-Content .prettierrc.json
.\scripts\npm.cmd run format:check
```

Do not merely disable line-ending checks in a personal editor. Fix the policy in repository configuration and verify changes with a fresh checkout or equivalent renormalization. Bulk normalization can affect many files; inspect the working tree and protect the user's existing changes before proceeding.

### Vitest worker or filesystem test timeouts

If tests encounter `vitest-worker` communication timeouts, temporary-directory initialization timeouts, or stuck symlink/junction probes:

1. Run the failing test file alone to distinguish application assertions from test infrastructure failures.
2. Verify that ordinary files can be created and deleted in the system temporary directory.
3. Reproduce in both ordinary local PowerShell and the controlled environment, recording differences.
4. If symbolic links are unsupported, skip only the corresponding real-link cases and retain deterministic safety coverage through adapter mocks.
5. If needed, use a controlled worker count for filesystem tests; do not hide deadlocks behind arbitrarily long timeouts.
6. Rerun the complete `check` and `build` after fixing the issue.

Task 4 WP0 made these mandatory gates before implementing the first write capability. See the [TASK-004 plan](../tasks/task-004/TASK_004_TXT_EDIT_SAFE_SAVE.en.md).

### Restricted Electron downloads

After `npm ci` installs the Electron npm package, the matching Electron runtime must also be downloaded. If connections to the official binary endpoint reset on the current network, specify a mirror for this installation command only:

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
.\scripts\npm.cmd ci
.\scripts\npm.cmd exec -- install-electron --no
Remove-Item Env:ELECTRON_MIRROR
```

This variable is not saved in npm configuration or the repository. `package-lock.json` still pins the Electron npm package and other dependency versions.

## Release environment versus development environment

`.tools/` serves only source development and builds. Task 12's internal Electron packages include the Electron, Chromium, and Node.js components needed to run the application. Ordinary testers do not need to install or retain a local development toolchain. The packages have no automatic update source: the builder configuration explicitly sets `publish: null`, and final auditing prohibits `resources/app-update.yml`.

The complete local gates for internal Windows artifacts are:

```powershell
.\scripts\npm.cmd run check
.\scripts\npm.cmd run build
.\scripts\npm.cmd run package:dir
.\scripts\npm.cmd run package:win
.\scripts\npm.cmd run package:verify -- --mode=win
.\scripts\npm.cmd run test:e2e
.\scripts\npm.cmd run release:manifest:unsigned
.\scripts\npm.cmd run release:verify:unsigned
```

These commands only build and verify unsigned internal artifacts. They do not authorize pushing, tagging, signing, or public release. For theoretical Windows 10 compatibility, the scope of later physical-machine validation, remote CI, and known limitations, see the [TASK-012 completion report](../tasks/task-012/TASK_012_COMPLETION_REPORT.en.md).
