import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { parseMJCF, parseURDF } from '@/core/parsers';

import { tryPatchRobotStateFromEditableSourceChange } from './editableSourceIncrementalPatch';

const { window } = new JSDOM();

if (!globalThis.DOMParser) {
  globalThis.DOMParser = window.DOMParser;
}

const URDF_LINK_FIXTURE = `<?xml version="1.0"?>
<robot name="demo_robot">
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0.25" rpy="0 0 0" />
      <geometry>
        <cylinder radius="0.05" length="0.5" />
      </geometry>
      <material name="base_link_mat">
        <color rgba="0.94902353 0.94118039 0.90980784 1.00000000"/>
      </material>
    </visual>
    <collision>
      <origin xyz="0 0 0.25" rpy="0 0 0" />
      <geometry>
        <cylinder radius="0.05" length="0.5" />
      </geometry>
    </collision>
  </link>
</robot>`;

const URDF_JOINT_FIXTURE = `<?xml version="1.0"?>
<robot name="joint_robot">
  <link name="base_link" />
  <link name="arm_link" />
  <joint name="shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="arm_link" />
    <origin xyz="0 0 0.5" rpy="0 0 0" />
    <axis xyz="0 0 1" />
    <limit lower="-1.57" upper="1.57" effort="100" velocity="10" />
    <dynamics damping="0" friction="0" />
  </joint>
</robot>`;

const MJCF_FIXTURE = `<mujoco model="mjcf_patch_demo">
  <worldbody>
    <body name="base_link">
      <geom type="box" size="0.1 0.1 0.1" />
      <body name="foot_link" pos="0 0 0.1">
        <joint name="foot_joint" type="hinge" axis="0 1 0" range="-1 1" damping="0" />
        <geom type="sphere" size="0.0165" rgba="0.8 0.8 0.8 1" />
      </body>
    </body>
  </worldbody>
</mujoco>`;

test('tryPatchRobotStateFromEditableSourceChange patches a URDF link fragment in place', () => {
  const currentState = parseURDF(URDF_LINK_FIXTURE);
  assert.ok(currentState, 'expected URDF fixture to parse');

  const nextContent = URDF_LINK_FIXTURE.replace('length="0.5"', 'length="1"');
  const dirtyStart = nextContent.indexOf('length="1"');
  assert.notEqual(dirtyStart, -1);

  const patchedState = tryPatchRobotStateFromEditableSourceChange({
    file: { name: 'robot.urdf', format: 'urdf' },
    previousContent: URDF_LINK_FIXTURE,
    nextContent,
    dirtyRanges: [{ startOffset: dirtyStart, endOffset: dirtyStart + 'length="1"'.length }],
    currentState,
  });

  assert.ok(patchedState);
  assert.equal(patchedState?.links.base_link.id, 'base_link');
  assert.equal(patchedState?.links.base_link.visual.dimensions.y, 1);
  assert.equal(currentState?.links.base_link.visual.dimensions.y, 0.5);
});

test('tryPatchRobotStateFromEditableSourceChange patches a URDF joint fragment without changing the stable joint id', () => {
  const currentState = parseURDF(URDF_JOINT_FIXTURE);
  assert.ok(currentState, 'expected URDF joint fixture to parse');

  const nextContent = URDF_JOINT_FIXTURE.replace('damping="0"', 'damping="0.2"');
  const dirtyStart = nextContent.indexOf('damping="0.2"');
  assert.notEqual(dirtyStart, -1);

  const patchedState = tryPatchRobotStateFromEditableSourceChange({
    file: { name: 'robot.urdf', format: 'urdf' },
    previousContent: URDF_JOINT_FIXTURE,
    nextContent,
    dirtyRanges: [{ startOffset: dirtyStart, endOffset: dirtyStart + 'damping="0.2"'.length }],
    currentState,
  });

  assert.ok(patchedState);
  assert.equal(patchedState?.joints.shoulder_joint.id, 'shoulder_joint');
  assert.equal(patchedState?.joints.shoulder_joint.dynamics.damping, 0.2);
  assert.equal(currentState?.joints.shoulder_joint.dynamics.damping, 0);
});

test('tryPatchRobotStateFromEditableSourceChange patches an MJCF body geom fragment in place', () => {
  const currentState = parseMJCF(MJCF_FIXTURE);
  assert.ok(currentState, 'expected MJCF fixture to parse');

  const nextContent = MJCF_FIXTURE.replace('size="0.0165"', 'size="0.03"');
  const dirtyStart = nextContent.indexOf('size="0.03"');
  assert.notEqual(dirtyStart, -1);

  const patchedState = tryPatchRobotStateFromEditableSourceChange({
    file: { name: 'robot.xml', format: 'mjcf' },
    previousContent: MJCF_FIXTURE,
    nextContent,
    dirtyRanges: [{ startOffset: dirtyStart, endOffset: dirtyStart + 'size="0.03"'.length }],
    currentState,
  });

  assert.ok(patchedState);
  assert.equal(patchedState?.links.foot_link.id, 'foot_link');
  assert.equal(patchedState?.links.foot_link.visual.dimensions.x, 0.03);
  assert.equal(currentState?.links.foot_link.visual.dimensions.x, 0.0165);
});

test('tryPatchRobotStateFromEditableSourceChange patches an MJCF body joint fragment without changing the stable joint id', () => {
  const currentState = parseMJCF(MJCF_FIXTURE);
  assert.ok(currentState, 'expected MJCF fixture to parse');

  const nextContent = MJCF_FIXTURE.replace('damping="0"', 'damping="0.2"');
  const dirtyStart = nextContent.indexOf('damping="0.2"');
  assert.notEqual(dirtyStart, -1);

  const patchedState = tryPatchRobotStateFromEditableSourceChange({
    file: { name: 'robot.xml', format: 'mjcf' },
    previousContent: MJCF_FIXTURE,
    nextContent,
    dirtyRanges: [{ startOffset: dirtyStart, endOffset: dirtyStart + 'damping="0.2"'.length }],
    currentState,
  });

  assert.ok(patchedState);
  assert.equal(patchedState?.joints.foot_joint.id, 'foot_joint');
  assert.equal(patchedState?.joints.foot_joint.dynamics.damping, 0.2);
  assert.equal(currentState?.joints.foot_joint.dynamics.damping, 0);
});

test('tryPatchRobotStateFromEditableSourceChange falls back for MJCF structural subtree changes', () => {
  const currentState = parseMJCF(MJCF_FIXTURE);
  assert.ok(currentState, 'expected MJCF fixture to parse');

  const nextContent = MJCF_FIXTURE.replace(
    '<geom type="sphere" size="0.0165" rgba="0.8 0.8 0.8 1" />',
    [
      '<geom type="sphere" size="0.0165" rgba="0.8 0.8 0.8 1" />',
      '<geom type="sphere" size="0.01" rgba="0.2 0.2 0.2 1" />',
    ].join('\n        '),
  );
  const dirtyStart = nextContent.indexOf('size="0.01"');
  assert.notEqual(dirtyStart, -1);

  const patchedState = tryPatchRobotStateFromEditableSourceChange({
    file: { name: 'robot.xml', format: 'mjcf' },
    previousContent: MJCF_FIXTURE,
    nextContent,
    dirtyRanges: [{ startOffset: dirtyStart, endOffset: dirtyStart + 'size="0.01"'.length }],
    currentState,
  });

  assert.equal(patchedState, null);
});
