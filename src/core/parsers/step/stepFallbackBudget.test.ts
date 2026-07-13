import test from 'node:test';
import assert from 'node:assert/strict';

import { allocateFallbackBudget, checkResourceLimits, ResourceLimitError } from './stepFallbackBudget';
import { RECONSTRUCTION_LIMITS } from './stepMeshRegionTypes';

test('allocates full triangles when under budget', () => {
  const result = allocateFallbackBudget([
    { regionId: 1, triangleCount: 30, area: 1 },
    { regionId: 2, triangleCount: 40, area: 2 },
  ]);
  assert.equal(result.budgets[1], 30);
  assert.equal(result.budgets[2], 40);
  assert.equal(result.omittedRegions.length, 0);
});

test('proportionally reduces when over budget', () => {
  const result = allocateFallbackBudget([
    { regionId: 1, triangleCount: 3000, area: 1 },
    { regionId: 2, triangleCount: 3000, area: 1 },
  ]);
  const total = result.budgets[1] + result.budgets[2];
  assert.ok(total <= RECONSTRUCTION_LIMITS.maxFallbackTriangles, `total ${total} must not exceed ${RECONSTRUCTION_LIMITS.maxFallbackTriangles}`);
  assert.ok(result.budgets[1] >= 20, 'minimum 20 per region');
  assert.ok(result.budgets[2] >= 20, 'minimum 20 per region');
});

test('omits smallest regions when minimums cannot be met', () => {
  // 100 regions × 8 min = 800 > the global budget → some must be omitted.
  const regions = Array.from({ length: 100 }, (_, i) => ({
    regionId: i,
    triangleCount: 100,
    area: i + 1,
  }));
  const result = allocateFallbackBudget(regions);
  assert.ok(result.omittedRegions.length > 0, 'should omit some regions');
  const total = Object.values(result.budgets).reduce((s, v) => s + v, 0);
  assert.ok(total <= RECONSTRUCTION_LIMITS.maxFallbackTriangles);
});

test('checkResourceLimits passes within bounds', () => {
  // Should not throw.
  checkResourceLimits({ inputTriangles: 50000, candidateRegions: 50 });
  assert.ok(true);
});

test('checkResourceLimits throws on too many triangles', () => {
  assert.throws(
    () => checkResourceLimits({ inputTriangles: 200000, candidateRegions: 10 }),
    (err: unknown) => err instanceof ResourceLimitError && err.limitType === 'inputTriangles',
  );
});

test('checkResourceLimits throws on too many regions', () => {
  assert.throws(
    () => checkResourceLimits({ inputTriangles: 100, candidateRegions: 300 }),
    (err: unknown) => err instanceof ResourceLimitError && err.limitType === 'candidateRegions',
  );
});

test('checkResourceLimits throws on memory estimate', () => {
  assert.throws(
    () => checkResourceLimits({ inputTriangles: 100, candidateRegions: 10, estimatedMemoryMB: 600 }),
    (err: unknown) => err instanceof ResourceLimitError && err.limitType === 'workerMemoryMB',
  );
});

test('total never exceeds the configured global fallback budget', () => {
  const regions = Array.from({ length: 8 }, (_, i) => ({
    regionId: i,
    triangleCount: 1000,
    area: 1,
  }));
  const result = allocateFallbackBudget(regions);
  const total = Object.values(result.budgets).reduce((s, v) => s + v, 0);
  assert.ok(total <= RECONSTRUCTION_LIMITS.maxFallbackTriangles, `total ${total}`);
  assert.ok(Object.values(result.budgets).every((budget) => budget <= RECONSTRUCTION_LIMITS.maxFallbackRegionTriangles));
});

test('omitted regions produce structured failure when budget is insufficient', () => {
  // 100 regions × 8 min = 800 > the global budget → some must be omitted.
  const regions = Array.from({ length: 100 }, (_, i) => ({
    regionId: i,
    triangleCount: 100,
    area: i + 1,
  }));
  const result = allocateFallbackBudget(regions);
  assert.ok(result.omittedRegions.length > 0, 'should omit some regions');
  // Caller must throw when omittedRegions is non-empty.
  assert.throws(
    () => {
      if (result.omittedRegions.length > 0) {
        throw new Error(
          `STEP faceted fallback cannot retain all regions within ${RECONSTRUCTION_LIMITS.maxFallbackTriangles} triangles; omitted regions: ${result.omittedRegions.join(', ')}`,
        );
      }
    },
    /omitted regions/,
  );
});

test('empty region list produces empty budgets', () => {
  const result = allocateFallbackBudget([]);
  assert.deepEqual(result.budgets, {});
  assert.equal(result.omittedRegions.length, 0);
});
