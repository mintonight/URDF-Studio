import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeResolvedMeshLoadKeys, reconcileResolvedMeshLoadKeys } from './meshResolutionState.ts';

test('mergeResolvedMeshLoadKeys deduplicates pending keys and ignores unrelated entries', () => {
  const nextState = mergeResolvedMeshLoadKeys({
    currentResolvedKeys: new Set(['base|visual|primary|0|visual.stl']),
    currentSignature: 'scene-a',
    expectedMeshLoadKeySet: new Set([
      'base|visual|primary|0|visual.stl',
      'base|collision|primary|0|collision.stl',
      'arm|collision|primary|0|arm-collision.stl',
    ]),
    expectedSignature: 'scene-a',
    pendingResolvedKeys: [
      'base|collision|primary|0|collision.stl',
      'base|collision|primary|0|collision.stl',
      'unexpected|collision|primary|0|ignored.stl',
    ],
  });

  assert.ok(nextState, 'expected pending mesh keys to update state');
  assert.equal(nextState?.signature, 'scene-a');
  assert.deepEqual(Array.from(nextState?.resolvedKeys ?? []).sort(), [
    'base|collision|primary|0|collision.stl',
    'base|visual|primary|0|visual.stl',
  ]);
});

test('mergeResolvedMeshLoadKeys resets stale signatures before applying the new batch', () => {
  const nextState = mergeResolvedMeshLoadKeys({
    currentResolvedKeys: new Set(['old|collision|primary|0|old.stl']),
    currentSignature: 'scene-old',
    expectedMeshLoadKeySet: new Set(['base|collision|primary|0|collision.stl']),
    expectedSignature: 'scene-new',
    pendingResolvedKeys: ['base|collision|primary|0|collision.stl'],
  });

  assert.ok(nextState, 'expected a stale signature reset to produce a new state');
  assert.equal(nextState?.signature, 'scene-new');
  assert.deepEqual(Array.from(nextState?.resolvedKeys ?? []), [
    'base|collision|primary|0|collision.stl',
  ]);
});

test('mergeResolvedMeshLoadKeys returns null when the batch adds no new expected keys', () => {
  const nextState = mergeResolvedMeshLoadKeys({
    currentResolvedKeys: new Set(['base|collision|primary|0|collision.stl']),
    currentSignature: 'scene-a',
    expectedMeshLoadKeySet: new Set(['base|collision|primary|0|collision.stl']),
    expectedSignature: 'scene-a',
    pendingResolvedKeys: [
      'base|collision|primary|0|collision.stl',
      'unexpected|collision|primary|0|ignored.stl',
    ],
  });

  assert.equal(nextState, null);
});

test('reconcileResolvedMeshLoadKeys preserves already-loaded keys that remain in the next scene signature', () => {
  const nextState = reconcileResolvedMeshLoadKeys({
    currentResolvedKeys: new Set([
      'comp_h1|visual|primary|0|meshes/h1-body.dae',
      'comp_h1|visual|primary|1|meshes/h1-leg.dae',
      'stale|visual|primary|0|meshes/stale.dae',
    ]),
    expectedMeshLoadKeySet: new Set([
      'comp_h1|visual|primary|0|meshes/h1-body.dae',
      'comp_h1|visual|primary|1|meshes/h1-leg.dae',
      'comp_b2|visual|primary|0|meshes/b2-body.dae',
    ]),
    expectedSignature: 'scene-b',
  });

  assert.equal(nextState.signature, 'scene-b');
  assert.deepEqual(Array.from(nextState.resolvedKeys).sort(), [
    'comp_h1|visual|primary|0|meshes/h1-body.dae',
    'comp_h1|visual|primary|1|meshes/h1-leg.dae',
  ]);
});
