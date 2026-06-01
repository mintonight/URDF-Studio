import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INTERACTION_DPR_CAP,
  MIN_RENDER_DPR,
  RESTING_DPR_CAP,
  resolveCanvasDpr,
} from './interactionQuality.ts';

test('resolveCanvasDpr keeps resting canvases crisp up to the resting cap', () => {
  assert.equal(
    resolveCanvasDpr({ devicePixelRatio: 2.5, isInteracting: false }),
    RESTING_DPR_CAP,
  );
});

test('resolveCanvasDpr keeps interactive canvases as crisp as resting canvases by default', () => {
  const devicePixelRatio = 2.5;

  assert.equal(
    resolveCanvasDpr({ devicePixelRatio, isInteracting: true }),
    resolveCanvasDpr({ devicePixelRatio, isInteracting: false }),
  );
  assert.equal(
    resolveCanvasDpr({ devicePixelRatio, isInteracting: true }),
    RESTING_DPR_CAP,
  );
});

test('resolveCanvasDpr supersamples low-DPR displays to reduce viewport aliasing', () => {
  assert.equal(
    resolveCanvasDpr({ devicePixelRatio: 0.9, isInteracting: false }),
    MIN_RENDER_DPR,
  );
});

test('resolveCanvasDpr respects explicit interaction caps below the supersampling floor', () => {
  assert.equal(
    resolveCanvasDpr({ devicePixelRatio: 2, isInteracting: true, interactionCap: 1.25 }),
    1.25,
  );
});

test('resolveCanvasDpr falls back to a safe DPR when the device ratio is invalid', () => {
  assert.equal(
    resolveCanvasDpr({ devicePixelRatio: Number.NaN, isInteracting: false }),
    MIN_RENDER_DPR,
  );
});

test('resolveCanvasDpr can opt out of supersampling with a custom floor', () => {
  assert.equal(
    resolveCanvasDpr({
      devicePixelRatio: 1,
      isInteracting: true,
      interactionCap: INTERACTION_DPR_CAP,
      minRenderDpr: 1,
    }),
    1,
  );
});
