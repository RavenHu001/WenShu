# Changelog

All notable changes to WenShu are recorded here. The project is licensed under MIT and has not
yet made a public binary release.

## [Unreleased]

- Selected the MIT License, copyright 2026 Jinxi Hu.
- Selected Microsoft Artifact Signing with GitHub OIDC for future GitHub Releases distribution;
  trusted Authenticode signing remains blocked on Azure identity validation and signing resource
  configuration.
- Distribution is planned through GitHub Releases only. No Microsoft Store submission is planned.

## [0.1.0-alpha.1] - 2026-09-06

### Added

- Windows x64 portable and current-user NSIS packages for controlled Alpha testing.
- Local TXT and DOCX workspace browsing, multi-document editing, search/replace, safe save,
  backup, conflict handling, recycle-bin deletion, and unsaved-change protection.
- Package allowlist auditing, ASAR integrity, Electron fuse hardening, Electron E2E coverage,
  SHA-256 manifests, and a Draft GitHub pre-release workflow.

### Security and release status

- The current artifacts are unsigned internal Alpha builds. They are not approved for public
  distribution.
- The app has no automatic updater, telemetry, crash upload, or document-content upload.

[Unreleased]: https://github.com/RavenHu001/WenShu/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/RavenHu001/WenShu/releases/tag/v0.1.0-alpha.1
