import React, { memo, useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Group, Object3D } from 'three';
import {
  LinkIkTransformControls,
  SceneCompileWarmup,
  shouldUseIndeterminateStreamingMeshProgress,
} from '@/shared/components/3d';
import { cloneAssemblyTransform } from '@/core/robot/assemblyTransforms';
import { resolveLinkIkHandleDescriptor, resolveLinkKey } from '@/core/robot';
import { CollisionTransformControls } from './CollisionTransformControls';
import { HoverSelectionSync } from './HoverSelectionSync';
import { SourceSceneAssemblyTransformControls } from './SourceSceneAssemblyTransformControls';
import { ViewerLoadingHud } from './ViewerLoadingHud';
import type { RobotModelProps } from '../types';
import { buildViewerLoadingHudState } from '../utils/viewerLoadingHud';
import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import { useUIStore } from '@/store';

import { useRobotLoader } from '../hooks/useRobotLoader';
import { useHighlightManager } from '../hooks/useHighlightManager';
import { useCameraFocus } from '../hooks/useCameraFocus';
import { useMouseInteraction } from '../hooks/useMouseInteraction';
import { useHoverDetection } from '../hooks/useHoverDetection';
import { useVisualizationEffects } from '../hooks/useVisualizationEffects';
import {
  createRuntimeSceneLinkMetadataState,
  resolveRuntimeSceneLinkMetadataState,
} from '../utils/runtimeSceneMetadata';
import { resolveViewerRobotSourceFormat } from '../utils/sourceFormat';
import { shouldEnableViewerSceneCompileWarmup } from '../utils/sceneCompileWarmupPolicy';

// Wrap with memo and custom comparison to prevent unnecessary re-renders
export const RobotModel: React.FC<RobotModelProps> = memo(
  ({
    urdfContent,
    assets,
    sourceFormat = 'auto',
    reloadToken = 0,
    initialRobot = null,
    sourceFilePath,
    onRobotLoaded,
    onDocumentLoadEvent,
    showCollision = false,
    showVisual = true,
    showIkHandles = true,
    showIkHandlesAlwaysOnTop = true,
    showCollisionAlwaysOnTop = true,
    onSelect,
    onHover,
    onMeshSelect,
    onJointChange,
    onJointChangeCommit,
    initialJointAngles,
    registerSceneRefresh,
    setIsDragging,
    onIkPreviewKinematicOverrides,
    onClearIkPreviewKinematicOverrides,
    setActiveJoint,
    justSelectedRef,
    t,
    mode,
    selection,
    hoverSelectionEnabled = true,
    showInertia = false,
    showCenterOfMass = false,
    showCoMOverlay = true,
    centerOfMassSize = 0.01,
    showOrigins = false,
    showOriginsOverlay = false,
    originSize = 1.0,
    showMjcfSites = false,
    showJointAxes = false,
    showJointAxesOverlay = true,
    jointAxisSize = 1.0,
    modelOpacity = 1.0,
    ikRobotState: providedIkRobotState = null,
    robotLinks,
    robotJoints,
    focusTarget,
    transformMode = 'select',
    toolMode = 'select',
    onCollisionTransformPreview,
    onCollisionTransformEnd,
    isOrbitDragging,
    onTransformPending,
    isSelectionLockedRef,
    isMeshPreview = false,
    hoveredSelection,
    interactionLayerPriority = [],
    groundPlaneOffset = 0,
    active = true,
    sourceSceneAssemblyComponentId = null,
    sourceSceneAssemblyComponentTransform = null,
    showSourceSceneAssemblyComponentControls = false,
    onSourceSceneAssemblyComponentTransform,
  }) => {
    const { invalidate } = useThree();
    const snapshotRenderActive = useSnapshotRenderActive();
    const showMjcfWorldLink = useUIStore((state) => state.viewOptions.showMjcfWorldLink);
    const autoFrameScopeFallbackRef = useRef<string | null>(null);
    const [sourceSceneComponentRoot, setSourceSceneComponentRoot] = useState<Group | null>(null);
    const resolvedSourceFormat = useMemo(
      () => resolveViewerRobotSourceFormat(urdfContent, sourceFormat),
      [sourceFormat, urdfContent],
    );
    const runtimeSceneMetadataScopeKey = `${sourceFilePath ?? 'viewer-inline'}:${reloadToken}`;
    const runtimeSceneLinkMetadataRef = useRef(
      createRuntimeSceneLinkMetadataState({
        scopeKey: runtimeSceneMetadataScopeKey,
        robot: null,
        robotVersion: 0,
        robotLinks,
      }),
    );

    if (!autoFrameScopeFallbackRef.current) {
      autoFrameScopeFallbackRef.current = `viewer-session:${Math.random().toString(36).slice(2)}`;
    }

    // Keep ref for setIsDragging to avoid stale closures
    const setIsDraggingRef = useRef(setIsDragging);
    useEffect(() => {
      setIsDraggingRef.current = setIsDragging;
    }, [setIsDragging]);
    // ============================================================
    // HOOK: Robot Loading
    // ============================================================
    const { robot, error, isLoading, loadingProgress, robotVersion, linkMeshMapRef } =
      useRobotLoader({
        urdfContent,
        assets,
        sourceFormat,
        reloadToken,
        initialRobot,
        sourceFilePath,
        showCollision,
        showVisual,
        showCollisionAlwaysOnTop,
        isMeshPreview,
        robotLinks,
        robotJoints,
        initialJointAngles,
        onRobotLoaded,
        onDocumentLoadEvent,
        groundPlaneOffset,
        showMjcfWorldLink,
      });

    // Keep scene metadata pinned to the currently mounted runtime robot while a
    // different source file is still streaming in. This prevents the old scene
    // from briefly inheriting the next file's visibility rules and helper state.
    runtimeSceneLinkMetadataRef.current = resolveRuntimeSceneLinkMetadataState(
      runtimeSceneLinkMetadataRef.current,
      {
        scopeKey: runtimeSceneMetadataScopeKey,
        robot,
        robotVersion,
        robotLinks,
      },
    );
    const runtimeRobotLinks = runtimeSceneLinkMetadataRef.current.robotLinks;
    const runtimeRobotRootLinkId = useMemo(() => {
      const links = runtimeRobotLinks ?? {};
      const joints = robotJoints ?? {};
      const linkIds = Object.keys(links);

      if (linkIds.length === 0) {
        return null;
      }

      const childLinkIds = new Set(Object.values(joints).map((joint) => joint.childLinkId));
      return linkIds.find((linkId) => !childLinkIds.has(linkId)) ?? linkIds[0] ?? null;
    }, [robotJoints, runtimeRobotLinks]);
    const selectedIkHandleLinkId = useMemo(
      () =>
        selection?.type === 'link' && selection.helperKind === 'ik-handle'
          ? (selection.id ?? null)
          : null,
      [selection?.helperKind, selection?.id, selection?.type],
    );
    const selectedIkRuntimeLink = useMemo(() => {
      if (!robot || !selectedIkHandleLinkId) {
        return null;
      }

      const runtimeLinkMap = (
        robot as Object3D & {
          links?: Record<string, Object3D>;
        }
      ).links;
      const resolvedLinkId =
        resolveLinkKey(runtimeRobotLinks ?? {}, selectedIkHandleLinkId) ?? selectedIkHandleLinkId;

      return runtimeLinkMap?.[resolvedLinkId] ?? runtimeLinkMap?.[selectedIkHandleLinkId] ?? null;
    }, [robot, runtimeRobotLinks, selectedIkHandleLinkId]);
    const selectedIkHandle = useMemo(
      () =>
        (
          selectedIkRuntimeLink as
            | (Object3D & {
                userData?: { __ikHandle?: Object3D };
              })
            | null
        )?.userData?.__ikHandle ?? null,
      [selectedIkRuntimeLink],
    );
    const selectedIkHandleDescriptor = useMemo(() => {
      if (
        !selectedIkHandleLinkId ||
        !runtimeRobotRootLinkId ||
        !runtimeRobotLinks ||
        !robotJoints
      ) {
        return null;
      }

      return resolveLinkIkHandleDescriptor(
        {
          links: runtimeRobotLinks,
          joints: robotJoints,
          rootLinkId: runtimeRobotRootLinkId,
        },
        selectedIkHandleLinkId,
      );
    }, [robotJoints, runtimeRobotLinks, runtimeRobotRootLinkId, selectedIkHandleLinkId]);
    const fallbackIkRobotState = useMemo(
      () =>
        runtimeRobotRootLinkId && runtimeRobotLinks && robotJoints
          ? {
              links: runtimeRobotLinks,
              joints: robotJoints,
              rootLinkId: runtimeRobotRootLinkId,
              closedLoopConstraints: [],
            }
          : null,
      [robotJoints, runtimeRobotLinks, runtimeRobotRootLinkId],
    );
    const ikRobotState = providedIkRobotState ?? fallbackIkRobotState;

    // ============================================================
    // HOOK: Highlight Manager
    // ============================================================
    const {
      highlightGeometry,
      rayIntersectsBoundingBox,
      highlightedMeshesRef,
      boundingBoxNeedsUpdateRef,
    } = useHighlightManager({
      robot,
      robotVersion,
      showCollision,
      showVisual,
      showCollisionAlwaysOnTop,
      robotLinks: runtimeRobotLinks,
      linkMeshMapRef,
    });

    // ============================================================
    // HOOK: Camera Focus
    // ============================================================
    useCameraFocus({
      robot,
      focusTarget,
      selection,
      mode,
      autoFrameOnRobotChange: active && !focusTarget && !isLoading,
      autoFrameScopeKey: sourceFilePath ?? autoFrameScopeFallbackRef.current,
      active,
    });

    // ============================================================
    // HOOK: Mouse Interaction
    // ============================================================
    const { mouseRef, raycasterRef, hoveredLinkRef, isDraggingJoint, needsRaycastRef } =
      useMouseInteraction({
        robot,
        robotVersion,
        toolMode,
        mode,
        showCollision,
        showVisual,
        showCollisionAlwaysOnTop,
        interactionLayerPriority,
        linkMeshMapRef,
        onHover,
        onSelect,
        onMeshSelect,
        onJointChange,
        onJointChangeCommit,
        throttleJointChangeDuringDrag: true,
        setIsDragging,
        setActiveJoint,
        justSelectedRef,
        isOrbitDragging,
        isSelectionLockedRef,
        selection,
        rayIntersectsBoundingBox,
        highlightGeometry,
      });

    const handleCollisionTransformDragging = useCallback(
      (dragging: boolean) => {
        setIsDraggingRef.current?.(dragging);
        if (!dragging) {
          needsRaycastRef.current = true;
          invalidate();
        }
      },
      [invalidate, needsRaycastRef],
    );

    // ============================================================
    // HOOK: Hover Detection
    // ============================================================
    useHoverDetection({
      robot,
      robotVersion,
      toolMode,
      hoverSelectionEnabled,
      mode,
      showCollision,
      showVisual,
      showCollisionAlwaysOnTop,
      interactionLayerPriority,
      selection,
      onHover,
      linkMeshMapRef,
      mouseRef,
      raycasterRef,
      hoveredLinkRef,
      isDraggingJoint,
      needsRaycastRef,
      isOrbitDragging,
      justSelectedRef,
      isSelectionLockedRef,
      rayIntersectsBoundingBox,
      highlightGeometry,
    });

    // ============================================================
    // HOOK: Visualization Effects
    // ============================================================
    const { syncHoverHighlight } = useVisualizationEffects({
      robot,
      robotVersion,
      showCollision,
      showVisual,
      showCollisionAlwaysOnTop,
      showInertia,
      showIkHandles,
      showIkHandlesAlwaysOnTop,
      showCenterOfMass,
      showCoMOverlay,
      centerOfMassSize,
      showOrigins,
      showOriginsOverlay,
      originSize,
      showMjcfSites,
      showJointAxes,
      showJointAxesOverlay,
      jointAxisSize,
      modelOpacity,
      robotLinks: runtimeRobotLinks,
      robotJoints,
      selection,
      highlightGeometry,
      highlightedMeshesRef,
      linkMeshMapRef,
      sourceFormat: resolvedSourceFormat,
      showMjcfWorldLink,
    });
    const usesExternalHoverSelection = hoveredSelection !== undefined;
    const previousUsesExternalHoverSelectionRef = useRef(usesExternalHoverSelection);

    useEffect(() => {
      const usedExternalHoverSelection = previousUsesExternalHoverSelectionRef.current;
      previousUsesExternalHoverSelectionRef.current = usesExternalHoverSelection;

      if (!usesExternalHoverSelection && usedExternalHoverSelection) {
        syncHoverHighlight(undefined);
      }
    }, [syncHoverHighlight, usesExternalHoverSelection]);

    useEffect(() => {
      if (!usesExternalHoverSelection) {
        return;
      }

      syncHoverHighlight(hoverSelectionEnabled ? hoveredSelection : undefined);
    }, [
      hoverSelectionEnabled,
      hoveredSelection?.type,
      hoveredSelection?.id,
      hoveredSelection?.subType,
      hoveredSelection?.objectIndex,
      hoveredSelection?.helperKind,
      hoveredSelection?.highlightObjectId,
      syncHoverHighlight,
      usesExternalHoverSelection,
    ]);

    const requestSceneRefresh = useCallback(() => {
      if (!robot) {
        return;
      }

      robot.updateMatrixWorld(true);
      boundingBoxNeedsUpdateRef.current = true;
      needsRaycastRef.current = true;
      invalidate();
    }, [boundingBoxNeedsUpdateRef, invalidate, needsRaycastRef, robot]);

    useEffect(() => {
      registerSceneRefresh?.(requestSceneRefresh);
      return () => {
        registerSceneRefresh?.(null);
      };
    }, [registerSceneRefresh, requestSceneRefresh]);

    // ============================================================
    // RENDER
    // ============================================================
    const useIndeterminateStreamingProgress = shouldUseIndeterminateStreamingMeshProgress({
      phase: loadingProgress?.phase,
      loadedCount: loadingProgress?.loadedCount,
      totalCount: loadingProgress?.totalCount,
    });
    const loadingHudState = buildViewerLoadingHudState({
      phase: loadingProgress?.phase,
      progressMode: useIndeterminateStreamingProgress
        ? 'indeterminate'
        : loadingProgress?.progressMode,
      loadedCount: useIndeterminateStreamingProgress ? null : loadingProgress?.loadedCount,
      totalCount: useIndeterminateStreamingProgress ? null : loadingProgress?.totalCount,
      progressPercent: loadingProgress?.progressPercent,
      fallbackDetail: useIndeterminateStreamingProgress
        ? t.loadingRobotParsingInitialMeshes
        : t.loadingRobotPreparing,
    });
    const loadingStageLabel =
      loadingProgress?.phase === 'preparing-scene'
        ? t.loadingRobotPreparing
        : loadingProgress?.phase === 'streaming-meshes'
          ? t.loadingRobotStreamingMeshes
          : loadingProgress?.phase === 'finalizing-scene'
            ? t.loadingRobotFinalizingScene
            : null;
    const loadingDetail =
      loadingHudState.detail === loadingStageLabel ? '' : loadingHudState.detail;
    const sceneCompileWarmupKey = [
      sourceFilePath ?? 'viewer-inline',
      String(robotVersion),
      showVisual ? 'visual-on' : 'visual-off',
      showCollision ? 'collision-on' : 'collision-off',
    ].join('|');
    const sceneCompileWarmupEnabled = shouldEnableViewerSceneCompileWarmup(resolvedSourceFormat);
    const sourceSceneTransform = cloneAssemblyTransform(sourceSceneAssemblyComponentTransform);
    const handleSourceSceneComponentRootRef = useCallback((node: Group | null) => {
      setSourceSceneComponentRoot((current) => (current === node ? current : node));
    }, []);

    if (error) {
      return (
        <Html center>
          <div className="bg-red-900/80 text-red-200 px-4 py-2 rounded text-sm">Error: {error}</div>
        </Html>
      );
    }

    return (
      <>
        {!usesExternalHoverSelection ? (
          <HoverSelectionSync
            enabled={hoverSelectionEnabled}
            onHoverSelectionChange={syncHoverHighlight}
          />
        ) : null}
        <SceneCompileWarmup
          active={sceneCompileWarmupEnabled && active && Boolean(robot) && !isLoading}
          warmupKey={sceneCompileWarmupKey}
        />
        <group
          ref={handleSourceSceneComponentRootRef}
          position={[
            sourceSceneTransform.position.x,
            sourceSceneTransform.position.y,
            sourceSceneTransform.position.z,
          ]}
          rotation={[
            sourceSceneTransform.rotation.r,
            sourceSceneTransform.rotation.p,
            sourceSceneTransform.rotation.y,
          ]}
        >
          {robot ? <primitive object={robot} /> : null}
        </group>
        {isLoading && !onDocumentLoadEvent ? (
          <Html fullscreen>
            <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-4">
              <ViewerLoadingHud
                title={t.loadingRobot}
                detail={loadingDetail}
                progress={loadingHudState.progress}
                progressMode={loadingHudState.progressMode}
                statusLabel={loadingHudState.statusLabel}
                stageLabel={loadingStageLabel}
                delayMs={0}
              />
            </div>
          </Html>
        ) : null}
        {!snapshotRenderActive && robot && toolMode !== 'measure' && (
          <LinkIkTransformControls
            selectedLinkId={selectedIkHandleLinkId}
            selectedHandle={selectedIkHandle}
            coordinateRoot={robot}
            ikRobotState={ikRobotState}
            enabled={active && Boolean(selectedIkHandleDescriptor?.jointIds.length)}
            historyLabel="Move IK handle"
            setIsDragging={setIsDragging}
            onPreviewKinematicOverrides={(overrides) =>
              onIkPreviewKinematicOverrides?.(overrides.angles, overrides.quaternions)
            }
            onClearPreviewKinematicOverrides={onClearIkPreviewKinematicOverrides}
          />
        )}
        {!snapshotRenderActive &&
          (() => {
            if (
              active &&
              showSourceSceneAssemblyComponentControls &&
              sourceSceneAssemblyComponentId &&
              onSourceSceneAssemblyComponentTransform
            ) {
              return (
                <SourceSceneAssemblyTransformControls
                  object={sourceSceneComponentRoot}
                  componentId={sourceSceneAssemblyComponentId}
                  transformMode={transformMode}
                  onComponentTransform={onSourceSceneAssemblyComponentTransform}
                  onTransformPending={onTransformPending}
                />
              );
            }

            const shouldShow = transformMode !== 'select' && selection?.subType === 'collision';
            return shouldShow ? (
              <CollisionTransformControls
                robot={robot}
                robotVersion={robotVersion}
                selection={selection}
                transformMode={transformMode}
                setIsDragging={handleCollisionTransformDragging}
                onTransformChange={onCollisionTransformPreview}
                onTransformEnd={onCollisionTransformEnd}
                robotLinks={runtimeRobotLinks}
                onTransformPending={onTransformPending}
              />
            ) : null;
          })()}
      </>
    );
  },
);
