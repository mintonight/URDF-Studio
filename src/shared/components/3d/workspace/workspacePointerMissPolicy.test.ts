import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldSuppressWorkspacePointerMissAfterDrag } from './workspacePointerMissPolicy.ts';

test('suppresses workspace pointer-missed after pointer travel exceeds the click threshold', () => {
  assert.equal(
    shouldSuppressWorkspacePointerMissAfterDrag({
      startX: 10,
      startY: 20,
      endX: 25,
      endY: 20,
    }),
    true,
  );
});

test('forwards workspace pointer-missed when pointer travel stays within the click threshold', () => {
  assert.equal(
    shouldSuppressWorkspacePointerMissAfterDrag({
      startX: 10,
      startY: 20,
      endX: 14,
      endY: 23,
    }),
    false,
  );
});
