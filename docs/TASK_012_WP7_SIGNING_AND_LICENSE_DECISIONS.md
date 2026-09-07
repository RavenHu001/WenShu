# TASK-012 WP7 所有者决策说明：签名与项目许可

本文把两个待选事项翻成非专业术语。它不是法律意见，也不会要求在对话、仓库或日志中提供私钥、
PFX 密码、token、证书 base64 或 Azure secret。

## 1. 已确认的发布范围

所有者确认 WenShu 当前只把 MIT 源码作为开源项目放在 GitHub；portable 和 NSIS 只保留在内部
Draft，不作为公开下载。没有提交 Microsoft Store 或其他正式商店的计划。

公开源码不要求 Authenticode。未来如果决定在 GitHub Releases 公开 EXE，仍可使用 Microsoft
Artifact Signing，让 Windows 和用户验证发布者及文件是否被篡改。签名不构成商店审核、自动更新或
SmartScreen 无警告保证。当前公开 Pre-release 未获授权，现有二进制 Release 保持内部 Draft。

## 2. Windows 签名是什么

Authenticode 在 EXE 上附加“谁发布了这组确定字节”的可验证身份，并通过时间戳让签名在证书到期后
仍可验证。签名后再改一个字节都可能破坏签名，所以固定顺序必须是：包内容 → fuses/ASAR integrity
→ 签名 → 验签发布者和时间戳 → 最终 SHA-256 → 上传。

签名不会自动消除 SmartScreen。新文件或新发布者仍可能显示“未知应用”，Windows 11 的 Smart App
Control 或企业策略也可能阻止运行。自签名只适合测试流水线，不能称为公众受信任签名。

### 当前决定

当前不接入受信任签名：`win.sign: false` 明确表示 portable/NSIS 只是未签名内部测试产物。workflow
必须逐个确认两个 EXE 均为 `NotSigned` 后才生成 SHA-256，且不得把它们描述成可信公开发行版。

**Microsoft Artifact Signing + GitHub OIDC** 保留为未来可选工作，不是当前 WP7 阻塞项。触发条件是
所有者以后明确批准公开 portable/NSIS。届时私钥仍由 Microsoft 管理，GitHub job 只使用短期 OIDC
token，不保存 PFX、PFX 密码或 Azure client secret；electron-builder v27 使用
`win.sign.type: azure`。

### 其他未选方案

1. **CA 的 OV/EV 证书 + HSM/硬件 token**：私钥留在硬件中，适合已有证书和运维能力的组织；
   GitHub 托管 runner 往往不能直接访问本地 USB token，通常需要受控自托管签名节点。v27 对应
   `type: hsm`（Windows）或特定非 Windows 场景的 `type: pkcs11`。EV 不再自动绕过 SmartScreen。
2. **受控 Windows 证书存储 / PFX（通常不推荐作为新公开流程的首选）**：配置最直接，但导出的
   PFX 和密码成为高价值长期秘密。若选择，必须使用专用 GitHub Environment secrets 或证书存储，
   不提交文件，不打印密码；v27 对应 `type: signtool`。
3. **继续未签名内部 Alpha**：无需账户或费用，但不能公开发布，也不能显示可信发布者。当前仓库就处于
   这一真实状态：`win.sign: false`。

未来接入时，需要 Azure Public Trust 身份验证、受支持区域 endpoint、Artifact Signing account、
certificate profile 和证书颁发后的精确 publisher subject。GitHub `alpha-release` Environment 只保存
`AZURE_TENANT_ID`、`AZURE_CLIENT_ID`、`AZURE_SUBSCRIPTION_ID` 和上述资源名称；workflow 通过
`azure/login` 短期 OIDC 登录供 v27 Azure DLib 使用。不创建 `AZURE_CLIENT_SECRET`。只有签名 job
获得 `id-token: write` 和最小 `Artifact Signing Certificate Profile Signer` 角色。

## 3. 已确认的项目许可证

所有者已选择 **MIT License**，版权行为 `Copyright (c) 2026 Jinxi Hu`。根目录 `LICENSE` 是项目
自身代码的授权文本，`package.json` 使用 SPDX 标识 `MIT`。MIT 允许使用、复制、修改、合并、发布、
分发、再许可和销售软件副本，但要求在软件副本或重要部分中保留版权和许可文本，并按“原样”提供且
不附带担保。

MIT 不会自动授予 WenShu 名称、图标或其他品牌标识的商标权，也不会替代第三方依赖各自的许可证。
随二进制分发的第三方声明继续由 `THIRD_PARTY_NOTICES.txt`、Electron 和 Chromium 许可文件承载。
这些工程说明不是完整法律意见；如业务、雇佣、商标或第三方合同条件复杂，应请合格法律顾问复核。

## 4. 未来公开二进制时才执行

1. 所有者明确批准公开 portable/NSIS；
2. 在 Azure 完成 Public Trust 身份验证并创建 Artifact Signing account/certificate profile；
3. 创建限定到 `repo:RavenHu001/WenShu:environment:alpha-release` 的 GitHub OIDC federated credential；
4. 向该服务主体仅授予 `Artifact Signing Certificate Profile Signer`；
5. 在 GitHub `alpha-release` Environment 配置 tenant/client/subscription ID 和签名资源名称；
6. 用精确标签/提交构建签名 Draft，逐个验证 portable/NSIS 的签名、时间戳和发布者后再生成 SHA-256；
7. 完成包内容和 Windows 10/11 验收，最后才由所有者决定是否公开 Pre-release。
