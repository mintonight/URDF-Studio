import React, {
  cloneElement,
  isValidElement,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

interface ContextMenuSize {
  width: number;
  height: number;
}

interface ContextMenuViewport {
  width: number;
  height: number;
}

const CONTEXT_MENU_VIEWPORT_GUTTER = 8;

export function resolveContextMenuPosition(
  position: { x: number; y: number },
  menu: ContextMenuSize,
  viewport: ContextMenuViewport,
  gutter = CONTEXT_MENU_VIEWPORT_GUTTER,
) {
  const maxX = Math.max(gutter, viewport.width - menu.width - gutter);
  const maxY = Math.max(gutter, viewport.height - menu.height - gutter);
  return {
    x: Math.min(Math.max(gutter, position.x), maxX),
    y: Math.min(Math.max(gutter, position.y), maxY),
  };
}

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
  const menuRef = useRef<HTMLDivElement>(null);
  const [resolvedPosition, setResolvedPosition] = useState(position);

  useLayoutEffect(() => {
    if (!position || !menuRef.current) return;
    const bounds = menuRef.current.getBoundingClientRect();
    const nextPosition = resolveContextMenuPosition(
      position,
      { width: bounds.width, height: bounds.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setResolvedPosition((current) => (
      current?.x === nextPosition.x && current.y === nextPosition.y
        ? current
        : nextPosition
    ));
  });

  if (!position) return null;

  const menu = (
    <div
      ref={menuRef}
      className={`fixed z-[120] max-h-[calc(100vh-1rem)] overflow-y-auto ${widthClassName} rounded-md border border-border-black bg-panel-bg p-1 shadow-xl ${className}`.trim()}
      style={{
        left: `${resolvedPosition?.x ?? position.x}px`,
        top: `${resolvedPosition?.y ?? position.y}px`,
      }}
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
