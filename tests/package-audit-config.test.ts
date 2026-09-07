import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import packageManifest from '../package.json';
import { describe, expect, it } from 'vitest';

describe('WP3 打包配置', () => {
  it('只保留主进程外部运行依赖，renderer 依赖作为构建期依赖', () => {
    expect(Object.keys(packageManifest.dependencies).sort()).toEqual(['docx', 'jszip', 'mammoth']);
    expect(packageManifest.devDependencies['electron-builder']).toBe('27.0.0-alpha.8');
    expect(packageManifest.devDependencies.react).toBeDefined();
    expect(packageManifest.devDependencies['@codemirror/view']).toBeDefined();
    expect(packageManifest.devDependencies['@tiptap/core']).toBeDefined();
  });

  it('提供独立白名单配置与可重复 package 命令', async () => {
    const config = await readFile(resolve('electron-builder.yml'), 'utf8');
    const thirdPartyNotices = await readFile(resolve('THIRD_PARTY_NOTICES.txt'), 'utf8');

    expect(config).toContain('buildResources: build');
    expect(config).toContain('output: release');
    expect(config).toContain('asar: {}');
    expect(config).toContain('electronDist: node_modules/electron/dist');
    expect(config).toContain('out/main/**');
    expect(config).toContain('out/preload/**');
    expect(config).toContain('out/renderer/**');
    expect(config).toContain('package.json');
    expect(config).toContain('  - LICENSE');
    expect(config).toContain('THIRD_PARTY_NOTICES.txt');
    expect(packageManifest.license).toBe('MIT');
    expect(config).not.toContain('**/*');
    expect(config).toContain('target: portable');
    expect(config).toContain('target: nsis');
    expect(config).toContain('oneClick: false');
    expect(config).toContain('perMachine: false');
    expect(config).toContain('allowElevation: false');
    expect(config).toContain('packElevateHelper: false');
    expect(config).toContain('build/icon.ico');
    expect(config).toContain('sign: false');
    expect(config).not.toContain('signExecutable:');
    expect(config).not.toContain('signtoolOptions:');
    expect(config).not.toContain('azureSignOptions:');
    expect(config).toContain('afterPack: scripts/after-pack-fuses.cjs');
    expect(packageManifest.scripts['package:dir']).toContain('run-electron-builder.mjs');
    expect(packageManifest.scripts['package:dir']).toContain('--dir');
    expect(packageManifest.scripts['package:dir']).toContain('--publish never');
    expect(packageManifest.scripts['package:win']).toContain('run-electron-builder.mjs');
    expect(packageManifest.scripts['package:win']).toContain('--win');
    expect(packageManifest.scripts['package:win']).toContain('--publish never');
    expect(packageManifest.scripts['package:verify']).toContain('verify-package.mjs');
    expect(thirdPartyNotices).toContain(
      'The WenShu project is licensed under the MIT License; see the packaged LICENSE file.',
    );
    expect(thirdPartyNotices).not.toContain('\r');
  });
});
