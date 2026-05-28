import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LINK, GeometryType, JointType, type RobotData } from '@/types';
import {
  buildAssemblyComponentIdentity,
  namespaceAssemblyRobotData,
  prepareAssemblyRobotData,
  resolveAssemblyComponentBaseName,
} from './assemblyComponentPreparation.ts';
import { isSyntheticWorldRoot } from './treeRoots.ts';

test('buildAssemblyComponentIdentity creates a stable unique component id and display name', () => {
  const identity = buildAssemblyComponentIdentity({
    fileName: 'robots/demo/my robot.urdf',
    existingComponentIds: new Set(['comp_my_robot']),
    existingComponentNames: new Set(['my_robot']),
  });

  assert.equal(identity.displayName, 'my_robot_1');
  assert.equal(identity.componentId, 'comp_my_robot_1');
});

test('buildAssemblyComponentIdentity uses model package names for generic model files', () => {
  const identity = buildAssemblyComponentIdentity({
    fileName: 'test/gazebo_models/arm_part/model.sdf',
    existingComponentIds: new Set(['comp_arm_part']),
    existingComponentNames: new Set(['arm_part']),
  });

  assert.equal(identity.displayName, 'arm_part_1');
  assert.equal(identity.componentId, 'comp_arm_part_1');
});

test('resolveAssemblyComponentBaseName prefers the authored source model name', () => {
  const name = resolveAssemblyComponentBaseName({
    name: 'test/gazebo_models/arm_part/model.sdf',
    format: 'sdf',
    content: `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="arm_part">
    <link name="link" />
  </model>
</sdf>`,
  });

  assert.equal(name, 'arm_part');
});

test('namespaceAssemblyRobotData prefixes links, joints, and materials for assembly components', () => {
  const robotData: RobotData = {
    name: 'demo_robot',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      tool_link: {
        ...DEFAULT_LINK,
        id: 'tool_link',
        name: 'tool_link',
      },
    },
    joints: {
      wrist_joint: {
        id: 'wrist_joint',
        name: 'wrist_joint',
        type: JointType.FIXED,
        parentLinkId: 'base_link',
        childLinkId: 'tool_link',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: 0, upper: 0, effort: 0, velocity: 0 },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
    materials: {
      base_link: {
        color: '#ff6600',
      },
    },
  };

  const namespaced = namespaceAssemblyRobotData(robotData, {
    componentId: 'comp_demo',
    rootName: 'demo',
  });

  assert.equal(namespaced.rootLinkId, 'comp_demo_base_link');
  assert.ok(namespaced.links.comp_demo_base_link);
  assert.ok(namespaced.links.comp_demo_tool_link);
  assert.equal(namespaced.links.comp_demo_base_link.name, 'demo');
  assert.equal(namespaced.links.comp_demo_tool_link.name, 'demo_tool_link');
  assert.equal(namespaced.joints.comp_demo_wrist_joint.parentLinkId, 'comp_demo_base_link');
  assert.equal(namespaced.joints.comp_demo_wrist_joint.childLinkId, 'comp_demo_tool_link');
  assert.equal(namespaced.materials?.comp_demo_base_link?.color, '#ff6600');
});

test('namespaceAssemblyRobotData keeps MJCF synthetic world roots transparent after namespacing', () => {
  const robotData: RobotData = {
    name: 'T1',
    rootLinkId: 'world',
    links: {
      world: {
        ...DEFAULT_LINK,
        id: 'world',
        name: 'world',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.NONE,
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
        },
        inertial: {
          ...DEFAULT_LINK.inertial,
          mass: 0,
        },
      },
      Trunk: {
        ...DEFAULT_LINK,
        id: 'Trunk',
        name: 'Trunk',
      },
    },
    joints: {
      joint_0: {
        id: 'joint_0',
        name: 'joint_0',
        type: JointType.FLOATING,
        parentLinkId: 'world',
        childLinkId: 'Trunk',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: 0, upper: 0, effort: 0, velocity: 0 },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
    inspectionContext: {
      sourceFormat: 'mjcf',
    },
  };

  const namespaced = namespaceAssemblyRobotData(robotData, {
    componentId: 'comp_t1',
    rootName: 't1',
  });

  assert.equal(namespaced.links.comp_t1_world.name, 'world');
  assert.equal(
    isSyntheticWorldRoot(
      {
        ...namespaced,
        selection: { type: null, id: null },
      },
      namespaced.rootLinkId,
    ),
    true,
  );
});

test('namespaceAssemblyRobotData rewrites mimic joint targets for assembly components', () => {
  const robotData: RobotData = {
    name: 'gripper',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      left_finger: {
        ...DEFAULT_LINK,
        id: 'left_finger',
        name: 'left_finger',
      },
      right_finger: {
        ...DEFAULT_LINK,
        id: 'right_finger',
        name: 'right_finger',
      },
    },
    joints: {
      joint7: {
        id: 'joint7',
        name: 'joint7',
        type: JointType.PRISMATIC,
        parentLinkId: 'base_link',
        childLinkId: 'left_finger',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: 0, upper: 0.035, effort: 1, velocity: 1 },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
      joint8: {
        id: 'joint8',
        name: 'joint8',
        type: JointType.PRISMATIC,
        parentLinkId: 'base_link',
        childLinkId: 'right_finger',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: -1 },
        limit: { lower: -0.035, upper: 0, effort: 1, velocity: 1 },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
        mimic: {
          joint: 'joint7',
          multiplier: -1,
          offset: 0,
        },
      },
    },
  };

  const namespaced = namespaceAssemblyRobotData(robotData, {
    componentId: 'comp_piper',
    rootName: 'piper',
  });

  assert.equal(namespaced.joints.comp_piper_joint8.mimic?.joint, 'comp_piper_joint7');
});

test('prepareAssemblyRobotData rewrites USD mesh paths before namespacing', () => {
  const robotData: RobotData = {
    name: 'go2',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'base_link_visual_0.obj',
        },
      },
    },
    joints: {},
  };

  const prepared = prepareAssemblyRobotData(robotData, {
    componentId: 'comp_go2',
    rootName: 'go2',
    sourceFilePath: 'robots/go2/usd/go2.usd',
    sourceFormat: 'usd',
  });

  assert.equal(prepared.rootLinkId, 'comp_go2_base_link');
  assert.equal(
    prepared.links.comp_go2_base_link.visual.meshPath,
    'robots/go2/usd/base_link_visual_0.obj',
  );
});
