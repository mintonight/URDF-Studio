import * as THREE from 'three';

import type { RobotData, UrdfJoint } from '@/types';
import {
  WORKSPACE_VIEWER_COMPONENT_ROOT_JOINT_PREFIX,
  WORKSPACE_VIEWER_WORLD_ROOT_ID,
} from './workspaceSourceSyncUtils.ts';

const WORKSPACE_VIEWER_EULER_ORDER: THREE.EulerOrder = 'ZYX';
const WORKSPACE_VIEWER_TRANSFORM_EPSILON = 1e-6;

interface JointPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

function resolveWorkspaceViewerJointPose(joint: UrdfJoint): JointPose {
  const quaternion = joint.origin.quatXyzw
    ? new THREE.Quaternion(
      joint.origin.quatXyzw.x,
      joint.origin.quatXyzw.y,
      joint.origin.quatXyzw.z,
      joint.origin.quatXyzw.w,
    )
    : new THREE.Quaternion().setFromEuler(new THREE.Euler(
      joint.origin.rpy.r,
      joint.origin.rpy.p,
      joint.origin.rpy.y,
      WORKSPACE_VIEWER_EULER_ORDER,
    ));

  if (quaternion.lengthSq() === 0) {
    quaternion.identity();
  } else {
    quaternion.normalize();
  }

  return {
    position: new THREE.Vector3(
      joint.origin.xyz.x,
      joint.origin.xyz.y,
      joint.origin.xyz.z,
    ),
    quaternion,
  };
}

function buildJointOriginFromPose(pose: JointPose): UrdfJoint['origin'] {
  const normalizedQuaternion = pose.quaternion.clone();
  if (normalizedQuaternion.lengthSq() === 0) {
    normalizedQuaternion.identity();
  } else {
    normalizedQuaternion.normalize();
  }

  const euler = new THREE.Euler(0, 0, 0, WORKSPACE_VIEWER_EULER_ORDER)
    .setFromQuaternion(normalizedQuaternion, WORKSPACE_VIEWER_EULER_ORDER);

  return {
    xyz: {
      x: pose.position.x,
      y: pose.position.y,
      z: pose.position.z,
    },
    rpy: {
      r: euler.x,
      p: euler.y,
      y: euler.z,
    },
    quatXyzw: {
      x: normalizedQuaternion.x,
      y: normalizedQuaternion.y,
      z: normalizedQuaternion.z,
      w: normalizedQuaternion.w,
    },
  };
}

function isWorkspaceViewerSyntheticRootJoint(
  jointId: string,
  joint: UrdfJoint | undefined,
): joint is UrdfJoint {
  return Boolean(
    joint
    && joint.parentLinkId === WORKSPACE_VIEWER_WORLD_ROOT_ID
    && jointId.startsWith(WORKSPACE_VIEWER_COMPONENT_ROOT_JOINT_PREFIX),
  );
}

function collectWorkspaceViewerSyntheticRootJointIds(robot: RobotData | null): string[] {
  if (!robot || robot.rootLinkId !== WORKSPACE_VIEWER_WORLD_ROOT_ID) {
    return [];
  }

  return Object.entries(robot.joints)
    .filter(([jointId, joint]) => isWorkspaceViewerSyntheticRootJoint(jointId, joint))
    .map(([jointId]) => jointId)
    .sort();
}

function haveSameSyntheticRootJointSet(
  fromRobot: RobotData,
  toRobot: RobotData,
): boolean {
  const fromIds = collectWorkspaceViewerSyntheticRootJointIds(fromRobot);
  const toIds = collectWorkspaceViewerSyntheticRootJointIds(toRobot);

  if (fromIds.length === 0 || fromIds.length !== toIds.length) {
    return false;
  }

  return fromIds.every((jointId, index) => {
    if (jointId !== toIds[index]) {
      return false;
    }

    const fromJoint = fromRobot.joints[jointId];
    const toJoint = toRobot.joints[jointId];
    return Boolean(
      fromJoint
      && toJoint
      && fromJoint.type === toJoint.type
      && fromJoint.parentLinkId === toJoint.parentLinkId
      && fromJoint.childLinkId === toJoint.childLinkId,
    );
  });
}

function posesDiffer(left: JointPose, right: JointPose): boolean {
  if (left.position.distanceToSquared(right.position) > WORKSPACE_VIEWER_TRANSFORM_EPSILON) {
    return true;
  }

  return 1 - Math.abs(left.quaternion.dot(right.quaternion)) > WORKSPACE_VIEWER_TRANSFORM_EPSILON;
}

export function canAnimateWorkspaceViewerRobotTransition(
  fromRobot: RobotData | null,
  toRobot: RobotData | null,
): fromRobot is RobotData {
  if (!fromRobot || !toRobot) {
    return false;
  }

  if (
    fromRobot.rootLinkId !== WORKSPACE_VIEWER_WORLD_ROOT_ID
    || toRobot.rootLinkId !== WORKSPACE_VIEWER_WORLD_ROOT_ID
  ) {
    return false;
  }

  return haveSameSyntheticRootJointSet(fromRobot, toRobot);
}

export function hasWorkspaceViewerRobotTransitionDiff(
  fromRobot: RobotData | null,
  toRobot: RobotData | null,
): boolean {
  if (!toRobot || !canAnimateWorkspaceViewerRobotTransition(fromRobot, toRobot)) {
    return false;
  }

  return collectWorkspaceViewerSyntheticRootJointIds(toRobot).some((jointId) => {
    const fromJoint = fromRobot.joints[jointId];
    const toJoint = toRobot.joints[jointId];
    if (!fromJoint || !toJoint) {
      return false;
    }

    return posesDiffer(
      resolveWorkspaceViewerJointPose(fromJoint),
      resolveWorkspaceViewerJointPose(toJoint),
    );
  });
}

export function buildWorkspaceViewerRobotTransitionFrame({
  fromRobot,
  toRobot,
  alpha,
}: {
  fromRobot: RobotData | null;
  toRobot: RobotData | null;
  alpha: number;
}): RobotData | null {
  if (!toRobot) {
    return null;
  }

  if (!canAnimateWorkspaceViewerRobotTransition(fromRobot, toRobot)) {
    return toRobot;
  }

  const clampedAlpha = THREE.MathUtils.clamp(alpha, 0, 1);
  if (clampedAlpha >= 1) {
    return toRobot;
  }

  const joints = { ...toRobot.joints };
  let hasAnimatedJoint = false;

  collectWorkspaceViewerSyntheticRootJointIds(toRobot).forEach((jointId) => {
    const fromJoint = fromRobot.joints[jointId];
    const toJoint = toRobot.joints[jointId];
    if (!fromJoint || !toJoint) {
      return;
    }

    const fromPose = resolveWorkspaceViewerJointPose(fromJoint);
    const toPose = resolveWorkspaceViewerJointPose(toJoint);
    if (!posesDiffer(fromPose, toPose)) {
      return;
    }

    const nextPose: JointPose = {
      position: fromPose.position.clone().lerp(toPose.position, clampedAlpha),
      quaternion: fromPose.quaternion.clone().slerp(toPose.quaternion, clampedAlpha),
    };

    joints[jointId] = {
      ...toJoint,
      origin: buildJointOriginFromPose(nextPose),
    };
    hasAnimatedJoint = true;
  });

  if (!hasAnimatedJoint) {
    return toRobot;
  }

  return {
    ...toRobot,
    joints,
  };
}
