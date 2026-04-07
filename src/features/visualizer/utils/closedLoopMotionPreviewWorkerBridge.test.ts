import test from 'node:test';
import assert from 'node:assert/strict';

import { GeometryType, JointType, type RobotState, type UrdfVisual } from '@/types';

import { resolveClosedLoopJointMotionCompensationWithWorker } from '@/shared/utils/robot/closedLoopMotionPreviewWorkerBridge';

function createNoneVisual(): UrdfVisual {
  return {
    type: GeometryType.NONE,
    dimensions: { x: 0, y: 0, z: 0 },
    color: '#000000',
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
  };
}

const robotWithClosedLoop: RobotState = {
  name: 'preview-worker-test',
  rootLinkId: 'base',
  selection: { type: null, id: null },
  links: {
    base: {
      id: 'base',
      name: 'base',
      visible: true,
      visual: createNoneVisual(),
      collision: createNoneVisual(),
      collisionBodies: [],
      inertial: {
        mass: 0,
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
      },
    },
    link_a: {
      id: 'link_a',
      name: 'link_a',
      visible: true,
      visual: createNoneVisual(),
      collision: createNoneVisual(),
      collisionBodies: [],
      inertial: {
        mass: 0,
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
      },
    },
    link_b: {
      id: 'link_b',
      name: 'link_b',
      visible: true,
      visual: createNoneVisual(),
      collision: createNoneVisual(),
      collisionBodies: [],
      inertial: {
        mass: 0,
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
      },
    },
  },
  joints: {
    joint_a: {
      id: 'joint_a',
      name: 'joint_a',
      type: JointType.REVOLUTE,
      parentLinkId: 'base',
      childLinkId: 'link_a',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      axis: { x: 0, y: 0, z: 1 },
      limit: { lower: -Math.PI, upper: Math.PI, effort: 1, velocity: 1 },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
      angle: 0,
    },
    joint_b: {
      id: 'joint_b',
      name: 'joint_b',
      type: JointType.REVOLUTE,
      parentLinkId: 'base',
      childLinkId: 'link_b',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      axis: { x: 0, y: 0, z: 1 },
      limit: { lower: -Math.PI, upper: Math.PI, effort: 1, velocity: 1 },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
      angle: 0,
    },
  },
  closedLoopConstraints: [
    {
      id: 'connect-rotating-links',
      type: 'connect',
      linkAId: 'link_a',
      linkBId: 'link_b',
      anchorWorld: { x: 1, y: 0, z: 0 },
      anchorLocalA: { x: 1, y: 0, z: 0 },
      anchorLocalB: { x: 1, y: 0, z: 0 },
      source: { format: 'mjcf', body1Name: 'link_a', body2Name: 'link_b' },
    },
  ],
};

test('closed loop motion preview worker bridge rejects immediately when Worker is unavailable', async () => {
  const originalWorker = globalThis.Worker;

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  try {
    await assert.rejects(
      resolveClosedLoopJointMotionCompensationWithWorker(robotWithClosedLoop, 'joint_a', 0.42),
      /Web Worker is not available in this environment/i,
    );
  } finally {
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }
});
