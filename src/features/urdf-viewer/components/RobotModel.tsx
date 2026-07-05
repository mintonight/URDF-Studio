import React, { memo, useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { Box3, Matrix4, Vector3 as ThreeVector3, type Group, type Object3D } from 'three';
import {
  LinkIkTransformControls,
  SceneCompileWarmup,
  shouldUseIndeterminateStreamingMeshProgress,
} from '@/shared/components/3d';
import { requestShadowMapRefresh } from '@/shared/components/3d/scene/shadowMapRefresh';
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
  resolveDirectManipulableLinkIkJointIds,
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
import { ViewerLoadingHudOverlay } from './ViewerLoadingHudOverlay';
import type { RobotModelProps, ViewerDocumentLoadEvent, ViewerPaintFaceHit } from '../types';
import { buildViewerLoadingHudState } from '../utils/viewerLoadingHud';
import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import { useRobotStore, useSelectionStore, useUIStore } from '@/store';
import { GeometryType, type RobotFile } from '@/types';

import { useRendererBackend } from '../hooks/useRendererBackend';
import { useHighlightManager } from '../hooks/useHighlightManager';
import { useCameraFocus } from '../hooks/useCameraFocus';
import { useMouseInteraction } from '../hooks/useMouseInteraction';
import { useHoverDetection } from '../hooks/useHoverDetection';
import { useVisualizationEffects } from '../hooks/useVisualizationEffects';
import { resolveCameraAutoFrameLoadScopeKey } from '../utils/cameraAutoFrame';
import { isSingleDofJoint } from '@/shared/utils/jointTypes';
import {
  createRuntimeSceneLinkMetadataState,
  resolveRuntimeSceneLinkMetadataState,
} from '../utils/runtimeSceneMetadata';
import { resolveSelectedIkDragLinkId } from '../utils/selectedIkDragLink';
import { resolveViewerRobotSourceFormat } from '@/features/urdf-viewer/renderers/sourceFormat';
import { shouldEnableViewerSceneCompileWarmup } from '../utils/sceneCompileWarmupPolicy';
import { isRegressionDebugEnabled } from '@/shared/debug/regressionDebugEnabled';
import {
  setRegressionPrimaryRuntimeRobot,
  setRegressionRuntimeRobot,
} from '@/shared/debug/regressionState';

const EMPTY_ROBOT_FILES: RobotFile[] = [];
const RUNTIME_IK_ANCHOR_EPSILON_SQ = 1e-12;
const PAINTABLE_VISUAL_GEOMETRY_TYPES = new Set<GeometryType>([
  GeometryType.MESH,
  GeometryType.BOX,
  GeometryType.PLANE,
  GeometryType.SPHERE,
  GeometryType.ELLIPSOID,
  GeometryType.CYLINDER,
  GeometryType.CAPSULE,
]);
const VIEWER_READY_DOCUMENT_LOAD_EVENT = {
  status: 'ready',
  phase: 'ready',
  progressMode: null,
  progressPercent: 100,
  loadedCount: null,
  totalCount: null,
  message: null,
  error: null,
} satisfies ViewerDocumentLoadEvent;

function resolveRuntimeLinkBoundsAnchorLocal(
  linkObject: Object3D | null,
): { x: number; y: number; z: number } | null {
  if (!linkObject) {
    return null;
  }

  linkObject.updateMatrixWorld(true);
  const inverseLinkMatrix = new Matrix4().copy(linkObject.matrixWorld).invert();
  const localBounds = new Box3();
  const meshBounds = new Box3();
  let hasBounds = false;

  linkObject.traverse((object) => {
    const mesh = object as Object3D & {
      isMesh?: boolean;
      geometry?: {
        boundingBox?: Box3 | null;
        computeBoundingBox?: () => void;
      };
    };
    if (!mesh.isMesh || !mesh.geometry) {
      return;
    }

    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox?.();
    }
    if (!mesh.geometry.boundingBox) {
      return;
    }

    object.updateMatrixWorld(true);
    meshBounds
      .copy(mesh.geometry.boundingBox)
      .applyMatrix4(object.matrixWorld)
      .applyMatrix4(inverseLinkMatrix);

    if (meshBounds.isEmpty()) {
      return;
    }

    if (!hasBounds) {
      localBounds.copy(meshBounds);
      hasBounds = true;
      return;
    }

    localBounds.union(meshBounds);
  });

  if (!hasBounds || localBounds.isEmpty()) {
    return null;
  }

  const center = localBounds.getCenter(new ThreeVector3());
  if (center.lengthSq() > RUNTIME_IK_ANCHOR_EPSILON_SQ) {
    return { x: center.x, y: center.y, z: center.z };
  }

  const farthestCorner = new ThreeVector3();
  for (const x of [localBounds.min.x, localBounds.max.x]) {
    for (const y of [localBounds.min.y, localBounds.max.y]) {
      for (const z of [localBounds.min.z, localBounds.max.z]) {
        const candidate = new ThreeVector3(x, y, z);
        if (candidate.lengthSq() > farthestCorner.lengthSq()) {
          farthestCorner.copy(candidate);
        }
      }
    }
  }

  return { x: farthestCorner.x, y: farthestCorner.y, z: farthestCorner.z };
}

// Wrap with memo and custom comparison to prevent unnecessary re-renders
export const RobotModel: React.FC<RobotModelProps> = memo(
  ({
    urdfContent,
    assets,
    sourceFile,
    availableFiles = EMPTY_ROBOT_FILES,
    sourceFormat = 'auto',
    allowUrdfXmlFallback = false,
    reloadToken = 0,
    initialRobot = null,
    sourceFilePath,
    onRobotLoaded,
    onDocumentLoadEvent,
    runtimeBridge,
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
    onIkCommitKinematicOverrides,
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
    robotData,
    focusTarget,
    transformMode = 'select',
    toolMode = 'select',
    measureMode,
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
    const { gl, invalidate } = useThree();
    const snapshotRenderActive = useSnapshotRenderActive();
    const showMjcfWorldLink = useUIStore((state) => state.viewOptions.showMjcfWorldLink);
    const cameraProjection = useUIStore((state) => state.viewOptions.cameraProjection);
    const setHoverFrozen = useSelectionStore((state) => state.setHoverFrozen);
    const autoFrameScopeFallbackRef = useRef<string | null>(null);
    const [sourceSceneComponentRoot, setSourceSceneComponentRoot] = useState<Group | null>(null);
    const hasRenderedRobotRef = useRef(Boolean(initialRobot));
    const resolvedSourceFormat = useMemo(
      () => resolveViewerRobotSourceFormat(urdfContent, sourceFormat),
      [sourceFormat, urdfContent],
    );
    const sourceFileForBackend = useMemo<RobotFile>(() => {
      if (sourceFile) {
        return sourceFile;
      }

      const fallbackFormat: RobotFile['format'] =
        sourceFormat === 'mjcf'
          ? 'mjcf'
          : sourceFormat === 'sdf'
            ? 'sdf'
            : sourceFormat === 'xacro'
              ? 'xacro'
              : resolvedSourceFormat;

      return {
        name: sourceFilePath ?? `inline.${fallbackFormat}`,
        content: urdfContent,
        format: fallbackFormat,
      };
    }, [resolvedSourceFormat, sourceFile, sourceFilePath, sourceFormat, urdfContent]);
    const regressionRuntimeScopeKey =
      isRegressionDebugEnabled() && !isMeshPreview
        ? `${sourceFileForBackend.format}:${sourceFileForBackend.name}`
        : null;
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
    const autoFrameLoadScopeKey = resolveCameraAutoFrameLoadScopeKey({
      sourceFilePath,
      reloadToken,
      fallbackScopeKey: autoFrameScopeFallbackRef.current,
    });
    // Include the camera projection so switching perspective <-> orthographic
    // (which remounts the canvas and resets the camera) re-triggers auto-framing.
    // Without this, the scope key is unchanged and the post-switch perspective
    // view stays at the default (far) camera position, leaving the robot tiny.
    const autoFrameScopeKey = `${autoFrameLoadScopeKey}:proj:${cameraProjection}`;

    // Keep ref for setIsDragging to avoid stale closures
    const setIsDraggingRef = useRef(setIsDragging);
    useEffect(() => {
      setIsDraggingRef.current = setIsDragging;
    }, [setIsDragging]);
    type LinkIkHistorySnapshot = ReturnType<
      NonNullable<React.ComponentProps<typeof LinkIkTransformControls>['createHistorySnapshot']>
    >;
    type LinkIkCommitArgs = Parameters<
      NonNullable<React.ComponentProps<typeof LinkIkTransformControls>['onCommitKinematicOverrides']>
    >;
    const createIkHistorySnapshot = useCallback((): LinkIkHistorySnapshot => {
      const state = useRobotStore.getState();
      return structuredClone({
        name: state.name,
        links: state.links,
        joints: state.joints,
        rootLinkId: state.rootLinkId,
        materials: state.materials,
        closedLoopConstraints: state.closedLoopConstraints,
      });
    }, []);
    const commitIkKinematicOverrides = useCallback(
      (...args: LinkIkCommitArgs) => {
        const [overrides, historySnapshot, label] = args;
        const storeState = useRobotStore.getState();
        storeState.applyJointKinematicOverrides(overrides, {
          skipHistory: true,
        });
        onIkCommitKinematicOverrides?.(overrides.angles, overrides.quaternions);
        storeState.pushHistorySnapshot(historySnapshot, label);
      },
      [onIkCommitKinematicOverrides],
    );
    const backendRobotData = useMemo(() => {
      const backendLinks = robotData?.links ?? robotLinks;
      const backendJoints = robotData?.joints ?? robotJoints;

      if (!backendLinks || !backendJoints) {
        return null;
      }

      const storeState = useRobotStore.getState();
      const childLinkIds = new Set(Object.values(backendJoints).map((joint) => joint.childLinkId));
      const computedRootLinkId =
        robotData?.rootLinkId ||
        storeState.rootLinkId ||
        Object.keys(backendLinks).find((linkId) => !childLinkIds.has(linkId)) ||
        Object.keys(backendLinks)[0] ||
        '';

      return {
        name: robotData?.name || storeState.name || sourceFileForBackend.name,
        links: backendLinks,
        joints: backendJoints,
        rootLinkId: computedRootLinkId,
        materials: robotData?.materials ?? storeState.materials,
        closedLoopConstraints: robotData?.closedLoopConstraints ?? storeState.closedLoopConstraints,
        inspectionContext: robotData?.inspectionContext ?? storeState.inspectionContext,
      };
    }, [robotData, robotJoints, robotLinks, sourceFileForBackend.name]);
    // ============================================================
    // HOOK: Robot Loading
    // ============================================================
    const {
      robot,
      isLoading,
      loadingProgress,
      robotVersion,
      linkMeshMapRef,
      robotLinks: loadedRobotLinks,
      robotJoints: loadedRobotJoints,
      rootLinkId: loadedRootLinkId,
    } = useRendererBackend({
      sourceFile: sourceFileForBackend,
      availableFiles,
      assets,
      reloadToken,
      initialRobot,
      showCollision,
      showVisual,
      showCollisionAlwaysOnTop,
      allowUrdfXmlFallback,
      robotLinks,
      robotJoints,
      robotData: backendRobotData,
      initialJointAngles,
      onRobotLoaded,
      onDocumentLoadEvent,
      runtimeBridge,
      groundPlaneOffset,
    });
    useEffect(() => {
      if (!regressionRuntimeScopeKey) {
        return;
      }

      return () => {
        setRegressionPrimaryRuntimeRobot(null);
        setRegressionRuntimeRobot(null);
      };
    }, [regressionRuntimeScopeKey]);

    useEffect(() => {
      if (!regressionRuntimeScopeKey || !robot) {
        return;
      }

      setRegressionPrimaryRuntimeRobot(robot);
      setRegressionRuntimeRobot(robot);
    }, [regressionRuntimeScopeKey, robot]);
    useEffect(() => {
      if (!robot || isLoading) {
        return;
      }

      onDocumentLoadEvent?.(VIEWER_READY_DOCUMENT_LOAD_EVENT);
    }, [isLoading, onDocumentLoadEvent, robot]);
    useEffect(() => {
      if (robot) {
        hasRenderedRobotRef.current = true;
      }
    }, [robot]);
    const effectiveRobotLinks = useMemo(
      () => (Object.keys(loadedRobotLinks).length > 0 ? loadedRobotLinks : robotLinks),
      [loadedRobotLinks, robotLinks],
    );
    const effectiveRobotJoints = useMemo(
      () => (Object.keys(loadedRobotJoints).length > 0 ? loadedRobotJoints : robotJoints),
      [loadedRobotJoints, robotJoints],
    );

    // Keep scene metadata pinned to the currently mounted runtime robot while a
    // different source file is still streaming in. This prevents the old scene
    // from briefly inheriting the next file's visibility rules and helper state.
    runtimeSceneLinkMetadataRef.current = resolveRuntimeSceneLinkMetadataState(
      runtimeSceneLinkMetadataRef.current,
      {
        scopeKey: runtimeSceneMetadataScopeKey,
        robot,
        robotVersion,
        robotLinks: effectiveRobotLinks,
      },
    );
    const runtimeRobotLinks = runtimeSceneLinkMetadataRef.current.robotLinks;
    const runtimeRobotRootLinkId = useMemo(() => {
      if (loadedRootLinkId) {
        return loadedRootLinkId;
      }
      const links = runtimeRobotLinks ?? {};
      const joints = effectiveRobotJoints ?? {};
      const linkIds = Object.keys(links);

      if (linkIds.length === 0) {
        return null;
      }

      const childLinkIds = new Set(Object.values(joints).map((joint) => joint.childLinkId));
      return linkIds.find((linkId) => !childLinkIds.has(linkId)) ?? linkIds[0] ?? null;
    }, [effectiveRobotJoints, loadedRootLinkId, runtimeRobotLinks]);
    const selectedIkHandleLinkId = useMemo(
      () =>
        resolveSelectedIkDragLinkId({
          selection,
          ikDragActive,
          robotLinks: runtimeRobotLinks,
          robotJoints: effectiveRobotJoints,
          rootLinkId: runtimeRobotRootLinkId,
        }),
      [effectiveRobotJoints, ikDragActive, runtimeRobotLinks, runtimeRobotRootLinkId, selection],
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
        !effectiveRobotJoints
      ) {
        return null;
      }

      return resolveLinkIkHandleDescriptor(
        {
          links: runtimeRobotLinks,
          joints: effectiveRobotJoints,
          rootLinkId: runtimeRobotRootLinkId,
        },
        selectedIkHandleLinkId,
      );
    }, [effectiveRobotJoints, runtimeRobotLinks, runtimeRobotRootLinkId, selectedIkHandleLinkId]);
    const selectedDirectIkJointIds = useMemo(() => {
      if (
        !selectedIkHandleLinkId ||
        !runtimeRobotRootLinkId ||
        !runtimeRobotLinks ||
        !effectiveRobotJoints
      ) {
        return null;
      }

      return resolveDirectManipulableLinkIkJointIds(
        {
          links: runtimeRobotLinks,
          joints: effectiveRobotJoints,
          rootLinkId: runtimeRobotRootLinkId,
        },
        selectedIkHandleLinkId,
      );
    }, [effectiveRobotJoints, runtimeRobotLinks, runtimeRobotRootLinkId, selectedIkHandleLinkId]);
    const selectedDirectIkHandleDescriptor = useMemo(() => {
      if (
        !selectedIkHandleLinkId ||
        !runtimeRobotRootLinkId ||
        !runtimeRobotLinks ||
        !effectiveRobotJoints
      ) {
        return null;
      }

      return resolveDirectManipulableLinkIkDescriptor(
        {
          links: runtimeRobotLinks,
          joints: effectiveRobotJoints,
          rootLinkId: runtimeRobotRootLinkId,
        },
        selectedIkHandleLinkId,
      );
    }, [effectiveRobotJoints, runtimeRobotLinks, runtimeRobotRootLinkId, selectedIkHandleLinkId]);
    const selectedIkHandleDescriptor =
      selectedDirectIkHandleDescriptor ?? selectedPassiveIkHandleDescriptor;
    const selectedRuntimeIkAnchorLocal = useMemo(
      () => resolveRuntimeLinkBoundsAnchorLocal(selectedIkRuntimeLink),
      [robotVersion, selectedIkHandleLinkId, selectedIkRuntimeLink],
    );
    const selectedIkAnchorLocal =
      selectedIkHandleDescriptor?.anchorLocal ?? selectedRuntimeIkAnchorLocal;
    const selectedIkJointIds = selectedIkHandleDescriptor?.jointIds ?? selectedDirectIkJointIds;
    const selectedJointEntry = useMemo(() => {
      if (!robot || selection?.type !== 'joint' || !selection.id) {
        return null;
      }

      const runtimeJoints = (robot as Object3D & { joints?: Record<string, any> }).joints;
      const jointKey = resolveViewerJointKey(runtimeJoints, selection.id);
      if (!jointKey) {
        return null;
      }

      const joint = runtimeJoints?.[jointKey] ?? null;
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
        runtimeRobotRootLinkId && runtimeRobotLinks && effectiveRobotJoints
          ? {
              links: runtimeRobotLinks,
              joints: effectiveRobotJoints,
              rootLinkId: runtimeRobotRootLinkId,
              closedLoopConstraints: [],
            }
          : null,
      [effectiveRobotJoints, runtimeRobotLinks, runtimeRobotRootLinkId],
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
      autoFrameScopeKey,
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

        const link = effectiveRobotLinks?.[linkId];
        const visualGeometry = link
          ? getVisualGeometryByObjectIndex(link, objectIndex)?.geometry
          : null;
        if (
          !link ||
          !visualGeometry ||
          !PAINTABLE_VISUAL_GEOMETRY_TYPES.has(visualGeometry.type)
        ) {
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
          colorRgba: resolvedMaterial.colorRgba ?? undefined,
          opacity: resolvedMaterial.opacity ?? undefined,
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
          color: undefined,
        });
        if (onUpdate) {
          onUpdate('link', link.id, nextLink);
        } else {
          useRobotStore.getState().updateLink(link.id, nextLink, {
            label: paintOperation === 'erase' ? 'Erase painted mesh faces' : 'Paint mesh faces',
          });
        }
        onPaintStatusChange?.({
          tone: 'success',
          message: paintOperation === 'erase' ? t.paintStatusRemoved : t.paintStatusApplied,
        });
      },
      [
        isMeshPreview,
        onPaintStatusChange,
        onUpdate,
        paintColor,
        paintOperation,
        paintSelectionScope,
        effectiveRobotLinks,
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
        measureMode,
        mode,
        showCollision,
        showVisual,
        showCollisionAlwaysOnTop,
        interactionLayerPriority,
        linkMeshMapRef,
        robotLinks: runtimeRobotLinks,
        robotJoints: effectiveRobotJoints,
        onHover,
        onSelect,
        onMeshSelect,
        onPaintFace: handlePaintFace,
        onJointChange,
        onJointChangeCommit,
        throttleJointChangeDuringDrag: true,
        deferDirectJointRuntimeUpdate: Boolean(ikRobotState?.closedLoopConstraints?.length),
        setIsDragging,
        setHoverFrozen,
        setActiveJoint,
        justSelectedRef,
        isOrbitDragging,
        isSelectionLockedRef,
        selection,
        rayIntersectsBoundingBox,
        highlightGeometry,
        resolveDirectIkHandleLink:
          ikDragActive && runtimeRobotRootLinkId && runtimeRobotLinks && effectiveRobotJoints
            ? (linkId) =>
                resolveDirectManipulableLinkIkJointIds(
                  {
                    links: runtimeRobotLinks,
                    joints: effectiveRobotJoints,
                    rootLinkId: runtimeRobotRootLinkId,
                  },
                  linkId,
                )?.length
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
      robotJoints: effectiveRobotJoints,
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
      robotMaterials: backendRobotData?.materials,
      robotJoints: effectiveRobotJoints,
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

    // Default to a dirty-only matrixWorld walk (force=false). All upstream
    // mutation paths (setJointValue, transform writes) already flag the dirty
    // chain, so the non-forced walk only touches changed subtrees instead of
    // the entire merged scene graph. In multi-component assemblies the old
    // force=true path was an every-frame O(N×L) sweep that dominated drag
    // latency; force=false reduces it to O(touched joints). needsRaycastRef
    // and boundingBoxNeedsUpdateRef defer the authoritative recompute to the
    // next consumer that actually needs world coords, and R3F's render still
    // calls updateMatrixWorld() before drawing, so visuals stay current.
    // Callers that *must* see fully-resolved world matrices synchronously
    // (one-shot transform commits, load handoffs) can pass {force: true}.
    const requestSceneRefresh = useCallback(
      (options?: { force?: boolean }) => {
        if (!robot) {
          return;
        }

        robot.updateMatrixWorld(options?.force ?? false);
        boundingBoxNeedsUpdateRef.current = true;
        needsRaycastRef.current = true;
        requestShadowMapRefresh(gl);
        invalidate();
      },
      [boundingBoxNeedsUpdateRef, gl, invalidate, needsRaycastRef, robot],
    );

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
    const shouldShowLoadingHud = isLoading && !robot && !hasRenderedRobotRef.current;
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
        {shouldShowLoadingHud ? (
          <ViewerLoadingHudOverlay
            title={t.loadingRobot}
            detail={loadingDetail}
            progress={loadingHudState.progress}
            progressMode={loadingHudState.progressMode}
            statusLabel={loadingHudState.statusLabel}
            stageLabel={loadingStageLabel}
            delayMs={0}
          />
        ) : null}
        {!snapshotRenderActive && robot && toolMode !== 'measure' && (
          <LinkIkTransformControls
            selectedLinkId={selectedIkHandleLinkId}
            selectedHandle={selectedIkHandle}
            selectedLinkObject={selectedIkRuntimeLink}
            selectedAnchorLocal={selectedIkAnchorLocal ?? null}
            coordinateRoot={robot}
            ikRobotState={ikRobotState}
            enabled={
              active &&
              Boolean(selectedIkJointIds?.length) &&
              Boolean(selectedIkHandle || (selectedIkRuntimeLink && selectedIkAnchorLocal))
            }
            historyLabel="Move IK handle"
            setIsDragging={setIsDragging}
            createHistorySnapshot={createIkHistorySnapshot}
            onPreviewKinematicOverrides={(overrides) =>
              onIkPreviewKinematicOverrides?.(overrides.angles, overrides.quaternions)
            }
            onCommitKinematicOverrides={commitIkKinematicOverrides}
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
            robotJoints={effectiveRobotJoints}
            closedLoopRobotState={ikRobotState}
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
              joints: effectiveRobotJoints ?? {},
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
