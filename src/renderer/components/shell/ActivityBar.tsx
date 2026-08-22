import { IconButton } from '../common/IconButton';

export type ActivityPanel = 'files' | 'search';

export function ActivityBar({
  activity,
  onChange,
}: {
  readonly activity: ActivityPanel;
  readonly onChange: (activity: ActivityPanel) => void;
}): React.JSX.Element {
  return (
    <aside aria-label="活动栏" className="activity-bar">
      <IconButton
        className="activity-item"
        icon="files"
        label="文件面板"
        aria-pressed={activity === 'files'}
        onClick={() => onChange('files')}
      />
      <IconButton
        className="activity-item"
        icon="search"
        label="搜索面板"
        aria-pressed={activity === 'search'}
        onClick={() => onChange('search')}
      />
    </aside>
  );
}
