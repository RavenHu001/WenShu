# Security Policy

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

The WP8 local artifact inputs match exact product commit `98b05b4`, whose main-push CI passed, but the
final Windows 10 system matrix and artifact-attestation status have not been obtained. The artifacts
are therefore not a release candidate. Do not publish or redistribute them as a supported Alpha. See
`docs/TASK_012_COMPLETION_REPORT.md`.
