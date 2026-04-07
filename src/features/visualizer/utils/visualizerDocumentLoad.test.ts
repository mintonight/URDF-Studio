import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVisualizerDocumentLoadEvent } from './visualizerDocumentLoad.ts';

test('buildVisualizerDocumentLoadEvent reports ready when no mesh streaming is required', () => {
  assert.deepEqual(
    buildVisualizerDocumentLoadEvent({
      resolvedCount: 0,
      totalCount: 0,
    }),
    {
      status: 'ready',
      phase: 'ready',
      message: null,
      progressMode: 'percent',
      progressPercent: 100,
      loadedCount: null,
      totalCount: null,
      error: null,
    },
  );
});

test('buildVisualizerDocumentLoadEvent reports preparing-scene before the first mesh resolves', () => {
  assert.deepEqual(
    buildVisualizerDocumentLoadEvent({
      resolvedCount: 0,
      totalCount: 5,
    }),
    {
      status: 'loading',
      phase: 'preparing-scene',
      message: null,
      progressMode: 'indeterminate',
      progressPercent: null,
      loadedCount: 0,
      totalCount: 5,
      error: null,
    },
  );
});

test('buildVisualizerDocumentLoadEvent reports streaming-meshes during partial completion', () => {
  assert.deepEqual(
    buildVisualizerDocumentLoadEvent({
      resolvedCount: 2,
      totalCount: 5,
    }),
    {
      status: 'loading',
      phase: 'streaming-meshes',
      message: null,
      progressMode: 'count',
      progressPercent: null,
      loadedCount: 2,
      totalCount: 5,
      error: null,
    },
  );
});

test('buildVisualizerDocumentLoadEvent reports ready once mesh streaming completes', () => {
  assert.deepEqual(
    buildVisualizerDocumentLoadEvent({
      resolvedCount: 5,
      totalCount: 5,
    }),
    {
      status: 'ready',
      phase: 'ready',
      message: null,
      progressMode: 'percent',
      progressPercent: 100,
      loadedCount: 5,
      totalCount: 5,
      error: null,
    },
  );
});
