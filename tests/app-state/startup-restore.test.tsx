// @vitest-environment jsdom
import { StrictMode, type PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDocuments } from '../../src/renderer/lib/use-documents';
import { useWorkspace } from '../../src/renderer/lib/use-workspace';
import { useStartupRestore } from '../../src/renderer/lib/use-startup-restore';
import { defaultSettings, defaultState, type AppStateSnapshot } from '../../src/shared/app-state';
import type { DesktopApi } from '../../src/shared/desktop-api';
import type { ReadTextDocumentResult } from '../../src/shared/document';
import type { ReadDocxDocumentResult } from '../../src/shared/docx';
import type { RestoreWorkspaceResult } from '../../src/shared/workspace';

const identity = '11111111-1111-4111-8111-111111111111';
const root = { rootName: 'synthetic', rootPath: '/synthetic', entries: [] };
function selected(
  paths = ['a.txt'],
  active: string | null = paths.at(-1) ?? null,
): RestoreWorkspaceResult {
  return {
    status: 'selected',
    workspace: root,
    workspaceSessionId: identity,
    restore: { tabRelativePaths: paths, activeRelativePath: active, warnings: [] },
  };
}
function loaded(path: string, content = `disk:${path}`): ReadTextDocumentResult {
  return {
    status: 'loaded',
    document: {
      name: path.split('/').at(-1)!,
      relativePath: path,
      content,
      byteLength: content.length,
      revision: 'new-disk-revision',
      hasUtf8Bom: false,
      lineEnding: 'lf',
    },
  };
}
function docx(path: string): ReadDocxDocumentResult {
  return {
    status: 'loaded',
    document: {
      kind: 'docx',
      name: path,
      relativePath: path,
      revision: 'new-docx-revision',
      size: 1,
      model: {
        schemaVersion: 1,
        blocks: [
          { kind: 'paragraph', alignment: null, runs: [{ text: 'current disk DOCX', marks: [] }] },
        ],
      },
      compatibility: {
        level: path.startsWith('readonly') ? 'read-only' : 'degraded',
        warnings: [],
      },
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let snapshot: AppStateSnapshot;
let api: {
  restoreLast: ReturnType<typeof vi.fn<DesktopApi['workspace']['restoreLast']>>;
  readText: ReturnType<typeof vi.fn<DesktopApi['document']['readText']>>;
  readDocx: ReturnType<typeof vi.fn<DesktopApi['document']['readDocx']>>;
  checkpoint: ReturnType<typeof vi.fn<DesktopApi['appState']['checkpoint']>>;
  flush: ReturnType<typeof vi.fn<DesktopApi['appState']['flush']>>;
  open: ReturnType<typeof vi.fn<DesktopApi['workspace']['open']>>;
};
beforeEach(() => {
  snapshot = {
    settings: defaultSettings(),
    effectiveStartupMode: 'workspace-and-tabs',
    state: {
      ...defaultState(),
      sidebar: { width: 333, collapsed: true },
      lastWorkspace: {
        rootPath: root.rootPath,
        tabRelativePaths: ['a.txt'],
        activeRelativePath: 'a.txt',
      },
    },
    workspaceSessionId: null,
    dataDirectory: { path: '/isolated', mode: 'test', canReselect: false },
    files: {
      settings: { status: 'valid', pending: false, error: null },
      state: { status: 'valid', pending: false, error: null },
    },
  };
  api = {
    restoreLast: vi.fn(async () => selected()),
    readText: vi.fn(async (path) => loaded(path)),
    readDocx: vi.fn(async (path) => docx(path)),
    checkpoint: vi.fn(async () => ({ status: 'queued', warnings: [] })),
    flush: vi.fn(async () => ({ status: 'saved', warnings: [] })),
    open: vi.fn(async () => ({
      status: 'selected',
      workspace: { ...root, rootPath: '/new' },
      workspaceSessionId: '22222222-2222-4222-8222-222222222222',
    })),
  };
  Object.defineProperty(window, 'desktop', {
    configurable: true,
    value: {
      workspace: { restoreLast: api.restoreLast, open: api.open },
      document: { readText: api.readText, readDocx: api.readDocx },
      appState: { checkpoint: api.checkpoint, flush: api.flush },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function mount() {
  return renderHook(
    () => {
      const documents = useDocuments();
      const workspace = useWorkspace({ onWorkspaceSelected: documents.invalidateWorkspace });
      const restore = useStartupRestore({ loaded: true, snapshot, workspace, documents });
      return { documents, workspace, restore };
    },
    { wrapper: ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode> },
  );
}
describe('one startup batch and metadata gate', () => {
  it('StrictMode opens mixed paths once in order with fresh snapshots, failed positions and saved activity', async () => {
    const paths = [
      'a/same.txt',
      'degraded.docx',
      'empty.txt',
      'missing.txt',
      'b/same.txt',
      'readonly.docx',
    ];
    api.restoreLast.mockResolvedValue(selected(paths, 'degraded.docx'));
    api.readText.mockImplementation(async (path) =>
      path === 'missing.txt'
        ? { status: 'error', error: { code: 'NOT_FOUND', message: 'missing' } }
        : loaded(path, path === 'empty.txt' ? '' : 'external change'),
    );
    const { result } = mount();
    await waitFor(() => expect(result.current.restore.phase).toBe('ready'));
    expect(api.restoreLast).toHaveBeenCalledTimes(1);
    const tabs = result.current.documents.model.state.tabs;
    expect(tabs.map((tab) => tab.relativePath)).toEqual(paths);
    expect(new Set(tabs.map((tab) => tab.id)).size).toBe(paths.length);
    expect(tabs[2]).toMatchObject({ content: '', dirty: false });
    expect(tabs[3]).toMatchObject({ status: 'read-error', document: null });
    expect(tabs[1]).toMatchObject({ compatibilityConfirmationRevision: null });
    expect(tabs[5]).toMatchObject({ status: 'read-only' });
    expect(result.current.documents.model.state.activeTabId).toBe(tabs[1]!.id);
    expect(api.checkpoint).not.toHaveBeenCalled();
    await waitFor(() => expect(api.checkpoint).toHaveBeenCalledTimes(1));
    expect(api.checkpoint.mock.calls[0]![0]).toEqual({
      workspaceSessionId: identity,
      tabRelativePaths: paths,
      activeRelativePath: 'degraded.docx',
      sidebar: snapshot.state.sidebar,
    });
  });
  it('stopping keeps loading tab, lets its read complete, cancels further scheduling and final activation', async () => {
    const read = deferred<ReadTextDocumentResult>();
    api.restoreLast.mockResolvedValue(selected(['a.txt', 'b.txt', 'c.txt'], 'c.txt'));
    api.readText.mockImplementationOnce(() => read.promise);
    const { result } = mount();
    await waitFor(() => expect(result.current.restore.phase).toBe('tabs'));
    expect(api.checkpoint).not.toHaveBeenCalled();
    act(() => result.current.restore.stop());
    expect(result.current.documents.model.state.tabs[0]?.status).toBe('loading');
    await act(async () => {
      read.resolve(loaded('a.txt'));
    });
    expect(api.readText).toHaveBeenCalledTimes(1);
    expect(result.current.documents.model.state.tabs[0]?.status).toBe('loaded-clean');
    await waitFor(() => expect(api.checkpoint).toHaveBeenCalledTimes(1));
    expect(api.checkpoint.mock.calls[0]![0].tabRelativePaths).toEqual(['a.txt']);
    await act(async () => {
      await result.current.documents.openFile('normal.txt');
    });
    await waitFor(() => expect(api.checkpoint).toHaveBeenCalledTimes(2));
  });
  it('close during scanning or reading preserves entire old record and ignores late results', async () => {
    const scan = deferred<RestoreWorkspaceResult>();
    api.restoreLast.mockReturnValueOnce(scan.promise);
    const first = mount();
    await waitFor(() => expect(first.result.current.restore.phase).toBe('workspace'));
    await act(async () => {
      await first.result.current.restore.prepareClose();
      scan.resolve(selected());
    });
    expect(first.result.current.workspace.workspaceSessionId).toBeNull();
    expect(api.readText).not.toHaveBeenCalled();
    first.unmount();
    const read = deferred<ReadTextDocumentResult>();
    api.readText.mockReturnValueOnce(read.promise);
    const second = mount();
    await waitFor(() => expect(second.result.current.restore.phase).toBe('tabs'));
    await act(async () => {
      await second.result.current.restore.prepareClose();
      read.resolve(loaded('a.txt'));
    });
    expect(second.result.current.documents.model.state.tabs[0]?.status).toBe('loading');
    expect(api.checkpoint).not.toHaveBeenCalled();
  });
  it('new workspace cancels old scheduler and existing epoch drops old reads', async () => {
    const read = deferred<ReadTextDocumentResult>();
    api.readText.mockReturnValueOnce(read.promise);
    api.restoreLast.mockResolvedValue(selected(['a.txt', 'never.txt']));
    const { result } = mount();
    await waitFor(() => expect(result.current.restore.phase).toBe('tabs'));
    await act(async () => {
      result.current.restore.beforeManualOpen();
      await result.current.workspace.openWorkspace();
      await result.current.documents.openFile('new.txt');
      read.resolve(loaded('a.txt'));
    });
    expect(result.current.documents.model.state.tabs.map((tab) => tab.relativePath)).toEqual([
      'new.txt',
    ]);
    expect(api.readText).not.toHaveBeenCalledWith('never.txt');
    await waitFor(() => expect(api.checkpoint).toHaveBeenCalledTimes(1));
    expect(api.checkpoint.mock.calls[0]![0]).toMatchObject({
      workspaceSessionId: '22222222-2222-4222-8222-222222222222',
      tabRelativePaths: ['new.txt'],
    });
  });
  it('unmount cancels batch without appending or checkpointing late reads', async () => {
    const read = deferred<ReadTextDocumentResult>();
    api.readText.mockReturnValueOnce(read.promise);
    api.restoreLast.mockResolvedValue(selected(['a.txt', 'b.txt']));
    const { result, unmount } = mount();
    await waitFor(() => expect(result.current.restore.phase).toBe('tabs'));
    unmount();
    await act(async () => {
      read.resolve(loaded('a.txt'));
    });
    expect(api.readText).toHaveBeenCalledTimes(1);
    expect(api.checkpoint).not.toHaveBeenCalled();
  });
  it('caps/deduplicates safe paths, rejects syntax, uses first tab for invalid active path', async () => {
    const paths = Array.from({ length: 105 }, (_, i) => `${i}.txt`);
    api.restoreLast.mockResolvedValue(selected(['../unsafe.txt', ...paths, '0.TXT'], '104.txt'));
    const { result } = mount();
    await waitFor(() => expect(result.current.restore.phase).toBe('ready'));
    expect(result.current.documents.model.state.tabs.map((tab) => tab.relativePath)).toEqual([
      ...paths.slice(0, 99),
      '104.txt',
    ]);
    expect(result.current.restore.notice).toContain('100');
    expect(result.current.restore.notice).toContain('不安全');
    expect(result.current.documents.model.state.activeTabId).toBe(
      result.current.documents.model.state.tabs.at(-1)?.id,
    );
  });
  it.each([null, 'missing.txt'])(
    'falls back to first retained tab for active %s',
    async (active) => {
      api.restoreLast.mockResolvedValue(selected(['a.txt', 'b.txt'], active));
      const { result } = mount();
      await waitFor(() => expect(result.current.restore.phase).toBe('ready'));
      expect(result.current.documents.model.state.activeTabId).toBe(
        result.current.documents.model.state.tabs[0]?.id,
      );
    },
  );
  it('does not checkpoint on body input; failed metadata can retry and later changes still record', async () => {
    api.checkpoint.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'WRITE_FAILED', message: 'retry write', retryable: true },
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.restore.writeError).toBe('retry write'));
    await act(async () => {
      result.current.restore.retryWrite();
    });
    expect(result.current.restore.writeError).toBe('');
    vi.useFakeTimers();
    act(() =>
      result.current.documents.editTab(
        result.current.documents.model.state.tabs[0]!.id,
        'unsaved body',
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(api.checkpoint).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(api.checkpoint.mock.calls)).not.toContain('unsaved body');
  });
  it('blank never calls restore or checkpoints a manually opened workspace', async () => {
    snapshot = { ...snapshot, effectiveStartupMode: 'blank' };
    const { result } = mount();
    await waitFor(() => expect(result.current.restore.phase).toBe('ready'));
    await act(async () => {
      await result.current.workspace.openWorkspace();
      await result.current.documents.openFile('a.txt');
      await result.current.restore.prepareClose();
    });
    expect(api.restoreLast).not.toHaveBeenCalled();
    expect(api.checkpoint).not.toHaveBeenCalled();
  });
  it('workspace-only and no-tabs restore leave welcome state; failed root is retryable', async () => {
    snapshot = { ...snapshot, effectiveStartupMode: 'workspace' };
    api.restoreLast
      .mockResolvedValueOnce({
        status: 'error',
        error: { code: 'WORKSPACE_UNAVAILABLE', message: 'retry root' },
      })
      .mockResolvedValueOnce(selected([], null));
    const { result } = mount();
    await waitFor(() => expect(result.current.restore.phase).toBe('error'));
    expect(api.checkpoint).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.restore.restore();
    });
    expect(result.current.restore.phase).toBe('ready');
    expect(result.current.documents.model.state.tabs).toEqual([]);
    expect(api.readText).not.toHaveBeenCalled();
  });
});
