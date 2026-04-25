import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { parseEditableRobotSource } from '@/app/utils/parseEditableRobotSource';
import { disposeRobotImportWorker } from '@/app/hooks/robotImportWorkerBridge';
import { parseURDF } from '@/core/parsers';
import {
  computeLinkWorldMatrices,
  estimateRobotGroundOffset,
  mergeAssembly,
  prepareAssemblyRobotData,
} from '@/core/robot';
import { resolveAlignedAssemblyComponentTransformForBridge } from '@/core/robot/assemblyBridgeAlignment';
import { resolveRobotFileData } from '@/core/parsers/importRobotFile';
import { buildExportableAssemblyRobotData } from '@/core/robot/assemblyTransforms';
import { stripTransientJointMotionFromJoints } from '@/shared/utils/robot/semanticSnapshot';
import { DEFAULT_LINK } from '@/types/constants';
import {
  GeometryType,
  DEFAULT_JOINT,
  JointType,
  type AssemblyState,
  type RobotData,
  type RobotFile,
  type RobotState,
} from '@/types';
import {
  buildLightweightWorkspaceViewerReloadContent,
  buildWorkspaceAssemblyViewerState,
  buildWorkspaceAssemblyViewerDisplayRobotData,
  buildGeneratedWorkspaceUrdfFileName,
  buildPreviewSceneSourceFromImportResult,
  createGeneratedWorkspaceUrdfFile,
  buildWorkspaceViewerRobotData,
  canUseLightweightWorkspaceViewerReloadContent,
  createPreviewRobotState,
  createPreviewRobotStateFromImportResult,
  createRobotSourceSnapshot,
  createRobotSourceSnapshotFromUrdfContent,
  getViewerSourceFile,
  getPreferredMjcfContent,
  getPreferredSdfContent,
  getPreferredUrdfContent,
  getPreferredXacroContent,
  getWorkspaceAssemblyViewerRobotData,
  getSingleComponentWorkspaceMjcfViewerSource,
  getWorkspaceAssemblyRenderFailureReason,
  isGeneratedWorkspaceUrdfFileName,
  normalizeWorkspaceAssemblyViewerDisplayRobotDataForSource,
  resolveWorkspaceGeneratedUrdfRobotData,
  shouldKeepPristineSingleComponentWorkspaceOnSourceViewer,
  shouldPromptGenerateWorkspaceUrdfOnStructureSwitch,
  shouldReseedSingleComponentAssemblyFromActiveFile,
  shouldReuseSourceViewerForSingleComponentAssembly,
  shouldUseGeneratedWorkspaceViewerReloadContent,
  shouldUseEmptyRobotForUsdHydration,
  isActiveWorkspaceTransformSession,
  WORKSPACE_VIEWER_COMPONENT_ROOT_JOINT_PREFIX,
} from './workspaceSourceSyncUtils.ts';
import { buildGeneratedWorkspaceFileState } from './workspaceGeneratedSourceState.ts';

const { window } = new JSDOM();

if (!globalThis.DOMParser) {
  globalThis.DOMParser = window.DOMParser;
}

if (!globalThis.XMLSerializer) {
  globalThis.XMLSerializer = window.XMLSerializer;
}

const GO2_DESCRIPTION_ROOT = path.resolve('test/unitree_ros/robots/go2_description');
const GO2_URDF_PATH = path.join(GO2_DESCRIPTION_ROOT, 'urdf/go2_description.urdf');

type WorkerEventHandler = (event: { data?: unknown; error?: unknown; message?: string }) => void;

function restoreGlobalProperty<T extends keyof typeof globalThis>(
  key: T,
  originalValue: (typeof globalThis)[T] | undefined,
) {
  if (originalValue === undefined) {
    delete globalThis[key];
    return;
  }

  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: originalValue,
  });
}

function installEditableRobotSourceWorkerMock() {
  const originalWorker = globalThis.Worker;
  let parseRequestCount = 0;

  class FakeRobotImportWorker {
    private readonly listeners = new Map<string, Set<WorkerEventHandler>>();

    addEventListener(type: string, handler: WorkerEventHandler): void {
      const handlers = this.listeners.get(type) ?? new Set<WorkerEventHandler>();
      handlers.add(handler);
      this.listeners.set(type, handlers);
    }

    removeEventListener(type: string, handler: WorkerEventHandler): void {
      this.listeners.get(type)?.delete(handler);
    }

    postMessage(message: any): void {
      if (message?.type !== 'parse-editable-robot-source') {
        return;
      }

      parseRequestCount += 1;

      queueMicrotask(() => {
        try {
          const result = parseEditableRobotSource(message.options);
          this.listeners.get('message')?.forEach((handler) => {
            handler({
              data: {
                type: 'parse-editable-robot-source-result',
                requestId: message.requestId,
                result,
              },
            });
          });
        } catch (error) {
          this.listeners.get('message')?.forEach((handler) => {
            handler({
              data: {
                type: 'parse-editable-robot-source-error',
                requestId: message.requestId,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          });
        }
      });
    }

    terminate(): void {}
  }

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: FakeRobotImportWorker as unknown as typeof Worker,
  });

  return {
    get parseRequestCount() {
      return parseRequestCount;
    },
    restore() {
      disposeRobotImportWorker();
      restoreGlobalProperty('Worker', originalWorker);
    },
  };
}

function createRobotState(): RobotState {
  return {
    name: 'demo',
    rootLinkId: 'base_link',
    selection: { type: 'link', id: 'base_link' },
    materials: {
      blue: { color: '#0088ff' },
    },
    closedLoopConstraints: [
      {
        id: 'loop-1',
        type: 'connect',
        linkAId: 'base_link',
        linkBId: 'tool_link',
        anchorWorld: { x: 0, y: 0, z: 0 },
        anchorLocalA: { x: 0, y: 0, z: 0 },
        anchorLocalB: { x: 0, y: 0, z: 0 },
      },
    ],
    links: {
      tool_link: {
        ...DEFAULT_LINK,
        id: 'tool_link',
        name: 'tool_link',
      },
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
    },
    joints: {
      joint_a: {
        id: 'joint_a',
        name: 'joint_a',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'tool_link',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -1, upper: 1, effort: 10, velocity: 5 },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
        angle: 0.5,
      },
    },
  };
}

function createUrdfFile(name = 'robots/demo/demo.urdf'): RobotFile {
  return {
    name,
    format: 'urdf',
    content: '<robot name="demo"><link name="base_link" /></robot>',
  };
}

function createUsdFile(name = 'robots/demo/demo.usd'): RobotFile {
  return {
    name,
    format: 'usd',
    content: '',
  };
}

function createXacroFile(name = 'robots/demo/demo.urdf.xacro'): RobotFile {
  return {
    name,
    format: 'xacro',
    content: `
      <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo">
        <xacro:property name="size" value="0.1"/>
        <link name="base_link">
          <visual>
            <geometry>
              <box size="\${size} \${size} \${size}" />
            </geometry>
          </visual>
        </link>
      </robot>
    `,
  };
}

function createMjcfFile(name = 'robots/demo/demo.xml'): RobotFile {
  return {
    name,
    format: 'mjcf',
    content: `
      <mujoco model="demo">
        <worldbody>
          <body name="base_link" />
        </worldbody>
      </mujoco>
    `,
  };
}

function createAssemblyState(sourceFile = 'robots/demo/demo.xml'): AssemblyState {
  return {
    name: 'demo_project',
    components: {
      comp_demo: {
        id: 'comp_demo',
        name: 'demo',
        sourceFile,
        robot: {
          name: 'demo',
          rootLinkId: 'base_link',
          links: {
            base_link: {
              ...DEFAULT_LINK,
              id: 'base_link',
              name: 'base_link',
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

function assertNearlyEqual(actual: number, expected: number, message: string) {
  assert.ok(
    Math.abs(actual - expected) <= 1e-9,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

function createSeededSingleComponentAssemblyState(
  sourceFile = 'robots/demo/demo.urdf',
): AssemblyState {
  const sourceRobot = createRobotState();

  return {
    name: 'demo_project',
    components: {
      comp_demo: {
        id: 'comp_demo',
        name: 'demo',
        sourceFile,
        robot: {
          name: sourceRobot.name,
          rootLinkId: 'comp_demo_base_link',
          links: {
            comp_demo_base_link: {
              ...sourceRobot.links.base_link,
              id: 'comp_demo_base_link',
              name: 'demo',
            },
            comp_demo_tool_link: {
              ...sourceRobot.links.tool_link,
              id: 'comp_demo_tool_link',
              name: 'demo_tool_link',
            },
          },
          joints: {
            comp_demo_joint_a: {
              ...sourceRobot.joints.joint_a,
              id: 'comp_demo_joint_a',
              name: 'demo_joint_a',
              parentLinkId: 'comp_demo_base_link',
              childLinkId: 'comp_demo_tool_link',
            },
          },
          materials: {
            blue: { color: '#0088ff' },
          },
          closedLoopConstraints: [
            {
              ...sourceRobot.closedLoopConstraints![0],
              id: 'comp_demo_loop-1',
              linkAId: 'comp_demo_base_link',
              linkBId: 'comp_demo_tool_link',
            },
          ],
        },
        visible: true,
      },
    },
    bridges: {},
  };
}

function createStructureSwitchBaselineSnapshot(assemblyState: AssemblyState): string {
  const mergedRobotData = buildExportableAssemblyRobotData(assemblyState);
  return createRobotSourceSnapshot({
    ...mergedRobotData,
    selection: { type: null, id: null },
  });
}

test('createRobotSourceSnapshot ignores transient selection state', () => {
  const left = createRobotState();
  const right = createRobotState();

  right.selection = { type: 'joint', id: 'joint_a' };

  assert.equal(createRobotSourceSnapshot(left), createRobotSourceSnapshot(right));
});

test('createRobotSourceSnapshot is stable across key insertion order', () => {
  const left = createRobotState();
  const right = createRobotState();

  right.links = {
    base_link: right.links.base_link,
    tool_link: right.links.tool_link,
  };

  right.joints = {
    joint_a: right.joints.joint_a,
  };

  assert.equal(createRobotSourceSnapshot(left), createRobotSourceSnapshot(right));
});

test('canUseLightweightWorkspaceViewerReloadContent returns true when links already carry authored material truth', () => {
  const robot = createRobotState();
  robot.links.base_link = {
    ...robot.links.base_link,
    visual: {
      ...robot.links.base_link.visual,
      authoredMaterials: [{ name: 'body_blue', color: '#0088ff' }],
    },
  };

  assert.equal(canUseLightweightWorkspaceViewerReloadContent(robot.links), true);
});

test('canUseLightweightWorkspaceViewerReloadContent returns false when authored materials must still be inferred from XML', () => {
  assert.equal(canUseLightweightWorkspaceViewerReloadContent(createRobotState().links), false);
});

test('shouldUseGeneratedWorkspaceViewerReloadContent keeps real workspace geometry when a transform target is active', () => {
  const robot = createRobotState();
  robot.links.base_link = {
    ...robot.links.base_link,
    visual: {
      ...robot.links.base_link.visual,
      authoredMaterials: [{ name: 'body_blue', color: '#0088ff' }],
    },
  };

  assert.equal(
    shouldUseGeneratedWorkspaceViewerReloadContent({
      robotLinks: robot.links,
      hasActiveTransformTarget: true,
    }),
    true,
  );
});

test('shouldUseGeneratedWorkspaceViewerReloadContent keeps the lightweight reload path for passive workspace views with authored materials', () => {
  const robot = createRobotState();
  robot.links.base_link = {
    ...robot.links.base_link,
    visual: {
      ...robot.links.base_link.visual,
      authoredMaterials: [{ name: 'body_blue', color: '#0088ff' }],
    },
  };

  assert.equal(
    shouldUseGeneratedWorkspaceViewerReloadContent({
      robotLinks: robot.links,
      hasActiveTransformTarget: false,
    }),
    false,
  );
});

test('isActiveWorkspaceTransformSession stays false for passive component selection without transform edits', () => {
  assert.equal(
    isActiveWorkspaceTransformSession({
      shouldRenderAssembly: true,
      shouldReuseSelectedFileViewerForWorkspace: false,
      workspaceTransformPending: false,
    }),
    false,
  );
});

test('shouldUseGeneratedWorkspaceViewerReloadContent respects transform pending gating even when authored materials exist', () => {
  const robot = createRobotState();
  robot.links.base_link = {
    ...robot.links.base_link,
    visual: {
      ...robot.links.base_link.visual,
      authoredMaterials: [{ name: 'body_blue', color: '#0088ff' }],
    },
  };

  const hasActiveTransformTarget = isActiveWorkspaceTransformSession({
    shouldRenderAssembly: true,
    shouldReuseSelectedFileViewerForWorkspace: false,
    workspaceTransformPending: true,
  });

  assert.equal(hasActiveTransformTarget, true);
  assert.equal(
    shouldUseGeneratedWorkspaceViewerReloadContent({
      robotLinks: robot.links,
      hasActiveTransformTarget,
    }),
    true,
  );
});

test('buildLightweightWorkspaceViewerReloadContent produces a tiny deterministic URDF stub', () => {
  assert.equal(
    buildLightweightWorkspaceViewerReloadContent(42),
    '<robot name="workspace_viewer_42" />',
  );
});

test('buildGeneratedWorkspaceUrdfFileName reserves the generated folder and increments collisions', () => {
  const availableFiles: RobotFile[] = [
    createUrdfFile('robots/demo/demo.urdf'),
    createUrdfFile('generated/demo_workspace.generated.urdf'),
  ];

  assert.equal(
    buildGeneratedWorkspaceUrdfFileName({
      assemblyName: 'demo workspace',
      availableFiles,
    }),
    'generated/demo_workspace_2.generated.urdf',
  );

  assert.equal(isGeneratedWorkspaceUrdfFileName('generated/demo_workspace.generated.urdf'), true);
  assert.equal(isGeneratedWorkspaceUrdfFileName('robots/demo/demo.urdf'), false);
});

test('createGeneratedWorkspaceUrdfFile creates a deterministic URDF projection for simple mode', () => {
  const baseRobot = createRobotState();
  const mergedRobotData: RobotData = {
    name: baseRobot.name,
    rootLinkId: baseRobot.rootLinkId,
    links: baseRobot.links,
    joints: baseRobot.joints,
    materials: baseRobot.materials,
    closedLoopConstraints: baseRobot.closedLoopConstraints,
    inspectionContext: baseRobot.inspectionContext,
  };

  const generated = createGeneratedWorkspaceUrdfFile({
    assemblyName: 'demo workspace',
    mergedRobotData,
    availableFiles: [],
  });

  assert.equal(generated.file.name, 'generated/demo_workspace.generated.urdf');
  assert.equal(generated.file.format, 'urdf');
  assert.match(generated.file.content, /<robot name="demo">/);
  assert.equal(generated.snapshot, createRobotSourceSnapshot(generated.robot));
});

test('resolveWorkspaceGeneratedUrdfRobotData prefers source truth for pristine single-component MJCF seeds', () => {
  const activeFile = createMjcfFile('robots/demo/fruitfly.xml');
  const importResult = resolveRobotFileData(activeFile, {
    availableFiles: [activeFile],
    assets: {},
    allFileContents: {},
  });

  assert.equal(importResult.status, 'ready');
  if (importResult.status !== 'ready') {
    return;
  }

  const assemblyState: AssemblyState = {
    name: 'demo_project',
    components: {
      comp_fruitfly: {
        id: 'comp_fruitfly',
        name: 'fruitfly',
        sourceFile: activeFile.name,
        robot: prepareAssemblyRobotData(importResult.robotData, {
          componentId: 'comp_fruitfly',
          rootName: 'fruitfly',
          sourceFilePath: activeFile.name,
          sourceFormat: 'mjcf',
        }),
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        visible: true,
      },
    },
    bridges: {},
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
  };

  const resolvedRobotData = resolveWorkspaceGeneratedUrdfRobotData({
    assemblyState,
    activeFile,
    availableFiles: [activeFile],
    assets: {},
    allFileContents: {},
  });

  assert.ok(resolvedRobotData, 'expected source-truth robot data for pristine seed');
  assert.equal(resolvedRobotData?.rootLinkId, importResult.robotData.rootLinkId);

  const generated = createGeneratedWorkspaceUrdfFile({
    assemblyName: assemblyState.name,
    mergedRobotData: resolvedRobotData!,
    availableFiles: [],
  });

  assert.equal(
    generated.file.content.includes('comp_fruitfly_'),
    false,
    'pristine single-component generation should not leak assembly namespaces into the file',
  );
});

test('resolveWorkspaceGeneratedUrdfRobotData falls back to exportable assembly data once transforms diverge', () => {
  const activeFile = createMjcfFile('robots/demo/fruitfly.xml');
  const importResult = resolveRobotFileData(activeFile, {
    availableFiles: [activeFile],
    assets: {},
    allFileContents: {},
  });

  assert.equal(importResult.status, 'ready');
  if (importResult.status !== 'ready') {
    return;
  }

  const assemblyState: AssemblyState = {
    name: 'demo_project',
    components: {
      comp_fruitfly: {
        id: 'comp_fruitfly',
        name: 'fruitfly',
        sourceFile: activeFile.name,
        robot: prepareAssemblyRobotData(importResult.robotData, {
          componentId: 'comp_fruitfly',
          rootName: 'fruitfly',
          sourceFilePath: activeFile.name,
          sourceFormat: 'mjcf',
        }),
        transform: {
          position: { x: 0.15, y: -0.05, z: 0.25 },
          rotation: { r: 0, p: 0, y: 0.35 },
        },
        visible: true,
      },
    },
    bridges: {},
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
  };

  const resolvedRobotData = resolveWorkspaceGeneratedUrdfRobotData({
    assemblyState,
    activeFile,
    availableFiles: [activeFile],
    assets: {},
    allFileContents: {},
  });

  assert.ok(resolvedRobotData, 'expected exportable assembly data for transformed seed');
  assert.equal(
    resolvedRobotData?.rootLinkId,
    '__assembly_component_root_comp_fruitfly',
    'transformed components should still export through the assembly wrapper path',
  );
});

test('buildGeneratedWorkspaceFileState appends or updates generated URDF entries', () => {
  const generatedFile = createUrdfFile('generated/workspace.generated.urdf');
  generatedFile.content = '<robot name="workspace" />';
  const availableFiles = [createUrdfFile('robots/demo/demo.urdf')];
  const allFileContents = { 'robots/demo/demo.urdf': '<robot name="demo" />' };

  const initialState = buildGeneratedWorkspaceFileState({
    availableFiles,
    allFileContents,
    file: generatedFile,
  });

  assert.ok(initialState.nextAvailableFiles.some((file) => file.name === generatedFile.name));
  assert.equal(initialState.nextAllFileContents[generatedFile.name], generatedFile.content);

  const updatedFile = { ...generatedFile, content: '<robot name="workspace_v2" />' };
  const updateState = buildGeneratedWorkspaceFileState({
    availableFiles: initialState.nextAvailableFiles,
    allFileContents: initialState.nextAllFileContents,
    file: updatedFile,
  });

  const updatedEntry = updateState.nextAvailableFiles.find(
    (file) => file.name === updatedFile.name,
  );
  assert.equal(updatedEntry?.content, updatedFile.content);
  assert.equal(updateState.nextAllFileContents[updatedFile.name], updatedFile.content);
});

test('createGeneratedWorkspaceUrdfFile leaves content empty for unsupported ball joints', () => {
  const generated = createGeneratedWorkspaceUrdfFile({
    assemblyName: 'ball_workspace',
    mergedRobotData: {
      name: 'ball_workspace',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
        },
        child_link: {
          ...DEFAULT_LINK,
          id: 'child_link',
          name: 'child_link',
        },
      },
      joints: {
        joint_1: {
          ...DEFAULT_JOINT,
          id: 'joint_1',
          name: 'joint_1',
          type: JointType.BALL,
          parentLinkId: 'base_link',
          childLinkId: 'child_link',
        },
      },
      materials: {},
    },
    availableFiles: [],
  });

  assert.equal(generated.file.content, '');
});

test('createRobotSourceSnapshotFromUrdfContent normalizes mesh paths relative to the source file', async () => {
  const workerMock = installEditableRobotSourceWorkerMock();

  try {
    const snapshot = await createRobotSourceSnapshotFromUrdfContent(
      `
      <robot name="demo">
        <link name="base_link">
          <visual>
            <geometry>
              <mesh filename="meshes/base.stl" />
            </geometry>
          </visual>
        </link>
      </robot>
    `,
      {
        sourcePath: 'robots/demo/demo.urdf',
      },
    );

    assert.ok(snapshot);
    assert.match(snapshot ?? '', /robots\/demo\/meshes\/base\.stl/);
  } finally {
    workerMock.restore();
  }
});

test('createRobotSourceSnapshotFromUrdfContent uses the editable source worker when Worker is available', async () => {
  const workerMock = installEditableRobotSourceWorkerMock();

  try {
    const snapshot = await createRobotSourceSnapshotFromUrdfContent(
      `
      <robot name="demo">
        <link name="base_link" />
      </robot>
    `,
      {
        sourcePath: 'robots/demo/demo.urdf',
      },
    );

    assert.equal(workerMock.parseRequestCount, 1);
    assert.ok(snapshot);
    assert.match(snapshot ?? '', /"name":"demo"/);
  } finally {
    workerMock.restore();
  }
});

test('getPreferredUrdfContent keeps the imported URDF before store edits', () => {
  assert.equal(
    getPreferredUrdfContent({
      fileContent: '<robot name="vendor-original"/>',
      originalContent: '<robot name="fallback-original"/>',
      generatedContent: '<robot name="generated-roundtrip"/>',
      hasStoreEdits: false,
    }),
    '<robot name="vendor-original"/>',
  );
});

test('getPreferredUrdfContent switches to generated URDF after store edits', () => {
  assert.equal(
    getPreferredUrdfContent({
      fileContent: '<robot name="vendor-original"/>',
      originalContent: '<robot name="fallback-original"/>',
      generatedContent: '<robot name="generated-roundtrip"/>',
      hasStoreEdits: true,
    }),
    '<robot name="generated-roundtrip"/>',
  );
});

test('shouldUseEmptyRobotForUsdHydration masks the previous robot during first USD load', () => {
  assert.equal(
    shouldUseEmptyRobotForUsdHydration({
      selectedFileFormat: 'usd',
      selectedFileName: 'robots/demo/demo.usd',
      documentLoadStatus: 'hydrating',
      documentLoadFileName: 'robots/demo/demo.usd',
    }),
    true,
  );
});

test('shouldUseEmptyRobotForUsdHydration stops masking once USD robot data is prepared', () => {
  assert.equal(
    shouldUseEmptyRobotForUsdHydration({
      selectedFileFormat: 'usd',
      selectedFileName: 'robots/demo/demo.usd',
      documentLoadStatus: 'ready',
      documentLoadFileName: 'robots/demo/demo.usd',
    }),
    false,
  );
});

test('shouldUseEmptyRobotForUsdHydration does not affect non-USD files', () => {
  assert.equal(
    shouldUseEmptyRobotForUsdHydration({
      selectedFileFormat: 'urdf',
      selectedFileName: 'robots/demo/demo.urdf',
      documentLoadStatus: 'hydrating',
      documentLoadFileName: 'robots/demo/demo.urdf',
    }),
    false,
  );
});

test('getViewerSourceFile clears the source file while rendering an assembly view', () => {
  assert.equal(
    getViewerSourceFile({
      selectedFile: createMjcfFile(),
      shouldRenderAssembly: true,
    }),
    null,
  );
});

test('getViewerSourceFile keeps the selected file outside assembly rendering', () => {
  const selectedFile = createMjcfFile();

  assert.equal(
    getViewerSourceFile({
      selectedFile,
      shouldRenderAssembly: false,
    }),
    selectedFile,
  );
});

test('getViewerSourceFile keeps an explicit workspace source file while rendering an assembly view', () => {
  const workspaceSourceFile = createMjcfFile('robots/demo/workspace.xml');

  assert.equal(
    getViewerSourceFile({
      selectedFile: createMjcfFile('robots/demo/selected.xml'),
      shouldRenderAssembly: true,
      workspaceSourceFile,
    }),
    workspaceSourceFile,
  );
});

test('getWorkspaceAssemblyRenderFailureReason reports no failure when assembly rendering is disabled', () => {
  assert.equal(
    getWorkspaceAssemblyRenderFailureReason({
      shouldRenderAssembly: false,
      hasDisplayAssemblyState: false,
      mergedRobotData: null,
      viewerMergedRobotData: null,
    }),
    null,
  );
});

test('getWorkspaceAssemblyRenderFailureReason defers failures until the display assembly state is ready', () => {
  assert.equal(
    getWorkspaceAssemblyRenderFailureReason({
      shouldRenderAssembly: true,
      hasDisplayAssemblyState: false,
      mergedRobotData: null,
      viewerMergedRobotData: null,
    }),
    null,
  );
});

test('getWorkspaceAssemblyRenderFailureReason surfaces missing merged workspace robot data', () => {
  assert.equal(
    getWorkspaceAssemblyRenderFailureReason({
      shouldRenderAssembly: true,
      hasDisplayAssemblyState: true,
      mergedRobotData: null,
      viewerMergedRobotData: null,
    }),
    'missing-merged-robot-data',
  );
});

test('getWorkspaceAssemblyRenderFailureReason surfaces missing viewer merged robot data', () => {
  const mergedRobotData = mergeAssembly(createAssemblyState('robots/demo/workspace.xml'));
  assert.ok(mergedRobotData);

  assert.equal(
    getWorkspaceAssemblyRenderFailureReason({
      shouldRenderAssembly: true,
      hasDisplayAssemblyState: true,
      mergedRobotData,
      viewerMergedRobotData: null,
    }),
    'missing-viewer-merged-robot-data',
  );
});

test('getSingleComponentWorkspaceMjcfViewerSource returns the lone visible MJCF component source', () => {
  const sourceFile = createMjcfFile('robots/demo/workspace.xml');

  assert.equal(
    getSingleComponentWorkspaceMjcfViewerSource({
      assemblyState: createAssemblyState(sourceFile.name),
      availableFiles: [sourceFile],
    }),
    sourceFile,
  );
});

test('getSingleComponentWorkspaceMjcfViewerSource ignores assemblies that need the merged workspace viewer path', () => {
  const sourceFile = createMjcfFile('robots/demo/workspace.xml');
  const secondSourceFile = createMjcfFile('robots/demo/other.xml');
  const multiComponentAssembly = createAssemblyState(sourceFile.name);
  multiComponentAssembly.components.comp_other = {
    id: 'comp_other',
    name: 'other',
    sourceFile: secondSourceFile.name,
    robot: {
      name: 'other',
      rootLinkId: 'other_root',
      links: {
        other_root: {
          ...DEFAULT_LINK,
          id: 'other_root',
          name: 'other_root',
        },
      },
      joints: {},
    },
    visible: true,
  };

  assert.equal(
    getSingleComponentWorkspaceMjcfViewerSource({
      assemblyState: multiComponentAssembly,
      availableFiles: [sourceFile, secondSourceFile],
    }),
    null,
  );

  const bridgedAssembly = createAssemblyState(sourceFile.name);
  bridgedAssembly.bridges.bridge_1 = {
    id: 'bridge_1',
    name: 'bridge_1',
    parentComponentId: 'comp_demo',
    parentLinkId: 'base_link',
    childComponentId: 'comp_demo',
    childLinkId: 'base_link',
    joint: {
      id: 'bridge_joint',
      name: 'bridge_joint',
      type: JointType.FIXED,
      parentLinkId: 'base_link',
      childLinkId: 'base_link',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      axis: { x: 0, y: 0, z: 1 },
      limit: { lower: 0, upper: 0, effort: 0, velocity: 0 },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
    },
  };

  assert.equal(
    getSingleComponentWorkspaceMjcfViewerSource({
      assemblyState: bridgedAssembly,
      availableFiles: [sourceFile],
    }),
    null,
  );

  const urdfSourceFile = createUrdfFile('robots/demo/workspace.urdf');

  assert.equal(
    getSingleComponentWorkspaceMjcfViewerSource({
      assemblyState: createAssemblyState(urdfSourceFile.name),
      availableFiles: [urdfSourceFile],
    }),
    null,
  );
});

test('shouldKeepPristineSingleComponentWorkspaceOnSourceViewer reuses pristine Cassie MJCF seeds even when source snapshots strip transient joint motion', () => {
  const fixtureRoot = path.resolve('test/mujoco_menagerie-main/agility_cassie');
  const files: RobotFile[] = fs
    .readdirSync(fixtureRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(xml|mjcf)$/i.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(entry.parentPath, entry.name);
      return {
        name: fullPath.replace(/\\/g, '/'),
        format: 'mjcf' as const,
        content: fs.readFileSync(fullPath, 'utf8'),
      };
    });
  const sourceFile = files.find((file) => file.name.endsWith('/cassie.xml')) ?? null;

  assert.ok(sourceFile, 'expected Cassie MJCF fixture to exist');
  if (!sourceFile) {
    return;
  }

  const allFileContents = Object.fromEntries(files.map((file) => [file.name, file.content]));
  const importResult = resolveRobotFileData(sourceFile, {
    availableFiles: files,
    allFileContents,
    assets: {},
  });
  assert.equal(importResult.status, 'ready');
  if (importResult.status !== 'ready') {
    return;
  }

  const componentId = 'comp_cassie';
  const assemblyState: AssemblyState = {
    name: 'cassie_workspace',
    components: {
      [componentId]: {
        id: componentId,
        name: 'cassie',
        sourceFile: sourceFile.name,
        robot: prepareAssemblyRobotData(importResult.robotData, {
          componentId,
          rootName: 'cassie',
          sourceFilePath: sourceFile.name,
          sourceFormat: 'mjcf',
        }),
        visible: true,
      },
    },
    bridges: {},
  };

  const sourceSnapshot = createRobotSourceSnapshot({
    ...importResult.robotData,
    joints: stripTransientJointMotionFromJoints(importResult.robotData.joints),
    selection: { type: null, id: null },
  });

  assert.equal(
    shouldReuseSourceViewerForSingleComponentAssembly({
      assemblyState,
      activeFile: sourceFile,
      sourceSnapshot,
    }),
    true,
    'expected pristine Cassie MJCF seeds to keep the current file runtime on the source viewer',
  );

  assert.equal(
    shouldKeepPristineSingleComponentWorkspaceOnSourceViewer({
      assemblyState,
      activeFile: sourceFile,
      sourceSnapshot,
      assemblySelectionType: null,
    }),
    true,
    'expected professional mode to keep pristine single-component Cassie seeds on the simple-mode viewer path',
  );
});

test('getWorkspaceAssemblyViewerRobotData injects a transient bridge preview without mutating persisted bridges', () => {
  const assemblyState = createAssemblyState('robots/demo/left.xml');
  assemblyState.components.comp_demo.robot.rootLinkId = 'comp_demo_base_link';
  assemblyState.components.comp_demo.robot.links = {
    comp_demo_base_link: {
      ...DEFAULT_LINK,
      id: 'comp_demo_base_link',
      name: 'base_link',
    },
  };
  assemblyState.components.comp_other = {
    id: 'comp_other',
    name: 'other',
    sourceFile: 'robots/demo/right.xml',
    robot: {
      name: 'other',
      rootLinkId: 'comp_other_other_root',
      links: {
        comp_other_other_root: {
          ...DEFAULT_LINK,
          id: 'comp_other_other_root',
          name: 'other_root',
        },
      },
      joints: {},
    },
    visible: true,
  };

  const previewRobot = getWorkspaceAssemblyViewerRobotData({
    assemblyState,
    bridgePreview: {
      id: '__bridge_preview__',
      name: '__bridge_preview__',
      parentComponentId: 'comp_demo',
      parentLinkId: 'comp_demo_base_link',
      childComponentId: 'comp_other',
      childLinkId: 'comp_other_other_root',
      joint: {
        id: '__bridge_preview__',
        name: '__bridge_preview__',
        type: JointType.FIXED,
        parentLinkId: 'comp_demo_base_link',
        childLinkId: 'comp_other_other_root',
        origin: { xyz: { x: 0.1, y: -0.2, z: 0.3 }, rpy: { r: 0, p: 0, y: 0 } },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
  });

  assert.ok(previewRobot);
  assert.equal(previewRobot?.joints.__bridge_preview__?.parentLinkId, 'comp_demo_base_link');
  assert.equal(previewRobot?.joints.__bridge_preview__?.childLinkId, 'comp_other_other_root');
  assert.equal(previewRobot?.joints.__bridge_preview__?.origin.xyz.x, 0.1);
  assert.equal(Object.keys(assemblyState.bridges).length, 0);
});

test('workspace viewer preview state keeps the previewed child on the merged bridge tree before confirmation', () => {
  const assemblyState = createAssemblyState('robots/demo/left.xml');
  assemblyState.components.comp_demo.robot.rootLinkId = 'comp_demo_base_link';
  assemblyState.components.comp_demo.robot.links = {
    comp_demo_base_link: {
      ...DEFAULT_LINK,
      id: 'comp_demo_base_link',
      name: 'base_link',
    },
  };
  assemblyState.components.comp_other = {
    id: 'comp_other',
    name: 'other',
    sourceFile: 'robots/demo/right.xml',
    robot: {
      name: 'other',
      rootLinkId: 'comp_other_other_root',
      links: {
        comp_other_other_root: {
          ...DEFAULT_LINK,
          id: 'comp_other_other_root',
          name: 'other_root',
        },
      },
      joints: {},
    },
    transform: {
      position: { x: 4, y: 0.5, z: -0.25 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
  };

  const previewBridge = {
    id: '__bridge_preview__',
    name: '__bridge_preview__',
    parentComponentId: 'comp_demo',
    parentLinkId: 'comp_demo_base_link',
    childComponentId: 'comp_other',
    childLinkId: 'comp_other_other_root',
    joint: {
      id: '__bridge_preview__',
      name: '__bridge_preview__',
      type: JointType.FIXED,
      parentLinkId: 'comp_demo_base_link',
      childLinkId: 'comp_other_other_root',
      origin: { xyz: { x: 0.1, y: -0.2, z: 0.3 }, rpy: { r: 0, p: 0, y: 0 } },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
    },
  } as const;

  const viewerAssemblyState = buildWorkspaceAssemblyViewerState({
    assemblyState,
    bridgePreview: previewBridge,
  });
  const previewRobot = getWorkspaceAssemblyViewerRobotData({
    assemblyState: viewerAssemblyState,
  });
  const previewDisplayRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState: viewerAssemblyState,
    mergedRobotData: previewRobot,
  });

  assert.ok(viewerAssemblyState, 'viewer assembly state should exist');
  assert.notEqual(viewerAssemblyState, assemblyState, 'preview should use a cloned assembly state');
  assert.equal(assemblyState.components.comp_other.transform?.position.x, 4);
  assert.equal(Object.keys(assemblyState.bridges).length, 0);

  assertNearlyEqual(
    viewerAssemblyState.components.comp_other.transform?.position.x ?? 0,
    0.1,
    'preview child transform should align to bridge origin on x',
  );
  assertNearlyEqual(
    viewerAssemblyState.components.comp_other.transform?.position.y ?? 0,
    -0.2,
    'preview child transform should align to bridge origin on y',
  );
  assertNearlyEqual(
    viewerAssemblyState.components.comp_other.transform?.position.z ?? 0,
    0.3,
    'preview child transform should align to bridge origin on z',
  );

  const previewParentRootJoint =
    previewDisplayRobot?.joints[`${WORKSPACE_VIEWER_COMPONENT_ROOT_JOINT_PREFIX}comp_demo`];
  const previewBridgeJoint = previewDisplayRobot?.joints.__bridge_preview__;
  assert.ok(
    previewParentRootJoint,
    'workspace viewer should keep a synthetic root joint for the parent component',
  );
  assert.equal(
    previewDisplayRobot?.joints[`${WORKSPACE_VIEWER_COMPONENT_ROOT_JOINT_PREFIX}comp_other`],
    undefined,
    'previewed bridged children should move through the preview bridge instead of a child root joint',
  );
  assert.ok(previewBridgeJoint, 'workspace viewer should keep the preview bridge joint');

  const previewMatrices = computeLinkWorldMatrices(previewDisplayRobot!);
  const previewParentMatrix = previewMatrices.comp_demo_base_link;
  const previewChildMatrix = previewMatrices.comp_other_other_root;
  assert.ok(previewParentMatrix, 'expected a preview world matrix for the parent link');
  assert.ok(previewChildMatrix, 'expected a preview world matrix for the child link');
  assertNearlyEqual(
    previewChildMatrix.elements[12] - previewParentMatrix.elements[12],
    0.1,
    'previewed child link should move on x through the preview bridge',
  );
  assertNearlyEqual(
    previewChildMatrix.elements[13] - previewParentMatrix.elements[13],
    -0.2,
    'previewed child link should move on y through the preview bridge',
  );
  assertNearlyEqual(
    previewChildMatrix.elements[14] - previewParentMatrix.elements[14],
    0.3,
    'previewed child link should move on z through the preview bridge',
  );
});

test('workspace viewer preview state resolves unprefixed bridge link ids before realigning the child component', () => {
  const assemblyState = createAssemblyState('robots/demo/left.xml');
  assemblyState.components.comp_demo.robot.rootLinkId = 'comp_demo_base_link';
  assemblyState.components.comp_demo.robot.links = {
    comp_demo_base_link: {
      ...DEFAULT_LINK,
      id: 'comp_demo_base_link',
      name: 'base_link',
    },
  };
  assemblyState.components.comp_other = {
    id: 'comp_other',
    name: 'other',
    sourceFile: 'robots/demo/right.xml',
    robot: {
      name: 'other',
      rootLinkId: 'comp_other_other_root',
      links: {
        comp_other_other_root: {
          ...DEFAULT_LINK,
          id: 'comp_other_other_root',
          name: 'other_root',
        },
      },
      joints: {},
    },
    transform: {
      position: { x: 4, y: 0.5, z: -0.25 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
  };

  const viewerAssemblyState = buildWorkspaceAssemblyViewerState({
    assemblyState,
    bridgePreview: {
      id: '__bridge_preview__',
      name: '__bridge_preview__',
      parentComponentId: 'comp_demo',
      parentLinkId: 'base_link',
      childComponentId: 'comp_other',
      childLinkId: 'other_root',
      joint: {
        id: '__bridge_preview__',
        name: '__bridge_preview__',
        type: JointType.FIXED,
        parentLinkId: 'base_link',
        childLinkId: 'other_root',
        origin: { xyz: { x: 0.25, y: -0.5, z: 0.75 }, rpy: { r: 0, p: 0, y: 0 } },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
  });

  assert.ok(viewerAssemblyState, 'viewer assembly state should exist');
  assert.notEqual(viewerAssemblyState, assemblyState, 'preview should use a cloned assembly state');
  assertNearlyEqual(
    viewerAssemblyState.components.comp_other.transform?.position.x ?? 0,
    0.25,
    'preview child transform should resolve unprefixed link ids on x',
  );
  assertNearlyEqual(
    viewerAssemblyState.components.comp_other.transform?.position.y ?? 0,
    -0.5,
    'preview child transform should resolve unprefixed link ids on y',
  );
  assertNearlyEqual(
    viewerAssemblyState.components.comp_other.transform?.position.z ?? 0,
    0.75,
    'preview child transform should resolve unprefixed link ids on z',
  );
});

test('getWorkspaceAssemblyViewerRobotData skips transient previews for hidden components', () => {
  const assemblyState = createAssemblyState('robots/demo/left.xml');
  assemblyState.components.comp_demo.robot.rootLinkId = 'comp_demo_base_link';
  assemblyState.components.comp_demo.robot.links = {
    comp_demo_base_link: {
      ...DEFAULT_LINK,
      id: 'comp_demo_base_link',
      name: 'base_link',
    },
  };
  assemblyState.components.comp_other = {
    id: 'comp_other',
    name: 'other',
    sourceFile: 'robots/demo/right.xml',
    robot: {
      name: 'other',
      rootLinkId: 'comp_other_other_root',
      links: {
        comp_other_other_root: {
          ...DEFAULT_LINK,
          id: 'comp_other_other_root',
          name: 'other_root',
        },
      },
      joints: {},
    },
    visible: false,
  };

  const previewRobot = getWorkspaceAssemblyViewerRobotData({
    assemblyState,
    bridgePreview: {
      id: '__bridge_preview__',
      name: '__bridge_preview__',
      parentComponentId: 'comp_demo',
      parentLinkId: 'comp_demo_base_link',
      childComponentId: 'comp_other',
      childLinkId: 'comp_other_other_root',
      joint: {
        id: '__bridge_preview__',
        name: '__bridge_preview__',
        type: JointType.FIXED,
        parentLinkId: 'comp_demo_base_link',
        childLinkId: 'comp_other_other_root',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
  });

  assert.ok(previewRobot);
  assert.equal(previewRobot?.joints.__bridge_preview__, undefined);
});

test('buildWorkspaceAssemblyViewerDisplayRobotData keeps preview bridges on the merged workspace tree', () => {
  const assemblyState = createAssemblyState('robots/demo/left.xml');
  assemblyState.components.comp_demo.robot.rootLinkId = 'comp_demo_base_link';
  assemblyState.components.comp_demo.robot.links = {
    comp_demo_base_link: {
      ...DEFAULT_LINK,
      id: 'comp_demo_base_link',
      name: 'base_link',
    },
  };
  assemblyState.components.comp_other = {
    id: 'comp_other',
    name: 'other',
    sourceFile: 'robots/demo/right.xml',
    robot: {
      name: 'other',
      rootLinkId: 'comp_other_other_root',
      links: {
        comp_other_other_root: {
          ...DEFAULT_LINK,
          id: 'comp_other_other_root',
          name: 'other_root',
        },
      },
      joints: {},
    },
    visible: true,
  };

  const previewRobot = getWorkspaceAssemblyViewerRobotData({
    assemblyState,
    bridgePreview: {
      id: '__bridge_preview__',
      name: '__bridge_preview__',
      parentComponentId: 'comp_demo',
      parentLinkId: 'comp_demo_base_link',
      childComponentId: 'comp_other',
      childLinkId: 'comp_other_other_root',
      joint: {
        id: '__bridge_preview__',
        name: '__bridge_preview__',
        type: JointType.FIXED,
        parentLinkId: 'comp_demo_base_link',
        childLinkId: 'comp_other_other_root',
        origin: { xyz: { x: 0.1, y: -0.2, z: 0.3 }, rpy: { r: 0, p: 0, y: 0 } },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
  });

  const displayRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState,
    mergedRobotData: previewRobot,
  });

  assert.ok(displayRobot);
  assert.equal(displayRobot?.rootLinkId, '__workspace_world__');
  assert.ok(displayRobot?.joints.__bridge_preview__);
  assert.equal(displayRobot?.joints['__workspace_world__::component::comp_other'], undefined);

  const previewMatrices = computeLinkWorldMatrices(displayRobot!);
  const previewParentMatrix = previewMatrices.comp_demo_base_link;
  const previewChildMatrix = previewMatrices.comp_other_other_root;
  assert.ok(previewParentMatrix, 'expected a preview world matrix for the parent link');
  assert.ok(previewChildMatrix, 'expected a preview world matrix for the child link');
  assertNearlyEqual(
    previewChildMatrix.elements[12] - previewParentMatrix.elements[12],
    0.1,
    'previewed child link should align on x through the preview bridge',
  );
  assertNearlyEqual(
    previewChildMatrix.elements[13] - previewParentMatrix.elements[13],
    -0.2,
    'previewed child link should align on y through the preview bridge',
  );
  assertNearlyEqual(
    previewChildMatrix.elements[14] - previewParentMatrix.elements[14],
    0.3,
    'previewed child link should align on z through the preview bridge',
  );

  const normalizedDisplayRobot = normalizeWorkspaceAssemblyViewerDisplayRobotDataForSource(
    displayRobot!,
  );
  assert.equal(normalizedDisplayRobot.joints.__bridge_preview__?.origin.xyz.x, 0);
});

test('normalizeWorkspaceAssemblyViewerDisplayRobotDataForSource keeps bridge-motion-only previews source-stable', () => {
  const assemblyState = createAssemblyState('robots/demo/left.xml');
  assemblyState.components.comp_demo.robot.rootLinkId = 'comp_demo_base_link';
  assemblyState.components.comp_demo.robot.links = {
    comp_demo_base_link: {
      ...DEFAULT_LINK,
      id: 'comp_demo_base_link',
      name: 'base_link',
    },
  };
  assemblyState.components.comp_other = {
    id: 'comp_other',
    name: 'other',
    sourceFile: 'robots/demo/right.xml',
    robot: {
      name: 'other',
      rootLinkId: 'comp_other_other_root',
      links: {
        comp_other_other_root: {
          ...DEFAULT_LINK,
          id: 'comp_other_other_root',
          name: 'other_root',
        },
      },
      joints: {},
    },
    visible: true,
  };

  const buildNormalizedSnapshot = (bridgeOriginX: number) => {
    const previewRobot = getWorkspaceAssemblyViewerRobotData({
      assemblyState,
      bridgePreview: {
        id: '__bridge_preview__',
        name: '__bridge_preview__',
        parentComponentId: 'comp_demo',
        parentLinkId: 'comp_demo_base_link',
        childComponentId: 'comp_other',
        childLinkId: 'comp_other_other_root',
        joint: {
          id: '__bridge_preview__',
          name: '__bridge_preview__',
          type: JointType.FIXED,
          parentLinkId: 'comp_demo_base_link',
          childLinkId: 'comp_other_other_root',
          origin: { xyz: { x: bridgeOriginX, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          dynamics: { damping: 0, friction: 0 },
          hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
        },
      },
    });
    const displayRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
      assemblyState,
      mergedRobotData: previewRobot,
    });
    const normalizedDisplayRobot = normalizeWorkspaceAssemblyViewerDisplayRobotDataForSource(
      displayRobot!,
    );

    return {
      displaySnapshot: createRobotSourceSnapshot({
        ...displayRobot!,
        selection: { type: null, id: null },
      }),
      normalizedSnapshot: createRobotSourceSnapshot({
        ...normalizedDisplayRobot,
        selection: { type: null, id: null },
      }),
    };
  };

  const initial = buildNormalizedSnapshot(0.1);
  const moved = buildNormalizedSnapshot(0.65);

  assert.notEqual(initial.displaySnapshot, moved.displaySnapshot);
  assert.equal(initial.normalizedSnapshot, moved.normalizedSnapshot);
});

test('buildWorkspaceAssemblyViewerDisplayRobotData applies isolated component transforms to synthetic root joints', () => {
  const assemblyState = createAssemblyState('robots/demo/demo.urdf');
  assemblyState.components.comp_demo.transform = {
    position: { x: 0.5, y: -0.25, z: 0.75 },
    rotation: { r: 0.1, p: -0.2, y: 0.3 },
  };

  const displayRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState,
    mergedRobotData: assemblyState.components.comp_demo.robot,
  });

  assert.ok(displayRobot);
  assert.equal(displayRobot?.rootLinkId, '__workspace_world__');

  const syntheticRootJoint = displayRobot?.joints['__workspace_world__::component::comp_demo'];
  assert.ok(syntheticRootJoint, 'expected a synthetic root joint for the isolated component');
  assertNearlyEqual(
    syntheticRootJoint.origin.xyz.x,
    0.5,
    'synthetic root joint x translation should match component transform',
  );
  assertNearlyEqual(
    syntheticRootJoint.origin.xyz.y,
    -0.25,
    'synthetic root joint y translation should match component transform',
  );
  assertNearlyEqual(
    syntheticRootJoint.origin.xyz.z,
    0.75,
    'synthetic root joint z translation should match component transform',
  );
  assertNearlyEqual(
    syntheticRootJoint.origin.rpy.r,
    0.1,
    'synthetic root joint roll should match component transform',
  );
  assertNearlyEqual(
    syntheticRootJoint.origin.rpy.p,
    -0.2,
    'synthetic root joint pitch should match component transform',
  );
  assertNearlyEqual(
    syntheticRootJoint.origin.rpy.y,
    0.3,
    'synthetic root joint yaw should match component transform',
  );
});

test('buildWorkspaceAssemblyViewerDisplayRobotData packs isolated components using footprint-aware offsets', () => {
  const assemblyState = createAssemblyState('robots/demo/demo.urdf');
  assemblyState.components.comp_demo.robot.rootLinkId = 'comp_demo_base_link';
  assemblyState.components.comp_demo.robot.links = {
    comp_demo_base_link: {
      ...DEFAULT_LINK,
      id: 'comp_demo_base_link',
      name: 'base_link',
    },
    comp_demo_tool_link: {
      ...DEFAULT_LINK,
      id: 'comp_demo_tool_link',
      name: 'tool_link',
    },
  };
  assemblyState.components.comp_demo.robot.joints = {
    comp_demo_fixed_joint: {
      id: 'comp_demo_fixed_joint',
      name: 'comp_demo_fixed_joint',
      type: JointType.FIXED,
      parentLinkId: 'comp_demo_base_link',
      childLinkId: 'comp_demo_tool_link',
      origin: { xyz: { x: 1.2, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
    },
  };
  assemblyState.components.comp_other = {
    id: 'comp_other',
    name: 'other',
    sourceFile: 'robots/demo/other.urdf',
    robot: {
      name: 'other',
      rootLinkId: 'comp_other_base_link',
      links: {
        comp_other_base_link: {
          ...DEFAULT_LINK,
          id: 'comp_other_base_link',
          name: 'other_base_link',
        },
      },
      joints: {},
    },
    visible: true,
  };

  const displayRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState,
    mergedRobotData: mergeAssembly(assemblyState),
  });

  const leftRootJoint = displayRobot?.joints['__workspace_world__::component::comp_demo'];
  const rightRootJoint = displayRobot?.joints['__workspace_world__::component::comp_other'];

  assert.ok(leftRootJoint, 'expected synthetic root joint for the left component');
  assert.ok(rightRootJoint, 'expected synthetic root joint for the right component');
  assert.ok((leftRootJoint?.origin.xyz.x ?? 0) < 0);
  assert.ok((rightRootJoint?.origin.xyz.x ?? 0) > 0);
  assert.ok(
    (rightRootJoint?.origin.xyz.x ?? 0) < 1,
    `expected compact default placement for the second component, got ${rightRootJoint?.origin.xyz.x ?? 0}`,
  );
});

test('buildWorkspaceAssemblyViewerDisplayRobotData preserves the anchor component when another component has an explicit placement', () => {
  const assemblyState = createAssemblyState('robots/demo/demo.urdf');
  assemblyState.components.comp_other = {
    id: 'comp_other',
    name: 'other',
    sourceFile: 'robots/demo/other.urdf',
    robot: {
      name: 'other',
      rootLinkId: 'comp_other_base_link',
      links: {
        comp_other_base_link: {
          ...DEFAULT_LINK,
          id: 'comp_other_base_link',
          name: 'other_base_link',
        },
      },
      joints: {},
    },
    transform: {
      position: { x: 0.22, y: 0, z: 0.25 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
  };

  const displayRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState,
    mergedRobotData: mergeAssembly(assemblyState),
  });

  const anchorRootJoint = displayRobot?.joints['__workspace_world__::component::comp_demo'];
  const placedRootJoint = displayRobot?.joints['__workspace_world__::component::comp_other'];

  assert.ok(anchorRootJoint, 'expected a synthetic root joint for the anchor component');
  assert.ok(placedRootJoint, 'expected a synthetic root joint for the placed component');
  assertNearlyEqual(
    anchorRootJoint.origin.xyz.x,
    0,
    'anchor component x should remain at the authored origin',
  );
  assertNearlyEqual(
    anchorRootJoint.origin.xyz.y,
    0,
    'anchor component y should remain at the authored origin',
  );
  assertNearlyEqual(
    anchorRootJoint.origin.xyz.z,
    0,
    'anchor component z should remain at the authored origin',
  );
  assertNearlyEqual(
    placedRootJoint.origin.xyz.x,
    0.22,
    'explicit component x placement should pass through unchanged',
  );
  assertNearlyEqual(
    placedRootJoint.origin.xyz.y,
    0,
    'explicit component y placement should pass through unchanged',
  );
  assertNearlyEqual(
    placedRootJoint.origin.xyz.z,
    0.25,
    'explicit component z placement should pass through unchanged',
  );
});

test('buildWorkspaceAssemblyViewerDisplayRobotData does not double-apply isolated component transforms already encoded into the merged robot', () => {
  const assemblyState = createAssemblyState('robots/demo/demo.urdf');
  assemblyState.components.comp_demo.robot.links.base_link = {
    ...assemblyState.components.comp_demo.robot.links.base_link,
    visual: {
      ...assemblyState.components.comp_demo.robot.links.base_link.visual,
      type: GeometryType.BOX,
      dimensions: { x: 0.4, y: 0.3, z: 0.2 },
      origin: {
        xyz: { x: 0, y: 0, z: 0.35 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    },
  };
  assemblyState.components.comp_demo.transform = {
    position: { x: 0, y: 0, z: -0.25 },
    rotation: { r: 0, p: 0, y: 0 },
  };
  assemblyState.components.comp_other = {
    id: 'comp_other',
    name: 'other',
    sourceFile: 'robots/demo/other.urdf',
    robot: {
      name: 'other',
      rootLinkId: 'comp_other_base_link',
      links: {
        comp_other_base_link: {
          ...DEFAULT_LINK,
          id: 'comp_other_base_link',
          name: 'other_base_link',
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.BOX,
            dimensions: { x: 0.2, y: 0.2, z: 0.2 },
            origin: {
              xyz: { x: 0, y: 0, z: 0.4 },
              rpy: { r: 0, p: 0, y: 0 },
            },
          },
        },
      },
      joints: {},
    },
    transform: {
      position: { x: 0.22, y: 0, z: -0.3 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
  };

  const mergedRobotData = buildExportableAssemblyRobotData(assemblyState);
  const displayRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState,
    mergedRobotData,
  });

  const anchorRootJoint = displayRobot?.joints['__workspace_world__::component::comp_demo'];
  const placedRootJoint = displayRobot?.joints['__workspace_world__::component::comp_other'];

  assert.ok(anchorRootJoint, 'expected a synthetic root joint for the first component');
  assert.ok(placedRootJoint, 'expected a synthetic root joint for the second component');
  assertNearlyEqual(
    anchorRootJoint.origin.xyz.z,
    -0.25,
    'first component z should match its authored transform exactly once',
  );
  assertNearlyEqual(
    placedRootJoint.origin.xyz.x,
    0.22,
    'second component x should keep its authored placement',
  );
  assertNearlyEqual(
    placedRootJoint.origin.xyz.z,
    -0.3,
    'second component z should match its authored transform exactly once',
  );
  assertNearlyEqual(
    estimateRobotGroundOffset(displayRobot!),
    0,
    'display robot should already be grounded after composing the workspace view',
  );
});

test('buildWorkspaceAssemblyViewerDisplayRobotData does not inject viewer-only ground lift for identity root components in multi-component mode', () => {
  const assemblyState = createAssemblyState('robots/demo/demo.urdf');
  assemblyState.components.comp_demo.robot.links.base_link = {
    ...assemblyState.components.comp_demo.robot.links.base_link,
    visual: {
      ...assemblyState.components.comp_demo.robot.links.base_link.visual,
      type: GeometryType.BOX,
      dimensions: { x: 0.4, y: 0.3, z: 0.5 },
      origin: {
        xyz: { x: 0, y: 0, z: -0.35 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    },
  };
  assemblyState.components.comp_other = {
    id: 'comp_other',
    name: 'other',
    sourceFile: 'robots/demo/other.urdf',
    robot: {
      name: 'other',
      rootLinkId: 'comp_other_base_link',
      links: {
        comp_other_base_link: {
          ...DEFAULT_LINK,
          id: 'comp_other_base_link',
          name: 'other_base_link',
        },
      },
      joints: {},
    },
    transform: {
      position: { x: 0.22, y: 0, z: 0.25 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
  };

  const displayRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState,
    mergedRobotData: mergeAssembly(assemblyState),
  });

  const anchorRootJoint = displayRobot?.joints['__workspace_world__::component::comp_demo'];
  const placedRootJoint = displayRobot?.joints['__workspace_world__::component::comp_other'];

  assert.ok(anchorRootJoint, 'expected a synthetic root joint for the identity anchor component');
  assert.ok(placedRootJoint, 'expected a synthetic root joint for the explicitly placed component');
  assertNearlyEqual(
    anchorRootJoint.origin.xyz.x,
    0,
    'identity anchor x should remain at the authored origin',
  );
  assertNearlyEqual(
    anchorRootJoint.origin.xyz.y,
    0,
    'identity anchor y should remain at the authored origin',
  );
  assertNearlyEqual(
    anchorRootJoint.origin.xyz.z,
    0,
    'identity anchor z should remain at the authored origin',
  );
  assertNearlyEqual(
    placedRootJoint.origin.xyz.z,
    0.25,
    'explicit component z placement should remain unchanged',
  );
});

test('buildWorkspaceAssemblyViewerDisplayRobotData preserves authored transforms even when component renderable bounds are available', () => {
  const assemblyState = createAssemblyState('robots/demo/demo.urdf');
  assemblyState.components.comp_demo.robot.links.base_link = {
    ...assemblyState.components.comp_demo.robot.links.base_link,
    visual: {
      ...assemblyState.components.comp_demo.robot.links.base_link.visual,
      type: GeometryType.MESH,
      dimensions: { x: 1, y: 1, z: 1 },
      meshPath: 'robots/demo/h1.stl',
    },
    collision: {
      ...assemblyState.components.comp_demo.robot.links.base_link.collision,
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
    },
  };
  (assemblyState.components.comp_demo as any).renderableBounds = {
    min: { x: -0.35, y: -0.2, z: -1.15 },
    max: { x: 0.35, y: 0.2, z: 0.45 },
  };
  assemblyState.components.comp_other = {
    id: 'comp_other',
    name: 'other',
    sourceFile: 'robots/demo/other.urdf',
    robot: {
      name: 'other',
      rootLinkId: 'comp_other_base_link',
      links: {
        comp_other_base_link: {
          ...DEFAULT_LINK,
          id: 'comp_other_base_link',
          name: 'other_base_link',
        },
      },
      joints: {},
    },
    transform: {
      position: { x: 0.22, y: 0, z: 0.25 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
  };

  const displayRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState,
    mergedRobotData: mergeAssembly(assemblyState),
  });

  const anchorRootJoint = displayRobot?.joints['__workspace_world__::component::comp_demo'];
  assert.ok(anchorRootJoint, 'expected a synthetic root joint for the mesh anchor component');
  assertNearlyEqual(
    anchorRootJoint.origin.xyz.z,
    0,
    'mesh anchor should preserve its authored height instead of receiving display-only mesh lift',
  );
});

test('buildWorkspaceAssemblyViewerDisplayRobotData ignores placeholder mesh bounds when real renderable bounds are unavailable', () => {
  const assemblyState = createAssemblyState('robots/demo/demo.urdf');
  assemblyState.components.comp_demo.robot.links.base_link = {
    ...assemblyState.components.comp_demo.robot.links.base_link,
    visual: {
      ...assemblyState.components.comp_demo.robot.links.base_link.visual,
      type: GeometryType.MESH,
      dimensions: { x: 1, y: 1, z: 1 },
      meshPath: 'robots/demo/h1.stl',
    },
    collision: {
      ...assemblyState.components.comp_demo.robot.links.base_link.collision,
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
    },
  };
  assemblyState.components.comp_other = {
    id: 'comp_other',
    name: 'other',
    sourceFile: 'robots/demo/other.urdf',
    robot: {
      name: 'other',
      rootLinkId: 'comp_other_base_link',
      links: {
        comp_other_base_link: {
          ...DEFAULT_LINK,
          id: 'comp_other_base_link',
          name: 'other_base_link',
        },
      },
      joints: {},
    },
    transform: {
      position: { x: 0.22, y: 0, z: 0.25 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
  };

  const displayRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState,
    mergedRobotData: mergeAssembly(assemblyState),
  });

  const anchorRootJoint = displayRobot?.joints['__workspace_world__::component::comp_demo'];
  assert.ok(anchorRootJoint, 'expected a synthetic root joint for the mesh anchor component');
  assertNearlyEqual(
    anchorRootJoint.origin.xyz.z,
    0,
    'mesh anchor should preserve its authored height until real renderable bounds are available',
  );
});

test('buildWorkspaceAssemblyViewerDisplayRobotData preserves aligned transforms for root-link bridges', () => {
  const assemblyState = createAssemblyState('robots/demo/demo.urdf');
  assemblyState.components.comp_other = {
    id: 'comp_other',
    name: 'other',
    sourceFile: 'robots/demo/other.urdf',
    robot: {
      name: 'other',
      rootLinkId: 'comp_other_base_link',
      links: {
        comp_other_base_link: {
          ...DEFAULT_LINK,
          id: 'comp_other_base_link',
          name: 'other_base_link',
        },
      },
      joints: {},
    },
    transform: {
      position: { x: 1.2, y: 0, z: 0.58 },
      rotation: { r: 0, p: 0, y: Math.PI },
    },
    visible: true,
  };
  assemblyState.bridges.bridge_demo = {
    id: 'bridge_demo',
    name: 'bridge_demo',
    parentComponentId: 'comp_demo',
    parentLinkId: 'base_link',
    childComponentId: 'comp_other',
    childLinkId: 'comp_other_base_link',
    joint: {
      id: 'bridge_demo',
      name: 'bridge_demo',
      type: JointType.FIXED,
      parentLinkId: 'base_link',
      childLinkId: 'comp_other_base_link',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
    },
  };

  const displayRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState,
    mergedRobotData: mergeAssembly(assemblyState),
  });

  const parentRootJoint = displayRobot?.joints['__workspace_world__::component::comp_demo'];
  assert.ok(parentRootJoint, 'expected a synthetic root joint for the parent component');
  assert.equal(
    displayRobot?.joints['__workspace_world__::component::comp_other'],
    undefined,
    'root-bridged children should not keep an independent synthetic root joint',
  );
  assert.ok(displayRobot?.joints.bridge_demo, 'expected the committed bridge joint to remain');

  const mergedMatrices = computeLinkWorldMatrices(mergeAssembly(assemblyState));
  const displayMatrices = computeLinkWorldMatrices(displayRobot!);
  const mergedChildMatrix = mergedMatrices.comp_other_base_link;
  const displayChildMatrix = displayMatrices.comp_other_base_link;
  assert.ok(mergedChildMatrix, 'expected a merged world matrix for the bridged child root');
  assert.ok(displayChildMatrix, 'expected a display world matrix for the bridged child root');
  mergedChildMatrix.elements.forEach((element, index) => {
    assertNearlyEqual(
      displayChildMatrix.elements[index] ?? Number.NaN,
      element,
      `root-bridged child matrix element ${index} should match the merged kinematic tree`,
    );
  });
});

test('buildWorkspaceAssemblyViewerDisplayRobotData keeps non-root bridged children attached through the committed bridge joint', () => {
  const assemblyState = createAssemblyState('robots/demo/demo.urdf');
  assemblyState.components.comp_other = {
    id: 'comp_other',
    name: 'other',
    sourceFile: 'robots/demo/other.urdf',
    robot: {
      name: 'other',
      rootLinkId: 'comp_other_base_link',
      links: {
        comp_other_base_link: {
          ...DEFAULT_LINK,
          id: 'comp_other_base_link',
          name: 'other_base_link',
        },
        comp_other_tool_link: {
          ...DEFAULT_LINK,
          id: 'comp_other_tool_link',
          name: 'other_tool_link',
        },
      },
      joints: {
        comp_other_tool_mount: {
          id: 'comp_other_tool_mount',
          name: 'comp_other_tool_mount',
          type: JointType.FIXED,
          parentLinkId: 'comp_other_base_link',
          childLinkId: 'comp_other_tool_link',
          origin: { xyz: { x: 1.2, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          dynamics: { damping: 0, friction: 0 },
          hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
        },
      },
    },
    transform: {
      position: { x: -1.2, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
  };
  assemblyState.bridges.bridge_demo = {
    id: 'bridge_demo',
    name: 'bridge_demo',
    parentComponentId: 'comp_demo',
    parentLinkId: 'base_link',
    childComponentId: 'comp_other',
    childLinkId: 'comp_other_tool_link',
    joint: {
      id: 'bridge_demo',
      name: 'bridge_demo',
      type: JointType.FIXED,
      parentLinkId: 'base_link',
      childLinkId: 'comp_other_tool_link',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
    },
  };

  const displayRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState,
    mergedRobotData: mergeAssembly(assemblyState),
  });

  const anchorRootJoint = displayRobot?.joints['__workspace_world__::component::comp_demo'];

  assert.ok(anchorRootJoint, 'expected a synthetic root joint for the parent component');
  assert.equal(
    displayRobot?.joints['__workspace_world__::component::comp_other'],
    undefined,
    'non-root bridged children should move through the committed bridge joint',
  );
  assert.ok(displayRobot?.joints.bridge_demo, 'expected the committed bridge joint to remain');
  assertNearlyEqual(
    anchorRootJoint.origin.xyz.x,
    0,
    'parent component should stay anchored at the origin',
  );

  const mergedMatrices = computeLinkWorldMatrices(mergeAssembly(assemblyState));
  const displayMatrices = computeLinkWorldMatrices(displayRobot!);
  const mergedChildMatrix = mergedMatrices.comp_other_tool_link;
  const displayChildMatrix = displayMatrices.comp_other_tool_link;
  assert.ok(mergedChildMatrix, 'expected a merged world matrix for the bridged child link');
  assert.ok(displayChildMatrix, 'expected a display world matrix for the bridged child link');
  mergedChildMatrix.elements.forEach((element, index) => {
    assertNearlyEqual(
      displayChildMatrix.elements[index] ?? Number.NaN,
      element,
      `non-root bridged child matrix element ${index} should match the merged kinematic tree`,
    );
  });
});

test('buildWorkspaceAssemblyViewerDisplayRobotData keeps committed bridged components on the merged kinematic tree', () => {
  const assemblyState: AssemblyState = {
    name: 'kinematic_bridge_workspace',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      comp_parent: {
        id: 'comp_parent',
        name: 'parent',
        sourceFile: 'robots/demo/parent.urdf',
        robot: {
          name: 'parent',
          rootLinkId: 'comp_parent_base_link',
          links: {
            comp_parent_base_link: {
              ...DEFAULT_LINK,
              id: 'comp_parent_base_link',
              name: 'base_link',
            },
            comp_parent_tool_link: {
              ...DEFAULT_LINK,
              id: 'comp_parent_tool_link',
              name: 'tool_link',
            },
          },
          joints: {
            comp_parent_wrist_joint: {
              id: 'comp_parent_wrist_joint',
              name: 'comp_parent_wrist_joint',
              type: JointType.REVOLUTE,
              parentLinkId: 'comp_parent_base_link',
              childLinkId: 'comp_parent_tool_link',
              origin: { xyz: { x: 1, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              axis: { x: 0, y: 0, z: 1 },
              limit: { lower: -Math.PI, upper: Math.PI, effort: 10, velocity: 5 },
              angle: 0,
              dynamics: { damping: 0, friction: 0 },
              hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
            },
          },
        },
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        visible: true,
      },
      comp_child: {
        id: 'comp_child',
        name: 'child',
        sourceFile: 'robots/demo/child.urdf',
        robot: {
          name: 'child',
          rootLinkId: 'comp_child_sensor_link',
          links: {
            comp_child_sensor_link: {
              ...DEFAULT_LINK,
              id: 'comp_child_sensor_link',
              name: 'sensor_link',
            },
          },
          joints: {},
        },
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        visible: true,
      },
    },
    bridges: {
      bridge_sensor_mount: {
        id: 'bridge_sensor_mount',
        name: 'bridge_sensor_mount',
        parentComponentId: 'comp_parent',
        parentLinkId: 'comp_parent_tool_link',
        childComponentId: 'comp_child',
        childLinkId: 'comp_child_sensor_link',
        joint: {
          id: 'bridge_sensor_mount',
          name: 'bridge_sensor_mount',
          type: JointType.FIXED,
          parentLinkId: 'comp_parent_tool_link',
          childLinkId: 'comp_child_sensor_link',
          origin: { xyz: { x: 0.2, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          dynamics: { damping: 0, friction: 0 },
          hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
        },
      },
    },
  };

  const alignedChildTransform = resolveAlignedAssemblyComponentTransformForBridge(
    assemblyState,
    assemblyState.bridges.bridge_sensor_mount,
  );
  assert.ok(alignedChildTransform, 'expected the child component to receive an aligned transform');
  assemblyState.components.comp_child.transform = alignedChildTransform;

  assemblyState.components.comp_parent.robot.joints.comp_parent_wrist_joint.angle = Math.PI / 2;

  const mergedRobot = mergeAssembly(assemblyState);
  const displayRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState,
    mergedRobotData: mergedRobot,
  });

  assert.ok(displayRobot, 'expected a workspace display robot');
  assert.equal(
    displayRobot?.joints[`${WORKSPACE_VIEWER_COMPONENT_ROOT_JOINT_PREFIX}comp_child`],
    undefined,
    'committed bridged child components should not keep an independent synthetic root joint',
  );

  const mergedMatrices = computeLinkWorldMatrices(mergedRobot);
  const displayMatrices = computeLinkWorldMatrices(displayRobot!);

  const mergedChildMatrix = mergedMatrices.comp_child_sensor_link;
  const displayChildMatrix = displayMatrices.comp_child_sensor_link;

  assert.ok(mergedChildMatrix, 'expected a merged world matrix for the bridged child link');
  assert.ok(displayChildMatrix, 'expected a display world matrix for the bridged child link');

  mergedChildMatrix.elements.forEach((element, index) => {
    assertNearlyEqual(
      displayChildMatrix.elements[index] ?? Number.NaN,
      element,
      `bridged child matrix element ${index} should match the merged kinematic tree`,
    );
  });
});

test('buildWorkspaceAssemblyViewerDisplayRobotData keeps complex non-root child-link bridges visually aligned for go2', () => {
  const source = fs.readFileSync(GO2_URDF_PATH, 'utf8');
  const robot = parseURDF(source);
  assert.ok(robot, 'expected go2 URDF to parse');

  const identityTransform = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { r: 0, p: 0, y: 0 },
  };

  const assemblyState: AssemblyState = {
    name: 'go2_workspace',
    transform: identityTransform,
    components: {
      comp_parent: {
        id: 'comp_parent',
        name: 'go2_description',
        sourceFile: 'go2_description/urdf/go2_description.urdf',
        robot: prepareAssemblyRobotData(robot, {
          componentId: 'comp_parent',
          rootName: 'go2_description',
        }),
        transform: identityTransform,
        visible: true,
      },
      comp_child: {
        id: 'comp_child',
        name: 'go2_description_1',
        sourceFile: 'go2_description/urdf/go2_description.urdf',
        robot: prepareAssemblyRobotData(robot, {
          componentId: 'comp_child',
          rootName: 'go2_description_1',
        }),
        transform: identityTransform,
        visible: true,
      },
    },
    bridges: {},
  };

  const bridge = {
    id: 'bridge_demo',
    name: 'bridge_demo',
    parentComponentId: 'comp_parent',
    parentLinkId: 'comp_parent_base',
    childComponentId: 'comp_child',
    childLinkId: 'comp_child_FL_foot',
    joint: {
      id: 'bridge_demo',
      name: 'bridge_demo',
      type: JointType.FIXED,
      parentLinkId: 'comp_parent_base',
      childLinkId: 'comp_child_FL_foot',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
    },
  } as const;

  assemblyState.bridges.bridge_demo = bridge;
  const alignedTransform = resolveAlignedAssemblyComponentTransformForBridge(assemblyState, bridge);
  assert.ok(alignedTransform, 'expected child component to resolve an aligned transform');
  assemblyState.components.comp_child.transform = alignedTransform;

  const displayRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState,
    mergedRobotData: mergeAssembly(assemblyState),
  });
  const displayMatrices = computeLinkWorldMatrices(displayRobot!);
  const parentBaseMatrix = displayMatrices.comp_parent_base;
  const childFootMatrix = displayMatrices.comp_child_FL_foot;

  assert.ok(parentBaseMatrix, 'expected a world matrix for the parent base link');
  assert.ok(childFootMatrix, 'expected a world matrix for the bridged child foot link');
  assertNearlyEqual(
    childFootMatrix.elements[12],
    parentBaseMatrix.elements[12],
    'bridged child foot should stay aligned with the parent base on x',
  );
  assertNearlyEqual(
    childFootMatrix.elements[13],
    parentBaseMatrix.elements[13],
    'bridged child foot should stay aligned with the parent base on y',
  );
  assertNearlyEqual(
    childFootMatrix.elements[14],
    parentBaseMatrix.elements[14],
    'bridged child foot should stay aligned with the parent base on z',
  );
});

test('buildWorkspaceAssemblyViewerDisplayRobotData reuses component link and joint references for viewer display', () => {
  const assemblyState = createAssemblyState('robots/demo/demo.urdf');
  assemblyState.components.comp_demo.robot.joints = {
    comp_demo_joint: {
      id: 'comp_demo_joint',
      name: 'comp_demo_joint',
      type: JointType.FIXED,
      parentLinkId: 'base_link',
      childLinkId: 'tool_link',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      axis: { x: 0, y: 0, z: 1 },
      limit: { lower: 0, upper: 0, effort: 0, velocity: 0 },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
    },
  };

  const displayRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState,
    mergedRobotData: assemblyState.components.comp_demo.robot,
  });

  assert.ok(displayRobot);
  assert.equal(
    displayRobot?.links.base_link,
    assemblyState.components.comp_demo.robot.links.base_link,
  );
  assert.equal(
    displayRobot?.joints.comp_demo_joint,
    assemblyState.components.comp_demo.robot.joints.comp_demo_joint,
  );
});

test('prepareAssemblyRobotData and workspace display preserve MJCF inspection context and closed-loop metadata', () => {
  const sourceRobot: RobotData = {
    name: 'cassie',
    links: {
      base_link: { ...DEFAULT_LINK, id: 'base_link', name: 'base_link' },
      foot_link: { ...DEFAULT_LINK, id: 'foot_link', name: 'foot_link' },
    },
    joints: {
      knee_joint: {
        ...DEFAULT_JOINT,
        id: 'knee_joint',
        name: 'knee_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'foot_link',
      },
    },
    rootLinkId: 'base_link',
    materials: {
      base_link: { color: '#336699' },
    },
    closedLoopConstraints: [
      {
        id: 'connect_loop',
        type: 'connect',
        linkAId: 'base_link',
        linkBId: 'foot_link',
        anchorLocalA: { x: 0, y: 0, z: 0 },
        anchorLocalB: { x: 0, y: 0, z: 0 },
        anchorWorld: { x: 0, y: 0, z: 0 },
      },
    ],
    inspectionContext: {
      sourceFormat: 'mjcf',
      mjcf: {
        siteCount: 2,
        tendonCount: 1,
        tendonActuatorCount: 1,
        bodiesWithSites: [],
        tendons: [],
      },
    },
  };

  const preparedRobot = prepareAssemblyRobotData(sourceRobot, {
    componentId: 'comp_cassie',
    rootName: 'cassie',
    sourceFilePath: 'test/mujoco_menagerie-main/agility_cassie/cassie.xml',
    sourceFormat: 'mjcf',
  });

  assert.equal(preparedRobot.inspectionContext?.sourceFormat, 'mjcf');
  assert.equal(preparedRobot.closedLoopConstraints?.length, 1);

  const assemblyState: AssemblyState = {
    name: 'cassie_workspace',
    components: {
      comp_cassie: {
        id: 'comp_cassie',
        name: 'cassie',
        sourceFile: 'test/mujoco_menagerie-main/agility_cassie/cassie.xml',
        robot: preparedRobot,
      },
    },
    bridges: {},
  };

  const mergedRobot = mergeAssembly(assemblyState);
  const displayRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState,
    mergedRobotData: mergedRobot,
  });

  assert.equal(mergedRobot.inspectionContext?.sourceFormat, 'mjcf');
  assert.equal(mergedRobot.closedLoopConstraints?.length, 1);
  assert.equal(displayRobot?.inspectionContext?.sourceFormat, 'mjcf');
  assert.equal(displayRobot?.closedLoopConstraints?.length, 1);
  assert.equal(displayRobot?.materials?.comp_cassie_base_link?.color, '#336699');
});

test('shouldReseedSingleComponentAssemblyFromActiveFile detects a stale single-component assembly seed', () => {
  assert.equal(
    shouldReseedSingleComponentAssemblyFromActiveFile({
      assemblyState: createAssemblyState('robots/demo/left_hand.xml'),
      activeFile: createMjcfFile('robots/demo/scene_left.xml'),
    }),
    true,
  );
});

test('shouldReseedSingleComponentAssemblyFromActiveFile seeds initial and empty assemblies', () => {
  assert.equal(
    shouldReseedSingleComponentAssemblyFromActiveFile({
      assemblyState: null,
      activeFile: createMjcfFile('robots/demo/left_hand.xml'),
    }),
    true,
  );

  assert.equal(
    shouldReseedSingleComponentAssemblyFromActiveFile({
      assemblyState: {
        name: 'demo_project',
        components: {},
        bridges: {},
      },
      activeFile: createMjcfFile('robots/demo/left_hand.xml'),
    }),
    true,
  );
});

test('shouldReseedSingleComponentAssemblyFromActiveFile ignores matching sources and non-editable files', () => {
  assert.equal(
    shouldReseedSingleComponentAssemblyFromActiveFile({
      assemblyState: createAssemblyState('robots/demo/scene_left.xml'),
      activeFile: createMjcfFile('robots/demo/scene_left.xml'),
    }),
    false,
  );

  assert.equal(
    shouldReseedSingleComponentAssemblyFromActiveFile({
      assemblyState: createAssemblyState('robots/demo/scene_left.xml'),
      activeFile: {
        name: 'robots/demo/hand_mesh.obj',
        format: 'mesh',
        content: '',
      },
    }),
    false,
  );
});

test('shouldReseedSingleComponentAssemblyFromActiveFile preserves real assemblies', () => {
  const assemblyState = createAssemblyState('robots/demo/left_hand.xml');
  assemblyState.bridges.bridge_1 = {
    id: 'bridge_1',
    name: 'bridge_1',
    parentComponentId: 'comp_demo',
    parentLinkId: 'base_link',
    childComponentId: 'comp_demo',
    childLinkId: 'base_link',
    joint: {
      id: 'joint_1',
      name: 'joint_1',
      type: JointType.FIXED,
      parentLinkId: 'base_link',
      childLinkId: 'base_link',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
    },
  };

  assert.equal(
    shouldReseedSingleComponentAssemblyFromActiveFile({
      assemblyState,
      activeFile: createMjcfFile('robots/demo/scene_left.xml'),
    }),
    false,
  );
});

test('shouldReuseSourceViewerForSingleComponentAssembly keeps pristine single-component seeds on the current file scene', () => {
  assert.equal(
    shouldReuseSourceViewerForSingleComponentAssembly({
      assemblyState: createSeededSingleComponentAssemblyState('robots/demo/demo.urdf'),
      activeFile: createUrdfFile('robots/demo/demo.urdf'),
      sourceSnapshot: createRobotSourceSnapshot(createRobotState()),
    }),
    true,
  );
});

test('shouldReuseSourceViewerForSingleComponentAssembly reuses pristine USD seeds that require assembly preparation normalization', () => {
  const sourceRobot = createRobotState();
  sourceRobot.links.base_link = {
    ...sourceRobot.links.base_link,
    visual: {
      ...sourceRobot.links.base_link.visual,
      type: GeometryType.MESH,
      meshPath: 'meshes/demo_part.usd',
      dimensions: { x: 1, y: 1, z: 1 },
    },
  };

  const assemblyState: AssemblyState = {
    name: 'demo_project',
    components: {
      comp_demo: {
        id: 'comp_demo',
        name: 'demo',
        sourceFile: 'robots/demo/demo.usd',
        robot: prepareAssemblyRobotData(sourceRobot, {
          componentId: 'comp_demo',
          rootName: 'demo',
          sourceFilePath: 'robots/demo/demo.usd',
          sourceFormat: 'usd',
        }),
        visible: true,
      },
    },
    bridges: {},
  };

  assert.equal(
    shouldReuseSourceViewerForSingleComponentAssembly({
      assemblyState,
      activeFile: createUsdFile('robots/demo/demo.usd'),
      sourceSnapshot: createRobotSourceSnapshot(sourceRobot),
    }),
    true,
  );
});

test('shouldReuseSourceViewerForSingleComponentAssembly prefers prepared USD robot data when the live source snapshot differs', () => {
  const liveSourceRobot = createRobotState();
  const preparedSourceRobot = createRobotState();

  preparedSourceRobot.links.base_link = {
    ...preparedSourceRobot.links.base_link,
    visual: {
      ...preparedSourceRobot.links.base_link.visual,
      type: GeometryType.MESH,
      meshPath: 'meshes/demo_part.usd',
      dimensions: { x: 1, y: 1, z: 1 },
    },
  };

  const assemblyState: AssemblyState = {
    name: 'demo_project',
    components: {
      comp_demo: {
        id: 'comp_demo',
        name: 'demo',
        sourceFile: 'robots/demo/demo.usd',
        robot: prepareAssemblyRobotData(preparedSourceRobot, {
          componentId: 'comp_demo',
          rootName: 'demo',
          sourceFilePath: 'robots/demo/demo.usd',
          sourceFormat: 'usd',
        }),
        visible: true,
      },
    },
    bridges: {},
  };

  assert.equal(
    shouldReuseSourceViewerForSingleComponentAssembly({
      assemblyState,
      activeFile: createUsdFile('robots/demo/demo.usd'),
      sourceSnapshot: createRobotSourceSnapshot(liveSourceRobot),
      sourceRobotData: preparedSourceRobot,
    }),
    true,
  );
});

test('shouldReuseSourceViewerForSingleComponentAssembly stops reusing the current file scene once the single-component source diverges structurally', () => {
  const renamedAssembly = createSeededSingleComponentAssemblyState('robots/demo/demo.urdf');
  renamedAssembly.components.comp_demo.name = 'demo_variant';

  assert.equal(
    shouldReuseSourceViewerForSingleComponentAssembly({
      assemblyState: renamedAssembly,
      activeFile: createUrdfFile('robots/demo/demo.urdf'),
      sourceSnapshot: createRobotSourceSnapshot(createRobotState()),
    }),
    false,
  );

  const mutatedAssembly = createSeededSingleComponentAssemblyState('robots/demo/demo.urdf');
  mutatedAssembly.components.comp_demo.robot.joints.comp_demo_joint_a.origin.xyz.x = 0.25;

  assert.equal(
    shouldReuseSourceViewerForSingleComponentAssembly({
      assemblyState: mutatedAssembly,
      activeFile: createUrdfFile('robots/demo/demo.urdf'),
      sourceSnapshot: createRobotSourceSnapshot(createRobotState()),
    }),
    false,
  );

  const translatedAssembly = createSeededSingleComponentAssemblyState('robots/demo/demo.urdf');
  translatedAssembly.transform = {
    position: { x: 1, y: 0, z: 0 },
    rotation: { r: 0, p: 0, y: 0 },
  };

  assert.equal(
    shouldReuseSourceViewerForSingleComponentAssembly({
      assemblyState: translatedAssembly,
      activeFile: createUrdfFile('robots/demo/demo.urdf'),
      sourceSnapshot: createRobotSourceSnapshot(createRobotState()),
    }),
    false,
  );
});

test('shouldReuseSourceViewerForSingleComponentAssembly keeps the current file scene for isolated single-component transforms', () => {
  const rotatedComponentAssembly =
    createSeededSingleComponentAssemblyState('robots/demo/demo.urdf');
  rotatedComponentAssembly.components.comp_demo.transform = {
    position: { x: 0.15, y: -0.05, z: 0.25 },
    rotation: { r: 0, p: 0, y: 0.35 },
  };

  assert.equal(
    shouldReuseSourceViewerForSingleComponentAssembly({
      assemblyState: rotatedComponentAssembly,
      activeFile: createUrdfFile('robots/demo/demo.urdf'),
      sourceSnapshot: createRobotSourceSnapshot(createRobotState()),
    }),
    true,
  );
});

test('shouldPromptGenerateWorkspaceUrdfOnStructureSwitch ignores isolated seeded component transforms', () => {
  const pristineAssembly = createSeededSingleComponentAssemblyState('robots/demo/demo.urdf');
  const translatedAssembly = createSeededSingleComponentAssemblyState('robots/demo/demo.urdf');
  translatedAssembly.components.comp_demo.transform = {
    position: { x: 0.15, y: -0.05, z: 0.25 },
    rotation: { r: 0, p: 0, y: 0.35 },
  };

  assert.equal(
    shouldPromptGenerateWorkspaceUrdfOnStructureSwitch({
      assemblyState: translatedAssembly,
      activeFile: createUrdfFile('robots/demo/demo.urdf'),
      sourceSnapshot: createRobotSourceSnapshot(createRobotState()),
      baselineSnapshot: createStructureSwitchBaselineSnapshot(pristineAssembly),
    }),
    false,
  );
});

test('shouldPromptGenerateWorkspaceUrdfOnStructureSwitch still flags structural single-component edits', () => {
  const pristineAssembly = createSeededSingleComponentAssemblyState('robots/demo/demo.urdf');
  const mutatedAssembly = createSeededSingleComponentAssemblyState('robots/demo/demo.urdf');
  mutatedAssembly.components.comp_demo.robot.joints.comp_demo_joint_a.origin.xyz.x = 0.25;

  assert.equal(
    shouldPromptGenerateWorkspaceUrdfOnStructureSwitch({
      assemblyState: mutatedAssembly,
      activeFile: createUrdfFile('robots/demo/demo.urdf'),
      sourceSnapshot: createRobotSourceSnapshot(createRobotState()),
      baselineSnapshot: createStructureSwitchBaselineSnapshot(pristineAssembly),
    }),
    true,
  );
});

test('shouldPromptGenerateWorkspaceUrdfOnStructureSwitch keeps assembly-level transform changes confirmable', () => {
  const pristineAssembly = createSeededSingleComponentAssemblyState('robots/demo/demo.urdf');
  const translatedAssembly = createSeededSingleComponentAssemblyState('robots/demo/demo.urdf');
  translatedAssembly.transform = {
    position: { x: 1, y: 0, z: 0 },
    rotation: { r: 0, p: 0, y: 0 },
  };

  assert.equal(
    shouldPromptGenerateWorkspaceUrdfOnStructureSwitch({
      assemblyState: translatedAssembly,
      activeFile: createUrdfFile('robots/demo/demo.urdf'),
      sourceSnapshot: createRobotSourceSnapshot(createRobotState()),
      baselineSnapshot: createStructureSwitchBaselineSnapshot(pristineAssembly),
    }),
    true,
  );
});

test('shouldKeepPristineSingleComponentWorkspaceOnSourceViewer keeps the current file scene while assembly-level transforms stay inactive', () => {
  assert.equal(
    shouldKeepPristineSingleComponentWorkspaceOnSourceViewer({
      assemblyState: createSeededSingleComponentAssemblyState('robots/demo/demo.urdf'),
      activeFile: createUrdfFile('robots/demo/demo.urdf'),
      sourceSnapshot: createRobotSourceSnapshot(createRobotState()),
      assemblySelectionType: null,
    }),
    true,
  );
});

test('shouldKeepPristineSingleComponentWorkspaceOnSourceViewer keeps component selections on the current file scene', () => {
  assert.equal(
    shouldKeepPristineSingleComponentWorkspaceOnSourceViewer({
      assemblyState: createSeededSingleComponentAssemblyState('robots/demo/demo.urdf'),
      activeFile: createUrdfFile('robots/demo/demo.urdf'),
      sourceSnapshot: createRobotSourceSnapshot(createRobotState()),
      assemblySelectionType: 'component',
    }),
    true,
  );
});

test('shouldKeepPristineSingleComponentWorkspaceOnSourceViewer still hands assembly-level transforms to the workspace viewer', () => {
  assert.equal(
    shouldKeepPristineSingleComponentWorkspaceOnSourceViewer({
      assemblyState: createSeededSingleComponentAssemblyState('robots/demo/demo.urdf'),
      activeFile: createUrdfFile('robots/demo/demo.urdf'),
      sourceSnapshot: createRobotSourceSnapshot(createRobotState()),
      assemblySelectionType: 'assembly',
    }),
    false,
  );
});

test('buildWorkspaceViewerRobotData keeps single-root robots unchanged', () => {
  const robot: RobotData = {
    name: 'single-root',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
    },
    joints: {},
  };

  assert.equal(buildWorkspaceViewerRobotData(robot), robot);
});

test('buildWorkspaceViewerRobotData adds a synthetic world root for disconnected models', () => {
  const robot: RobotData = {
    name: 'merged',
    rootLinkId: 'left_base',
    links: {
      left_base: {
        ...DEFAULT_LINK,
        id: 'left_base',
        name: 'left_base',
      },
      left_tool: {
        ...DEFAULT_LINK,
        id: 'left_tool',
        name: 'left_tool',
      },
      right_base: {
        ...DEFAULT_LINK,
        id: 'right_base',
        name: 'right_base',
      },
    },
    joints: {
      left_fixed: {
        id: 'left_fixed',
        name: 'left_fixed',
        type: JointType.FIXED,
        parentLinkId: 'left_base',
        childLinkId: 'left_tool',
        origin: { xyz: { x: 0.25, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
  };

  const viewerRobot = buildWorkspaceViewerRobotData(robot);

  assert.equal(viewerRobot.rootLinkId, '__workspace_world__');
  assert.equal(viewerRobot.links.__workspace_world__?.name, 'world');
  assert.equal(viewerRobot.links.__workspace_world__?.visual.type, GeometryType.NONE);
  assert.equal(viewerRobot.links.__workspace_world__?.collision.type, GeometryType.NONE);

  const syntheticJoints = Object.values(viewerRobot.joints).filter(
    (joint) => joint.parentLinkId === '__workspace_world__',
  );

  assert.equal(syntheticJoints.length, 2);
  assert.deepEqual(syntheticJoints.map((joint) => joint.childLinkId).sort(), [
    'left_base',
    'right_base',
  ]);

  const rootOffsets = syntheticJoints
    .map((joint) => joint.origin.xyz.x)
    .sort((left, right) => left - right);

  assert.ok(rootOffsets[0] < 0);
  assert.ok(rootOffsets[1] > 0);
  assert.ok(rootOffsets[0] > -0.8 && rootOffsets[0] < -0.45);
  assert.ok(rootOffsets[1] > 0.35 && rootOffsets[1] < 0.65);
  assert.ok(rootOffsets[1] - rootOffsets[0] < 1.25);
});

test('createPreviewRobotState resolves editable files into a selection-free preview robot', () => {
  const previewRobot = createPreviewRobotState(createUrdfFile(), {
    availableFiles: [],
  });

  assert.ok(previewRobot);
  assert.equal(previewRobot?.selection.type, null);
  assert.equal(previewRobot?.selection.id, null);
  assert.equal(previewRobot?.name, 'demo');
});

test('createPreviewRobotState resolves xacro files into a selection-free preview robot', () => {
  const file = createXacroFile();
  const previewRobot = createPreviewRobotState(file, {
    availableFiles: [file],
  });

  assert.ok(previewRobot);
  assert.equal(previewRobot?.selection.type, null);
  assert.equal(previewRobot?.selection.id, null);
  assert.equal(previewRobot?.name, 'demo');
  assert.ok(previewRobot?.links.base_link);
});

test('createPreviewRobotState falls back to a USD placeholder when hydration data is unavailable', () => {
  const previewRobot = createPreviewRobotState(createUsdFile('robots/demo/scene.usdz'), {
    availableFiles: [],
  });

  assert.ok(previewRobot);
  assert.equal(previewRobot?.name, 'scene');
  assert.equal(previewRobot?.rootLinkId, 'usd_scene_root');
  assert.equal(previewRobot?.links.usd_scene_root?.visual.type, GeometryType.NONE);
});

test('createPreviewRobotStateFromImportResult converts ready worker results into preview state', () => {
  const previewRobot = createPreviewRobotStateFromImportResult(createUrdfFile(), {
    status: 'ready',
    format: 'urdf',
    robotData: {
      name: 'demo',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
        },
      },
      joints: {},
    },
    resolvedUrdfContent: '<robot name="demo"><link name="base_link" /></robot>',
    resolvedUrdfSourceFilePath: 'robots/demo/demo.urdf',
  });

  assert.ok(previewRobot);
  assert.equal(previewRobot?.selection.type, null);
  assert.equal(previewRobot?.selection.id, null);
  assert.equal(previewRobot?.name, 'demo');
});

test('buildPreviewSceneSourceFromImportResult keeps MJCF source only after a successful import result', () => {
  const mjcfFile = createMjcfFile();
  const previewSource = buildPreviewSceneSourceFromImportResult(mjcfFile, {
    availableFiles: [mjcfFile],
    previewRobot: null,
    importResult: {
      status: 'ready',
      format: 'mjcf',
      robotData: {
        name: 'demo',
        rootLinkId: 'base_link',
        links: {
          base_link: {
            ...DEFAULT_LINK,
            id: 'base_link',
            name: 'base_link',
          },
        },
        joints: {},
      },
      resolvedUrdfContent: null,
      resolvedUrdfSourceFilePath: null,
    },
  });

  assert.ok(previewSource);
  assert.match(previewSource, /<mujoco model="demo">/);
  assert.match(previewSource, /<body name="base_link"\s*\/>/);
});

test('buildPreviewSceneSourceFromImportResult returns an empty preview for MJCF parse failures', () => {
  const mjcfFile = createMjcfFile();

  assert.equal(
    buildPreviewSceneSourceFromImportResult(mjcfFile, {
      availableFiles: [mjcfFile],
      previewRobot: null,
      importResult: {
        status: 'error',
        format: 'mjcf',
        reason: 'parse_failed',
      },
    }),
    '',
  );
});

test('buildPreviewSceneSourceFromImportResult suppresses viewer preview for source-only MJCF fragments', () => {
  const mjcfFile = createMjcfFile('robots/demo/keyframes.xml');

  assert.equal(
    buildPreviewSceneSourceFromImportResult(mjcfFile, {
      availableFiles: [mjcfFile],
      previewRobot: null,
      importResult: {
        status: 'error',
        format: 'mjcf',
        reason: 'source_only_fragment',
      },
    }),
    null,
  );
});

test('getPreferredMjcfContent keeps the imported MJCF before viewer edits', () => {
  assert.equal(
    getPreferredMjcfContent({
      sourceContent: '<mujoco model="cassie-source"/>',
      generatedContent: '<mujoco model="cassie-generated"/>',
      hasViewerEdits: false,
    }),
    '<mujoco model="cassie-source"/>',
  );
});

test('getPreferredMjcfContent keeps the imported MJCF after viewer edits when source is available', () => {
  assert.equal(
    getPreferredMjcfContent({
      sourceContent: '<mujoco model="cassie-source"/>',
      generatedContent: '<mujoco model="cassie-generated"/>',
      hasViewerEdits: true,
    }),
    '<mujoco model="cassie-source"/>',
  );
});

test('getPreferredSdfContent keeps the imported SDF before store edits', () => {
  assert.equal(
    getPreferredSdfContent({
      fileContent: '<sdf version="1.7"><model name="source"/></sdf>',
      generatedContent: '<sdf version="1.7"><model name="generated"/></sdf>',
      hasStoreEdits: false,
    }),
    '<sdf version="1.7"><model name="source"/></sdf>',
  );
});

test('getPreferredSdfContent switches to generated SDF after store edits', () => {
  assert.equal(
    getPreferredSdfContent({
      fileContent: '<sdf version="1.7"><model name="source"/></sdf>',
      generatedContent: '<sdf version="1.7"><model name="generated"/></sdf>',
      hasStoreEdits: true,
    }),
    '<sdf version="1.7"><model name="generated"/></sdf>',
  );
});

test('getPreferredXacroContent keeps the imported xacro before store edits', () => {
  assert.equal(
    getPreferredXacroContent({
      fileContent: '<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="source"/>',
      originalContent: '<robot name="fallback"/>',
      generatedContent: '<robot name="generated"/>',
      hasStoreEdits: false,
    }),
    '<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="source"/>',
  );
});

test('getPreferredXacroContent switches to generated XML after store edits', () => {
  assert.equal(
    getPreferredXacroContent({
      fileContent: '<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="source"/>',
      originalContent: '<robot name="fallback"/>',
      generatedContent: '<robot name="generated"/>',
      hasStoreEdits: true,
    }),
    '<robot name="generated"/>',
  );
});
