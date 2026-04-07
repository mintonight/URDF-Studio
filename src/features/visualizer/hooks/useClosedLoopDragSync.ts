import { useCallback, useRef } from 'react';
import * as THREE from 'three';

import {
  getJointMotionPose,
  resolveClosedLoopJointOriginCompensationDetailed,
  resolveJointKey,
} from '@/core/robot';
import type { JointQuaternion, RobotState, UrdfJoint } from '@/types';
import { useJointInteractionPreviewStore } from '@/store';
import { createClosedLoopMotionPreviewSession } from '@/shared/utils/robot/closedLoopMotionPreview';

interface UseClosedLoopDragSyncParams {
  robot: RobotState;
  jointPivots: Record<string, THREE.Group | null>;
  jointMotions: Record<string, THREE.Group | null>;
}

const TEMP_EULER = new THREE.Euler(0, 0, 0, 'ZYX');
const PREVIEW_EPSILON = 1e-6;
// AppLayout no longer consumes this global preview store during drag, so keeping
// per-frame cross-app preview writes only burns main-thread time.
const APP_WIDE_JOINT_INTERACTION_PREVIEW_ENABLED = false;

function applyJointOriginToPivot(pivot: THREE.Group, origin: UrdfJoint['origin']): void {
  pivot.position.set(origin.xyz.x ?? 0, origin.xyz.y ?? 0, origin.xyz.z ?? 0);
  pivot.quaternion.setFromEuler(
    new THREE.Euler(origin.rpy.r ?? 0, origin.rpy.p ?? 0, origin.rpy.y ?? 0, 'ZYX'),
  );
  pivot.updateMatrixWorld(true);
}

function applyJointMotionToGroup(
  motionGroup: THREE.Group,
  joint: UrdfJoint,
  overrides: Parameters<typeof getJointMotionPose>[1] = {},
): void {
  const pose = getJointMotionPose(joint, overrides);
  motionGroup.position.copy(pose.position);
  motionGroup.quaternion.copy(pose.quaternion);
  motionGroup.updateMatrixWorld(true);
}

function originsEqual(a: UrdfJoint['origin'], b: UrdfJoint['origin']): boolean {
  return (
    Math.abs((a.xyz.x ?? 0) - (b.xyz.x ?? 0)) <= PREVIEW_EPSILON &&
    Math.abs((a.xyz.y ?? 0) - (b.xyz.y ?? 0)) <= PREVIEW_EPSILON &&
    Math.abs((a.xyz.z ?? 0) - (b.xyz.z ?? 0)) <= PREVIEW_EPSILON &&
    Math.abs((a.rpy.r ?? 0) - (b.rpy.r ?? 0)) <= PREVIEW_EPSILON &&
    Math.abs((a.rpy.p ?? 0) - (b.rpy.p ?? 0)) <= PREVIEW_EPSILON &&
    Math.abs((a.rpy.y ?? 0) - (b.rpy.y ?? 0)) <= PREVIEW_EPSILON
  );
}

function quaternionsEqual(a: JointQuaternion, b: JointQuaternion): boolean {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  return Math.abs(1 - Math.abs(dot)) <= PREVIEW_EPSILON;
}

export function useClosedLoopDragSync({
  robot,
  jointPivots,
  jointMotions,
}: UseClosedLoopDragSyncParams) {
  const previewedOriginsRef = useRef<Record<string, UrdfJoint['origin']>>({});
  const previewedMotionAnglesRef = useRef<Record<string, number>>({});
  const previewedMotionQuaternionsRef = useRef<Record<string, JointQuaternion>>({});
  const motionPreviewSessionRef = useRef(createClosedLoopMotionPreviewSession());
  const previewSessionIdCounterRef = useRef(0);
  const activePreviewSessionIdRef = useRef<string | null>(null);

  const ensurePreviewSessionId = useCallback(() => {
    if (activePreviewSessionIdRef.current !== null) {
      return activePreviewSessionIdRef.current;
    }

    previewSessionIdCounterRef.current += 1;
    activePreviewSessionIdRef.current = String(previewSessionIdCounterRef.current);
    return activePreviewSessionIdRef.current;
  }, []);

  const publishJointInteractionPreview = useCallback(
    (preview: {
      activeJointId: string | null;
      jointAngles?: Record<string, number>;
      jointQuaternions?: Record<string, JointQuaternion>;
      jointOrigins?: Record<string, UrdfJoint['origin']>;
    }) => {
      if (!APP_WIDE_JOINT_INTERACTION_PREVIEW_ENABLED) {
        return;
      }

      useJointInteractionPreviewStore.getState().publishPreview({
        source: 'visualizer',
        dragSessionId: ensurePreviewSessionId(),
        activeJointId: preview.activeJointId,
        jointAngles: { ...(preview.jointAngles ?? {}) },
        jointQuaternions: { ...(preview.jointQuaternions ?? {}) },
        jointOrigins: { ...(preview.jointOrigins ?? {}) },
      });
    },
    [ensurePreviewSessionId],
  );

  const clearPublishedJointInteractionPreview = useCallback(() => {
    if (!APP_WIDE_JOINT_INTERACTION_PREVIEW_ENABLED) {
      activePreviewSessionIdRef.current = null;
      return;
    }

    const activeSessionId = activePreviewSessionIdRef.current;
    activePreviewSessionIdRef.current = null;

    if (activeSessionId === null) {
      return;
    }

    useJointInteractionPreviewStore.getState().clearPreview({
      source: 'visualizer',
      dragSessionId: activeSessionId,
    });
  }, []);

  const clearOriginPreview = useCallback(() => {
    Object.keys(previewedOriginsRef.current).forEach((jointId) => {
      const joint = robot.joints[jointId];
      const pivot = jointPivots[jointId];
      if (!joint || !pivot) {
        return;
      }

      applyJointOriginToPivot(pivot, joint.origin);
    });
    previewedOriginsRef.current = {};
  }, [jointPivots, robot.joints]);

  const clearMotionPreview = useCallback(() => {
    const previewedJointIds = new Set([
      ...Object.keys(previewedMotionAnglesRef.current),
      ...Object.keys(previewedMotionQuaternionsRef.current),
    ]);

    previewedJointIds.forEach((jointId) => {
      const joint = robot.joints[jointId];
      const motionGroup = jointMotions[jointId];
      if (!joint || !motionGroup) {
        return;
      }

      applyJointMotionToGroup(motionGroup, joint);
    });
    previewedMotionAnglesRef.current = {};
    previewedMotionQuaternionsRef.current = {};
  }, [jointMotions, robot.joints]);

  const reconcileOriginPreview = useCallback(
    (nextOrigins: Record<string, UrdfJoint['origin']>) => {
      const previousOrigins = previewedOriginsRef.current;

      Object.keys(previousOrigins).forEach((jointId) => {
        if (jointId in nextOrigins) {
          return;
        }

        const joint = robot.joints[jointId];
        const pivot = jointPivots[jointId];
        if (!joint || !pivot) {
          return;
        }

        applyJointOriginToPivot(pivot, joint.origin);
      });

      Object.entries(nextOrigins).forEach(([jointId, origin]) => {
        const pivot = jointPivots[jointId];
        if (!pivot) {
          return;
        }

        const previousOrigin = previousOrigins[jointId];
        if (previousOrigin && originsEqual(previousOrigin, origin)) {
          return;
        }

        applyJointOriginToPivot(pivot, origin);
      });

      previewedOriginsRef.current = nextOrigins;
    },
    [jointPivots, robot.joints],
  );

  const reconcileMotionPreview = useCallback(
    (nextAngles: Record<string, number>, nextQuaternions: Record<string, JointQuaternion>) => {
      const previousAngles = previewedMotionAnglesRef.current;
      const previousQuaternions = previewedMotionQuaternionsRef.current;
      const jointIds = new Set([
        ...Object.keys(previousAngles),
        ...Object.keys(previousQuaternions),
        ...Object.keys(nextAngles),
        ...Object.keys(nextQuaternions),
      ]);

      jointIds.forEach((jointId) => {
        const joint = robot.joints[jointId];
        const motionGroup = jointMotions[jointId];
        if (!joint || !motionGroup) {
          return;
        }

        const previousAngle = previousAngles[jointId];
        const nextAngle = nextAngles[jointId];
        const previousQuaternion = previousQuaternions[jointId];
        const nextQuaternion = nextQuaternions[jointId];
        const hasNextOverride = nextAngle !== undefined || nextQuaternion !== undefined;

        if (!hasNextOverride) {
          if (previousAngle !== undefined || previousQuaternion !== undefined) {
            applyJointMotionToGroup(motionGroup, joint);
          }
          return;
        }

        const angleChanged =
          previousAngle === undefined
            ? nextAngle !== undefined
            : nextAngle === undefined || Math.abs(previousAngle - nextAngle) > PREVIEW_EPSILON;
        const quaternionChanged =
          previousQuaternion === undefined
            ? nextQuaternion !== undefined
            : nextQuaternion === undefined || !quaternionsEqual(previousQuaternion, nextQuaternion);

        if (!angleChanged && !quaternionChanged) {
          return;
        }

        applyJointMotionToGroup(motionGroup, joint, {
          angles: nextAngle === undefined ? undefined : { [jointId]: nextAngle },
          quaternions: nextQuaternion === undefined ? undefined : { [jointId]: nextQuaternion },
        });
      });

      previewedMotionAnglesRef.current = nextAngles;
      previewedMotionQuaternionsRef.current = nextQuaternions;
    },
    [jointMotions, robot.joints],
  );

  const resetConstraintPreview = useCallback(() => {
    motionPreviewSessionRef.current.reset();
    clearOriginPreview();
    clearMotionPreview();
    clearPublishedJointInteractionPreview();
  }, [clearMotionPreview, clearOriginPreview, clearPublishedJointInteractionPreview]);

  const previewJointKinematics = useCallback(
    (jointAngles: Record<string, number>, jointQuaternions: Record<string, JointQuaternion>) => {
      clearOriginPreview();
      reconcileMotionPreview(jointAngles, jointQuaternions);
      publishJointInteractionPreview({
        activeJointId: null,
        jointAngles,
        jointQuaternions,
      });
    },
    [clearOriginPreview, publishJointInteractionPreview, reconcileMotionPreview],
  );

  const clearJointKinematicsPreview = useCallback(() => {
    clearOriginPreview();
    reconcileMotionPreview({}, {});
    clearPublishedJointInteractionPreview();
  }, [clearOriginPreview, clearPublishedJointInteractionPreview, reconcileMotionPreview]);

  const previewConstraintCompensation = useCallback(
    (selectedObject: THREE.Group, selectionId: string | null | undefined) => {
      const selectedJointId = resolveJointKey(robot.joints, selectionId);
      if (!selectedJointId) {
        reconcileOriginPreview({});
        reconcileMotionPreview({}, {});
        clearPublishedJointInteractionPreview();
        return;
      }

      TEMP_EULER.setFromQuaternion(selectedObject.quaternion, 'ZYX');
      const selectedOrigin: UrdfJoint['origin'] = {
        xyz: {
          x: selectedObject.position.x,
          y: selectedObject.position.y,
          z: selectedObject.position.z,
        },
        rpy: {
          r: TEMP_EULER.x,
          p: TEMP_EULER.y,
          y: TEMP_EULER.z,
        },
      };

      const compensation = resolveClosedLoopJointOriginCompensationDetailed(
        robot,
        selectedJointId,
        selectedOrigin,
      );
      reconcileOriginPreview(compensation.origins);
      reconcileMotionPreview({}, compensation.quaternions);
      publishJointInteractionPreview({
        activeJointId: selectedJointId,
        jointOrigins: {
          [selectedJointId]: selectedOrigin,
          ...compensation.origins,
        },
        jointQuaternions: compensation.quaternions,
      });
    },
    [
      clearPublishedJointInteractionPreview,
      publishJointInteractionPreview,
      reconcileMotionPreview,
      reconcileOriginPreview,
      robot,
    ],
  );

  const previewConstraintMotionCompensation = useCallback(
    (selectionId: string | null | undefined, selectedAngle: number) => {
      clearOriginPreview();

      const selectedJointId = resolveJointKey(robot.joints, selectionId);
      if (!selectedJointId) {
        reconcileMotionPreview({}, {});
        clearPublishedJointInteractionPreview();
        return { appliedAngle: selectedAngle, constrained: false };
      }

      motionPreviewSessionRef.current.setBaseRobot(robot);

      try {
        const compensation = motionPreviewSessionRef.current.solve(selectedJointId, selectedAngle);
        reconcileMotionPreview(compensation.angles, compensation.quaternions);
        publishJointInteractionPreview({
          activeJointId: selectedJointId,
          jointAngles: compensation.angles,
          jointQuaternions: compensation.quaternions,
        });
        return {
          appliedAngle: compensation.appliedAngle ?? selectedAngle,
          constrained: compensation.constrained,
        };
      } catch (error) {
        console.warn(
          '[useClosedLoopDragSync] Closed-loop motion preview solve failed; clearing preview compensation.',
          error,
        );
        reconcileMotionPreview({}, {});
        clearPublishedJointInteractionPreview();
        return { appliedAngle: selectedAngle, constrained: false };
      }
    },
    [
      clearOriginPreview,
      clearPublishedJointInteractionPreview,
      publishJointInteractionPreview,
      reconcileMotionPreview,
      robot,
    ],
  );

  return {
    previewJointKinematics,
    clearJointKinematicsPreview,
    previewConstraintCompensation,
    previewConstraintMotionCompensation,
    resetConstraintPreview,
  };
}
