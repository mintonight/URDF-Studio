import test from 'node:test';
import assert from 'node:assert/strict';

import type { RobotFile } from '@/types';

import {
  buildEditableSourcePatchState,
  resolveEditablePatchTarget,
} from './editableSourcePatchState.ts';

function createRobotFile(name: string, content: string): RobotFile {
  return {
    name,
    content,
    format: 'mjcf',
  };
}

test('resolveEditablePatchTarget prefers selected file when names match', () => {
  const selectedFile = createRobotFile('robot.xml', '<robot />');
  const availableFiles = [selectedFile, createRobotFile('other.xml', '<other />')];

  const result = resolveEditablePatchTarget({
    selectedFile,
    availableFiles,
    sourceFileName: 'robot.xml',
  });

  assert.equal(result.targetFileName, 'robot.xml');
  assert.equal(result.targetFile, selectedFile);
});

test('buildEditableSourcePatchState updates selected, available, and text cache consistently', () => {
  const selectedFile = createRobotFile('robot.xml', '<before />');
  const otherFile = createRobotFile('other.xml', '<other />');
  const availableFiles = [selectedFile, otherFile];
  const allFileContents = {
    'robot.xml': '<before />',
    'other.xml': '<other />',
  };

  const result = buildEditableSourcePatchState({
    selectedFile,
    availableFiles,
    allFileContents,
    targetFile: selectedFile,
    nextContent: '<after />',
  });

  assert.equal(result.didChange, true);
  assert.equal(result.nextSelectedFile?.content, '<after />');
  assert.equal(result.nextAvailableFiles[0]?.content, '<after />');
  assert.equal(result.nextAvailableFiles[1]?.content, '<other />');
  assert.equal(result.nextAllFileContents['robot.xml'], '<after />');
});

test('buildEditableSourcePatchState is a no-op when content is unchanged', () => {
  const selectedFile = createRobotFile('robot.xml', '<same />');
  const availableFiles = [selectedFile];
  const allFileContents = { 'robot.xml': '<same />' };

  const result = buildEditableSourcePatchState({
    selectedFile,
    availableFiles,
    allFileContents,
    targetFile: selectedFile,
    nextContent: '<same />',
  });

  assert.equal(result.didChange, false);
  assert.equal(result.nextSelectedFile, selectedFile);
  assert.equal(result.nextAvailableFiles, availableFiles);
  assert.equal(result.nextAllFileContents, allFileContents);
});
