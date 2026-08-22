import type { SVGProps } from 'react';

export type IconName =
  | 'align-center'
  | 'align-justify'
  | 'align-left'
  | 'align-right'
  | 'bold'
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'close'
  | 'collapse'
  | 'docx'
  | 'error'
  | 'file'
  | 'files'
  | 'folder'
  | 'folder-open'
  | 'info'
  | 'italic'
  | 'list-bulleted'
  | 'list-numbered'
  | 'menu'
  | 'more'
  | 'move'
  | 'new-file'
  | 'new-folder'
  | 'palette'
  | 'redo'
  | 'refresh'
  | 'rename'
  | 'reveal'
  | 'save'
  | 'search'
  | 'spinner'
  | 'text'
  | 'trash'
  | 'underline'
  | 'undo'
  | 'warning';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'name'> {
  readonly name: IconName;
  readonly size?: number;
}

function IconPath({ name }: { readonly name: IconName }): React.JSX.Element {
  switch (name) {
    case 'files':
      return (
        <>
          <path d="M5 3.5h5l2 2H19v15H5z" />
          <path d="M5 8h14" />
        </>
      );
    case 'search':
      return (
        <>
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="m15 15 5 5" />
        </>
      );
    case 'folder':
      return <path d="M3 6.5h7l2 2h9v11H3z" />;
    case 'folder-open':
      return (
        <>
          <path d="M3 7h7l2 2h9l-2 10H5z" />
          <path d="M3 7v12" />
        </>
      );
    case 'file':
      return (
        <>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v5h5" />
        </>
      );
    case 'text':
      return (
        <>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v5h5M9 12h6M9 16h6" />
        </>
      );
    case 'docx':
      return (
        <>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v5h5M9 12h6M9 16h4" />
        </>
      );
    case 'chevron-right':
      return <path d="m9 5 7 7-7 7" />;
    case 'chevron-down':
      return <path d="m5 9 7 7 7-7" />;
    case 'close':
      return <path d="m6 6 12 12M18 6 6 18" />;
    case 'collapse':
      return (
        <>
          <path d="M8 5 3 10l5 5M3 10h9" />
          <path d="M15 4h6v16h-6" />
        </>
      );
    case 'refresh':
      return (
        <>
          <path d="M20 7v5h-5" />
          <path d="M19 12a7.5 7.5 0 1 0-1.8 5" />
        </>
      );
    case 'more':
      return (
        <>
          <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
        </>
      );
    case 'menu':
      return <path d="M4 7h16M4 12h16M4 17h16" />;
    case 'new-file':
      return (
        <>
          <path d="M5 3h8l4 4v14H5zM13 3v5h5" />
          <path d="M9 14h5M11.5 11.5v5" />
        </>
      );
    case 'new-folder':
      return (
        <>
          <path d="M3 6h7l2 2h9v11H3z" />
          <path d="M12 11v5M9.5 13.5h5" />
        </>
      );
    case 'rename':
      return (
        <>
          <path d="m4 18 1-4L16 3l4 4L9 18z" />
          <path d="M13 6l4 4M4 21h16" />
        </>
      );
    case 'move':
      return (
        <>
          <path d="M12 3v18M3 12h18" />
          <path d="m8 7 4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4" />
        </>
      );
    case 'trash':
      return (
        <>
          <path d="M4 7h16M9 3h6l1 4M7 7l1 14h8l1-14M10 11v6M14 11v6" />
        </>
      );
    case 'reveal':
      return (
        <>
          <path d="M3 7h7l2 2h9v10H3z" />
          <path d="M14 14h6M17 11l3 3-3 3" />
        </>
      );
    case 'save':
      return (
        <>
          <path d="M4 3h14l2 2v16H4zM8 3v6h8V3M8 15h8v6H8z" />
        </>
      );
    case 'undo':
      return (
        <>
          <path d="m9 8-5 4 5 4" />
          <path d="M5 12h8a6 6 0 0 1 6 6" />
        </>
      );
    case 'redo':
      return (
        <>
          <path d="m15 8 5 4-5 4" />
          <path d="M19 12h-8a6 6 0 0 0-6 6" />
        </>
      );
    case 'bold':
      return (
        <>
          <path d="M8 4h5a4 4 0 0 1 0 8H8z" />
          <path d="M8 12h6a4 4 0 0 1 0 8H8z" />
        </>
      );
    case 'italic':
      return (
        <>
          <path d="M10 4h8M6 20h8M14 4 10 20" />
        </>
      );
    case 'underline':
      return (
        <>
          <path d="M7 4v7a5 5 0 0 0 10 0V4M5 21h14" />
        </>
      );
    case 'list-bulleted':
      return (
        <>
          <path d="M9 6h11M9 12h11M9 18h11" />
          <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
          <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
        </>
      );
    case 'list-numbered':
      return (
        <>
          <path d="M10 6h10M10 12h10M10 18h10M4 4v4M3 5l1-1M3 11h2l-2 3h2M3 17h2l-2 3h2" />
        </>
      );
    case 'align-left':
      return <path d="M4 6h16M4 10h11M4 14h16M4 18h9" />;
    case 'align-center':
      return <path d="M4 6h16M7 10h10M4 14h16M8 18h8" />;
    case 'align-right':
      return <path d="M4 6h16M9 10h11M4 14h16M11 18h9" />;
    case 'align-justify':
      return <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />;
    case 'palette':
      return (
        <>
          <path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h8V12a9 9 0 0 0-9-9Z" />
          <circle cx="7.5" cy="9" r="1" fill="currentColor" stroke="none" />
          <circle cx="10" cy="6" r="1" fill="currentColor" stroke="none" />
          <circle cx="14" cy="6" r="1" fill="currentColor" stroke="none" />
        </>
      );
    case 'check':
      return <path d="m4 12 5 5L20 6" />;
    case 'info':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7h.01" />
        </>
      );
    case 'warning':
      return (
        <>
          <path d="M12 3 2.5 20h19z" />
          <path d="M12 9v5M12 17h.01" />
        </>
      );
    case 'error':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 8.5 7 7M15.5 8.5l-7 7" />
        </>
      );
    case 'spinner':
      return <path d="M20 12a8 8 0 1 1-2.3-5.7" />;
  }
}

export function Icon({ name, size = 18, className, ...props }: IconProps): React.JSX.Element {
  return (
    <svg
      {...props}
      aria-hidden={props['aria-label'] === undefined ? true : undefined}
      className={['icon', className].filter(Boolean).join(' ')}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      <IconPath name={name} />
    </svg>
  );
}
