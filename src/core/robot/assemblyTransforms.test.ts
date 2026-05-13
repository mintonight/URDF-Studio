import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  type AssemblyComponent,
  type AssemblyState,
  type RobotData,
} from '@/types';

import {
  buildExportableAssemblyRobotData,
  isAssemblyComponentIndividuallyTransformable,
} from './assemblyTransforms.ts';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach((entry) => {
      deepFreeze(entry);
    });
  }

  return value;
}

function createRobotData(rootId: string, rootName: string): RobotData {
  return {
    name: rootName,
    rootLinkId: rootId,
    links: {
      [rootId]: {
        ...DEFAULT_LINK,
        id: rootId,
        name: rootName,
      },
    },
    joints: {},
  };
}

function createComponent(id: string, name: string, sourceFile: string): AssemblyComponent {
  const rootId = `${id}_base_link`;
  return {
    id,
    name,
    sourceFile,
    robot: createRobotData(rootId, name),
  };
}

function createAssemblyState(): AssemblyState {
  return {
    name: 'demo_workspace',
    transform: {
      position: { x: 10, y: -2, z: 3 },
      rotation: { r: 0, p: 0, y: Math.PI / 4 },
    },
    components: {
      comp_left: {
        ...createComponent('comp_left', 'left_arm', 'robots/left_arm.urdf'),
        transform: {
          position: { x: 2, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: Math.PI / 2 },
        },
      },
      comp_right: createComponent('comp_right', 'right_arm', 'robots/right_arm.urdf'),
    },
    bridges: {},
  };
}

test('isAssemblyComponentIndividuallyTransformable only allows isolated components', () => {
  const assembly = createAssemblyState();

  assert.equal(isAssemblyComponentIndividuallyTransformable(assembly, 'comp_left'), true);
  assert.equal(isAssemblyComponentIndividuallyTransformable(assembly, 'comp_right'), true);

  assembly.bridges.bridge_main = {
    id: 'bridge_main',
    name: 'bridge_main',
    parentComponentId: 'comp_left',
    parentLinkId: 'comp_left_base_link',
    childComponentId: 'comp_right',
    childLinkId: 'comp_right_base_link',
    joint: {
      ...DEFAULT_JOINT,
      id: 'bridge_main_joint',
      name: 'bridge_main_joint',
      type: JointType.FIXED,
      parentLinkId: 'comp_left_base_link',
      childLinkId: 'comp_right_base_link',
    },
  };

  assert.equal(isAssemblyComponentIndividuallyTransformable(assembly, 'comp_left'), false);
  assert.equal(isAssemblyComponentIndividuallyTransformable(assembly, 'comp_right'), false);
});

test('buildExportableAssemblyRobotData wraps isolated components and the whole assembly with fixed joints', () => {
  const assembly = createAssemblyState();

  const exportRobot = buildExportableAssemblyRobotData(assembly);

  assert.ok(exportRobot.links.__assembly_root, 'expected an assembly root wrapper');
  assert.equal(exportRobot.rootLinkId, '__assembly_root');

  const assemblyWrapperJoint = exportRobot.joints.__assembly_root_joint_comp_left;
  assert.ok(assemblyWrapperJoint, 'expected assembly wrapper joint for isolated component root');
  assert.deepEqual(assemblyWrapperJoint.origin.xyz, assembly.transform.position);
  assert.deepEqual(assemblyWrapperJoint.origin.rpy, assembly.transform.rotation);

  const componentWrapperJoint = exportRobot.joints.__assembly_component_joint_comp_left;
  assert.ok(
    componentWrapperJoint,
    'expected component wrapper joint for isolated component transform',
  );
  assert.equal(componentWrapperJoint.childLinkId, 'comp_left_base_link');
  assert.deepEqual(
    componentWrapperJoint.origin.xyz,
    assembly.components.comp_left.transform?.position,
  );
  assert.deepEqual(
    componentWrapperJoint.origin.rpy,
    assembly.components.comp_left.transform?.rotation,
  );

  assert.equal(
    exportRobot.joints.__assembly_root_joint_comp_right.childLinkId,
    'comp_right_base_link',
    'components without explicit transform should still be attached under the assembly root',
  );
});

test('buildExportableAssemblyRobotData unwraps an identity single-component workspace for export', () => {
  const assembly: AssemblyState = {
    name: 'a2',
    components: {
      comp_a2: {
        id: 'comp_a2',
        name: 'a2',
        sourceFile: 'test/unitree_ros/robots/a2_description/a2.xml',
        visible: true,
        robot: {
          name: 'a2',
          rootLinkId: 'comp_a2_world',
          links: {
            comp_a2_world: {
              ...DEFAULT_LINK,
              id: 'comp_a2_world',
              name: 'a2',
            },
            comp_a2_base_link: {
              ...DEFAULT_LINK,
              id: 'comp_a2_base_link',
              name: 'a2_base_link',
            },
          },
          joints: {
            comp_a2_floating_base_joint: {
              ...DEFAULT_JOINT,
              id: 'comp_a2_floating_base_joint',
              name: 'a2_floating_base_joint',
              parentLinkId: 'comp_a2_world',
              childLinkId: 'comp_a2_base_link',
              type: JointType.FLOATING,
              mimic: {
                joint: 'comp_a2_reference_joint',
                multiplier: 1,
                offset: 0,
              },
            },
          },
          materials: {
            comp_a2_base_link: {
              color: '#cad1ee',
            },
          },
          inspectionContext: {
            sourceFormat: 'mjcf',
          },
        },
      },
    },
    bridges: {},
  };

  const exportRobot = buildExportableAssemblyRobotData(assembly);

  assert.equal(exportRobot.name, 'a2');
  assert.equal(exportRobot.rootLinkId, 'world');
  assert.deepEqual(Object.keys(exportRobot.links).sort(), ['base_link', 'world']);
  assert.equal(exportRobot.links.world.name, 'world');
  assert.equal(exportRobot.links.base_link.name, 'base_link');
  assert.deepEqual(Object.keys(exportRobot.joints), ['floating_base_joint']);
  assert.equal(exportRobot.joints.floating_base_joint.parentLinkId, 'world');
  assert.equal(exportRobot.joints.floating_base_joint.childLinkId, 'base_link');
  assert.equal(exportRobot.joints.floating_base_joint.name, 'floating_base_joint');
  assert.equal(exportRobot.joints.floating_base_joint.mimic?.joint, 'reference_joint');
  assert.deepEqual(exportRobot.materials, {
    base_link: {
      color: '#cad1ee',
    },
  });
  assert.equal(exportRobot.inspectionContext?.sourceFormat, 'mjcf');
  assert.equal(
    Object.keys(exportRobot.links).some((linkId) => linkId.startsWith('comp_a2_')),
    false,
  );
});

test('buildExportableAssemblyRobotData does not apply component wrappers to bridged components', () => {
  const assembly = createAssemblyState();
  assembly.bridges.bridge_main = {
    id: 'bridge_main',
    name: 'bridge_main',
    parentComponentId: 'comp_left',
    parentLinkId: 'comp_left_base_link',
    childComponentId: 'comp_right',
    childLinkId: 'comp_right_base_link',
    joint: {
      ...DEFAULT_JOINT,
      id: 'bridge_main_joint',
      name: 'bridge_main_joint',
      type: JointType.FIXED,
      parentLinkId: 'comp_left_base_link',
      childLinkId: 'comp_right_base_link',
    },
  };

  const exportRobot = buildExportableAssemblyRobotData(assembly);

  assert.equal(
    '__assembly_component_joint_comp_left' in exportRobot.joints,
    false,
    'connected components should not keep an individual wrapper joint',
  );
  assert.equal(
    '__assembly_component_joint_comp_right' in exportRobot.joints,
    false,
    'connected components should not keep an individual wrapper joint',
  );
});

test('buildExportableAssemblyRobotData does not mutate frozen assembly component state', () => {
  const assembly = deepFreeze(createAssemblyState());

  const exportRobot = buildExportableAssemblyRobotData(assembly);

  assert.equal(assembly.components.comp_left.robot.rootLinkId, 'comp_left_base_link');
  assert.equal(
    assembly.components.comp_left.robot.links.__assembly_component_root_comp_left,
    undefined,
    'the source assembly component should stay untouched',
  );
  assert.ok(
    exportRobot.links.__assembly_component_root_comp_left,
    'the export result should still include a synthetic wrapper root',
  );
  assert.ok(
    exportRobot.joints.__assembly_component_joint_comp_left,
    'the export result should still include a synthetic wrapper joint',
  );
});
