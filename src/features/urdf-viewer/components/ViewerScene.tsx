import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { MeasureTool } from './MeasureTool';
import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import { setRegressionRuntimeRobot } from '@/shared/debug/regressionState';
import { RobotModel } from './RobotModel';
import type {
  MeasureTargetResolver,
  RobotModelProps,
  ViewerRuntimeStageBridge,
} from '../types';
import { isContinuousHoverEnabledForToolMode } from '../utils/usdInteractionPolicy';
import { getViewerRobotSourceFormat } from '@/shared/components/3d/renderers/sourceFormat';
import type { ViewerSceneBaseProps } from '../utils/viewerSceneProps';
import { resolveRegressionRuntimeRobot } from '../utils/regressionRuntimeRobot';

export interface ViewerSceneProps extends ViewerSceneBaseProps {
  t: RobotModelProps['t'];
}

export const ViewerScene = ({
  controller,
  active = true,
  sourceFile,
  sourceFormat,
  allowUrdfXmlFallback = false,
  availableFiles,
  urdfContent,
  assets,
  onDocumentLoadEvent,
  onSceneReadyForDisplay,
  retainedRobot,
  onRuntimeRobotLoaded,
  sourceFilePath,
  groundPlaneOffset,
  mode,
  selection,
  hoveredSelection,
  hoverSelectionEnabled = true,
  onHover,
  onMeshSelect,
  onUpdate,
  robotLinks,
  robotJoints,
  robotData,
  focusTarget,
  onCollisionTransformPreview,
  onCollisionTransform,
  isMeshPreview = false,
  ikDragActive = false,
  runtimeInstanceKey = 0,
  assemblyState,
  assemblySelection,
  onAssemblyTransform,
  onComponentTransform,
  onBridgeTransform,
  sourceSceneAssemblyComponentId,
  sourceSceneAssemblyComponentTransform,
  showSourceSceneAssemblyComponentControls = false,
  onSourceSceneAssemblyComponentTransform,
  toolMode,
  t,
}: ViewerSceneProps) => {
  const snapshotRenderActive = useSnapshotRenderActive();
  const effectiveHoverSelectionEnabled =
    hoverSelectionEnabled && isContinuousHoverEnabledForToolMode(toolMode);
  const measureTargetResolverRef = useRef<MeasureTargetResolver | null>(null);
  const readyNotificationFrameARef = useRef<number | null>(null);
  const readyNotificationFrameBRef = useRef<number | null>(null);
  const regressionRuntimeEnabled =
    import.meta.env.DEV ||
    (typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('regressionDebug') === '1');

  const runtimeBridge = useMemo<ViewerRuntimeStageBridge>(
    () => ({
      onRobotResolved: controller.handleJointPanelRobotLoaded,
      onSelectionChange: controller.handleSelectWrapper,
      onActiveJointChange: controller.handleActiveJointChange,
      onJointAnglesChange: controller.handleRuntimeJointAnglesChange,
    }),
    [
      controller.handleActiveJointChange,
      controller.handleJointPanelRobotLoaded,
      controller.handleRuntimeJointAnglesChange,
      controller.handleSelectWrapper,
    ],
  );

  const cancelScheduledSceneReadyNotification = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (readyNotificationFrameARef.current !== null) {
      window.cancelAnimationFrame(readyNotificationFrameARef.current);
      readyNotificationFrameARef.current = null;
    }

    if (readyNotificationFrameBRef.current !== null) {
      window.cancelAnimationFrame(readyNotificationFrameBRef.current);
      readyNotificationFrameBRef.current = null;
    }
  }, []);

  const scheduleSceneReadyForDisplay = useCallback(() => {
    if (!onSceneReadyForDisplay) {
      return;
    }

    if (typeof window === 'undefined') {
      onSceneReadyForDisplay();
      return;
    }

    cancelScheduledSceneReadyNotification();
    readyNotificationFrameARef.current = window.requestAnimationFrame(() => {
      readyNotificationFrameARef.current = null;
      readyNotificationFrameBRef.current = window.requestAnimationFrame(() => {
        readyNotificationFrameBRef.current = null;
        onSceneReadyForDisplay();
      });
    });
  }, [cancelScheduledSceneReadyNotification, onSceneReadyForDisplay]);

  useEffect(
    () => () => {
      cancelScheduledSceneReadyNotification();
    },
    [cancelScheduledSceneReadyNotification],
  );

  useEffect(() => {
    if (!regressionRuntimeEnabled) {
      return;
    }

    setRegressionRuntimeRobot(null);
    return () => {
      setRegressionRuntimeRobot(null);
    };
  }, [regressionRuntimeEnabled, sourceFile]);

  useEffect(() => {
    if (!regressionRuntimeEnabled || !sourceFile) {
      return;
    }

    const runtimeRobot = resolveRegressionRuntimeRobot({
      robot: controller.robot,
      jointPanelRobot: controller.jointPanelRobot,
      includePrimaryRobot: false,
    });
    if (!runtimeRobot) {
      return;
    }

    setRegressionRuntimeRobot(runtimeRobot);
    return () => {
      setRegressionRuntimeRobot(null);
    };
  }, [controller.jointPanelRobot, controller.robot, regressionRuntimeEnabled, sourceFile]);

  const handleRobotLoaded = useCallback(
    (robot: Parameters<NonNullable<RobotModelProps['onRobotLoaded']>>[0]) => {
      controller.handleRobotLoaded(robot);
      if (regressionRuntimeEnabled && sourceFile) {
        setRegressionRuntimeRobot(
          resolveRegressionRuntimeRobot({
            robot,
            jointPanelRobot: null,
          }),
        );
      }
      onRuntimeRobotLoaded?.(robot);
      scheduleSceneReadyForDisplay();
    },
    [
      controller.handleRobotLoaded,
      onRuntimeRobotLoaded,
      regressionRuntimeEnabled,
      scheduleSceneReadyForDisplay,
      sourceFile,
    ],
  );

  return (
    <>
      {!snapshotRenderActive && (
        <MeasureTool
          active={controller.toolMode === 'measure'}
          robot={controller.robot}
          robotLinks={robotLinks}
          measureState={controller.measureState}
          setMeasureState={controller.setMeasureState}
          measureAnchorMode={controller.measureAnchorMode}
          showDecomposition={controller.showMeasureDecomposition}
          deleteTooltip={t.deleteMeasurement}
          measureTargetResolverRef={measureTargetResolverRef}
        />
      )}

      <Suspense fallback={null}>
        <RobotModel
          active={active}
          urdfContent={urdfContent}
          assets={assets}
          sourceFile={sourceFile}
          availableFiles={availableFiles}
          sourceFormat={sourceFormat ?? getViewerRobotSourceFormat(sourceFile?.format)}
          allowUrdfXmlFallback={allowUrdfXmlFallback}
          reloadToken={runtimeInstanceKey}
          initialRobot={retainedRobot}
          sourceFilePath={sourceFilePath}
          onRobotLoaded={handleRobotLoaded}
          onDocumentLoadEvent={onDocumentLoadEvent}
          runtimeBridge={runtimeBridge}
          showCollision={controller.showCollision}
          showVisual={controller.showVisual}
          showIkHandles={controller.showIkHandles}
          showIkHandlesAlwaysOnTop={controller.showIkHandlesAlwaysOnTop}
          showCollisionAlwaysOnTop={controller.showCollisionAlwaysOnTop}
          onSelect={controller.handleSelectWrapper}
          onHover={onHover}
          onMeshSelect={onMeshSelect}
          onUpdate={onUpdate}
          paintColor={controller.paintColor}
          paintSelectionScope={controller.paintSelectionScope}
          paintOperation={controller.paintOperation}
          onPaintStatusChange={controller.setPaintStatus}
          onJointChange={controller.handleJointAngleChange}
          onJointChangeCommit={controller.handleJointChangeCommit}
          initialJointAngles={controller.getInitialJointAnglesForNextLoad()}
          registerSceneRefresh={controller.registerSceneRefresh}
          setIsDragging={controller.setIsDragging}
          ikRobotState={controller.closedLoopRobotState}
          onIkPreviewKinematicOverrides={controller.previewIkJointKinematics}
          onClearIkPreviewKinematicOverrides={controller.clearIkJointKinematicsPreview}
          setActiveJoint={controller.handleActiveJointChange}
          justSelectedRef={controller.justSelectedRef}
          t={t}
          mode={mode}
          selection={selection}
          hoveredSelection={hoveredSelection}
          hoverSelectionEnabled={effectiveHoverSelectionEnabled}
          groundPlaneOffset={groundPlaneOffset}
          showInertia={controller.showInertia}
          showInertiaOverlay={controller.showInertiaOverlay}
          showCenterOfMass={controller.showCenterOfMass}
          showCoMOverlay={controller.showCoMOverlay}
          centerOfMassSize={controller.centerOfMassSize}
          showOrigins={controller.showOrigins}
          showOriginsOverlay={controller.showOriginsOverlay}
          originSize={controller.originSize}
          showMjcfSites={controller.showMjcfSites}
          showJointAxes={controller.showJointAxes}
          showJointAxesOverlay={controller.showJointAxesOverlay}
          jointAxisSize={controller.jointAxisSize}
          interactionLayerPriority={controller.interactionLayerPriority}
          modelOpacity={controller.modelOpacity}
          robotLinks={robotLinks}
          robotJoints={robotJoints}
          robotData={robotData}
          focusTarget={focusTarget}
          transformMode={controller.transformMode}
          toolMode={toolMode}
          ikDragActive={ikDragActive}
          onCollisionTransformPreview={onCollisionTransformPreview}
          onCollisionTransformEnd={onCollisionTransform}
          isOrbitDragging={controller.isOrbitDragging}
          onTransformPending={controller.handleTransformPending}
          isSelectionLockedRef={controller.transformPendingRef}
          isMeshPreview={isMeshPreview}
          assemblyState={assemblyState}
          assemblySelection={assemblySelection}
          onAssemblyTransform={onAssemblyTransform}
          onComponentTransform={onComponentTransform}
          onBridgeTransform={onBridgeTransform}
          sourceSceneAssemblyComponentId={sourceSceneAssemblyComponentId}
          sourceSceneAssemblyComponentTransform={sourceSceneAssemblyComponentTransform}
          showSourceSceneAssemblyComponentControls={showSourceSceneAssemblyComponentControls}
          onSourceSceneAssemblyComponentTransform={onSourceSceneAssemblyComponentTransform}
        />
      </Suspense>
    </>
  );
};
