import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLibraryRobotLoadAction } from './libraryRobotLoadPolicy.ts';

test('resolveLibraryRobotLoadAction keeps direct library model clicks as loads when the current state can be replaced directly', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      selectedFileName: 'robots/current.urdf',
      targetFileName: 'robots/other.urdf',
      shouldPreviewCurrentState: false,
      hasSimpleModeSourceEdits: false,
      intent: 'direct',
    }),
    'load',
  );
});

test('resolveLibraryRobotLoadAction previews direct library model clicks when the current workspace has meaningful edits', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      selectedFileName: 'robots/current.urdf',
      targetFileName: 'robots/other.urdf',
      shouldPreviewCurrentState: true,
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
      shouldPreviewCurrentState: true,
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
      shouldPreviewCurrentState: false,
      hasSimpleModeSourceEdits: true,
      intent: 'direct',
    }),
    'needs-draft-confirm',
  );
});
