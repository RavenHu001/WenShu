import type { DesktopRuntimeInfo } from '../../../shared/desktop-api';
import { ModalDialog } from '../common/ModalDialog';
import { Icon } from '../common/Icon';

export function AboutDialog({
  runtime,
  onClose,
}: {
  readonly runtime: DesktopRuntimeInfo;
  readonly onClose: () => void;
}): React.JSX.Element {
  return (
    <ModalDialog title="关于文枢" onCancel={onClose}>
      <div className="about-header">
        <span className="about-mark" aria-hidden="true">
          <Icon name="files" size={24} />
        </span>
        <div>
          <div className="confirm-title">文枢</div>
          <div className="about-subtitle">本地多文档写作工作台 · Pre-alpha</div>
        </div>
      </div>
      <div className="about-details">
        <div>
          <span>平台</span>
          <strong>{runtime.platform === 'win32' ? 'Windows' : runtime.platform}</strong>
        </div>
        <div>
          <span>Electron</span>
          <strong>{runtime.electronVersion}</strong>
        </div>
        <div>
          <span>安全边界</span>
          <strong>
            <Icon name="check" size={14} /> 隔离 renderer
          </strong>
        </div>
      </div>
      <p className="confirm-message">
        文档保存在普通本地文件夹中。当前版本支持 TXT、基础 DOCX、工作区搜索与安全文件管理。
      </p>
      <div className="confirm-actions">
        <button className="ws-btn ws-btn-primary" onClick={onClose} type="button">
          关闭
        </button>
      </div>
    </ModalDialog>
  );
}
