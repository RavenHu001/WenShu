/**
 * TASK-010 WP3 DOCX 当前查找/替换面板（任务第 6.3 节）。
 *
 * - 只经「DocxCurrentSearchControls」窄接口操作 WP2 controller，不接触
 *   Editor/EditorView/插件状态内部；
 * - 查找输入受控自快照（即时搜索，不设草稿/防抖）；计数、截断、输入错误、
 *   read-only/degraded 替换不可用原因均由快照/权限 props 派生；
 * - WP4：替换输入/替换当前项/全部替换接入 WP4 controller；不可用时保持禁用并说明原因；
 * - Enter/Shift+Enter、F3/Shift+F3 导航，Escape 关闭并恢复编辑器焦点；
 * - 最小样式与可访问性状态（aria-label / role=status / 非颜色依赖的当前匹配）。
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type {
  DocxCurrentSearchControls,
  DocxCurrentSearchSnapshot,
} from '../../lib/docx-current-search-plugin';

/** 替换可用性与原因（WP3 恒为不可用；WP4 按权限/实现翻转）。 */
export interface DocxReplaceAvailability {
  readonly available: boolean;
  readonly reason: string;
}

/** 面板不展开时（快照 open=false）渲染为空：关闭面板即移除装饰与输入。 */
function DocxCurrentSearchPanelBody({
  controls,
  snapshot,
  replaceAvailability,
  focusMode,
}: {
  readonly controls: DocxCurrentSearchControls;
  readonly snapshot: DocxCurrentSearchSnapshot;
  readonly replaceAvailability: DocxReplaceAvailability;
  readonly focusMode: 'find' | 'replace' | null;
}): React.JSX.Element {
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (focusMode === 'find') {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    } else if (focusMode === 'replace') {
      replaceInputRef.current?.focus();
      replaceInputRef.current?.select();
    }
  }, [focusMode]);

  const handleFindKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        controls.selectPrevious();
      } else {
        controls.selectNext();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      controls.close();
      controls.focusEditor();
    } else if (event.key === 'F3') {
      event.preventDefault();
      if (event.shiftKey) {
        controls.selectPrevious();
      } else {
        controls.selectNext();
      }
    }
  };

  const statusText = (): string => {
    if (snapshot.validationError !== null) {
      return snapshot.validationError;
    }
    if (snapshot.matches.length === 0) {
      return '无匹配';
    }
    const current = snapshot.currentIndex === null ? 1 : snapshot.currentIndex + 1;
    if (snapshot.truncated) {
      return '第 ' + current + ' / ' + snapshot.matches.length + ' 处（匹配超过 2000 处）';
    }
    return '第 ' + current + ' / ' + snapshot.matches.length + ' 处';
  };

  const handleClose = (): void => {
    controls.close();
    controls.focusEditor();
  };

  return (
    <div className="docx-current-search-panel">
      <div className="docx-search-fields">
        <input
          ref={findInputRef}
          className="docx-search-input"
          type="text"
          value={snapshot.query}
          onChange={(event) => controls.setQuery(event.target.value)}
          onKeyDown={handleFindKeyDown}
          placeholder="在当前 DOCX 中查找…"
          aria-label="查找内容"
        />
        <label className="search-case-label">
          <input
            type="checkbox"
            checked={snapshot.caseSensitive}
            onChange={(event) => controls.setCaseSensitive(event.target.checked)}
          />
          区分大小写
        </label>
        <div className="docx-search-actions">
          <button
            type="button"
            onClick={() => controls.selectPrevious()}
            disabled={snapshot.matches.length === 0}
            aria-label="上一个匹配"
          >
            上一个
          </button>
          <button
            type="button"
            onClick={() => controls.selectNext()}
            disabled={snapshot.matches.length === 0}
            aria-label="下一个匹配"
          >
            下一个
          </button>
          <button
            type="button"
            className="docx-search-close"
            onClick={handleClose}
            aria-label="关闭查找"
          >
            关闭
          </button>
        </div>
        <div className="docx-search-status" role="status">
          {statusText()}
        </div>
      </div>

      <div className="docx-replace-fields">
        <input
          ref={replaceInputRef}
          className="docx-search-input"
          type="text"
          disabled={!replaceAvailability.available}
          value={snapshot.replacement}
          onChange={(event) => controls.setReplacement(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && replaceAvailability.available) {
              event.preventDefault();
              controls.replaceCurrent();
            }
          }}
          placeholder={replaceAvailability.available ? '替换为…' : '替换为（不可用）'}
          aria-label="替换为"
        />
        <div className="docx-replace-actions">
          <button
            type="button"
            disabled={!replaceAvailability.available || snapshot.matches.length === 0}
            onClick={() => controls.replaceCurrent()}
            aria-label="替换当前项"
          >
            替换
          </button>
          <button
            type="button"
            disabled={
              !replaceAvailability.available || snapshot.matches.length === 0 || snapshot.truncated
            }
            onClick={() => controls.replaceAll()}
            aria-label="全部替换"
          >
            全部替换
          </button>
        </div>
        {snapshot.operationMessage !== null && (
          <div className="docx-replace-feedback" role="status">
            {snapshot.operationMessage}
          </div>
        )}
        {!replaceAvailability.available && (
          <div className="docx-replace-reason" role="note">
            {replaceAvailability.reason}
          </div>
        )}
      </div>
    </div>
  );
}

export function DocxCurrentSearchPanel({
  controls,
  replaceAvailability,
  focusMode = null,
}: {
  readonly controls: DocxCurrentSearchControls;
  readonly replaceAvailability: DocxReplaceAvailability;
  readonly focusMode?: 'find' | 'replace' | null;
}): React.JSX.Element | null {
  const snapshot = useSyncExternalStore(
    controls.subscribe,
    controls.getSnapshot,
    controls.getSnapshot,
  );
  if (!snapshot.open) {
    return null;
  }
  return (
    <DocxCurrentSearchPanelBody
      controls={controls}
      snapshot={snapshot}
      replaceAvailability={replaceAvailability}
      focusMode={focusMode}
    />
  );
}
