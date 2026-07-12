import test from 'node:test';
import assert from 'node:assert/strict';

import { fitCylinder } from './stepCylinderFitter';
import { analyzeMeshTopology } from './stepMeshAnalysis';
import { prepareStepMeshTopology } from './stepMeshTopology';
import { computeTolerances } from './stepMeshRegionTypes';

/** Build a triangulated cylinder along the Z axis. */
function makeCylinder(radius: number, height: number, segments: number, rings: number) {
  const verts: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= rings; r++) {
    for (let s = 0; s < segments; s++) {
      const angle = (s / segments) * 2 * Math.PI;
      const z = (r / rings) * height;
      verts.push(radius * Math.cos(angle), radius * Math.sin(angle), z);
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

test('fitCylinder accepts a perfect triangulated cylinder', () => {
  const prepared = makeCylinder(0.5, 2.0, 24, 5);
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);
  const allTriangles = Array.from({ length: prepared.mesh.indices.length / 3 }, (_, i) => i);
  const result = fitCylinder(prepared, analysis, allTriangles, tolerances);

  assert.equal(result.accepted, true, `should accept perfect cylinder: ${result.rejectionReason}`);
  assert.ok(result.parameters.cylinderRadius!, 'should have radius');
  assert.ok(Math.abs(result.parameters.cylinderRadius! - 0.5) < 0.05, `radius should be ~0.5, got ${result.parameters.cylinderRadius}`);
});

test('fitCylinder rejects a flat surface', () => {
  // Flat grid is not cylindrical.
  const verts: number[] = [];
  const indices: number[] = [];
  const N = 8;
  for (let y = 0; y <= N; y++) {
    for (let x = 0; x <= N; x++) {
      verts.push(x * 0.1, y * 0.1, 0);
    }
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v00 = y * (N + 1) + x;
      const v10 = y * (N + 1) + x + 1;
      const v01 = (y + 1) * (N + 1) + x;
      const v11 = (y + 1) * (N + 1) + x + 1;
      indices.push(v00, v10, v11, v00, v11, v01);
    }
  }
  const prepared = prepareStepMeshTopology({ vertices: verts, indices });
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);
  const allTriangles = Array.from({ length: prepared.mesh.indices.length / 3 }, (_, i) => i);
  const result = fitCylinder(prepared, analysis, allTriangles, tolerances);
  assert.equal(result.accepted, false, 'flat surface should not be accepted as cylinder');
});

test('fitCylinder estimates axis direction along Z for Z-axis cylinder', () => {
  const prepared = makeCylinder(1.0, 3.0, 20, 4);
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);
  const allTriangles = Array.from({ length: prepared.mesh.indices.length / 3 }, (_, i) => i);
  const result = fitCylinder(prepared, analysis, allTriangles, tolerances);

  if (result.accepted && result.parameters.cylinderAxis) {
    const axis = result.parameters.cylinderAxis;
    // Axis should be approximately +Z or -Z.
    const zComponent = Math.abs(axis.z);
    assert.ok(zComponent > 0.9, `axis should be mostly along Z, got z=${axis.z}`);
  }
});

test('fitCylinder handles small number of triangles gracefully', () => {
  const prepared = makeCylinder(0.5, 1.0, 4, 1); // very few triangles
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);
  const allTriangles = Array.from({ length: prepared.mesh.indices.length / 3 }, (_, i) => i);
  const result = fitCylinder(prepared, analysis, allTriangles, tolerances);
  // Should not crash; may accept or reject depending on quality.
  assert.ok(result.accepted === true || result.accepted === false);
  assert.ok(result.quality.triangleCount > 0);
});
