/**
 * 多标签页标签栏（TASK-005 WP2，第 6.2 节）。
 *
 * - 每个标签是可聚焦、可键盘激活的按钮，暴露 `role="tab"` 与 `aria-selected`；
 * - 完整相对路径通过 `title` 可发现（无障碍名称使用文件名）；
 * - 关闭按钮具有包含文件名的可访问名称；dirty 标记带"未保存"可访问文本；
 * - 标签横向溢出可滚动，不挤压正文区域。
 */

import type { DocumentTabState } from '../../lib/document-tabs';
import { Icon } from '../common/Icon';

export function TabBar({
  tabs,
  activeTabId,
  onActivate,
  onCloseRequest,
}: {
  readonly tabs: readonly DocumentTabState[];
  readonly activeTabId: string | null;
  readonly onActivate: (tabId: string) => void;
  readonly onCloseRequest: (tabId: string) => void;
}): React.JSX.Element {
  return (
    <div className="editor-tabs" role="tablist" aria-label="打开的文档">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const hasError =
          tab.status === 'save-error' || tab.status === 'conflict' || tab.status === 'read-error';
        const stateLabel = tab.saving
          ? '，正在保存'
          : hasError
            ? tab.status === 'conflict'
              ? '，外部冲突'
              : '，发生错误'
            : tab.dirty
              ? '，未保存'
              : '';
        return (
          <div
            className={[
              'tab',
              isActive ? 'active' : '',
              tab.dirty ? 'is-dirty' : '',
              tab.saving ? 'is-saving' : '',
              hasError ? 'is-error' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            key={tab.id}
            role="presentation"
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={`${tab.relativePath}${stateLabel}`}
              className="tab-label"
              title={tab.relativePath}
              onClick={() => onActivate(tab.id)}
            >
              <span className="tab-name">{tab.name}</span>
              {tab.dirty && <span className="tab-dirty" aria-label="未保存" />}
              {tab.saving ? (
                <span className="tab-state-icon" aria-label="正在保存">
                  <Icon name="spinner" size={13} />
                </span>
              ) : hasError ? (
                <span className="tab-state-icon" aria-hidden="true">
                  <Icon name="error" size={13} />
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className="tab-close-btn"
              aria-label={`关闭 ${tab.relativePath}`}
              onClick={() => onCloseRequest(tab.id)}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
