/**
 * App Effects Hook
 * Handles global side effects like keyboard shortcuts and selection cleanup
 */
import { useEffect } from 'react';
import { useRobotStore, useSelectionStore, useUIStore } from '@/store';
import { useActiveHistory } from './useActiveHistory';

/**
 * Hook for keyboard shortcuts (undo/redo)
 */
export function useKeyboardShortcuts() {
  const { undo, redo, canUndo, canRedo } = useActiveHistory();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo: Ctrl+Z
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        if (canUndo) {
          undo();
          e.preventDefault();
        }
      }
      // Redo: Ctrl+Shift+Z
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        if (canRedo) {
          redo();
          e.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, canUndo, canRedo]);
}

/**
 * Hook to clean up selection when selected item is deleted
 */
export function useSelectionCleanup() {
  const links = useRobotStore((state) => state.links);
  const joints = useRobotStore((state) => state.joints);
  const inspectionContext = useRobotStore((state) => state.inspectionContext);
  const selection = useSelectionStore((state) => state.selection);
  const clearSelection = useSelectionStore((state) => state.clearSelection);

  useEffect(() => {
    if (selection.id && selection.type) {
      const exists =
        selection.type === 'link'
          ? links[selection.id]
          : selection.type === 'joint'
            ? joints[selection.id]
            : inspectionContext?.mjcf?.tendons.some((tendon) => tendon.name === selection.id);
      if (!exists) {
        clearSelection();
      }
    }
  }, [inspectionContext, links, joints, selection, clearSelection]);
}

/**
 * Hook to listen for system theme changes
 */
export function useSystemThemeListener() {
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);

  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      // Re-apply theme to update class based on new system preference
      setTheme('system');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, setTheme]);
}

/**
 * Combined hook for all app effects
 */
export function useAppEffects() {
  useKeyboardShortcuts();
  useSelectionCleanup();
  useSystemThemeListener();
}
