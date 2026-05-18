import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveViewerDocumentLifecycleCallbacks } from './viewerDocumentLifecycleCallbacks.ts';

test('resolveViewerDocumentLifecycleCallbacks disables document lifecycle callbacks for assembly rendering', () => {
  const callbacks = {
    onDocumentLoadEvent: () => undefined,
    onRuntimeRobotLoaded: () => undefined,
    onRuntimeSceneReadyForDisplay: () => undefined,
  };

  assert.deepEqual(
    resolveViewerDocumentLifecycleCallbacks({
      shouldRenderAssembly: true,
      callbacks,
    }),
    {},
  );
});

test('resolveViewerDocumentLifecycleCallbacks keeps callbacks for standalone document rendering', () => {
  const callbacks = {
    onDocumentLoadEvent: () => undefined,
    onRuntimeRobotLoaded: () => undefined,
    onRuntimeSceneReadyForDisplay: () => undefined,
  };

  assert.equal(
    resolveViewerDocumentLifecycleCallbacks({
      shouldRenderAssembly: false,
      callbacks,
    }),
    callbacks,
  );
});
