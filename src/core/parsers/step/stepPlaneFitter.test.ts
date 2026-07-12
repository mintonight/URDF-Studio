import test from 'node:test';
import assert from 'node:assert/strict';

import { fitPlane } from './stepPlaneFitter';
import { analyzeMeshTopology } from './stepMeshAnalysis';
import { prepareStepMeshTopology } from './stepMeshTopology';
import { computeTolerances } from './stepMeshRegionTypes';
import { growPlanarRegions } from './stepRegionGrowing';

/** Build a planar grid of triangles on the XY plane. */
function makePlanarGrid(N: number): ReturnType<typeof prepareStepMeshTopology> {
  const verts: number[] = [];
  const indices: number[] = [];
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
  return prepareStepMeshTopology({ vertices: verts, indices });
}

test('fitPlane accepts a perfect planar grid', () => {
  const prepared = makePlanarGrid(6); // 72 triangles
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);

  const allTriangles = Array.from({ length: prepared.mesh.indices.length / 3 }, (_, i) => i);
  const result = fitPlane(prepared, analysis, allTriangles, tolerances);

  assert.equal(result.accepted, true, `should accept perfect plane: ${result.rejectionReason}`);
  assert.ok(result.parameters.planeNormal!, 'should have plane normal');
  assert.ok(Math.abs(result.parameters.planeNormal!.z - 1) < 1e-6, 'normal should be +Z');
  assert.ok(result.quality.inlierRatio >= 0.95);
  assert.ok(result.quality.rmsDistance < tolerances.baseDistance);
});

test('fitPlane rejects a curved surface as planar', () => {
  // Build a hemisphere-like mesh that cannot be fitted as a plane.
  const verts: number[] = [];
  const indices: number[] = [];
  const R = 1;
  const N = 10;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const theta = (i / N) * Math.PI / 2;
      const phi = (j / N) * Math.PI / 2;
      verts.push(
        R * Math.sin(theta) * Math.cos(phi),
        R * Math.sin(theta) * Math.sin(phi),
        R * Math.cos(theta),
      );
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const v00 = i * (N + 1) + j;
      const v10 = i * (N + 1) + j + 1;
      const v01 = (i + 1) * (N + 1) + j;
      const v11 = (i + 1) * (N + 1) + j + 1;
      indices.push(v00, v10, v11, v00, v11, v01);
    }
  }
  const prepared = prepareStepMeshTopology({ vertices: verts, indices });
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);
  const allTriangles = Array.from({ length: prepared.mesh.indices.length / 3 }, (_, i) => i);
  const result = fitPlane(prepared, analysis, allTriangles, tolerances);
  assert.equal(result.accepted, false, 'curved surface should not be accepted as plane');
  assert.ok(result.rejectionReason);
});

test('growPlanarRegions produces one region for a flat grid', () => {
  const prepared = makePlanarGrid(6);
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);
  const regions = growPlanarRegions(prepared, analysis, tolerances);
  // All triangles have the same normal → should grow into one region.
  assert.ok(regions.length >= 1, 'should produce at least 1 region');
  const bigRegion = regions[0];
  assert.ok(bigRegion.triangleIds.length > 50, 'first region should contain most triangles');
});

test('growPlanarRegions separates perpendicular faces', () => {
  // Two perpendicular squares: one on XY plane, one on XZ plane.
  const verts = [
    // XY plane square
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
    // XZ plane square (sharing edge at x=1)
    1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1,
  ];
  const indices = [
    // XY: 0,1,2 and 0,2,3
    0, 1, 2, 0, 2, 3,
    // XZ: 1,4,5 and 1,5,6  (using shared vertex 1)
    1, 4, 5, 1, 5, 6,
  ];
  const prepared = prepareStepMeshTopology({ vertices: verts, indices });
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);
  const regions = growPlanarRegions(prepared, analysis, tolerances);
  // Should produce at least 2 regions (one per orientation).
  assert.ok(regions.length >= 2, `expected ≥2 regions for perpendicular faces, got ${regions.length}`);
});
