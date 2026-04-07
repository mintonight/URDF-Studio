import { UnifiedVisualizerOptionsPanel } from '@/shared/components/Panel';
import type { Language } from '@/shared/i18n';
import { useUIStore } from '@/store';
import type { VisualizerController } from '../hooks/useVisualizerController';

interface VisualizerPanelsProps {
  lang: Language;
  showOptionsPanel?: boolean;
  setShowOptionsPanel?: (show: boolean) => void;
  controller: VisualizerController;
}

export const VisualizerPanels = ({
  lang,
  showOptionsPanel = true,
  setShowOptionsPanel,
  controller,
}: VisualizerPanelsProps) => {
  const { panel, state, handleAutoFitGround } = controller;
  const groundPlaneOffset = useUIStore((storeState) => storeState.groundPlaneOffset);
  const setGroundPlaneOffset = useUIStore((storeState) => storeState.setGroundPlaneOffset);

  return (
    <>
      {showOptionsPanel && (
        <UnifiedVisualizerOptionsPanel
          key="visualizer-unified"
          ref={panel.optionsPanelRef}
          lang={lang}
          showGeometry={state.showGeometry}
          setShowGeometry={state.setShowGeometry}
          showOrigin={state.showOrigin}
          setShowOrigin={state.setShowOrigin}
          frameSize={state.frameSize}
          setFrameSize={state.setFrameSize}
          showLabels={state.showLabels}
          setShowLabels={state.setShowLabels}
          labelScale={state.labelScale}
          setLabelScale={state.setLabelScale}
          showJointAxes={state.showJointAxes}
          setShowJointAxes={state.setShowJointAxes}
          jointAxisSize={state.jointAxisSize}
          setJointAxisSize={state.setJointAxisSize}
          showCollision={state.showCollision}
          setShowCollision={state.setShowCollision}
          showIkHandles={state.showIkHandles}
          setShowIkHandles={state.setShowIkHandles}
          showInertia={state.showInertia}
          setShowInertia={state.setShowInertia}
          showCenterOfMass={state.showCenterOfMass}
          setShowCenterOfMass={state.setShowCenterOfMass}
          modelOpacity={state.modelOpacity}
          setModelOpacity={state.setModelOpacity}
          isCollapsed={panel.isOptionsCollapsed}
          toggleCollapsed={panel.toggleOptionsCollapsed}
          onMouseDown={panel.handleMouseDown}
          onResetPosition={() => panel.setOptionsPanelPos(null)}
          onClose={setShowOptionsPanel ? () => setShowOptionsPanel(false) : undefined}
          optionsPanelPos={panel.optionsPanelPos}
          onAutoFitGround={handleAutoFitGround}
          groundPlaneOffset={groundPlaneOffset}
          setGroundPlaneOffset={setGroundPlaneOffset}
        />
      )}
    </>
  );
};
