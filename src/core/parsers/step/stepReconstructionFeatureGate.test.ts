import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldUseAnalyticReconstruction } from './stepReconstructionFeatureGate';

test('analytic reconstruction is disabled by default', () => {
  assert.equal(shouldUseAnalyticReconstruction(undefined), false);
  assert.equal(shouldUseAnalyticReconstruction(false), false);
});

test('analytic reconstruction requires an explicit experimental flag', () => {
  assert.equal(shouldUseAnalyticReconstruction(true), true);
});
