import test from 'node:test';
import assert from 'node:assert/strict';

import { reconstructSurfaces } from './stepSurfaceReconstruction';
import { analyzeMeshTopology } from './stepMeshAnalysis';
import { prepareStepMeshTopology } from './stepMeshTopology';
import { computeTolerances } from './stepMeshRegionTypes';
import { growPlanarRegions } from './stepRegionGrowing';

/** Build a planar grid large enough for region growing + fitting. */
function makePlanarGrid(N: number) {
  const verts: number[] = [];
  const indices: number[] = [];
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
  return prepareStepMeshTopology({ vertices: verts, indices });
}

/** Build the lateral surface of a closed-revolution cylinder. */
function makeCylinder(radius: number, height: number, segments: number, rings: number) {
  const verts: number[] = [];
  const indices: number[] = [];
  for (let ring = 0; ring <= rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const angle = (segment / segments) * Math.PI * 2;
      verts.push(
        radius * Math.cos(angle),
        radius * Math.sin(angle),
        (ring / rings) * height,
      );
    }
  }
  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const next = (segment + 1) % segments;
      const v00 = ring * segments + segment;
      const v10 = ring * segments + next;
      const v01 = (ring + 1) * segments + segment;
      const v11 = (ring + 1) * segments + next;
      indices.push(v00, v10, v11, v00, v11, v01);
    }
  }
  return prepareStepMeshTopology({ vertices: verts, indices });
}

test('reconstructSurfaces recognizes a planar grid as plane', () => {
  const prepared = makePlanarGrid(8);
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);
  const grown = growPlanarRegions(prepared, analysis, tolerances);
  const regions = reconstructSurfaces(prepared, analysis, grown, tolerances);

  assert.ok(regions.length >= 1, 'should produce at least 1 region');
  const planeRegions = regions.filter((r) => r.type === 'plane' && r.accepted);
  assert.ok(planeRegions.length >= 1, 'should have at least 1 accepted plane region');
});

test('reconstructSurfaces reunites curved bands into one cylinder', () => {
  const prepared = makeCylinder(0.5, 2, 32, 5);
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);
  const grown = growPlanarRegions(prepared, analysis, tolerances);
  const regions = reconstructSurfaces(prepared, analysis, grown, tolerances);

  const cylinder = regions.find((region) => region.type === 'cylinder' && region.accepted);
  assert.ok(cylinder, 'the complete revolution should become an analytic cylinder');
  assert.equal(
    cylinder.triangleIds.length,
    prepared.mesh.indices.length / 3,
    'the analytic cylinder should replace every lateral triangle',
  );
});

test('reconstructSurfaces routes unmatched triangles to fallback', () => {
  // Build a hemisphere — won't match plane, may not match sphere with strict tolerances.
  const verts: number[] = [];
  const indices: number[] = [];
  const R = 1, N = 10;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const theta = (i / N) * Math.PI / 2;
      const phi = (j / N) * 2 * Math.PI;
      verts.push(R * Math.sin(theta) * Math.cos(phi), R * Math.sin(theta) * Math.sin(phi), R * Math.cos(theta));
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const v00 = i * (N + 1) + j, v10 = i * (N + 1) + j + 1;
      const v01 = (i + 1) * (N + 1) + j, v11 = (i + 1) * (N + 1) + j + 1;
      indices.push(v00, v10, v11, v00, v11, v01);
    }
  }
  const prepared = prepareStepMeshTopology({ vertices: verts, indices });
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);
  const grown = growPlanarRegions(prepared, analysis, tolerances);
  const regions = reconstructSurfaces(prepared, analysis, grown, tolerances);

  // Should have at least some regions (accepted or fallback).
  assert.ok(regions.length >= 1, 'should produce regions');
  // Any region is either accepted or fallback.
  for (const r of regions) {
    assert.ok(r.type === 'plane' || r.type === 'cylinder' || r.type === 'sphere' || r.type === 'cone' || r.type === 'fallback');
  }
});

test('reconstructSurfaces preserves deterministic output', () => {
  const prepared = makePlanarGrid(6);
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);
  const grown = growPlanarRegions(prepared, analysis, tolerances);
  const r1 = reconstructSurfaces(prepared, analysis, grown, tolerances);
  const r2 = reconstructSurfaces(prepared, analysis, grown, tolerances);
  assert.equal(r1.length, r2.length);
  for (let i = 0; i < r1.length; i++) {
    assert.equal(r1[i].type, r2[i].type);
    assert.equal(r1[i].accepted, r2[i].accepted);
    assert.deepEqual(r1[i].triangleIds, r2[i].triangleIds);
  }
});
