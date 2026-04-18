import * as THREE from 'three';

import { isAssemblyComponentIndividuallyTransformable } from '@/core/robot/assemblyTransforms';
import { resolveAssemblyComponentLinkId } from '@/core/robot/assemblyBridgeAlignment';
import type { AssemblyState, RobotData, UrdfOrigin } from '@/types';

export type AssemblyComponentTransformTarget =
  | {
      kind: 'component';
      componentId: string;
      object: THREE.Object3D | null;
    }
  | {
      kind: 'bridge';
      bridgeId: string;
      object: THREE.Object3D | null;
    }
  | null;

interface ResolveAssemblyComponentTransformTargetOptions {
  robot: Pick<RobotData, 'joints'>;
  assemblyState: AssemblyState | null | undefined;
  componentId: string | null;
  jointObjects: Record<string, THREE.Object3D | null>;
}

export function resolveAssemblyComponentTransformTarget({
  robot,
  assemblyState,
  componentId,
  jointObjects,
}: ResolveAssemblyComponentTransformTargetOptions): AssemblyComponentTransformTarget {
  if (!assemblyState || !componentId) {
    return null;
  }

  const component = assemblyState.components[componentId];
  if (!component) {
    return null;
  }

  if (!isAssemblyComponentIndividuallyTransformable(assemblyState, componentId)) {
    const incomingBridges = Object.values(assemblyState.bridges).filter(
      (bridge) =>
        bridge.childComponentId === componentId &&
        Boolean(resolveAssemblyComponentLinkId(component, bridge.childLinkId)),
    );

    if (incomingBridges.length === 1) {
      const bridge = incomingBridges[0]!;
      return {
        kind: 'bridge',
        bridgeId: bridge.id,
        object: jointObjects[bridge.id] ?? null,
      };
    }

    return {
      kind: 'component',
      componentId,
      object: jointObjects[`__workspace_world__::component::${componentId}`] ?? null,
    };
  }

  const rootJoint = Object.values(robot.joints).find(
    (joint) => joint.childLinkId === component.robot.rootLinkId,
  );
  if (!rootJoint) {
    return null;
  }

  return {
    kind: 'component',
    componentId,
    object: jointObjects[rootJoint.id] ?? null,
  };
}

export function decomposeJointPivotMatrixToOrigin(matrix: THREE.Matrix4): UrdfOrigin {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'ZYX');

  matrix.decompose(position, quaternion, scale);
  euler.setFromQuaternion(quaternion, 'ZYX');

  return {
    xyz: {
      x: position.x,
      y: position.y,
      z: position.z,
    },
    rpy: {
      r: euler.x,
      p: euler.y,
      y: euler.z,
    },
    quatXyzw: {
      x: quaternion.x,
      y: quaternion.y,
      z: quaternion.z,
      w: quaternion.w,
    },
  };
}
