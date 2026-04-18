import React from 'react';
import { Maximize2, Minimize2, Minus, X } from 'lucide-react';
import type { DraggableWindowReturn, ResizeDirection } from '@/shared/hooks';
import { useOverlayHoverBlock } from '@/shared/hooks';

type DraggableWindowState = Pick<
  DraggableWindowReturn,
  | 'isMaximized'
  | 'isMinimized'
  | 'isDragging'
  | 'isResizing'
  | 'containerRef'
  | 'handleDragStart'
  | 'handleResizeStart'
  | 'toggleMaximize'
  | 'toggleMinimize'
  | 'windowStyle'
>;

interface WindowControlIcons {
  minimize?: React.ReactNode;
  maximize?: React.ReactNode;
  restore?: React.ReactNode;
  close?: React.ReactNode;
}

export interface DraggableWindowProps {
  window: DraggableWindowState;
  onClose: () => void;
  title: React.ReactNode;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
  headerLeftClassName?: string;
  headerRightClassName?: string;
  controlsClassName?: string;
  controlButtonClassName?: string;
  closeButtonClassName?: string;
  interactionClassName?: string;
  draggingClassName?: string;
  headerDraggableClassName?: string;
  headerDraggingClassName?: string;
  showMinimizeButton?: boolean;
  showMaximizeButton?: boolean;
  showCloseButton?: boolean;
  minimizeTitle?: string;
  maximizeTitle?: string;
  restoreTitle?: string;
  closeTitle?: string;
  onHeaderDoubleClick?: () => void;
  showResizeHandles?: boolean;
  leftResizeHandleClassName?: string;
  rightResizeHandleClassName?: string;
  bottomResizeHandleClassName?: string;
  cornerResizeHandleClassName?: string;
  leftResizeDirection?: ResizeDirection;
  rightResizeDirection?: ResizeDirection;
  bottomResizeDirection?: ResizeDirection;
  cornerResizeDirection?: ResizeDirection;
  cornerResizeHandle?: React.ReactNode;
  controlIcons?: WindowControlIcons;
}

const DEFAULT_CONTROL_BUTTON_CLASS = 'p-1.5 hover:bg-element-hover rounded-md transition-colors';
const DEFAULT_CLOSE_BUTTON_CLASS =
  'p-1.5 text-text-tertiary hover:bg-red-500 hover:text-white rounded-md transition-colors';
const DEFAULT_LEFT_RESIZE_CLASS =
  'absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-system-blue/20 active:bg-system-blue/30 transition-colors z-20';
const DEFAULT_RIGHT_RESIZE_CLASS =
  'absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-system-blue/20 active:bg-system-blue/30 transition-colors z-20';
const DEFAULT_BOTTOM_RESIZE_CLASS =
  'absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-system-blue/20 active:bg-system-blue/30 transition-colors z-20';
const DEFAULT_CORNER_RESIZE_CLASS =
  'absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize hover:bg-system-blue/30 active:bg-system-blue/40 transition-colors z-30';

const joinClassNames = (...classes: Array<string | undefined | false>) =>
  classes.filter(Boolean).join(' ');

export const DraggableWindow: React.FC<DraggableWindowProps> = ({
  window,
  onClose,
  title,
  headerActions,
  children,
  className = '',
  headerClassName = '',
  headerLeftClassName = 'flex items-center gap-3',
  headerRightClassName = 'flex items-center gap-1',
  controlsClassName = 'flex items-center gap-1',
  controlButtonClassName = DEFAULT_CONTROL_BUTTON_CLASS,
  closeButtonClassName = DEFAULT_CLOSE_BUTTON_CLASS,
  interactionClassName,
  draggingClassName,
  headerDraggableClassName = '',
  headerDraggingClassName = '',
  showMinimizeButton = true,
  showMaximizeButton = true,
  showCloseButton = true,
  minimizeTitle,
  maximizeTitle,
  restoreTitle,
  closeTitle,
  onHeaderDoubleClick,
  showResizeHandles = true,
  leftResizeHandleClassName = DEFAULT_LEFT_RESIZE_CLASS,
  rightResizeHandleClassName = DEFAULT_RIGHT_RESIZE_CLASS,
  bottomResizeHandleClassName = DEFAULT_BOTTOM_RESIZE_CLASS,
  cornerResizeHandleClassName = DEFAULT_CORNER_RESIZE_CLASS,
  leftResizeDirection = 'left',
  rightResizeDirection = 'right',
  bottomResizeDirection = 'bottom',
  cornerResizeDirection = 'corner',
  cornerResizeHandle,
  controlIcons,
}) => {
  const { activateHoverBlock, deactivateHoverBlock } = useOverlayHoverBlock();
  const {
    isMaximized,
    isMinimized,
    isDragging,
    isResizing,
    containerRef,
    handleDragStart,
    handleResizeStart,
    toggleMaximize,
    toggleMinimize,
    windowStyle,
  } = window;

  const rootClassName = joinClassNames(
    className,
    (isDragging || isResizing) && interactionClassName,
    isDragging && draggingClassName,
  );

  const computedHeaderClassName = joinClassNames(
    'select-none',
    headerClassName,
    !isMaximized && headerDraggableClassName,
    isDragging && headerDraggingClassName,
  );

  const shouldRenderResizeHandles = showResizeHandles && !isMaximized && !isMinimized;
  const minimizeIcon = controlIcons?.minimize ?? <Minus className="w-4 h-4 text-text-tertiary" />;
  const maximizeIcon = controlIcons?.maximize ?? (
    <Maximize2 className="w-4 h-4 text-text-tertiary" />
  );
  const restoreIcon = controlIcons?.restore ?? <Minimize2 className="w-4 h-4 text-text-tertiary" />;
  const closeIcon = controlIcons?.close ?? <X className="w-4 h-4" />;

  return (
    <div
      ref={containerRef}
      style={windowStyle}
      className={rootClassName}
      onMouseEnter={activateHoverBlock}
      onMouseLeave={deactivateHoverBlock}
    >
      {shouldRenderResizeHandles && (
        <>
          <div
            className={leftResizeHandleClassName}
            onMouseDown={(e) => handleResizeStart(e, leftResizeDirection)}
          />
          <div
            className={rightResizeHandleClassName}
            onMouseDown={(e) => handleResizeStart(e, rightResizeDirection)}
          />
          <div
            className={bottomResizeHandleClassName}
            onMouseDown={(e) => handleResizeStart(e, bottomResizeDirection)}
          />
          <div
            className={cornerResizeHandleClassName}
            onMouseDown={(e) => handleResizeStart(e, cornerResizeDirection)}
          >
            {cornerResizeHandle}
          </div>
        </>
      )}

      <div
        className={computedHeaderClassName}
        onMouseDown={handleDragStart}
        onDoubleClick={onHeaderDoubleClick}
      >
        <div className={headerLeftClassName}>{title}</div>
        <div className={headerRightClassName}>
          {headerActions}
          <div className={controlsClassName}>
            {showMinimizeButton && (
              <button
                data-window-control
                onClick={toggleMinimize}
                className={controlButtonClassName}
                aria-label={minimizeTitle}
              >
                {minimizeIcon}
              </button>
            )}

            {showMaximizeButton && (
              <button
                data-window-control
                onClick={toggleMaximize}
                className={controlButtonClassName}
                aria-label={isMaximized ? restoreTitle : maximizeTitle}
              >
                {isMaximized ? restoreIcon : maximizeIcon}
              </button>
            )}

            {showCloseButton && (
              <button
                data-window-control
                onClick={onClose}
                className={closeButtonClassName}
                aria-label={closeTitle}
              >
                {closeIcon}
              </button>
            )}
          </div>
        </div>
      </div>

      {children}
    </div>
  );
};
