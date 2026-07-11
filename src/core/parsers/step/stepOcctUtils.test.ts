import test from 'node:test';
import assert from 'node:assert/strict';

import { isDegenerateTriangle } from './stepOcctUtils';

test('isDegenerateTriangle rejects a non-finite value in every coordinate position', () => {
  const valid = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  for (let index = 0; index < valid.length; index++) {
    const coordinates = [...valid];
    coordinates[index] = Number.NaN;
    assert.equal(isDegenerateTriangle(coordinates), true, `coordinate ${index} was not rejected`);
  }
});

test('isDegenerateTriangle distinguishes valid and collinear triangles', () => {
  assert.equal(isDegenerateTriangle([0, 0, 0, 1, 0, 0, 0, 1, 0]), false);
  assert.equal(isDegenerateTriangle([0, 0, 0, 1, 1, 1, 2, 2, 2]), true);
});
