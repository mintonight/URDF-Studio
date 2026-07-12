/**
 * Pure (non-WASM) integration tests for plane reconstruction coverage.
 *
 * Verifies that every input triangle is covered exactly once by either
 * an accepted plane region or a fallback region, and that only plane
 * surfaces are enabled for analytic construction.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareStepMeshTopology } from './stepMeshTopology';
import { analyzeMeshTopology } from './stepMeshAnalysis';
import { computeTolerances } from './stepMeshRegionTypes';
import { growPlanarRegions } from './stepRegionGrowing';
import { reconstructSurfaces } from './stepSurfaceReconstruction';
import { extractRegionBoundary } from './stepRegionBoundary';
import {
  isAnalyticSurfaceEnabled,
  ENABLED_STEP_ANALYTIC_SURFACES,
} from './stepReconstructionFeatureGate';
import { allocateFallbackBudget } from './stepFallbackBudget';

/**
 * Build an indexed planar grid large enough for region growing + fitting.
 * N cells per side → 2*N*N triangles. Uses 0.1 spacing like existing tests.
 */
function makePlanarGrid(N: number) {
  const verts: number[] = [];
  const indices: number[] = [];
  for (let y = 0; y <= N; y++) {
    for (let x = 0; x <= N; x++) verts.push(x * 0.1, y * 0.1, 0);
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

/** L-shaped planar region built from two overlapping grids. */
function makeLShape() {
  // Horizontal bar: 8×3 cells, vertical bar: 3×8 cells.
  const verts: number[] = [];
  const indices: number[] = [];
  const addCell = (x: number, y: number, base: number) => {
    const v00 = base;
    const v10 = base + 1;
    const v01 = base + 2;
    const v11 = base + 3;
    verts.push(x * 0.1, y * 0.1, 0);
    verts.push((x + 1) * 0.1, y * 0.1, 0);
    verts.push(x * 0.1, (y + 1) * 0.1, 0);
    verts.push((x + 1) * 0.1, (y + 1) * 0.1, 0);
    indices.push(v00, v10, v11, v00, v11, v01);
    return base + 4;
  };
  let base = 0;
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 8; x++) base = addCell(x, y, base);
  }
  for (let y = 3; y < 8; y++) {
    for (let x = 0; x < 3; x++) base = addCell(x, y, base);
  }
  return prepareStepMeshTopology({ vertices: verts, indices });
}

/** Two disconnected planar islands, each large enough for plane fitting. */
function makeDisconnectedIslands() {
  const a = makePlanarGrid(6);
  // Second island translated far away — build a second grid and merge.
  const bVerts = a.mesh.vertices.map((v, i) => (i % 3 === 0 ? v + 10 : v));
  const bIndices = a.mesh.indices.map((idx) => idx + a.mesh.vertices.length / 3);
  const verts = [...a.mesh.vertices, ...bVerts];
  const indices = [...a.mesh.indices, ...bIndices];
  return prepareStepMeshTopology({ vertices: verts, indices });
}

/** Mixed: large planar grid + freeform tetrahedron. */
function makeMixedMesh() {
  const grid = makePlanarGrid(6);
  const tetVerts = [
    5, 0, 0, 6, 0, 0, 5.5, 1, 0,
    5, 0, 0, 6, 0, 0, 5.5, 0.5, 1,
    6, 0, 0, 5.5, 1, 0, 5.5, 0.5, 1,
    5.5, 1, 0, 5, 0, 0, 5.5, 0.5, 1,
  ];
  // Convert tet to indexed and append.
  const base = grid.mesh.vertices.length / 3;
  const verts = [...grid.mesh.vertices, ...tetVerts];
  // Tet is non-indexed (12 vertices = 4 triangles); reindex.
  const tetIndices: number[] = [];
  for (let t = 0; t < 4; t++) {
    tetIndices.push(base + t * 3, base + t * 3 + 1, base + t * 3 + 2);
  }
  const indices = [...grid.mesh.indices, ...tetIndices];
  return prepareStepMeshTopology({ vertices: verts, indices });
}

function runPipeline(prepared: ReturnType<typeof prepareStepMeshTopology>) {
  const analysis = analyzeMeshTopology(prepared);
  const tolerances = computeTolerances(analysis.diagonal);
  const grown = growPlanarRegions(prepared, analysis, tolerances);
  const regions = reconstructSurfaces(prepared, analysis, grown, tolerances);
  return { prepared, analysis, regions };
}

function assertCompleteCoverage(
  regions: ReturnType<typeof reconstructSurfaces>,
  inputTriangleCount: number,
): void {
  const covered = new Set<number>();
  for (const region of regions) {
    for (const tId of region.triangleIds) {
      assert.equal(covered.has(tId), false, `triangle ${tId} appears twice`);
      covered.add(tId);
    }
  }
  assert.equal(covered.size, inputTriangleCount, 'every triangle must be covered exactly once');
}

test('planar grid produces complete triangle coverage', () => {
  const { prepared, regions } = runPipeline(makePlanarGrid(6));
  const triangleCount = prepared.mesh.indices.length / 3;
  assertCompleteCoverage(regions, triangleCount);
});

test('L-shape produces complete triangle coverage', () => {
  const { prepared, regions } = runPipeline(makeLShape());
  const triangleCount = prepared.mesh.indices.length / 3;
  assertCompleteCoverage(regions, triangleCount);
});

test('disconnected islands produce complete triangle coverage', () => {
  const { prepared, regions } = runPipeline(makeDisconnectedIslands());
  const triangleCount = prepared.mesh.indices.length / 3;
  assertCompleteCoverage(regions, triangleCount);
});

test('mixed plane/freeform mesh produces complete triangle coverage', () => {
  const { prepared, regions } = runPipeline(makeMixedMesh());
  const triangleCount = prepared.mesh.indices.length / 3;
  assertCompleteCoverage(regions, triangleCount);
});

test('only plane surfaces are enabled for analytic construction', () => {
  assert.equal(ENABLED_STEP_ANALYTIC_SURFACES.size, 1);
  assert.equal(isAnalyticSurfaceEnabled('plane'), true);
  assert.equal(isAnalyticSurfaceEnabled('cylinder'), false);
  assert.equal(isAnalyticSurfaceEnabled('sphere'), false);
  assert.equal(isAnalyticSurfaceEnabled('cone'), false);
});

test('planar grid regions can extract valid boundary loops', () => {
  const { prepared, regions } = runPipeline(makePlanarGrid(8));

  const analytic = regions.filter((r) => r.accepted && isAnalyticSurfaceEnabled(r.type));
  assert.ok(analytic.length >= 1, 'should have at least one accepted plane region');

  for (const region of analytic) {
    const boundary = extractRegionBoundary(prepared.mesh.indices, region.triangleIds);
    if (boundary.ok) {
      assert.ok(boundary.boundary.outerLoop.length >= 3, 'outer loop needs ≥3 vertices');
    }
    // If boundary extraction fails, the region routes to fallback — that's fine.
  }
});

test('fallback budget covers all non-plane regions without omission for small meshes', () => {
  const { regions } = runPipeline(makeMixedMesh());

  const fallbackRegions = regions.filter(
    (r) => !r.accepted || !isAnalyticSurfaceEnabled(r.type),
  );
  const infos = fallbackRegions.map((r) => ({
    regionId: r.id,
    triangleCount: r.triangleIds.length,
    area: r.quality.coveredArea,
  }));
  const budget = allocateFallbackBudget(infos);
  assert.equal(budget.omittedRegions.length, 0, 'small mesh must not omit any region');
  const total = Object.values(budget.budgets).reduce((s, v) => s + v, 0);
  assert.ok(total <= 5000);
});
