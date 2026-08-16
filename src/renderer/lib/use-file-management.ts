/**
 * 文件管理 controller（TASK-009 WP6，§5.3 / §4.12）。
 *
 * ## 状态机
 *
 * `idle` → `editing-input`（新建/重命名/另存为名称）→ `running` → `succeeded`/error；
 * `choosing-target`（移动/另存为选目录）→ `editing-input`；
 * 另存为第一阶段 target-exists → `confirming-overwrite` → 二次提交（expectedTargetRevision）；
 * 删除 → `confirming-trash`（含 dirty 标签数）→ `running`；
 * PARTIAL_FAILURE → `partial-failure`（强制刷新，禁止假定原路径/目标路径）。
 *
 * ## 不变量
 *
 * - 所有磁盘动作只经固定窄 API（create、relocate、trash、reveal、saveAsTab）；
 * - 主进程成功前不乐观迁移/关闭标签（成功后才 commitRelocateResult/commitTrashResult）；
 * - running 状态拒绝重复提交（组件同时禁用按钮）；
 * - 失败保留输入与目标选择，可修改重试或取消；取消保留选择与展开状态；
 * - 受影响标签 saving 时阻止 relocate/trash（不发 IPC）；
 * - 选择与展开：选中条目独立于活动文档；展开集合集中持有，路径迁移按段边界迁移；
 * - 成功操作触发工作区刷新；partial failure 强制刷新。
 */

import { useCallback, useRef, useState } from 'react';
import {
  FILE_MANAGEMENT_ERROR_MESSAGES,
  validateWindowsLeafName,
  type FileManagementError,
  type SaveAsResult,
  type WorkspaceMutationResult,
  type WorkspaceTargetName,
} from '../../shared/file-management';
import type { DocumentTabState } from './document-tabs';
import type { WorkspaceEntry, WorkspaceSnapshot } from '../../shared/workspace';

export type FileManagementStatus =
  | 'idle'
  | 'editing-input'
  | 'choosing-target'
  | 'confirming-overwrite'
  | 'confirming-trash'
  | 'running'
  | 'succeeded'
  | 'error'
  | 'partial-failure';

export type FileManagementMode =
  'create-text' | 'create-docx' | 'create-directory' | 'rename' | 'move' | 'save-as';

export interface FileManagementUiState {
  readonly status: FileManagementStatus;
  readonly mode: FileManagementMode | null;
  /** 当前选中条目（文件树操作目标；与活动文档分离）。 */
  readonly selectedPath: string | null;
  /** 集中展开目录集合（规范相对路径）。 */
  readonly expandedDirs: ReadonlySet<string>;
  /** 新建父目录 / 移动目标父目录 / 另存为目标父目录（'' = 工作区根）。 */
  readonly parentRelativePath: string;
  /** 名称输入草稿。 */
  readonly inputName: string;
  /** 另存为的目标标签（stable tabId）。 */
  readonly saveAsTabId: string | null;
  readonly pendingOverwrite: {
    readonly tabId: string;
    readonly target: WorkspaceTargetName;
    readonly targetRevision: string;
  } | null;
  readonly pendingTrash: {
    readonly relativePath: string;
    readonly kindLabel: string;
    readonly dirtyCount: number;
  } | null;
  readonly runningMutationId: number | null;
  readonly error: FileManagementError | null;
  readonly message: string | null;
}

export interface FileManagementController {
  readonly state: FileManagementUiState;
  readonly selectEntry: (relativePath: string) => void;
  readonly toggleDir: (relativePath: string) => void;
  readonly beginCreate: (kind: 'text' | 'docx' | 'directory') => void;
  readonly beginRename: () => void;
  readonly beginMove: () => void;
  readonly beginSaveAs: (tabId: string) => void;
  readonly beginDelete: () => void;
  readonly revealSelected: () => void;
  readonly setInputName: (name: string) => void;
  readonly submitInput: () => void;
  readonly pickTarget: (parentRelativePath: string) => void;
  readonly confirmTarget: () => void;
  readonly confirmOverwrite: () => void;
  readonly confirmTrash: () => void;
  readonly cancel: () => void;
  readonly dismissMessage: () => void;
}

export interface UseFileManagementParams {
  /** 当前工作区快照（目录判断与目标选择列表来源）。 */
  readonly workspace: WorkspaceSnapshot | null;
  readonly workspaceEpoch: number;
  readonly refreshWorkspace: () => void | Promise<void>;
  /** 新建 TXT/DOCX 成功后打开唯一干净标签（§4.6）。 */
  readonly openFile: (relativePath: string) => Promise<unknown>;
  /** use-documents 纯提交（成功后迁移/关闭标签，不调 IPC）。 */
  readonly commitRelocate: (sourceRelativePath: string, result: WorkspaceMutationResult) => void;
  readonly commitTrash: (relativePath: string, result: WorkspaceMutationResult) => void;
  /** use-documents saveAsTab（含两阶段覆盖编排）。 */
  readonly saveAsTab: (
    tabId: string,
    target: WorkspaceTargetName,
    options?: { readonly expectedTargetRevision?: string },
  ) => Promise<SaveAsResult>;
  /** 当前全部标签（dirty/saving 判定）。 */
  readonly tabs: readonly DocumentTabState[];
}

function basenameOf(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function parentOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function nameIsValid(name: string): boolean {
  // 与主进程共享同一 Windows 叶名校验（保留名/非法字符/尾随点空格）
  return validateWindowsLeafName(name);
}

const SAVING_BLOCKED_ERROR: FileManagementError = {
  code: 'WRITE_FAILED',
  message: '存在正在保存的标签，请等待保存完成后再操作',
};

function findEntry(
  entries: readonly WorkspaceEntry[],
  relativePath: string,
): WorkspaceEntry | null {
  for (const entry of entries) {
    if (entry.relativePath === relativePath) {
      return entry;
    }
    if (entry.children !== undefined) {
      const found = findEntry(entry.children, relativePath);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}

export function useFileManagement({
  workspace,
  workspaceEpoch,
  refreshWorkspace,
  openFile,
  commitRelocate,
  commitTrash,
  saveAsTab,
  tabs,
}: UseFileManagementParams): FileManagementController {
  const [state, setState] = useState<FileManagementUiState>({
    status: 'idle',
    mode: null,
    selectedPath: null,
    expandedDirs: new Set<string>(),
    parentRelativePath: '',
    inputName: '',
    saveAsTabId: null,
    pendingOverwrite: null,
    pendingTrash: null,
    runningMutationId: null,
    error: null,
    message: null,
  });
  const mutationIdRef = useRef(0);
  const epochRef = useRef(workspaceEpoch);
  epochRef.current = workspaceEpoch;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const update = useCallback((patch: Partial<FileManagementUiState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  /** 受影响标签（精确 + 目录前缀段边界）。 */
  const affectedTabs = useCallback((relativePath: string): readonly DocumentTabState[] => {
    return tabsRef.current.filter(
      (tab) => tab.relativePath === relativePath || tab.relativePath.startsWith(`${relativePath}/`),
    );
  }, []);

  /** 展开集合按段边界迁移（目录 relocate）。 */
  const migrateExpanded = useCallback(
    (from: string, to: string): ReadonlySet<string> => {
      const next = new Set<string>();
      for (const dir of state.expandedDirs) {
        if (dir === from) {
          next.add(to);
        } else if (dir.startsWith(`${from}/`)) {
          next.add(`${to}/${dir.slice(from.length + 1)}`);
        } else {
          next.add(dir);
        }
      }
      return next;
    },
    [state.expandedDirs],
  );

  const removeExpandedUnder = useCallback(
    (relativePath: string): ReadonlySet<string> => {
      const next = new Set<string>();
      for (const dir of state.expandedDirs) {
        if (dir !== relativePath && !dir.startsWith(`${relativePath}/`)) {
          next.add(dir);
        }
      }
      return next;
    },
    [state.expandedDirs],
  );

  /** 成功后的统一副作用：刷新 + 消息 + 迁移/打开。 */
  const applySuccess = useCallback(
    async (message: string, sideEffects: () => void): Promise<void> => {
      sideEffects();
      await refreshWorkspace();
      update({ status: 'succeeded', runningMutationId: null, error: null, message });
    },
    [refreshWorkspace, update],
  );

  const applyError = useCallback(
    (error: FileManagementError): void => {
      update({ status: 'error', runningMutationId: null, error, message: null });
    },
    [update],
  );

  const selectEntry = useCallback(
    (relativePath: string): void => {
      update({ selectedPath: relativePath, message: null, error: null });
    },
    [update],
  );

  const toggleDir = useCallback((relativePath: string): void => {
    setState((prev) => {
      const next = new Set(prev.expandedDirs);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
      }
      return { ...prev, expandedDirs: next };
    });
  }, []);

  const beginCreate = useCallback(
    (kind: 'text' | 'docx' | 'directory'): void => {
      const selected = state.selectedPath;
      // 目标父目录 = 选中目录本身，或选中文件的父目录；无选中 = 根
      let parent = '';
      if (selected !== null) {
        const entry = findEntry(workspace?.entries ?? [], selected);
        parent = entry?.kind === 'directory' ? selected : parentOf(selected);
      }
      update({
        status: 'editing-input',
        mode:
          kind === 'text' ? 'create-text' : kind === 'docx' ? 'create-docx' : 'create-directory',
        parentRelativePath: parent,
        inputName: '',
        error: null,
        message: null,
      });
    },
    [state.selectedPath, update, workspace],
  );

  const beginRename = useCallback((): void => {
    const selected = state.selectedPath;
    if (selected === null || selected === '') {
      return;
    }
    update({
      status: 'editing-input',
      mode: 'rename',
      parentRelativePath: parentOf(selected),
      inputName: basenameOf(selected),
      error: null,
      message: null,
    });
  }, [state.selectedPath, update]);

  const beginMove = useCallback((): void => {
    const selected = state.selectedPath;
    if (selected === null || selected === '') {
      return;
    }
    update({
      status: 'choosing-target',
      mode: 'move',
      parentRelativePath: parentOf(selected),
      error: null,
      message: null,
    });
  }, [state.selectedPath, update]);

  const beginSaveAs = useCallback(
    (tabId: string): void => {
      const tab = tabsRef.current.find((item) => item.id === tabId);
      if (tab === null || tab === undefined) {
        return;
      }
      if (tab.document === null || tab.status === 'loading' || tab.status === 'read-only') {
        return;
      }
      update({
        status: 'choosing-target',
        mode: 'save-as',
        parentRelativePath: parentOf(tab.relativePath),
        saveAsTabId: tabId,
        error: null,
        message: null,
      });
    },
    [update],
  );

  const beginDelete = useCallback((): void => {
    const selected = state.selectedPath;
    if (selected === null || selected === '') {
      return;
    }
    if (affectedTabs(selected).some((tab) => tab.saving)) {
      applyError(SAVING_BLOCKED_ERROR);
      return;
    }
    const dirtyCount = affectedTabs(selected).filter((tab) => tab.dirty).length;
    const lower = selected.toLowerCase();
    const kindLabel = lower.endsWith('.txt')
      ? '文本文件'
      : lower.endsWith('.docx')
        ? 'Word 文档'
        : affectedTabs(selected).some((tab) => tab.relativePath !== selected)
          ? '文件夹'
          : '文件';
    update({
      status: 'confirming-trash',
      pendingTrash: { relativePath: selected, kindLabel, dirtyCount },
      error: null,
      message: null,
    });
  }, [state.selectedPath, affectedTabs, applyError, update]);

  const revealSelected = useCallback((): void => {
    const selected = state.selectedPath;
    if (selected === null || selected === '') {
      return;
    }
    const mutationId = ++mutationIdRef.current;
    update({ status: 'running', runningMutationId: mutationId, error: null, message: null });
    window.desktop.workspace
      .reveal({ revealRoot: false, relativePath: selected })
      .then((result) => {
        if (result.status === 'revealed') {
          void applySuccess(`已在资源管理器中显示 ${basenameOf(selected)}`, () => undefined);
        } else {
          applyError(result.error);
        }
      })
      .catch(() =>
        applyError({
          code: 'REVEAL_FAILED',
          message: FILE_MANAGEMENT_ERROR_MESSAGES.REVEAL_FAILED,
        }),
      );
  }, [state.selectedPath, applySuccess, applyError, update]);

  const setInputName = useCallback(
    (name: string): void => {
      update({ inputName: name, error: null });
    },
    [update],
  );

  /** 提交名称类操作：create / rename / save-as（第二阶段前）。 */
  const submitInput = useCallback((): void => {
    const name = state.inputName.trim();
    if (!nameIsValid(name)) {
      applyError({ code: 'INVALID_NAME', message: FILE_MANAGEMENT_ERROR_MESSAGES.INVALID_NAME });
      return;
    }
    const mutationId = ++mutationIdRef.current;
    update({ status: 'running', runningMutationId: mutationId, error: null, message: null });

    if (
      state.mode === 'create-text' ||
      state.mode === 'create-docx' ||
      state.mode === 'create-directory'
    ) {
      const kind =
        state.mode === 'create-text' ? 'text' : state.mode === 'create-docx' ? 'docx' : 'directory';
      const request = { mutationId, parentRelativePath: state.parentRelativePath, name };
      const api =
        kind === 'text'
          ? window.desktop.workspace.createText
          : kind === 'docx'
            ? window.desktop.workspace.createDocx
            : window.desktop.workspace.createDirectory;
      api(request)
        .then(async (result) => {
          if (result.status === 'succeeded') {
            await applySuccess(`已创建 ${name}`, () => {
              if (kind === 'text' || kind === 'docx') {
                void openFile(result.relativePath);
              }
              if (kind === 'directory') {
                update({ expandedDirs: new Set(state.expandedDirs).add(result.relativePath) });
                selectEntry(result.relativePath);
              }
            });
          } else {
            applyError(result.error);
          }
        })
        .catch(() =>
          applyError({
            code: 'WRITE_FAILED',
            message: FILE_MANAGEMENT_ERROR_MESSAGES.WRITE_FAILED,
          }),
        );
      return;
    }

    if (state.mode === 'rename') {
      const source = state.selectedPath;
      if (source === null || source === '') {
        applyError({
          code: 'INVALID_REQUEST',
          message: FILE_MANAGEMENT_ERROR_MESSAGES.INVALID_REQUEST,
        });
        return;
      }
      if (affectedTabs(source).some((tab) => tab.saving)) {
        applyError(SAVING_BLOCKED_ERROR);
        return;
      }
      window.desktop.workspace
        .relocate({
          mutationId,
          sourceRelativePath: source,
          parentRelativePath: state.parentRelativePath,
          name,
        })
        .then(async (result) => {
          if (result.status === 'succeeded') {
            await applySuccess(`已重命名为 ${name}`, () => {
              commitRelocate(source, result);
              if (result.kind === 'directory') {
                update({ expandedDirs: migrateExpanded(source, result.relativePath) });
              }
              selectEntry(result.relativePath);
            });
          } else {
            applyError(result.error);
          }
        })
        .catch(() =>
          applyError({
            code: 'WRITE_FAILED',
            message: FILE_MANAGEMENT_ERROR_MESSAGES.WRITE_FAILED,
          }),
        );
      return;
    }

    if (state.mode === 'save-as') {
      const tabId = state.saveAsTabId;
      if (tabId === null) {
        applyError({
          code: 'INVALID_REQUEST',
          message: FILE_MANAGEMENT_ERROR_MESSAGES.INVALID_REQUEST,
        });
        return;
      }
      const target = { parentRelativePath: state.parentRelativePath, name };
      saveAsTab(tabId, target)
        .then((result) => {
          if (result.status === 'saved') {
            void applySuccess(`已另存为 ${name}`, () => {
              void refreshWorkspace();
            });
          } else if (result.status === 'target-exists') {
            update({
              status: 'confirming-overwrite',
              pendingOverwrite: { tabId, target, targetRevision: result.targetRevision },
              runningMutationId: null,
              error: null,
              message: null,
            });
          } else {
            applyError(result.error);
          }
        })
        .catch(() =>
          applyError({
            code: 'WRITE_FAILED',
            message: FILE_MANAGEMENT_ERROR_MESSAGES.WRITE_FAILED,
          }),
        );
      return;
    }

    applyError({
      code: 'INVALID_REQUEST',
      message: FILE_MANAGEMENT_ERROR_MESSAGES.INVALID_REQUEST,
    });
  }, [
    state.mode,
    state.inputName,
    state.parentRelativePath,
    state.selectedPath,
    state.saveAsTabId,
    state.expandedDirs,
    affectedTabs,
    applyError,
    applySuccess,
    commitRelocate,
    migrateExpanded,
    openFile,
    refreshWorkspace,
    saveAsTab,
    selectEntry,
    update,
  ]);

  const pickTarget = useCallback(
    (parentRelativePath: string): void => {
      update({ parentRelativePath, error: null });
    },
    [update],
  );

  /** 确认目标（移动执行；另存为进入名称输入）。 */
  const confirmTarget = useCallback((): void => {
    if (state.mode === 'save-as') {
      const tab = tabsRef.current.find((item) => item.id === state.saveAsTabId);
      update({
        status: 'editing-input',
        inputName: tab === undefined ? '' : basenameOf(tab.relativePath),
        error: null,
        message: null,
      });
      return;
    }
    const source = state.selectedPath;
    if (source === null || source === '') {
      return;
    }
    if (affectedTabs(source).some((tab) => tab.saving)) {
      applyError(SAVING_BLOCKED_ERROR);
      return;
    }
    const mutationId = ++mutationIdRef.current;
    update({ status: 'running', runningMutationId: mutationId, error: null, message: null });
    window.desktop.workspace
      .relocate({
        mutationId,
        sourceRelativePath: source,
        parentRelativePath: state.parentRelativePath,
        name: basenameOf(source),
      })
      .then(async (result) => {
        if (result.status === 'succeeded') {
          await applySuccess(`已移动到 ${result.relativePath}`, () => {
            commitRelocate(source, result);
            if (result.kind === 'directory') {
              update({ expandedDirs: migrateExpanded(source, result.relativePath) });
            }
            selectEntry(result.relativePath);
          });
        } else {
          applyError(result.error);
        }
      })
      .catch(() =>
        applyError({ code: 'WRITE_FAILED', message: FILE_MANAGEMENT_ERROR_MESSAGES.WRITE_FAILED }),
      );
  }, [
    state.mode,
    state.saveAsTabId,
    state.selectedPath,
    state.parentRelativePath,
    affectedTabs,
    applyError,
    applySuccess,
    commitRelocate,
    migrateExpanded,
    selectEntry,
    update,
  ]);

  const confirmOverwrite = useCallback((): void => {
    const pending = state.pendingOverwrite;
    if (pending === null) {
      return;
    }
    const mutationId = ++mutationIdRef.current;
    update({ status: 'running', runningMutationId: mutationId, error: null, message: null });
    saveAsTab(pending.tabId, pending.target, {
      expectedTargetRevision: pending.targetRevision,
    })
      .then((result) => {
        if (result.status === 'saved') {
          void applySuccess(`已覆盖另存为 ${pending.target.name}`, () => {
            void refreshWorkspace();
          });
        } else if (result.status === 'target-exists') {
          // 目标在确认后又变化：回到确认（重新绑定新 revision）
          update({
            status: 'confirming-overwrite',
            pendingOverwrite: { ...pending, targetRevision: result.targetRevision },
            runningMutationId: null,
            error: null,
            message: null,
          });
        } else {
          applyError(result.error);
        }
      })
      .catch(() =>
        applyError({ code: 'WRITE_FAILED', message: FILE_MANAGEMENT_ERROR_MESSAGES.WRITE_FAILED }),
      );
  }, [state.pendingOverwrite, applyError, applySuccess, refreshWorkspace, saveAsTab, update]);

  const confirmTrash = useCallback((): void => {
    const pending = state.pendingTrash;
    if (pending === null) {
      return;
    }
    const mutationId = ++mutationIdRef.current;
    update({ status: 'running', runningMutationId: mutationId, error: null, message: null });
    window.desktop.workspace
      .trash({ mutationId, relativePath: pending.relativePath })
      .then(async (result) => {
        if (result.status === 'succeeded') {
          await applySuccess(`已删除 ${pending.kindLabel} 到回收站`, () => {
            commitTrash(pending.relativePath, result);
            update({ expandedDirs: removeExpandedUnder(pending.relativePath) });
            update({ selectedPath: null });
          });
        } else if (result.error.code === 'PARTIAL_FAILURE') {
          // 部分完成：禁止假定路径状态，强制刷新并提示
          await refreshWorkspace();
          update({
            status: 'partial-failure',
            runningMutationId: null,
            error: null,
            message: '操作部分完成（主文件与伴随备份未同时删除），已刷新工作区，请核对后重试',
          });
        } else {
          applyError(result.error);
        }
      })
      .catch(() =>
        applyError({ code: 'TRASH_FAILED', message: FILE_MANAGEMENT_ERROR_MESSAGES.TRASH_FAILED }),
      );
  }, [
    state.pendingTrash,
    applyError,
    applySuccess,
    commitTrash,
    refreshWorkspace,
    removeExpandedUnder,
    update,
  ]);

  const cancel = useCallback((): void => {
    update({
      status: 'idle',
      mode: null,
      parentRelativePath: '',
      inputName: '',
      saveAsTabId: null,
      pendingOverwrite: null,
      pendingTrash: null,
      runningMutationId: null,
      error: null,
      message: null,
    });
  }, [update]);

  const dismissMessage = useCallback((): void => {
    update({ status: 'idle', message: null, error: null });
  }, [update]);

  return {
    state,
    selectEntry,
    toggleDir,
    beginCreate,
    beginRename,
    beginMove,
    beginSaveAs,
    beginDelete,
    revealSelected,
    setInputName,
    submitInput,
    pickTarget,
    confirmTarget,
    confirmOverwrite,
    confirmTrash,
    cancel,
    dismissMessage,
  };
}
