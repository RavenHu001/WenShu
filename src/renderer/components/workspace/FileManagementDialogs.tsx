/**
 * 文件管理对话框（TASK-009 WP6）：名称输入、工作区内目录选择、覆盖确认、删除确认。
 * - 名称输入：受控 input，Enter 提交 / Esc 取消，焦点进入输入框，取消恢复焦点到操作栏；
 * - 目录选择：只列出工作区内的普通目录（含根），当前目标高亮；
 * - 覆盖确认：绑定目标 revision 的明确覆盖说明（无 force 捷径）；
 * - 删除确认：路径、类型与受影响 dirty 标签数；saving 阻止在 controller 层。
 */

import { useEffect, useRef } from 'react';
import type { WorkspaceEntry, WorkspaceSnapshot } from '../../../shared/workspace';
import type { FileManagementMode, FileManagementUiState } from '../../lib/use-file-management';

function collectDirectories(
  entries: readonly WorkspaceEntry[],
  out: { relativePath: string; name: string; depth: number }[],
  depth: number,
): void {
  for (const entry of entries) {
    if (entry.kind === 'directory') {
      out.push({ relativePath: entry.relativePath, name: entry.name, depth });
      if (entry.children !== undefined) {
        collectDirectories(entry.children, out, depth + 1);
      }
    }
  }
}

function modeTitle(mode: FileManagementMode | null): string {
  switch (mode) {
    case 'create-text':
      return '新建 TXT';
    case 'create-docx':
      return '新建 DOCX';
    case 'create-directory':
      return '新建文件夹';
    case 'rename':
      return '重命名';
    case 'save-as':
      return '另存为名称';
    default:
      return '输入名称';
  }
}

function restoreFocusToToolbar(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-testid="fm-create-text"]');
  button?.focus();
}

export function FileManagementDialogs({
  state,
  workspace,
  onSetInputName,
  onSubmitInput,
  onPickTarget,
  onConfirmTarget,
  onConfirmOverwrite,
  onConfirmTrash,
  onCancel,
  onDismissMessage,
}: {
  readonly state: FileManagementUiState;
  readonly workspace: WorkspaceSnapshot | null;
  readonly onSetInputName: (name: string) => void;
  readonly onSubmitInput: () => void;
  readonly onPickTarget: (parentRelativePath: string) => void;
  readonly onConfirmTarget: () => void;
  readonly onConfirmOverwrite: () => void;
  readonly onConfirmTrash: () => void;
  readonly onCancel: () => void;
  readonly onDismissMessage: () => void;
}): React.JSX.Element | null {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 名称输入 / 目标选择 / 确认对话框
  const inputMode =
    state.mode === 'create-text' ||
    state.mode === 'create-docx' ||
    state.mode === 'create-directory' ||
    state.mode === 'rename' ||
    state.mode === 'save-as';
  // running 期间保持对话框可见（提交按钮禁用），失败保留输入可重试
  const showInput =
    (state.status === 'editing-input' || state.status === 'running' || state.status === 'error') &&
    inputMode;

  useEffect(() => {
    if (showInput) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [showInput]);

  if (showInput) {
    const hint =
      state.mode === 'save-as'
        ? `目标文件夹：${state.parentRelativePath === '' ? '（工作区根）' : state.parentRelativePath}`
        : state.mode === 'rename'
          ? ''
          : `目标文件夹：${state.parentRelativePath === '' ? '（工作区根）' : state.parentRelativePath}`;
    return (
      <div className="confirm-overlay">
        <div
          className="confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={modeTitle(state.mode)}
        >
          <div className="confirm-title">{modeTitle(state.mode)}</div>
          {hint !== '' && <div className="confirm-message">{hint}</div>}
          {state.error !== null && (
            <div className="fm-error-banner" role="alert">
              <span>{state.error.message}</span>
            </div>
          )}
          <input
            ref={inputRef}
            className="fm-name-input"
            data-testid="fm-name-input"
            value={state.inputName}
            onChange={(event) => onSetInputName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSubmitInput();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
              }
            }}
            aria-label="名称"
          />
          <div className="confirm-actions">
            <button
              type="button"
              className="ws-btn"
              data-testid="fm-input-cancel"
              onClick={() => {
                onCancel();
                restoreFocusToToolbar();
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="ws-btn ws-btn-primary"
              data-testid="fm-input-confirm"
              disabled={state.status === 'running'}
              onClick={onSubmitInput}
            >
              确定
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'choosing-target' || (state.status === 'running' && state.mode === 'move')) {
    const directories: { relativePath: string; name: string; depth: number }[] = [];
    if (workspace !== null) {
      collectDirectories(workspace.entries, directories, 1);
    }
    const title = state.mode === 'save-as' ? '选择另存为的目标文件夹' : '选择移动的目标文件夹';
    return (
      <div className="confirm-overlay">
        <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label={title}>
          <div className="confirm-title">{title}</div>
          <div className="fm-target-list" role="listbox" aria-label="工作区文件夹">
            <button
              type="button"
              role="option"
              aria-selected={state.parentRelativePath === ''}
              className={
                state.parentRelativePath === ''
                  ? 'fm-target-row fm-target-selected'
                  : 'fm-target-row'
              }
              data-testid="fm-target-root"
              onClick={() => onPickTarget('')}
            >
              （工作区根）
            </button>
            {directories.map((dir) => (
              <button
                type="button"
                role="option"
                aria-selected={state.parentRelativePath === dir.relativePath}
                className={
                  state.parentRelativePath === dir.relativePath
                    ? 'fm-target-row fm-target-selected'
                    : 'fm-target-row'
                }
                key={dir.relativePath}
                data-testid={`fm-target-${dir.relativePath}`}
                style={{ paddingLeft: 8 + (dir.depth - 1) * 16 }}
                onClick={() => onPickTarget(dir.relativePath)}
              >
                {dir.relativePath}
              </button>
            ))}
          </div>
          <div className="confirm-actions">
            <button
              type="button"
              className="ws-btn"
              data-testid="fm-target-cancel"
              onClick={() => {
                onCancel();
                restoreFocusToToolbar();
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="ws-btn ws-btn-primary"
              data-testid="fm-target-confirm"
              disabled={state.status === 'running'}
              onClick={onConfirmTarget}
            >
              确定
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'confirming-overwrite' && state.pendingOverwrite !== null) {
    const pending = state.pendingOverwrite;
    const targetPath =
      pending.target.parentRelativePath === ''
        ? pending.target.name
        : `${pending.target.parentRelativePath}/${pending.target.name}`;
    return (
      <div className="confirm-overlay">
        <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="确认覆盖另存为">
          <div className="confirm-title">确认覆盖另存为</div>
          <div className="confirm-message">
            目标 `{targetPath}` 已存在（revision {pending.targetRevision.slice(0, 8)}…）。
            覆盖将替换该文件，且确认只对当前版本有效；若文件在确认前再次变化，需要重新确认。
          </div>
          {state.error !== null && (
            <div className="fm-error-banner" role="alert">
              <span>{state.error.message}</span>
            </div>
          )}
          <div className="confirm-actions">
            <button
              type="button"
              className="ws-btn"
              data-testid="fm-overwrite-cancel"
              onClick={() => {
                onCancel();
                restoreFocusToToolbar();
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="ws-btn ws-btn-primary"
              data-testid="fm-overwrite-confirm"
              onClick={onConfirmOverwrite}
            >
              确认覆盖
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'confirming-trash' && state.pendingTrash !== null) {
    const pending = state.pendingTrash;
    const dirtyText =
      pending.dirtyCount === 0
        ? '没有未保存的标签。'
        : pending.dirtyCount === 1
          ? '有 1 个未保存标签将被放弃。'
          : `有 ${pending.dirtyCount} 个未保存标签将被放弃。`;
    return (
      <div className="confirm-overlay">
        <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="确认删除">
          <div className="confirm-title">确认删除到回收站</div>
          <div className="confirm-message">
            将删除 {pending.kindLabel} `{pending.relativePath}` 到 Windows 回收站。{dirtyText}
            删除后可通过回收站恢复，但标签将关闭。
          </div>
          <div className="confirm-actions">
            <button
              type="button"
              className="ws-btn"
              data-testid="fm-trash-cancel"
              onClick={() => {
                onCancel();
                restoreFocusToToolbar();
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="ws-btn ws-btn-primary"
              data-testid="fm-trash-confirm"
              onClick={onConfirmTrash}
            >
              删除
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'partial-failure') {
    return (
      <div className="confirm-overlay">
        <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="操作部分完成">
          <div className="confirm-title">操作部分完成</div>
          <div className="confirm-message">
            {state.message ?? '操作部分完成，工作区已强制刷新；请核对实际文件状态后重试。'}
          </div>
          <div className="confirm-actions">
            <button
              type="button"
              className="ws-btn ws-btn-primary"
              data-testid="fm-partial-dismiss"
              onClick={() => {
                onDismissMessage();
                restoreFocusToToolbar();
              }}
            >
              知道了
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
