import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { detectImportFormat } from '@/app/utils/importPreparation';
import { buildWorkspaceViewerRobotData } from '@/app/hooks/workspaceSourceSyncUtils.ts';
import { generateSDF, generateURDF, parseSDF, parseURDF } from '@/core/parsers';
import { generateMujocoXML } from '@/core/parsers/mjcf/mjcfGenerator.ts';
import { buildExportableAssemblyRobotData } from '@/core/robot/assemblyTransforms';
import { resolveJointKey } from '@/core/robot/identity';
import {
  createMemoizedRendererBackendLoadScopeKey,
  type RendererBackendLoadScopeKeyMemo,
} from '@/features/urdf-viewer/utils/rendererBackendLoadScope.ts';
import type { RobotFile } from '@/types';
import { JointType } from '@/types';
import { useAssemblyStore } from './assemblyStore.ts';

const { window } = new JSDOM();

if (!globalThis.DOMParser) {
  globalThis.DOMParser = window.DOMParser as typeof DOMParser;
}

if (!globalThis.XMLSerializer) {
  globalThis.XMLSerializer = window.XMLSerializer as typeof XMLSerializer;
}

function resetAssemblyStore() {
  const state = useAssemblyStore.getState();
  state.clearHistory();
  state.exitAssembly();
  state.setAssembly(null);
}

function createRobotFile(name: string, format: RobotFile['format'], content = ''): RobotFile {
  return {
    name,
    format,
    content,
  };
}

function pathFromMyosuiteFixture(relativePath: string): string {
  return path.join(process.cwd(), 'test', 'myosuite-main', ...relativePath.split('/'));
}

function loadImportableRobotFilesFromDirectory(relativeDir: string): RobotFile[] {
  const rootDir = path.join(process.cwd(), relativeDir);

  const walk = (currentDir: string): string[] =>
    fs.readdirSync(currentDir, { withFileTypes: true }).flatMap((entry) => {
      const fullPath = path.join(currentDir, entry.name);
      return entry.isDirectory() ? walk(fullPath) : [fullPath];
    });

  return walk(rootDir)
    .sort()
    .flatMap((fullPath) => {
      const relativePath = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
      const lowerPath = relativePath.toLowerCase();
      if (
        lowerPath.endsWith('.urdf') ||
        lowerPath.endsWith('.xml') ||
        lowerPath.endsWith('.xacro') ||
        lowerPath.endsWith('.urdf.xacro')
      ) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const format = detectImportFormat(content, relativePath);
        return format ? [createRobotFile(relativePath, format, content)] : [];
      }
      if (lowerPath.endsWith('.stl') || lowerPath.endsWith('.obj') || lowerPath.endsWith('.dae')) {
        return [createRobotFile(relativePath, 'mesh')];
      }
      return [];
    });
}

function buildT1PiperAssemblyExportRobot() {
  resetAssemblyStore();

  const t1Files = loadImportableRobotFilesFromDirectory('test/mujoco_menagerie-main/booster_t1');
  const piperFiles = loadImportableRobotFilesFromDirectory(
    'test/mujoco_menagerie-main/agilex_piper',
  );
  const t1File = t1Files.find((file) => file.name.endsWith('/t1.xml'));
  const piperFile = piperFiles.find((file) => file.name.endsWith('/piper.xml'));

  assert.ok(t1File, 'expected t1.xml fixture');
  assert.ok(piperFile, 'expected piper.xml fixture');

  const store = useAssemblyStore.getState();
  store.initAssembly('t1-piper-export');

  const t1Component = store.addComponent(t1File, {
    availableFiles: t1Files,
    assets: {},
    allFileContents: {},
  });
  const piperComponent = store.addComponent(piperFile, {
    availableFiles: piperFiles,
    assets: {},
    allFileContents: {},
  });

  assert.ok(t1Component, 'expected t1 component to be imported');
  assert.ok(piperComponent, 'expected piper component to be imported');

  store.addBridge({
    name: 'attach_piper_to_t1',
    parentComponentId: t1Component.id,
    parentLinkId: t1Component.robot.rootLinkId,
    childComponentId: piperComponent.id,
    childLinkId: piperComponent.robot.rootLinkId,
    joint: { type: JointType.FIXED },
  });

  const assemblyState = useAssemblyStore.getState().assemblyState;
  assert.ok(assemblyState, 'expected assembly state after adding the bridge');

  return {
    assemblyState,
    exportRobot: {
      ...buildExportableAssemblyRobotData(assemblyState),
      selection: { type: null, id: null as string | null },
    },
  };
}

function buildT1PiperLink5AssemblyExportRobot() {
  resetAssemblyStore();

  const t1Files = loadImportableRobotFilesFromDirectory('test/mujoco_menagerie-main/booster_t1');
  const piperFiles = loadImportableRobotFilesFromDirectory(
    'test/mujoco_menagerie-main/agilex_piper',
  );
  const t1File = t1Files.find((file) => file.name.endsWith('/t1.xml'));
  const piperFile = piperFiles.find((file) => file.name.endsWith('/piper.xml'));

  assert.ok(t1File, 'expected t1.xml fixture');
  assert.ok(piperFile, 'expected piper.xml fixture');

  const store = useAssemblyStore.getState();
  store.initAssembly('t1-piper-link5-export');

  const t1Component = store.addComponent(t1File, {
    availableFiles: t1Files,
    assets: {},
    allFileContents: {},
  });
  const piperComponent = store.addComponent(piperFile, {
    availableFiles: piperFiles,
    assets: {},
    allFileContents: {},
  });

  assert.ok(t1Component, 'expected t1 component to be imported');
  assert.ok(piperComponent, 'expected piper component to be imported');

  const t1HeadLinkId = `${t1Component.id}_H2`;
  const piperLink5Id = `${piperComponent.id}_link5`;
  assert.ok(t1Component.robot.links[t1HeadLinkId], 'expected T1 H2 head link');
  assert.ok(piperComponent.robot.links[piperLink5Id], 'expected PiPER link5');

  store.addBridge({
    name: 'attach_piper_link5_to_t1_head',
    parentComponentId: t1Component.id,
    parentLinkId: t1HeadLinkId,
    childComponentId: piperComponent.id,
    childLinkId: piperLink5Id,
    joint: { type: JointType.FIXED },
  });

  const assemblyState = useAssemblyStore.getState().assemblyState;
  assert.ok(assemblyState, 'expected assembly state after adding the link5 bridge');

  return {
    assemblyState,
    exportRobot: {
      ...buildExportableAssemblyRobotData(assemblyState),
      selection: { type: null, id: null as string | null },
    },
  };
}

test('MJCF assembly merge re-roots the merged graph after bridge joints change the parent component', () => {
  resetAssemblyStore();

  const barkourFiles = loadImportableRobotFilesFromDirectory(
    'test/mujoco_menagerie-main/google_barkour_vb',
  );
  const go2Files = loadImportableRobotFilesFromDirectory('test/mujoco_menagerie-main/unitree_go2');
  const barkourFile = barkourFiles.find((file) => file.name.endsWith('/barkour_vb.xml'));
  const go2File = go2Files.find((file) => file.name.endsWith('/go2.xml'));

  assert.ok(barkourFile, 'expected barkour_vb.xml fixture');
  assert.ok(go2File, 'expected go2.xml fixture');

  const store = useAssemblyStore.getState();
  store.initAssembly('mjcf-root-recompute');

  const barkourComponent = store.addComponent(barkourFile, {
    availableFiles: barkourFiles,
    assets: {},
    allFileContents: {},
  });
  const go2Component = store.addComponent(go2File, {
    availableFiles: go2Files,
    assets: {},
    allFileContents: {},
  });

  assert.ok(barkourComponent, 'expected barkour component to be imported');
  assert.ok(go2Component, 'expected go2 component to be imported');

  store.addBridge({
    name: 'attach_barkour_under_go2',
    parentComponentId: go2Component.id,
    parentLinkId: go2Component.robot.rootLinkId,
    childComponentId: barkourComponent.id,
    childLinkId: barkourComponent.robot.rootLinkId,
    joint: { type: JointType.FIXED },
  });

  const merged = useAssemblyStore.getState().getMergedRobotData();
  assert.ok(merged, 'expected merged robot data after adding the bridge');

  const childLinkIds = new Set(Object.values(merged.joints).map((joint) => joint.childLinkId));
  const graphRoots = Object.keys(merged.links).filter((linkId) => !childLinkIds.has(linkId));

  assert.deepEqual(graphRoots, [go2Component.robot.rootLinkId]);
  assert.equal(merged.rootLinkId, go2Component.robot.rootLinkId);

  const workspaceViewerRobot = buildWorkspaceViewerRobotData(merged);
  assert.equal(workspaceViewerRobot.rootLinkId, go2Component.robot.rootLinkId);
  assert.ok(!workspaceViewerRobot.links.__workspace_world__);
});

test('MJCF assembly export keeps PiPER mimic joints valid after bridge creation', () => {
  const { exportRobot } = buildT1PiperAssemblyExportRobot();
  const merged = useAssemblyStore.getState().getMergedRobotData();
  assert.ok(merged, 'expected merged robot data after adding the bridge');

  const piperJoint8 = Object.values(merged.joints).find((joint) => joint.name === 'piper_joint8');
  assert.equal(piperJoint8?.mimic?.joint, 'comp_piper_joint7');

  const generated = generateMujocoXML(exportRobot, { includeSceneHelpers: false });
  assert.match(
    generated,
    /<joint name="piper_joint8_mimic" joint1="piper_joint8" joint2="piper_joint7" polycoef="0 -1 0 0 0" \/>/,
  );
});

test('T1 plus PiPER assembly viewer load key stays stable during joint motion', () => {
  buildT1PiperAssemblyExportRobot();
  const merged = useAssemblyStore.getState().getMergedRobotData();
  assert.ok(merged, 'expected merged robot data after adding the bridge');

  const piperJoint2Key = resolveJointKey(merged.joints, 'piper_joint2');
  assert.ok(piperJoint2Key, 'expected merged PiPER joint2');

  const sourceFile: RobotFile = {
    name: 't1-piper-assembly.mjcf',
    format: 'mjcf',
    content: '<mujoco model="t1-piper-assembly" />',
  };
  const memo: RendererBackendLoadScopeKeyMemo = {};
  const baselineKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile,
      assets: {},
      robotData: merged,
    },
    memo,
  );
  const movedMerged = {
    ...merged,
    joints: {
      ...merged.joints,
      [piperJoint2Key]: {
        ...merged.joints[piperJoint2Key],
        angle: 0.75,
      },
    },
  };
  const movedKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile,
      assets: {},
      robotData: movedMerged,
    },
    memo,
  );

  assert.equal(movedKey, baselineKey);
});

test('URDF assembly export keeps PiPER mimic joints resolvable after bridge creation', () => {
  const { exportRobot } = buildT1PiperAssemblyExportRobot();

  const urdf = generateURDF(exportRobot);
  const reparsed = parseURDF(urdf);

  const followerJoint = Object.values(reparsed?.joints ?? {}).find(
    (joint) => joint.name === 'piper_joint8',
  );
  assert.ok(followerJoint?.mimic, 'expected URDF roundtrip to preserve the PiPER mimic joint');
  assert.equal(
    resolveJointKey(reparsed?.joints ?? {}, followerJoint?.mimic?.joint),
    'piper_joint7',
  );
});

test('URDF assembly export preserves PiPER joint ranges when link5 is bridged to the T1 head', () => {
  const { exportRobot } = buildT1PiperLink5AssemblyExportRobot();
  const urdf = generateURDF(exportRobot);
  const reparsed = parseURDF(urdf);

  assert.ok(reparsed, 'expected generated link5 bridge URDF to parse');
  assert.equal(reparsed?.rootLinkId, 't1');

  const childLinkIds = new Set(
    Object.values(reparsed?.joints ?? {}).map((joint) => joint.childLinkId),
  );
  const graphRoots = Object.keys(reparsed?.links ?? {}).filter(
    (linkId) => !childLinkIds.has(linkId),
  );
  assert.deepEqual(graphRoots, ['t1']);

  const attachJoint = Object.values(reparsed?.joints ?? {}).find(
    (joint) => joint.name === 'attach_piper_link5_to_t1_head',
  );
  assert.equal(attachJoint?.parentLinkId, 't1_H2');
  assert.equal(attachJoint?.childLinkId, 'piper_link5');

  const piperJoint2 = Object.values(reparsed?.joints ?? {}).find(
    (joint) => joint.name === 'piper_joint2',
  );
  const piperJoint3 = Object.values(reparsed?.joints ?? {}).find(
    (joint) => joint.name === 'piper_joint3',
  );

  assert.equal(piperJoint2?.limit?.lower, 0);
  assert.equal(piperJoint2?.limit?.upper, 3.14);
  assert.equal(piperJoint3?.limit?.lower, -2.697);
  assert.equal(piperJoint3?.limit?.upper, 0);
});

test('SDF assembly export keeps PiPER mimic joints resolvable after bridge creation', () => {
  const { exportRobot } = buildT1PiperAssemblyExportRobot();

  const sdf = generateSDF(exportRobot, { packageName: 't1_piper_export' });
  const reparsed = parseSDF(sdf, { sourcePath: 't1_piper_export/model.sdf' });

  const followerJoint = Object.values(reparsed?.joints ?? {}).find(
    (joint) => joint.name === 'piper_joint8',
  );
  assert.ok(followerJoint?.mimic, 'expected SDF roundtrip to preserve the PiPER mimic joint');
  assert.equal(
    resolveJointKey(reparsed?.joints ?? {}, followerJoint?.mimic?.joint),
    'piper_joint7',
  );
});

test('addComponent surfaces actionable MyoSuite template placeholder errors for MJCF assembly imports', () => {
  resetAssemblyStore();

  const supportFiles = [
    'myosuite/envs/myo/assets/hand/myohand_object.xml',
    'myosuite/envs/myo/assets/hand/myohand_tabletop.xml',
    'myosuite/simhive/object_sim/common.xml',
    'myosuite/simhive/myo_sim/hand/assets/myohand_assets.xml',
    'myosuite/simhive/myo_sim/hand/assets/myohand_body.xml',
    'myosuite/simhive/furniture_sim/simpleTable/simpleTable_asset.xml',
    'myosuite/simhive/furniture_sim/simpleTable/simpleGraniteTable_body.xml',
  ].map((relativePath) =>
    createRobotFile(
      path.relative(process.cwd(), pathFromMyosuiteFixture(relativePath)).replace(/\\/g, '/'),
      'mjcf',
      fs.readFileSync(pathFromMyosuiteFixture(relativePath), 'utf8'),
    ),
  );

  const file = supportFiles[0]!;
  const store = useAssemblyStore.getState();
  store.initAssembly('myosuite-placeholder-error');

  assert.throws(
    () =>
      store.addComponent(file, {
        availableFiles: supportFiles,
        assets: {},
        allFileContents: {},
      }),
    (error) => {
      assert.ok(error instanceof Error, 'expected addComponent to throw an Error');
      assert.match(error.message, /Failed to add assembly component from/);
      assert.match(error.message, /OBJECT_NAME/);
      assert.match(error.message, /concrete object directory/);
      return true;
    },
  );

  assert.deepEqual(useAssemblyStore.getState().assemblyState?.components ?? {}, {});
});
