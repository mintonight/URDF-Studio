import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { URDFJoint as RuntimeURDFJoint } from '@/core/parsers/urdf/loader';
import { JointType, type UrdfJoint } from '@/types';

import { patchJointInPlace, patchJointsInPlace } from './robotLoaderJointPatch';

const makeJointPatchData = (overrides: Partial<UrdfJoint> = {}): UrdfJoint => ({
  id: 'joint_1',
  name: 'joint_1',
  type: JointType.REVOLUTE,
  parentLinkId: 'base_link',
  childLinkId: 'link_1',
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

test('patchJointInPlace handles joints without explicit axis or limits', () => {
  const robot = new THREE.Group() as THREE.Group & {
    joints?: Record<string, RuntimeURDFJoint>;
  };
  const joint = new RuntimeURDFJoint();
  joint.name = 'joint_1';
  joint.origPosition = joint.position.clone();
  joint.origQuaternion = joint.quaternion.clone();
  robot.joints = { joint_1: joint };

  const patch = {
    jointName: 'joint_1',
    previousJointData: makeJointPatchData(),
    jointData: makeJointPatchData({
      origin: {
        xyz: { x: 0, y: 0, z: 0.2 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    }),
  };

  const invalidations: number[] = [];
  const applied = patchJointInPlace(robot, patch, () => {
    invalidations.push(1);
  });

  assert.equal(applied, true);
  assert.equal(joint.ignoreLimits, true);
  assert.deepEqual(joint.axis.toArray(), [1, 0, 0]);
  assert.equal(joint.position.z, 0.2);
  assert.equal(invalidations.length, 1);
});

test('patchJointInPlace preserves MJCF scalar joint values and initializes missing limits', () => {
  const robot = new THREE.Group() as THREE.Group & {
    joints?: Record<string, RuntimeURDFJoint>;
  };
  const joint = new RuntimeURDFJoint() as RuntimeURDFJoint & {
    lastSetValue?: number;
  };
  joint.name = 'joint_1';
  joint.jointType = JointType.REVOLUTE;
  joint.axis = new THREE.Vector3(0, 0, 1);
  joint.jointValue = [0.42];
  joint.origPosition = joint.position.clone();
  joint.origQuaternion = joint.quaternion.clone();
  joint.setJointValue = function setJointValue(...values: Array<number | null>) {
    const value = typeof values[0] === 'number' ? values[0] : 0;
    RuntimeURDFJoint.prototype.setJointValue.call(this, value);
    this.lastSetValue = value;
    return true;
  } as RuntimeURDFJoint['setJointValue'];
  robot.joints = { joint_1: joint };

  const patch = {
    jointName: 'joint_1',
    previousJointData: makeJointPatchData(),
    jointData: makeJointPatchData({
      axis: { x: 0, y: 1, z: 0 },
      origin: {
        xyz: { x: 0, y: 0, z: 0.2 },
        rpy: { r: 0.2, p: -0.15, y: 0.05 },
      },
    }),
  };

  const invalidations: number[] = [];
  const applied = patchJointInPlace(robot, patch, () => {
    invalidations.push(1);
  });

  assert.equal(applied, true);
  assert.equal(joint.lastSetValue, 0.42);
  assert.deepEqual(joint.axis.toArray(), [0, 1, 0]);
  assert.equal(joint.limit?.lower, 0);
  assert.equal(joint.limit?.upper, 0);
  assert.equal(joint.ignoreLimits, true);
  assert.equal(joint.position.z, 0.2);
  const expectedQuaternion = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(0.2, -0.15, 0.05, 'ZYX'))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.42));
  assert.ok(joint.quaternion.angleTo(expectedQuaternion) < 1e-6);
  assert.equal(invalidations.length, 1);
});

test('patchJointsInPlace applies batched root-anchor updates without remounting the runtime scene', () => {
  const robot = new THREE.Group() as THREE.Group & {
    joints?: Record<string, RuntimeURDFJoint>;
  };
  const jointA = new RuntimeURDFJoint();
  jointA.name = 'joint_a';
  jointA.origPosition = jointA.position.clone();
  jointA.origQuaternion = jointA.quaternion.clone();

  const jointB = new RuntimeURDFJoint();
  jointB.name = 'joint_b';
  jointB.origPosition = jointB.position.clone();
  jointB.origQuaternion = jointB.quaternion.clone();

  robot.joints = {
    joint_a: jointA,
    joint_b: jointB,
  };

  const invalidations: number[] = [];
  const applied = patchJointsInPlace(
    robot,
    [
      {
        jointName: 'joint_a',
        previousJointData: makeJointPatchData({
          id: 'joint_a',
          name: 'joint_a',
          childLinkId: 'link_a',
        }),
        jointData: makeJointPatchData({
          id: 'joint_a',
          name: 'joint_a',
          childLinkId: 'link_a',
          origin: {
            xyz: { x: 0.25, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        }),
      },
      {
        jointName: 'joint_b',
        previousJointData: makeJointPatchData({
          id: 'joint_b',
          name: 'joint_b',
          childLinkId: 'link_b',
        }),
        jointData: makeJointPatchData({
          id: 'joint_b',
          name: 'joint_b',
          childLinkId: 'link_b',
          origin: {
            xyz: { x: -0.5, y: 0.1, z: 0.2 },
            rpy: { r: 0, p: 0.2, y: 0 },
          },
        }),
      },
    ],
    () => {
      invalidations.push(1);
    },
  );

  assert.equal(applied, true);
  assert.equal(jointA.position.x, 0.25);
  assert.equal(jointB.position.x, -0.5);
  assert.equal(jointB.position.y, 0.1);
  assert.equal(jointB.position.z, 0.2);
  assert.equal(invalidations.length, 1);
});

test('patchJointInPlace resolves runtime joints by stable id and updates joint display names', () => {
  const robot = new THREE.Group() as THREE.Group & {
    joints?: Record<string, RuntimeURDFJoint>;
  };
  const joint = new RuntimeURDFJoint() as RuntimeURDFJoint & {
    urdfName?: string;
  };
  joint.name = 'joint_1';
  joint.urdfName = 'joint_1';
  joint.userData.displayName = 'joint_1';
  joint.userData.jointId = 'joint_1';
  joint.origPosition = joint.position.clone();
  joint.origQuaternion = joint.quaternion.clone();
  robot.joints = { joint_1: joint };

  const invalidations: number[] = [];
  const applied = patchJointInPlace(
    robot,
    {
      jointId: 'joint_1',
      jointName: 'renamed_joint_1',
      jointNameChanged: true,
      previousJointData: makeJointPatchData({
        id: 'joint_1',
        name: 'joint_1',
      }),
      jointData: makeJointPatchData({
        id: 'joint_1',
        name: 'renamed_joint_1',
      }),
    },
    () => {
      invalidations.push(1);
    },
  );

  assert.equal(applied, true);
  assert.equal(joint.name, 'renamed_joint_1');
  assert.equal(joint.urdfName, 'renamed_joint_1');
  assert.equal(joint.userData.displayName, 'renamed_joint_1');
  assert.equal(joint.userData.jointId, 'joint_1');
  assert.equal(invalidations.length, 1);
});
