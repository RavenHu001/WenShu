import packageManifest from '../package.json';
import { describe, expect, it } from 'vitest';
import { appIdentity } from '../src/shared/app-metadata';

describe('产品身份元数据', () => {
  it('只从 package.json 的固定版本和身份字段构建', () => {
    expect(packageManifest.version).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
    expect(appIdentity).toEqual({
      version: packageManifest.version,
      productName: packageManifest.productName,
      appId: packageManifest.wenshu.appId,
      executableName: packageManifest.wenshu.executableName,
    });
  });

  it('固定 Windows 身份与 ASCII 可执行/产物基础名', () => {
    expect(appIdentity.appId).toBe('io.github.ravenhu001.wenshu');
    expect(appIdentity.productName).toBe('文枢');
    expect(appIdentity.executableName).toBe('WenShu');
    expect(appIdentity.executableName).toMatch(/^[\x20-\x7E]+$/);
    expect(Object.isFrozen(appIdentity)).toBe(true);
  });
});
