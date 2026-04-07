import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import JSZip from 'jszip';
import { JSDOM } from 'jsdom';

import { parseURDF } from '@/core/parsers';
import { computeLinkWorldMatrices } from '@/core/robot';
import { DEFAULT_JOINT, DEFAULT_LINK, JointType, type RobotData } from '@/types';

import { exportProject } from './projectExport';

const GO2_DESCRIPTION_ROOT = path.resolve('test/unitree_ros/robots/go2_description');
const GO2_URDF_PATH = path.join(GO2_DESCRIPTION_ROOT, 'urdf/go2_description.urdf');

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
globalThis.ProgressEvent = dom.window.ProgressEvent as typeof ProgressEvent;

function loadGo2RobotData(): RobotData {
  const source = fs.readFileSync(GO2_URDF_PATH, 'utf8');
  const robot = parseURDF(source);
  assert.ok(robot, 'expected go2 URDF to parse');
  return robot;
}

function loadSimpleRobotData(): RobotData {
  const source = `<?xml version="1.0"?>
<robot name="simple_export">
  <link name="base_link" />
</robot>`;
  const robot = parseURDF(source);
  assert.ok(robot, 'expected simple URDF to parse');
  return robot;
}

function createAssemblyComponentRobotData(): RobotData {
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

function assertNearlyEqual(actual: number, expected: number, message: string) {
  assert.ok(
    Math.abs(actual - expected) <= 1e-9,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

function buildGo2AssetMap(): Record<string, string> {
  const assets: Record<string, string> = {};

  for (const directory of ['dae', 'meshes']) {
    const absoluteDirectory = path.join(GO2_DESCRIPTION_ROOT, directory);
    for (const fileName of fs.readdirSync(absoluteDirectory)) {
      const absolutePath = path.join(absoluteDirectory, fileName);
      if (!fs.statSync(absolutePath).isFile()) continue;

      const extension = path.extname(absolutePath).toLowerCase();
      const mimeType = extension === '.dae' ? 'text/xml' : 'application/octet-stream';
      const dataUrl = `data:${mimeType};base64,${fs.readFileSync(absolutePath).toString('base64')}`;

      [
        absolutePath,
        `package://go2_description/${directory}/${fileName}`,
        `go2_description/${directory}/${fileName}`,
        `${directory}/${fileName}`,
        fileName,
      ].forEach((key) => {
        assets[key] = dataUrl;
      });
    }
  }

  return assets;
}

test('exportProject preserves go2 split visual materials in generated MJCF output', async () => {
  const robot = loadGo2RobotData();
  const assets = buildGo2AssetMap();
  const originalUrdfContent = fs.readFileSync(GO2_URDF_PATH, 'utf8');

  const exportResult = await exportProject({
    name: 'go2_project',
    uiState: {
      appMode: 'editor',
      lang: 'en',
    },
    assetsState: {
      availableFiles: [
        {
          name: 'go2_description/urdf/go2_description.urdf',
          format: 'urdf',
          content: originalUrdfContent,
        },
      ],
      assets,
      allFileContents: {
        'go2_description/urdf/go2_description.urdf': originalUrdfContent,
      },
      motorLibrary: {},
      selectedFileName: 'go2_description/urdf/go2_description.urdf',
      originalUrdfContent,
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
  assert.equal(exportResult.warnings.length, 0);

  const zip = await JSZip.loadAsync(await exportResult.blob.arrayBuffer());
  const mjcfOutput = await zip.file('output/go2_description.xml')?.async('string');

  assert.ok(mjcfOutput, 'expected project export to include output/go2_description.xml');
  assert.match(mjcfOutput, /material="base_mat_1"/);
  assert.match(mjcfOutput, /material="base_mat_2"/);
  assert.doesNotMatch(mjcfOutput, /base_visual_0\.obj/);

  const archivePaths = Object.keys(zip.files);
  const splitBaseMeshPaths = archivePaths.filter(
    (filePath) => filePath.startsWith('output/meshes/dae/base.') && filePath.endsWith('.obj'),
  );

  assert.ok(
    splitBaseMeshPaths.length >= 2,
    `expected split base OBJ variants in output/meshes, received: ${splitBaseMeshPaths.join(', ')}`,
  );
});

test('exportProject fails fast when a packed workspace asset cannot be fetched', async () => {
  const robot = loadSimpleRobotData();
  const originalUrdfContent = `<?xml version="1.0"?>
<robot name="simple_export">
  <link name="base_link" />
</robot>`;

  await assert.rejects(
    exportProject({
      name: 'broken_asset_project',
      uiState: {
        appMode: 'editor',
        lang: 'en',
      },
      assetsState: {
        availableFiles: [
          {
            name: 'robots/simple_export.urdf',
            format: 'urdf',
            content: originalUrdfContent,
          },
        ],
        assets: {
          'textures/missing.png': 'blob:missing-project-asset',
        },
        allFileContents: {
          'robots/simple_export.urdf': originalUrdfContent,
        },
        motorLibrary: {},
        selectedFileName: 'robots/simple_export.urdf',
        originalUrdfContent,
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
    }),
    /Failed to pack asset "textures\/missing\.png"/,
  );
});

test('exportProject does not persist appMode state in project.json', async () => {
  const robot = loadSimpleRobotData();
  const originalUrdfContent = `<?xml version="1.0"?>
<robot name="simple_export">
  <link name="base_link" />
</robot>`;

  const exportResult = await exportProject({
    name: 'mode_free_project',
    uiState: {
      appMode: 'editor',
      lang: 'en',
    },
    assetsState: {
      availableFiles: [
        {
          name: 'robots/simple_export.urdf',
          format: 'urdf',
          content: originalUrdfContent,
        },
      ],
      assets: {},
      allFileContents: {
        'robots/simple_export.urdf': originalUrdfContent,
      },
      motorLibrary: {},
      selectedFileName: 'robots/simple_export.urdf',
      originalUrdfContent,
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

  const zip = await JSZip.loadAsync(await exportResult.blob.arrayBuffer());
  const manifestText = await zip.file('project.json')?.async('string');

  assert.ok(manifestText, 'expected project export to include project.json');

  const manifest = JSON.parse(manifestText);
  assert.equal('appMode' in (manifest.ui ?? {}), false);
});

test('exportProject preserves assembly transforms in the manifest and generated URDF output', async () => {
  const sourcePath = 'robots/left_arm.urdf';
  const sourceContent = `<?xml version="1.0"?>
<robot name="left_arm">
  <link name="base_link" />
</robot>`;
  const componentRobot = createAssemblyComponentRobotData();
  const assemblyState = {
    name: 'demo_workspace',
    transform: {
      position: { x: 1, y: 2, z: 3 },
      rotation: { r: 0.1, p: -0.2, y: 0.3 },
    },
    components: {
      comp_left: {
        id: 'comp_left',
        name: 'left_arm',
        sourceFile: sourcePath,
        visible: true,
        transform: {
          position: { x: -0.5, y: 0.25, z: 0.75 },
          rotation: { r: -0.15, p: 0.35, y: -0.45 },
        },
        robot: componentRobot,
      },
    },
    bridges: {},
  };

  const exportResult = await exportProject({
    name: 'transformed_workspace',
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

  const zip = await JSZip.loadAsync(await exportResult.blob.arrayBuffer());
  const manifestText = await zip.file('project.json')?.async('string');
  const outputUrdf = await zip.file(`output/${assemblyState.name}.urdf`)?.async('string');

  assert.ok(manifestText, 'expected project export to include project.json');
  assert.ok(outputUrdf, 'expected project export to include transformed URDF output');

  const manifest = JSON.parse(manifestText);
  assert.deepEqual(manifest.assembly?.transform, assemblyState.transform);
  assert.deepEqual(
    manifest.assembly?.components?.comp_left?.transform,
    assemblyState.components.comp_left.transform,
  );

  const exportedRobot = parseURDF(outputUrdf!);
  assert.ok(exportedRobot, 'expected transformed URDF output to parse');
  assert.equal(exportedRobot?.rootLinkId, '__assembly_root');
  assert.deepEqual(
    exportedRobot?.joints.__assembly_root_joint_comp_left.origin.xyz,
    assemblyState.transform.position,
  );
  assert.deepEqual(
    exportedRobot?.joints.__assembly_root_joint_comp_left.origin.rpy,
    assemblyState.transform.rotation,
  );
  assert.deepEqual(
    exportedRobot?.joints.__assembly_component_joint_comp_left.origin.xyz,
    assemblyState.components.comp_left.transform.position,
  );
  assert.deepEqual(
    exportedRobot?.joints.__assembly_component_joint_comp_left.origin.rpy,
    assemblyState.components.comp_left.transform.rotation,
  );
});

test('exportProject keeps non-root child-link bridge alignment in generated URDF output', async () => {
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

  const zip = await JSZip.loadAsync(await exportResult.blob.arrayBuffer());
  const outputUrdf = await zip.file(`output/${assemblyState.name}.urdf`)?.async('string');

  assert.ok(outputUrdf, 'expected project export to include bridged assembly URDF output');

  const exportedRobot = parseURDF(outputUrdf!);
  assert.ok(exportedRobot, 'expected bridged assembly URDF to parse');

  const exportedMatrices = computeLinkWorldMatrices(exportedRobot!);
  const leftBaseMatrix = exportedMatrices.comp_left_base_link;
  const rightToolMatrix = exportedMatrices.comp_right_tool_link;

  assert.ok(leftBaseMatrix, 'expected an exported world matrix for the parent base link');
  assert.ok(rightToolMatrix, 'expected an exported world matrix for the bridged child link');
  assertNearlyEqual(
    rightToolMatrix.elements[12],
    leftBaseMatrix.elements[12],
    'exported bridged child link should stay aligned on x',
  );
  assertNearlyEqual(
    rightToolMatrix.elements[13],
    leftBaseMatrix.elements[13],
    'exported bridged child link should stay aligned on y',
  );
  assertNearlyEqual(
    rightToolMatrix.elements[14],
    leftBaseMatrix.elements[14],
    'exported bridged child link should stay aligned on z',
  );
});

test('exportProject fails fast when a non-mesh library source file has no content', async () => {
  const robot = loadSimpleRobotData();

  await assert.rejects(
    exportProject({
      name: 'missing_library_source_project',
      uiState: {
        appMode: 'editor',
        lang: 'en',
      },
      assetsState: {
        availableFiles: [
          {
            name: 'robots/simple_export.urdf',
            format: 'urdf',
            content: '',
          },
        ],
        assets: {},
        allFileContents: {},
        motorLibrary: {},
        selectedFileName: 'robots/simple_export.urdf',
        originalUrdfContent: '',
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
    }),
    /Missing library source content for project export: robots\/simple_export\.urdf/,
  );
});

test('exportProject reports phased progress while building a .usp archive', async () => {
  const robot = loadSimpleRobotData();
  const originalUrdfContent = `<?xml version="1.0"?>
<robot name="simple_export">
  <link name="base_link" />
</robot>`;
  const progressUpdates: Array<{
    phase: string;
    completed: number;
    total: number;
    label?: string;
  }> = [];

  const exportResult = await exportProject({
    name: 'progress_project',
    uiState: {
      appMode: 'editor',
      lang: 'en',
    },
    assetsState: {
      availableFiles: [
        {
          name: 'robots/simple_export.urdf',
          format: 'urdf',
          content: originalUrdfContent,
        },
      ],
      assets: {
        'textures/progress.png': 'data:text/plain;base64,cHJvZ3Jlc3M=',
      },
      allFileContents: {
        'robots/simple_export.urdf': originalUrdfContent,
      },
      motorLibrary: {},
      selectedFileName: 'robots/simple_export.urdf',
      originalUrdfContent,
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
    onProgress: (progress) => {
      progressUpdates.push({ ...progress });
    },
  });

  assert.equal(exportResult.partial, false);
  assert.ok(progressUpdates.length > 0, 'expected project export to emit progress updates');

  const firstIndexByPhase = (phase: string) =>
    progressUpdates.findIndex((progress) => progress.phase === phase);
  const phaseOrder = ['assets', 'metadata', 'components', 'output', 'archive'];

  phaseOrder.forEach((phase) => {
    assert.ok(firstIndexByPhase(phase) >= 0, `expected progress updates for phase ${phase}`);
  });

  for (let index = 1; index < phaseOrder.length; index += 1) {
    const previousPhase = phaseOrder[index - 1];
    const currentPhase = phaseOrder[index];
    assert.ok(
      firstIndexByPhase(previousPhase) < firstIndexByPhase(currentPhase),
      `expected phase ${previousPhase} to occur before ${currentPhase}`,
    );
  }

  const finalArchiveProgress = [...progressUpdates]
    .reverse()
    .find((progress) => progress.phase === 'archive');

  assert.ok(finalArchiveProgress, 'expected final archive progress update');
  assert.equal(finalArchiveProgress.completed, 100);
  assert.equal(finalArchiveProgress.total, 100);
});

test('exportProject preserves bridge joint quat_xyzw metadata in bridge.xml', async () => {
  const robot = loadSimpleRobotData();
  const originalUrdfContent = `<?xml version="1.0"?>
<robot name="simple_export">
  <link name="base_link" />
</robot>`;
  const componentARobot = {
    ...robot,
    rootLinkId: 'component_a/base_link',
    links: {
      'component_a/base_link': {
        ...robot.links.base_link,
        id: 'component_a/base_link',
      },
    },
    joints: {},
  };
  const componentBRobot = {
    ...robot,
    rootLinkId: 'component_b/base_link',
    links: {
      'component_b/base_link': {
        ...robot.links.base_link,
        id: 'component_b/base_link',
      },
    },
    joints: {},
  };

  const exportResult = await exportProject({
    name: 'bridge_quat_project',
    uiState: {
      appMode: 'editor',
      lang: 'en',
    },
    assetsState: {
      availableFiles: [
        {
          name: 'robots/component_a.urdf',
          format: 'urdf',
          content: originalUrdfContent,
        },
        {
          name: 'robots/component_b.urdf',
          format: 'urdf',
          content: originalUrdfContent,
        },
      ],
      assets: {},
      allFileContents: {
        'robots/component_a.urdf': originalUrdfContent,
        'robots/component_b.urdf': originalUrdfContent,
      },
      motorLibrary: {},
      selectedFileName: 'robots/component_a.urdf',
      originalUrdfContent,
      originalFileFormat: 'urdf',
      usdPreparedExportCaches: {},
    },
    robotState: {
      present: robot,
      history: { past: [], future: [] },
      activity: [],
    },
    assemblyState: {
      present: {
        name: 'bridge_quat_assembly',
        components: {
          component_a: {
            id: 'component_a',
            name: 'component_a',
            sourceFile: 'robots/component_a.urdf',
            robot: componentARobot,
          },
          component_b: {
            id: 'component_b',
            name: 'component_b',
            sourceFile: 'robots/component_b.urdf',
            robot: componentBRobot,
          },
        },
        bridges: {
          bridge_joint: {
            id: 'bridge_joint',
            name: 'bridge_joint',
            parentComponentId: 'component_a',
            parentLinkId: 'component_a/base_link',
            childComponentId: 'component_b',
            childLinkId: 'component_b/base_link',
            joint: {
              ...DEFAULT_JOINT,
              id: 'bridge_joint',
              name: 'bridge_joint',
              type: JointType.FIXED,
              parentLinkId: 'component_a/base_link',
              childLinkId: 'component_b/base_link',
              origin: {
                xyz: { x: 0, y: 0, z: 0 },
                rpy: { r: 0, p: 0, y: Math.PI / 2 },
                quatXyzw: { x: 0, y: 0, z: 0.70710678, w: 0.70710678 },
              },
              hardware: {
                ...DEFAULT_JOINT.hardware,
                hardwareInterface: 'position',
              },
            },
          },
        },
      },
      history: { past: [], future: [] },
      activity: [],
    },
    getMergedRobotData: () => robot,
  });

  assert.equal(exportResult.partial, false);

  const zip = await JSZip.loadAsync(await exportResult.blob.arrayBuffer());
  const bridgeXml = await zip.file('bridges/bridge.xml')?.async('string');

  assert.ok(bridgeXml, 'expected project export to include bridges/bridge.xml');
  assert.match(
    bridgeXml,
    /<origin xyz="0 0 0" rpy="0 0 1\.5707963267948966" quat_xyzw="0 0 0\.70710678 0\.70710678" \/>/,
  );
  assert.match(
    bridgeXml,
    /<hardware>\s*<hardwareInterface>position<\/hardwareInterface>\s*<\/hardware>/,
  );
});
