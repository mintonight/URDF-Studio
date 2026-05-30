import { useRef } from 'react';
import { usePanelDrag } from '../usePanelDrag';

export function usePanelLayoutController() {
  const containerRef = useRef<HTMLDivElement>(null);
  const optionsPanelRef = useRef<HTMLDivElement>(null);
  const jointPanelRef = useRef<HTMLDivElement>(null);
  const measurePanelRef = useRef<HTMLDivElement>(null);
  const {
    optionsPanelPos,
    jointPanelPos,
    measurePanelPos,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  } = usePanelDrag(containerRef, optionsPanelRef, jointPanelRef, measurePanelRef);

  return {
    containerRef,
    optionsPanelRef,
    jointPanelRef,
    measurePanelRef,
    optionsPanelPos,
    jointPanelPos,
    measurePanelPos,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
