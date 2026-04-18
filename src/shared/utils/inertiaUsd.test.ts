import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { computeUsdInertiaProperties } from './inertiaUsd.ts';
import { MathUtils } from './math.ts';

function assertQuaternionClose(
  actual: THREE.Quaternion,
  expected: THREE.Quaternion,
  tolerance = 1e-6,
): void {
  assert.ok(
    actual.angleTo(expected) <= tolerance,
    `expected quaternion ${actual.toArray().join(',')} to match ${expected.toArray().join(',')}`,
  );
}

function buildQuaternionFromEigenvectors(eigenvectors: number[][]): THREE.Quaternion {
  const xAxis = new THREE.Vector3(
    eigenvectors[0]?.[0] ?? 0,
    eigenvectors[1]?.[0] ?? 0,
    eigenvectors[2]?.[0] ?? 0,
  ).normalize();
  const yAxis = new THREE.Vector3(
    eigenvectors[0]?.[1] ?? 0,
    eigenvectors[1]?.[1] ?? 0,
    eigenvectors[2]?.[1] ?? 0,
  ).normalize();
  let zAxis = new THREE.Vector3(
    eigenvectors[0]?.[2] ?? 0,
    eigenvectors[1]?.[2] ?? 0,
    eigenvectors[2]?.[2] ?? 0,
  ).normalize();

  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  if (basis.determinant() < 0) {
    zAxis = zAxis.multiplyScalar(-1);
  }

  return new THREE.Quaternion()
    .setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis))
    .normalize();
}

test('preserves raw eigenvalue order and composes inertial-origin rotation using Isaac principal axes', () => {
  const originQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0.2, -0.3, 0.4, 'XYZ'),
  );
  const principalBasis = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-0.35, 0.6, -0.15, 'XYZ'),
  );
  const diagonalMatrix = new THREE.Matrix3().set(1.3, 0, 0, 0, 4.7, 0, 0, 0, 2.2);
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(principalBasis);
  const rotationMatrix = new THREE.Matrix3().setFromMatrix4(rotation);
  const inertiaMatrix = rotationMatrix
    .clone()
    .multiply(diagonalMatrix)
    .multiply(rotationMatrix.clone().transpose());
  const decomposition = MathUtils.computeEigenDecomposition3x3(inertiaMatrix);
  const expectedPrincipalAxes = buildQuaternionFromEigenvectors(
    decomposition.eigenvectors,
  ).conjugate();

  const actual = computeUsdInertiaProperties({
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0.2, p: -0.3, y: 0.4 },
    },
    inertia: {
      ixx: inertiaMatrix.elements[0] ?? 0,
      ixy: inertiaMatrix.elements[3] ?? 0,
      ixz: inertiaMatrix.elements[6] ?? 0,
      iyy: inertiaMatrix.elements[4] ?? 0,
      iyz: inertiaMatrix.elements[7] ?? 0,
      izz: inertiaMatrix.elements[8] ?? 0,
    },
  });

  assert.ok(actual, 'expected USD inertia properties');
  assert.deepEqual(
    actual.diagonalInertia.map((value) => Number(value.toFixed(6))),
    decomposition.eigenvalues.map((value) => Number(value.toFixed(6))),
  );
  assertQuaternionClose(
    actual.principalAxesLocal,
    originQuaternion.clone().multiply(expectedPrincipalAxes).normalize(),
  );
});

test('matches Isaac Sim principal axes for the Unitree B2 FL_hip inertia tensor', () => {
  const actual = computeUsdInertiaProperties({
    origin: {
      xyz: { x: -0.003841, y: -0.009068, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
    inertia: {
      ixx: 0.0033188,
      ixy: 7.16e-5,
      ixz: -3.77e-7,
      iyy: 0.0048743,
      iyz: 4e-9,
      izz: 0.0037087,
    },
  });

  assert.ok(actual, 'expected USD inertia properties');
  assert.deepEqual(
    actual.diagonalInertia.map((value) => Number(value.toFixed(6))),
    [0.003316, 0.004878, 0.003709],
  );
  assertQuaternionClose(
    actual.principalAxesLocal,
    new THREE.Quaternion(
      -1.6684385627740994e-5,
      -4.7888478729873896e-4,
      -2.2948382422327995e-2,
      0.9997366070747375,
    ),
  );
});
