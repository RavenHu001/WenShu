import { useCallback, useEffect, useRef, useState } from 'react';
import {
  selectRestoreTabs,
  validTabPath,
  type AppStateSnapshot,
  type SessionCheckpoint,
} from '../../shared/app-state';
import type { DocumentsController } from './use-documents';
import type { WorkspaceController } from './use-workspace';

type Phase = 'waiting' | 'workspace' | 'tabs' | 'ready' | 'error' | 'closing';
interface Options {
  readonly loaded: boolean;
  readonly snapshot: AppStateSnapshot | null;
  readonly workspace: WorkspaceController;
  readonly documents: DocumentsController;
}

/** One startup batch; the existing document controller owns each individual read. */
export function useStartupRestore(options: Options) {
  const current = useRef(options);
  current.current = options;
  const initialPhase: Phase =
    options.loaded &&
    (!options.snapshot ||
      options.snapshot.effectiveStartupMode === 'blank' ||
      (!options.snapshot.state.lastWorkspace && !options.snapshot.files.state.error))
      ? 'ready'
      : 'waiting';
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const phaseRef = useRef<Phase>(initialPhase);
  const [notice, setNotice] = useState('');
  const [writeError, setWriteError] = useState('');
  const mounted = useRef(false);
  const generation = useRef(0);
  const started = useRef(false);
  const queue = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    if (mounted.current) setPhase(next);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const restore = useCallback(async () => {
    if (!mounted.current || ['workspace', 'tabs', 'closing'].includes(phaseRef.current)) return;
    started.current = true;
    const batch = ++generation.current;
    const workspace = current.current.workspace;
    const documents = current.current.documents;
    const valid = () => mounted.current && generation.current === batch;
    setNotice('');
    changePhase('workspace');
    const result = await workspace.restoreLast();
    if (!valid()) return;
    if (result.status === 'error') {
      setNotice(result.error.message);
      changePhase('error');
      return;
    }
    if (result.status !== 'selected') {
      changePhase('ready');
      return;
    }
    changePhase('tabs');
    const sessionValid = () => {
      if (!valid()) return false;
      if (workspace.isCurrentSession(result.workspaceSessionId)) return true;
      changePhase('ready');
      return false;
    };
    // Main has already checked the record. Keep the renderer scheduler bounded and defensive too.
    const paths = result.restore.tabRelativePaths.filter(validTabPath);
    const selected = selectRestoreTabs(paths, result.restore.activeRelativePath);
    const warnings = [...result.restore.warnings];
    if (selected.truncated && !warnings.includes('TAB_LIMIT')) warnings.push('TAB_LIMIT');
    if (
      paths.length !== result.restore.tabRelativePaths.length &&
      !warnings.includes('UNSAFE_PATH')
    )
      warnings.push('UNSAFE_PATH');
    setNotice(
      warnings
        .map((warning) =>
          warning === 'TAB_LIMIT'
            ? '最多恢复 100 个标签，已保留活动标签和所选标签原顺序。'
            : '已拒绝不安全或类型变化的恢复路径。',
        )
        .join(' '),
    );
    let first: string | null = null;
    let active: string | null = null;
    for (const path of selected.paths) {
      if (!sessionValid()) return;
      const tab = await documents.openFile(path);
      if (!sessionValid()) return;
      if (tab) {
        first ??= tab.id;
        if (path === selected.active) active = tab.id;
      }
    }
    if (!sessionValid()) return;
    if (active ?? first) documents.activateTab((active ?? first)!);
    changePhase('ready');
  }, [changePhase]);

  useEffect(() => {
    // StrictMode's first setup is cleaned up before this microtask can start any IPC.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled || started.current || !options.loaded) return;
      if (!options.snapshot) {
        changePhase('ready');
        return;
      }
      if (
        options.workspace.workspaceSessionId ||
        options.snapshot.effectiveStartupMode === 'blank' ||
        (!options.snapshot.state.lastWorkspace && !options.snapshot.files.state.error)
      ) {
        started.current = true;
        changePhase('ready');
      } else void restore();
    });
    return () => {
      cancelled = true;
    };
  }, [
    options.loaded,
    options.snapshot,
    options.workspace.workspaceSessionId,
    restore,
    changePhase,
  ]);

  const stop = useCallback(() => {
    if (phaseRef.current !== 'tabs') return;
    generation.current++;
    setNotice('已停止恢复；保留当前已打开和正在读取的标签。');
    changePhase('ready');
  }, [changePhase]);
  const beforeManualOpen = useCallback(() => {
    started.current = true;
    generation.current++;
    setNotice('');
    changePhase('ready');
  }, [changePhase]);

  const metadata = (): SessionCheckpoint | null => {
    const { workspace, documents, snapshot } = current.current;
    if (!snapshot || !workspace.workspaceSessionId || snapshot.effectiveStartupMode === 'blank')
      return null;
    const tabs = documents.model.state.tabs;
    return {
      workspaceSessionId: workspace.workspaceSessionId,
      tabRelativePaths: tabs.map((tab) => tab.relativePath),
      activeRelativePath:
        tabs.find((tab) => tab.id === documents.model.state.activeTabId)?.relativePath ?? null,
      // WP4 applies/records live layout. WP3 must not overwrite it with initial UI defaults.
      sidebar: snapshot.state.sidebar,
    };
  };
  const metadataRef = useRef(metadata);
  metadataRef.current = metadata;
  const record = useCallback((flush: boolean) => {
    if (phaseRef.current !== 'ready') return queue.current;
    const snapshot = metadataRef.current(); // Capture token WITH paths, never fetch a newer token later.
    if (!snapshot) return queue.current;
    queue.current = queue.current.then(async () => {
      try {
        const result = await window.desktop.appState.checkpoint(snapshot);
        if (result.status === 'error') {
          if (mounted.current) setWriteError(result.error.message);
          return;
        }
        if (mounted.current && result.warnings.includes('TAB_LIMIT'))
          setNotice('最多恢复 100 个标签，已保留活动标签和所选标签原顺序。');
        const saved = flush ? await window.desktop.appState.flush() : result;
        if (mounted.current) setWriteError(saved.status === 'error' ? saved.error.message : '');
      } catch {
        if (mounted.current) setWriteError('本次恢复记录未保存，可重试');
      }
    });
    return queue.current;
  }, []);
  // Content, revisions, read completion, search and editor objects are deliberately absent.
  const key = JSON.stringify(metadata());
  const mode = options.snapshot?.effectiveStartupMode;
  useEffect(() => {
    if (phase !== 'ready' || !key || key === 'null') return;
    timer.current = setTimeout(() => {
      void record(true);
    }, 500);
    return () => {
      clearTimeout(timer.current);
    };
  }, [key, mode, phase, record]);

  const prepareClose = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    // Incomplete/error startup never submits an empty or partial replacement.
    const pending = phaseRef.current === 'ready' ? record(false) : queue.current;
    generation.current++;
    current.current.workspace.cancelPendingOpen();
    current.current.documents.invalidatePendingReads();
    changePhase('closing');
    await pending; // Main's existing quit drain owns accepted writes and failure feedback.
  }, [record, changePhase]);
  return {
    phase,
    busy: phase === 'workspace' || phase === 'tabs' || phase === 'waiting',
    notice,
    writeError,
    restore,
    stop,
    beforeManualOpen,
    prepareClose,
    retryWrite: () => void record(true),
  };
}
