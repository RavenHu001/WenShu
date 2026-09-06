import packageManifest from './package.json';

function requireManifestString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`package.json 中的 ${field} 必须是非空字符串`);
  }
  return value;
}

const wenshu = packageManifest.wenshu;

export const appIdentity = Object.freeze({
  version: requireManifestString(packageManifest.version, 'version'),
  productName: requireManifestString(packageManifest.productName, 'productName'),
  appId: requireManifestString(wenshu?.appId, 'wenshu.appId'),
  executableName: requireManifestString(wenshu?.executableName, 'wenshu.executableName'),
});

// Vite/Vitest 会在解析配置时规范化并删除 define 条目，因此该配置对象不可冻结。
export const appMetadataDefines = {
  __WENSHU_APP_VERSION__: JSON.stringify(appIdentity.version),
  __WENSHU_APP_ID__: JSON.stringify(appIdentity.appId),
  __WENSHU_PRODUCT_NAME__: JSON.stringify(appIdentity.productName),
  __WENSHU_EXECUTABLE_NAME__: JSON.stringify(appIdentity.executableName),
};
