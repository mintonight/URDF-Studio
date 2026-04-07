import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWorkspaceCanvasErrorDetail,
  probeWorkspaceCanvasWebglSupport,
} from './workspaceCanvasWebgl.ts';

test('probeWorkspaceCanvasWebglSupport reports missing browser WebGL APIs', () => {
  const result = probeWorkspaceCanvasWebglSupport({
    window: {},
    document: {
      createElement: () => ({
        getContext: () => null,
      }),
    },
  });

  assert.deepEqual(result, {
    supported: false,
    reason: 'missing-api',
    detail: 'WebGL APIs are unavailable in the current browser environment.',
  });
});

test('probeWorkspaceCanvasWebglSupport reports context creation failures', () => {
  const result = probeWorkspaceCanvasWebglSupport({
    window: {
      WebGLRenderingContext: {},
    },
    document: {
      createElement: () => ({
        getContext: () => null,
      }),
    },
  });

  assert.deepEqual(result, {
    supported: false,
    reason: 'context-creation-failed',
    detail: 'Unable to create a WebGL rendering context.',
  });
});

test('probeWorkspaceCanvasWebglSupport reports already-lost contexts', () => {
  const result = probeWorkspaceCanvasWebglSupport({
    window: {
      WebGLRenderingContext: {},
    },
    document: {
      createElement: () => ({
        getContext: () => ({
          isContextLost: () => true,
        }),
      }),
    },
  });

  assert.deepEqual(result, {
    supported: false,
    reason: 'context-lost',
    detail: 'The browser created a WebGL context, but it was already lost.',
  });
});

test('probeWorkspaceCanvasWebglSupport preserves thrown initialization errors', () => {
  const result = probeWorkspaceCanvasWebglSupport({
    window: {
      WebGLRenderingContext: {},
    },
    document: {
      createElement: () => ({
        getContext: () => {
          throw new Error('BindToCurrentSequence failed');
        },
      }),
    },
  });

  assert.deepEqual(result, {
    supported: false,
    reason: 'context-creation-failed',
    detail: 'BindToCurrentSequence failed',
  });
});

test('probeWorkspaceCanvasWebglSupport succeeds and releases temporary contexts', () => {
  let loseContextCalls = 0;
  const result = probeWorkspaceCanvasWebglSupport({
    window: {
      WebGLRenderingContext: {},
    },
    document: {
      createElement: () => ({
        getContext: () => ({
          isContextLost: () => false,
          getExtension: (name: string) =>
            name === 'WEBGL_lose_context'
              ? {
                  loseContext: () => {
                    loseContextCalls += 1;
                  },
                }
              : null,
        }),
      }),
    },
  });

  assert.deepEqual(result, { supported: true });
  assert.equal(loseContextCalls, 1);
});

test('getWorkspaceCanvasErrorDetail normalizes error payloads', () => {
  assert.equal(
    getWorkspaceCanvasErrorDetail(new Error('Renderer init failed')),
    'Renderer init failed',
  );
  assert.equal(getWorkspaceCanvasErrorDetail('  WebGL context lost  '), 'WebGL context lost');
  assert.equal(getWorkspaceCanvasErrorDetail({ message: 'ignored' }), undefined);
});
