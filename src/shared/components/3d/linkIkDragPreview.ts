import * as THREE from 'three';

import type { LinkIkPositionSolveRequest } from '@/core/robot';
import type { JointQuaternion } from '@/types';

// Ignore sub-pixel proxy jitter so the drag loop only solves when the user
// actually moves the handle to a meaningfully new target.
export const LINK_IK_TARGET_EPSILON_SQ = 1e-8;
export const LINK_IK_PREVIEW_MAX_ITERATIONS = 6;
export const LINK_IK_PREVIEW_POSITION_TOLERANCE = 2e-3;
export const LINK_IK_PREVIEW_STALL_TOLERANCE = 1e-4;
export const LINK_IK_COMMIT_EPSILON = 1e-6;
export const LINK_IK_PREVIEW_COMMIT_EPSILON = 1e-5;

export interface LinkIkDragKinematicState {
  angles: Record<string, number>;
  quaternions: Record<string, JointQuaternion>;
}

function hasMeaningfulNumberDelta(
  previous: number | undefined,
  next: number | undefined,
  epsilon: number,
): boolean {
  if (typeof previous !== 'number' || typeof next !== 'number') {
    return previous !== next;
  }

  return Math.abs(previous - next) > epsilon;
}

function hasMeaningfulQuaternionDelta(
  previous: JointQuaternion | undefined,
  next: JointQuaternion | undefined,
  epsilon: number,
): boolean {
  if (!previous || !next) {
    return previous !== next;
  }

  return (
    hasMeaningfulNumberDelta(previous.x, next.x, epsilon) ||
    hasMeaningfulNumberDelta(previous.y, next.y, epsilon) ||
    hasMeaningfulNumberDelta(previous.z, next.z, epsilon) ||
    hasMeaningfulNumberDelta(previous.w, next.w, epsilon)
  );
}

export function createEmptyLinkIkDragKinematicState(): LinkIkDragKinematicState {
  return {
    angles: {},
    quaternions: {},
  };
}

export function cloneLinkIkDragKinematicState(
  state: Partial<LinkIkDragKinematicState> | null | undefined,
): LinkIkDragKinematicState {
  return {
    angles: { ...(state?.angles ?? {}) },
    quaternions: { ...(state?.quaternions ?? {}) },
  };
}

export function hasLinkIkKinematicStateChanges(
  state: Partial<LinkIkDragKinematicState> | null | undefined,
): boolean {
  return Boolean(
    state &&
    (Object.keys(state.angles ?? {}).length > 0 || Object.keys(state.quaternions ?? {}).length > 0),
  );
}

export function resolveLinkIkCommittedStateEpsilon(preview: boolean): number {
  return preview ? LINK_IK_PREVIEW_COMMIT_EPSILON : LINK_IK_COMMIT_EPSILON;
}

export function diffLinkIkDragKinematicState(
  previousState: Partial<LinkIkDragKinematicState> | null | undefined,
  nextState: Partial<LinkIkDragKinematicState> | null | undefined,
  epsilon = LINK_IK_COMMIT_EPSILON,
): LinkIkDragKinematicState {
  const delta = createEmptyLinkIkDragKinematicState();
  const previousAngles = previousState?.angles ?? {};
  const nextAngles = nextState?.angles ?? {};
  const previousQuaternions = previousState?.quaternions ?? {};
  const nextQuaternions = nextState?.quaternions ?? {};

  Object.entries(nextAngles).forEach(([jointId, nextAngle]) => {
    if (hasMeaningfulNumberDelta(previousAngles[jointId], nextAngle, epsilon)) {
      delta.angles[jointId] = nextAngle;
    }
  });

  Object.entries(nextQuaternions).forEach(([jointId, nextQuaternion]) => {
    if (hasMeaningfulQuaternionDelta(previousQuaternions[jointId], nextQuaternion, epsilon)) {
      delta.quaternions[jointId] = nextQuaternion;
    }
  });

  return delta;
}

export function hasMeaningfulLinkIkTargetDelta(
  previousWorldPosition: THREE.Vector3 | null,
  nextWorldPosition: THREE.Vector3,
): boolean {
  if (!previousWorldPosition) {
    return true;
  }

  return previousWorldPosition.distanceToSquared(nextWorldPosition) > LINK_IK_TARGET_EPSILON_SQ;
}

export function shouldScheduleLinkIkPreviewSolve({
  pendingTargetWorldPosition,
  lastSolvedTargetWorldPosition,
  nextTargetWorldPosition,
  hasMeaningfulDragMotion,
}: {
  pendingTargetWorldPosition: THREE.Vector3 | null;
  lastSolvedTargetWorldPosition: THREE.Vector3 | null;
  nextTargetWorldPosition: THREE.Vector3;
  hasMeaningfulDragMotion: boolean;
}): boolean {
  if (!hasMeaningfulDragMotion) {
    return false;
  }

  if (pendingTargetWorldPosition) {
    return hasMeaningfulLinkIkTargetDelta(pendingTargetWorldPosition, nextTargetWorldPosition);
  }

  if (lastSolvedTargetWorldPosition) {
    return hasMeaningfulLinkIkTargetDelta(lastSolvedTargetWorldPosition, nextTargetWorldPosition);
  }

  return true;
}

export function resolveLinkIkSolveRequestOptions(
  preview: boolean,
):
  | Pick<LinkIkPositionSolveRequest, 'maxIterations' | 'positionTolerance' | 'stallTolerance'>
  | undefined {
  if (!preview) {
    return undefined;
  }

  return {
    maxIterations: LINK_IK_PREVIEW_MAX_ITERATIONS,
    positionTolerance: LINK_IK_PREVIEW_POSITION_TOLERANCE,
    stallTolerance: LINK_IK_PREVIEW_STALL_TOLERANCE,
  };
}
