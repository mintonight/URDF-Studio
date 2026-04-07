import { useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { throttle } from '@/shared/utils';
import type { InteractionSelection } from '@/types';
import { THROTTLE_INTERVAL } from '../constants';
import type { ToolMode, ViewerInteractiveLayer, ViewerSceneMode } from '../types';
import { isSingleDofJoint } from '../utils/jointTypes';
import { collectGizmoRaycastTargets, isGizmoObject } from '../utils/raycast';
import {
  collectPickTargets,
  findPickIntersections,
  type PickTargetMode,
} from '../utils/pickTargets';
import { resolveInteractionSelectionHit } from '../utils/selectionTargets';
import { resolveHelperSelectionPlan } from '../utils/helperSelectionPlan';
import {
  shouldBlockOrbitForGeometryHit,
  shouldDisableOrbitForDirectJointDrag,
  shouldStartJointDragFromGeometryHit,
} from '../utils/interactionMode';
import {
  isPointerInteractionWithinClickThreshold,
  shouldDeferSelectionUntilPointerUp,
} from '../utils/clickSelectionPolicy';
import {
  resolveHoverInteractionResolution,
  type ResolvedHoverInteractionCandidate,
} from '../utils/hoverInteractionResolution';
import {
  collectProjectedHelperInteractionTargets,
  resolveScreenSpaceHelperInteraction,
} from '../utils/screenSpaceHelperInteraction';
import { resolveRevoluteDragDelta } from '../utils/jointDragDelta';
import { createJointDragStoreSync } from '../utils/jointDragStoreSync';
import { createJointDragFrameSync } from '../utils/jointDragFrameSync';
import { resolveActiveViewerJointKeyFromSelection } from '../utils/activeJointSelection';
import { resolveMouseDownSelectionPlan } from '../utils/mouseDownSelectionPlan';
import { hasEffectivelyFiniteJointLimits } from '@/shared/utils/jointUnits';
import type { ViewerHelperKind } from '../types';
import {
  armSelectionMissGuard,
  disarmSelectionMissGuard,
  clearSelectionMissGuardTimer,
  scheduleSelectionMissGuardReset,
  shouldDisarmSelectionMissGuardOnPointerMove,
} from '../utils/selectionMissGuard';

const JOINT_DRAG_EPSILON = 1e-5;
const MAX_REVOLUTE_DELTA_PER_EVENT = Math.PI / 8;
const JOINT_DRAG_STORE_SYNC_INTERVAL = 16;

interface PendingPointerSelection {
  resolvedHit: ResolvedHoverInteractionCandidate;
  resolvedLinkObject: THREE.Object3D | null;
  resolvedSubType: 'visual' | 'collision' | undefined;
  clickedJoint: any;
}

export interface UseMouseInteractionOptions {
  robot: THREE.Object3D | null;
  robotVersion: number;
  toolMode: ToolMode;
  mode?: ViewerSceneMode;
  showCollision: boolean;
  showVisual: boolean;
  showCollisionAlwaysOnTop: boolean;
  interactionLayerPriority?: readonly ViewerInteractiveLayer[];
  linkMeshMapRef: React.RefObject<Map<string, THREE.Mesh[]>>;
  onHover?: (
    type: InteractionSelection['type'],
    id: string | null,
    subType?: 'visual' | 'collision',
    objectIndex?: number,
    helperKind?: ViewerHelperKind,
    highlightObjectId?: number,
  ) => void;
  onSelect?: (
    type: Exclude<InteractionSelection['type'], null>,
    id: string,
    subType?: 'visual' | 'collision',
    helperKind?: ViewerHelperKind,
  ) => void;
  onMeshSelect?: (
    linkId: string,
    jointId: string | null,
    objectIndex: number,
    objectType: 'visual' | 'collision',
  ) => void;
  onJointChange?: (name: string, angle: number) => void;
  onJointChangeCommit?: (name: string, angle: number) => void;
  throttleJointChangeDuringDrag?: boolean;
  setIsDragging?: (dragging: boolean) => void;
  setActiveJoint?: (jointName: string | null) => void;
  justSelectedRef?: React.RefObject<boolean>;
  isOrbitDragging?: React.RefObject<boolean>;
  isSelectionLockedRef?: React.RefObject<boolean>;
  selection?: {
    type: InteractionSelection['type'];
    id: string | null;
  };
  rayIntersectsBoundingBox: (raycaster: THREE.Raycaster, forceRefresh?: boolean) => boolean;
  highlightGeometry: (
    linkName: string | null,
    revert: boolean,
    subType?: 'visual' | 'collision',
    meshToHighlight?: THREE.Object3D | null | number,
  ) => void;
}

export interface UseMouseInteractionResult {
  mouseRef: React.RefObject<THREE.Vector2>;
  raycasterRef: React.RefObject<THREE.Raycaster>;
  hoveredLinkRef: React.RefObject<string | null>;
  isDraggingJoint: React.RefObject<boolean>;
  needsRaycastRef: React.RefObject<boolean>;
  lastMousePosRef: React.RefObject<{ x: number; y: number }>;
  pointerButtonsRef: React.RefObject<number>;
}

export function useMouseInteraction({
  robot,
  robotVersion,
  toolMode,
  mode,
  showCollision,
  showVisual,
  showCollisionAlwaysOnTop,
  interactionLayerPriority = [],
  linkMeshMapRef,
  onHover,
  onSelect,
  onMeshSelect,
  onJointChange,
  onJointChangeCommit,
  throttleJointChangeDuringDrag = false,
  setIsDragging,
  setActiveJoint,
  justSelectedRef,
  isOrbitDragging,
  isSelectionLockedRef,
  selection,
  rayIntersectsBoundingBox,
  highlightGeometry,
}: UseMouseInteractionOptions): UseMouseInteractionResult {
  const { camera, gl, scene, invalidate } = useThree();
  const orbitControls = useThree((state) => state.controls as { enabled?: boolean } | undefined);

  const mouseRef = useRef(new THREE.Vector2(-1000, -1000));
  const raycasterRef = useRef(new THREE.Raycaster());
  const hoveredLinkRef = useRef<string | null>(null);
  const useExternalHover = typeof onHover === 'function';

  // PERFORMANCE: Track last mouse position for state locking (skip small movements)
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  // OPTIMIZATION: Signal that raycast is needed on next frame
  const needsRaycastRef = useRef(false);
  const pointerButtonsRef = useRef(0);

  const isDraggingJoint = useRef(false);
  const dragJoint = useRef<any>(null);
  const dragHitDistance = useRef(0);
  const lastRayRef = useRef(new THREE.Ray());
  const selectionResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPointerSelectionRef = useRef<PendingPointerSelection | null>(null);
  const pointerDownPositionRef = useRef<{ x: number; y: number } | null>(null);
  const pointerExceededClickThresholdRef = useRef(false);
  const gizmoTargetsRef = useRef<THREE.Object3D[]>([]);
  const gizmoTargetsCacheKeyRef = useRef('');
  const gizmoTargetsUpdatedAtRef = useRef(0);
  const pickTargetCachesRef = useRef<
    Record<
      PickTargetMode,
      {
        key: string;
        updatedAt: number;
        targets: THREE.Object3D[];
      }
    >
  >({
    all: { key: '', updatedAt: 0, targets: [] },
    visual: { key: '', updatedAt: 0, targets: [] },
    collision: { key: '', updatedAt: 0, targets: [] },
  });

  // Keep refs up to date
  const onJointChangeRef = useRef(onJointChange);
  const onJointChangeCommitRef = useRef(onJointChangeCommit);
  const setIsDraggingRef = useRef(setIsDragging);
  const setActiveJointRef = useRef(setActiveJoint);
  const invalidateRef = useRef(invalidate);

  useEffect(() => {
    invalidateRef.current = invalidate;
    onJointChangeRef.current = onJointChange;
    onJointChangeCommitRef.current = onJointChangeCommit;
    setIsDraggingRef.current = setIsDragging;
    setActiveJointRef.current = setActiveJoint;
  }, [invalidate, onJointChange, onJointChangeCommit, setIsDragging, setActiveJoint]);

  // Mouse tracking for hover detection AND joint dragging
  useEffect(() => {
    const getGizmoTargets = () => {
      const nextCacheKey = `${scene.children.length}:${toolMode}:${mode ?? 'editor'}:${robot ? 'robot' : 'empty'}`;
      const now = performance.now();

      if (
        gizmoTargetsCacheKeyRef.current !== nextCacheKey ||
        now - gizmoTargetsUpdatedAtRef.current > 120
      ) {
        gizmoTargetsRef.current = collectGizmoRaycastTargets(scene);
        gizmoTargetsCacheKeyRef.current = nextCacheKey;
        gizmoTargetsUpdatedAtRef.current = now;
      }

      return gizmoTargetsRef.current;
    };

    const getPickTargets = (targetMode: PickTargetMode) => {
      const cache = pickTargetCachesRef.current[targetMode];
      const nextCacheKey = [
        robotVersion,
        targetMode,
        showCollision ? 'col:1' : 'col:0',
        showVisual ? 'vis:1' : 'vis:0',
        showCollisionAlwaysOnTop ? 'col-top:1' : 'col-top:0',
        linkMeshMapRef.current.size,
      ].join(':');
      const now = performance.now();

      if (cache.key !== nextCacheKey || now - cache.updatedAt > 120) {
        cache.targets = collectPickTargets(linkMeshMapRef.current, targetMode, robot);
        cache.key = nextCacheKey;
        cache.updatedAt = now;
      }

      return cache.targets;
    };

    const setOrbitControlsEnabled = (enabled: boolean) => {
      if (orbitControls && typeof orbitControls.enabled === 'boolean') {
        orbitControls.enabled = enabled;
      }

      if (!enabled && isOrbitDragging) {
        isOrbitDragging.current = false;
      }
    };

    const updatePointerFromLocalPoint = (localX: number, localY: number): boolean => {
      const width = gl.domElement.clientWidth;
      const height = gl.domElement.clientHeight;
      if (width <= 0 || height <= 0) {
        return false;
      }

      mouseRef.current.x = (localX / width) * 2 - 1;
      mouseRef.current.y = -(localY / height) * 2 + 1;
      raycasterRef.current.setFromCamera(mouseRef.current, camera);
      return true;
    };

    const clearPendingPointerSelection = ({
      disarmGuard = false,
    }: {
      disarmGuard?: boolean;
    } = {}) => {
      pendingPointerSelectionRef.current = null;
      pointerDownPositionRef.current = null;
      pointerExceededClickThresholdRef.current = false;

      if (disarmGuard) {
        disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
      }
    };

    const clearHoveredState = () => {
      hoveredLinkRef.current = null;
      (hoveredLinkRef as any).currentMesh = null;
      (hoveredLinkRef as any).currentObjectIndex = null;
      (hoveredLinkRef as any).currentSubType = null;
      onHover?.(null, null);
    };

    const shouldBlockOrbitForPointer = (localX: number, localY: number) => {
      if (!robot) return false;

      const isStandardSelectionMode = [
        'select',
        'translate',
        'rotate',
        'universal',
        'measure',
      ].includes(toolMode || 'select');
      if (!isStandardSelectionMode) return false;
      if (!shouldBlockOrbitForGeometryHit(toolMode || 'select')) {
        return false;
      }

      if (!updatePointerFromLocalPoint(localX, localY)) {
        return false;
      }

      const gizmoTargets = getGizmoTargets();
      const nearestSceneHit =
        gizmoTargets.length > 0
          ? raycasterRef.current.intersectObjects(gizmoTargets, false)[0]
          : undefined;
      if (nearestSceneHit && isGizmoObject(nearestSceneHit.object)) {
        return true;
      }

      const pickTargets = getPickTargets('all');
      if (pickTargets.length > 0 && !rayIntersectsBoundingBox(raycasterRef.current, true)) {
        return false;
      }

      return (
        findPickIntersections(
          robot,
          raycasterRef.current,
          pickTargets,
          'all',
          false,
          interactionLayerPriority,
        ).length > 0
      );
    };

    const handlePointerDownCapture = (event: PointerEvent) => {
      pointerButtonsRef.current = event.buttons;
      if (event.button !== 0) {
        return;
      }

      if (shouldBlockOrbitForPointer(event.offsetX, event.offsetY)) {
        setOrbitControlsEnabled(false);
      }
    };

    const jointDragStoreSync = createJointDragStoreSync({
      onDragChange: (jointName, angle) => {
        onJointChangeRef.current?.(jointName, angle);
      },
      onDragCommit: (jointName, angle) => {
        onJointChangeCommitRef.current?.(jointName, angle);
      },
      // Keep drag motion fully local in Three.js, but cap React/store sync to once per frame.
      throttleChanges: throttleJointChangeDuringDrag,
      intervalMs: JOINT_DRAG_STORE_SYNC_INTERVAL,
    });

    const jointDragFrameSync = createJointDragFrameSync({
      onFrame: (localX, localY) => {
        if (!updatePointerFromLocalPoint(localX, localY)) {
          return;
        }
        moveRay(raycasterRef.current.ray);
        invalidateRef.current();
      },
    });

    const tempWorldQuat = new THREE.Quaternion();
    const tempAxisWorld = new THREE.Vector3();
    const tempPivotPoint = new THREE.Vector3();
    const tempPlane = new THREE.Plane();
    const tempProjStart = new THREE.Vector3();
    const tempProjEnd = new THREE.Vector3();
    const tempCross = new THREE.Vector3();
    const tempDelta = new THREE.Vector3();
    const tempPrevHitPoint = new THREE.Vector3();
    const tempNewHitPoint = new THREE.Vector3();
    const tempTangentWorld = new THREE.Vector3();
    const tempCameraView = new THREE.Vector3();
    const tempCameraForward = new THREE.Vector3();

    const syncJointWorldFrame = (joint: any) => {
      const axis = joint.axis || new THREE.Vector3(0, 0, 1);
      joint.getWorldQuaternion(tempWorldQuat);

      tempAxisWorld.copy(axis).applyQuaternion(tempWorldQuat).normalize();
      tempPivotPoint.setFromMatrixPosition(joint.matrixWorld);
    };

    /**
     * Find the parent joint of a link (for drag rotation)
     */
    const findParentJoint = (linkObject: THREE.Object3D | null): any => {
      if (!linkObject) return null;

      let current: THREE.Object3D | null = linkObject.parent;

      while (current && current !== robot) {
        if ((current as any).isURDFJoint || (current as any).type === 'URDFJoint') {
          // Skip non-interactive joints (fixed, floating, planar, etc.)
          if (!isSingleDofJoint(current)) {
            let parentLink: THREE.Object3D | null = current.parent;
            while (parentLink && parentLink !== robot) {
              if ((parentLink as any).isURDFLink || (parentLink as any).type === 'URDFLink') {
                return findParentJoint(parentLink);
              }
              parentLink = parentLink.parent;
            }
            return null;
          }

          return current;
        }

        current = current.parent;
      }

      return null;
    };

    const applyResolvedSelection = ({
      resolvedHit,
      resolvedLinkObject,
      resolvedSubType,
      clickedJoint,
    }: PendingPointerSelection) => {
      armSelectionMissGuard(justSelectedRef);

      if (onSelect || onMeshSelect) {
        if (resolvedHit.targetKind === 'helper') {
          if (resolvedHit.type === 'tendon') {
            clearHoveredState();
            return;
          }
          const helperSelectionPlan = resolveHelperSelectionPlan({
            fallbackType: resolvedHit.type,
            fallbackId: resolvedHit.id,
            helperKind: resolvedHit.helperKind,
            linkObject: resolvedLinkObject,
          });
          if (onSelect) {
            onSelect(
              helperSelectionPlan.selectTarget.type,
              helperSelectionPlan.selectTarget.id,
              undefined,
              resolvedHit.helperKind,
            );
          }
        } else if (resolvedSubType && resolvedHit.type === 'link') {
          const selectionPlan = resolveMouseDownSelectionPlan({
            mode,
            linkName: resolvedHit.linkId ?? resolvedHit.id,
            jointName: clickedJoint?.name ?? null,
            subType: resolvedSubType,
          });

          if (onSelect) {
            const selectTarget = selectionPlan.selectTarget;
            if (selectTarget.type === 'joint') {
              onSelect('joint', selectTarget.id);
            } else {
              onSelect('link', selectTarget.id, selectTarget.subType);
            }
          }

          if (onMeshSelect && selectionPlan.shouldSyncMeshSelection) {
            onMeshSelect(
              resolvedHit.linkId ?? resolvedHit.id,
              clickedJoint ? clickedJoint.name : null,
              resolvedHit.objectIndex ?? 0,
              resolvedSubType,
            );
          }

          if (selectionPlan.shouldApplyImmediateGeometryHighlight && resolvedHit.linkId) {
            // Clear all stale highlights first, then apply only the specific body.
            highlightGeometry(resolvedHit.linkId, true, resolvedSubType);
            highlightGeometry(
              resolvedHit.linkId,
              false,
              resolvedSubType,
              resolvedHit.highlightTarget ?? resolvedHit.objectIndex,
            );
          }
        } else if (resolvedHit.type === 'tendon') {
          onSelect?.('tendon', resolvedHit.id);
        }

        clearHoveredState();
      }
    };

    const syncActiveJointFromCurrentSelection = () => {
      if (!setActiveJointRef.current) {
        return;
      }

      const activeJointKey = resolveActiveViewerJointKeyFromSelection(
        (robot as { joints?: Record<string, unknown> } | null)?.joints,
        selection,
      );

      if (activeJointKey) {
        setActiveJointRef.current(activeJointKey);
      }
    };

    const getRevoluteDelta = (joint: any, startPt: THREE.Vector3, endPt: THREE.Vector3): number => {
      syncJointWorldFrame(joint);
      tempPlane.setFromNormalAndCoplanarPoint(tempAxisWorld, tempPivotPoint);

      tempPlane.projectPoint(startPt, tempProjStart);
      tempPlane.projectPoint(endPt, tempProjEnd);

      tempProjStart.sub(tempPivotPoint);
      tempProjEnd.sub(tempPivotPoint);

      if (
        tempProjStart.lengthSq() <= JOINT_DRAG_EPSILON ||
        tempProjEnd.lengthSq() <= JOINT_DRAG_EPSILON
      ) {
        return 0;
      }

      tempCross.crossVectors(tempProjStart, tempProjEnd);
      const worldDelta = Math.atan2(tempCross.dot(tempAxisWorld), tempProjStart.dot(tempProjEnd));
      tempCameraView.copy(camera.position).sub(startPt);
      if (tempCameraView.lengthSq() <= JOINT_DRAG_EPSILON) {
        camera.getWorldDirection(tempCameraView).multiplyScalar(-1);
      } else {
        tempCameraView.normalize();
      }

      camera.getWorldDirection(tempCameraForward);
      tempTangentWorld.copy(tempCameraForward).cross(tempAxisWorld);
      const tangentDelta =
        tempTangentWorld.lengthSq() > JOINT_DRAG_EPSILON
          ? tempTangentWorld.dot(tempDelta.subVectors(endPt, startPt))
          : 0;

      return resolveRevoluteDragDelta({
        worldDelta,
        tangentDelta,
        planeFacingRatio: Math.abs(tempCameraView.dot(tempAxisWorld)),
        epsilon: JOINT_DRAG_EPSILON,
        maxDelta: MAX_REVOLUTE_DELTA_PER_EVENT,
      });
    };

    const getPrismaticDelta = (
      joint: any,
      startPt: THREE.Vector3,
      endPt: THREE.Vector3,
    ): number => {
      syncJointWorldFrame(joint);
      tempDelta.subVectors(endPt, startPt);
      return tempDelta.dot(tempAxisWorld);
    };

    const moveRay = (toRay: THREE.Ray) => {
      if (!isDraggingJoint.current || !dragJoint.current) return;

      let delta = 0;
      const jt = dragJoint.current.jointType;

      if (jt === 'revolute' || jt === 'continuous') {
        lastRayRef.current.at(dragHitDistance.current, tempPrevHitPoint);
        toRay.at(dragHitDistance.current, tempNewHitPoint);
        delta = getRevoluteDelta(dragJoint.current, tempPrevHitPoint, tempNewHitPoint);
      } else if (jt === 'prismatic') {
        lastRayRef.current.at(dragHitDistance.current, tempPrevHitPoint);
        toRay.at(dragHitDistance.current, tempNewHitPoint);
        delta = getPrismaticDelta(dragJoint.current, tempPrevHitPoint, tempNewHitPoint);
      }

      if (Math.abs(delta) > JOINT_DRAG_EPSILON) {
        const currentAngle = dragJoint.current.angle ?? dragJoint.current.jointValue ?? 0;
        let newAngle = currentAngle + delta;

        const limit = dragJoint.current.limit;
        const hasFiniteLimit = hasEffectivelyFiniteJointLimits(limit);
        if ((jt === 'revolute' || jt === 'prismatic') && hasFiniteLimit) {
          newAngle = Math.max(limit.lower, Math.min(limit.upper, newAngle));
        }

        if (
          Math.abs(newAngle - currentAngle) > JOINT_DRAG_EPSILON &&
          dragJoint.current.setJointValue
        ) {
          dragJoint.current.setJointValue(newAngle);
          jointDragStoreSync.emit(dragJoint.current.name, newAngle);
        }
      }

      lastRayRef.current.copy(toRay);
    };

    // Core mouse move logic (will be throttled for hover, but immediate for dragging)
    const handleMouseMoveCore = (e: MouseEvent) => {
      lastMousePosRef.current.x = e.clientX;
      lastMousePosRef.current.y = e.clientY;

      if (!updatePointerFromLocalPoint(e.offsetX, e.offsetY)) {
        return;
      }
      needsRaycastRef.current = true;

      if (!isOrbitDragging?.current) {
        invalidateRef.current();
      }
    };

    // Throttled version for hover detection
    const throttledMouseMove = throttle(handleMouseMoveCore, THROTTLE_INTERVAL);

    // Full handler: immediate for joint dragging, throttled for hover
    const handleMouseMove = (e: MouseEvent) => {
      pointerButtonsRef.current = e.buttons;
      if (
        shouldDisarmSelectionMissGuardOnPointerMove({
          justSelected: justSelectedRef?.current === true,
          pointerButtons: e.buttons,
          dragging: isDraggingJoint.current,
          hasPendingSelection: pendingPointerSelectionRef.current !== null,
          hasResetTimer: selectionResetTimerRef.current !== null,
        })
      ) {
        disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
      }
      if (
        pendingPointerSelectionRef.current &&
        pointerDownPositionRef.current &&
        !pointerExceededClickThresholdRef.current
      ) {
        pointerExceededClickThresholdRef.current = !isPointerInteractionWithinClickThreshold({
          startX: pointerDownPositionRef.current.x,
          startY: pointerDownPositionRef.current.y,
          endX: e.clientX,
          endY: e.clientY,
        });
      }
      if (isDraggingJoint.current && dragJoint.current) {
        // Drag math updates the live joint model and can become expensive on
        // dense robots or high-frequency pointers. Coalesce raw mousemove
        // bursts into a single animation-frame update to keep interaction
        // responsive without starving rendering.
        jointDragFrameSync.schedule(e.offsetX, e.offsetY);
      } else {
        // Throttled for normal hover detection
        throttledMouseMove(e);
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (!robot) return;
      if (isSelectionLockedRef?.current) return;
      if (e.button !== 0) return;

      const isStandardSelectionMode = [
        'select',
        'translate',
        'rotate',
        'universal',
        'measure',
      ].includes(toolMode || 'select');

      if (!isStandardSelectionMode) return;

      clearPendingPointerSelection();

      if (!updatePointerFromLocalPoint(e.offsetX, e.offsetY)) {
        return;
      }

      // IMPORTANT:
      // TransformControls gizmo is not a child of `robot`.
      // If we only raycast `robot`, clicking gizmo will "pass through" and select
      // underlying collision/visual meshes by mistake.
      const gizmoTargets = getGizmoTargets();
      const pickTargets = getPickTargets('all');
      const canvasRect = gl.domElement.getBoundingClientRect();
      let projectedHelperInteraction: ResolvedHoverInteractionCandidate | null | undefined;
      const getProjectedHelperInteraction = () => {
        if (projectedHelperInteraction !== undefined) {
          return projectedHelperInteraction;
        }

        projectedHelperInteraction = resolveScreenSpaceHelperInteraction({
          pointerClientX: e.clientX,
          pointerClientY: e.clientY,
          projectedHelpers: collectProjectedHelperInteractionTargets({
            robot,
            camera,
            canvasRect,
          }),
          interactionLayerPriority,
        });
        return projectedHelperInteraction;
      };
      const nearestSceneHit =
        gizmoTargets.length > 0
          ? raycasterRef.current.intersectObjects(gizmoTargets, false)[0]
          : undefined;
      if (nearestSceneHit && isGizmoObject(nearestSceneHit.object)) {
        syncActiveJointFromCurrentSelection();
        return;
      }

      let resolvedHit: ResolvedHoverInteractionCandidate | null = null;

      if (pickTargets.length > 0 && !rayIntersectsBoundingBox(raycasterRef.current, true)) {
        resolvedHit = getProjectedHelperInteraction();
      } else {
        const intersections = findPickIntersections(
          robot,
          raycasterRef.current,
          pickTargets,
          'all',
          false,
          interactionLayerPriority,
        );
        const resolvedCandidates: ResolvedHoverInteractionCandidate[] = intersections.reduce<
          ResolvedHoverInteractionCandidate[]
        >((candidates, rayHit) => {
          const selectionHit = resolveInteractionSelectionHit(robot, rayHit.object);
          if (selectionHit) {
            candidates.push({
              ...selectionHit,
              distance: rayHit.distance,
            });
          }
          return candidates;
        }, []);
        const helperInteraction = getProjectedHelperInteraction();

        ({ primaryInteraction: resolvedHit } = resolveHoverInteractionResolution(
          helperInteraction ? resolvedCandidates.concat(helperInteraction) : resolvedCandidates,
          interactionLayerPriority,
        ));
      }

      if (!resolvedHit) {
        disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
        return;
      }

      const resolvedLinkObject = resolvedHit.linkObject ?? null;
      const resolvedSubType = resolvedHit.subType;
      const clickedJoint = (() => {
        if (resolvedHit.type === 'joint') {
          const jointObject = robot?.getObjectByName(resolvedHit.id) ?? null;
          if (
            jointObject &&
            ((jointObject as any).isURDFJoint || (jointObject as any).type === 'URDFJoint')
          ) {
            return jointObject;
          }
          return null;
        }

        if (resolvedHit.targetKind !== 'geometry' || resolvedSubType === 'collision') {
          return null;
        }

        return findParentJoint(resolvedLinkObject);
      })();

      const pendingSelection: PendingPointerSelection = {
        resolvedHit,
        resolvedLinkObject,
        resolvedSubType,
        clickedJoint,
      };
      const hasDirectJointDragTarget =
        Boolean(clickedJoint) &&
        !resolvedHit.screenSpaceProjected &&
        shouldStartJointDragFromGeometryHit(toolMode || 'select');
      const shouldDeferSelection = shouldDeferSelectionUntilPointerUp(
        toolMode || 'select',
        hasDirectJointDragTarget,
      );

      if (shouldDeferSelection) {
        armSelectionMissGuard(justSelectedRef);
        pendingPointerSelectionRef.current = pendingSelection;
        pointerDownPositionRef.current = { x: e.clientX, y: e.clientY };
        pointerExceededClickThresholdRef.current = false;
        clearHoveredState();
        return;
      }

      applyResolvedSelection(pendingSelection);

      const joint =
        !shouldStartJointDragFromGeometryHit(toolMode || 'select') ||
        resolvedHit.screenSpaceProjected
          ? null
          : clickedJoint;

      if (joint) {
        isDraggingJoint.current = true;
        dragJoint.current = joint;
        dragHitDistance.current = resolvedHit.distance;
        lastRayRef.current.copy(raycasterRef.current.ray);
        if (shouldDisableOrbitForDirectJointDrag(toolMode || 'select', true)) {
          // Direct joint dragging starts from robot geometry, not the
          // gizmo picker path, so explicitly suspend orbit before the
          // first move.
          setOrbitControlsEnabled(false);
        }
        setIsDraggingRef.current?.(true);
        if (setActiveJointRef.current) {
          setActiveJointRef.current(joint.name);
        }
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleMouseUp = () => {
      pointerButtonsRef.current = 0;
      let shouldResetSelectionMissGuard = justSelectedRef?.current === true;

      if (pendingPointerSelectionRef.current) {
        const pendingSelection = pendingPointerSelectionRef.current;
        const shouldCommitPendingSelection = !pointerExceededClickThresholdRef.current;
        clearPendingPointerSelection();

        if (shouldCommitPendingSelection) {
          applyResolvedSelection(pendingSelection);
          shouldResetSelectionMissGuard = true;
        } else {
          shouldResetSelectionMissGuard = false;
          disarmSelectionMissGuard(justSelectedRef, selectionResetTimerRef);
        }
      }

      if (isDraggingJoint.current) {
        jointDragFrameSync.flush();

        if (dragJoint.current) {
          const currentAngle = dragJoint.current.angle ?? dragJoint.current.jointValue ?? 0;
          jointDragStoreSync.commit(dragJoint.current.name, currentAngle);
        }

        isDraggingJoint.current = false;
        dragJoint.current = null;
        setIsDraggingRef.current?.(false);
      }

      if (shouldResetSelectionMissGuard && justSelectedRef?.current) {
        scheduleSelectionMissGuardReset({
          justSelectedRef,
          timerRef: selectionResetTimerRef,
          onReset: () => {
            needsRaycastRef.current = true;
            invalidateRef.current();
          },
        });
      } else {
        clearSelectionMissGuardTimer(selectionResetTimerRef);
      }

      setOrbitControlsEnabled(true);
      needsRaycastRef.current = true;
      invalidateRef.current();
    };

    const handleWindowBlur = () => {
      pointerButtonsRef.current = 0;
      handleMouseUp();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleMouseUp();
      }
    };

    const handleMouseLeave = () => {
      pointerButtonsRef.current = 0;
      mouseRef.current.set(-1000, -1000);

      if (hoveredLinkRef.current) {
        const hoveredSubType =
          ((hoveredLinkRef as any).currentSubType as 'visual' | 'collision' | null) ?? undefined;
        if (!useExternalHover) {
          highlightGeometry(
            hoveredLinkRef.current,
            true,
            hoveredSubType,
            (hoveredLinkRef as any).currentMesh,
          );
        }
        hoveredLinkRef.current = null;
        (hoveredLinkRef as any).currentMesh = null;
        (hoveredLinkRef as any).currentObjectIndex = null;
        (hoveredLinkRef as any).currentSubType = null;
        onHover?.(null, null);
      }

      handleMouseUp();
    };

    gl.domElement.addEventListener('pointerdown', handlePointerDownCapture, true);
    gl.domElement.addEventListener('mousemove', handleMouseMove);
    gl.domElement.addEventListener('mousedown', handleMouseDown);
    gl.domElement.addEventListener('mouseup', handleMouseUp);
    gl.domElement.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('pointerup', handleMouseUp);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // Cancel throttled handler to prevent pending callbacks
      throttledMouseMove.cancel();
      jointDragFrameSync.cancel();
      jointDragStoreSync.dispose();
      clearSelectionMissGuardTimer(selectionResetTimerRef);
      setOrbitControlsEnabled(true);
      gl.domElement.removeEventListener('pointerdown', handlePointerDownCapture, true);
      gl.domElement.removeEventListener('mousemove', handleMouseMove);
      gl.domElement.removeEventListener('mousedown', handleMouseDown);
      gl.domElement.removeEventListener('mouseup', handleMouseUp);
      gl.domElement.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('pointerup', handleMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      gizmoTargetsRef.current = [];
      gizmoTargetsCacheKeyRef.current = '';
      gizmoTargetsUpdatedAtRef.current = 0;
      pickTargetCachesRef.current.all.key = '';
      pickTargetCachesRef.current.all.updatedAt = 0;
      pickTargetCachesRef.current.all.targets = [];
      pickTargetCachesRef.current.visual.key = '';
      pickTargetCachesRef.current.visual.updatedAt = 0;
      pickTargetCachesRef.current.visual.targets = [];
      pickTargetCachesRef.current.collision.key = '';
      pickTargetCachesRef.current.collision.updatedAt = 0;
      pickTargetCachesRef.current.collision.targets = [];
    };
  }, [
    gl,
    camera,
    scene,
    robot,
    robotVersion,
    orbitControls,
    onHover,
    onSelect,
    onMeshSelect,
    highlightGeometry,
    toolMode,
    mode,
    justSelectedRef,
    isOrbitDragging,
    isSelectionLockedRef,
    selection,
    showCollision,
    showCollisionAlwaysOnTop,
    showVisual,
    interactionLayerPriority,
    linkMeshMapRef,
    useExternalHover,
    throttleJointChangeDuringDrag,
    rayIntersectsBoundingBox,
  ]);

  return {
    mouseRef,
    raycasterRef,
    hoveredLinkRef,
    isDraggingJoint,
    needsRaycastRef,
    lastMousePosRef,
    pointerButtonsRef,
  };
}
