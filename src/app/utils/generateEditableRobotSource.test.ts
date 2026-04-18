import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { parseURDF } from '@/core/parsers';
import type { RobotFile, RobotState } from '@/types';

import { parseEditableRobotSource } from './parseEditableRobotSource.ts';
import { generateEditableRobotSource } from './generateEditableRobotSource.ts';

const { window } = new JSDOM();

if (!globalThis.DOMParser) {
  globalThis.DOMParser = window.DOMParser;
}

if (!globalThis.XMLSerializer) {
  globalThis.XMLSerializer = window.XMLSerializer;
}

const demoUrdfSource = `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0.1" rpy="0 0 0" />
      <geometry>
        <box size="1 2 3" />
      </geometry>
    </visual>
    <collision>
      <geometry>
        <box size="1 2 3" />
      </geometry>
    </collision>
    <inertial>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <mass value="1" />
      <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
    </inertial>
  </link>
  <link name="tool_link" />
  <joint name="tool_joint" type="revolute">
    <parent link="base_link" />
    <child link="tool_link" />
    <origin xyz="0 0 1" rpy="0 0 0" />
    <axis xyz="0 0 1" />
    <limit lower="-1" upper="1" effort="2" velocity="3" />
  </joint>
</robot>`;

function createRobotState(): RobotState {
  const parsed = parseURDF(demoUrdfSource);

  return {
    ...parsed,
    selection: { type: null, id: null },
  };
}

function assertRoundTrip(
  format: RobotFile['format'],
  content: string,
  expectedRootPattern: RegExp,
): void {
  assert.match(content, expectedRootPattern);

  const parsed = parseEditableRobotSource({
    file: {
      name: `robots/demo/model.${format === 'xacro' ? 'urdf.xacro' : format}`,
      format,
    },
    content,
    availableFiles: [],
    allFileContents: {},
  });

  assert.ok(parsed);
  assert.equal(parsed?.name, 'demo');
  assert.ok(parsed?.links.base_link);
  assert.ok(parsed?.links.tool_link);
  assert.ok(parsed?.joints.tool_joint);
  assert.equal(parsed?.joints.tool_joint.axis.z, 1);
}

test('generateEditableRobotSource round-trips URDF output', () => {
  const content = generateEditableRobotSource({
    format: 'urdf',
    robotState: createRobotState(),
  });

  assertRoundTrip('urdf', content, /<robot\b/i);
});

test('generateEditableRobotSource round-trips SDF output', () => {
  const content = generateEditableRobotSource({
    format: 'sdf',
    robotState: createRobotState(),
  });

  assertRoundTrip('sdf', content, /<sdf\b/i);
});

test('generateEditableRobotSource round-trips MJCF output', () => {
  const content = generateEditableRobotSource({
    format: 'mjcf',
    robotState: createRobotState(),
  });

  assertRoundTrip('mjcf', content, /<mujoco\b/i);
});

test('generateEditableRobotSource normalizes Xacro edits to editable robot XML', () => {
  const content = generateEditableRobotSource({
    format: 'xacro',
    robotState: createRobotState(),
  });

  assert.doesNotMatch(content, /xacro:/i);
  assertRoundTrip('xacro', content, /<robot\b/i);
});
