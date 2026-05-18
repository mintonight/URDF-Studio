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

test('resolveLibraryRobotLoadAction previews from the unsaved-edit confirmation without switching files', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      selectedFileName: 'robots/current.urdf',
      targetFileName: 'robots/other.urdf',
      shouldPreviewCurrentState: false,
      hasSimpleModeSourceEdits: true,
      intent: 'preview',
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

test('resolveLibraryRobotLoadAction asks for preview or discard before replacing unsaved source edits', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      selectedFileName: 'robots/current.urdf',
      targetFileName: 'robots/other.urdf',
      shouldPreviewCurrentState: false,
      hasSimpleModeSourceEdits: true,
      intent: 'direct',
    }),
    'needs-preview-or-discard-confirm',
  );
});

test('resolveLibraryRobotLoadAction discards unsaved source edits when requested', () => {
  assert.equal(
    resolveLibraryRobotLoadAction({
      selectedFileName: 'robots/current.urdf',
      targetFileName: 'robots/other.urdf',
      shouldPreviewCurrentState: false,
      hasSimpleModeSourceEdits: true,
      intent: 'discard',
    }),
    'load',
  );
});
