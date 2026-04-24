import * as THREE from 'three';
import { getParentJointByChildLink, resolveJointKey } from '@/core/robot';
import { URDFJoint as RuntimeURDFJoint } from '@/core/parsers/urdf/loader';
import type { InteractionSelection, UrdfJoint } from '@/types';
import { applyOriginToJoint } from './robotLoaderPatchUtils';

type JointSelectionLike =
  | Pick<InteractionSelection, 'type' | 'id' | 'helperKind'>
  | null
  | undefined;

export interface OriginTransformJointIdentity {
  jointId: string;
  jointName: string | null;
}

export interface OriginTransformTarget {
  jointId: string;
  runtimeJointKey: string;
  runtimeJoint: RuntimeURDFJoint;
}

const DEFAULT_ORIGIN = {
  xyz: { x: 0, y: 0, z: 0 },
  rpy: { r: 0, p: 0, y: 0 },
} satisfies UrdfJoint['origin'];

function getCurrentJointValues(joint: RuntimeURDFJoint): number[] {
  const jointValue = (
    joint as RuntimeURDFJoint & {
      jointValue?: unknown;
      angle?: number;
    }
  ).jointValue;

  if (Array.isArray(jointValue)) {
    return jointValue.filter((value): value is number => typeof value === 'number');
  }

  if (typeof jointValue === 'number') {
    return [jointValue];
  }

  if (typeof (joint as RuntimeURDFJoint & { angle?: number }).angle === 'number') {
    return [(joint as RuntimeURDFJoint & { angle?: number }).angle as number];
  }

  return [];
}

function resolveRuntimeJointKey(
  joints: Record<string, RuntimeURDFJoint> | null | undefined,
  jointNameOrId: string | null | undefined,
): string | null {
  if (!joints || !jointNameOrId) {
    return null;
  }

  if (jointNameOrId in joints) {
    return jointNameOrId;
  }

  const resolvedEntry = Object.entries(joints).find(([, joint]) => joint?.name === jointNameOrId);
  return resolvedEntry?.[0] ?? null;
}

export function resolveOriginTransformJointIdentity(
  selection: JointSelectionLike,
  robotJoints?: Record<string, UrdfJoint>,
): OriginTransformJointIdentity | null {
  if (!selection?.id || selection.helperKind !== 'origin-axes') {
    return null;
  }

  if (selection.type === 'joint') {
    const jointId = resolveJointKey(robotJoints ?? {}, selection.id) ?? selection.id;
    return {
      jointId,
      jointName: robotJoints?.[jointId]?.name ?? selection.id,
    };
  }

  if (selection.type !== 'link' || !robotJoints) {
    return null;
  }

  const parentJoint =
    getParentJointByChildLink({ joints: robotJoints } as Pick<
      { joints: Record<string, UrdfJoint> },
      'joints'
    >).get(selection.id) ?? null;
  if (!parentJoint) {
    return null;
  }

  return {
    jointId: parentJoint.id,
    jointName: parentJoint.name ?? parentJoint.id,
  };
}

export function resolveOriginTransformJointId(
  selection: JointSelectionLike,
  robotJoints?: Record<string, UrdfJoint>,
): string | null {
  return resolveOriginTransformJointIdentity(selection, robotJoints)?.jointId ?? null;
}

export function resolveOriginTransformTarget(
  robot: THREE.Object3D | null,
  selection: JointSelectionLike,
  robotJoints?: Record<string, UrdfJoint>,
): OriginTransformTarget | null {
  if (!robot) {
    return null;
  }

  const jointIdentity = resolveOriginTransformJointIdentity(selection, robotJoints);
  if (!jointIdentity) {
    return null;
  }

  const runtimeJoints = (robot as THREE.Object3D & { joints?: Record<string, RuntimeURDFJoint> })
    .joints;
  const runtimeJointKey =
    resolveRuntimeJointKey(runtimeJoints, jointIdentity.jointName ?? jointIdentity.jointId) ??
    resolveRuntimeJointKey(runtimeJoints, jointIdentity.jointId) ??
    jointIdentity.jointName ??
    jointIdentity.jointId;
  const runtimeJoint = runtimeJoints?.[runtimeJointKey] ?? null;
  if (!runtimeJoint) {
    return null;
  }

  return {
    jointId: jointIdentity.jointId,
    runtimeJointKey,
    runtimeJoint,
  };
}

export function extractRuntimeJointOrigin(joint: RuntimeURDFJoint): UrdfJoint['origin'] {
  const originPosition =
    joint.origPosition instanceof THREE.Vector3 ? joint.origPosition : joint.position;
  const originQuaternion =
    joint.origQuaternion instanceof THREE.Quaternion ? joint.origQuaternion : joint.quaternion;
  const rotation = new THREE.Euler(0, 0, 0, 'ZYX').setFromQuaternion(originQuaternion, 'ZYX');

  return {
    xyz: {
      x: originPosition.x,
      y: originPosition.y,
      z: originPosition.z,
    },
    rpy: {
      r: rotation.x,
      p: rotation.y,
      y: rotation.z,
    },
  };
}

export function applyOriginToRuntimeJoint(
  joint: RuntimeURDFJoint,
  origin: UrdfJoint['origin'] | undefined,
): UrdfJoint['origin'] {
  const nextOrigin = origin ?? DEFAULT_ORIGIN;
  const currentValues = getCurrentJointValues(joint);

  applyOriginToJoint(joint, nextOrigin);
  joint.origPosition = joint.position.clone();
  joint.origQuaternion = joint.quaternion.clone();

  if (joint.jointType !== 'fixed') {
    joint.jointValue = null;
  }

  switch (joint.jointType) {
    case 'fixed':
      joint.position.copy(joint.origPosition);
      joint.quaternion.copy(joint.origQuaternion);
      joint.matrixWorldNeedsUpdate = true;
      break;
    case 'continuous':
    case 'revolute':
    case 'prismatic':
      joint.setJointValue(currentValues[0] ?? 0);
      break;
    case 'planar':
      joint.setJointValue(currentValues[0] ?? 0, currentValues[1] ?? 0, currentValues[2] ?? 0);
      break;
    case 'floating':
      joint.setJointValue(
        currentValues[0] ?? 0,
        currentValues[1] ?? 0,
        currentValues[2] ?? 0,
        currentValues[3] ?? 0,
        currentValues[4] ?? 0,
        currentValues[5] ?? 0,
      );
      break;
    default:
      joint.matrixWorldNeedsUpdate = true;
      break;
  }

  joint.updateMatrixWorld(true);
  return nextOrigin;
}
