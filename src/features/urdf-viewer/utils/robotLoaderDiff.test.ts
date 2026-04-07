import test from 'node:test';
import assert from 'node:assert/strict';

import { JointType, type UrdfJoint } from '@/types';

import { detectJointPatches, detectSingleJointPatch } from './robotLoaderDiff';

const makeJoint = (overrides: Partial<UrdfJoint> = {}): UrdfJoint => ({
  id: 'joint_1',
  name: 'joint_1',
  type: JointType.FLOATING,
  parentLinkId: 'world',
  childLinkId: 'base_link',
  origin: {
    xyz: { x: 0, y: 0, z: 0 },
    rpy: { r: 0, p: 0, y: 0 },
  },
  axis: undefined,
  limit: undefined,
  dynamics: { damping: 0, friction: 0 },
  hardware: {
    armature: 0,
    motorType: '',
    motorId: '',
    motorDirection: 1,
  },
  ...overrides,
});

test('detectSingleJointPatch tolerates joints without limits', () => {
  const prevJoints = {
    joint_1: makeJoint(),
  };
  const nextJoints = {
    joint_1: makeJoint({
      origin: {
        xyz: { x: 0, y: 0, z: 0.1 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    }),
  };

  const patch = detectSingleJointPatch(prevJoints, nextJoints);

  assert.ok(patch);
  assert.equal(patch?.jointName, 'joint_1');
});

test('detectJointPatches returns multiple compatible joint patches for batch updates', () => {
  const prevJoints = {
    joint_1: makeJoint(),
    joint_2: makeJoint({
      id: 'joint_2',
      name: 'joint_2',
      childLinkId: 'link_2',
    }),
  };
  const nextJoints = {
    joint_1: makeJoint({
      origin: {
        xyz: { x: 0.1, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    }),
    joint_2: makeJoint({
      id: 'joint_2',
      name: 'joint_2',
      childLinkId: 'link_2',
      origin: {
        xyz: { x: -0.2, y: 0.3, z: 0 },
        rpy: { r: 0, p: 0, y: 0.1 },
      },
    }),
  };

  const patches = detectJointPatches(prevJoints, nextJoints);

  assert.ok(patches);
  assert.equal(patches?.length, 2);
  assert.deepEqual(patches?.map((patch) => patch.jointName).sort(), ['joint_1', 'joint_2']);
});

test('detectSingleJointPatch treats hardware interface changes as joint updates', () => {
  const prevJoints = {
    joint_1: makeJoint(),
  };
  const nextJoints = {
    joint_1: makeJoint({
      hardware: {
        armature: 0,
        motorType: '',
        motorId: '',
        motorDirection: 1,
        hardwareInterface: 'velocity',
      },
    }),
  };

  const patch = detectSingleJointPatch(prevJoints, nextJoints);

  assert.ok(patch);
  assert.equal(patch?.jointName, 'joint_1');
});
