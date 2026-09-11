# Security Policy

[Project overview](./README.en.md) · [Documentation](./docs/README.en.md) ·
[Release notes](./docs/releases/README.en.md)

## Supported versions

WenShu `0.1.0-alpha.1` is an internal, unsigned Alpha. It is intended only for controlled testing;
there is currently no supported public release channel or automatic security-update mechanism.

## Reporting a vulnerability

Prefer GitHub's private vulnerability-reporting or Security Advisory channel for this repository
when it is available. If it is not available, contact the repository owner privately through the
owner's GitHub profile before opening a public issue. Do not put exploit details, private documents,
credentials, tokens, certificate material, or unredacted logs in a public issue.

In a report, include the WenShu version, Windows version, a minimal reproduction using synthetic
documents, and the security impact. Replace user names and absolute paths with neutral placeholders.
Do not attach real TXT/DOCX content, `.wenshu.bak` files, workspace inventories, Chromium userData,
or screenshots containing personal information.

## Current security boundaries

- Documents and workspaces remain local unless the user independently chooses to share them.
- WenShu has no telemetry, crash reporter, automatic document upload, or automatic updater.
- Builder publish metadata is explicitly disabled, and package verification rejects an inferred
  `resources/app-update.yml`; update/release metadata must not enter the application package.
- Renderer Node integration is disabled; context isolation and Chromium sandboxing remain enabled.
- The current Alpha artifacts are not Authenticode signed. Verify `SHA256SUMS.txt` before use and
  obtain artifacts only from the owner-controlled Draft release or another explicitly trusted path.
- A future valid signature will identify the publisher and protect signed bytes from modification,
  but it will not guarantee that SmartScreen or Smart App Control shows no warning.

Because there is no automatic updater, security fixes require manually downloading a newer verified
portable package or installer. Installing, upgrading, uninstalling, or downgrading must never be used
to delete or replace external workspace documents.

The WP8 local artifact inputs match exact product commit `98b05b4`, whose main-push CI passed. The
owner confirmed the install, upgrade, uninstall, path, workspace-integrity, residue, Defender, and
SmartScreen checks. The Windows 10 x64 theoretical compatibility audit passed, while physical
Windows 10 validation is explicitly deferred and must not be claimed as completed testing. The owner
also confirmed that this private repository uses GitHub Free, under which private-repository artifact
attestations are unavailable. The artifacts remain internal and unsigned. Do not publish or
redistribute them as a supported public Alpha. See
[Task 12 completion report](./docs/tasks/task-012/TASK_012_COMPLETION_REPORT.en.md).
