import { resolveJointKey } from '@/core/robot';
import { useRobotStore } from '@/store';
import type { ViewerJointChangeContext } from '@/features/editor';
import type { JointQuaternion, UrdfJoint } from '@/types';

export interface ResolvedJointMotion {
  angles: Record<string, number>;
  quaternions: Record<string, JointQuaternion>;
}

export function resolveViewerJointChangeContext(
  joints: Record<string, UrdfJoint>,
  jointName: string,
  angle: number,
  context?: ViewerJointChangeContext,
): ResolvedJointMotion | null {
  if (!context) {
    return null;
  }

  const jointId = resolveJointKey(joints, jointName);
  const angles: Record<string, number> = {};
  const quaternions: Record<string, JointQuaternion> = {};

  Object.entries(context.jointAngles ?? {}).forEach(([jointNameOrId, nextAngle]) => {
    if (!Number.isFinite(nextAngle)) {
      return;
    }

    const resolvedJointId = resolveJointKey(joints, jointNameOrId);
    if (resolvedJointId) {
      angles[resolvedJointId] = nextAngle;
    }
  });

  Object.entries(context.jointQuaternions ?? {}).forEach(([jointNameOrId, quaternion]) => {
    const resolvedJointId = resolveJointKey(joints, jointNameOrId);
    if (resolvedJointId) {
      quaternions[resolvedJointId] = quaternion;
    }
  });

  if (
    jointId &&
    Number.isFinite(angle) &&
    (Object.keys(angles).length > 0 || Object.keys(quaternions).length > 0) &&
    !Object.hasOwn(angles, jointId)
  ) {
    angles[jointId] = angle;
  }

  if (Object.keys(angles).length === 0 && Object.keys(quaternions).length === 0) {
    return null;
  }

  return { angles, quaternions };
}

export function applyJointMotionToJoints(
  joints: Record<string, UrdfJoint>,
  motion: ResolvedJointMotion,
): Record<string, UrdfJoint> {
  const nextJoints = { ...joints };

  Object.entries(motion.angles).forEach(([resolvedJointId, resolvedAngle]) => {
    const joint = nextJoints[resolvedJointId];
    if (joint) {
      nextJoints[resolvedJointId] = {
        ...joint,
        angle: resolvedAngle,
      };
    }
  });

  Object.entries(motion.quaternions).forEach(([resolvedJointId, quaternion]) => {
    const joint = nextJoints[resolvedJointId];
    if (joint) {
      nextJoints[resolvedJointId] = {
        ...joint,
        quaternion,
      };
    }
  });

  return nextJoints;
}

export function syncAssemblyComponentJointMotion(
  componentId: string,
  nextJoints: Record<string, UrdfJoint>,
): void {
  const angles: Record<string, number> = {};
  const quaternions: Record<string, JointQuaternion> = {};

  for (const [jointId, joint] of Object.entries(nextJoints)) {
    if (typeof joint.angle === 'number' && Number.isFinite(joint.angle)) {
      angles[jointId] = joint.angle;
    }
    if (joint.quaternion) {
      quaternions[jointId] = joint.quaternion;
    }
  }

  useRobotStore.getState().setComponentJointMotion(componentId, angles, quaternions);
}
