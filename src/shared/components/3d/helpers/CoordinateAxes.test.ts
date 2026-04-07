import assert from 'node:assert/strict';
import test from 'node:test';

import { ThickerAxes, WorldOriginAxes } from './CoordinateAxes.tsx';

test('ThickerAxes can render with default opacity-dependent depthWrite resolution', () => {
  assert.doesNotThrow(() => {
    ThickerAxes({});
  });
});

test('ThickerAxes accepts interactive hover and selection affordance props', () => {
  assert.doesNotThrow(() => {
    ThickerAxes({
      interactive: true,
      hovered: true,
      selected: true,
    });
  });
});

test('WorldOriginAxes can render with default props', () => {
  assert.doesNotThrow(() => {
    WorldOriginAxes({});
  });
});
