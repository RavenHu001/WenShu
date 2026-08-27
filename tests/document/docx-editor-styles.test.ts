// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const appCss = ['tokens.css', 'common.css', 'app.css', 'shell.css', 'document.css']
  .map((file) => readFileSync(resolve('src/renderer/styles', file), 'utf8'))
  .join('\n');

function installApplicationStyles(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = appCss;
  document.head.append(style);
  return style;
}

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe('DOCX editor visual isolation and CJK italic rendering', () => {
  it('keeps an inactive editor host out of layout even though active hosts use flex', () => {
    installApplicationStyles();
    const host = document.createElement('div');
    host.className = 'docx-editor-host';
    host.hidden = true;
    document.body.append(host);

    expect(getComputedStyle(host).display).toBe('none');
  });

  it('allows synthetic italic only inside DOCX document content', () => {
    installApplicationStyles();
    const editor = document.createElement('div');
    editor.className = 'docx-editor';
    const proseMirror = document.createElement('div');
    proseMirror.className = 'ProseMirror';
    proseMirror.innerHTML = '<p><em>斜体汉字</em></p>';
    editor.append(proseMirror);
    document.body.append(editor);

    expect(getComputedStyle(document.documentElement).getPropertyValue('font-synthesis')).toBe(
      'none',
    );
    expect(getComputedStyle(proseMirror).getPropertyValue('font-synthesis')).toBe('style');
    expect(getComputedStyle(proseMirror.querySelector('em')!).fontStyle).toBe('italic');
  });

  it('uses a centered finite-width writing canvas without page-count semantics', () => {
    installApplicationStyles();
    const editor = document.createElement('div');
    editor.className = 'docx-editor';
    const proseMirror = document.createElement('div');
    proseMirror.className = 'ProseMirror';
    editor.append(proseMirror);
    document.body.append(editor);

    const style = getComputedStyle(proseMirror);
    expect(appCss).toContain('width: min(820px, 100%);');
    expect(style.marginLeft).toBe('auto');
    expect(style.marginRight).toBe('auto');
    expect(proseMirror.getAttribute('aria-label')).toBeNull();
  });
});
