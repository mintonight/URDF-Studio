import { useCallback, useState } from 'react';
import type { InteractionSelection } from '@/types';
import type { ViewOptions } from '@/store/uiStore';
import { isIkDragToolEnabled } from '@/shared/utils/ikDragFeatureGate';
import { clearIkDragHelperSelection } from '../utils/ikDragSession';

interface UseIkDragPanelActionsParams {
  selection: InteractionSelection;
  setSelection: (selection: InteractionSelection) => void;
  setViewOption: <K extends keyof ViewOptions>(key: K, value: ViewOptions[K]) => void;
}

export function useIkDragPanelActions({
  selection,
  setSelection,
  setViewOption,
}: UseIkDragPanelActionsParams) {
  const [ikDragActive, setIkDragActive] = useState(false);
  const [isIkToolPanelOpen, setIsIkToolPanelOpen] = useState(false);

  const setIkDragActiveState = useCallback(
    (active: boolean) => {
      setIkDragActive(active);

      if (active) {
        setViewOption('showIkHandles', true);
        return;
      }

      setViewOption('showIkHandles', false);
      setIsIkToolPanelOpen(false);
      const clearedSelection = clearIkDragHelperSelection(selection);
      if (clearedSelection) {
        setSelection(clearedSelection);
      }
    },
    [selection, setSelection, setViewOption],
  );

  const handleOpenIkTool = useCallback(() => {
    if (!isIkDragToolEnabled()) {
      setIkDragActiveState(false);
      return;
    }

    setIkDragActiveState(true);
    setIsIkToolPanelOpen(true);
  }, [setIkDragActiveState]);

  const handleIkDragActiveChange = useCallback(
    (active: boolean) => {
      setIkDragActiveState(active);
    },
    [setIkDragActiveState],
  );

  return {
    ikDragActive,
    isIkToolPanelOpen,
    handleIkDragActiveChange,
    handleOpenIkTool,
  };
}
