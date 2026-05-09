import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

import { resolveRobotFileData } from '@/core/parsers/importRobotFile';
import { JointType, type RobotFile } from '@/types';
import { autoSeedAssembly } from './autoSeedAssembly';

const { window } = new JSDOM();

if (!globalThis.DOMParser) {
  globalThis.DOMParser = window.DOMParser;
}

if (!globalThis.XMLSerializer) {
  globalThis.XMLSerializer = window.XMLSerializer as typeof XMLSerializer;
}

function readFixture(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

function createMjcfFile(name: string, content: string): RobotFile {
  return {
    name,
    format: 'mjcf',
    content,
  };
}

test('autoSeedAssembly splits MJCF scene wrappers into scene and robot components with a bridge', () => {
  const sceneFile = createMjcfFile(
    'test/mujoco_menagerie-main/unitree_go2/scene.xml',
    readFixture('test/mujoco_menagerie-main/unitree_go2/scene.xml'),
  );
  const robotFile = createMjcfFile(
    'test/mujoco_menagerie-main/unitree_go2/go2.xml',
    readFixture('test/mujoco_menagerie-main/unitree_go2/go2.xml'),
  );
  const availableFiles = [sceneFile, robotFile];
  const allFileContents = Object.fromEntries(
    availableFiles.map((file) => [file.name, file.content]),
  );
  const importResult = resolveRobotFileData(sceneFile, {
    availableFiles,
    allFileContents,
    assets: {},
  });

  assert.equal(importResult.status, 'ready');
  if (importResult.status !== 'ready') {
    assert.fail('expected scene fixture to resolve');
  }

  const assembly = autoSeedAssembly(importResult.robotData, sceneFile.name, {
    sourceFile: sceneFile,
    availableFiles,
    allFileContents,
    assets: {},
  });
  const components = Object.values(assembly.components);
  const bridges = Object.values(assembly.bridges);

  assert.equal(assembly.name, 'go2');
  assert.deepEqual(
    components
      .map((component) => component.sourceFile)
      .sort((left, right) => left.localeCompare(right)),
    [robotFile.name, sceneFile.name].sort((left, right) => left.localeCompare(right)),
  );
  assert.equal(components.find((component) => component.sourceFile === robotFile.name)?.name, 'go2');
  assert.equal(bridges.length, 1);
  assert.equal(bridges[0]?.joint.type, JointType.FIXED);
  assert.equal(
    bridges[0]?.parentComponentId,
    components.find((component) => component.sourceFile === sceneFile.name)?.id,
  );
  assert.equal(
    bridges[0]?.childComponentId,
    components.find((component) => component.sourceFile === robotFile.name)?.id,
  );
});
