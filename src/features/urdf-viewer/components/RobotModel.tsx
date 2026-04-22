import React, { memo, useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Group, Object3D } from 'three';
import {
  LinkIkTransformControls,
  SceneCompileWarmup,
  shouldUseIndeterminateStreamingMeshProgress,
} from '@/shared/components/3d';
import { isAssemblyTransformSelectionArmed } from '@/shared/utils/assembly/transformSelection';
import {
  resolveViewerJointAngleValue,
  resolveViewerJointKey,
} from '@/shared/utils/jointPanelState';
import { cloneAssemblyTransform } from '@/core/robot/assemblyTransforms';
import {
  applyMeshMaterialPaintEdit,
  getVisualGeometryByObjectIndex,
  hasGeometryMeshMaterialGroups,
  resolveDirectManipulableLinkIkDescriptor,
  resolveLinkIkHandleDescriptor,
  resolveLinkKey,
  resolveVisualMaterialOverride,
  updateVisualGeometryByObjectIndex,
} from '@/core/robot';
import {
  getBufferGeometryTriangleCount,
  resolveMeshFaceSelection,
  resolveRuntimeMeshMaterialGroupKey,
  resolveRuntimeMeshRootWithinVisual,
} from '@/core/utils/meshMaterialGroups';
import { CollisionTransformControls } from './CollisionTransformControls';
import { HoverSelectionSync } from './HoverSelectionSync';
import { JointInteraction } from './JointInteraction';
import { OriginTransformControls } from './OriginTransformControls';
import { AssemblyTransformControls } from './AssemblyTransformControls';
import { ViewerLoadingHud } from './ViewerLoadingHud';
import type { RobotModelProps, ViewerPaintFaceHit } from '../types';
import { buildViewerLoadingHudState } from '../utils/viewerLoadingHud';
import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import { useRobotStore, useUIStore } from '@/store';
import { GeometryType } from '@/types';

import { useRobotLoader } from '../hooks/useRobotLoader';
import { useHighlightManager } from '../hooks/useHighlightManager';
import { useCameraFocus } from '../hooks/useCameraFocus';
import { useMouseInteraction } from '../hooks/useMouseInteraction';
import { useHoverDetection } from '../hooks/useHoverDetection';
import { useVisualizationEffects } from '../hooks/useVisualizationEffects';
import { isSingleDofJoint } from '../utils/jointTypes';
import {
  createRuntimeSceneLinkMetadataState,
  resolveRuntimeSceneLinkMetadataState,
} from '../utils/runtimeSceneMetadata';
import { resolveSelectedIkDragLinkId } from '../utils/selectedIkDragLink';
import { resolveViewerRobotSourceFormat } from '../utils/sourceFormat';
import { shouldEnableViewerSceneCompileWarmup } from '../utils/sceneCompileWarmupPolicy';

// Wrap with memo and custom comparison to prevent unnecessary re-renders
export const RobotModel: React.FC<RobotModelProps> = memo(
  ({
    urdfContent,
    assets,
    sourceFormat = 'auto',
    allowUrdfXmlFallback = true,
    reloadToken = 0,
    initialRobot = null,
    sourceFilePath,
    onRobotLoaded,
    onDocumentLoadEvent,
    showCollision = false,
    showVisual = true,
    showIkHandles = false,
    showIkHandlesAlwaysOnTop = true,
    showCollisionAlwaysOnTop = true,
    onSelect,
    onHover,
    onMeshSelect,
    onUpdate,
    paintColor = '#ff6c0a',
    paintSelectionScope = 'island',
    paintOperation = 'paint',
    onPaintStatusChange,
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
    ikDragActive = false,
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
    assemblyState = null,
    assemblySelection,
    onAssemblyTransform,
    onComponentTransform,
    onBridgeTransform,
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
    const { robot, isLoading, loadingProgress, robotVersion, linkMeshMapRef } = useRobotLoader({
      urdfContent,
      assets,
      sourceFormat,
      allowUrdfXmlFallback,
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
        resolveSelectedIkDragLinkId({
          selection,
          ikDragActive,
          robotLinks: runtimeRobotLinks,
          robotJoints,
          rootLinkId: runtimeRobotRootLinkId,
        }),
      [ikDragActive, robotJoints, runtimeRobotLinks, runtimeRobotRootLinkId, selection],
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
    const selectedPassiveIkHandleDescriptor = useMemo(() => {
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
    const selectedDirectIkHandleDescriptor = useMemo(() => {
      if (
        !selectedIkHandleLinkId ||
        !runtimeRobotRootLinkId ||
        !runtimeRobotLinks ||
        !robotJoints
      ) {
        return null;
      }

      return resolveDirectManipulableLinkIkDescriptor(
        {
          links: runtimeRobotLinks,
          joints: robotJoints,
          rootLinkId: runtimeRobotRootLinkId,
        },
        selectedIkHandleLinkId,
      );
    }, [robotJoints, runtimeRobotLinks, runtimeRobotRootLinkId, selectedIkHandleLinkId]);
    const selectedIkHandleDescriptor =
      selectedDirectIkHandleDescriptor ?? selectedPassiveIkHandleDescriptor;
    const selectedJointEntry = useMemo(() => {
      if (!robot || selection?.type !== 'joint' || !selection.id) {
        return null;
      }

      const runtimeJoints = (robot as Object3D & { joints?: Record<string, any> }).joints;
      const jointKey = resolveViewerJointKey(runtimeJoints, selection.id);
      const joint = jointKey ? runtimeJoints?.[jointKey] : null;
      if (!joint || !isSingleDofJoint(joint)) {
        return null;
      }

      return {
        jointKey,
        joint,
        jointName: joint.name || jointKey,
      };
    }, [robot, selection?.id, selection?.type]);
    const selectedJointValue = useMemo(() => {
      if (!selectedJointEntry) {
        return 0;
      }

      return resolveViewerJointAngleValue(
        undefined,
        selectedJointEntry.jointKey,
        selectedJointEntry.joint,
        0,
      );
    }, [selectedJointEntry]);
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
    const assemblyTransformSelectionArmed = useMemo(
      () => isAssemblyTransformSelectionArmed(assemblyState, assemblySelection, selection),
      [assemblySelection, assemblyState, selection],
    );

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

    const handlePaintFace = useCallback(
      async ({ linkId, objectIndex, mesh, faceIndex }: ViewerPaintFaceHit) => {
        if (isMeshPreview) {
          onPaintStatusChange?.({
            tone: 'error',
            message: t.paintUnsupportedRobotOnly,
          });
          return;
        }

        if (!Number.isInteger(faceIndex) || faceIndex < 0) {
          onPaintStatusChange?.({
            tone: 'error',
            message: t.paintErrorFaceUnavailable,
          });
          return;
        }

        const link = robotLinks?.[linkId];
        const visualGeometry = link
          ? getVisualGeometryByObjectIndex(link, objectIndex)?.geometry
          : null;
        if (!link || !visualGeometry || visualGeometry.type !== GeometryType.MESH) {
          onPaintStatusChange?.({
            tone: 'error',
            message: t.paintErrorVisualMeshOnly,
          });
          return;
        }

        const robotMaterials = useRobotStore.getState().materials;
        const resolvedMaterial = resolveVisualMaterialOverride(
          { materials: robotMaterials },
          link,
          visualGeometry,
          { isPrimaryVisual: objectIndex === 0 },
        );
        const hasCustomMeshGroups = hasGeometryMeshMaterialGroups(visualGeometry);
        const builtInMultiMaterialTarget =
          !hasCustomMeshGroups &&
          (Array.isArray(mesh.material) || (visualGeometry.authoredMaterials?.length || 0) > 1);
        if (builtInMultiMaterialTarget) {
          onPaintStatusChange?.({
            tone: 'error',
            message: t.paintErrorMultiMaterial,
          });
          return;
        }

        const triangleCount = getBufferGeometryTriangleCount(mesh.geometry);
        if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex >= triangleCount) {
          onPaintStatusChange?.({
            tone: 'error',
            message: t.paintErrorFaceUnavailable,
          });
          return;
        }

        const selectedFaceIndices = resolveMeshFaceSelection(
          mesh.geometry,
          faceIndex,
          paintSelectionScope,
        );
        if (selectedFaceIndices.length === 0) {
          onPaintStatusChange?.({
            tone: 'error',
            message: t.paintErrorSelectionUnavailable,
          });
          return;
        }

        const meshRoot = resolveRuntimeMeshRootWithinVisual(mesh);
        const meshKey = resolveRuntimeMeshMaterialGroupKey(mesh, meshRoot);
        const baseMaterial = visualGeometry.authoredMaterials?.[0] ?? {
          name: `paint_base_${objectIndex}`,
          color: resolvedMaterial.color ?? undefined,
          texture: resolvedMaterial.texture ?? undefined,
        };
        const nextLink = updateVisualGeometryByObjectIndex(link, objectIndex, {
          ...applyMeshMaterialPaintEdit({
            geometry: visualGeometry,
            meshKey,
            triangleCount,
            selectedFaceIndices,
            paintColor,
            erase: paintOperation === 'erase',
            baseMaterial,
            materialNamePrefix: `paint_${linkId}_${objectIndex}`,
          }),
        });
        useRobotStore.getState().updateLink(link.id, nextLink, {
          label: paintOperation === 'erase' ? 'Erase painted mesh faces' : 'Paint mesh faces',
        });
        onPaintStatusChange?.({
          tone: 'success',
          message: paintOperation === 'erase' ? t.paintStatusRemoved : t.paintStatusApplied,
        });
      },
      [
        isMeshPreview,
        onPaintStatusChange,
        paintColor,
        paintOperation,
        paintSelectionScope,
        robotLinks,
        t,
      ],
    );

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
        robotLinks: runtimeRobotLinks,
        robotJoints,
        onHover,
        onSelect,
        onMeshSelect,
        onPaintFace: handlePaintFace,
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
        resolveDirectIkHandleLink:
          ikDragActive && runtimeRobotRootLinkId && runtimeRobotLinks && robotJoints
            ? (linkId) =>
                resolveDirectManipulableLinkIkDescriptor(
                  {
                    links: runtimeRobotLinks,
                    joints: robotJoints,
                    rootLinkId: runtimeRobotRootLinkId,
                  },
                  linkId,
                )
                  ? linkId
                  : null
            : undefined,
      });

    const handleCollisionTransformDragging = useCallback(
      (dragging: boolean) => {
        if (dragging) {
          // Arm the selection-miss guard during collision transform drags so
          // that R3F's onPointerMissed does not clear the selection while the
          // user is actively dragging the gizmo.
          if (justSelectedRef) {
            justSelectedRef.current = true;
          }
        }
        setIsDraggingRef.current?.(dragging);
        if (!dragging) {
          needsRaycastRef.current = true;
          invalidate();
        }
      },
      [invalidate, needsRaycastRef, justSelectedRef],
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
      robotLinks: runtimeRobotLinks,
      robotJoints,
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
      ikDragActive,
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
            selectedLinkObject={selectedIkRuntimeLink}
            selectedAnchorLocal={selectedIkHandleDescriptor?.anchorLocal ?? null}
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
        active &&
        selection?.helperKind === 'origin-axes' &&
        transformMode !== 'select' ? (
          <OriginTransformControls
            robot={robot}
            robotVersion={robotVersion}
            selection={selection}
            transformMode={transformMode}
            setIsDragging={handleCollisionTransformDragging}
            onTransformPending={onTransformPending}
            onUpdate={onUpdate}
            robotJoints={robotJoints}
          />
        ) : !snapshotRenderActive && active && selectedJointEntry && transformMode !== 'select' ? (
          <JointInteraction
            joint={selectedJointEntry.joint}
            value={selectedJointValue}
            transformMode={transformMode}
            onChange={(nextValue) => onJointChange?.(selectedJointEntry.jointName, nextValue)}
            onCommit={(nextValue) => onJointChangeCommit?.(selectedJointEntry.jointName, nextValue)}
            setIsDragging={setIsDragging}
          />
        ) : null}
        {!snapshotRenderActive &&
        active &&
        assemblySelection &&
        transformMode !== 'select' &&
        assemblyTransformSelectionArmed ? (
          <AssemblyTransformControls
            robot={{
              name: 'workspace',
              rootLinkId: runtimeRobotRootLinkId ?? '__workspace_world__',
              links: runtimeRobotLinks ?? {},
              joints: robotJoints ?? {},
              selection: { type: null, id: null },
            }}
            runtimeRobot={robot}
            assemblyState={assemblyState}
            assemblySelection={assemblySelection}
            transformMode={transformMode}
            assemblyRoot={sourceSceneComponentRoot}
            sourceSceneComponentRoot={sourceSceneComponentRoot}
            sourceSceneComponentId={sourceSceneAssemblyComponentId}
            onAssemblyTransform={onAssemblyTransform}
            onComponentTransform={onComponentTransform}
            onBridgeTransform={onBridgeTransform}
            onSourceSceneComponentTransform={onSourceSceneAssemblyComponentTransform}
            onTransformPendingChange={onTransformPending}
          />
        ) : !snapshotRenderActive &&
          transformMode !== 'select' &&
          selection?.subType === 'collision' ? (
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
        ) : null}
      </>
    );
  },
);
