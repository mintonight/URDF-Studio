import assert from 'node:assert/strict';
import test from 'node:test';

import { GeometryType, JointType, type AssemblyState, type RobotState } from '@/types';

import { buildPropertyEditorSelectionContext } from './propertyEditorSelectionContext.ts';

function createRobotState(selectionId: string): RobotState {
  return {
    name: 'workspace',
    rootLinkId: 'base_link',
    selection: { type: 'joint', id: selectionId },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        visualBodies: [],
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
      tip_link: {
        id: 'tip_link',
        name: 'tip_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        visualBodies: [],
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
    },
    joints: {},
  };
}

function createAssemblyState(): AssemblyState {
  return {
    name: 'assembly',
    components: {},
    bridges: {
      bridge_cycle: {
        id: 'bridge_cycle',
        name: 'bridge_cycle',
        parentComponentId: 'left_component',
        parentLinkId: 'base_link',
        childComponentId: 'right_component',
        childLinkId: 'tip_link',
        joint: {
          id: 'bridge_cycle',
          name: 'bridge_cycle',
          type: JointType.FIXED,
          parentLinkId: 'base_link',
          childLinkId: 'tip_link',
          origin: { xyz: { x: 0.1, y: 0.2, z: 0.3 }, rpy: { r: 0, p: 0, y: 0 } },
          dynamics: { damping: 0, friction: 0 },
          hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
        },
      },
    },
  };
}

test('buildPropertyEditorSelectionContext injects a selected closed-loop bridge joint into the editor robot', () => {
  const robot = createRobotState('bridge_cycle');
  const assemblyState = createAssemblyState();

  const context = buildPropertyEditorSelectionContext(robot, assemblyState);

  assert.ok(context.selectedBridge);
  assert.equal(context.selectedClosedLoopBridge?.id, 'bridge_cycle');
  assert.notEqual(context.robot, robot);
  assert.equal(context.robot.joints.bridge_cycle?.id, 'bridge_cycle');
  assert.equal(context.robot.joints.bridge_cycle?.parentLinkId, 'base_link');
  assert.equal(context.robot.joints.bridge_cycle?.childLinkId, 'tip_link');
});

test('buildPropertyEditorSelectionContext leaves structural bridge joints unlocked when they already exist in the render robot', () => {
  const robot = createRobotState('bridge_cycle');
  robot.joints.bridge_cycle = {
    id: 'bridge_cycle',
    name: 'bridge_cycle',
    type: JointType.FIXED,
    parentLinkId: 'base_link',
    childLinkId: 'tip_link',
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    dynamics: { damping: 0, friction: 0 },
    hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
  };

  const context = buildPropertyEditorSelectionContext(robot, createAssemblyState());

  assert.equal(context.robot, robot);
  assert.ok(context.selectedBridge);
  assert.equal(context.selectedClosedLoopBridge, null);
});
