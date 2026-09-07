# TASK-012 WP7 所有者决策说明：签名与项目许可

本文把两个待选事项翻成非专业术语。它不是法律意见，也不会要求在对话、仓库或日志中提供私钥、
PFX 密码、token、证书 base64 或 Azure secret。

## 1. Windows 签名是什么

Authenticode 在 EXE 上附加“谁发布了这组确定字节”的可验证身份，并通过时间戳让签名在证书到期后
仍可验证。签名后再改一个字节都可能破坏签名，所以固定顺序必须是：包内容 → fuses/ASAR integrity
→ 签名 → 验签发布者和时间戳 → 最终 SHA-256 → 上传。

签名不会自动消除 SmartScreen。新文件或新发布者仍可能显示“未知应用”，Windows 11 的 Smart App
Control 或企业策略也可能阻止运行。自签名只适合测试流水线，不能称为公众受信任签名。

### 可选方案

1. **Microsoft Artifact Signing（推荐用于后续公开 Alpha）**：密钥由 Microsoft 云服务管理，CI
   不保存 PFX；需要 Azure 账户、付费服务、发布者身份验证、证书配置文件和最小的
   `Artifact Signing Certificate Profile Signer` 角色。对当前 GitHub Actions，可优先采用 OIDC
   工作负载联合，避免长期 client secret。electron-builder v27 对应 `win.sign.type: azure`。
2. **CA 的 OV/EV 证书 + HSM/硬件 token**：私钥留在硬件中，适合已有证书和运维能力的组织；
   GitHub 托管 runner 往往不能直接访问本地 USB token，通常需要受控自托管签名节点。v27 对应
   `type: hsm`（Windows）或特定非 Windows 场景的 `type: pkcs11`。EV 不再自动绕过 SmartScreen。
3. **受控 Windows 证书存储 / PFX（通常不推荐作为新公开流程的首选）**：配置最直接，但导出的
   PFX 和密码成为高价值长期秘密。若选择，必须使用专用 GitHub Environment secrets 或证书存储，
   不提交文件，不打印密码；v27 对应 `type: signtool`。
4. **继续未签名内部 Alpha**：无需账户或费用，但不能公开发布，也不能显示可信发布者。当前仓库就处于
   这一真实状态：`win.sign: false`。

若选择推荐方案，所有者需要在 Azure 中提供非秘密配置名：Artifact Signing endpoint、account name、
certificate profile name，以及证书颁发后的精确 publisher subject。认证键名只使用
`AZURE_TENANT_ID`、`AZURE_CLIENT_ID` 和 OIDC 所需的 `AZURE_FEDERATED_TOKEN_FILE`；若账户条件迫使使用
client secret，值只能放在受控 GitHub Environment 的 `AZURE_CLIENT_SECRET` 中。release job 才可获得
`id-token: write` 和签名角色，PR/push CI 不得获得。仓库不会记录这些值。

## 2. 项目许可证是什么

项目许可证决定别人能否复制、修改、分发或销售 WenShu 自己的代码和品牌。第三方依赖的许可证不会
自动替 WenShu 选择项目许可证。常见方向是：

- **MIT**：短、宽松，允许商业和闭源再分发，主要要求保留版权和许可文本；通常不含明确专利授权。
- **Apache-2.0**：同样宽松，并有明确专利授权/终止条款和 NOTICE 规则，文本与合规义务更长。
- **GPL-3.0**：强 copyleft；分发修改版或衍生版通常需要以 GPL 提供对应源代码，不适合想保留闭源
  下游的目标。
- **保留全部权利**：不主动授予复制、修改、再分发许可；适合暂时私有或尚未决定开放方式，但不应
  被称为开源。

在所有者明确选择前，仓库不新增 `LICENSE`，也不擅自写“保留全部权利”。现有内部 Draft 必须保持
非公开。选择时应同时确认权利人/年份；如业务、雇佣、商标或第三方合同条件复杂，应请合格法律顾问
复核。

## 3. 需要所有者回复的最小决定

请明确回复：

1. 签名选择“Artifact Signing”“已有 HSM/OV/EV”“PFX/证书存储”或“继续未签名内部 Alpha”；
2. 项目许可选择“MIT”“Apache-2.0”“GPL-3.0”“保留全部权利”或由法律顾问提供的精确文本，并给出
   权利人名称与年份。

只有收到这两项后，WP7 才能安全地加入真实 `win.sign` 配置和项目 LICENSE/rights 文本。
