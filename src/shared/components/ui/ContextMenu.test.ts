import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveContextMenuPosition } from './ContextMenu.tsx';

test('context menu position stays inside the viewport gutter', () => {
  assert.deepEqual(
    resolveContextMenuPosition(
      { x: 390, y: 590 },
      { width: 170, height: 220 },
      { width: 807, height: 618 },
    ),
    { x: 390, y: 390 },
  );
});

test('context menu position clamps both near and far viewport edges', () => {
  assert.deepEqual(
    resolveContextMenuPosition(
      { x: -20, y: -10 },
      { width: 170, height: 220 },
      { width: 807, height: 618 },
    ),
    { x: 8, y: 8 },
  );
  assert.deepEqual(
    resolveContextMenuPosition(
      { x: 790, y: 610 },
      { width: 170, height: 220 },
      { width: 807, height: 618 },
    ),
    { x: 629, y: 390 },
  );
});
