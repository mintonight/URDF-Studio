import { useMemo } from 'react';
import { useCanRedo, useCanUndo, useRobotStore } from '@/store';
import { flushPendingHistory } from '../utils/pendingHistory';

export function useActiveHistory() {
  const robotUndo = useRobotStore((state) => state.undo);
  const robotRedo = useRobotStore((state) => state.redo);
  const robotCanUndo = useCanUndo();
  const robotCanRedo = useCanRedo();

  return useMemo(
    () => ({
      undo: () => {
        flushPendingHistory();
        robotUndo();
      },
      redo: () => {
        flushPendingHistory();
        robotRedo();
      },
      canUndo: robotCanUndo,
      canRedo: robotCanRedo,
    }),
    [robotCanRedo, robotCanUndo, robotRedo, robotUndo],
  );
}
