import React from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import type { AppMode, AssemblyState, AssemblyTransform, RobotState, UrdfJoint } from '@/types';
import { cloneAssemblyTransform } from '@/core/robot/assemblyTransforms';
import { translations } from '@/shared/i18n';
import type { Language } from '@/shared/i18n';
import type { ViewerHelperKind } from '@/features/urdf-viewer';
import {
  LinkIkTransformControls,
  LoadingHud,
  SceneCompileWarmup,
  UnifiedTransformControls,
  VISUALIZER_UNIFIED_GIZMO_SIZE,
  buildLoadingHudState,
} from '@/shared/components/3d';
import { buildColladaRootNormalizationHints } from '@/core/loaders/colladaRootNormalization';
import { resolveLinkIkHandleDescriptor } from '@/core/robot';
import type { UpdateCommitOptions } from '@/types/viewer';
import { useAssemblyStore, useUIStore } from '@/store';
import { useSelectionStore } from '@/store/selectionStore';
import { RobotNode } from './nodes';
import { ClosedLoopConstraintsOverlay } from './constraints';
import { AssemblyTransformControls, JointTransformControls } from './controls';
import { VisualizerHoverController } from './VisualizerHoverController';
import type { VisualizerController } from '../hooks/useVisualizerController';
import {
  buildAssemblyAutoGroundMeshSignatureMap,
  createInitialAssemblyAutoGroundTrackingState,
  resolveAssemblyAutoGrounding,
  resolveReadyAssemblyAutoGroundComponentIds,
  resolveNextAssemblyAutoGroundTrackingState,
} from '../utils/assemblyAutoGrounding';
import { buildAssemblyComponentLinkOwnerMap } from '../utils/assemblyMeshLoadState';
import { shouldRenderMergedVisualizerConstraintOverlay } from '../utils/mergedVisualizerSceneMode';
import { resolveMergedVisualizerRootPlacements } from '../utils/mergedVisualizerLayout';
import {
  mergeResolvedMeshLoadKeys,
  reconcileResolvedMeshLoadKeys,
} from '../utils/meshResolutionState';
import { collectVisualizerMeshLoadKeys } from '../utils/visualizerMeshLoading';
import { buildVisualizerDocumentLoadEvent } from '../utils/visualizerDocumentLoad';
import type { AssemblySelection } from '@/store/assemblySelectionStore';
import { useCollisionMeshPrewarm } from '../hooks/useCollisionMeshPrewarm';
import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import { applyMjcfWorldVisibility } from '@/shared/utils/robot/mjcfWorldVisibility';

const GroundedGroup = React.forwardRef<THREE.Group, { children: React.ReactNode }>(
  function GroundedGroup({ children }, ref) {
    return <group ref={ref}>{children}</group>;
  },
);

interface VisualizerSceneProps {
  robot: RobotState;
  onSelect: (
    type: 'link' | 'joint',
    id: string,
    subType?: 'visual' | 'collision',
    helperKind?: ViewerHelperKind,
  ) => void;
  onUpdate: (type: 'link' | 'joint', id: string, data: any) => void;
  mode: AppMode;
  assets: Record<string, string>;
  lang: Language;
  controller: VisualizerController;
  active?: boolean;
  assemblyState?: AssemblyState | null;
  assemblyWorkspaceActive?: boolean;
  assemblySelection?: AssemblySelection;
  sourceSceneAssemblyComponentId?: string | null;
  sourceSceneAssemblyComponentTransform?: AssemblyTransform | null;
  onAssemblyTransform?: (transform: {
    position: { x: number; y: number; z: number };
    rotation: { r: number; p: number; y: number };
  }) => void;
  onComponentTransform?: (
    componentId: string,
    transform: {
      position: { x: number; y: number; z: number };
      rotation: { r: number; p: number; y: number };
    },
    options?: UpdateCommitOptions,
  ) => void;
  onBridgeTransform?: (
    bridgeId: string,
    origin: {
      xyz: { x: number; y: number; z: number };
      rpy: { r: number; p: number; y: number };
      quatXyzw?: { x: number; y: number; z: number; w: number };
    },
  ) => void;
  onSourceSceneComponentTransform?: (
    componentId: string,
    transform: {
      position: { x: number; y: number; z: number };
      rotation: { r: number; p: number; y: number };
    },
    options?: UpdateCommitOptions,
  ) => void;
  onTransformPendingChange?: (pending: boolean) => void;
  onDocumentLoadEvent?: (event: {
    status: 'loading' | 'ready' | 'error';
    phase?: string | null;
    message?: string | null;
    progressPercent?: number | null;
    loadedCount?: number | null;
    totalCount?: number | null;
    error?: string | null;
  }) => void;
}

export const VisualizerScene = React.memo(
  ({
    robot,
    onSelect,
    onUpdate,
    mode,
    assets,
    lang,
    controller,
    active = true,
    assemblyState = null,
    assemblyWorkspaceActive = false,
    assemblySelection,
    sourceSceneAssemblyComponentId = null,
    sourceSceneAssemblyComponentTransform = null,
    onAssemblyTransform,
    onComponentTransform,
    onBridgeTransform,
    onSourceSceneComponentTransform,
    onTransformPendingChange,
    onDocumentLoadEvent,
  }: VisualizerSceneProps) => {
    const t = translations[lang];
    const snapshotRenderActive = useSnapshotRenderActive();
    const pendingAutoGroundComponentIds = useAssemblyStore(
      (storeState) => storeState.pendingAutoGroundComponentIds,
    );
    const consumePendingAutoGroundComponentIds = useAssemblyStore(
      (storeState) => storeState.consumePendingAutoGroundComponentIds,
    );
    const groundPlaneOffset = useUIStore((state) => state.groundPlaneOffset);
    const showMjcfWorldLink = useUIStore((state) => state.viewOptions.showMjcfWorldLink);
    const hoveredSelection = useSelectionStore((state) =>
      state.hoverFrozen ? state.deferredHoveredSelection : state.hoveredSelection,
    );
    const setHoverFrozen = useSelectionStore((state) => state.setHoverFrozen);
    const collisionTransformControlRef = React.useRef<any>(null);
    const linkIkHandleObjectsRef = React.useRef(new Map<string, THREE.Object3D>());
    const [linkIkHandleVersion, setLinkIkHandleVersion] = React.useState(0);
    const [assemblyRootObject, setAssemblyRootObject] = React.useState<THREE.Group | null>(null);
    const [sourceSceneComponentRootObject, setSourceSceneComponentRootObject] =
      React.useState<THREE.Group | null>(null);
    const assemblyAutoGroundTrackingRef = React.useRef(
      createInitialAssemblyAutoGroundTrackingState(),
    );
    const {
      robotRootRef,
      state,
      jointPivots,
      selectedJointPivot,
      selectedJointMotion,
      selectedCollisionRef,
      handleRegisterJointPivot,
      handleRegisterJointMotion,
      handleRegisterCollisionRef,
      transformControlsState,
      handleCollisionTransformEnd,
      requestGroundRealignment,
    } = controller;
    const displayRobot = React.useMemo(
      () => applyMjcfWorldVisibility(robot, showMjcfWorldLink),
      [robot, showMjcfWorldLink],
    );
    const childJointsByParent = React.useMemo<Record<string, UrdfJoint[]>>(() => {
      const grouped: Record<string, UrdfJoint[]> = {};

      Object.values(displayRobot.joints).forEach((joint) => {
        if (!grouped[joint.parentLinkId]) {
          grouped[joint.parentLinkId] = [];
        }

        grouped[joint.parentLinkId].push(joint);
      });

      return grouped;
    }, [displayRobot.joints]);
    const rootPlacements = React.useMemo(
      () => resolveMergedVisualizerRootPlacements(displayRobot),
      [displayRobot.joints, displayRobot.links, displayRobot.rootLinkId],
    );
    const colladaRootNormalizationHints = React.useMemo(
      () => buildColladaRootNormalizationHints(displayRobot.links),
      [displayRobot.links],
    );
    const expectedMeshLoadKeys = React.useMemo(
      () =>
        collectVisualizerMeshLoadKeys({
          robot: displayRobot,
          mode,
          showGeometry: state.showGeometry,
          showCollision: state.showCollision,
          assets,
        }),
      [assets, displayRobot, mode, state.showCollision, state.showGeometry],
    );
    const expectedMeshLoadSignature = React.useMemo(
      () => expectedMeshLoadKeys.join('\u0000'),
      [expectedMeshLoadKeys],
    );
    const expectedMeshLoadKeySet = React.useMemo(
      () => new Set(expectedMeshLoadKeys),
      [expectedMeshLoadKeys],
    );
    const assemblyAutoGroundMeshSignatureMap = React.useMemo(
      () =>
        buildAssemblyAutoGroundMeshSignatureMap({
          assemblyState,
          meshLoadKeys: expectedMeshLoadKeys,
        }),
      [assemblyState, expectedMeshLoadKeys],
    );
    const collisionRevealComponentIdByLinkId = React.useMemo(
      () => buildAssemblyComponentLinkOwnerMap(assemblyState),
      [assemblyState],
    );
    const prioritizedCollisionComponentIds = React.useMemo(
      () => [
        assemblySelection?.type === 'component' ? assemblySelection.id : null,
        sourceSceneAssemblyComponentId,
      ],
      [assemblySelection?.id, assemblySelection?.type, sourceSceneAssemblyComponentId],
    );
    const {
      meshLoadKeys: prewarmedCollisionMeshLoadKeys,
      signature: prewarmedCollisionMeshLoadSignature,
    } = useCollisionMeshPrewarm({
      active,
      assets,
      hoveredLinkId: hoveredSelection.type === 'link' ? hoveredSelection.id : null,
      prioritizedComponentIds: prioritizedCollisionComponentIds,
      robot,
      rootLinkId: robot.rootLinkId,
      selectedLinkId: robot.selection.type === 'link' ? robot.selection.id : null,
      visibleComponentIdByLinkId: collisionRevealComponentIdByLinkId,
    });
    const [meshLoadingState, setMeshLoadingState] = React.useState<{
      signature: string;
      resolvedKeys: Set<string>;
    }>({
      signature: expectedMeshLoadSignature,
      resolvedKeys: new Set<string>(),
    });
    const [prewarmedMeshLoadingState, setPrewarmedMeshLoadingState] = React.useState<{
      signature: string;
      resolvedKeys: Set<string>;
    }>({
      signature: prewarmedCollisionMeshLoadSignature,
      resolvedKeys: new Set<string>(),
    });
    const pendingResolvedMeshLoadKeysRef = React.useRef<Set<string>>(new Set<string>());
    const pendingPrewarmedResolvedMeshLoadKeysRef = React.useRef<Set<string>>(new Set<string>());
    const meshResolutionFlushFrameRef = React.useRef<number | null>(null);
    const effectiveResolvedMeshLoadKeys = React.useMemo(() => {
      const nextResolvedKeys = new Set<string>();

      if (meshLoadingState.signature === expectedMeshLoadSignature) {
        meshLoadingState.resolvedKeys.forEach((meshLoadKey) => {
          if (expectedMeshLoadKeySet.has(meshLoadKey)) {
            nextResolvedKeys.add(meshLoadKey);
          }
        });
      }

      if (prewarmedMeshLoadingState.signature === prewarmedCollisionMeshLoadSignature) {
        prewarmedMeshLoadingState.resolvedKeys.forEach((meshLoadKey) => {
          if (expectedMeshLoadKeySet.has(meshLoadKey)) {
            nextResolvedKeys.add(meshLoadKey);
          }
        });
      }

      return nextResolvedKeys;
    }, [
      expectedMeshLoadKeySet,
      expectedMeshLoadSignature,
      meshLoadingState.resolvedKeys,
      meshLoadingState.signature,
      prewarmedCollisionMeshLoadSignature,
      prewarmedMeshLoadingState.resolvedKeys,
      prewarmedMeshLoadingState.signature,
    ]);
    const resolvedMeshCount = effectiveResolvedMeshLoadKeys.size;
    const isMeshLoading =
      expectedMeshLoadKeys.length > 0 && resolvedMeshCount < expectedMeshLoadKeys.length;
    const readyCollisionMeshLoadKeys = React.useMemo(
      () =>
        assemblyWorkspaceActive && state.showCollision ? effectiveResolvedMeshLoadKeys : undefined,
      [assemblyWorkspaceActive, effectiveResolvedMeshLoadKeys, state.showCollision],
    );
    const loadingHudState = React.useMemo(
      () =>
        buildLoadingHudState({
          phase: resolvedMeshCount === 0 ? 'preparing-scene' : 'streaming-meshes',
          progressMode: resolvedMeshCount === 0 ? 'indeterminate' : 'count',
          loadedCount: resolvedMeshCount,
          totalCount: expectedMeshLoadKeys.length,
          fallbackDetail: t.loadingRobotPreparing,
        }),
      [expectedMeshLoadKeys.length, resolvedMeshCount, t.loadingRobotPreparing],
    );
    const loadingStageLabel =
      resolvedMeshCount === 0 ? t.loadingRobotPreparing : t.loadingRobotStreamingMeshes;
    const loadingDetail =
      loadingHudState.detail === loadingStageLabel ? '' : loadingHudState.detail;
    const sceneCompileWarmupKey = React.useMemo(
      () =>
        [
          mode,
          displayRobot.rootLinkId,
          String(Object.keys(displayRobot.links).length),
          String(Object.keys(displayRobot.joints).length),
          expectedMeshLoadSignature || 'inline-geometry',
          state.showGeometry ? 'geometry-on' : 'geometry-off',
          state.showVisual ? 'visual-on' : 'visual-off',
          state.showCollision ? 'collision-on' : 'collision-off',
        ].join('|'),
      [
        displayRobot.joints,
        displayRobot.links,
        displayRobot.rootLinkId,
        expectedMeshLoadSignature,
        mode,
        state.showCollision,
        state.showGeometry,
        state.showVisual,
      ],
    );

    React.useEffect(() => {
      pendingResolvedMeshLoadKeysRef.current.clear();
      pendingPrewarmedResolvedMeshLoadKeysRef.current.clear();
      if (meshResolutionFlushFrameRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(meshResolutionFlushFrameRef.current);
        meshResolutionFlushFrameRef.current = null;
      }
      setMeshLoadingState((current) =>
        reconcileResolvedMeshLoadKeys({
          currentResolvedKeys: current.resolvedKeys,
          expectedMeshLoadKeySet,
          expectedSignature: expectedMeshLoadSignature,
        }),
      );
    }, [expectedMeshLoadKeySet, expectedMeshLoadSignature]);

    React.useEffect(() => {
      pendingPrewarmedResolvedMeshLoadKeysRef.current.clear();
      setPrewarmedMeshLoadingState((current) =>
        reconcileResolvedMeshLoadKeys({
          currentResolvedKeys: current.resolvedKeys,
          expectedMeshLoadKeySet: prewarmedCollisionMeshLoadKeys,
          expectedSignature: prewarmedCollisionMeshLoadSignature,
        }),
      );
    }, [prewarmedCollisionMeshLoadKeys, prewarmedCollisionMeshLoadSignature]);

    React.useEffect(() => {
      return () => {
        pendingResolvedMeshLoadKeysRef.current.clear();
        pendingPrewarmedResolvedMeshLoadKeysRef.current.clear();
        if (meshResolutionFlushFrameRef.current !== null && typeof window !== 'undefined') {
          window.cancelAnimationFrame(meshResolutionFlushFrameRef.current);
          meshResolutionFlushFrameRef.current = null;
        }
      };
    }, []);

    React.useEffect(() => {
      if (!active || !onDocumentLoadEvent) {
        return;
      }

      onDocumentLoadEvent(
        buildVisualizerDocumentLoadEvent({
          resolvedCount: resolvedMeshCount,
          totalCount: expectedMeshLoadKeys.length,
        }),
      );
    }, [active, expectedMeshLoadKeys.length, onDocumentLoadEvent, resolvedMeshCount]);

    const handleCollisionDraggingChanged = React.useCallback(
      (event: { value?: boolean }) => {
        const dragging = Boolean(event?.value);
        setHoverFrozen(dragging);
        if (dragging) return;
        handleCollisionTransformEnd();
      },
      [handleCollisionTransformEnd, setHoverFrozen],
    );

    const flushResolvedMeshLoadKeys = React.useCallback(() => {
      meshResolutionFlushFrameRef.current = null;

      const pendingResolvedMeshLoadKeys = pendingResolvedMeshLoadKeysRef.current;
      const pendingPrewarmedResolvedMeshLoadKeys = pendingPrewarmedResolvedMeshLoadKeysRef.current;
      if (
        pendingResolvedMeshLoadKeys.size === 0 &&
        pendingPrewarmedResolvedMeshLoadKeys.size === 0
      ) {
        return;
      }

      pendingResolvedMeshLoadKeysRef.current = new Set<string>();
      pendingPrewarmedResolvedMeshLoadKeysRef.current = new Set<string>();
      requestGroundRealignment();

      React.startTransition(() => {
        if (pendingResolvedMeshLoadKeys.size > 0) {
          setMeshLoadingState((current) => {
            const nextState = mergeResolvedMeshLoadKeys({
              currentResolvedKeys: current.resolvedKeys,
              currentSignature: current.signature,
              expectedMeshLoadKeySet,
              expectedSignature: expectedMeshLoadSignature,
              pendingResolvedKeys: pendingResolvedMeshLoadKeys,
            });

            return nextState ?? current;
          });
        }
        if (pendingPrewarmedResolvedMeshLoadKeys.size > 0) {
          setPrewarmedMeshLoadingState((current) => {
            const nextState = mergeResolvedMeshLoadKeys({
              currentResolvedKeys: current.resolvedKeys,
              currentSignature: current.signature,
              expectedMeshLoadKeySet: prewarmedCollisionMeshLoadKeys,
              expectedSignature: prewarmedCollisionMeshLoadSignature,
              pendingResolvedKeys: pendingPrewarmedResolvedMeshLoadKeys,
            });

            return nextState ?? current;
          });
        }
      });
    }, [
      expectedMeshLoadKeySet,
      expectedMeshLoadSignature,
      prewarmedCollisionMeshLoadKeys,
      prewarmedCollisionMeshLoadSignature,
      requestGroundRealignment,
    ]);

    const handleMeshResolved = React.useCallback(
      (meshLoadKey: string) => {
        if (!expectedMeshLoadKeySet.has(meshLoadKey)) {
          return;
        }

        pendingResolvedMeshLoadKeysRef.current.add(meshLoadKey);
        if (meshResolutionFlushFrameRef.current !== null) {
          return;
        }

        if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
          flushResolvedMeshLoadKeys();
          return;
        }

        meshResolutionFlushFrameRef.current = window.requestAnimationFrame(() => {
          flushResolvedMeshLoadKeys();
        });
      },
      [expectedMeshLoadKeySet, flushResolvedMeshLoadKeys],
    );

    const handlePrewarmedMeshResolved = React.useCallback(
      (meshLoadKey: string) => {
        if (!prewarmedCollisionMeshLoadKeys.has(meshLoadKey)) {
          return;
        }

        pendingPrewarmedResolvedMeshLoadKeysRef.current.add(meshLoadKey);
        if (meshResolutionFlushFrameRef.current !== null) {
          return;
        }

        if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
          flushResolvedMeshLoadKeys();
          return;
        }

        meshResolutionFlushFrameRef.current = window.requestAnimationFrame(() => {
          flushResolvedMeshLoadKeys();
        });
      },
      [flushResolvedMeshLoadKeys, prewarmedCollisionMeshLoadKeys],
    );

    React.useEffect(() => {
      const nextTrackingState = resolveNextAssemblyAutoGroundTrackingState({
        previousState: assemblyAutoGroundTrackingRef.current,
        assemblyState,
      });

      nextTrackingState.settledMeshSignatureByComponentId.forEach(
        (settledMeshSignature, componentId) => {
          const currentMeshSignature = assemblyAutoGroundMeshSignatureMap.get(componentId);
          if (currentMeshSignature !== undefined && currentMeshSignature !== settledMeshSignature) {
            nextTrackingState.settledMeshSignatureByComponentId.delete(componentId);
            nextTrackingState.pendingComponentIds.add(componentId);
          }
        },
      );

      if (assemblyState) {
        pendingAutoGroundComponentIds.forEach((componentId) => {
          if (!assemblyState.components[componentId]) {
            return;
          }

          nextTrackingState.pendingComponentIds.add(componentId);
          nextTrackingState.settledMeshSignatureByComponentId.delete(componentId);
        });
      }

      assemblyAutoGroundTrackingRef.current = nextTrackingState;
    }, [assemblyAutoGroundMeshSignatureMap, assemblyState, pendingAutoGroundComponentIds]);

    React.useEffect(() => {
      if (!assemblyWorkspaceActive || !assemblyState || !onComponentTransform) {
        return;
      }

      const trackingState = assemblyAutoGroundTrackingRef.current;
      if (trackingState.pendingComponentIds.size === 0) {
        return;
      }

      const readyComponentIds = resolveReadyAssemblyAutoGroundComponentIds({
        assemblyState,
        pendingComponentIds: trackingState.pendingComponentIds,
        expectedMeshLoadKeys,
        resolvedMeshLoadKeys: effectiveResolvedMeshLoadKeys,
      });
      if (readyComponentIds.length === 0) {
        return;
      }

      const { adjustments, measuredComponentIds } = resolveAssemblyAutoGrounding({
        robot,
        assemblyState,
        jointPivots,
        groundPlaneOffset,
        componentIds: readyComponentIds,
      });
      if (measuredComponentIds.length === 0) {
        return;
      }

      measuredComponentIds.forEach((componentId) => {
        trackingState.pendingComponentIds.delete(componentId);
        trackingState.settledMeshSignatureByComponentId.set(
          componentId,
          assemblyAutoGroundMeshSignatureMap.get(componentId) ?? '',
        );
      });
      consumePendingAutoGroundComponentIds(measuredComponentIds);
      adjustments.forEach(({ componentId, transform }) => {
        onComponentTransform(componentId, transform, {
          skipHistory: true,
        });
      });
    }, [
      assemblyState,
      assemblyAutoGroundMeshSignatureMap,
      assemblyWorkspaceActive,
      effectiveResolvedMeshLoadKeys,
      expectedMeshLoadKeys,
      groundPlaneOffset,
      jointPivots,
      onComponentTransform,
      consumePendingAutoGroundComponentIds,
      robot,
    ]);
    const shouldRenderConstraintOverlay = shouldRenderMergedVisualizerConstraintOverlay(mode);
    const sourceSceneAssemblyComponent = React.useMemo(() => {
      if (!sourceSceneAssemblyComponentId || !assemblyState) {
        return null;
      }

      const component = assemblyState.components[sourceSceneAssemblyComponentId];
      if (!component || component.visible === false) {
        return null;
      }

      return component;
    }, [assemblyState, sourceSceneAssemblyComponentId]);
    const assemblyTransform = React.useMemo(
      () => cloneAssemblyTransform(assemblyWorkspaceActive ? assemblyState?.transform : null),
      [assemblyState?.transform, assemblyWorkspaceActive],
    );
    const sourceSceneComponentTransform = React.useMemo(
      () =>
        cloneAssemblyTransform(
          sourceSceneAssemblyComponentTransform ?? sourceSceneAssemblyComponent?.transform,
        ),
      [sourceSceneAssemblyComponent?.transform, sourceSceneAssemblyComponentTransform],
    );
    const showSourceSceneAssemblyComponentControls = Boolean(
      sourceSceneAssemblyComponent &&
      assemblySelection?.type === 'component' &&
      assemblySelection.id === sourceSceneAssemblyComponent.id,
    );
    const shouldRenderAssemblyTransformControls =
      assemblyWorkspaceActive || showSourceSceneAssemblyComponentControls;
    const handleAssemblyRootRef = React.useCallback((node: THREE.Group | null) => {
      setAssemblyRootObject((current) => (current === node ? current : node));
    }, []);
    const handleSourceSceneComponentRootRef = React.useCallback((node: THREE.Group | null) => {
      setSourceSceneComponentRootObject((current) => (current === node ? current : node));
    }, []);
    const handleRegisterIkHandle = React.useCallback(
      (linkId: string, handle: THREE.Object3D | null) => {
        const current = linkIkHandleObjectsRef.current.get(linkId) ?? null;
        if (current === handle) {
          return;
        }

        if (handle) {
          linkIkHandleObjectsRef.current.set(linkId, handle);
        } else {
          linkIkHandleObjectsRef.current.delete(linkId);
        }

        setLinkIkHandleVersion((value) => value + 1);
      },
      [],
    );
    const selectedIkHandleLinkId =
      robot.selection.type === 'link' && robot.selection.helperKind === 'ik-handle'
        ? robot.selection.id
        : null;
    const selectedIkHandle = React.useMemo(() => {
      if (!selectedIkHandleLinkId) {
        return null;
      }

      return linkIkHandleObjectsRef.current.get(selectedIkHandleLinkId) ?? null;
    }, [linkIkHandleVersion, selectedIkHandleLinkId]);
    const selectedIkHandleDescriptor = React.useMemo(
      () =>
        selectedIkHandleLinkId
          ? resolveLinkIkHandleDescriptor(displayRobot, selectedIkHandleLinkId)
          : null,
      [displayRobot, selectedIkHandleLinkId],
    );
    const selectedIkCoordinateRoot = React.useMemo(() => {
      let current: THREE.Object3D | null = selectedIkHandle;

      while (current) {
        if (current.userData?.visualizerIkCoordinateRoot === true) {
          return current;
        }
        current = current.parent;
      }

      return null;
    }, [selectedIkHandle]);

    return (
      <>
        <SceneCompileWarmup active={active && !isMeshLoading} warmupKey={sceneCompileWarmupKey} />
        <VisualizerHoverController
          robotRootRef={robotRootRef}
          interactionLayerPriority={state.interactionLayerPriority}
          active={active}
        />
        <group
          ref={handleAssemblyRootRef}
          position={[
            assemblyTransform.position.x,
            assemblyTransform.position.y,
            assemblyTransform.position.z,
          ]}
          rotation={[
            assemblyTransform.rotation.r,
            assemblyTransform.rotation.p,
            assemblyTransform.rotation.y,
          ]}
        >
          <group
            ref={handleSourceSceneComponentRootRef}
            position={[
              sourceSceneComponentTransform.position.x,
              sourceSceneComponentTransform.position.y,
              sourceSceneComponentTransform.position.z,
            ]}
            rotation={[
              sourceSceneComponentTransform.rotation.r,
              sourceSceneComponentTransform.rotation.p,
              sourceSceneComponentTransform.rotation.y,
            ]}
          >
            <GroundedGroup ref={robotRootRef}>
              {shouldRenderConstraintOverlay && (
                <ClosedLoopConstraintsOverlay robot={displayRobot} />
              )}
              {rootPlacements.map(({ linkId, position }) => (
                <group
                  key={linkId}
                  position={position}
                  userData={{
                    visualizerIkCoordinateRoot: true,
                    visualizerRootLinkId: linkId,
                  }}
                >
                  <RobotNode
                    linkId={linkId}
                    robot={displayRobot}
                    onSelect={onSelect}
                    onUpdate={onUpdate}
                    mode={mode}
                    showGeometry={state.showGeometry}
                    showVisual={state.showVisual}
                    showIkHandles={state.showIkHandles}
                    showOrigin={state.showOrigin}
                    showLabels={state.showLabels}
                    showJointAxes={state.showJointAxes}
                    jointAxisSize={state.jointAxisSize}
                    frameSize={state.frameSize}
                    labelScale={state.labelScale}
                    showCollision={state.showCollision}
                    modelOpacity={state.modelOpacity}
                    showInertia={state.showInertia}
                    showCenterOfMass={state.showCenterOfMass}
                    interactionLayerPriority={state.interactionLayerPriority}
                    transformMode={state.transformMode}
                    depth={0}
                    assets={assets}
                    lang={lang}
                    colladaRootNormalizationHints={colladaRootNormalizationHints}
                    collisionRevealComponentIdByLinkId={collisionRevealComponentIdByLinkId}
                    prewarmedCollisionMeshLoadKeys={prewarmedCollisionMeshLoadKeys}
                    readyCollisionMeshLoadKeys={readyCollisionMeshLoadKeys}
                    childJointsByParent={childJointsByParent}
                    onRegisterJointPivot={handleRegisterJointPivot}
                    onRegisterJointMotion={handleRegisterJointMotion}
                    onRegisterCollisionRef={handleRegisterCollisionRef}
                    onRegisterIkHandle={handleRegisterIkHandle}
                    onMeshResolved={handleMeshResolved}
                    onPrewarmedMeshResolved={handlePrewarmedMeshResolved}
                  />
                </group>
              ))}
            </GroundedGroup>
          </group>
        </group>
        {active && isMeshLoading ? (
          <Html fullscreen>
            <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-4">
              <LoadingHud
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

        {!snapshotRenderActive && !shouldRenderAssemblyTransformControls && (
          <JointTransformControls
            mode={mode}
            selectedJointPivot={selectedJointPivot}
            selectedJointMotion={selectedJointMotion}
            robot={robot}
            transformMode="universal"
            transformControlsState={transformControlsState}
          />
        )}

        {!snapshotRenderActive && !shouldRenderAssemblyTransformControls && (
          <LinkIkTransformControls
            selectedLinkId={selectedIkHandleLinkId}
            selectedHandle={selectedIkHandle}
            coordinateRoot={selectedIkCoordinateRoot}
            ikRobotState={robot}
            enabled={active && Boolean(selectedIkHandleDescriptor?.jointIds.length)}
            historyLabel="Move IK handle"
            onPreviewKinematicOverrides={(overrides) =>
              controller.previewLinkIkKinematics(overrides.angles, overrides.quaternions)
            }
            onClearPreviewKinematicOverrides={controller.clearLinkIkKinematicsPreview}
          />
        )}

        {!snapshotRenderActive && shouldRenderAssemblyTransformControls && (
          <AssemblyTransformControls
            robot={robot}
            assemblyState={assemblyState}
            assemblySelection={assemblySelection}
            transformMode={state.transformMode}
            assemblyRoot={assemblyRootObject}
            sourceSceneComponentRoot={
              showSourceSceneAssemblyComponentControls ? sourceSceneComponentRootObject : null
            }
            sourceSceneComponentId={
              showSourceSceneAssemblyComponentControls ? sourceSceneAssemblyComponent.id : null
            }
            jointPivots={jointPivots}
            onAssemblyTransform={onAssemblyTransform}
            onComponentTransform={onComponentTransform}
            onBridgeTransform={onBridgeTransform}
            onSourceSceneComponentTransform={onSourceSceneComponentTransform}
            onTransformPendingChange={onTransformPendingChange}
          />
        )}

        {!snapshotRenderActive &&
          selectedCollisionRef &&
          robot.selection.type === 'link' &&
          robot.selection.id &&
          robot.selection.subType === 'collision' && (
            <>
              <UnifiedTransformControls
                ref={collisionTransformControlRef}
                object={selectedCollisionRef}
                mode={state.transformMode}
                size={VISUALIZER_UNIFIED_GIZMO_SIZE}
                translateSpace="world"
                rotateSpace="local"
                hoverStyle="single-axis"
                displayStyle="thick-primary"
                onDraggingChanged={handleCollisionDraggingChanged}
                onMouseUp={handleCollisionTransformEnd}
              />
            </>
          )}
      </>
    );
  },
);
