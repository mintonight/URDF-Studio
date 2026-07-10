import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { decomposeJointPivotMatrixToOrigin } from './assemblyTransformControlsShared.ts';

test('decomposeJointPivotMatrixToOrigin preserves translation and ZYX rotation', () => {
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0.2, -0.3, 0.4, 'ZYX'),
  );
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(1, 2, 3),
    quaternion,
    new THREE.Vector3(1, 1, 1),
  );

  const origin = decomposeJointPivotMatrixToOrigin(matrix);

  assert.deepEqual(origin.xyz, { x: 1, y: 2, z: 3 });
  assert.ok(Math.abs(origin.rpy.r - 0.2) < 1e-9);
  assert.ok(Math.abs(origin.rpy.p + 0.3) < 1e-9);
  assert.ok(Math.abs(origin.rpy.y - 0.4) < 1e-9);
  assert.ok(Math.abs(origin.quatXyzw!.x - quaternion.x) < 1e-9);
  assert.ok(Math.abs(origin.quatXyzw!.y - quaternion.y) < 1e-9);
  assert.ok(Math.abs(origin.quatXyzw!.z - quaternion.z) < 1e-9);
  assert.ok(Math.abs(origin.quatXyzw!.w - quaternion.w) < 1e-9);
});
