import { Icon } from '../common/Icon';

export function StatusBar({
  documentType,
  saveStatus,
  tone = 'neutral',
  saveStatusTitle,
}: {
  readonly documentType: string | null;
  readonly saveStatus: string;
  readonly tone?: 'neutral' | 'success' | 'warning' | 'error';
  readonly saveStatusTitle?: string;
}): React.JSX.Element {
  return (
    <footer className="statusbar">
      <span className={`statusbar-save statusbar-save--${tone}`} title={saveStatusTitle}>
        <Icon
          name={tone === 'error' ? 'error' : tone === 'warning' ? 'warning' : 'check'}
          size={13}
        />
        {saveStatus}
      </span>
      <span className="statusbar-context">
        {documentType !== null && <span>{documentType}</span>}
      </span>
    </footer>
  );
}
