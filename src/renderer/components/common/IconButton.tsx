import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly icon: IconName;
  readonly label: string;
  readonly size?: 'compact' | 'regular';
}

export function IconButton({
  icon,
  label,
  size = 'regular',
  className,
  type = 'button',
  ...props
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      {...props}
      aria-label={label}
      className={['icon-button', `icon-button--${size}`, className].filter(Boolean).join(' ')}
      title={props.title ?? label}
      type={type}
    >
      <Icon name={icon} size={size === 'compact' ? 15 : 18} />
    </button>
  );
}
