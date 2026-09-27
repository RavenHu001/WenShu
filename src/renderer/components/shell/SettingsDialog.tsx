import { useState } from 'react';
import type { AppPreferences, StateFileName } from '../../../shared/app-state';
import type { AppSettingsController } from '../../lib/use-app-settings';
import { ModalDialog } from '../common/ModalDialog';

export const startupLabels = {
  blank: '空白启动',
  workspace: '恢复工作区',
  'workspace-and-tabs': '恢复工作区与标签',
} as const;

export function SettingsDialog({
  settings,
  onClose,
}: {
  readonly settings: AppSettingsController;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { preferences, snapshot, busy, error, message, update, action } = settings;
  const [reset, setReset] = useState<StateFileName | null>(null);
  return (
    <ModalDialog title="设置" onCancel={onClose}>
      <div
        className="settings-dialog"
        onKeyDown={(event) => {
          if (event.key !== 'Tab' && event.key !== 'Escape') event.stopPropagation();
        }}
      >
        <h2>设置</h2>
        <fieldset disabled={snapshot === null || settings.resetting}>
          <legend>显示</legend>
          <div className="settings-row">
            <label htmlFor="settings-theme">主题</label>
            <select
              id="settings-theme"
              value={preferences.theme}
              onChange={(event) => update({ theme: event.target.value as AppPreferences['theme'] })}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </div>
          <div className="settings-row">
            <label htmlFor="settings-font">TXT 字体</label>
            <select
              id="settings-font"
              value={preferences.txtFontPreset}
              onChange={(event) =>
                update({ txtFontPreset: event.target.value as AppPreferences['txtFontPreset'] })
              }
            >
              <option value="system">系统默认</option>
              <option value="monospace">等宽</option>
              <option value="serif">衬线</option>
            </select>
          </div>
          <div className="settings-row">
            <label htmlFor="settings-size">TXT 字号</label>
            <select
              id="settings-size"
              value={preferences.txtFontSizePx}
              onChange={(event) => update({ txtFontSizePx: Number(event.target.value) })}
            >
              {Array.from({ length: 13 }, (_, index) => index + 12).map((size) => (
                <option key={size} value={size}>
                  {size} px
                </option>
              ))}
            </select>
          </div>
          <p>显示即时预览，不改变正文。DOCX 保留原文字格式与白色画布。</p>
        </fieldset>
        <fieldset disabled={snapshot === null || settings.resetting}>
          <legend>启动</legend>
          <div className="settings-row">
            <label htmlFor="settings-startup">启动方式</label>
            <select
              id="settings-startup"
              value={preferences.startupMode}
              onChange={(event) =>
                update({ startupMode: event.target.value as AppPreferences['startupMode'] })
              }
            >
              {Object.entries(startupLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <p>启动恢复重新打开磁盘文件，未保存内容仍需手动保存。</p>
          <p>启动时按已保存的方式重新打开工作区与磁盘文件。</p>
          {snapshot && preferences.startupMode !== snapshot.effectiveStartupMode && (
            <p role="status">
              此模式尚未保存。当前有效方式：{startupLabels[snapshot.effectiveStartupMode]}。
            </p>
          )}
        </fieldset>
        <fieldset>
          <legend>数据位置</legend>
          <p className="settings-data-path" aria-label="当前数据目录">
            {snapshot?.dataDirectory.path ?? '数据目录信息不可用'}
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="ws-btn"
              disabled={!snapshot || busy}
              onClick={() => void action('open')}
            >
              打开数据目录
            </button>
            {snapshot?.dataDirectory.canReselect && (
              <button
                type="button"
                className="ws-btn"
                disabled={busy}
                onClick={() => void action('reselect')}
              >
                下次启动重新选择数据目录
              </button>
            )}
          </div>
          {snapshot?.dataDirectory.canReselect && (
            <p>
              不立即退出或搬迁数据。若需保留设置，请正常退出后手动复制数据目录，再在下次启动选择新位置。
            </p>
          )}
          {(['settings', 'state'] as const).map((file) => {
            const health = snapshot?.files[file];
            if (!health?.error) return null;
            const resettable = health.status === 'invalid' || health.status === 'too-large';
            return (
              <div className="settings-error" role="alert" key={file}>
                <p>
                  {file}.json：{health.error.message}
                </p>
                {resettable &&
                  (reset === file ? (
                    <div className="settings-actions">
                      <button
                        className="ws-btn"
                        disabled={busy}
                        onClick={() => {
                          setReset(null);
                          void action(file);
                        }}
                      >
                        保留原件并确认重置 {file}.json
                      </button>
                      <button className="ws-btn" onClick={() => setReset(null)}>
                        取消重置
                      </button>
                    </div>
                  ) : (
                    <button className="ws-btn" disabled={busy} onClick={() => setReset(file)}>
                      重置 {file}.json…
                    </button>
                  ))}
              </div>
            );
          })}
        </fieldset>
        <div className="settings-feedback" aria-live="polite">
          {snapshot?.files.settings.status === 'missing' && !message && (
            <p>尚无设置文件，当前使用默认值；更改后保存。</p>
          )}
          {message && <p role="status">{message}</p>}
          {error && (
            <p className="settings-error" role="alert">
              {error.message}
            </p>
          )}
          {error?.retryable && (
            <button className="ws-btn" disabled={busy} onClick={settings.retry}>
              重试
            </button>
          )}
          {settings.actionError && (
            <p className="settings-error" role="alert">
              {settings.actionError.message}
            </p>
          )}
          {settings.actionError?.retryable && (
            <button className="ws-btn" disabled={busy} onClick={settings.retryAction}>
              重试操作
            </button>
          )}
        </div>
        <div className="confirm-actions">
          <button className="ws-btn" onClick={onClose}>
            关闭设置
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
