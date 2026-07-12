import test from 'node:test';
import assert from 'node:assert/strict';

import type { StepOcctFaceResult } from './stepOcctFaceFactory';
import type { StepRegionBoundary } from './stepRegionBoundary';

test('StepOcctFaceResult type contract is satisfied', () => {
  const result: StepOcctFaceResult = {
    shape: null,
    faceCount: 1,
    warnings: [],
  };
  assert.equal(result.faceCount, 1);
  assert.deepEqual(result.warnings, []);
});

test('StepRegionBoundary type contract is satisfied', () => {
  const boundary: StepRegionBoundary = {
    outerLoop: [0, 1, 2, 3],
    holeLoops: [],
    boundaryEdges: [[0, 1], [1, 2], [2, 3], [3, 0]],
  };
  assert.equal(boundary.outerLoop.length, 4);
  assert.equal(boundary.holeLoops.length, 0);
});
