/**
 * 多标签页标签栏（TASK-005 WP2，第 6.2 节）。
 *
 * - 每个标签是可聚焦、可键盘激活的按钮，暴露 `role="tab"` 与 `aria-selected`；
 * - 完整相对路径通过 `title` 可发现（无障碍名称使用文件名）；
 * - 关闭按钮具有包含文件名的可访问名称；dirty 标记带"未保存"可访问文本；
 * - 标签横向溢出可滚动，不挤压正文区域。
 */

import type { TextDocumentTabState } from '../../lib/text-document-tabs';

export function TabBar({
  tabs,
  activeTabId,
  onActivate,
  onCloseRequest,
}: {
  readonly tabs: readonly TextDocumentTabState[];
  readonly activeTabId: string | null;
  readonly onActivate: (tabId: string) => void;
  readonly onCloseRequest: (tabId: string) => void;
}): React.JSX.Element {
  return (
    <div className="editor-tabs" role="tablist" aria-label="打开的文档">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div className={isActive ? 'tab active' : 'tab'} key={tab.id}>
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              className="tab-label"
              title={tab.relativePath}
              onClick={() => onActivate(tab.id)}
            >
              <span className="tab-name">{tab.name}</span>
              {tab.dirty && (
                <span className="tab-dirty" aria-label="未保存">
                  ●
                </span>
              )}
            </button>
            <button
              type="button"
              className="tab-close-btn"
              aria-label={`关闭 ${tab.name}`}
              onClick={() => onCloseRequest(tab.id)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
