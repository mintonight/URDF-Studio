import * as THREE from 'three';

import type { UrdfOrigin } from '@/types';

export function decomposeJointPivotMatrixToOrigin(matrix: THREE.Matrix4): UrdfOrigin {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'ZYX');

  matrix.decompose(position, quaternion, scale);
  euler.setFromQuaternion(quaternion, 'ZYX');

  return {
    xyz: { x: position.x, y: position.y, z: position.z },
    rpy: { r: euler.x, p: euler.y, y: euler.z },
    quatXyzw: {
      x: quaternion.x,
      y: quaternion.y,
      z: quaternion.z,
      w: quaternion.w,
    },
  };
}
