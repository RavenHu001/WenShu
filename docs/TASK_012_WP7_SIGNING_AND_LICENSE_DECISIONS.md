# TASK-012 WP7 所有者决策说明：签名与项目许可

本文把两个待选事项翻成非专业术语。它不是法律意见，也不会要求在对话、仓库或日志中提供私钥、
PFX 密码、token、证书 base64 或 Azure secret。

## 1. 已确认的发布范围

所有者确认 WenShu 作为开源程序仅通过 GitHub 源码仓库和 GitHub Releases 分发；没有提交
Microsoft Store 或其他正式商店的计划。商店上架不是 Authenticode 的前提：从 GitHub 下载的
portable 和 NSIS EXE 仍可由 Microsoft Artifact Signing 签名，让 Windows 和用户验证发布者及文件
是否被篡改。签名不构成商店审核、自动更新或 SmartScreen 无警告保证。

当前公开 Pre-release 仍未获授权。现有 Release 保持内部 Draft；完成签名、验签、哈希和精确标签绑定
后，是否公开仍需要所有者另行确认。

## 2. Windows 签名是什么

Authenticode 在 EXE 上附加“谁发布了这组确定字节”的可验证身份，并通过时间戳让签名在证书到期后
仍可验证。签名后再改一个字节都可能破坏签名，所以固定顺序必须是：包内容 → fuses/ASAR integrity
→ 签名 → 验签发布者和时间戳 → 最终 SHA-256 → 上传。

签名不会自动消除 SmartScreen。新文件或新发布者仍可能显示“未知应用”，Windows 11 的 Smart App
Control 或企业策略也可能阻止运行。自签名只适合测试流水线，不能称为公众受信任签名。

### 已选方案

所有者已选择 **Microsoft Artifact Signing + GitHub OIDC**。私钥由 Microsoft 管理，GitHub job 只用
短期 OIDC token，不保存 PFX、PFX 密码或 Azure client secret。electron-builder v27 使用
`win.sign.type: azure`。Azure 中应把联合身份限定到本仓库的 `alpha-release` Environment，并只授予
`Artifact Signing Certificate Profile Signer` 角色。

完成接入仍需 Azure 侧的 Public Trust 身份验证、受支持区域 endpoint、Artifact Signing account、
certificate profile，以及证书颁发后的精确 publisher subject。这些名称和 ID 不是私钥；仓库只引用
GitHub Environment 中的配置名称，不记录凭据值。

### 其他未选方案

1. **CA 的 OV/EV 证书 + HSM/硬件 token**：私钥留在硬件中，适合已有证书和运维能力的组织；
   GitHub 托管 runner 往往不能直接访问本地 USB token，通常需要受控自托管签名节点。v27 对应
   `type: hsm`（Windows）或特定非 Windows 场景的 `type: pkcs11`。EV 不再自动绕过 SmartScreen。
2. **受控 Windows 证书存储 / PFX（通常不推荐作为新公开流程的首选）**：配置最直接，但导出的
   PFX 和密码成为高价值长期秘密。若选择，必须使用专用 GitHub Environment secrets 或证书存储，
   不提交文件，不打印密码；v27 对应 `type: signtool`。
3. **继续未签名内部 Alpha**：无需账户或费用，但不能公开发布，也不能显示可信发布者。当前仓库就处于
   这一真实状态：`win.sign: false`。

接入所需的非秘密配置名是：Artifact Signing endpoint、account name、
certificate profile name，以及证书颁发后的精确 publisher subject。GitHub `alpha-release`
Environment 只保存 `AZURE_TENANT_ID`、`AZURE_CLIENT_ID`、`AZURE_SUBSCRIPTION_ID` 和上述资源名称；
workflow 通过 `azure/login` 的短期 OIDC 登录供 v27 Azure DLib 的 `DefaultAzureCredential` 使用。
不创建 `AZURE_CLIENT_SECRET`。只有签名 job 获得 `id-token: write` 和签名角色，PR/push CI 不得获得。
仓库和日志不会记录这些值。

## 3. 已确认的项目许可证

所有者已选择 **MIT License**，版权行为 `Copyright (c) 2026 Jinxi Hu`。根目录 `LICENSE` 是项目
自身代码的授权文本，`package.json` 使用 SPDX 标识 `MIT`。MIT 允许使用、复制、修改、合并、发布、
分发、再许可和销售软件副本，但要求在软件副本或重要部分中保留版权和许可文本，并按“原样”提供且
不附带担保。

MIT 不会自动授予 WenShu 名称、图标或其他品牌标识的商标权，也不会替代第三方依赖各自的许可证。
随二进制分发的第三方声明继续由 `THIRD_PARTY_NOTICES.txt`、Electron 和 Chromium 许可文件承载。
这些工程说明不是完整法律意见；如业务、雇佣、商标或第三方合同条件复杂，应请合格法律顾问复核。

## 4. 尚需外部完成的事项

1. 在 Azure 完成 Public Trust 身份验证并创建 Artifact Signing account/certificate profile；
2. 创建限定到 `repo:RavenHu001/WenShu:environment:alpha-release` 的 GitHub OIDC federated credential；
3. 向该服务主体仅授予 `Artifact Signing Certificate Profile Signer`；
4. 在 GitHub `alpha-release` Environment 配置 tenant/client/subscription ID 和签名资源名称；
5. 用精确标签/提交运行内部签名 Draft，逐个验签 portable/NSIS 后再生成 SHA-256；
6. 只有得到公开授权后，才把 Draft 改为公开 GitHub Pre-release。
