import { useCallback, useEffect, useRef } from 'react';
import { useSelectionStore } from '@/store/selectionStore';

export function useOverlayHoverBlock() {
  const beginHoverBlock = useSelectionStore((state) => state.beginHoverBlock);
  const endHoverBlock = useSelectionStore((state) => state.endHoverBlock);
  const clearHover = useSelectionStore((state) => state.clearHover);
  const blockActiveRef = useRef(false);

  const activateHoverBlock = useCallback(() => {
    if (blockActiveRef.current) {
      return;
    }

    blockActiveRef.current = true;
    beginHoverBlock();
    clearHover();
  }, [beginHoverBlock, clearHover]);

  const deactivateHoverBlock = useCallback(() => {
    if (!blockActiveRef.current) {
      return;
    }

    blockActiveRef.current = false;
    endHoverBlock();
  }, [endHoverBlock]);

  useEffect(() => {
    return () => {
      if (!blockActiveRef.current) {
        return;
      }

      blockActiveRef.current = false;
      endHoverBlock();
    };
  }, [endHoverBlock]);

  return {
    activateHoverBlock,
    deactivateHoverBlock,
  };
}
