import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { DEFAULT_LINK, JointType, type AssemblyState, type RobotFile } from '@/types';
import { resolveRobotFileData } from '@/core/parsers/importRobotFile';
import { commitResolvedRobotLoad } from './commitResolvedRobotLoad.ts';

const { window } = new JSDOM();

if (!globalThis.DOMParser) {
  globalThis.DOMParser = window.DOMParser;
}

if (!globalThis.XMLSerializer) {
  globalThis.XMLSerializer = window.XMLSerializer as typeof XMLSerializer;
}

function createRobotFile(
  overrides: Partial<RobotFile> & Pick<RobotFile, 'name' | 'format' | 'content'>,
): RobotFile {
  return {
    ...overrides,
  };
}

function createExistingAssembly(): AssemblyState {
  return {
    name: 'existing_workspace',
    components: {
      comp_base: {
        id: 'comp_base',
        name: 'base',
        sourceFile: 'robots/base.urdf',
        robot: {
          name: 'base',
          rootLinkId: 'comp_base_base_link',
          links: {
            comp_base_base_link: {
              ...DEFAULT_LINK,
              id: 'comp_base_base_link',
              name: 'base_link',
            },
          },
          joints: {},
        },
        visible: true,
      },
      comp_tool: {
        id: 'comp_tool',
        name: 'tool',
        sourceFile: 'robots/tool.urdf',
        robot: {
          name: 'tool',
          rootLinkId: 'comp_tool_tool_link',
          links: {
            comp_tool_tool_link: {
              ...DEFAULT_LINK,
              id: 'comp_tool_tool_link',
              name: 'tool_link',
            },
          },
          joints: {},
        },
        visible: true,
      },
    },
    bridges: {},
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

test('commitResolvedRobotLoad keeps app mode unchanged when the current mode is already normalized', () => {
  let setAppModeCount = 0;
  const file = createRobotFile({
    name: 'robots/unitree/laikago.urdf',
    format: 'urdf',
    content: '<robot name="laikago" />',
  });

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
    },
    setAppMode: () => {
      setAppModeCount += 1;
    },
    setOriginalFileFormat: () => {},
    setOriginalUrdfContent: () => {},
    setRobot: () => {},
    setSelectedFile: () => {},
    setSelection: () => {},
  });

  assert.equal(setAppModeCount, 0);
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

test('commitResolvedRobotLoad seeds MJCF scene wrappers with the included robot display name', () => {
  const sceneFile = createRobotFile({
    name: 'robots/go2/scene.xml',
    format: 'mjcf',
    content: `<mujoco model="go2 scene">
  <include file="go2.xml" />
  <worldbody>
    <geom name="floor" type="plane" size="0 0 0.05" />
  </worldbody>
</mujoco>`,
  });
  const robotFile = createRobotFile({
    name: 'robots/go2/go2.xml',
    format: 'mjcf',
    content: `<mujoco model="go2">
  <worldbody>
    <body name="base">
      <freejoint />
    </body>
  </worldbody>
</mujoco>`,
  });
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
    assert.fail('expected scene test fixture to resolve');
  }

  let committedRobotName: string | null = null;
  let seededAssembly: AssemblyState | null = null;

  commitResolvedRobotLoad({
    file: sceneFile,
    importResult,
    currentAppMode: 'editor',
    currentAssemblyState: null,
    availableFiles,
    allFileContents,
    assets: {},
    markRobotBaselineSaved: () => {},
    setAppMode: () => {},
    setOriginalFileFormat: () => {},
    setOriginalUrdfContent: () => {},
    setRobot: (robotData) => {
      committedRobotName = robotData.name;
    },
    setSelectedFile: () => {},
    setSelection: () => {},
    setAssembly: (assembly) => {
      seededAssembly = assembly;
    },
  });

  assert.equal(committedRobotName, 'go2');
  assert.equal(seededAssembly?.name, 'go2');
  assert.deepEqual(
    Object.values(seededAssembly?.components ?? {})
      .map((component) => component.sourceFile)
      .sort((left, right) => left.localeCompare(right)),
    [robotFile.name, sceneFile.name].sort((left, right) => left.localeCompare(right)),
  );
  assert.equal(Object.values(seededAssembly?.bridges ?? {}).length, 1);
  assert.equal(Object.values(seededAssembly?.bridges ?? {})[0]?.joint.type, JointType.FIXED);
});

test('commitResolvedRobotLoad preserves existing multi-component assemblies', () => {
  const file = createRobotFile({
    name: 'robots/standalone.urdf',
    format: 'urdf',
    content: '<robot name="standalone"><link name="base_link" /></robot>',
  });
  const existingAssembly = createExistingAssembly();
  let setAssemblyCallCount = 0;

  commitResolvedRobotLoad({
    file,
    importResult: {
      status: 'ready',
      format: 'urdf',
      robotData: {
        name: 'standalone',
        links: {},
        joints: {},
        rootLinkId: 'base_link',
      },
      resolvedUrdfContent: null,
      resolvedUrdfSourceFilePath: null,
    },
    currentAppMode: 'editor',
    currentAssemblyState: existingAssembly,
    markRobotBaselineSaved: () => {},
    setAppMode: () => {},
    setOriginalFileFormat: () => {},
    setOriginalUrdfContent: () => {},
    setRobot: () => {},
    setSelectedFile: () => {},
    setSelection: () => {},
    setAssembly: () => {
      setAssemblyCallCount += 1;
    },
  });

  assert.equal(setAssemblyCallCount, 0);
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
