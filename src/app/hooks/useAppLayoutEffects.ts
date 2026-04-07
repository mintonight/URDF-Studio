import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { getDroppedFiles } from '@/features/file-io';
import type { InteractionSelection, RobotState } from '@/types';
import { preloadSourceCodeEditor } from '@/app/utils/sourceCodeEditorLoader';
import { useActiveHistory } from './useActiveHistory';

interface LayoutSelection {
  type: InteractionSelection['type'];
  id: string | null;
}

interface UseAppLayoutEffectsParams {
  robot: Pick<RobotState, 'links' | 'joints' | 'inspectionContext'>;
  selection: LayoutSelection;
  clearSelection: () => void;
  onFileDrop: (files: File[]) => void;
  onDropError: () => void;
}

function containsFiles(dataTransfer: Pick<DataTransfer, 'types'> | null | undefined): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes('Files');
}

export function useAppLayoutEffects({
  robot,
  selection,
  clearSelection,
  onFileDrop,
  onDropError,
}: UseAppLayoutEffectsParams) {
  const { undo, redo, canUndo, canRedo } = useActiveHistory();
  const dragLeaveFrameRef = useRef<number | null>(null);
  const [isFileDragActive, setIsFileDragActive] = useState(false);

  const cancelPendingDragLeaveCheck = useCallback(() => {
    if (dragLeaveFrameRef.current !== null) {
      window.cancelAnimationFrame(dragLeaveFrameRef.current);
      dragLeaveFrameRef.current = null;
    }
  }, []);

  const clearFileDragState = useCallback(() => {
    cancelPendingDragLeaveCheck();
    setIsFileDragActive(false);
  }, [cancelPendingDragLeaveCheck]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'z' && !event.shiftKey) {
        if (canUndo) {
          undo();
          event.preventDefault();
        }
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'z' && event.shiftKey) {
        if (canRedo) {
          redo();
          event.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canRedo, canUndo, redo, undo]);

  useEffect(() => {
    if (!selection.id || !selection.type) return;

    const exists =
      selection.type === 'link'
        ? robot.links[selection.id]
        : selection.type === 'joint'
          ? robot.joints[selection.id]
          : robot.inspectionContext?.mjcf?.tendons.some((tendon) => tendon.name === selection.id);

    if (!exists) {
      clearSelection();
    }
  }, [clearSelection, robot.joints, robot.links, selection]);

  useEffect(() => {
    const handleWindowReset = () => {
      clearFileDragState();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearFileDragState();
      }
    };

    window.addEventListener('drop', handleWindowReset);
    window.addEventListener('dragend', handleWindowReset);
    window.addEventListener('blur', handleWindowReset);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('drop', handleWindowReset);
      window.removeEventListener('dragend', handleWindowReset);
      window.removeEventListener('blur', handleWindowReset);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cancelPendingDragLeaveCheck();
    };
  }, [cancelPendingDragLeaveCheck, clearFileDragState]);

  const handleDragEnter = useCallback(
    (event: DragEvent) => {
      if (!containsFiles(event.dataTransfer)) return;

      event.preventDefault();
      event.stopPropagation();

      cancelPendingDragLeaveCheck();
      setIsFileDragActive(true);
    },
    [cancelPendingDragLeaveCheck],
  );

  const handleDragOver = useCallback(
    (event: DragEvent) => {
      if (!containsFiles(event.dataTransfer)) return;

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      cancelPendingDragLeaveCheck();

      if (!isFileDragActive) {
        setIsFileDragActive(true);
      }
    },
    [cancelPendingDragLeaveCheck, isFileDragActive],
  );

  const handleDragLeave = useCallback(
    (event: DragEvent) => {
      if (!containsFiles(event.dataTransfer)) return;

      event.preventDefault();
      event.stopPropagation();

      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
        return;
      }

      const currentTarget = event.currentTarget;
      const { clientX, clientY } = event;

      if (
        clientX <= 0 ||
        clientY <= 0 ||
        clientX >= window.innerWidth ||
        clientY >= window.innerHeight
      ) {
        clearFileDragState();
        return;
      }

      cancelPendingDragLeaveCheck();
      dragLeaveFrameRef.current = window.requestAnimationFrame(() => {
        dragLeaveFrameRef.current = null;
        const pointTarget = document.elementFromPoint(clientX, clientY);
        if (!(pointTarget instanceof Node) || !currentTarget.contains(pointTarget)) {
          setIsFileDragActive(false);
        }
      });
    },
    [cancelPendingDragLeaveCheck, clearFileDragState],
  );

  const handleDrop = useCallback(
    async (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      cancelPendingDragLeaveCheck();
      setIsFileDragActive(false);

      if (!event.dataTransfer.items) return;

      try {
        const files = await getDroppedFiles(event.dataTransfer.items);
        if (files.length > 0) {
          onFileDrop(files);
        }
      } catch (error) {
        console.error('Failed to process dropped files:', error);
        onDropError();
      }
    },
    [cancelPendingDragLeaveCheck, onDropError, onFileDrop],
  );

  const prefetchSourceCodeEditor = useCallback(() => {
    void preloadSourceCodeEditor();
  }, []);

  return {
    isFileDragActive,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    prefetchSourceCodeEditor,
  };
}
