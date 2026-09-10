# Changelog

All notable changes to WenShu are recorded here. The project is licensed under MIT and has not
yet made a public binary release.

## [Unreleased]

- Updated the supported Electron 43 line to exact patch `43.6.0`.
- Explicitly disabled builder publish metadata and added full unpacked-tree checks so an inferred
  `app-update.yml`, environment/credential material, userData, or unindexed ASAR-unpacked file
  blocks packaging.
- Updated the release workflow's upload/download artifact Actions to immutable Node.js 24 releases
  after the pre-WP8 remote run reported Node.js 20 deprecation annotations.
- Completed the WP8 local build/package/E2E/unsigned/hash audit: 26 of 33 acceptance criteria have
  evidence; 7 remain open because final Windows 10 system evidence and artifact attestation status
  are unavailable. Main push CI passed for exact product commit `98b05b4`.
- Selected the MIT License, copyright 2026 Jinxi Hu.
- Public distribution is source-only through GitHub under MIT. Binary artifacts remain in an
  unsigned internal Draft; no Microsoft Store submission is planned.
- Limited the current internal binary acceptance scope to Windows 10 x64; Windows 11 validation
  and any support claim are deferred as optional future work.
- Deferred Microsoft Artifact Signing with GitHub OIDC as an optional future task if public
  portable/NSIS distribution is later approved.

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
