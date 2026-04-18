import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type RobotState,
} from '../../../types/index.ts';
import { parseURDF } from './parser/index.ts';
import { generateURDF, injectGazeboTags } from './urdfGenerator.ts';
import { processXacro } from '../xacro/xacroParser.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

const CONTROL_FIXTURE_URDF = `<?xml version="1.0"?>
<robot name="demo_description">
  <link name="base_link" />
  <link name="tip_link" />
  <joint name="shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="tip_link" />
    <axis xyz="0 0 1" />
    <limit lower="-1" upper="1" effort="10" velocity="5" />
  </joint>
</robot>`;

test('injectGazeboTags emits parameterized xacro with a ROS1 default profile', () => {
  const robot = parseURDF(CONTROL_FIXTURE_URDF);
  assert.ok(robot);

  const ros1Xacro = injectGazeboTags(CONTROL_FIXTURE_URDF, robot, 'ros1', 'effort');
  const ros1Expanded = processXacro(ros1Xacro);
  const ros2Expanded = processXacro(ros1Xacro, {
    ros_profile: 'ros2',
    ros_hardware_interface: 'position',
  });

  assert.match(ros1Xacro, /xmlns:xacro="http:\/\/www\.ros\.org\/wiki\/xacro"/);
  assert.match(ros1Xacro, /<xacro:arg name="ros_profile" default="ros1"\s*\/>/);
  assert.match(ros1Xacro, /<xacro:arg name="ros_hardware_interface" default="effort"\s*\/>/);
  assert.match(
    ros1Xacro,
    /<xacro:if value="\$\{xacro\.arg\('ros_profile'\) == 'ros1' and xacro\.arg\('ros_hardware_interface'\) == 'effort'\}">/,
  );
  assert.match(
    ros1Xacro,
    /<xacro:if value="\$\{xacro\.arg\('ros_profile'\) == 'ros2' and xacro\.arg\('ros_hardware_interface'\) == 'position'\}">/,
  );
  assert.match(ros1Expanded, /<transmission name="shoulder_joint_trans">/);
  assert.match(
    ros1Expanded,
    /<hardwareInterface>hardware_interface\/EffortJointInterface<\/hardwareInterface>/,
  );
  assert.match(
    ros1Expanded,
    /<plugin name="gazebo_ros_control" filename="libgazebo_ros_control\.so">/,
  );
  assert.doesNotMatch(ros1Expanded, /<ros2_control\b/);
  assert.match(ros2Expanded, /<ros2_control name="demo_description" type="system">/);
  assert.match(
    ros2Expanded,
    /<plugin name="gazebo_ros2_control" filename="libgazebo_ros2_control\.so">/,
  );
  assert.match(ros2Expanded, /<command_interface name="position"\/>/);
  assert.doesNotMatch(ros2Expanded, /<state_interface name="effort"\/>/);
  assert.doesNotMatch(ros2Expanded, /<transmission\b/);
});

test('injectGazeboTags emits parameterized xacro with a ROS2 default profile', () => {
  const robot = parseURDF(CONTROL_FIXTURE_URDF);
  assert.ok(robot);

  const ros2Xacro = injectGazeboTags(CONTROL_FIXTURE_URDF, robot, 'ros2', 'velocity');
  const ros2Expanded = processXacro(ros2Xacro);
  const ros1Expanded = processXacro(ros2Xacro, {
    ros_profile: 'ros1',
    ros_hardware_interface: 'position',
  });

  assert.match(ros2Xacro, /xmlns:xacro="http:\/\/www\.ros\.org\/wiki\/xacro"/);
  assert.match(ros2Xacro, /<xacro:arg name="ros_profile" default="ros2"\s*\/>/);
  assert.match(ros2Xacro, /<xacro:arg name="ros_hardware_interface" default="velocity"\s*\/>/);
  assert.match(
    ros2Xacro,
    /<xacro:if value="\$\{xacro\.arg\('ros_profile'\) == 'ros2' and xacro\.arg\('ros_hardware_interface'\) == 'velocity'\}">/,
  );
  assert.match(ros2Expanded, /<ros2_control name="demo_description" type="system">/);
  assert.match(ros2Expanded, /<plugin>gazebo_ros2_control\/GazeboSystem<\/plugin>/);
  assert.match(ros2Expanded, /<command_interface name="velocity"\/>/);
  assert.match(
    ros2Expanded,
    /<plugin name="gazebo_ros2_control" filename="libgazebo_ros2_control\.so">/,
  );
  assert.match(ros2Expanded, /<robot_param>robot_description<\/robot_param>/);
  assert.match(ros2Expanded, /<robot_param_node>robot_state_publisher<\/robot_param_node>/);
  assert.doesNotMatch(ros2Expanded, /<transmission\b/);
  assert.match(ros1Expanded, /<transmission name="shoulder_joint_trans">/);
  assert.match(
    ros1Expanded,
    /<hardwareInterface>hardware_interface\/PositionJointInterface<\/hardwareInterface>/,
  );
  assert.match(
    ros1Expanded,
    /<plugin name="gazebo_ros_control" filename="libgazebo_ros_control\.so">/,
  );
});

test('generateURDF preserves per-visual colors for links with multiple visuals', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="multi_visual_demo">
  <material name="printed_yellow">
    <color rgba="1.0 0.82 0.12 1.0"/>
  </material>
  <material name="motor_black">
    <color rgba="0.1 0.1 0.1 1.0"/>
  </material>
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0"/>
      <geometry>
        <box size="1 1 1"/>
      </geometry>
      <material name="printed_yellow"/>
    </visual>
    <visual>
      <origin xyz="1 0 0" rpy="0 0 0"/>
      <geometry>
        <box size="0.5 0.5 0.5"/>
      </geometry>
      <material name="motor_black"/>
    </visual>
  </link>
</robot>`);

  assert.ok(robot);
  assert.equal(robot.links.base_link.visual.color, '#ffd11e');
  assert.equal(robot.links.base_link.visualBodies?.[0]?.color, '#191919');
  assert.equal(robot.materials?.base_link?.color, '#ffd11e');

  const regenerated = generateURDF(robot);
  const reparsed = parseURDF(regenerated);

  assert.ok(reparsed);
  assert.equal(reparsed.links.base_link.visual.color, '#ffd11e');
  assert.equal(reparsed.links.base_link.visualBodies?.[0]?.color, '#191919');
});

test('generateURDF downgrades capsule geometry to urdfdom-compatible cylinders', () => {
  const robot: RobotState = {
    name: 'capsule_compat_demo',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.CAPSULE,
          dimensions: { x: 0.05, y: 0.4, z: 0 },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.CAPSULE,
          dimensions: { x: 0.05, y: 0.4, z: 0 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateURDF(robot);

  assert.doesNotMatch(generated, /<capsule\b/);
  assert.match(generated, /<cylinder radius="0\.05" length="0\.5"\s*\/>/);
});

test('generateURDF fails fast for unsupported URDF joint types', () => {
  const robot: RobotState = {
    name: 'ball_joint_demo',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      child_link: {
        ...DEFAULT_LINK,
        id: 'child_link',
        name: 'child_link',
      },
    },
    joints: {
      spherical_joint: {
        ...DEFAULT_JOINT,
        id: 'spherical_joint',
        name: 'spherical_joint',
        type: JointType.BALL,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
      },
    },
    materials: {},
  };

  assert.throws(
    () => generateURDF(robot),
    /\[URDF export\] Joint "spherical_joint" uses unsupported ball type\./,
  );
});

test('generateURDF converts plane geometry to thin box', () => {
  const robot: RobotState = {
    name: 'plane_geom_demo',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        collision: {
          ...DEFAULT_LINK.collision,
          name: 'ground_plane',
          type: GeometryType.PLANE,
          dimensions: { x: 6, y: 4, z: 0 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const result = generateURDF(robot);
  assert.ok(result.includes('<box size="6 4 0.001" />'));
  assert.ok(result.includes('<link name="base_link"'));
});

test('generateURDF keeps Gazebo package texture exports distinct when filenames collide', () => {
  const robot: RobotState = {
    name: 'gazebo_texture_collision',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          authoredMaterials: [{ texture: 'model_a/materials/textures/bus.png' }],
        },
        visualBodies: [
          {
            ...DEFAULT_LINK.visual,
            type: GeometryType.BOX,
            dimensions: { x: 0.5, y: 0.5, z: 0.5 },
            authoredMaterials: [{ texture: 'model_b/materials/textures/bus.png' }],
          },
        ],
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateURDF(robot, { useRelativePaths: true });

  assert.match(generated, /<texture filename="textures\/model_a\/bus\.png" \/>/);
  assert.match(generated, /<texture filename="textures\/model_b\/bus\.png" \/>/);
});

test('generateURDF downgrades ellipsoid geometry to bounding box', () => {
  const robot: RobotState = {
    name: 'ellipsoid_demo',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.ELLIPSOID,
          dimensions: { x: 0.5, y: 0.3, z: 0.2 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const result = generateURDF(robot);
  assert.ok(result.includes('<box size="0.5 0.3 0.2" />'));
});
