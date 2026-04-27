import { useEffect, useMemo, useState, type RefObject } from 'react';

export type FloatingPanelPosition = {
  top?: string;
  right?: string;
  left?: string;
  bottom?: string;
  transform?: string;
};

interface UseResponsivePanelLayoutOptions {
  containerRef: RefObject<HTMLDivElement>;
  optionsPanelRef: RefObject<HTMLDivElement>;
  jointPanelRef: RefObject<HTMLDivElement>;
  showOptionsPanel: boolean;
  showJointPanel: boolean;
  preferEdgeDockedOptionsPanel?: boolean;
  preferEdgeDockedJointPanel?: boolean;
}

export interface ResponsivePanelLayoutMetrics {
  containerWidth: number;
  containerHeight: number;
  optionsWidth: number;
  optionsHeight: number;
  jointsWidth: number;
}

export interface ResponsivePanelLayoutResult {
  optionsDefaultPosition: FloatingPanelPosition;
  jointsDefaultPosition: FloatingPanelPosition;
  jointsPanelMaxHeight: number | undefined;
}

const EDGE_GAP = 16;
const PANEL_GAP = 12;
const TOP_PANEL_OFFSET = 16;
const FALLBACK_OPTIONS_WIDTH = 208;
const FALLBACK_OPTIONS_HEIGHT = 208;
const FALLBACK_JOINTS_WIDTH = 208;
const MIN_JOINT_PANEL_HEIGHT = 180;
const SOFT_MAX_JOINT_PANEL_HEIGHT = 420;
const MIN_CLEAR_VIEWER_WIDTH_WITH_OPTIONS_PANEL = 420;
const MIN_CLEAR_VIEWER_WIDTH_WITH_JOINT_PANEL = 320;
const OPTIONS_PANEL_EDGE_REVEAL_WIDTH = 56;
const JOINT_PANEL_EDGE_REVEAL_WIDTH = 56;

const readPanelMetrics = (
  containerRef: RefObject<HTMLDivElement>,
  optionsPanelRef: RefObject<HTMLDivElement>,
  jointPanelRef: RefObject<HTMLDivElement>,
): ResponsivePanelLayoutMetrics => ({
  containerWidth: containerRef.current?.clientWidth ?? 0,
  containerHeight: containerRef.current?.clientHeight ?? 0,
  optionsWidth: optionsPanelRef.current?.offsetWidth ?? FALLBACK_OPTIONS_WIDTH,
  optionsHeight: optionsPanelRef.current?.offsetHeight ?? FALLBACK_OPTIONS_HEIGHT,
  jointsWidth: jointPanelRef.current?.offsetWidth ?? FALLBACK_JOINTS_WIDTH,
});

const resolveJointPanelMaxHeight = (availableHeight: number) =>
  Math.max(MIN_JOINT_PANEL_HEIGHT, Math.min(SOFT_MAX_JOINT_PANEL_HEIGHT, availableHeight));

export function resolveResponsivePanelLayout({
  metrics,
  showOptionsPanel,
  showJointPanel,
  preferEdgeDockedOptionsPanel = false,
  preferEdgeDockedJointPanel = false,
}: {
  metrics: ResponsivePanelLayoutMetrics;
  showOptionsPanel: boolean;
  showJointPanel: boolean;
  preferEdgeDockedOptionsPanel?: boolean;
  preferEdgeDockedJointPanel?: boolean;
}): ResponsivePanelLayoutResult {
  const shouldStackPanels =
    showOptionsPanel &&
    showJointPanel &&
    metrics.containerWidth > 0 &&
    metrics.containerWidth < metrics.optionsWidth + metrics.jointsWidth + EDGE_GAP * 2 + PANEL_GAP;
  const shouldEdgeDockOptionsPanel =
    preferEdgeDockedOptionsPanel &&
    showOptionsPanel &&
    metrics.containerWidth > 0 &&
    metrics.containerWidth <
      metrics.optionsWidth + EDGE_GAP * 2 + MIN_CLEAR_VIEWER_WIDTH_WITH_OPTIONS_PANEL;
  const shouldEdgeDockJointPanel =
    preferEdgeDockedJointPanel &&
    showJointPanel &&
    metrics.containerWidth > 0 &&
    metrics.containerWidth <
      metrics.jointsWidth + EDGE_GAP * 2 + MIN_CLEAR_VIEWER_WIDTH_WITH_JOINT_PANEL;

  const optionsDefaultPosition: FloatingPanelPosition = shouldStackPanels
    ? { top: `${TOP_PANEL_OFFSET}px`, left: `${EDGE_GAP}px`, right: 'auto', transform: 'none' }
    : shouldEdgeDockOptionsPanel
      ? {
          top: `${TOP_PANEL_OFFSET}px`,
          right: `${Math.min(EDGE_GAP, OPTIONS_PANEL_EDGE_REVEAL_WIDTH - metrics.optionsWidth)}px`,
          left: 'auto',
          transform: 'none',
        }
      : metrics.containerWidth > 0 && metrics.containerWidth < 520
        ? { top: `${TOP_PANEL_OFFSET}px`, right: `${EDGE_GAP}px`, left: 'auto', transform: 'none' }
        : { top: '16px', right: '16px' };

  if (shouldStackPanels) {
    const stackedTop = TOP_PANEL_OFFSET + metrics.optionsHeight + PANEL_GAP;
    const stackedHeight = resolveJointPanelMaxHeight(
      metrics.containerHeight - stackedTop - EDGE_GAP,
    );

    return {
      optionsDefaultPosition,
      jointsDefaultPosition: {
        top: `${stackedTop}px`,
        left: `${EDGE_GAP}px`,
        right: 'auto',
        transform: 'none',
      },
      jointsPanelMaxHeight: stackedHeight,
    };
  }

  if (shouldEdgeDockJointPanel) {
    const dockedTop = TOP_PANEL_OFFSET;
    const dockedHeight = resolveJointPanelMaxHeight(metrics.containerHeight - dockedTop - EDGE_GAP);

    return {
      optionsDefaultPosition,
      jointsDefaultPosition: {
        top: `${dockedTop}px`,
        left: `${Math.min(EDGE_GAP, JOINT_PANEL_EDGE_REVEAL_WIDTH - metrics.jointsWidth)}px`,
        right: 'auto',
        transform: 'none',
      },
      jointsPanelMaxHeight: dockedHeight,
    };
  }

  return {
    optionsDefaultPosition,
    jointsDefaultPosition: { top: '50%', left: '16px', transform: 'translateY(-50%)' },
    jointsPanelMaxHeight: resolveJointPanelMaxHeight(metrics.containerHeight - EDGE_GAP * 2),
  };
}

export function useResponsivePanelLayout({
  containerRef,
  optionsPanelRef,
  jointPanelRef,
  showOptionsPanel,
  showJointPanel,
  preferEdgeDockedOptionsPanel = false,
  preferEdgeDockedJointPanel = false,
}: UseResponsivePanelLayoutOptions) {
  const [metrics, setMetrics] = useState<ResponsivePanelLayoutMetrics>(() =>
    readPanelMetrics(containerRef, optionsPanelRef, jointPanelRef),
  );

  useEffect(() => {
    const updateMetrics = () => {
      setMetrics(readPanelMetrics(containerRef, optionsPanelRef, jointPanelRef));
    };

    updateMetrics();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateMetrics);
      return () => window.removeEventListener('resize', updateMetrics);
    }

    const observer = new ResizeObserver(updateMetrics);
    const observedNodes = [
      containerRef.current,
      optionsPanelRef.current,
      jointPanelRef.current,
    ].filter((node): node is HTMLDivElement => Boolean(node));

    observedNodes.forEach((node) => observer.observe(node));
    window.addEventListener('resize', updateMetrics);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateMetrics);
    };
  }, [containerRef, jointPanelRef, optionsPanelRef, showJointPanel, showOptionsPanel]);

  return useMemo(
    () =>
      resolveResponsivePanelLayout({
        metrics,
        showOptionsPanel,
        showJointPanel,
        preferEdgeDockedOptionsPanel,
        preferEdgeDockedJointPanel,
      }),
    [
      metrics,
      preferEdgeDockedOptionsPanel,
      preferEdgeDockedJointPanel,
      showJointPanel,
      showOptionsPanel,
    ],
  );
}
