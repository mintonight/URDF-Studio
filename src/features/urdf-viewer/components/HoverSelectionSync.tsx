import { useEffect } from 'react';
import { useSelectionStore } from '@/store/selectionStore';
import type { URDFViewerProps } from '../types';

interface HoverSelectionSyncProps {
  enabled?: boolean;
  onHoverSelectionChange: (hoveredSelection?: URDFViewerProps['selection']) => void;
}

export function HoverSelectionSync({
  enabled = true,
  onHoverSelectionChange,
}: HoverSelectionSyncProps) {
  const hoveredSelection = useSelectionStore((state) => state.hoveredSelection);

  useEffect(() => {
    onHoverSelectionChange(enabled ? hoveredSelection : undefined);
  }, [
    enabled,
    hoveredSelection?.type,
    hoveredSelection?.id,
    hoveredSelection?.subType,
    hoveredSelection?.objectIndex,
    hoveredSelection?.helperKind,
    hoveredSelection?.highlightObjectId,
    onHoverSelectionChange,
  ]);

  useEffect(() => {
    return () => {
      onHoverSelectionChange(undefined);
    };
  }, [onHoverSelectionChange]);

  return null;
}
