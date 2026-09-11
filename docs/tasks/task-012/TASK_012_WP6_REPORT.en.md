# TASK-012 WP6 Report: Windows CI, Release Workflow, and Provenance Evidence

[简体中文](./TASK_012_WP6_REPORT.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

> Recorded: 2026-09-06; branch: `TASK-12`; scope is WP6 only. Remote CI, the tag workflow,
> Draft Pre-release, and SHA-256 after download have been accepted through actual execution; WP7 has not started.

## 1. Changes in this work package

- Added `.github/workflows/ci.yml`: on Windows `windows-2025`, it reads exact Node `22.15.0`
  from `.node-version` and runs `npm ci`, `npm run build`, `npm run check`, and the existing
  Playwright Electron E2E. Build must precede the full check: the latter includes E2E, which needs production entries in `out/`.
- Added `.github/workflows/release.yml`: accepts only a `v*` pushed tag or `workflow_dispatch`
  with a required tag input. After checking out that tag, it strictly validates `v<version>`
  against actual `package.json.version`, records the built commit, and reruns clean installation,
  check, E2E, packaging, package auditing, and SHA-256 verification. It does not reuse uploads of unknown origin.
- The release build job is read-only and uses GitHub attestation only when repository variable
  `ENABLE_ARTIFACT_ATTESTATION == 'true'`. `draft-release` is the only job with `contents: write`
  and belongs to the `alpha-release` Environment. If signing is authorized in WP7, the signing
  service should be integrated inside this protected job, before upload.
- Added `tests/workflow-config.test.ts` to prevent accidental removal of restrictions on CI write
  permissions, non-npm caching, pinned Actions, tag/version validation, Draft semantics, or pre-release hash verification.

## 1.1 2026-09-05: First GitHub CI failures and fixes

The first remote CI result had two failure categories, neither showing a product-feature assertion error:

- `npm run check` ran before `npm run build`. `check` includes full Vitest and therefore launches
  Electron E2E; the clean GitHub runner did not yet have production entrypoints such as
  `out/main/index.js`. All four E2E cases therefore exited at `electron.launch()` with
  “系统找不到指定路径” (the system cannot find the specified path).
- The 2000-match DOCX replace-all test exceeded its default 5 seconds when competing with four
  forks and jsdom/Electron workloads on GitHub Windows. This was not a logic failure locally or under CI simulation.

The fix extends no test timeout and skips no E2E: both CI and release now build before checking.
With `CI=true`, Vitest still uses an isolated fork pool, but the maximum is reduced from 4 to 2
to reduce contention. The workflow guardrail test also asserts build precedes check. This
concurrency control uses Vitest-supported fork worker configuration rather than relaxing quality thresholds.

## 1.2 2026-09-06: Fixing repository selection in the Draft release job

In the real tag workflow, `Rebuild and verify release artifacts`, artifact download, and SHA-256
reverification all succeeded. `draft-release` failed at its first `gh release view` with
`not a git repository`. That job deliberately does not check out source, so GitHub CLI could
not infer a default repository from the working directory.

The fix passes `--repo $env:GITHUB_REPOSITORY` explicitly to `gh release view` and
`gh release create`, avoiding expansion of the job or a source checkout. It also adds
`--verify-tag` to prevent GitHub CLI from creating a new tag from the default branch when the
tag is absent. The guardrail test covers both arguments. The release workflow still needed
rerunning after the fix; the preceding failed run created no Release.

## 1.3 2026-09-06: Successful remote release rehearsal and Environment exception

The fixed `Build internal Alpha draft #3` succeeded through `workflow_dispatch`: both
`Rebuild and verify
release artifacts` and `Upload approved Draft pre-release` completed, and
the workflow uploaded one internal artifact. The GitHub Release page confirmed
`文枢 v0.1.0-alpha.1` as a **Draft**, containing `SHA256SUMS.txt`, portable EXE, NSIS EXE,
and blockmap. The release note identifies an unsigned internal Alpha and the corresponding
source commit. The owner downloaded the EXEs and confirmed their SHA-256 matched `SHA256SUMS.txt`.

On the `alpha-release` Environment page, the owner confirmed the current account/repository has
no `Required reviewers` option, and explicitly decided WP6 would not require changing repository
visibility, purchasing/migrating a plan, or fabricating approval. This is recorded as an external
account-capability exception. The Draft remains private, and workflow least privilege and
Draft-only behavior remain unchanged; this must not be described as completed manual GitHub Environment approval.

## 2. Permissions, caching, and Action sources

Global release permissions default to `permissions: {}`; scopes not explicitly listed are none,
following GitHub's [workflow permissions semantics](https://docs.github.com/actions/reference/workflows-and-actions/workflow-syntax#defining-access-for-the-github_token-scopes).
CI explicitly has only `contents: read` and receives no signing, OIDC, attestation, or Release
write permissions. `setup-node` uses `cache: npm` and `package-manager-cache: false`: it caches
only npm downloads, not `node_modules`, `out/`, or release outputs.

| Action            | Pinned SHA / readable version                       | Purpose                                                         | Required permissions                                                 | Maintainer / alternative                                                                           |
| ----------------- | --------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| checkout          | `08c6903cd8c0fde910a37f88322edcfb5dd907a8` / v5.0.0 | Check out a PR, branch, or exact tag                            | `contents: read`                                                     | GitHub; native git is possible but loses the official Action's standard authentication handling.   |
| setup-node        | `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` / v6.4.0 | Read `.node-version` and cache npm downloads                    | `contents: read`                                                     | GitHub; manual Node installation is possible but lacks maintained cache integration.               |
| upload-artifact   | `ea165f8d65b6e75b540449e92b4886f43607fa02` / v4.6.2 | Transfer verified files from build to the protected release job | No additional `GITHUB_TOKEN` write permission                        | GitHub; external object storage is possible but expands credential exposure.                       |
| download-artifact | `634f93cb2916e3fdff6788551b99b062d0335ce0` / v5.0.0 | Download only the verified named artifact from this workflow    | No additional `GITHUB_TOKEN` write permission                        | GitHub; GitHub CLI download is possible but offers no smaller permission footprint.                |
| attest            | `a1948c3f048ba23858d222213b7c278aabede763` / v4.1.1 | Conditionally generate binary provenance attestations           | Build job `contents: read`, `id-token: write`, `attestations: write` | GitHub; keep disabled and document in ineligible repositories, rather than fabricating provenance. |

Full SHAs were resolved from releases/tags in the official Action repositories above, and workflow
tests check each is 40 hexadecimal characters. See the [official setup-node documentation](https://github.com/actions/setup-node#caching-global-packages-data)
for cache behavior, and [GitHub's official explanation](https://docs.github.com/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
for artifact attestation permissions and repository eligibility.

## 3. Release and provenance controls

The release job rebuilds only from the commit checked out for the current tag. The version is not
read from environment variables. Tags, versions, and dynamic artifact names relate as follows:

```text
v0.1.0-alpha.1 -> package.json 0.1.0-alpha.1
                 -> WenShu-0.1.0-alpha.1-portable-x64.exe
                 -> WenShu-0.1.0-alpha.1-setup-x64.exe
```

After packaging, `SHA256SUMS.txt` is generated from actual EXE bytes and each hash is recomputed
and verified. After upload, `draft-release` verifies again before allowing
`gh release create --draft --prerelease`. An existing Release with the same name causes failure
rather than replacement. The workflow has no command to make a Draft public. Draft notes identify
“未签名内部 Alpha” (unsigned internal Alpha), include the source commit, and instruct users to verify hashes.

The current account/repository does not provide Required reviewers for `alpha-release`; the owner
accepted the external exception in section 1.3. Evidence in this report does not confirm remote
tag protection configuration. Attestation stays off by default and runs only after the owner
confirms repository eligibility and explicitly sets the repository variable. There is no evidence
of attestation generation or verification; configuration must not be presented as proof of success.

## 4. Actual local verification

Execution used Node `v22.15.0` / npm `10.9.2` and the lockfile. The first clean-install attempt
was affected by npm cache/network restrictions in the restricted execution environment; after
approval, `npm ci` completed using the project lockfile. Electron binary installation also used
the authorized mainland-China mirror to restore locked `electron@43.4.1`, without modifying the package or lockfile.

| Command / check                                | Actual result                                                                                                                                                                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run tests/workflow-config.test.ts` | 1 file, 3 tests passed.                                                                                                                                                                                                                  |
| Prettier on both YAML files and workflow tests | Passed.                                                                                                                                                                                                                                  |
| `npm run check`                                | 74 test files passed, 1188 passed, 10 existing conditional skips, 0 failed; includes Electron E2E 4/4 passed.                                                                                                                            |
| `npm run build`                                | Passed; main 155.17 kB, preload 4.30 kB, renderer JS 2,264.13 kB.                                                                                                                                                                        |
| `npm run package:win`                          | Passed: electron-builder 26.15.3, Electron 43.4.1, portable and per-user NSIS x64 generated, followed by a passing package audit.                                                                                                        |
| Release SHA rehearsal                          | Passed; actually generated and reverified `SHA256SUMS.txt`. Portable: `64f61d0de5022a699cfa968626f9aac455820a147c3b0828214f80e83db2139d`; NSIS: `49f61ad5485a4ac63972f838717277169ca89047fa8e42238e8346da139109f1`.                      |
| Fixed CI-equivalent sequence (`CI=true`)       | `npm run build` → `npm run check`: 74 test files passed, 1188 passed, 10 skipped; followed by standalone Electron E2E 4/4 passed. The targeted 2000-match DOCX replace-all test passed (about 0.65 s), without changing its 5 s timeout. |

This package audit detected x64 (PE machine `0x8664`): unpacked 387,603,274 B,
`app.asar` 12,440,474 B, `app.asar.unpacked` 748,156 B, portable 94,238,793 B, and NSIS
94,537,990 B. Actual external main-process dependencies remain `docx`, `jszip`, and `mammoth`;
the package audit passed.

## 5. Unexecuted items and WP6 gate conclusion

The first remote CI failures received minimal fixes. The fixed CI, tag workflow, artifact upload,
Draft Release, and post-download SHA-256 all have actual success evidence. There is no success
evidence for manual GitHub Environment approval or artifact attestation: the former falls under
the owner-accepted account-capability exception; the latter is disabled and eligibility is unknown.

**WP6 local implementation and reproducible-build gates passed.** PR/push CI least privilege,
exact Node, clean installation, npm-download-only caching, pinned Action SHAs, release
tag/version/commit validation, rebuild/package audit, hashes, and Draft-only semantics all have
automated or actual local evidence.

**WP6 available remote-execution gates passed, with explicit limitations retained.** Remote CI,
tag/version/commit rebuild, package audit, SHA-256, Draft creation, and download reverification
all passed; the Release is not public. Required reviewers for `alpha-release` were skipped by
the owner's decision because the current account/repository capability is unavailable; independent
GitHub approval must not be claimed. The owner should still confirm tag protection in GitHub
Settings. Attestation may be enabled as additional provenance evidence only after eligibility is
confirmed. This work package does not proceed to WP7.
