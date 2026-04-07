import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRobotLoadSupportContextKey,
  preserveDocumentLoadProgressForSameFile,
  shouldCommitResolvedRobotSelection,
  shouldIgnoreViewerLoadRegressionAfterReadySameFile,
  shouldIgnoreStaleViewerDocumentLoadEvent,
  shouldSkipRedundantRobotReload,
} from './documentLoadFlow.ts';

test('shouldCommitResolvedRobotSelection only commits once the file can drive the viewer scene', () => {
  assert.equal(
    shouldCommitResolvedRobotSelection({
      status: 'ready',
    }),
    true,
  );

  assert.equal(
    shouldCommitResolvedRobotSelection({
      status: 'needs_hydration',
    }),
    true,
  );

  assert.equal(
    shouldCommitResolvedRobotSelection({
      status: 'error',
      reason: 'source_only_fragment',
    }),
    false,
  );

  assert.equal(
    shouldCommitResolvedRobotSelection({
      status: 'error',
      reason: 'parse_failed',
    }),
    false,
  );
});

test('shouldIgnoreStaleViewerDocumentLoadEvent ignores old scene progress while a different file is staged', () => {
  assert.equal(
    shouldIgnoreStaleViewerDocumentLoadEvent({
      isPreviewing: false,
      activeDocumentFileName: 'robots/current.urdf',
      documentLoadState: {
        status: 'loading',
        fileName: 'robots/next.urdf',
      },
    }),
    true,
  );

  assert.equal(
    shouldIgnoreStaleViewerDocumentLoadEvent({
      isPreviewing: false,
      activeDocumentFileName: 'robots/current.urdf',
      documentLoadState: {
        status: 'hydrating',
        fileName: 'robots/next.usd',
      },
    }),
    true,
  );

  assert.equal(
    shouldIgnoreStaleViewerDocumentLoadEvent({
      isPreviewing: false,
      activeDocumentFileName: 'robots/current.urdf',
      documentLoadState: {
        status: 'loading',
        fileName: 'robots/current.urdf',
      },
    }),
    false,
  );

  assert.equal(
    shouldIgnoreStaleViewerDocumentLoadEvent({
      isPreviewing: true,
      activeDocumentFileName: 'robots/current.urdf',
      documentLoadState: {
        status: 'loading',
        fileName: 'robots/next.urdf',
      },
    }),
    false,
  );

  assert.equal(
    shouldIgnoreStaleViewerDocumentLoadEvent({
      isPreviewing: false,
      activeDocumentFileName: null,
      documentLoadState: {
        status: 'loading',
        fileName: 'robots/next.urdf',
      },
    }),
    false,
  );

  assert.equal(
    shouldIgnoreStaleViewerDocumentLoadEvent({
      isPreviewing: false,
      activeDocumentFileName: 'robots/current.urdf',
      documentLoadState: {
        status: 'ready',
        fileName: 'robots/next.urdf',
      },
    }),
    false,
  );
});

test('preserveDocumentLoadProgressForSameFile keeps advanced same-file USD progress from regressing back to checking-path', () => {
  assert.deepEqual(
    preserveDocumentLoadProgressForSameFile({
      currentState: {
        status: 'loading',
        fileName: 'robots/unitree/g1.usda',
        format: 'usd',
        phase: 'finalizing-scene',
        message: null,
        progressMode: 'indeterminate',
        progressPercent: 96,
        loadedCount: null,
        totalCount: null,
      },
      nextState: {
        status: 'loading',
        fileName: 'robots/unitree/g1.usda',
        format: 'usd',
        phase: 'checking-path',
        message: null,
        progressPercent: null,
        loadedCount: null,
        totalCount: null,
      },
    }),
    {
      status: 'loading',
      fileName: 'robots/unitree/g1.usda',
      format: 'usd',
      phase: 'finalizing-scene',
      message: null,
      progressMode: 'indeterminate',
      progressPercent: 96,
      loadedCount: null,
      totalCount: null,
    },
  );
});

test('preserveDocumentLoadProgressForSameFile leaves unrelated files unchanged', () => {
  assert.deepEqual(
    preserveDocumentLoadProgressForSameFile({
      currentState: {
        status: 'loading',
        fileName: 'robots/unitree/g1.usda',
        format: 'usd',
        phase: 'finalizing-scene',
        message: null,
        progressPercent: 96,
        loadedCount: null,
        totalCount: null,
      },
      nextState: {
        status: 'loading',
        fileName: 'robots/unitree/h1.usda',
        format: 'usd',
        phase: 'checking-path',
        message: null,
        progressPercent: null,
        loadedCount: null,
        totalCount: null,
      },
    }),
    {
      status: 'loading',
      fileName: 'robots/unitree/h1.usda',
      format: 'usd',
      phase: 'checking-path',
      message: null,
      progressPercent: null,
      loadedCount: null,
      totalCount: null,
    },
  );
});

test('shouldIgnoreViewerLoadRegressionAfterReadySameFile ignores hidden same-file viewer reload progress after ready', () => {
  assert.equal(
    shouldIgnoreViewerLoadRegressionAfterReadySameFile({
      currentState: {
        status: 'ready',
        fileName: 'robots/unitree/g1.usda',
        format: 'usd',
        phase: 'ready',
        message: null,
        progressPercent: 100,
        loadedCount: null,
        totalCount: null,
      },
      nextState: {
        status: 'loading',
        fileName: 'robots/unitree/g1.usda',
        format: 'usd',
        phase: 'checking-path',
        message: null,
        progressPercent: 0,
        loadedCount: null,
        totalCount: null,
      },
    }),
    true,
  );

  assert.equal(
    shouldIgnoreViewerLoadRegressionAfterReadySameFile({
      currentState: {
        status: 'ready',
        fileName: 'robots/unitree/g1.usda',
        format: 'usd',
        phase: 'ready',
        message: null,
        progressPercent: 100,
        loadedCount: null,
        totalCount: null,
      },
      nextState: {
        status: 'loading',
        fileName: 'robots/unitree/h1.usda',
        format: 'usd',
        phase: 'checking-path',
        message: null,
        progressPercent: 0,
        loadedCount: null,
        totalCount: null,
      },
    }),
    false,
  );
});

test('buildRobotLoadSupportContextKey changes when import support context changes', () => {
  const baseKey = buildRobotLoadSupportContextKey({
    availableFiles: [{ name: 'robots/sally.xml', format: 'mjcf' }],
    assets: {},
    allFileContents: {},
  });

  const withSupportFilesKey = buildRobotLoadSupportContextKey({
    availableFiles: [
      { name: 'robots/sally.xml', format: 'mjcf' },
      { name: 'robots/scenes/basic_scene.xml', format: 'mjcf' },
    ],
    assets: {},
    allFileContents: {},
  });

  const withAssetsKey = buildRobotLoadSupportContextKey({
    availableFiles: [
      { name: 'robots/sally.xml', format: 'mjcf' },
      { name: 'robots/scenes/basic_scene.xml', format: 'mjcf' },
    ],
    assets: {
      'meshes/base.stl': 'blob:mesh',
    },
    allFileContents: {},
  });

  assert.notEqual(baseKey, withSupportFilesKey);
  assert.notEqual(withSupportFilesKey, withAssetsKey);
});

test('shouldSkipRedundantRobotReload only skips same-file loads when context is unchanged and the current file is not errored', () => {
  assert.equal(
    shouldSkipRedundantRobotReload({
      currentSelectedFile: {
        name: 'robots/sally.xml',
        format: 'mjcf',
        content: '<mujoco model="sally" />',
        blobUrl: null,
      },
      currentDocumentLoadState: {
        status: 'ready',
        fileName: 'robots/sally.xml',
        format: 'mjcf',
      },
      nextFile: {
        name: 'robots/sally.xml',
        format: 'mjcf',
        content: '<mujoco model="sally" />',
        blobUrl: null,
      },
      previousLoadSupportContextKey: 'ctx-a',
      nextLoadSupportContextKey: 'ctx-a',
    }),
    true,
  );

  assert.equal(
    shouldSkipRedundantRobotReload({
      currentSelectedFile: {
        name: 'robots/sally.xml',
        format: 'mjcf',
        content: '<mujoco model="sally" />',
        blobUrl: null,
      },
      currentDocumentLoadState: {
        status: 'error',
        fileName: 'robots/sally.xml',
        format: 'mjcf',
      },
      nextFile: {
        name: 'robots/sally.xml',
        format: 'mjcf',
        content: '<mujoco model="sally" />',
        blobUrl: null,
      },
      previousLoadSupportContextKey: 'ctx-a',
      nextLoadSupportContextKey: 'ctx-a',
    }),
    false,
  );

  assert.equal(
    shouldSkipRedundantRobotReload({
      currentSelectedFile: {
        name: 'robots/sally.xml',
        format: 'mjcf',
        content: '<mujoco model="sally" />',
        blobUrl: null,
      },
      currentDocumentLoadState: {
        status: 'ready',
        fileName: 'robots/sally.xml',
        format: 'mjcf',
      },
      nextFile: {
        name: 'robots/sally.xml',
        format: 'mjcf',
        content: '<mujoco model="sally" />',
        blobUrl: null,
      },
      previousLoadSupportContextKey: 'ctx-a',
      nextLoadSupportContextKey: 'ctx-b',
    }),
    false,
  );
});
