const { join } = require('node:path');
const { flipFuses, FuseV1Options, FuseVersion } = require('@electron/fuses');

/** @param {{ appOutDir: string }} context */
exports.default = async (context) => {
  await flipFuses(join(context.appOutDir, 'WenShu.exe'), {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    // 文枢不使用 Chromium cookie 作为身份状态；保留默认以避免把既有 userData
    // 单向迁移为不可回退的加密 cookie store。
    [FuseV1Options.EnableCookieEncryption]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    // 最终产物关闭 inspect；Playwright E2E 使用未加固的 unpacked 构建。
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // 未提供自定义 V8 snapshot，保留 Electron 默认启动路径。
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    // renderer 通过 loadFile()/file:// 加载，不能盲目移除此兼容权限。
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
  });
};
