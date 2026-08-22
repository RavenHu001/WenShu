import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync(resolve('src/renderer/styles/tokens.css'), 'utf8');
const main = readFileSync(resolve('src/renderer/main.tsx'), 'utf8');
const electronMain = readFileSync(resolve('src/main/index.ts'), 'utf8');

describe('Task 11 design and shell baseline', () => {
  it('defines the complete semantic token/state matrix', () => {
    for (const token of [
      '--color-canvas',
      '--color-surface',
      '--color-border',
      '--color-text',
      '--color-text-secondary',
      '--color-primary',
      '--color-success',
      '--color-warning',
      '--color-danger',
      '--color-info',
      '--color-hover',
      '--color-active',
      '--color-selected',
      '--color-focus',
      '--color-disabled',
      '--space-1',
      '--font-size-md',
      '--radius-md',
      '--shadow-menu',
      '--z-dialog',
      '--duration-normal',
    ]) {
      expect(tokens).toContain(token);
    }
  });

  it('provides reduced-motion and Windows forced-colors entry points', () => {
    expect(tokens).toContain('@media (prefers-reduced-motion: reduce)');
    expect(tokens).toContain('@media (forced-colors: active)');
  });

  it('loads styles by stable common/shell/workspace/document/search responsibilities', () => {
    for (const style of [
      'tokens.css',
      'common.css',
      'shell.css',
      'workspace.css',
      'document.css',
      'search.css',
    ]) {
      expect(main).toContain(`./styles/${style}`);
    }
  });

  it('removes the Electron default menu before creating the renderer menu shell', () => {
    expect(electronMain).toContain('Menu.setApplicationMenu(null)');
    expect(electronMain).toContain('nodeIntegration: false');
    expect(electronMain).toContain('contextIsolation: true');
    expect(electronMain).toContain('sandbox: true');
  });
});
