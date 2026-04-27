import type { ReactNode } from 'react';

interface HeaderButtonProps {
  isActive: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
  ariaLabel?: string;
  ariaHaspopup?: 'menu';
  ariaExpanded?: boolean;
}

export function HeaderButton({
  isActive,
  onClick,
  children,
  className = '',
  title,
  ariaLabel,
  ariaHaspopup,
  ariaExpanded,
}: HeaderButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative z-50 shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md whitespace-nowrap text-xs font-medium transition-colors ${
        isActive
          ? 'bg-element-bg dark:bg-element-active text-text-primary dark:text-white'
          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-element-bg hover:text-slate-900 dark:hover:text-white'
      } ${className}`}
      title={title}
      aria-label={ariaLabel}
      aria-haspopup={ariaHaspopup}
      aria-expanded={ariaExpanded}
    >
      {children}
    </button>
  );
}
