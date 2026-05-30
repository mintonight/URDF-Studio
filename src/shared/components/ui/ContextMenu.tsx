import React, { cloneElement, isValidElement } from 'react';
import { createPortal } from 'react-dom';

interface ContextMenuFrameProps {
  position: { x: number; y: number } | null;
  children: React.ReactNode;
  widthClassName?: string;
  className?: string;
}

interface ContextMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  tone?: 'default' | 'danger';
  iconClassName?: string;
}

export const ContextMenuFrame: React.FC<ContextMenuFrameProps> = ({
  position,
  children,
  widthClassName = 'w-[170px]',
  className = '',
}) => {
  if (!position) return null;

  const menu = (
    <div
      className={`fixed z-[120] ${widthClassName} rounded-md border border-border-black bg-panel-bg p-1 shadow-xl ${className}`.trim()}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      role="menu"
      tabIndex={-1}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );

  if (typeof document === 'undefined' || !document.body) {
    return menu;
  }

  return createPortal(menu, document.body);
};

export const ContextMenuItem: React.FC<ContextMenuItemProps> = ({
  icon,
  tone = 'default',
  iconClassName,
  className = '',
  children,
  type = 'button',
  ...props
}) => {
  type IconElementProps = { className?: string };
  const itemClasses =
    tone === 'danger'
      ? 'text-danger hover:bg-danger-soft dark:hover:bg-danger-soft hover:text-danger-hover dark:hover:text-danger'
      : 'text-text-secondary hover:bg-system-blue/10 dark:hover:bg-system-blue/20 hover:text-system-blue';
  const mergedIconClassName =
    iconClassName
    ?? (tone === 'danger'
      ? 'transition-colors group/menu-item:text-danger-hover dark:group/menu-item:text-danger'
      : 'text-system-blue transition-colors group/menu-item:text-system-blue-hover');

  const renderedIcon = isValidElement<IconElementProps>(icon)
    ? cloneElement(icon, {
        className: `${mergedIconClassName} ${icon.props.className ?? ''}`.trim(),
      })
    : icon;

  return (
    <button
      type={type}
      role="menuitem"
      className={`group/menu-item flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs transition-colors ${itemClasses} ${className}`.trim()}
      {...props}
    >
      {renderedIcon}
      <span>{children}</span>
    </button>
  );
};
