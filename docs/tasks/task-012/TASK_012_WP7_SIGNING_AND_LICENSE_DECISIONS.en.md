# TASK-012 WP7 Owner Decision Notes: Signing and Project Licensing

[简体中文](./TASK_012_WP7_SIGNING_AND_LICENSE_DECISIONS.md) | English

[Task archive](../README.en.md) · [Documentation](../../README.en.md)

This document explains two decisions in non-specialist terms. It is not legal advice, and it
does not request private keys, PFX passwords, tokens, certificate base64, or Azure secrets in
the conversation, repository, or logs.

## 1. Confirmed release scope

The owner confirmed that WenShu currently publishes only its MIT source code as an open-source
GitHub project. Portable and NSIS outputs remain in an internal Draft, without public downloads.
There is no plan to submit to Microsoft Store or another formal store.

Current internal-binary support evidence covers Windows 10 x64 only. Windows 11 acceptance
and support claims have also moved to optional future work; they will count as neither blockers
nor completed items for current Task 12/WP8.

Public source code does not require Authenticode. If public EXEs on GitHub Releases are approved
later, Microsoft Artifact Signing remains available to let Windows and users verify the publisher
and whether files were tampered with. Signing does not mean store approval, automatic updates,
or guaranteed absence of SmartScreen warnings. A public Pre-release is not currently authorized;
the existing binary Release remains an internal Draft.

## 2. What Windows signing means

Authenticode attaches a verifiable identity stating who published a specific set of bytes to an
EXE. A timestamp allows verification after the certificate expires. Changing even one byte
after signing may break the signature, so the fixed order must be: package contents → fuses/ASAR
integrity → signing → verify publisher and timestamp → final SHA-256 → upload.

Signing does not automatically remove SmartScreen warnings. A new file or publisher can still
appear as an “未知应用” (unknown app), and Windows 11 Smart App Control or enterprise policies
may block execution. Self-signing is suitable only for pipeline testing and cannot be called a
publicly trusted signature.

### Current decision

Trusted signing is not being integrated now. `win.sign: false` explicitly means that portable/NSIS
outputs are unsigned internal test artifacts. The workflow must individually confirm both EXEs
are `NotSigned` before generating SHA-256, and must not describe them as trusted public releases.

**Microsoft Artifact Signing + GitHub OIDC** remains optional future work, not a current WP7
blocker. Its trigger is the owner's future explicit approval of public portable/NSIS downloads.
At that point Microsoft still manages the private key, and the GitHub job uses only short-lived
OIDC tokens without storing a PFX, PFX password, or Azure client secret. electron-builder v27 uses
`win.sign.type: azure`.

### Other options not selected

1. **CA OV/EV certificate + HSM/hardware token**: the private key remains in hardware, suitable
   for organizations that already have certificates and operational capability. GitHub-hosted runners
   generally cannot access a local USB token directly; a controlled self-hosted signing node is
   usually needed. v27 uses `type: hsm` (Windows), or `type: pkcs11` for specific non-Windows cases.
   EV no longer automatically bypasses SmartScreen.
2. **Controlled Windows certificate store / PFX (usually not the preferred first choice for a
   new public workflow)**: configuration is the most direct, but the exported PFX and password
   become high-value, long-lived secrets. If selected, use dedicated GitHub Environment secrets
   or a certificate store; never commit the file or print the password. v27 uses `type: signtool`.
3. **Continue the unsigned internal Alpha**: no account or fees are required, but it cannot be
   published publicly or display a trusted publisher. This is the repository's actual current state: `win.sign: false`.

Future integration requires Azure Public Trust identity verification, an endpoint in a supported
region, an Artifact Signing account, a certificate profile, and the exact publisher subject after
certificate issuance. GitHub's `alpha-release` Environment stores only `AZURE_TENANT_ID`,
`AZURE_CLIENT_ID`, `AZURE_SUBSCRIPTION_ID`, and those resource names. The workflow signs in with
short-lived OIDC through `azure/login` for v27 Azure DLib. Do not create `AZURE_CLIENT_SECRET`.
Only the signing job receives `id-token: write` and the minimal
`Artifact Signing Certificate Profile Signer` role.

## 3. Confirmed project license

The owner selected the **MIT License**, with copyright line `Copyright (c) 2026 Jinxi Hu`.
Root `LICENSE` is the authorization text for the project's own code, and `package.json` uses
SPDX identifier `MIT`. MIT permits use, copying, modification, merging, publication, distribution,
sublicensing, and selling copies of the software, but requires retaining the copyright and
license text in copies or substantial portions, and provides it “as is” without warranty.

MIT does not automatically grant trademark rights in the WenShu name, icon, or other brand
identifiers, and does not replace third-party dependencies' own licenses. Third-party notices
distributed with binaries continue to be carried by `THIRD_PARTY_NOTICES.txt` and Electron and
Chromium license files. These engineering notes are not comprehensive legal advice. If business,
employment, trademark, or third-party contractual conditions are complex, seek review by qualified legal counsel.

## 4. Execute only when binaries become public in the future

1. Obtain the owner's explicit approval to publish portable/NSIS outputs;
2. Complete Azure Public Trust identity verification and create an Artifact Signing account/certificate profile;
3. Create a GitHub OIDC federated credential restricted to `repo:RavenHu001/WenShu:environment:alpha-release`;
4. Grant that service principal only `Artifact Signing Certificate Profile Signer`;
5. Configure tenant/client/subscription IDs and signing resource names in GitHub's `alpha-release` Environment;
6. Build a signed Draft from an exact tag/commit, and verify each portable/NSIS signature, timestamp,
   and publisher before generating SHA-256;
7. Complete package-content acceptance and separate Windows 10 and Windows 11 acceptance. Only then
   does the owner decide whether to make the Pre-release public.
