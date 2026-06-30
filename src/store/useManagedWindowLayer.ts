import { useCallback } from 'react';
import { useUIStore, type ManagedWindowId } from './uiStore';

export function useManagedWindowLayer(windowId: ManagedWindowId) {
  const zIndex = useUIStore((state) => state.getManagedWindowZIndex(windowId));
  const bringWindowToFront = useUIStore((state) => state.bringWindowToFront);
  const onActivate = useCallback(() => {
    bringWindowToFront(windowId);
  }, [bringWindowToFront, windowId]);

  return { zIndex, onActivate };
}
