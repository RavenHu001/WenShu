import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import packageManifest from '../package.json';
import { describe, expect, it } from 'vitest';

describe('WP3 打包配置', () => {
  it('只保留主进程外部运行依赖，renderer 依赖作为构建期依赖', () => {
    expect(Object.keys(packageManifest.dependencies).sort()).toEqual(['docx', 'jszip', 'mammoth']);
    expect(packageManifest.devDependencies['electron-builder']).toBe('26.15.3');
    expect(packageManifest.devDependencies.react).toBeDefined();
    expect(packageManifest.devDependencies['@codemirror/view']).toBeDefined();
    expect(packageManifest.devDependencies['@tiptap/core']).toBeDefined();
  });

  it('提供独立白名单配置与可重复 package 命令', async () => {
    const config = await readFile(resolve('electron-builder.yml'), 'utf8');

    expect(config).toContain('buildResources: build');
    expect(config).toContain('output: release');
    expect(config).toContain('asar: true');
    expect(config).toContain('electronDist: node_modules/electron/dist');
    expect(config).toContain('out/main/**');
    expect(config).toContain('out/preload/**');
    expect(config).toContain('out/renderer/**');
    expect(config).toContain('package.json');
    expect(config).not.toContain('**/*');
    expect(config).toContain('target: portable');
    expect(config).toContain('target: nsis');
    expect(config).toContain('oneClick: false');
    expect(config).toContain('perMachine: false');
    expect(config).toContain('allowElevation: false');
    expect(config).toContain('packElevateHelper: false');
    expect(config).toContain('build/icon.ico');
    expect(config).toContain('signExecutable: false');
    expect(packageManifest.scripts['package:dir']).toContain('run-electron-builder.mjs');
    expect(packageManifest.scripts['package:dir']).toContain('--dir');
    expect(packageManifest.scripts['package:dir']).toContain('--publish never');
    expect(packageManifest.scripts['package:win']).toContain('run-electron-builder.mjs');
    expect(packageManifest.scripts['package:win']).toContain('--win');
    expect(packageManifest.scripts['package:win']).toContain('--publish never');
    expect(packageManifest.scripts['package:verify']).toContain('verify-package.mjs');
  });
});
