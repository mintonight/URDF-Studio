import React from 'react';
import { createPortal } from 'react-dom';
import { Move, MousePointer2, View as ViewIcon, Scan, Ruler, Palette, X } from 'lucide-react';
import { translations } from '@/shared/i18n';
import { IconButton } from '@/shared/components/ui';
import { useOverlayHoverBlock } from '@/shared/hooks';
import type { ViewerToolbarProps, ToolMode } from '../types';

const HEADER_DOCK_SLOT_ID = 'viewer-toolbar-dock-slot';
const FLOATING_MARGIN = 8;
const INITIAL_TOP_OFFSET = 4;
const DOCK_SNAP_PADDING = 28;

function clamp(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function clampFloatingPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  containerRect?: DOMRect | null,
) {
  if (!containerRect) {
    return { x, y };
  }

  return {
    x: clamp(x, FLOATING_MARGIN, containerRect.width - width - FLOATING_MARGIN),
    y: clamp(y, FLOATING_MARGIN, containerRect.height - height - FLOATING_MARGIN),
  };
}

function shouldDockToHeader(toolbarRect: DOMRect) {
  if (typeof document === 'undefined') {
    return false;
  }

  const slot = document.getElementById(HEADER_DOCK_SLOT_ID);
  if (!slot) {
    return false;
  }

  const slotRect = slot.getBoundingClientRect();
  if (slotRect.width <= 0 || slotRect.height <= 0) {
    return false;
  }

  const expandedRect = {
    left: slotRect.left - DOCK_SNAP_PADDING,
    right: slotRect.right + DOCK_SNAP_PADDING,
    top: slotRect.top - DOCK_SNAP_PADDING,
    bottom: slotRect.bottom + DOCK_SNAP_PADDING,
  };

  const centerX = toolbarRect.left + toolbarRect.width / 2;
  const centerY = toolbarRect.top + toolbarRect.height / 2;

  return (
    centerX >= expandedRect.left &&
    centerX <= expandedRect.right &&
    centerY >= expandedRect.top &&
    centerY <= expandedRect.bottom
  );
}

export const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  activeMode,
  setMode,
  onClose,
  lang = 'en',
  containerRef,
}) => {
  const { activateHoverBlock, deactivateHoverBlock } = useOverlayHoverBlock();
  const nodeRef = React.useRef<HTMLDivElement>(null);
  const [isDocked, setIsDocked] = React.useState(false);
  const [floatingPosition, setFloatingPosition] = React.useState<{ x: number; y: number } | null>(
    null,
  );
  const dragOffsetRef = React.useRef<{ x: number; y: number } | null>(null);
  const dragMoveHandlerRef = React.useRef<((event: MouseEvent) => void) | null>(null);
  const dragEndHandlerRef = React.useRef<(() => void) | null>(null);
  const previousUserSelectRef = React.useRef('');
  const previousCursorRef = React.useRef('');
  const t = translations[lang];

  const tools = [
    { id: 'view', icon: ViewIcon, label: t.viewMode },
    { id: 'select', icon: MousePointer2, label: t.selectMode },
    { id: 'universal', icon: Move, label: t.transformMode },
    { id: 'paint', icon: Palette, label: t.paintMode },
    { id: 'face', icon: Scan, label: t.faceMode },
    { id: 'measure', icon: Ruler, label: t.measureMode },
  ];

  const clearDragListeners = React.useCallback(() => {
    const moveHandler = dragMoveHandlerRef.current;
    const endHandler = dragEndHandlerRef.current;

    if (moveHandler) {
      document.removeEventListener('mousemove', moveHandler);
      dragMoveHandlerRef.current = null;
    }

    if (endHandler) {
      document.removeEventListener('mouseup', endHandler);
      window.removeEventListener('blur', endHandler);
      dragEndHandlerRef.current = null;
    }

    document.body.style.userSelect = previousUserSelectRef.current;
    document.body.style.cursor = previousCursorRef.current;
  }, []);

  React.useEffect(
    () => () => {
      clearDragListeners();
    },
    [clearDragListeners],
  );

  React.useEffect(() => {
    if (isDocked || floatingPosition !== null || typeof window === 'undefined') {
      return undefined;
    }

    let cancelled = false;
    const rafId = window.requestAnimationFrame(() => {
      if (cancelled) {
        return;
      }

      const container = containerRef?.current;
      const node = nodeRef.current;
      if (!container || !node) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const toolbarRect = node.getBoundingClientRect();
      const nextPosition = clampFloatingPosition(
        (containerRect.width - toolbarRect.width) / 2,
        INITIAL_TOP_OFFSET,
        toolbarRect.width,
        toolbarRect.height,
        containerRect,
      );

      setFloatingPosition(nextPosition);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [containerRef, floatingPosition, isDocked]);

  React.useEffect(() => {
    if (isDocked || floatingPosition === null || typeof window === 'undefined') {
      return undefined;
    }

    const syncPosition = () => {
      const container = containerRef?.current;
      const node = nodeRef.current;
      if (!container || !node) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const nextPosition = clampFloatingPosition(
        floatingPosition.x,
        floatingPosition.y,
        node.offsetWidth,
        node.offsetHeight,
        containerRect,
      );

      if (nextPosition.x !== floatingPosition.x || nextPosition.y !== floatingPosition.y) {
        setFloatingPosition(nextPosition);
      }
    };

    let observer: ResizeObserver | null = null;
    const container = containerRef?.current;
    if (typeof ResizeObserver !== 'undefined' && container) {
      observer = new ResizeObserver(syncPosition);
      observer.observe(container);
    }

    window.addEventListener('resize', syncPosition);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', syncPosition);
    };
  }, [containerRef, floatingPosition, isDocked]);

  const handleDragStart = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const node = nodeRef.current;
      const container = containerRef?.current;
      if (!node) {
        return;
      }

      clearDragListeners();

      const rect = node.getBoundingClientRect();
      const containerRect = container?.getBoundingClientRect() ?? null;
      previousUserSelectRef.current = document.body.style.userSelect;
      previousCursorRef.current = document.body.style.cursor;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'move';
      const dragOffset = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      dragOffsetRef.current = dragOffset;

      if (isDocked) {
        setIsDocked(false);
        setFloatingPosition(
          clampFloatingPosition(
            (containerRect ? event.clientX - containerRect.left : rect.left) - dragOffset.x,
            (containerRect ? event.clientY - containerRect.top : rect.top) - dragOffset.y,
            rect.width,
            rect.height,
            containerRect,
          ),
        );
      } else {
        setFloatingPosition(
          clampFloatingPosition(
            containerRect ? rect.left - containerRect.left : rect.left,
            containerRect ? rect.top - containerRect.top : rect.top,
            rect.width,
            rect.height,
            containerRect,
          ),
        );
      }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const currentNode = nodeRef.current;
        const offset = dragOffsetRef.current;
        const currentContainer = containerRef?.current;
        if (!currentNode || !offset) {
          return;
        }

        const currentContainerRect = currentContainer?.getBoundingClientRect() ?? null;
        const nextPosition = clampFloatingPosition(
          (currentContainerRect
            ? moveEvent.clientX - currentContainerRect.left
            : moveEvent.clientX) - offset.x,
          (currentContainerRect
            ? moveEvent.clientY - currentContainerRect.top
            : moveEvent.clientY) - offset.y,
          currentNode.offsetWidth || rect.width,
          currentNode.offsetHeight || rect.height,
          currentContainerRect,
        );

        setFloatingPosition(nextPosition);
      };

      const handleMouseUp = () => {
        const currentNode = nodeRef.current;
        if (currentNode) {
          const currentRect = currentNode.getBoundingClientRect();
          if (shouldDockToHeader(currentRect)) {
            setIsDocked(true);
          } else {
            const currentContainer = containerRef?.current;
            const currentContainerRect = currentContainer?.getBoundingClientRect() ?? null;
            setFloatingPosition(
              clampFloatingPosition(
                currentContainerRect
                  ? currentRect.left - currentContainerRect.left
                  : currentRect.left,
                currentContainerRect ? currentRect.top - currentContainerRect.top : currentRect.top,
                currentRect.width,
                currentRect.height,
                currentContainerRect,
              ),
            );
          }
        }

        dragOffsetRef.current = null;
        clearDragListeners();
      };

      dragMoveHandlerRef.current = handleMouseMove;
      dragEndHandlerRef.current = handleMouseUp;
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('blur', handleMouseUp);
    },
    [clearDragListeners, isDocked],
  );

  const toolbarContent = (
    <>
      <div
        onMouseDown={handleDragStart}
        className="drag-handle flex h-full cursor-move select-none items-center px-1 text-text-tertiary/50 transition-colors hover:text-text-tertiary"
      >
        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
        </svg>
      </div>
      {tools.map((tool) => {
        const isActive = activeMode === tool.id;
        const Icon = tool.icon;
        return (
          <IconButton
            key={tool.id}
            onClick={() => setMode(tool.id as ToolMode)}
            variant="toolbar"
            isActive={isActive}
            aria-label={tool.label}
            title={tool.label}
          >
            <Icon className="h-4 w-4" />
          </IconButton>
        );
      })}
      {onClose && (
        <>
          <div className="mx-1 h-4 w-px bg-border-black" />
          <IconButton
            onClick={onClose}
            variant="close"
            aria-label={t.closeToolbar}
            title={t.closeToolbar}
          >
            <X className="h-4 w-4" />
          </IconButton>
        </>
      )}
    </>
  );

  const toolbarClassName =
    'urdf-toolbar flex items-center gap-1 rounded-lg border border-border-black bg-panel-bg p-1 shadow-2xl dark:shadow-black';
  const floatingPositioningClassName = containerRef?.current ? 'absolute' : 'fixed';

  const dockSlot =
    typeof document !== 'undefined' ? document.getElementById(HEADER_DOCK_SLOT_ID) : null;

  if (isDocked && dockSlot) {
    return createPortal(
      <div
        ref={nodeRef}
        className={toolbarClassName}
        onMouseEnter={activateHoverBlock}
        onMouseLeave={deactivateHoverBlock}
      >
        {toolbarContent}
      </div>,
      dockSlot,
    );
  }

  return (
    <div
      ref={nodeRef}
      className={`${toolbarClassName} ${floatingPositioningClassName} z-40 cursor-auto`}
      style={{
        left: floatingPosition?.x ?? 0,
        top: floatingPosition?.y ?? 0,
        visibility: floatingPosition ? 'visible' : 'hidden',
      }}
      onMouseEnter={activateHoverBlock}
      onMouseLeave={deactivateHoverBlock}
    >
      {toolbarContent}
    </div>
  );
};
