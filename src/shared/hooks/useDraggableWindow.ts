import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, MouseEvent, RefObject, SetStateAction } from 'react';

export type ResizeDirection = 'right' | 'bottom' | 'corner' | 'left' | 'e' | 's' | 'se' | 'w';

interface Position {
  x: number;
  y: number;
}

interface WindowSize {
  width: number;
  height: number;
}

interface DragBoundsOptions {
  allowNegativeX?: boolean;
  minVisibleWidth?: number;
  topMargin?: number;
  bottomMargin?: number;
}

export interface DraggableWindowOptions {
  isOpen?: boolean;
  defaultPosition?: Position;
  defaultSize: WindowSize;
  minSize?: WindowSize;
  enableMinimize?: boolean;
  enableMaximize?: boolean;
  centerOnMount?: boolean;
  clampResizeToViewport?: boolean;
  dragBounds?: DragBoundsOptions;
}

export interface DraggableWindowReturn {
  isMaximized: boolean;
  isMinimized: boolean;
  position: Position;
  size: WindowSize;
  setSize: Dispatch<SetStateAction<WindowSize>>;
  isDragging: boolean;
  isResizing: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  handleDragStart: (e: MouseEvent) => void;
  handleResizeStart: (e: MouseEvent, direction: ResizeDirection) => void;
  toggleMaximize: () => void;
  toggleMinimize: () => void;
  windowStyle: CSSProperties;
}

const VIEWPORT_WINDOW_MARGIN = 24;
const MIN_VIEWPORT_WINDOW_SIZE: WindowSize = {
  width: 360,
  height: 320,
};
const DRAG_TRANSLATE_X_VAR = '--draggable-window-translate-x';
const DRAG_TRANSLATE_Y_VAR = '--draggable-window-translate-y';

const clamp = (value: number, min: number, max: number) => {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
};

const normalizeResizeDirection = (
  direction: ResizeDirection,
): 'right' | 'bottom' | 'corner' | 'left' => {
  if (direction === 'e') return 'right';
  if (direction === 's') return 'bottom';
  if (direction === 'w' || direction === 'left') return 'left';
  return 'corner';
};

const getViewportWindowSizeLimit = (shouldClampToViewport: boolean): WindowSize => {
  if (typeof window === 'undefined' || !shouldClampToViewport) {
    return {
      width: Number.POSITIVE_INFINITY,
      height: Number.POSITIVE_INFINITY,
    };
  }

  return {
    width: Math.max(MIN_VIEWPORT_WINDOW_SIZE.width, window.innerWidth - VIEWPORT_WINDOW_MARGIN),
    height: Math.max(MIN_VIEWPORT_WINDOW_SIZE.height, window.innerHeight - VIEWPORT_WINDOW_MARGIN),
  };
};

const constrainWindowSizeToViewport = (
  nextSize: WindowSize,
  shouldClampToViewport: boolean,
): WindowSize => {
  const viewportLimit = getViewportWindowSizeLimit(shouldClampToViewport);
  return {
    width: Math.min(nextSize.width, viewportLimit.width),
    height: Math.min(nextSize.height, viewportLimit.height),
  };
};

const getEffectiveMinWindowSize = (
  nextMinSize: WindowSize,
  shouldClampToViewport: boolean,
): WindowSize => {
  const viewportLimit = getViewportWindowSizeLimit(shouldClampToViewport);
  return {
    width: Math.min(nextMinSize.width, viewportLimit.width),
    height: Math.min(nextMinSize.height, viewportLimit.height),
  };
};

export const useDraggableWindow = ({
  isOpen,
  defaultPosition = { x: 100, y: 100 },
  defaultSize,
  minSize = { width: 600, height: 400 },
  enableMinimize = true,
  enableMaximize = true,
  centerOnMount = true,
  clampResizeToViewport = true,
  dragBounds,
}: DraggableWindowOptions): DraggableWindowReturn => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [position, setPosition] = useState<Position>(defaultPosition);
  const [size, setSize] = useState<WindowSize>(() =>
    constrainWindowSizeToViewport(defaultSize, clampResizeToViewport),
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<
    'right' | 'bottom' | 'corner' | 'left' | null
  >(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<Position>({ x: 0, y: 0 });
  const resizeStartRef = useRef({
    x: 0,
    y: 0,
    width: defaultSize.width,
    height: defaultSize.height,
    posX: 0,
  });
  const positionRef = useRef(position);
  const sizeRef = useRef(size);
  const dragTransformRef = useRef<Position>({ x: 0, y: 0 });
  const dragFrameRef = useRef<number | null>(null);
  const centeredOnceRef = useRef(false);
  const preMaximizeRef = useRef<{ position: Position; size: WindowSize } | null>(null);
  const bodyUserSelectRef = useRef('');
  const bodyCursorRef = useRef('');

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  const flushDragTransform = useCallback(() => {
    dragFrameRef.current = null;

    if (!containerRef.current) return;

    containerRef.current.style.setProperty(DRAG_TRANSLATE_X_VAR, `${dragTransformRef.current.x}px`);
    containerRef.current.style.setProperty(DRAG_TRANSLATE_Y_VAR, `${dragTransformRef.current.y}px`);
  }, []);

  const scheduleDragTransform = useCallback(() => {
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(flushDragTransform);
  }, [flushDragTransform]);

  const resetDragTransform = useCallback(() => {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }

    if (!containerRef.current) return;

    containerRef.current.style.setProperty(DRAG_TRANSLATE_X_VAR, '0px');
    containerRef.current.style.setProperty(DRAG_TRANSLATE_Y_VAR, '0px');
  }, []);

  const captureBodyInteractionStyles = useCallback(() => {
    bodyUserSelectRef.current = document.body.style.userSelect;
    bodyCursorRef.current = document.body.style.cursor;
  }, []);

  const restoreBodyInteractionStyles = useCallback(() => {
    document.body.style.userSelect = bodyUserSelectRef.current;
    document.body.style.cursor = bodyCursorRef.current;
  }, []);

  const getDragLimits = useCallback(
    (currentSize: WindowSize) => {
      const allowNegativeX = dragBounds?.allowNegativeX ?? false;
      const minVisibleWidth = dragBounds?.minVisibleWidth ?? 100;
      const minX = allowNegativeX ? -currentSize.width + minVisibleWidth : 0;
      const maxX = allowNegativeX
        ? window.innerWidth - minVisibleWidth
        : window.innerWidth - currentSize.width;
      const minY = dragBounds?.topMargin ?? 0;
      const maxY = window.innerHeight - (dragBounds?.bottomMargin ?? 48);
      return { minX, maxX, minY, maxY };
    },
    [
      dragBounds?.allowNegativeX,
      dragBounds?.bottomMargin,
      dragBounds?.minVisibleWidth,
      dragBounds?.topMargin,
    ],
  );

  const centerWindow = useCallback(() => {
    const currentSize = sizeRef.current;
    const centerX = (window.innerWidth - currentSize.width) / 2;
    const centerY = (window.innerHeight - currentSize.height) / 2;
    setPosition({
      x: Math.max(0, centerX),
      y: Math.max(0, centerY),
    });
  }, []);

  useEffect(() => {
    if (!centerOnMount) return;

    if (typeof isOpen === 'boolean') {
      if (isOpen) {
        centerWindow();
      }
      return;
    }

    if (!centeredOnceRef.current) {
      centeredOnceRef.current = true;
      centerWindow();
    }
  }, [centerOnMount, centerWindow, isOpen]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      dragTransformRef.current = {
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      };
      scheduleDragTransform();
    };

    const handleMouseUp = () => {
      const transform = dragTransformRef.current;
      if (transform.x !== 0 || transform.y !== 0) {
        const limits = getDragLimits(sizeRef.current);
        const nextX = clamp(positionRef.current.x + transform.x, limits.minX, limits.maxX);
        const nextY = clamp(positionRef.current.y + transform.y, limits.minY, limits.maxY);
        setPosition({ x: nextX, y: nextY });
      }

      dragTransformRef.current = { x: 0, y: 0 };
      resetDragTransform();
      restoreBodyInteractionStyles();
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      restoreBodyInteractionStyles();
    };
  }, [
    getDragLimits,
    isDragging,
    resetDragTransform,
    restoreBodyInteractionStyles,
    scheduleDragTransform,
  ]);

  useEffect(() => {
    if (!isResizing || !resizeDirection) return;

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      const deltaX = e.clientX - resizeStartRef.current.x;
      const deltaY = e.clientY - resizeStartRef.current.y;
      const effectiveMinSize = getEffectiveMinWindowSize(minSize, clampResizeToViewport);

      if (resizeDirection === 'left') {
        const newWidth = clamp(
          resizeStartRef.current.width - deltaX,
          effectiveMinSize.width,
          resizeStartRef.current.width + resizeStartRef.current.posX,
        );
        const newX = resizeStartRef.current.posX + (resizeStartRef.current.width - newWidth);
        setSize((prev) => (prev.width === newWidth ? prev : { ...prev, width: newWidth }));
        setPosition((prev) => (prev.x === newX ? prev : { ...prev, x: newX }));
        return;
      }

      const maxWidth = clampResizeToViewport
        ? window.innerWidth - positionRef.current.x
        : Number.POSITIVE_INFINITY;
      const maxHeight = clampResizeToViewport
        ? window.innerHeight - positionRef.current.y
        : Number.POSITIVE_INFINITY;

      const shouldResizeWidth = resizeDirection === 'right' || resizeDirection === 'corner';
      const shouldResizeHeight = resizeDirection === 'bottom' || resizeDirection === 'corner';

      setSize((prev) => {
        const nextWidth = shouldResizeWidth
          ? clamp(resizeStartRef.current.width + deltaX, effectiveMinSize.width, maxWidth)
          : prev.width;
        const nextHeight = shouldResizeHeight
          ? clamp(resizeStartRef.current.height + deltaY, effectiveMinSize.height, maxHeight)
          : prev.height;

        if (nextWidth === prev.width && nextHeight === prev.height) {
          return prev;
        }

        return { width: nextWidth, height: nextHeight };
      });
    };

    const handleMouseUp = () => {
      restoreBodyInteractionStyles();
      setIsResizing(false);
      setResizeDirection(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      restoreBodyInteractionStyles();
    };
  }, [
    clampResizeToViewport,
    isResizing,
    minSize.height,
    minSize.width,
    resizeDirection,
    restoreBodyInteractionStyles,
  ]);

  useEffect(() => {
    resetDragTransform();
    return () => {
      resetDragTransform();
      restoreBodyInteractionStyles();
    };
  }, [resetDragTransform, restoreBodyInteractionStyles]);

  useEffect(() => {
    if (typeof window === 'undefined' || !clampResizeToViewport) return;

    const handleViewportResize = () => {
      const constrainedSize = constrainWindowSizeToViewport(sizeRef.current, clampResizeToViewport);
      const effectiveMinSize = getEffectiveMinWindowSize(minSize, clampResizeToViewport);
      const nextSize = {
        width: clamp(constrainedSize.width, effectiveMinSize.width, constrainedSize.width),
        height: clamp(constrainedSize.height, effectiveMinSize.height, constrainedSize.height),
      };

      if (nextSize.width !== sizeRef.current.width || nextSize.height !== sizeRef.current.height) {
        setSize(nextSize);
      }

      const limits = getDragLimits(nextSize);
      const nextPosition = {
        x: clamp(positionRef.current.x, limits.minX, limits.maxX),
        y: clamp(positionRef.current.y, limits.minY, limits.maxY),
      };

      if (nextPosition.x !== positionRef.current.x || nextPosition.y !== positionRef.current.y) {
        setPosition(nextPosition);
      }
    };

    handleViewportResize();
    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, [clampResizeToViewport, getDragLimits, minSize.height, minSize.width]);

  const handleDragStart = useCallback(
    (e: MouseEvent) => {
      if (isMaximized) return;

      const target = e.target as HTMLElement;
      if (target.closest('button, input, textarea, select, [data-window-control]')) {
        return;
      }

      e.preventDefault();
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
      };
      dragTransformRef.current = { x: 0, y: 0 };
      resetDragTransform();
      captureBodyInteractionStyles();
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
      setIsDragging(true);
    },
    [captureBodyInteractionStyles, isMaximized, resetDragTransform],
  );

  const handleResizeStart = useCallback(
    (e: MouseEvent, direction: ResizeDirection) => {
      if (isMaximized || isMinimized) return;

      e.preventDefault();
      e.stopPropagation();
      captureBodyInteractionStyles();
      document.body.style.userSelect = 'none';
      document.body.style.cursor =
        direction === 'left' || direction === 'w'
          ? 'ew-resize'
          : direction === 'bottom' || direction === 's'
            ? 'ns-resize'
            : 'nwse-resize';
      setIsResizing(true);
      setResizeDirection(normalizeResizeDirection(direction));
      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        width: sizeRef.current.width,
        height: sizeRef.current.height,
        posX: positionRef.current.x,
      };
    },
    [captureBodyInteractionStyles, isMaximized, isMinimized],
  );

  const toggleMaximize = useCallback(() => {
    if (!enableMaximize) return;

    setIsMaximized((prev) => {
      if (prev) {
        if (preMaximizeRef.current) {
          const restoredSize = constrainWindowSizeToViewport(
            preMaximizeRef.current.size,
            clampResizeToViewport,
          );
          const limits = getDragLimits(restoredSize);
          setPosition({
            x: clamp(preMaximizeRef.current.position.x, limits.minX, limits.maxX),
            y: clamp(preMaximizeRef.current.position.y, limits.minY, limits.maxY),
          });
          setSize(restoredSize);
        }
        return false;
      }

      preMaximizeRef.current = {
        position: positionRef.current,
        size: sizeRef.current,
      };
      setIsMinimized(false);
      return true;
    });
  }, [clampResizeToViewport, enableMaximize, getDragLimits]);

  const toggleMinimize = useCallback(() => {
    if (!enableMinimize) return;
    setIsMinimized((prev) => !prev);
  }, [enableMinimize]);

  const windowStyle = useMemo<CSSProperties>(() => {
    if (isMaximized) {
      return {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
        transform: 'none',
      };
    }

    if (isMinimized) {
      return {
        position: 'fixed',
        left: position.x,
        top: position.y,
        width: size.width,
        height: 48,
        transform: 'none',
      };
    }

    return {
      position: 'fixed',
      left: position.x,
      top: position.y,
      width: size.width,
      height: size.height,
      transform: `translate3d(var(${DRAG_TRANSLATE_X_VAR}, 0px), var(${DRAG_TRANSLATE_Y_VAR}, 0px), 0)`,
      willChange: isDragging ? 'transform' : undefined,
    };
  }, [isDragging, isMaximized, isMinimized, position.x, position.y, size.height, size.width]);

  return {
    isMaximized,
    isMinimized,
    position,
    size,
    setSize,
    isDragging,
    isResizing,
    containerRef,
    handleDragStart,
    handleResizeStart,
    toggleMaximize,
    toggleMinimize,
    windowStyle,
  };
};
