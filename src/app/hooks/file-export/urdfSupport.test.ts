import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LINK,
  type AssemblyState,
  type RobotClosedLoopConstraint,
  type RobotData,
  type RobotState,
} from '@/types';
import {
  assertAssemblyUrdfExportSupported,
  assertUrdfExportSupported,
  buildAssemblyExportName,
  createBoxFaceTextureFallbackWarnings,
  resolveDisconnectedWorkspaceUrdfAction,
} from './urdfSupport';

const replaceTemplate = (template: string, replacements: Record<string, string | number>) =>
  Object.entries(replacements).reduce(
    (acc, [key, value]) => acc.replace(`{${key}}`, String(value)),
    template,
  );

const robotData: RobotData = {
  name: 'robot',
  links: {
    base: {
      ...DEFAULT_LINK,
      id: 'base',
      name: 'base',
    },
  },
  joints: {},
  rootLinkId: 'base',
};

const closedLoopConstraint: RobotClosedLoopConstraint = {
  id: 'c',
  linkAId: 'a',
  linkBId: 'b',
  type: 'connect',
  anchorWorld: { x: 0, y: 0, z: 0 },
  anchorLocalA: { x: 0, y: 0, z: 0 },
  anchorLocalB: { x: 0, y: 0, z: 0 },
};

const labels = {
  sdf: 'sdf warning {count}',
  urdf: 'urdf warning {count}',
  xacro: 'xacro warning {count}',
};

test('createBoxFaceTextureFallbackWarnings returns replacements and omits zero counts', () => {
  const zero = createBoxFaceTextureFallbackWarnings('urdf', 0, replaceTemplate, labels);
  assert.deepStrictEqual(zero, []);

  const message = createBoxFaceTextureFallbackWarnings('xacro', 2, replaceTemplate, labels);
  assert.deepStrictEqual(message, ['xacro warning 2']);
});

test('assertUrdfExportSupported skips when no closed loops and throws when they exist', () => {
  assert.doesNotThrow(() =>
    assertUrdfExportSupported(
      { name: 'robot', closedLoopConstraints: [] },
      undefined,
      replaceTemplate,
      'Label {name} {count}',
    ),
  );

  const robotWithConstraint: Pick<RobotState, 'name' | 'closedLoopConstraints'> = {
    name: 'robotA',
    closedLoopConstraints: [closedLoopConstraint],
  };

  assert.throws(
    () =>
      assertUrdfExportSupported(
        robotWithConstraint,
        'next',
        replaceTemplate,
        'Label {name} {count}',
      ),
    /next/,
  );
});

test('assertAssemblyUrdfExportSupported throws when any component has a constraint', () => {
  const assembly: AssemblyState = {
    name: 'assembly',
    components: {
      comp: {
        id: 'comp',
        name: 'Component',
        sourceFile: 'file',
        robot: {
          ...robotData,
          closedLoopConstraints: [{ ...closedLoopConstraint, id: 'c2' }],
        },
      },
    },
    bridges: {},
  };

  assert.throws(
    () => assertAssemblyUrdfExportSupported(assembly, replaceTemplate, 'Label {name} {count}'),
    /Component/,
  );
});

test('buildAssemblyExportName derives workspace export names from component names', () => {
  const assembly: AssemblyState = {
    name: 'assembly',
    components: {
      comp_t1: { id: 'comp_t1', name: 't1', sourceFile: 't1.xml', robot: robotData },
      comp_piper: { id: 'comp_piper', name: 'piper', sourceFile: 'piper.xml', robot: robotData },
      comp_hidden: {
        id: 'comp_hidden',
        name: 'hidden',
        sourceFile: 'hidden.xml',
        robot: robotData,
        visible: false,
      },
    },
    bridges: {},
  };

  assert.equal(buildAssemblyExportName(assembly), 't1_piper_hidden');
});

test('resolveDisconnectedWorkspaceUrdfAction only fires for workspace URDF targets with disconnected components', () => {
  const assembly: AssemblyState = {
    name: 'assembly',
    components: {
      c1: { id: 'c1', name: 'C1', sourceFile: 'a', robot: robotData },
      c2: { id: 'c2', name: 'C2', sourceFile: 'b', robot: robotData },
    },
    bridges: {},
  };

  const action = resolveDisconnectedWorkspaceUrdfAction(
    { type: 'current' },
    { format: 'urdf' },
    'workspace',
    assembly,
  );
  assert.strictEqual(action?.type, 'disconnected-workspace-urdf');
  assert.strictEqual(action?.componentCount, 2);
  assert.strictEqual(action?.exportName, 'C1_C2');

  const noAction = resolveDisconnectedWorkspaceUrdfAction(
    { type: 'current' },
    { format: 'sdf' },
    'workspace',
    assembly,
  );
  assert.strictEqual(noAction, null);
});
