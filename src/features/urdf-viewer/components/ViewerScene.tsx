import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MeasureTool } from './MeasureTool';
import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import { setRegressionRuntimeRobot } from '@/shared/debug/regressionBridge';
import { RobotModel } from './RobotModel';
import type {
  MeasureTargetResolver,
  RobotModelProps,
  ViewerDocumentLoadEvent,
  ViewerRuntimeStageBridge,
  UsdLoadingPhaseLabels,
} from '../types';
import { isContinuousHoverEnabledForToolMode } from '../utils/usdInteractionPolicy';
import { shouldForceViewerRuntimeRemount } from '../utils/loadStrategy';
import {
  shouldBootstrapUsdOffscreenStage,
  shouldUseUsdOffscreenStage,
} from '../utils/usdOffscreenStagePolicy';
import { normalizeUsdBootstrapDocumentLoadEvent } from '../utils/usdBootstrapDocumentLoadEvent';
import { getViewerRobotSourceFormat } from '../utils/sourceFormat';
import type { ViewerSceneBaseProps } from '../utils/viewerSceneProps';

const LazyUsdOffscreenStage = lazy(async () => ({
  default: (await import('./UsdOffscreenStage')).UsdOffscreenStage,
}));

const LazyUsdWasmStage = lazy(async () => ({
  default: (await import('./UsdWasmStage')).UsdWasmStage,
}));

export interface ViewerSceneProps extends ViewerSceneBaseProps {
  t: RobotModelProps['t'];
}

export const ViewerScene = ({
  controller,
  resolvedTheme = 'light',
  active = true,
  sourceFile,
  sourceFormat,
  allowUrdfXmlFallback = true,
  availableFiles,
  urdfContent,
  assets,
  onRobotDataResolved,
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
  const useUsdStage = sourceFile?.format === 'usd' && !isMeshPreview;
  const usdSourceFile = useUsdStage ? sourceFile : null;
  const useUsdOffscreenOnlyRenderer = usdSourceFile
    ? shouldUseUsdOffscreenStage({
        toolMode,
        selection,
        hoveredSelection,
        focusTarget,
        sourceFile: usdSourceFile,
        availableFiles,
        showOrigins: controller.showOrigins,
        showJointAxes: controller.showJointAxes,
        showCenterOfMass: controller.showCenterOfMass,
        showInertia: controller.showInertia,
      })
    : false;
  const shouldRemountRuntime = shouldForceViewerRuntimeRemount(sourceFile?.format);
  const usdStageSessionKey = usdSourceFile
    ? `${usdSourceFile.name}:${shouldRemountRuntime ? runtimeInstanceKey : 'stable'}`
    : null;
  const useUsdOffscreenBootstrap = usdSourceFile
    ? !useUsdOffscreenOnlyRenderer &&
      shouldBootstrapUsdOffscreenStage({
        toolMode,
        selection,
        hoveredSelection,
        focusTarget,
        sourceFile: usdSourceFile,
        availableFiles,
      })
    : false;
  const effectiveHoverSelectionEnabled =
    hoverSelectionEnabled && isContinuousHoverEnabledForToolMode(toolMode);
  const measureTargetResolverRef = useRef<MeasureTargetResolver | null>(null);
  const readyNotificationFrameARef = useRef<number | null>(null);
  const readyNotificationFrameBRef = useRef<number | null>(null);
  const [offscreenBootstrapReady, setOffscreenBootstrapReady] = useState(false);
  const [interactiveUsdStageReady, setInteractiveUsdStageReady] = useState(false);
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
  const usdLoadingPhaseLabels = useMemo<UsdLoadingPhaseLabels>(
    () => ({
      'checking-path': t.loadingRobotCheckingPath,
      'preloading-dependencies': t.loadingRobotPreloadingDependencies,
      'initializing-renderer': t.loadingRobotInitializingRenderer,
      'streaming-meshes': t.loadingRobotStreamingMeshes,
      'applying-stage-fixes': t.loadingRobotApplyingStageFixes,
      'resolving-metadata': t.loadingRobotResolvingMetadata,
      'finalizing-scene': t.loadingRobotFinalizingScene,
    }),
    [
      t.loadingRobotApplyingStageFixes,
      t.loadingRobotCheckingPath,
      t.loadingRobotFinalizingScene,
      t.loadingRobotInitializingRenderer,
      t.loadingRobotPreloadingDependencies,
      t.loadingRobotResolvingMetadata,
      t.loadingRobotStreamingMeshes,
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

    // Defer handoff release until after the next paint so the viewer stage has
    // a rendered frame before it becomes visible.
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
    setOffscreenBootstrapReady(false);
    setInteractiveUsdStageReady(false);
  }, [usdStageSessionKey]);
  useEffect(() => {
    const regressionRuntimeEnabled =
      import.meta.env.DEV ||
      (typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('regressionDebug') === '1');

    if (!regressionRuntimeEnabled || !usdSourceFile) {
      return;
    }

    // USD stages publish a lightweight runtime proxy through the joint-panel
    // bridge instead of useRobotLoader. Keep the regression snapshot wired to
    // that proxy so browser fixtures can observe the interactive runtime.
    setRegressionRuntimeRobot(controller.jointPanelRobot ?? null);

    return () => {
      setRegressionRuntimeRobot(null);
    };
  }, [controller.jointPanelRobot, usdSourceFile]);
  const handleUsdOffscreenDocumentLoadEvent = useCallback(
    (event: ViewerDocumentLoadEvent) => {
      if (event.status === 'ready') {
        setOffscreenBootstrapReady(true);
        if (!useUsdOffscreenBootstrap) {
          scheduleSceneReadyForDisplay();
        }
      }
      onDocumentLoadEvent?.(
        normalizeUsdBootstrapDocumentLoadEvent(event, {
          useUsdOffscreenBootstrap,
        }),
      );
    },
    [onDocumentLoadEvent, scheduleSceneReadyForDisplay, useUsdOffscreenBootstrap],
  );
  const handleUsdWasmDocumentLoadEvent = useCallback(
    (event: ViewerDocumentLoadEvent) => {
      if (useUsdOffscreenBootstrap) {
        if (event.status === 'loading') {
          return;
        }

        if (event.status === 'ready') {
          setInteractiveUsdStageReady(true);
          scheduleSceneReadyForDisplay();
          // Ignore hidden handoff loading churn, but publish the final ready
          // event so the app-level USD lifecycle can leave its hydrating state.
          onDocumentLoadEvent?.(event);
          return;
        }

        if (event.status === 'error') {
          setInteractiveUsdStageReady(false);
          onDocumentLoadEvent?.(event);
        }
        return;
      }

      if (event.status === 'ready') {
        scheduleSceneReadyForDisplay();
      }
      onDocumentLoadEvent?.(event);
    },
    [onDocumentLoadEvent, scheduleSceneReadyForDisplay, useUsdOffscreenBootstrap],
  );
  const handleRobotLoaded = useCallback(
    (robot: Parameters<NonNullable<RobotModelProps['onRobotLoaded']>>[0]) => {
      controller.handleRobotLoaded(robot);
      onRuntimeRobotLoaded?.(robot);
      scheduleSceneReadyForDisplay();
    },
    [controller.handleRobotLoaded, onRuntimeRobotLoaded, scheduleSceneReadyForDisplay],
  );
  // For default USD select mode, keep the worker-rendered stage on screen until
  // the interactive main-thread stage has finished its own hidden handoff load.
  const mountUsdOffscreenStage = Boolean(
    usdSourceFile &&
    (useUsdOffscreenOnlyRenderer || (useUsdOffscreenBootstrap && !interactiveUsdStageReady)),
  );
  const mountUsdWasmStage = Boolean(
    usdSourceFile &&
    !useUsdOffscreenOnlyRenderer &&
    (!useUsdOffscreenBootstrap || offscreenBootstrapReady),
  );
  const usdOffscreenStageActive =
    active &&
    (useUsdOffscreenOnlyRenderer || (useUsdOffscreenBootstrap && !interactiveUsdStageReady));
  const usdWasmStageActive =
    active &&
    !useUsdOffscreenOnlyRenderer &&
    (!useUsdOffscreenBootstrap || interactiveUsdStageReady);

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

      {usdSourceFile ? (
        <Suspense fallback={null}>
          {mountUsdOffscreenStage ? (
            <LazyUsdOffscreenStage
              key={`${usdSourceFile.name}:${shouldRemountRuntime ? runtimeInstanceKey : 'stable'}:offscreen`}
              resolvedTheme={resolvedTheme}
              active={usdOffscreenStageActive}
              sourceFile={usdSourceFile}
              availableFiles={availableFiles}
              assets={assets}
              groundPlaneOffset={groundPlaneOffset}
              showVisual={controller.showVisual}
              showCollision={controller.showCollision}
              showCollisionAlwaysOnTop={controller.showCollisionAlwaysOnTop}
              showOrigins={controller.showOrigins}
              showOriginsOverlay={controller.showOriginsOverlay}
              originSize={controller.originSize}
              loadingLabel={t.loadingRobot}
              loadingDetailLabel={t.loadingRobotPreparing}
              loadingPhaseLabels={usdLoadingPhaseLabels}
              onRobotDataResolved={onRobotDataResolved}
              onDocumentLoadEvent={handleUsdOffscreenDocumentLoadEvent}
              selection={selection}
              hoveredSelection={hoveredSelection}
              hoverSelectionEnabled={effectiveHoverSelectionEnabled}
              onHover={onHover}
              onMeshSelect={onMeshSelect}
              interactionLayerPriority={controller.interactionLayerPriority}
              toolMode={toolMode}
              runtimeBridge={runtimeBridge}
              registerAutoFitGroundHandler={controller.registerRuntimeAutoFitGroundHandler}
              retainReadyAsLoadingDuringBootstrapHandoff={useUsdOffscreenBootstrap}
            />
          ) : null}
          {mountUsdWasmStage ? (
            <LazyUsdWasmStage
              key={`${usdSourceFile.name}:${shouldRemountRuntime ? runtimeInstanceKey : 'stable'}`}
              active={usdWasmStageActive}
              sourceFile={usdSourceFile}
              availableFiles={availableFiles}
              assets={assets}
              groundPlaneOffset={groundPlaneOffset}
              mode={mode}
              justSelectedRef={controller.justSelectedRef}
              selection={selection}
              hoveredSelection={hoveredSelection}
              hoverSelectionEnabled={effectiveHoverSelectionEnabled}
              onHover={onHover}
              onMeshSelect={onMeshSelect}
              showOrigins={controller.showOrigins}
              showOriginsOverlay={controller.showOriginsOverlay}
              originSize={controller.originSize}
              showJointAxes={controller.showJointAxes}
              showJointAxesOverlay={controller.showJointAxesOverlay}
              jointAxisSize={controller.jointAxisSize}
              showCenterOfMass={controller.showCenterOfMass}
              showCoMOverlay={controller.showCoMOverlay}
              centerOfMassSize={controller.centerOfMassSize}
              showInertia={controller.showInertia}
              showInertiaOverlay={controller.showInertiaOverlay}
              showVisual={controller.showVisual}
              showCollision={controller.showCollision}
              showCollisionAlwaysOnTop={controller.showCollisionAlwaysOnTop}
              interactionLayerPriority={controller.interactionLayerPriority}
              toolMode={toolMode}
              robotLinks={robotLinks}
              transformMode={controller.transformMode}
              onCollisionTransformPreview={onCollisionTransformPreview}
              onCollisionTransformEnd={onCollisionTransform}
              onTransformPending={controller.handleTransformPending}
              setIsDragging={controller.setIsDragging}
              loadingLabel={t.loadingRobot}
              loadingDetailLabel={t.loadingRobotPreparing}
              loadingPhaseLabels={usdLoadingPhaseLabels}
              onRobotDataResolved={onRobotDataResolved}
              onDocumentLoadEvent={handleUsdWasmDocumentLoadEvent}
              runtimeBridge={runtimeBridge}
              registerAutoFitGroundHandler={controller.registerRuntimeAutoFitGroundHandler}
              measureTargetResolverRef={measureTargetResolverRef}
            />
          ) : null}
        </Suspense>
      ) : (
        <Suspense fallback={null}>
          <RobotModel
            active={active}
            urdfContent={urdfContent}
            assets={assets}
            sourceFormat={sourceFormat ?? getViewerRobotSourceFormat(sourceFile?.format)}
            allowUrdfXmlFallback={allowUrdfXmlFallback}
            reloadToken={runtimeInstanceKey}
            initialRobot={retainedRobot}
            sourceFilePath={sourceFilePath}
            onRobotLoaded={handleRobotLoaded}
            onDocumentLoadEvent={onDocumentLoadEvent}
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
            onJointChange={controller.handleRuntimeJointAngleChange}
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
      )}
    </>
  );
};
