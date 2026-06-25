import React from 'react';
import { MeasurePanel } from './MeasurePanel';
import { PaintPanel } from './PaintPanel';
import { ViewerOptionsPanel } from './ViewerOptionsPanel';
import { ViewerToolbar } from './ViewerToolbar';
import { translations, type Language } from '@/shared/i18n';
import type { ViewerController } from '../hooks/useViewerController';
import { useResponsivePanelLayout } from '../hooks/useResponsivePanelLayout';

const LazyJointsPanel = React.lazy(async () => ({
  default: (await import('@/shared/components/Panel/JointsPanel')).JointsPanel,
}));

interface ViewerPanelsProps {
  lang: Language;
  controller: ViewerController;
  isMjcfSource?: boolean;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
  showOptionsPanel?: boolean;
  setShowOptionsPanel?: (show: boolean) => void;
  showJointPanel?: boolean;
  setShowJointPanel?: (show: boolean) => void;
  preferEdgeDockedOptionsPanel?: boolean;
  paintModeSupported?: boolean;
  showToolbar?: boolean;
}

export const ViewerPanels = ({
  lang,
  controller,
  isMjcfSource = false,
  onUpdate,
  showOptionsPanel = true,
  setShowOptionsPanel,
  showJointPanel = true,
  setShowJointPanel,
  preferEdgeDockedOptionsPanel = false,
  paintModeSupported = true,
  showToolbar = true,
}: ViewerPanelsProps) => {
  const t = translations[lang];
  const { optionsDefaultPosition, jointsDefaultPosition, jointsPanelMaxHeight } =
    useResponsivePanelLayout({
      containerRef: controller.containerRef,
      optionsPanelRef: controller.optionsPanelRef,
      jointPanelRef: controller.jointPanelRef,
      showOptionsPanel,
      showJointPanel,
      preferEdgeDockedOptionsPanel,
    });

  return (
    <>
      {showToolbar ? (
        <ViewerToolbar
          activeMode={controller.toolMode}
          setMode={controller.handleToolModeChange}
          lang={lang}
        />
      ) : null}

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

      {showJointPanel ? (
        <React.Suspense fallback={null}>
          <LazyJointsPanel
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
            setIsDragging={controller.setIsDragging}
            onSelect={controller.handleSelectWrapper}
            onHover={controller.handleHoverWrapper}
            onUpdate={onUpdate}
          />
        </React.Suspense>
      ) : null}

      <MeasurePanel
        toolMode={controller.toolMode}
        measurePanelRef={controller.measurePanelRef}
        measurePanelPos={controller.measurePanelPos}
        onMouseDown={(event) => controller.handleMouseDown('measure', event)}
        onClose={controller.handleCloseMeasureTool}
        measureState={controller.measureState}
        setMeasureState={controller.setMeasureState}
        measureMode={controller.measureState.mode}
        setMeasureMode={controller.setMeasureMode}
        measureAnchorMode={controller.measureAnchorMode}
        setMeasureAnchorMode={controller.setMeasureAnchorMode}
        showMeasureDecomposition={controller.showMeasureDecomposition}
        setShowMeasureDecomposition={controller.setShowMeasureDecomposition}
        measurePoseRepresentation={controller.measurePoseRepresentation}
        setMeasurePoseRepresentation={controller.setMeasurePoseRepresentation}
        lang={lang}
      />

      <PaintPanel
        lang={lang}
        toolMode={controller.toolMode}
        paintColor={controller.paintColor}
        onPaintColorChange={controller.setPaintColor}
        paintSelectionScope={controller.paintSelectionScope}
        onPaintSelectionScopeChange={controller.setPaintSelectionScope}
        paintOperation={controller.paintOperation}
        onPaintOperationChange={controller.setPaintOperation}
        paintStatus={controller.paintStatus}
        supported={paintModeSupported}
        onClose={controller.handleClosePaintTool}
        paintPanelRef={controller.paintPanelRef}
        paintPanelPos={controller.paintPanelPos}
        onMouseDown={(event) => controller.handleMouseDown('paint', event)}
      />
    </>
  );
};
