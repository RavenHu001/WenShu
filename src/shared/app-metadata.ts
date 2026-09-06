/**
 * 构建时从 package.json 注入的固定身份信息。
 * 不读取环境变量，避免用户可控值影响显示版本或 Windows 应用身份。
 */
declare const __WENSHU_APP_VERSION__: string;
declare const __WENSHU_APP_ID__: string;
declare const __WENSHU_PRODUCT_NAME__: string;
declare const __WENSHU_EXECUTABLE_NAME__: string;

export const appIdentity = Object.freeze({
  version: __WENSHU_APP_VERSION__,
  appId: __WENSHU_APP_ID__,
  productName: __WENSHU_PRODUCT_NAME__,
  executableName: __WENSHU_EXECUTABLE_NAME__,
});
