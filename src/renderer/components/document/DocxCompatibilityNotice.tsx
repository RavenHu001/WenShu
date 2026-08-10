/**
 * DOCX 兼容性提示 —— 等级、稳定警告与 revision 绑定确认（TASK-007 WP5，第 4.2 / 6.5 节）。
 *
 * - `read-only`：只读提示 + 警告列表（不可编辑不可保存）；
 * - `degraded` 未确认：警告列表 + "确认继续"按钮，确认绑定当前基线 revision
 *   （`confirmDocxCompatibility` 由 controller 以 `document.revision` 调用）；
 * - `degraded` 已确认：显示已确认状态；
 * - `supported`：不显示。
 */

import type { DocxCompatibilityWarning } from '../../../shared/docx';
import type { DocxDocumentTabState } from '../../lib/document-tabs';

export function DocxCompatibilityNotice({
  tab,
  onConfirm,
}: {
  readonly tab: DocxDocumentTabState;
  /** 用户确认继续（绑定 tab 当前基线 revision）。 */
  readonly onConfirm: (tabId: string) => void;
}): React.JSX.Element | null {
  const report = tab.document?.compatibility ?? null;
  if (report === null || report.level === 'supported') {
    return null;
  }
  const readOnly = report.level === 'read-only';
  const degradedUnconfirmed =
    report.level === 'degraded' && tab.compatibilityConfirmationRevision !== tab.document?.revision;

  return (
    <div className={`docx-compat-notice${readOnly ? ' is-read-only' : ''}`} role="status">
      <div className="docx-compat-title">
        {readOnly
          ? '文档为只读状态'
          : degradedUnconfirmed
            ? '文档包含不受支持的内容'
            : '已确认继续编辑'}
      </div>
      <ul className="docx-compat-warnings">
        {report.warnings.map((warning: DocxCompatibilityWarning) => (
          <li key={warning.code}>{warning.message}</li>
        ))}
      </ul>
      {degradedUnconfirmed && (
        <button type="button" className="ws-btn" onClick={() => onConfirm(tab.id)}>
          确认继续编辑并保存
        </button>
      )}
    </div>
  );
}
