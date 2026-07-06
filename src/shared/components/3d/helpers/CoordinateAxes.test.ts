import assert from 'node:assert/strict';
import test from 'node:test';

import { ThickerAxes, WorldOriginAxes } from './CoordinateAxes.tsx';
import {
  normalizeOriginAxesSize,
  resolveOriginAxesSizeMax,
} from './coordinateAxesSizing.ts';

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

test('origin axes size limits scale with model extent', () => {
  assert.equal(resolveOriginAxesSizeMax(null), 0.5);
  assert.equal(resolveOriginAxesSizeMax(0.1), 0.5);
  assert.equal(resolveOriginAxesSizeMax(0.6), 0.5);
  assert.equal(resolveOriginAxesSizeMax(10), 2);
});

test('normalizeOriginAxesSize clamps to the active size limit', () => {
  assert.equal(normalizeOriginAxesSize(0.5, 0.07, 0.08), 0.08);
  assert.equal(normalizeOriginAxesSize(0.001, 0.07, 0.08), 0.01);
  assert.equal(normalizeOriginAxesSize('bad', 0.04, 0.08), 0.04);
  assert.equal(normalizeOriginAxesSize('bad', 0.07, 0.03), 0.03);
});
