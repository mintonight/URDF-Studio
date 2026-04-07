import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { solveLinkIkPositionTarget } from '@/core/robot';
import type {
  RobotClosedLoopConstraint,
  RobotMaterialState,
  RobotState,
  UrdfJoint,
  UrdfLink,
} from '@/types';
import { useRobotStore } from '@/store/robotStore';

import {
  UnifiedTransformControls,
  VISUALIZER_UNIFIED_GIZMO_SIZE,
} from './UnifiedTransformControls';
import {
  cloneLinkIkDragKinematicState,
  createEmptyLinkIkDragKinematicState,
  diffLinkIkDragKinematicState,
  hasMeaningfulLinkIkTargetDelta,
  hasLinkIkKinematicStateChanges,
  resolveLinkIkCommittedStateEpsilon,
  resolveLinkIkSolveRequestOptions,
  shouldScheduleLinkIkPreviewSolve,
} from './linkIkDragPreview';

interface LinkIkTransformControlsProps {
  selectedLinkId: string | null;
  selectedHandle: THREE.Object3D | null;
  coordinateRoot: THREE.Object3D | null;
  ikRobotState: Pick<
    RobotState,
    'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
  > | null;
  enabled?: boolean;
  historyLabel?: string;
  setIsDragging?: (dragging: boolean) => void;
  onPreviewKinematicOverrides?: (overrides: {
    angles: Record<string, number>;
    quaternions: Record<string, NonNullable<RobotState['joints'][string]['quaternion']>>;
  }) => void;
  onClearPreviewKinematicOverrides?: () => void;
}

interface RobotHistorySnapshot {
  name: string;
  links: Record<string, UrdfLink>;
  joints: Record<string, UrdfJoint>;
  rootLinkId: string;
  materials?: Record<string, RobotMaterialState>;
  closedLoopConstraints?: RobotClosedLoopConstraint[];
}

function createHistorySnapshot(): RobotHistorySnapshot {
  const state = useRobotStore.getState();
  return structuredClone({
    name: state.name,
    links: state.links,
    joints: state.joints,
    rootLinkId: state.rootLinkId,
    materials: state.materials,
    closedLoopConstraints: state.closedLoopConstraints,
  });
}

export const LinkIkTransformControls = memo(function LinkIkTransformControls({
  selectedLinkId,
  selectedHandle,
  coordinateRoot,
  ikRobotState,
  enabled = true,
  historyLabel = 'IK handle drag',
  setIsDragging,
  onPreviewKinematicOverrides,
  onClearPreviewKinematicOverrides,
}: LinkIkTransformControlsProps) {
  const { invalidate } = useThree();
  const transformRef = useRef<any>(null);
  const translateProxyRef = useRef<THREE.Group | null>(null);
  const activeLinkIdRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  const didMutateRef = useRef(false);
  const historySnapshotRef = useRef<RobotHistorySnapshot | null>(null);
  const worldPositionRef = useRef(new THREE.Vector3());
  const localPositionRef = useRef(new THREE.Vector3());
  const pendingTargetWorldPositionRef = useRef<THREE.Vector3 | null>(null);
  const lastSolvedTargetWorldPositionRef = useRef<THREE.Vector3 | null>(null);
  const dragStartWorldPositionRef = useRef<THREE.Vector3 | null>(null);
  const dragHasMeaningfulMotionRef = useRef(false);
  const solveFrameRef = useRef<number | null>(null);
  // Mirror the detached-goal workflow used in closed-chain-ik-js:
  // solve against the drag-start snapshot, but keep the latest accepted
  // preview state around as the next seed so the gizmo stays responsive.
  const previewSolveStateRef = useRef(createEmptyLinkIkDragKinematicState());
  const committedPreviewStateRef = useRef(createEmptyLinkIkDragKinematicState());
  const [translateProxy, setTranslateProxy] = useState<THREE.Group | null>(null);

  const syncTranslateProxy = useCallback(
    (proxyTarget: THREE.Object3D | null, handle = selectedHandle) => {
      if (!proxyTarget || !handle) {
        return;
      }

      handle.updateMatrixWorld(true);
      handle.getWorldPosition(worldPositionRef.current);
      proxyTarget.position.copy(worldPositionRef.current);
      proxyTarget.quaternion.identity();
      proxyTarget.scale.setScalar(1);
      proxyTarget.updateMatrixWorld(true);
    },
    [selectedHandle],
  );

  const handleTranslateProxyRef = useCallback(
    (proxy: THREE.Group | null) => {
      translateProxyRef.current = proxy;
      setTranslateProxy(proxy);
      syncTranslateProxy(proxy);
    },
    [syncTranslateProxy],
  );

  const cancelScheduledSolve = useCallback(() => {
    if (
      solveFrameRef.current !== null &&
      typeof window !== 'undefined' &&
      typeof window.cancelAnimationFrame === 'function'
    ) {
      window.cancelAnimationFrame(solveFrameRef.current);
    }

    solveFrameRef.current = null;
  }, []);

  const resetSolveQueue = useCallback(() => {
    cancelScheduledSolve();
    pendingTargetWorldPositionRef.current = null;
    lastSolvedTargetWorldPositionRef.current = null;
    dragStartWorldPositionRef.current = null;
    dragHasMeaningfulMotionRef.current = false;
    previewSolveStateRef.current = createEmptyLinkIkDragKinematicState();
    committedPreviewStateRef.current = createEmptyLinkIkDragKinematicState();
  }, [cancelScheduledSolve]);

  const clearPreviewOverrides = useCallback(() => {
    onClearPreviewKinematicOverrides?.();
    committedPreviewStateRef.current = createEmptyLinkIkDragKinematicState();
  }, [onClearPreviewKinematicOverrides]);

  const readProxyWorldPosition = useCallback(() => {
    const proxy = translateProxyRef.current;
    if (!proxy) {
      return null;
    }

    proxy.updateMatrixWorld(true);
    return proxy.getWorldPosition(worldPositionRef.current);
  }, []);

  const buildBaseKinematicState = useCallback(
    (
      baseRobot: Pick<RobotState, 'joints'>,
      nextState: ReturnType<typeof cloneLinkIkDragKinematicState>,
    ) => ({
      angles: Object.fromEntries(
        Object.keys(nextState.angles).map((jointId) => [
          jointId,
          baseRobot.joints[jointId]?.angle ?? 0,
        ]),
      ),
      quaternions: Object.fromEntries(
        Object.keys(nextState.quaternions)
          .map((jointId) => [jointId, baseRobot.joints[jointId]?.quaternion])
          .filter(([, quaternion]) => Boolean(quaternion)),
      ),
    }),
    [],
  );

  const applyIkToTarget = useCallback(
    (targetWorldPosition: THREE.Vector3, preview: boolean) => {
      const activeLinkId = activeLinkIdRef.current ?? selectedLinkId;
      const baseRobot = ikRobotState;
      if (!coordinateRoot || !activeLinkId || !baseRobot) {
        return;
      }

      coordinateRoot.updateMatrixWorld(true);
      localPositionRef.current.copy(targetWorldPosition);
      coordinateRoot.worldToLocal(localPositionRef.current);

      if (!lastSolvedTargetWorldPositionRef.current) {
        lastSolvedTargetWorldPositionRef.current = new THREE.Vector3();
      }
      lastSolvedTargetWorldPositionRef.current.copy(targetWorldPosition);

      const solveSeedState = previewSolveStateRef.current;
      const result = solveLinkIkPositionTarget(baseRobot, {
        linkId: activeLinkId,
        targetWorldPosition: {
          x: localPositionRef.current.x,
          y: localPositionRef.current.y,
          z: localPositionRef.current.z,
        },
        seedAngles: hasLinkIkKinematicStateChanges(solveSeedState)
          ? solveSeedState.angles
          : undefined,
        seedQuaternions: hasLinkIkKinematicStateChanges(solveSeedState)
          ? solveSeedState.quaternions
          : undefined,
        ...resolveLinkIkSolveRequestOptions(preview),
      });

      if (result.failureReason === 'numerical-failure') {
        return;
      }

      const nextSolveState = cloneLinkIkDragKinematicState({
        angles: result.angles,
        quaternions: result.quaternions,
      });
      previewSolveStateRef.current = nextSolveState;

      const changedOverrides = diffLinkIkDragKinematicState(
        committedPreviewStateRef.current,
        nextSolveState,
        resolveLinkIkCommittedStateEpsilon(preview),
      );

      if (!hasLinkIkKinematicStateChanges(changedOverrides)) {
        return;
      }

      didMutateRef.current = true;
      onPreviewKinematicOverrides?.(nextSolveState);
      committedPreviewStateRef.current = nextSolveState;
      invalidate();
    },
    [coordinateRoot, ikRobotState, invalidate, onPreviewKinematicOverrides, selectedLinkId],
  );

  const schedulePreviewSolve = useCallback(() => {
    if (!isDraggingRef.current) {
      return;
    }

    const nextTargetWorldPosition = readProxyWorldPosition();
    if (!nextTargetWorldPosition) {
      return;
    }
    const dragStartWorldPosition = dragStartWorldPositionRef.current;
    if (!dragStartWorldPosition) {
      return;
    }

    const hasMeaningfulDragMotion =
      dragHasMeaningfulMotionRef.current ||
      hasMeaningfulLinkIkTargetDelta(dragStartWorldPosition, nextTargetWorldPosition);

    if (
      !shouldScheduleLinkIkPreviewSolve({
        pendingTargetWorldPosition: pendingTargetWorldPositionRef.current,
        lastSolvedTargetWorldPosition: lastSolvedTargetWorldPositionRef.current,
        nextTargetWorldPosition,
        hasMeaningfulDragMotion,
      })
    ) {
      return;
    }

    dragHasMeaningfulMotionRef.current = hasMeaningfulDragMotion;

    if (!pendingTargetWorldPositionRef.current) {
      pendingTargetWorldPositionRef.current = new THREE.Vector3();
    }
    pendingTargetWorldPositionRef.current.copy(nextTargetWorldPosition);

    if (solveFrameRef.current !== null) {
      return;
    }

    const runSolve = () => {
      solveFrameRef.current = null;

      const queuedTarget = pendingTargetWorldPositionRef.current;
      pendingTargetWorldPositionRef.current = null;
      if (!queuedTarget || !isDraggingRef.current) {
        return;
      }

      applyIkToTarget(queuedTarget, true);

      if (!pendingTargetWorldPositionRef.current) {
        return;
      }

      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        runSolve();
        return;
      }

      solveFrameRef.current = window.requestAnimationFrame(runSolve);
    };

    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      runSolve();
      return;
    }

    solveFrameRef.current = window.requestAnimationFrame(runSolve);
  }, [applyIkToTarget, readProxyWorldPosition]);

  const flushFinalSolve = useCallback(() => {
    cancelScheduledSolve();
    pendingTargetWorldPositionRef.current = null;
    const finalTargetWorldPosition = readProxyWorldPosition();
    if (!finalTargetWorldPosition) {
      return;
    }
    const dragStartWorldPosition = dragStartWorldPositionRef.current;
    if (!dragStartWorldPosition) {
      return;
    }

    const hasMeaningfulDragMotion =
      dragHasMeaningfulMotionRef.current ||
      hasMeaningfulLinkIkTargetDelta(dragStartWorldPosition, finalTargetWorldPosition);
    if (!hasMeaningfulDragMotion) {
      return;
    }

    dragHasMeaningfulMotionRef.current = true;

    applyIkToTarget(finalTargetWorldPosition, false);
  }, [applyIkToTarget, cancelScheduledSolve, readProxyWorldPosition]);

  const beginDrag = useCallback(() => {
    if (!enabled || !selectedLinkId || !selectedHandle || !coordinateRoot || !ikRobotState) {
      return false;
    }

    if (!historySnapshotRef.current) {
      historySnapshotRef.current = createHistorySnapshot();
    }
    activeLinkIdRef.current = selectedLinkId;
    didMutateRef.current = false;
    isDraggingRef.current = true;
    resetSolveQueue();
    const dragStartWorldPosition = readProxyWorldPosition();
    if (dragStartWorldPosition) {
      if (!dragStartWorldPositionRef.current) {
        dragStartWorldPositionRef.current = new THREE.Vector3();
      }
      dragStartWorldPositionRef.current.copy(dragStartWorldPosition);
    }
    previewSolveStateRef.current = createEmptyLinkIkDragKinematicState();
    committedPreviewStateRef.current = createEmptyLinkIkDragKinematicState();
    setIsDragging?.(true);
    return true;
  }, [
    coordinateRoot,
    enabled,
    ikRobotState,
    readProxyWorldPosition,
    resetSolveQueue,
    selectedHandle,
    selectedLinkId,
    setIsDragging,
  ]);

  const finishDrag = useCallback(() => {
    if (!isDraggingRef.current) {
      return;
    }

    flushFinalSolve();
    isDraggingRef.current = false;
    activeLinkIdRef.current = null;
    setIsDragging?.(false);

    const baseRobot = ikRobotState;
    const nextSolveState = previewSolveStateRef.current;
    const nextCommittedOverrides =
      didMutateRef.current && baseRobot
        ? diffLinkIkDragKinematicState(
            buildBaseKinematicState(baseRobot, nextSolveState),
            nextSolveState,
            resolveLinkIkCommittedStateEpsilon(false),
          )
        : createEmptyLinkIkDragKinematicState();

    if (hasLinkIkKinematicStateChanges(nextCommittedOverrides) && historySnapshotRef.current) {
      const storeState = useRobotStore.getState();
      storeState.applyJointKinematicOverrides(nextCommittedOverrides, {
        skipHistory: true,
      });
      storeState.pushHistorySnapshot(historySnapshotRef.current, historyLabel);
    }

    historySnapshotRef.current = null;
    didMutateRef.current = false;
    syncTranslateProxy(translateProxyRef.current);
    resetSolveQueue();
    invalidate();
  }, [
    buildBaseKinematicState,
    flushFinalSolve,
    historyLabel,
    ikRobotState,
    invalidate,
    resetSolveQueue,
    setIsDragging,
    syncTranslateProxy,
  ]);

  const handleDraggingChanged = useCallback(
    (event?: { value?: boolean }) => {
      if (event?.value) {
        beginDrag();
        return;
      }

      finishDrag();
    },
    [beginDrag, finishDrag],
  );

  const handleObjectChange = useCallback(() => {
    if (!isDraggingRef.current) {
      return;
    }

    schedulePreviewSolve();
  }, [schedulePreviewSolve]);

  useEffect(() => {
    if (!isDraggingRef.current) {
      syncTranslateProxy(translateProxyRef.current);
      clearPreviewOverrides();
      resetSolveQueue();
    }
  }, [clearPreviewOverrides, resetSolveQueue, selectedHandle, selectedLinkId, syncTranslateProxy]);

  useEffect(
    () => () => {
      if (isDraggingRef.current) {
        finishDrag();
        return;
      }

      clearPreviewOverrides();
      resetSolveQueue();
    },
    [clearPreviewOverrides, finishDrag, resetSolveQueue],
  );

  useFrame(() => {
    if (transformRef.current?.dragging) {
      schedulePreviewSolve();
      return;
    }

    if (isDraggingRef.current) {
      finishDrag();
      return;
    }

    syncTranslateProxy(translateProxyRef.current);
  }, 1000);

  if (!enabled || !selectedLinkId || !selectedHandle || !coordinateRoot || !ikRobotState) {
    return null;
  }

  return (
    <>
      <group ref={handleTranslateProxyRef} visible={false} />
      {translateProxy ? (
        <UnifiedTransformControls
          ref={transformRef}
          object={translateProxy}
          mode="translate"
          size={VISUALIZER_UNIFIED_GIZMO_SIZE}
          translateSpace="world"
          rotateEnabled={false}
          hoverStyle="stock"
          displayStyle="stock"
          onChange={handleObjectChange}
          onDraggingChanged={handleDraggingChanged}
        />
      ) : null}
    </>
  );
});
