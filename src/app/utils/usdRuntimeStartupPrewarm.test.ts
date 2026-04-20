import assert from 'node:assert/strict';
import test from 'node:test';

import { createUsdRuntimeStartupPrewarmHandler } from './usdRuntimeStartupPrewarm.ts';

test('USD runtime startup prewarm warms both runtime lanes once', () => {
  let mainThreadRuntimePrewarmCalls = 0;
  let offscreenRuntimePrewarmCalls = 0;

  const prewarm = createUsdRuntimeStartupPrewarmHandler({
    prewarmMainThreadRuntime: () => {
      mainThreadRuntimePrewarmCalls += 1;
    },
    prewarmOffscreenRuntime: () => {
      offscreenRuntimePrewarmCalls += 1;
    },
  });

  prewarm();
  prewarm();

  assert.equal(mainThreadRuntimePrewarmCalls, 1);
  assert.equal(offscreenRuntimePrewarmCalls, 1);
});
