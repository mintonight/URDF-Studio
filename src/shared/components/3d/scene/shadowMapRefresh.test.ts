import test from 'node:test';
import assert from 'node:assert/strict';
import type * as THREE from 'three';

import { requestShadowMapRefresh } from './shadowMapRefresh.ts';

function createRendererShadowMapStub(enabled: boolean, needsUpdate = false) {
  return {
    shadowMap: {
      enabled,
      needsUpdate,
    },
  } as unknown as Pick<THREE.WebGLRenderer, 'shadowMap'>;
}

test('requestShadowMapRefresh marks enabled shadow maps dirty', () => {
  const renderer = createRendererShadowMapStub(true);

  assert.equal(requestShadowMapRefresh(renderer), true);
  assert.equal(renderer.shadowMap.needsUpdate, true);
});

test('requestShadowMapRefresh leaves disabled or missing shadow maps alone', () => {
  const renderer = createRendererShadowMapStub(false);

  assert.equal(requestShadowMapRefresh(renderer), false);
  assert.equal(renderer.shadowMap.needsUpdate, false);
  assert.equal(requestShadowMapRefresh(null), false);
});
