// @vitest-environment jsdom
/**
 * TASK-009 WP5：relocateByPath / trashByPath controller 测试。
 * 覆盖：单文件迁移（id/顺序/dirty 保持）、目录后代迁移（段边界）、saving 阻止不发 IPC、
 * 删除文件关闭标签、删除目录关闭后代标签。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useDocuments } from '../../src/renderer/lib/use-documents';
import type { DocumentsController } from '../../src/renderer/lib/use-documents';
import type { DesktopApi } from '../../src/shared/desktop-api';
import type { WorkspaceMutationResult } from '../../src/shared/file-management';

function loadedText(relativePath: string, revision = 'r1', content = 'hello') {
  return {
    status: 'loaded' as const,
    document: {
      name: relativePath.split('/').at(-1)!,
      relativePath,
      content,
      byteLength: content.length,
      revision,
      hasUtf8Bom: false,
      lineEnding: 'lf' as const,
    },
  };
}

function mockDesktop(overrides: {
  relocate?: ReturnType<typeof vi.fn>;
  trash?: ReturnType<typeof vi.fn>;
  readText?: ReturnType<typeof vi.fn>;
  saveTextAs?: ReturnType<typeof vi.fn>;
}): void {
  const relocate =
    overrides.relocate ??
    vi.fn(async () => ({
      status: 'error',
      mutationId: 0,
      error: { code: 'WRITE_FAILED', message: '写入失败' },
    }));
  const trash =
    overrides.trash ??
    vi.fn(async () => ({
      status: 'error',
      mutationId: 0,
      error: { code: 'WRITE_FAILED', message: '写入失败' },
    }));
  const readText = overrides.readText ?? vi.fn(async (path: string) => loadedText(path));
  const saveTextAs =
    overrides.saveTextAs ??
    vi.fn(async () => ({
      status: 'error',
      mutationId: 0,
      error: { code: 'WRITE_FAILED', message: '写入失败' },
    }));
  (window as unknown as { desktop: DesktopApi }).desktop = {
    runtime: { platform: 'win32', electronVersion: '37.0.0', appVersion: '0.1.0-alpha.1' },
    workspace: {
      open: vi.fn(),
      refresh: vi.fn(),
      createText: vi.fn(),
      createDocx: vi.fn(),
      createDirectory: vi.fn(),
      reveal: vi.fn(),
      relocate,
      trash,
    },
    document: {
      readText,
      saveText: vi.fn(),
      readDocx: vi.fn(),
      saveDocx: vi.fn(),
      saveTextAs,
      saveDocxAs: vi.fn(),
    },
    search: {
      textWorkspace: vi.fn(),
      cancelTextWorkspace: vi.fn(),
    },
    window: {
      setDirtyState: vi.fn(),
      requestClose: vi.fn(),
      cancelClose: vi.fn(),
      onCloseRequested: vi.fn(() => () => undefined),
    },
  } as unknown as DesktopApi;
}

let captured: DocumentsController | null = null;
function Harness(): React.JSX.Element {
  const controller = useDocuments();
  captured = controller;
  return <div />;
}

afterEach(() => {
  cleanup();
  captured = null;
});

describe('relocateByPath', () => {
  it('单文件迁移：id/顺序保持、路径更新、dirty 保留', async () => {
    const relocate = vi.fn(async () => ({
      status: 'succeeded',
      mutationId: 1,
      relativePath: 'b.txt',
      kind: 'text',
    }));
    mockDesktop({ relocate });
    render(<Harness />);
    let aId = '';
    let bId = '';
    await act(async () => {
      const a = await captured!.openFile('a.txt');
      aId = a!.id;
      const b = await captured!.openFile('c.txt');
      bId = b!.id;
    });
    await act(async () => {
      captured!.editTab(aId, 'edited');
    });
    await act(async () => {
      await captured!.relocateByPath('a.txt', { parentRelativePath: '', name: 'b.txt' });
    });
    expect(relocate).toHaveBeenCalledWith({
      mutationId: 1,
      sourceRelativePath: 'a.txt',
      parentRelativePath: '',
      name: 'b.txt',
    });
    const tabs = captured!.model.state.tabs;
    expect(tabs.map((t) => t.id)).toEqual([aId, bId]); // 顺序不变
    expect(tabs[0]!.relativePath).toBe('b.txt');
    expect(tabs[0]!.dirty).toBe(true); // dirty 保留
  });

  it('目录迁移：全部后代按段边界迁移，非后代不动', async () => {
    const relocate = vi.fn(async () => ({
      status: 'succeeded',
      mutationId: 2,
      relativePath: 'x',
      kind: 'directory',
    }));
    mockDesktop({ relocate });
    render(<Harness />);
    const ids: string[] = [];
    await act(async () => {
      const t1 = await captured!.openFile('a/b.txt');
      ids.push(t1!.id);
      const t2 = await captured!.openFile('a/c.txt');
      ids.push(t2!.id);
      const t3 = await captured!.openFile('a2.txt');
      ids.push(t3!.id);
    });
    await act(async () => {
      await captured!.relocateByPath('a', { parentRelativePath: '', name: 'x' });
    });
    const paths = captured!.model.state.tabs.map((t) => t.relativePath);
    expect(paths).toEqual(['x/b.txt', 'x/c.txt', 'a2.txt']);
    expect(captured!.model.state.tabs.map((t) => t.id)).toEqual(ids);
  });

  it('saving 受影响标签 → 阻止且不发 IPC', async () => {
    const relocate = vi.fn();
    const saveTextAs = vi.fn(() => new Promise<never>(() => undefined));
    mockDesktop({ relocate, saveTextAs });
    render(<Harness />);
    let aId = '';
    await act(async () => {
      const a = await captured!.openFile('a.txt');
      aId = a!.id;
    });
    await act(async () => {
      captured!.editTab(aId, 'edited');
      void captured!.saveAsTab(aId, { parentRelativePath: '', name: 'b.txt' });
    });
    const holder: { result: WorkspaceMutationResult | null } = { result: null };
    await act(async () => {
      holder.result = await captured!.relocateByPath('a.txt', {
        parentRelativePath: '',
        name: 'b.txt',
      });
    });
    if (holder.result === null || holder.result.status !== 'error') {
      throw new Error('expected error result');
    }
    expect(holder.result.error.code).toBe('WRITE_FAILED');
    expect(relocate).not.toHaveBeenCalled();
  });
});

describe('trashByPath', () => {
  it('删除文件：关闭对应标签，其他标签保留', async () => {
    const trash = vi.fn(async () => ({
      status: 'succeeded',
      mutationId: 3,
      relativePath: 'a.txt',
      kind: 'text',
    }));
    mockDesktop({ trash });
    render(<Harness />);
    let aId = '';
    let bId = '';
    await act(async () => {
      const a = await captured!.openFile('a.txt');
      aId = a!.id;
      const b = await captured!.openFile('b.txt');
      bId = b!.id;
    });
    await act(async () => {
      await captured!.trashByPath('a.txt');
    });
    expect(trash).toHaveBeenCalledWith({ mutationId: 1, relativePath: 'a.txt' });
    expect(captured!.model.state.tabs.map((t) => t.relativePath)).toEqual(['b.txt']);
    expect(captured!.model.runtime.has(aId)).toBe(false);
    expect(captured!.model.runtime.has(bId)).toBe(true);
  });

  it('删除目录：关闭全部后代标签，非后代保留', async () => {
    const trash = vi.fn(async () => ({
      status: 'succeeded',
      mutationId: 1,
      relativePath: 'a',
      kind: 'directory',
    }));
    mockDesktop({ trash });
    render(<Harness />);
    await act(async () => {
      await captured!.openFile('a/b.txt');
      await captured!.openFile('a/c.txt');
      await captured!.openFile('z.txt');
    });
    await act(async () => {
      await captured!.trashByPath('a');
    });
    expect(captured!.model.state.tabs.map((t) => t.relativePath)).toEqual(['z.txt']);
  });

  it('saving 受影响标签 → 阻止且不发 IPC', async () => {
    const trash = vi.fn();
    const saveTextAs = vi.fn(() => new Promise<never>(() => undefined));
    mockDesktop({ trash, saveTextAs });
    render(<Harness />);
    let aId = '';
    await act(async () => {
      const a = await captured!.openFile('a.txt');
      aId = a!.id;
    });
    await act(async () => {
      captured!.editTab(aId, 'edited');
      void captured!.saveAsTab(aId, { parentRelativePath: '', name: 'b.txt' });
    });
    const holder: { result: WorkspaceMutationResult | null } = { result: null };
    await act(async () => {
      holder.result = await captured!.trashByPath('a.txt');
    });
    if (holder.result === null || holder.result.status !== 'error') {
      throw new Error('expected error result');
    }
    expect(holder.result.error.code).toBe('WRITE_FAILED');
    expect(trash).not.toHaveBeenCalled();
  });
});
