import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveUsdOffscreenCanvasPresentation } from './usdOffscreenCanvasPresentation.ts';

test('resolveUsdOffscreenCanvasPresentation uses an opaque viewer-matched background', () => {
  assert.deepEqual(resolveUsdOffscreenCanvasPresentation('light'), {
    alpha: false,
    backgroundColor: '#f3f4f6',
    clearAlpha: 1,
  });
  assert.deepEqual(resolveUsdOffscreenCanvasPresentation('dark'), {
    alpha: false,
    backgroundColor: '#1f1f1f',
    clearAlpha: 1,
  });
});
