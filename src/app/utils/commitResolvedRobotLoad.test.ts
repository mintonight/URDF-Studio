import assert from 'node:assert/strict';
import test from 'node:test';

import { commitResolvedRobotLoad } from './commitResolvedRobotLoad.ts';
import type { RobotFile } from '@/types';

function createRobotFile(
  overrides: Partial<RobotFile> & Pick<RobotFile, 'name' | 'format' | 'content'>,
): RobotFile {
  return {
    ...overrides,
  };
}

test('commitResolvedRobotLoad writes ready robot data before selecting the viewer file', () => {
  const events: string[] = [];
  const file = createRobotFile({
    name: 'robots/unitree/b2.urdf',
    format: 'urdf',
    content: '<robot name="b2" />',
  });

  const recorded = {
    originalContent: null as string | null,
    originalFormat: null as RobotFile['format'] | null,
    selectedFileName: null as string | null,
    robotName: null as string | null,
    baselineSaved: false,
    reloaded: false,
  };

  commitResolvedRobotLoad({
    file,
    importResult: {
      status: 'ready',
      format: 'urdf',
      robotData: {
        name: 'b2',
        links: {},
        joints: {},
        rootLinkId: 'base_link',
      },
      resolvedUrdfContent: null,
      resolvedUrdfSourceFilePath: null,
    },
    currentAppMode: 'editor',
    onViewerReload: () => {
      events.push('reload');
      recorded.reloaded = true;
    },
    markRobotBaselineSaved: () => {
      events.push('baseline');
      recorded.baselineSaved = true;
    },
    setAppMode: () => {
      events.push('appMode');
    },
    setOriginalFileFormat: (format) => {
      events.push('originalFormat');
      recorded.originalFormat = format;
    },
    setOriginalUrdfContent: (content) => {
      events.push('originalContent');
      recorded.originalContent = content;
    },
    setRobot: (robotData) => {
      events.push('robot');
      recorded.robotName = robotData.name;
    },
    setSelectedFile: (selectedFile) => {
      events.push('selectedFile');
      recorded.selectedFileName = selectedFile.name;
    },
    setSelection: () => {
      events.push('selection');
    },
  });

  assert.deepEqual(events, [
    'robot',
    'baseline',
    'selectedFile',
    'originalContent',
    'originalFormat',
    'selection',
    'reload',
  ]);
  assert.equal(recorded.robotName, 'b2');
  assert.equal(recorded.selectedFileName, file.name);
  assert.equal(recorded.originalContent, file.content);
  assert.equal(recorded.originalFormat, 'urdf');
  assert.equal(recorded.baselineSaved, true);
  assert.equal(recorded.reloaded, true);
});

test('commitResolvedRobotLoad switches back to structure mode when a concrete file is loaded', () => {
  const events: string[] = [];
  const file = createRobotFile({
    name: 'robots/unitree/laikago.urdf',
    format: 'urdf',
    content: '<robot name="laikago" />',
  });

  let sidebarTab: 'structure' | 'workspace' | null = null;

  commitResolvedRobotLoad({
    file,
    importResult: {
      status: 'ready',
      format: 'urdf',
      robotData: {
        name: 'laikago',
        links: {},
        joints: {},
        rootLinkId: 'trunk',
      },
      resolvedUrdfContent: null,
      resolvedUrdfSourceFilePath: null,
    },
    currentAppMode: 'editor',
    markRobotBaselineSaved: () => {
      events.push('baseline');
    },
    setAppMode: () => {},
    setOriginalFileFormat: () => {},
    setOriginalUrdfContent: () => {},
    setRobot: () => {
      events.push('robot');
    },
    setSelectedFile: () => {
      events.push('selectedFile');
    },
    setSelection: () => {
      events.push('selection');
    },
    setSidebarTab: (nextTab) => {
      events.push(`sidebar:${nextTab}`);
      sidebarTab = nextTab;
    },
  });

  assert.equal(sidebarTab, 'structure');
  assert.deepEqual(events, ['robot', 'baseline', 'selectedFile', 'sidebar:structure', 'selection']);
});

test('commitResolvedRobotLoad uses resolved URDF content for ready xacro files', () => {
  const file = createRobotFile({
    name: 'robots/unitree/b2.xacro',
    format: 'xacro',
    content: '<xacro:robot name="b2" />',
  });

  let originalContent: string | null = null;
  let writeCount = 0;

  commitResolvedRobotLoad({
    file,
    importResult: {
      status: 'ready',
      format: 'xacro',
      robotData: {
        name: 'b2',
        links: {},
        joints: {},
        rootLinkId: 'base_link',
      },
      resolvedUrdfContent: '<robot name="b2"><link name="base_link" /></robot>',
      resolvedUrdfSourceFilePath: 'robots/unitree/b2.urdf',
    },
    currentAppMode: 'editor',
    onViewerReload: () => {},
    markRobotBaselineSaved: () => {},
    setAppMode: () => {},
    setOriginalFileFormat: () => {},
    setOriginalUrdfContent: (content) => {
      writeCount += 1;
      originalContent = content;
    },
    setRobot: () => {},
    setSelectedFile: () => {},
    setSelection: () => {},
  });

  assert.equal(writeCount, 1);
  assert.equal(originalContent, '<robot name="b2"><link name="base_link" /></robot>');
});

test('commitResolvedRobotLoad keeps USD hydration loads out of robot state writes', () => {
  const events: string[] = [];
  const file = createRobotFile({
    name: 'robots/unitree/b2.usd',
    format: 'usd',
    content: '',
  });

  commitResolvedRobotLoad({
    file,
    importResult: {
      status: 'needs_hydration',
      format: 'usd',
    },
    currentAppMode: 'editor',
    onViewerReload: () => {
      events.push('reload');
    },
    markRobotBaselineSaved: () => {
      events.push('baseline');
    },
    setAppMode: () => {
      events.push('appMode');
    },
    setOriginalFileFormat: () => {
      events.push('originalFormat');
    },
    setOriginalUrdfContent: () => {
      events.push('originalContent');
    },
    setRobot: () => {
      events.push('robot');
    },
    setSelectedFile: () => {
      events.push('selectedFile');
    },
    setSelection: () => {
      events.push('selection');
    },
  });

  assert.deepEqual(events, [
    'selectedFile',
    'originalContent',
    'originalFormat',
    'selection',
    'reload',
  ]);
});
