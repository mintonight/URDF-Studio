import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEP_MESH_PRESETS,
  STEP_MESH_TOTAL_TRIANGLE_LIMIT,
  STEP_MESH_MIN_BUDGET,
  STEP_MESH_WELD_TOLERANCE_RATIO,
  STEP_MESH_WELD_TOLERANCE_MIN,
  STEP_MESH_WELD_TOLERANCE_MAX,
  STEP_MESH_SEWING_MULTIPLIER,
} from './stepMeshConfig';

test('STEP presets match the contract', () => {
  assert.deepEqual(STEP_MESH_PRESETS, {
    lightweight: { small: 5_000, balanced: 15_000, high: 50_000 },
    'cad-repair': { small: 15_000, balanced: 40_000, high: 100_000 },
  });
});

test('STEP mesh limits match the contract', () => {
  assert.equal(STEP_MESH_TOTAL_TRIANGLE_LIMIT, 250_000);
  assert.equal(STEP_MESH_MIN_BUDGET, 500);
  assert.equal(STEP_MESH_WELD_TOLERANCE_RATIO, 1e-7);
  assert.equal(STEP_MESH_WELD_TOLERANCE_MIN, 1e-9);
  assert.equal(STEP_MESH_WELD_TOLERANCE_MAX, 1e-4);
  assert.equal(STEP_MESH_SEWING_MULTIPLIER, 2);
});
