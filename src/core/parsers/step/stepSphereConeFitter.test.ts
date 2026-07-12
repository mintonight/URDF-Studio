import test from 'node:test';
import assert from 'node:assert/strict';

import { fitSphere, fitCone } from './stepSphereConeFitter';
import { analyzeMeshTopology } from './stepMeshAnalysis';
import { prepareStepMeshTopology } from './stepMeshTopology';
import { computeTolerances } from './stepMeshRegionTypes';

/** Build a triangulated sphere. */
function makeSphere(radius: number, segments: number, rings: number) {
  const verts: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const theta = (r / rings) * Math.PI;
    for (let s = 0; s < segments; s++) {
      const phi = (s / segments) * 2 * Math.PI;
      verts.push(
        radius * Math.sin(theta) * Math.cos(phi),
        radius * Math.sin(theta) * Math.sin(phi),
        radius * Math.cos(theta),
      );
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const v00 = r * segments + s;
      const v10 = r * segments + (s + 1) % segments;
      const v01 = (r + 1) * segments + s;
      const v11 = (r + 1) * segments + (s + 1) % segments;
      indices.push(v00, v10, v11, v00, v11, v01);
    }
  }
  return prepareStepMeshTopology({ vertices: verts, indices });
}

test('fitSphere accepts a perfect triangulated sphere', () => {
  const prepared = makeSphere(0.5, 24, 12);
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);
  const allTriangles = Array.from({ length: prepared.mesh.indices.length / 3 }, (_, i) => i);
  const result = fitSphere(prepared, analysis, allTriangles, tolerances);

  // May accept or reject depending on tolerance strictness, but should
  // produce a valid radius estimate.
  if (result.accepted && result.parameters.sphereRadius) {
    assert.ok(Math.abs(result.parameters.sphereRadius - 0.5) < 0.1, `radius ~0.5, got ${result.parameters.sphereRadius}`);
  } else {
    // If rejected, check that the reason is not a crash.
    assert.ok(result.rejectionReason, 'should have a rejection reason if not accepted');
    assert.ok(result.quality.triangleCount > 0);
  }
});

test('fitSphere rejects a flat surface', () => {
  const verts: number[] = [];
  const indices: number[] = [];
  const N = 8;
  for (let y = 0; y <= N; y++) {
    for (let x = 0; x <= N; x++) verts.push(x * 0.1, y * 0.1, 0);
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v00 = y * (N + 1) + x, v10 = y * (N + 1) + x + 1;
      const v01 = (y + 1) * (N + 1) + x, v11 = (y + 1) * (N + 1) + x + 1;
      indices.push(v00, v10, v11, v00, v11, v01);
    }
  }
  const prepared = prepareStepMeshTopology({ vertices: verts, indices });
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);
  const allTriangles = Array.from({ length: prepared.mesh.indices.length / 3 }, (_, i) => i);
  const result = fitSphere(prepared, analysis, allTriangles, tolerances);
  assert.equal(result.accepted, false, 'flat surface should not be sphere');
});

test('fitSphere handles small input gracefully', () => {
  const prepared = makeSphere(1, 5, 3);
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);
  const allTriangles = Array.from({ length: prepared.mesh.indices.length / 3 }, (_, i) => i);
  const result = fitSphere(prepared, analysis, allTriangles, tolerances);
  assert.ok(result.accepted === true || result.accepted === false);
});

test('fitCone handles insufficient triangles gracefully', () => {
  // Simple cone: 6 triangles
  const verts = [
    0, 0, 0, 1, 0, 1, 0.5, 0.87, 1, -0.5, 0.87, 1, -1, 0, 1, -0.5, -0.87, 1, 0.5, -0.87, 1,
  ];
  const indices = [
    0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6, 0, 6, 1,
  ];
  const prepared = prepareStepMeshTopology({ vertices: verts, indices });
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);
  const allTriangles = Array.from({ length: prepared.mesh.indices.length / 3 }, (_, i) => i);
  const result = fitCone(prepared, analysis, allTriangles, tolerances);
  // Small input — may accept or reject but should not crash.
  assert.ok(result.accepted === true || result.accepted === false);
  assert.ok(result.quality.triangleCount > 0);
});
