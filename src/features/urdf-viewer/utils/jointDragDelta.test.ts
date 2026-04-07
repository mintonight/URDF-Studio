import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveRevoluteDragDelta } from './jointDragDelta.ts';

test('uses the projected plane angle when the camera is facing the joint plane', () => {
  assert.equal(
    resolveRevoluteDragDelta({
      worldDelta: 0.24,
      tangentDelta: -0.08,
      planeFacingRatio: 0.92,
    }),
    0.24,
  );
});

test('switches to tangent dragging when the joint plane is nearly edge-on', () => {
  assert.equal(
    resolveRevoluteDragDelta({
      worldDelta: 0.03,
      tangentDelta: -0.12,
      planeFacingRatio: 0.08,
    }),
    -0.12,
  );
});

test('falls back to the projected plane angle when tangent dragging is unavailable', () => {
  assert.equal(
    resolveRevoluteDragDelta({
      worldDelta: -0.18,
      tangentDelta: 0,
      planeFacingRatio: 0.04,
    }),
    -0.18,
  );
});

test('clamps the resolved delta after choosing the active drag mode', () => {
  assert.equal(
    resolveRevoluteDragDelta({
      worldDelta: 1,
      tangentDelta: -0.2,
      planeFacingRatio: 0.91,
      maxDelta: 0.3,
    }),
    0.3,
  );
});
