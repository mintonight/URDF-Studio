import type { ComponentType, MouseEvent, ReactNode } from 'react';

type HeaderMenuIcon = ComponentType<{ className?: string }>;

interface HeaderMenuItemProps {
  icon?: HeaderMenuIcon;
  children: ReactNode;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  shortcut?: string;
  onMouseEnter?: () => void;
  onFocus?: () => void;
  onTouchStart?: () => void;
  iconClassName?: string;
  className?: string;
}

export function HeaderMenuItem({
  icon: Icon,
  children,
  onClick,
  disabled = false,
  shortcut,
  onMouseEnter,
  onFocus,
  onTouchStart,
  iconClassName = 'w-4 h-4 text-slate-400',
  className = '',
}: HeaderMenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
      onTouchStart={onTouchStart}
      className={`w-full text-left px-3 py-2 text-xs whitespace-nowrap hover:bg-element-bg dark:hover:bg-element-bg transition-colors text-text-primary dark:text-text-secondary flex items-center ${
        shortcut ? 'justify-between gap-6' : 'gap-2.5'
      } disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
    >
      <span className="flex items-center gap-2.5">
        {Icon ? <Icon className={iconClassName} /> : null}
        {children}
      </span>
      {shortcut ? (
        <span className="text-[10px] text-slate-400 dark:text-slate-500">{shortcut}</span>
      ) : null}
    </button>
  );
}

export function HeaderMenuSeparator() {
  return <div className="h-px bg-element-bg dark:bg-border-black my-1" />;
}
