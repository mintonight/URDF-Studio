import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveVisualizerInteractiveLayerPriority } from './interactiveLayerPriority.ts';

test('resolveVisualizerInteractiveLayerPriority prefers the most recently activated visible layer', () => {
  const priority = resolveVisualizerInteractiveLayerPriority({
    showVisual: true,
    showIkHandles: false,
    showCollision: true,
    showOrigins: false,
    showJointAxes: false,
    showCenterOfMass: true,
    showInertia: false,
    activationOrder: {
      'ik-handle': 0,
      visual: 1,
      collision: 3,
      'origin-axes': 0,
      'joint-axis': 0,
      'center-of-mass': 2,
      inertia: 0,
    },
  });

  assert.deepEqual(priority, ['collision', 'center-of-mass', 'visual']);
});

test('resolveVisualizerInteractiveLayerPriority falls back to stable base priority when activation order ties', () => {
  const priority = resolveVisualizerInteractiveLayerPriority({
    showVisual: true,
    showIkHandles: true,
    showCollision: true,
    showOrigins: true,
    showJointAxes: true,
    showCenterOfMass: true,
    showInertia: true,
    activationOrder: {
      'ik-handle': 0,
      visual: 0,
      collision: 0,
      'origin-axes': 0,
      'joint-axis': 0,
      'center-of-mass': 0,
      inertia: 0,
    },
  });

  assert.deepEqual(priority, [
    'joint-axis',
    'origin-axes',
    'ik-handle',
    'visual',
    'collision',
    'center-of-mass',
    'inertia',
  ]);
});
