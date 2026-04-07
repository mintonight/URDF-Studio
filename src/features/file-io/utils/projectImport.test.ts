import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';

import { DEFAULT_JOINT, DEFAULT_LINK, JointType, type RobotData } from '@/types';

import { buildLibraryArchivePath, PROJECT_ROBOT_HISTORY_FILE } from './projectArchive';
import { exportProject } from './projectExport';
import { importProject } from './projectImport';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;

function createDemoRobot(): RobotData {
  return {
    name: 'demo',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visible: true,
      },
    },
    joints: {},
  };
}

function createAssemblyComponentRobot(): RobotData {
  return {
    name: 'left_arm',
    rootLinkId: 'comp_left_base_link',
    links: {
      comp_left_base_link: {
        ...DEFAULT_LINK,
        id: 'comp_left_base_link',
        name: 'left_arm',
        visible: true,
      },
    },
    joints: {},
  };
}

function createBridgeAssemblyComponentRobot(componentKey: string): RobotData {
  const rootLinkId = `${componentKey}_base_link`;
  return {
    name: componentKey,
    rootLinkId,
    links: {
      [rootLinkId]: {
        ...DEFAULT_LINK,
        id: rootLinkId,
        name: 'base_link',
        visible: true,
      },
    },
    joints: {},
  };
}

function createNonRootBridgeAssemblyComponentRobot(componentKey: string): RobotData {
  const rootLinkId = `${componentKey}_base_link`;
  const toolLinkId = `${componentKey}_tool_link`;
  return {
    name: componentKey,
    rootLinkId,
    links: {
      [rootLinkId]: {
        ...DEFAULT_LINK,
        id: rootLinkId,
        name: rootLinkId,
        visible: true,
      },
      [toolLinkId]: {
        ...DEFAULT_LINK,
        id: toolLinkId,
        name: toolLinkId,
        visible: true,
      },
    },
    joints: {
      [`${componentKey}_tool_joint`]: {
        ...DEFAULT_JOINT,
        id: `${componentKey}_tool_joint`,
        name: `${componentKey}_tool_joint`,
        type: JointType.FIXED,
        parentLinkId: rootLinkId,
        childLinkId: toolLinkId,
        origin: {
          xyz: { x: 1.2, y: -0.35, z: 0.5 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
    },
  };
}

async function buildProjectZip(): Promise<JSZip> {
  const robot = createDemoRobot();
  const sourcePath = 'robots/demo/demo.urdf';
  const sourceContent = '<robot name="demo"><link name="base_link" /></robot>';

  const exportResult = await exportProject({
    name: 'demo_project',
    uiState: {
      appMode: 'editor',
      lang: 'en',
    },
    assetsState: {
      availableFiles: [
        {
          name: sourcePath,
          format: 'urdf',
          content: sourceContent,
        },
      ],
      assets: {},
      allFileContents: {
        [sourcePath]: sourceContent,
      },
      motorLibrary: {},
      selectedFileName: sourcePath,
      originalUrdfContent: sourceContent,
      originalFileFormat: 'urdf',
      usdPreparedExportCaches: {},
    },
    robotState: {
      present: robot,
      history: { past: [], future: [] },
      activity: [],
    },
    assemblyState: {
      present: null,
      history: { past: [], future: [] },
      activity: [],
    },
    getMergedRobotData: () => robot,
  });

  return await JSZip.loadAsync(await exportResult.blob.arrayBuffer());
}

async function toProjectFile(zip: JSZip): Promise<File> {
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return bytes as unknown as File;
}

test('importProject fails fast when a referenced library source file is missing', async () => {
  const zip = await buildProjectZip();
  zip.remove(buildLibraryArchivePath('robots/demo/demo.urdf'));

  await assert.rejects(
    importProject(await toProjectFile(zip), 'en'),
    /missing required library source file "robots\/demo\/demo\.urdf"/i,
  );
});

test('importProject fails fast when robot history is missing', async () => {
  const zip = await buildProjectZip();
  zip.remove(PROJECT_ROBOT_HISTORY_FILE);

  await assert.rejects(
    importProject(await toProjectFile(zip), 'en'),
    /missing required history snapshot/i,
  );
});

test('importProject preserves blob-backed USD library files even when their inline source is empty', async () => {
  const robot = createDemoRobot();
  const sourcePath = 'robots/demo/demo.urdf';
  const sourceContent = '<robot name="demo"><link name="base_link" /></robot>';
  const usdPath = 'unitree_model/Go2/usd/configuration/go2_description_sensor.usd';

  const exportResult = await exportProject({
    name: 'demo_project_with_usd_dependency',
    uiState: {
      appMode: 'editor',
      lang: 'en',
    },
    assetsState: {
      availableFiles: [
        {
          name: sourcePath,
          format: 'urdf',
          content: sourceContent,
        },
        {
          name: usdPath,
          format: 'usd',
          content: '',
        },
      ],
      assets: {
        [usdPath]: 'data:application/octet-stream;base64,U0VOU09S',
      },
      allFileContents: {
        [sourcePath]: sourceContent,
      },
      motorLibrary: {},
      selectedFileName: sourcePath,
      originalUrdfContent: sourceContent,
      originalFileFormat: 'urdf',
      usdPreparedExportCaches: {},
    },
    robotState: {
      present: robot,
      history: { past: [], future: [] },
      activity: [],
    },
    assemblyState: {
      present: null,
      history: { past: [], future: [] },
      activity: [],
    },
    getMergedRobotData: () => robot,
  });

  assert.equal(exportResult.partial, false);

  const imported = await importProject(
    new Uint8Array(await exportResult.blob.arrayBuffer()) as unknown as File,
    'en',
  );

  const importedUsdFile = imported.availableFiles.find((file) => file.name === usdPath);
  assert.ok(
    importedUsdFile,
    'expected blob-backed USD dependency to roundtrip through project import',
  );
  assert.equal(importedUsdFile.content, '');
  assert.match(importedUsdFile.blobUrl ?? '', /^blob:/);
});

test('importProject preserves assembly and component transforms from exported project history', async () => {
  const sourcePath = 'robots/left_arm.urdf';
  const sourceContent = '<robot name="left_arm"><link name="base_link" /></robot>';
  const componentRobot = createAssemblyComponentRobot();
  const assemblyState = {
    name: 'demo_workspace',
    transform: {
      position: { x: 4, y: -1, z: 2 },
      rotation: { r: 0.2, p: -0.1, y: 0.4 },
    },
    components: {
      comp_left: {
        id: 'comp_left',
        name: 'left_arm',
        sourceFile: sourcePath,
        visible: true,
        transform: {
          position: { x: -0.5, y: 0.75, z: 1.25 },
          rotation: { r: -0.3, p: 0.15, y: -0.25 },
        },
        robot: componentRobot,
      },
    },
    bridges: {},
  };

  const exportResult = await exportProject({
    name: 'demo_project_with_transforms',
    uiState: {
      appMode: 'editor',
      lang: 'en',
    },
    assetsState: {
      availableFiles: [
        {
          name: sourcePath,
          format: 'urdf',
          content: sourceContent,
        },
      ],
      assets: {},
      allFileContents: {
        [sourcePath]: sourceContent,
      },
      motorLibrary: {},
      selectedFileName: sourcePath,
      originalUrdfContent: sourceContent,
      originalFileFormat: 'urdf',
      usdPreparedExportCaches: {},
    },
    robotState: {
      present: componentRobot,
      history: { past: [], future: [] },
      activity: [],
    },
    assemblyState: {
      present: assemblyState,
      history: { past: [], future: [] },
      activity: [],
    },
    getMergedRobotData: () => componentRobot,
  });

  const imported = await importProject(
    new Uint8Array(await exportResult.blob.arrayBuffer()) as unknown as File,
    'en',
  );

  assert.deepEqual(imported.assemblyState?.transform, assemblyState.transform);
  assert.deepEqual(
    imported.assemblyState?.components.comp_left.transform,
    assemblyState.components.comp_left.transform,
  );
});

test('importProject roundtrips non-root child-link bridge transforms from assembly history', async () => {
  const sourceContent = '<robot name="bridge_component"><link name="base_link" /></robot>';
  const leftRobot = createNonRootBridgeAssemblyComponentRobot('comp_left');
  const rightRobot = createNonRootBridgeAssemblyComponentRobot('comp_right');

  const assemblyState = {
    name: 'bridge_alignment_workspace',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      comp_left: {
        id: 'comp_left',
        name: 'left_arm',
        sourceFile: 'robots/left_arm.urdf',
        visible: true,
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        robot: leftRobot,
      },
      comp_right: {
        id: 'comp_right',
        name: 'right_arm',
        sourceFile: 'robots/right_arm.urdf',
        visible: true,
        transform: {
          position: { x: -1.2, y: 0.35, z: -0.5 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        robot: rightRobot,
      },
    },
    bridges: {
      bridge_main: {
        id: 'bridge_main',
        name: 'bridge_main',
        parentComponentId: 'comp_left',
        parentLinkId: 'comp_left_base_link',
        childComponentId: 'comp_right',
        childLinkId: 'comp_right_tool_link',
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_main',
          name: 'bridge_main',
          type: JointType.FIXED,
          parentLinkId: 'comp_left_base_link',
          childLinkId: 'comp_right_tool_link',
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
  };

  const exportResult = await exportProject({
    name: 'bridge_alignment_project',
    uiState: {
      appMode: 'editor',
      lang: 'en',
    },
    assetsState: {
      availableFiles: [
        {
          name: 'robots/left_arm.urdf',
          format: 'urdf',
          content: sourceContent,
        },
        {
          name: 'robots/right_arm.urdf',
          format: 'urdf',
          content: sourceContent,
        },
      ],
      assets: {},
      allFileContents: {
        'robots/left_arm.urdf': sourceContent,
        'robots/right_arm.urdf': sourceContent,
      },
      motorLibrary: {},
      selectedFileName: 'robots/left_arm.urdf',
      originalUrdfContent: sourceContent,
      originalFileFormat: 'urdf',
      usdPreparedExportCaches: {},
    },
    robotState: {
      present: leftRobot,
      history: { past: [], future: [] },
      activity: [],
    },
    assemblyState: {
      present: assemblyState,
      history: { past: [], future: [] },
      activity: [],
    },
    getMergedRobotData: () => leftRobot,
  });

  const imported = await importProject(
    new Uint8Array(await exportResult.blob.arrayBuffer()) as unknown as File,
    'en',
  );

  assert.deepEqual(
    imported.assemblyState?.components.comp_right.transform,
    assemblyState.components.comp_right.transform,
  );
  assert.equal(imported.assemblyState?.bridges.bridge_main.parentLinkId, 'comp_left_base_link');
  assert.equal(imported.assemblyState?.bridges.bridge_main.childLinkId, 'comp_right_tool_link');
});

test('importProject preserves bridge joint hardware interface from exported projects', async () => {
  const sourcePathA = 'robots/left_arm.urdf';
  const sourcePathB = 'robots/right_arm.urdf';
  const sourceContentA = '<robot name="left_arm"><link name="base_link" /></robot>';
  const sourceContentB = '<robot name="right_arm"><link name="base_link" /></robot>';
  const leftRobot = createBridgeAssemblyComponentRobot('comp_left');
  const rightRobot = createBridgeAssemblyComponentRobot('comp_right');

  const assemblyState = {
    name: 'hardware_interface_workspace',
    components: {
      comp_left: {
        id: 'comp_left',
        name: 'left_arm',
        sourceFile: sourcePathA,
        visible: true,
        robot: leftRobot,
      },
      comp_right: {
        id: 'comp_right',
        name: 'right_arm',
        sourceFile: sourcePathB,
        visible: true,
        robot: rightRobot,
      },
    },
    bridges: {
      bridge_effort_joint: {
        id: 'bridge_effort_joint',
        name: 'bridge_effort_joint',
        parentComponentId: 'comp_left',
        parentLinkId: leftRobot.rootLinkId,
        childComponentId: 'comp_right',
        childLinkId: rightRobot.rootLinkId,
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_effort_joint',
          name: 'bridge_effort_joint',
          type: JointType.REVOLUTE,
          parentLinkId: leftRobot.rootLinkId,
          childLinkId: rightRobot.rootLinkId,
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
          hardware: {
            armature: 0,
            brand: '',
            motorType: 'None',
            motorId: '',
            motorDirection: 1 as const,
            hardwareInterface: 'effort' as const,
          },
        },
      },
    },
  };

  const exportResult = await exportProject({
    name: 'demo_project_with_bridge_interface',
    uiState: {
      appMode: 'editor',
      lang: 'en',
    },
    assetsState: {
      availableFiles: [
        {
          name: sourcePathA,
          format: 'urdf',
          content: sourceContentA,
        },
        {
          name: sourcePathB,
          format: 'urdf',
          content: sourceContentB,
        },
      ],
      assets: {},
      allFileContents: {
        [sourcePathA]: sourceContentA,
        [sourcePathB]: sourceContentB,
      },
      motorLibrary: {},
      selectedFileName: sourcePathA,
      originalUrdfContent: sourceContentA,
      originalFileFormat: 'urdf',
      usdPreparedExportCaches: {},
    },
    robotState: {
      present: leftRobot,
      history: { past: [], future: [] },
      activity: [],
    },
    assemblyState: {
      present: assemblyState,
      history: { past: [], future: [] },
      activity: [],
    },
    getMergedRobotData: () => leftRobot,
  });

  const imported = await importProject(
    new Uint8Array(await exportResult.blob.arrayBuffer()) as unknown as File,
    'en',
  );

  assert.equal(
    imported.assemblyState?.bridges.bridge_effort_joint.joint.hardware.hardwareInterface,
    'effort',
  );
});

test('importProject roundtrips multi-component assembly sources, bridges, and selected file metadata', async () => {
  const sourcePathA = 'robots/left_arm.urdf';
  const sourcePathB = 'robots/right_arm.urdf';
  const sourceContentA = '<robot name="left_arm"><link name="base_link" /></robot>';
  const sourceContentB = '<robot name="right_arm"><link name="base_link" /></robot>';
  const leftRobot = createBridgeAssemblyComponentRobot('comp_left');
  const rightRobot = createBridgeAssemblyComponentRobot('comp_right');

  const assemblyState = {
    name: 'source_roundtrip_workspace',
    components: {
      comp_left: {
        id: 'comp_left',
        name: 'left_arm',
        sourceFile: sourcePathA,
        visible: true,
        robot: leftRobot,
      },
      comp_right: {
        id: 'comp_right',
        name: 'right_arm',
        sourceFile: sourcePathB,
        visible: true,
        robot: rightRobot,
      },
    },
    bridges: {
      bridge_main: {
        id: 'bridge_main',
        name: 'bridge_main',
        parentComponentId: 'comp_left',
        parentLinkId: leftRobot.rootLinkId,
        childComponentId: 'comp_right',
        childLinkId: rightRobot.rootLinkId,
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_main',
          name: 'bridge_main',
          type: JointType.FIXED,
          parentLinkId: leftRobot.rootLinkId,
          childLinkId: rightRobot.rootLinkId,
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
  };

  const exportResult = await exportProject({
    name: 'source_roundtrip_project',
    uiState: {
      appMode: 'editor',
      lang: 'en',
    },
    assetsState: {
      availableFiles: [
        {
          name: sourcePathA,
          format: 'urdf',
          content: sourceContentA,
        },
        {
          name: sourcePathB,
          format: 'urdf',
          content: sourceContentB,
        },
      ],
      assets: {},
      allFileContents: {
        [sourcePathA]: sourceContentA,
        [sourcePathB]: sourceContentB,
      },
      motorLibrary: {},
      selectedFileName: sourcePathB,
      originalUrdfContent: sourceContentA,
      originalFileFormat: 'urdf',
      usdPreparedExportCaches: {},
    },
    robotState: {
      present: leftRobot,
      history: { past: [], future: [] },
      activity: [],
    },
    assemblyState: {
      present: assemblyState,
      history: { past: [], future: [] },
      activity: [],
    },
    getMergedRobotData: () => leftRobot,
  });

  const zip = await JSZip.loadAsync(await exportResult.blob.arrayBuffer());
  assert.ok(zip.file('components/comp_left/state.json'));
  assert.ok(zip.file('components/comp_left/left_arm.urdf'));
  assert.ok(zip.file('components/comp_right/state.json'));
  assert.ok(zip.file('components/comp_right/right_arm.urdf'));
  assert.ok(zip.file('bridges/bridge.xml'));
  assert.ok(zip.file('history/assembly.json'));
  assert.ok(zip.file(buildLibraryArchivePath(sourcePathA)));
  assert.ok(zip.file(buildLibraryArchivePath(sourcePathB)));

  const imported = await importProject(
    new Uint8Array(await exportResult.blob.arrayBuffer()) as unknown as File,
    'en',
  );

  assert.equal(imported.selectedFileName, sourcePathB);
  assert.equal(Object.keys(imported.assemblyState?.components ?? {}).length, 2);
  assert.equal(imported.assemblyState?.components.comp_left.sourceFile, sourcePathA);
  assert.equal(imported.assemblyState?.components.comp_right.sourceFile, sourcePathB);
  assert.ok(imported.availableFiles.some((file) => file.name === sourcePathA));
  assert.ok(imported.availableFiles.some((file) => file.name === sourcePathB));
});
