import test from 'node:test';
import assert from 'node:assert/strict';

import { allocateStepMeshBudgets } from './stepMeshBudget';
import { STEP_MESH_TOTAL_TRIANGLE_LIMIT, STEP_MESH_MIN_BUDGET } from './stepMeshConfig';

test('retains meshes already below preset cap', () => {
  const result = allocateStepMeshBudgets(
    [{ id: 'a', triangleCount: 100 }, { id: 'b', triangleCount: 200 }],
    'lightweight',
    'small',
  );
  assert.equal(result.a, 100);
  assert.equal(result.b, 200);
});

test('caps meshes above preset limit', () => {
  const result = allocateStepMeshBudgets(
    [{ id: 'big', triangleCount: 100_000 }],
    'lightweight',
    'small',
  );
  assert.equal(result.big, 5_000, 'lightweight small cap = 5000');
});

test('proportionally reduces when total exceeds 250k', () => {
  // 3 meshes × 200k each = 600k demand, but total limit is 250k
  const inputs = [
    { id: 'a', triangleCount: 200_000 },
    { id: 'b', triangleCount: 200_000 },
    { id: 'c', triangleCount: 200_000 },
  ];
  const result = allocateStepMeshBudgets(inputs, 'lightweight', 'high');
  const total = Object.values(result).reduce((sum, v) => sum + v, 0);
  assert.ok(total <= STEP_MESH_TOTAL_TRIANGLE_LIMIT, `total ${total} must not exceed ${STEP_MESH_TOTAL_TRIANGLE_LIMIT}`);
  // Each mesh should get roughly equal share
  assert.ok(result.a > STEP_MESH_MIN_BUDGET);
  assert.ok(result.b > STEP_MESH_MIN_BUDGET);
  assert.ok(result.c > STEP_MESH_MIN_BUDGET);
});

test('minimum budget of 500 when possible', () => {
  const result = allocateStepMeshBudgets(
    [{ id: 'small', triangleCount: 600 }],
    'lightweight',
    'small',
  );
  // 600 triangles, cap is 5000, so it should keep 600
  assert.equal(result.small, 600);
});

test('total never exceeds 250000', () => {
  const inputs = Array.from({ length: 20 }, (_, i) => ({
    id: `mesh${i}`,
    triangleCount: 50_000,
  }));
  const result = allocateStepMeshBudgets(inputs, 'cad-repair', 'high');
  const total = Object.values(result).reduce((sum, v) => sum + v, 0);
  assert.ok(total <= STEP_MESH_TOTAL_TRIANGLE_LIMIT, `total ${total} > ${STEP_MESH_TOTAL_TRIANGLE_LIMIT}`);
});

test('cad-repair presets allow more triangles than lightweight', () => {
  const light = allocateStepMeshBudgets(
    [{ id: 'a', triangleCount: 100_000 }],
    'lightweight',
    'balanced',
  );
  const repair = allocateStepMeshBudgets(
    [{ id: 'a', triangleCount: 100_000 }],
    'cad-repair',
    'balanced',
  );
  assert.ok(repair.a > light.a, 'cad-repair balanced (40k) > lightweight balanced (15k)');
});

test('deterministic for same input', () => {
  const inputs = [
    { id: 'a', triangleCount: 100_000 },
    { id: 'b', triangleCount: 50_000 },
  ];
  const r1 = allocateStepMeshBudgets(inputs, 'lightweight', 'balanced');
  const r2 = allocateStepMeshBudgets(inputs, 'lightweight', 'balanced');
  assert.deepEqual(r1, r2);
});
