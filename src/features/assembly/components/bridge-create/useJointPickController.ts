import { useCallback, useEffect } from 'react';
import * as THREE from 'three';

import { radToDeg } from '@/core/robot/transforms';
import {
  computeBridgeOriginFromSnapFrames,
  computePointCoincidentOrigin,
  type JointAlignmentDelta,
} from '@/core/robot/jointPickAlignment';
import {
  useJointPickSessionStore,
  type JointPickSide,
} from '@/store/jointPickSessionStore';
import { useSelectionStore } from '@/store/selectionStore';

export type JointAlignMode = 'smartAlign' | 'pointCoincident';

interface UseJointPickControllerOptions {
  isOpen: boolean;
  parentComponentId: string;
  parentLinkId: string;
  childComponentId: string;
  childLinkId: string;
  alignment?: JointAlignmentDelta;
  alignMode?: JointAlignMode;
  applyPickedOrigin: (
    position: { x: number; y: number; z: number },
    rotationDeg: { r: number; p: number; y: number },
  ) => void;
}

function matrixFrom(serialized: number[]): THREE.Matrix4 {
  return new THREE.Matrix4().fromArray(serialized);
}

/**
 * Bridges the joint-pick session store and the bridge-create draft: mirrors the
 * relation into the session, blocks normal selection while picking, and converts
 * the two committed snap frames into the bridge joint origin (xyz + rpy).
 */
export function useJointPickController({
  isOpen,
  parentComponentId,
  parentLinkId,
  childComponentId,
  childLinkId,
  alignment,
  alignMode = 'smartAlign',
  applyPickedOrigin,
}: UseJointPickControllerOptions) {
  const active = useJointPickSessionStore((state) => state.active);
  const side = useJointPickSessionStore((state) => state.side);
  const mode = useJointPickSessionStore((state) => state.mode);
  const snapFilter = useJointPickSessionStore((state) => state.snapFilter);
  const parentSnap = useJointPickSessionStore((state) => state.parentSnap);
  const childSnap = useJointPickSessionStore((state) => state.childSnap);
  const startPickAction = useJointPickSessionStore((state) => state.startPick);
  const setActive = useJointPickSessionStore((state) => state.setActive);
  const setModeAction = useJointPickSessionStore((state) => state.setMode);
  const setSnapFilterAction = useJointPickSessionStore((state) => state.setSnapFilter);
  const setRelation = useJointPickSessionStore((state) => state.setRelation);
  const clearSideAction = useJointPickSessionStore((state) => state.clearSide);
  const reset = useJointPickSessionStore((state) => state.reset);

  const setInteractionGuard = useSelectionStore((state) => state.setInteractionGuard);

  // Mirror the chosen relation so the pick layer can reject hits on the wrong
  // component/link, and so changing the relation drops now-stale snaps.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setRelation(
      parentComponentId || null,
      parentLinkId || null,
      childComponentId || null,
      childLinkId || null,
    );
  }, [isOpen, parentComponentId, parentLinkId, childComponentId, childLinkId, setRelation]);

  // Tear the session down when the modal closes.
  useEffect(() => {
    if (isOpen) {
      return;
    }
    reset();
  }, [isOpen, reset]);

  // While a snap pick is in progress, suppress normal viewer selection so a
  // click captures a snap point instead of re-selecting/altering the relation.
  useEffect(() => {
    if (!isOpen || !active) {
      return undefined;
    }
    setInteractionGuard(() => false);
    return () => setInteractionGuard(null);
  }, [isOpen, active, setInteractionGuard]);

  // Derive the joint origin whenever both sides have a committed snap.
  useEffect(() => {
    if (!isOpen || !parentSnap || !childSnap) {
      return;
    }

    const parentLinkWorld = matrixFrom(parentSnap.linkWorldMatrix);
    const childLinkWorld = matrixFrom(childSnap.linkWorldMatrix);

    const result =
      alignMode === 'pointCoincident'
        ? computePointCoincidentOrigin({
            parentSnapPointWorld: new THREE.Vector3(
              parentSnap.pointWorld.x,
              parentSnap.pointWorld.y,
              parentSnap.pointWorld.z,
            ),
            childSnapPointWorld: new THREE.Vector3(
              childSnap.pointWorld.x,
              childSnap.pointWorld.y,
              childSnap.pointWorld.z,
            ),
            parentLinkWorld,
            childLinkWorld,
          })
        : computeBridgeOriginFromSnapFrames({
            parentSnapWorld: matrixFrom(parentSnap.poseWorldMatrix),
            childSnapWorld: matrixFrom(childSnap.poseWorldMatrix),
            parentLinkWorld,
            childLinkWorld,
            alignment,
          });

    const { position, rotation } = result.transform;
    applyPickedOrigin(position, {
      r: radToDeg(rotation.r),
      p: radToDeg(rotation.p),
      y: radToDeg(rotation.y),
    });
  }, [isOpen, parentSnap, childSnap, alignMode, alignment, applyPickedOrigin]);

  const startPick = useCallback(
    (nextSide: JointPickSide) => {
      startPickAction(nextSide);
    },
    [startPickAction],
  );

  const cancelPick = useCallback(() => {
    setActive(false);
  }, [setActive]);

  return {
    active,
    side,
    mode,
    snapFilter,
    parentSnap,
    childSnap,
    startPick,
    cancelPick,
    setMode: setModeAction,
    setSnapFilter: setSnapFilterAction,
    clearSide: clearSideAction,
  };
}
