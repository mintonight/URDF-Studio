import { JointsPanel } from '@/shared/components/Panel/JointsPanel';
import { MeasurePanel } from './MeasurePanel';
import { ViewerOptionsPanel } from './ViewerOptionsPanel';
import { ViewerToolbar } from './ViewerToolbar';
import { translations, type Language } from '@/shared/i18n';
import type { URDFViewerController } from '../hooks/useURDFViewerController';
import { useResponsivePanelLayout } from '../hooks/useResponsivePanelLayout';

interface URDFViewerPanelsProps {
  lang: Language;
  controller: URDFViewerController;
  isMjcfSource?: boolean;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
  showToolbar?: boolean;
  setShowToolbar?: (show: boolean) => void;
  showOptionsPanel?: boolean;
  setShowOptionsPanel?: (show: boolean) => void;
  showJointPanel?: boolean;
  setShowJointPanel?: (show: boolean) => void;
  preferEdgeDockedOptionsPanel?: boolean;
}

export const URDFViewerPanels = ({
  lang,
  controller,
  isMjcfSource = false,
  onUpdate,
  showToolbar = true,
  setShowToolbar,
  showOptionsPanel = true,
  setShowOptionsPanel,
  showJointPanel = true,
  setShowJointPanel,
  preferEdgeDockedOptionsPanel = false,
}: URDFViewerPanelsProps) => {
  const t = translations[lang];
  const { optionsDefaultPosition, jointsDefaultPosition, jointsPanelMaxHeight } =
    useResponsivePanelLayout({
      containerRef: controller.containerRef,
      optionsPanelRef: controller.optionsPanelRef,
      jointPanelRef: controller.jointPanelRef,
      showOptionsPanel,
      showJointPanel,
      showToolbar,
      preferEdgeDockedOptionsPanel,
    });

  return (
    <>
      <ViewerOptionsPanel
        showOptionsPanel={showOptionsPanel}
        optionsPanelRef={controller.optionsPanelRef}
        optionsPanelPos={controller.optionsPanelPos}
        defaultPosition={optionsDefaultPosition}
        onMouseDown={(event) => controller.handleMouseDown('options', event)}
        t={t}
        isOptionsCollapsed={controller.isOptionsCollapsed}
        toggleOptionsCollapsed={controller.toggleOptionsCollapsed}
        setShowOptionsPanel={setShowOptionsPanel}
        showVisual={controller.showVisual}
        setShowVisual={controller.setShowVisual}
        showCollision={controller.showCollision}
        setShowCollision={controller.setShowCollision}
        showIkHandles={controller.showIkHandles}
        setShowIkHandles={controller.setShowIkHandles}
        showIkHandlesAlwaysOnTop={controller.showIkHandlesAlwaysOnTop}
        setShowIkHandlesAlwaysOnTop={controller.setShowIkHandlesAlwaysOnTop}
        showCollisionAlwaysOnTop={controller.showCollisionAlwaysOnTop}
        setShowCollisionAlwaysOnTop={controller.setShowCollisionAlwaysOnTop}
        modelOpacity={controller.modelOpacity}
        setModelOpacity={controller.setModelOpacity}
        showOrigins={controller.showOrigins}
        setShowOrigins={controller.setShowOrigins}
        showOriginsOverlay={controller.showOriginsOverlay}
        setShowOriginsOverlay={controller.setShowOriginsOverlay}
        originSize={controller.originSize}
        setOriginSize={controller.setOriginSize}
        showMjcfSiteToggle={isMjcfSource}
        showMjcfSites={controller.showMjcfSites}
        setShowMjcfSites={controller.setShowMjcfSites}
        showJointAxes={controller.showJointAxes}
        setShowJointAxes={controller.setShowJointAxes}
        showJointAxesOverlay={controller.showJointAxesOverlay}
        setShowJointAxesOverlay={controller.setShowJointAxesOverlay}
        jointAxisSize={controller.jointAxisSize}
        setJointAxisSize={controller.setJointAxisSize}
        showCenterOfMass={controller.showCenterOfMass}
        setShowCenterOfMass={controller.setShowCenterOfMass}
        showCoMOverlay={controller.showCoMOverlay}
        setShowCoMOverlay={controller.setShowCoMOverlay}
        centerOfMassSize={controller.centerOfMassSize}
        setCenterOfMassSize={controller.setCenterOfMassSize}
        showInertia={controller.showInertia}
        setShowInertia={controller.setShowInertia}
        showInertiaOverlay={controller.showInertiaOverlay}
        setShowInertiaOverlay={controller.setShowInertiaOverlay}
        onAutoFitGround={controller.handleAutoFitGround}
        groundPlaneOffset={controller.groundPlaneOffset}
        groundPlaneOffsetReadOnly={controller.groundPlaneOffsetReadOnly}
        setGroundPlaneOffset={controller.setGroundPlaneOffset}
      />

      <JointsPanel
        showJointPanel={showJointPanel}
        robot={controller.jointPanelRobot ?? controller.robot}
        jointPanelRef={controller.jointPanelRef}
        jointPanelPos={controller.jointPanelPos}
        defaultPosition={jointsDefaultPosition}
        maxHeight={jointsPanelMaxHeight}
        onMouseDown={(event) => controller.handleMouseDown('joints', event)}
        t={t}
        handleResetJoints={controller.handleResetJoints}
        angleUnit={controller.angleUnit}
        setAngleUnit={controller.setAngleUnit}
        isJointsCollapsed={controller.isJointsCollapsed}
        toggleJointsCollapsed={controller.toggleJointsCollapsed}
        setShowJointPanel={setShowJointPanel}
        jointPanelStore={controller.jointPanelStore}
        setActiveJoint={controller.setActiveJoint}
        handleJointAngleChange={controller.handleJointAngleChange}
        handleJointChangeCommit={controller.handleJointChangeCommit}
        onSelect={controller.handleSelectWrapper}
        onHover={controller.handleHoverWrapper}
        onUpdate={onUpdate}
      />

      {showToolbar && (
        <ViewerToolbar
          activeMode={controller.toolMode}
          setMode={controller.handleToolModeChange}
          onClose={setShowToolbar ? () => setShowToolbar(false) : undefined}
          lang={lang}
          containerRef={controller.containerRef}
        />
      )}

      <MeasurePanel
        toolMode={controller.toolMode}
        measurePanelRef={controller.measurePanelRef}
        measurePanelPos={controller.measurePanelPos}
        onMouseDown={(event) => controller.handleMouseDown('measure', event)}
        onClose={controller.handleCloseMeasureTool}
        measureState={controller.measureState}
        setMeasureState={controller.setMeasureState}
        measureAnchorMode={controller.measureAnchorMode}
        setMeasureAnchorMode={controller.setMeasureAnchorMode}
        showMeasureDecomposition={controller.showMeasureDecomposition}
        setShowMeasureDecomposition={controller.setShowMeasureDecomposition}
        lang={lang}
      />
    </>
  );
};
