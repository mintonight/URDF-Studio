import assert from 'node:assert/strict';
import test from 'node:test';

import { handleUnifiedViewerWorkspaceLeave } from './unifiedViewerHoverReset.ts';

test('viewer workspace leave ends viewer pointer state and clears hover', () => {
  const calls: string[] = [];

  handleUnifiedViewerWorkspaceLeave({
    activeScene: 'viewer',
    clearHover: () => calls.push('clear-hover'),
    handleViewerMouseUp: () => calls.push('viewer-mouse-up'),
    handleVisualizerMouseUp: () => calls.push('visualizer-mouse-up'),
  });

  assert.deepEqual(calls, ['viewer-mouse-up', 'clear-hover']);
});

test('visualizer workspace leave ends visualizer pointer state and clears hover', () => {
  const calls: string[] = [];

  handleUnifiedViewerWorkspaceLeave({
    activeScene: 'visualizer',
    clearHover: () => calls.push('clear-hover'),
    handleViewerMouseUp: () => calls.push('viewer-mouse-up'),
    handleVisualizerMouseUp: () => calls.push('visualizer-mouse-up'),
  });

  assert.deepEqual(calls, ['visualizer-mouse-up', 'clear-hover']);
});
