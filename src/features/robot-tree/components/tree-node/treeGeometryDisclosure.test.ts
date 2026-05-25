import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldAutoExpandTreeGeometryDetails } from './treeGeometryDisclosure.ts';

test('does not auto-expand geometry rows from visual selection when default disclosure is off', () => {
  assert.equal(
    shouldAutoExpandTreeGeometryDetails({
      showGeometryDetailsByDefault: false,
      selectionSubType: 'visual',
      hasSelectedExtraVisual: false,
      hasSelectedExtraCollision: false,
    }),
    false,
  );
});

test('does not auto-expand geometry rows from collision selection when default disclosure is off', () => {
  assert.equal(
    shouldAutoExpandTreeGeometryDetails({
      showGeometryDetailsByDefault: false,
      selectionSubType: 'collision',
      hasSelectedExtraVisual: false,
      hasSelectedExtraCollision: true,
    }),
    false,
  );
});

test('keeps geometry rows expandable when default disclosure is on', () => {
  assert.equal(
    shouldAutoExpandTreeGeometryDetails({
      showGeometryDetailsByDefault: true,
      selectionSubType: 'visual',
      hasSelectedExtraVisual: true,
      hasSelectedExtraCollision: false,
    }),
    true,
  );
});
