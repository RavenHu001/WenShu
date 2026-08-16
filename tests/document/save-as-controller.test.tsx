// @vitest-environment jsdom
/**
 * TASK-009 WP4：saveAsTab controller 转移测试（jsdom + mock desktop）。
 * 覆盖：成功后 stable tabId 原地迁移（id/顺序不变、dirty 清除）、源路径在请求中、
 * 目标被另一标签打开 → TARGET_OPEN 且不发 IPC、target-exists 恢复原状态、
 * 失败保持源路径、保存期间继续编辑保留 dirty。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useDocuments } from '../../src/renderer/lib/use-documents';
import type { DocumentsController } from '../../src/renderer/lib/use-documents';
import type { DesktopApi } from '../../src/shared/desktop-api';
import type { SaveAsResult } from '../../src/shared/file-management';

function loadedText(revision = 'r1', relativePath = 'a.txt', content = 'hello') {
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
  saveTextAs?: ReturnType<typeof vi.fn>;
  saveDocxAs?: ReturnType<typeof vi.fn>;
  readText?: ReturnType<typeof vi.fn>;
}): void {
  const saveTextAs =
    overrides.saveTextAs ??
    vi.fn(async () => ({
      status: 'error',
      mutationId: 0,
      error: { code: 'WRITE_FAILED', message: '写入失败' },
    }));
  const saveDocxAs =
    overrides.saveDocxAs ??
    vi.fn(async () => ({
      status: 'error',
      mutationId: 0,
      error: { code: 'WRITE_FAILED', message: '写入失败' },
    }));
  const readText = overrides.readText ?? vi.fn(async () => loadedText());
  (window as unknown as { desktop: DesktopApi }).desktop = {
    runtime: { platform: 'win32', electronVersion: '37.0.0' },
    workspace: {
      open: vi.fn(),
      refresh: vi.fn(),
      createText: vi.fn(),
      createDocx: vi.fn(),
      createDirectory: vi.fn(),
      reveal: vi.fn(),
    },
    document: {
      readText,
      saveText: vi.fn(),
      readDocx: vi.fn(),
      saveDocx: vi.fn(),
      saveTextAs,
      saveDocxAs,
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

function savedTextAs(target: string, mutationId = 1): SaveAsResult {
  return {
    status: 'saved',
    mutationId,
    relativePath: target,
    kind: 'text',
    document: {
      name: target.split('/').at(-1)!,
      relativePath: target,
      content: 'hello-edited',
      byteLength: 12,
      revision: 'r2',
      hasUtf8Bom: false,
      lineEnding: 'lf',
    },
  };
}

afterEach(() => {
  cleanup();
  captured = null;
});

describe('saveAsTab controller', () => {
  it('成功：stable tabId 原地迁移到目标，dirty 清除，请求携带源路径与正文', async () => {
    const saveTextAs = vi.fn(async () => savedTextAs('b.txt'));
    mockDesktop({ saveTextAs });
    render(<Harness />);

    let tabId = '';
    await act(async () => {
      const tab = await captured!.openFile('a.txt');
      tabId = tab!.id;
    });
    await act(async () => {
      captured!.editTab(tabId, 'hello-edited');
    });
    let result: SaveAsResult | null = null;
    await act(async () => {
      result = await captured!.saveAsTab(tabId, { parentRelativePath: '', name: 'b.txt' });
    });
    expect(result!.status).toBe('saved');
    const tab = captured!.model.state.tabs[0]!;
    expect(tab.id).toBe(tabId); // stable tabId 不变
    expect(tab.relativePath).toBe('b.txt');
    expect(tab.dirty).toBe(false);
    expect(captured!.model.state.tabs).toHaveLength(1);
    expect(saveTextAs).toHaveBeenCalledTimes(1);
    expect(saveTextAs).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId,
        sourceRelativePath: 'a.txt',
        target: { parentRelativePath: '', name: 'b.txt' },
        content: 'hello-edited',
        expectedSourceRevision: 'r1',
      }),
    );
  });

  it('保存期间继续编辑：完成后保留新编辑与 dirty', async () => {
    let resolveSave!: (r: SaveAsResult) => void;
    const saveTextAs = vi.fn(
      () =>
        new Promise<SaveAsResult>((resolve) => {
          resolveSave = resolve;
        }),
    );
    mockDesktop({ saveTextAs });
    render(<Harness />);
    let tabId = '';
    await act(async () => {
      const tab = await captured!.openFile('a.txt');
      tabId = tab!.id;
    });
    await act(async () => {
      captured!.editTab(tabId, 'v1');
    });
    let pending: Promise<SaveAsResult>;
    await act(async () => {
      pending = captured!.saveAsTab(tabId, { parentRelativePath: '', name: 'b.txt' });
    });
    await act(async () => {
      captured!.editTab(tabId, 'v2');
    });
    await act(async () => {
      resolveSave(savedTextAs('b.txt'));
      await pending;
    });
    const tab = captured!.model.state.tabs[0]!;
    expect(tab.relativePath).toBe('b.txt');
    expect(tab.dirty).toBe(true);
    expect(tab.status).toBe('loaded-dirty');
  });

  it('目标由另一标签打开：不发 IPC，返回 TARGET_OPEN，标签保持', async () => {
    const saveTextAs = vi.fn(async () => savedTextAs('c.txt'));
    mockDesktop({ saveTextAs, readText: vi.fn(async () => loadedText('r1', 'c.txt', 'other')) });
    render(<Harness />);
    let aId = '';
    await act(async () => {
      const a = await captured!.openFile('a.txt');
      aId = a!.id;
    });
    await act(async () => {
      await captured!.openFile('c.txt');
    });
    const holder: { result: SaveAsResult | null } = { result: null };
    await act(async () => {
      holder.result = await captured!.saveAsTab(aId, { parentRelativePath: '', name: 'c.txt' });
    });
    if (holder.result === null || holder.result.status !== 'error') {
      throw new Error('expected error result');
    }
    expect(holder.result.error.code).toBe('TARGET_OPEN');
    expect(saveTextAs).not.toHaveBeenCalled();
    const a = captured!.model.state.tabs.find((t) => t.id === aId)!;
    expect(a.relativePath).toBe('a.txt');
  });

  it('第一阶段 target-exists：恢复原标签状态并返回受控目标 revision', async () => {
    const saveTextAs = vi.fn(async () => ({
      status: 'target-exists',
      mutationId: 9,
      targetRevision: 'target-r',
    }));
    mockDesktop({ saveTextAs });
    render(<Harness />);
    let tabId = '';
    await act(async () => {
      const tab = await captured!.openFile('a.txt');
      tabId = tab!.id;
    });
    let result: SaveAsResult | null = null;
    await act(async () => {
      result = await captured!.saveAsTab(tabId, { parentRelativePath: '', name: 'b.txt' });
    });
    expect(result).toEqual({ status: 'target-exists', mutationId: 9, targetRevision: 'target-r' });
    const tab = captured!.model.state.tabs[0]!;
    expect(tab.saving).toBe(false);
    expect(tab.relativePath).toBe('a.txt'); // 未迁移
    expect(captured!.model.runtime.get(tabId)?.saveInFlight).toBe(false);
  });

  it('失败：回到 save-error、路径不变、dirty 保留', async () => {
    const saveTextAs = vi.fn(async () => ({
      status: 'error',
      mutationId: 4,
      error: { code: 'WRITE_FAILED', message: '写入失败' },
    }));
    mockDesktop({ saveTextAs });
    render(<Harness />);
    let tabId = '';
    await act(async () => {
      const tab = await captured!.openFile('a.txt');
      tabId = tab!.id;
    });
    await act(async () => {
      captured!.editTab(tabId, 'edited');
    });
    await act(async () => {
      await captured!.saveAsTab(tabId, { parentRelativePath: '', name: 'b.txt' });
    });
    const tab = captured!.model.state.tabs[0]!;
    expect(tab.status).toBe('save-error');
    expect(tab.relativePath).toBe('a.txt');
    expect(tab.dirty).toBe(true);
  });
});
