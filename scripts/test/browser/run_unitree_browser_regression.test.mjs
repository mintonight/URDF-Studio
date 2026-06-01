import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isIgnorableBrowserConsoleWarning,
  summarizePostReadyHistoryDelta,
} from './run_unitree_browser_regression.mjs';

test('summarizePostReadyHistoryDelta reports target-file steps added after the ready sample', () => {
  const beforeHistory = [
    {
      sourceFileName: 'robots/demo/root.usd',
      step: 'load-usd-stage',
      status: 'resolved',
      timestamp: 10,
    },
    {
      sourceFileName: 'robots/demo/root.usd',
      step: 'ready',
      status: 'resolved',
      timestamp: 20,
    },
  ];
  const afterHistory = [
    ...beforeHistory,
    {
      sourceFileName: 'robots/other/root.usd',
      step: 'load-usd-stage',
      status: 'resolved',
      timestamp: 25,
    },
    {
      sourceFileName: 'robots/demo/root.usd',
      step: 'commit-worker-robot-data',
      status: 'resolved',
      timestamp: 30,
    },
    {
      sourceFileName: 'robots/demo/root.usd',
      step: 'ready',
      status: 'resolved',
      timestamp: 40,
    },
  ];

  assert.deepEqual(
    summarizePostReadyHistoryDelta(beforeHistory, afterHistory, ['robots/demo/root.usd']),
    {
      historyDelta: 2,
      newSteps: ['commit-worker-robot-data', 'ready'],
    },
  );
});

test('summarizePostReadyHistoryDelta handles unchanged capped histories without false positives', () => {
  const beforeHistory = [
    {
      sourceFileName: '/robots/demo/root.usd',
      step: 'ready',
      status: 'resolved',
      timestamp: 20,
    },
  ];
  const afterHistory = [
    {
      sourceFileName: 'robots/demo/root.usd',
      step: 'ready',
      status: 'resolved',
      timestamp: 20,
    },
  ];

  assert.deepEqual(
    summarizePostReadyHistoryDelta(beforeHistory, afterHistory, ['robots/demo/root.usd']),
    {
      historyDelta: 0,
      newSteps: [],
    },
  );
});

test('isIgnorableBrowserConsoleWarning only suppresses WebGL ReadPixels performance noise', () => {
  assert.equal(
    isIgnorableBrowserConsoleWarning(
      '[.WebGL-0x20ec02ce3600]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels',
    ),
    true,
  );
  assert.equal(isIgnorableBrowserConsoleWarning('USD parser warning: missing material'), false);
});
