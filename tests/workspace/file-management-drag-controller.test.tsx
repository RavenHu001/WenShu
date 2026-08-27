// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useFileManagement,
  type FileManagementController,
} from '../../src/renderer/lib/use-file-management';
import type { DesktopApi } from '../../src/shared/desktop-api';
import type { WorkspaceMutationResult } from '../../src/shared/file-management';
import type { WorkspaceSnapshot } from '../../src/shared/workspace';

const workspace: WorkspaceSnapshot = {
  rootName: 'ws',
  rootPath: 'C:\\ws',
  entries: [
    { name: 'a.txt', relativePath: 'a.txt', kind: 'file' },
    { name: 'target', relativePath: 'target', kind: 'directory', children: [] },
  ],
};

let captured: FileManagementController | null = null;

function Harness({
  epoch,
  refresh,
  commit,
  notify,
}: {
  readonly epoch: number;
  readonly refresh: () => Promise<boolean>;
  readonly commit: (source: string, result: WorkspaceMutationResult) => void;
  readonly notify: () => void;
}): React.JSX.Element {
  captured = useFileManagement({
    workspace,
    workspaceEpoch: epoch,
    refreshWorkspace: refresh,
    openFile: vi.fn(async () => null),
    commitRelocate: commit,
    commitTrash: vi.fn(),
    saveAsTab: vi.fn(),
    tabs: [],
    onMutationCommitted: notify,
  });
  return <output>{captured.state.status}</output>;
}

function mockDesktop(relocate: DesktopApi['workspace']['relocate']): void {
  (window as unknown as { desktop: DesktopApi }).desktop = {
    workspace: { relocate },
  } as unknown as DesktopApi;
}

afterEach(() => {
  cleanup();
  captured = null;
  delete (window as unknown as { desktop?: DesktopApi }).desktop;
});

describe('useFileManagement relocateByDrop', () => {
  it('prevents duplicate pending submissions and commits the same stable relocate result once', async () => {
    let resolve!: (result: WorkspaceMutationResult) => void;
    const relocate = vi.fn(
      () =>
        new Promise<WorkspaceMutationResult>((done) => {
          resolve = done;
        }),
    );
    mockDesktop(relocate);
    const refresh = vi.fn(async () => true);
    const commit = vi.fn();
    const notify = vi.fn();
    render(<Harness epoch={4} refresh={refresh} commit={commit} notify={notify} />);

    let first!: Promise<void>;
    await act(async () => {
      first = captured!.relocateByDrop('a.txt', 'target', 4);
      void captured!.relocateByDrop('a.txt', 'target', 4);
      await Promise.resolve();
    });
    expect(relocate).toHaveBeenCalledTimes(1);
    const result: WorkspaceMutationResult = {
      status: 'succeeded',
      mutationId: 1,
      relativePath: 'target/a.txt',
      kind: 'text',
    };
    await act(async () => {
      resolve(result);
      await first;
    });
    expect(commit).toHaveBeenCalledWith('a.txt', result);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(captured!.state.message).toBe('已移动 a.txt');
  });

  it('keeps a main-process rejection recoverable without mutationEpoch or optimistic migration', async () => {
    mockDesktop(
      vi.fn(async (): Promise<WorkspaceMutationResult> => ({
        status: 'error',
        mutationId: 1,
        error: { code: 'TARGET_EXISTS', message: '目标已存在，不覆盖' },
      })),
    );
    const commit = vi.fn();
    const notify = vi.fn();
    render(<Harness epoch={4} refresh={vi.fn(async () => true)} commit={commit} notify={notify} />);
    await act(async () => captured!.relocateByDrop('a.txt', 'target', 4));
    expect(captured!.state.error?.code).toBe('TARGET_EXISTS');
    expect(commit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('ignores a late success after workspace epoch changes and clears pending UI state', async () => {
    let resolve!: (result: WorkspaceMutationResult) => void;
    mockDesktop(
      vi.fn(
        () =>
          new Promise<WorkspaceMutationResult>((done) => {
            resolve = done;
          }),
      ),
    );
    const refresh = vi.fn(async () => true);
    const commit = vi.fn();
    const notify = vi.fn();
    const view = render(<Harness epoch={4} refresh={refresh} commit={commit} notify={notify} />);
    let pending!: Promise<void>;
    await act(async () => {
      pending = captured!.relocateByDrop('a.txt', 'target', 4);
      await Promise.resolve();
    });
    view.rerender(<Harness epoch={5} refresh={refresh} commit={commit} notify={notify} />);
    await act(async () => {
      resolve({
        status: 'succeeded',
        mutationId: 1,
        relativePath: 'target/a.txt',
        kind: 'text',
      });
      await pending;
    });
    expect(captured!.state.status).toBe('idle');
    expect(commit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
