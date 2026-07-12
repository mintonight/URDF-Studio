import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeTolerances,
  RECONSTRUCTION_LIMITS,
} from './stepMeshRegionTypes';

test('computeTolerances derives correct values from diagonal', () => {
  const t = computeTolerances(100); // diagonal = 100m
  assert.ok(Math.abs(t.baseDistance - 100 * 1e-4) < 1e-10, `baseDistance should be 0.01, got ${t.baseDistance}`);
  assert.ok(Math.abs(t.maxDistance - 2 * 100 * 1e-4) < 1e-10, `maxDistance should be 0.02, got ${t.maxDistance}`);
  assert.ok(Math.abs(t.normalAngleTolerance - 3 * Math.PI / 180) < 1e-10);
  assert.equal(t.minRegionTriangles, 20);
  assert.equal(t.minRegionAreaFraction, 0.0005);
});

test('computeTolerances clamps base distance to minimum', () => {
  const t = computeTolerances(0.001); // very small diagonal
  assert.ok(t.baseDistance >= 1e-6, `baseDistance should be at least 1e-6, got ${t.baseDistance}`);
});

test('RECONSTRUCTION_LIMITS has correct values', () => {
  assert.equal(RECONSTRUCTION_LIMITS.maxInputTriangles, 100_000);
  assert.equal(RECONSTRUCTION_LIMITS.maxRegionTriangles, 30_000);
  assert.equal(RECONSTRUCTION_LIMITS.maxCandidateRegions, 200);
  assert.equal(RECONSTRUCTION_LIMITS.maxFallbackTriangles, 5_000);
  assert.equal(RECONSTRUCTION_LIMITS.maxWorkerMemoryMB, 512);
  assert.equal(RECONSTRUCTION_LIMITS.maxProcessingTimeMs, 5 * 60 * 1000);
});
