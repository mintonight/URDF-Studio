import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { detectPlanarFaceRegion } from './planarFaceRegion.ts';

function assertVecNearlyEqual(
  actual: THREE.Vector3,
  expected: THREE.Vector3,
  tolerance = 1e-5,
  message?: string,
) {
  assert.ok(
    actual.distanceTo(expected) <= tolerance,
    message ?? `${actual.toArray()} !== ${expected.toArray()}`,
  );
}

function geometryFromTriangles(triangles: number[][]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(triangles.flat()), 3),
  );
  return geometry;
}

function nonIndexedRectangle(options: { reverseSecondFace?: boolean; seamOffset?: number } = {}) {
  const seamOffset = options.seamOffset ?? 0;
  const first = [
    0, 0, 0,
    4, 0, 0,
    4, 2, 0,
  ];
  const second = options.reverseSecondFace
    ? [0 + seamOffset, 0, 0, 0, 2, 0, 4 + seamOffset, 2, 0]
    : [0 + seamOffset, 0, 0, 4 + seamOffset, 2, 0, 0, 2, 0];
  return geometryFromTriangles([first, second]);
}

test('detectPlanarFaceRegion welds non-indexed triangles and uses the area-weighted region center', () => {
  const region = detectPlanarFaceRegion(nonIndexedRectangle(), 0);

  assert.ok(region);
  assert.deepEqual(region!.faceIndices, [0, 1]);
  assertVecNearlyEqual(region!.center, new THREE.Vector3(2, 1, 0));
  assertVecNearlyEqual(region!.normal, new THREE.Vector3(0, 0, 1));
  assert.equal(region!.triangles.length, 6);
  assert.equal(region!.boundaryLoops.length, 1);
  assert.equal(region!.boundaryLoops[0].points.length, 4);
});

test('detectPlanarFaceRegion tolerates STL-style seams and inconsistent triangle winding', () => {
  const region = detectPlanarFaceRegion(
    nonIndexedRectangle({ reverseSecondFace: true, seamOffset: 1e-6 }),
    0,
  );

  assert.ok(region);
  assert.deepEqual(region!.faceIndices, [0, 1]);
  assertVecNearlyEqual(region!.center, new THREE.Vector3(2, 1, 0), 2e-6);
});

test('detectPlanarFaceRegion does not merge disconnected coplanar islands', () => {
  const geometry = geometryFromTriangles([
    [-5, -2, 0, -3, -2, 0, -3, 0, 0],
    [-5, -2, 0, -3, 0, 0, -5, 0, 0],
    [2, 2, 0, 4, 2, 0, 4, 4, 0],
    [2, 2, 0, 4, 4, 0, 2, 4, 0],
  ]);

  const region = detectPlanarFaceRegion(geometry, 0);

  assert.ok(region);
  assert.deepEqual(region!.faceIndices, [0, 1]);
  assertVecNearlyEqual(region!.center, new THREE.Vector3(-4, -1, 0));
});

test('detectPlanarFaceRegion extracts concentric circular outer and hole boundaries', () => {
  const geometry = new THREE.RingGeometry(1, 2, 48).toNonIndexed();
  const region = detectPlanarFaceRegion(geometry, 0);

  assert.ok(region);
  assert.equal(region!.boundaryLoops.length, 2);
  assert.equal(region!.outerBoundaryLoopIndex, 0);
  assert.equal(region!.boundaryLoops[0].isHole, false);
  assert.equal(region!.boundaryLoops[1].isHole, true);
  assert.equal(region!.circleCandidates.length, 2);
  for (const candidate of region!.circleCandidates) {
    assertVecNearlyEqual(candidate.center, new THREE.Vector3(0, 0, 0), 1e-4);
    assert.ok(candidate.confidence > 0.99);
  }
  assert.ok(region!.circleCandidates.some((candidate) => Math.abs(candidate.radius - 1) < 1e-4));
  assert.ok(region!.circleCandidates.some((candidate) => Math.abs(candidate.radius - 2) < 1e-4));
});

test('detectPlanarFaceRegion rejects elliptical boundary loops as circle candidates', () => {
  const geometry = new THREE.RingGeometry(1, 2, 48).toNonIndexed();
  geometry.scale(2, 1, 1);

  const region = detectPlanarFaceRegion(geometry, 0);

  assert.ok(region);
  assert.equal(region!.circleCandidates.length, 0);
});

test('detectPlanarFaceRegion returns null when the connected face budget is exceeded', () => {
  assert.equal(detectPlanarFaceRegion(nonIndexedRectangle(), 0, { maxFaces: 1 }), null);
});
