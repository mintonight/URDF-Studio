import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldUseAnalyticReconstruction,
  isAnalyticSurfaceEnabled,
  ENABLED_STEP_ANALYTIC_SURFACES,
} from './stepReconstructionFeatureGate';

test('analytic reconstruction is disabled by default', () => {
  assert.equal(shouldUseAnalyticReconstruction(undefined), false);
  assert.equal(shouldUseAnalyticReconstruction(false), false);
});

test('analytic reconstruction requires an explicit experimental flag', () => {
  assert.equal(shouldUseAnalyticReconstruction(true), true);
});

test('only plane is currently enabled for analytic face construction', () => {
  assert.equal(isAnalyticSurfaceEnabled('plane'), true);
  assert.equal(isAnalyticSurfaceEnabled('cylinder'), false);
  assert.equal(isAnalyticSurfaceEnabled('sphere'), false);
  assert.equal(isAnalyticSurfaceEnabled('cone'), false);
  assert.equal(isAnalyticSurfaceEnabled('fallback'), false);
});

test('ENABLED_STEP_ANALYTIC_SURFACES contains exactly plane', () => {
  assert.equal(ENABLED_STEP_ANALYTIC_SURFACES.size, 1);
  assert.equal(ENABLED_STEP_ANALYTIC_SURFACES.has('plane'), true);
});
