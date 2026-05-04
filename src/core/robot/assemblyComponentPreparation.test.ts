import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LINK, GeometryType, JointType, type RobotData } from '@/types';
import {
  buildAssemblyComponentIdentity,
  namespaceAssemblyRobotData,
  prepareAssemblyRobotData,
} from './assemblyComponentPreparation.ts';

test('buildAssemblyComponentIdentity creates a stable unique component id and display name', () => {
  const identity = buildAssemblyComponentIdentity({
    fileName: 'robots/demo/my robot.urdf',
    existingComponentIds: new Set(['comp_my_robot']),
    existingComponentNames: new Set(['my_robot']),
  });

  assert.equal(identity.displayName, 'my_robot_1');
  assert.equal(identity.componentId, 'comp_my_robot_1');
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
