import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveResponsivePanelLayout } from './useResponsivePanelLayout.ts';

test('resolveResponsivePanelLayout edge-docks the options panel in narrow unified viewer layouts', () => {
  const layout = resolveResponsivePanelLayout({
    metrics: {
      containerWidth: 620,
      containerHeight: 520,
      optionsWidth: 208,
      optionsHeight: 208,
      jointsWidth: 208,
    },
    showOptionsPanel: true,
    showJointPanel: false,
    preferEdgeDockedOptionsPanel: true,
  });

  assert.deepEqual(layout.optionsDefaultPosition, {
    top: '16px',
    right: '-152px',
    left: 'auto',
    transform: 'none',
  });
});

test('resolveResponsivePanelLayout edge-docks the joint panel in narrow unified viewer layouts', () => {
  const layout = resolveResponsivePanelLayout({
    metrics: {
      containerWidth: 266,
      containerHeight: 520,
      optionsWidth: 208,
      optionsHeight: 208,
      jointsWidth: 208,
    },
    showOptionsPanel: false,
    showJointPanel: true,
    preferEdgeDockedJointPanel: true,
  });

  assert.deepEqual(layout.jointsDefaultPosition, {
    top: '16px',
    left: '-152px',
    right: 'auto',
    transform: 'none',
  });
  assert.equal(layout.jointsPanelMaxHeight, 420);
});

test('resolveResponsivePanelLayout keeps a softer max height for the centered-left joint panel', () => {
  const layout = resolveResponsivePanelLayout({
    metrics: {
      containerWidth: 266,
      containerHeight: 520,
      optionsWidth: 208,
      optionsHeight: 208,
      jointsWidth: 208,
    },
    showOptionsPanel: false,
    showJointPanel: true,
    preferEdgeDockedJointPanel: false,
  });

  assert.deepEqual(layout.jointsDefaultPosition, {
    top: '50%',
    left: '16px',
    transform: 'translateY(-50%)',
  });
  assert.equal(layout.jointsPanelMaxHeight, 420);
});
