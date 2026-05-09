import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLibraryRobotLoadAction } from './libraryRobotLoadPolicy.ts';

test('resolveLibraryRobotLoadAction keeps direct library model clicks as loads in source view', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      selectedFileName: 'robots/current.urdf',
      targetFileName: 'robots/other.urdf',
      shouldRenderAssembly: false,
      hasSimpleModeSourceEdits: false,
      intent: 'direct',
    }),
    'load',
  );
});

test('resolveLibraryRobotLoadAction previews direct library model clicks while assembly view is active', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      selectedFileName: 'robots/current.urdf',
      targetFileName: 'robots/other.urdf',
      shouldRenderAssembly: true,
      hasSimpleModeSourceEdits: false,
      intent: 'direct',
    }),
    'preview',
  );
});

test('resolveLibraryRobotLoadAction does not preview the already selected model', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      selectedFileName: 'robots/current.urdf',
      targetFileName: 'robots/current.urdf',
      shouldRenderAssembly: true,
      hasSimpleModeSourceEdits: false,
      intent: 'direct',
    }),
    'already-loaded',
  );
});

test('resolveLibraryRobotLoadAction still guards unsaved source edits before replacing the source model', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      selectedFileName: 'robots/current.urdf',
      targetFileName: 'robots/other.urdf',
      shouldRenderAssembly: false,
      hasSimpleModeSourceEdits: true,
      intent: 'direct',
    }),
    'needs-draft-confirm',
  );
});
