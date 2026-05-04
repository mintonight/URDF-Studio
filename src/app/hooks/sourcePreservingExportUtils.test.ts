import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  generateMujocoXML,
  generateSDF,
  generateURDF,
  injectGazeboTags,
  parseMJCF,
  parseSDF,
  parseURDF,
  parseXacro,
} from '@/core/parsers';
import { GeometryType } from '@/types';
import { resolveSourcePreservingExportContent } from './sourcePreservingExportUtils.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;

const URDF_SOURCE = `<?xml version="1.0"?>
<robot name="demo">
  <!-- keep base link comment -->
  <link name="base_link">
    <visual>
      <geometry>
        <box size="1 1 1" />
      </geometry>
    </visual>
  </link>
  <link name="tool_link" />
  <joint name="tool_joint" type="revolute">
    <parent link="base_link" />
    <child link="tool_link" />
    <axis xyz="0 0 1" />
    <limit lower="-1" upper="1" effort="2" velocity="3" />
  </joint>
</robot>`;

test('resolveSourcePreservingExportContent patches URDF from RobotState while preserving untouched source text', () => {
  const robot = parseURDF(URDF_SOURCE);
  robot.joints.tool_joint.limit = {
    ...robot.joints.tool_joint.limit,
    upper: 2,
  };

  const result = resolveSourcePreservingExportContent({
    format: 'urdf',
    currentRobot: robot,
    sourceFile: {
      name: 'robots/demo.urdf',
      format: 'urdf',
      content: URDF_SOURCE,
    },
    generatedContent: generateURDF(robot, { preserveMeshPaths: true }),
  });

  assert.equal(result.strategy, 'source-preserved');
  assert.match(result.content, /keep base link comment/);
  assert.match(result.content, /<limit lower="-1" upper="2" effort="2" velocity="3" \/>/);
  assert.equal(parseURDF(result.content).joints.tool_joint.limit?.upper, 2);
});

test('resolveSourcePreservingExportContent patches MJCF model-owned sections and keeps top-level solver settings', () => {
  const robot = parseURDF(URDF_SOURCE);
  const source = generateMujocoXML(robot, { includeSceneHelpers: false }).replace(
    '<worldbody>',
    '<option timestep="0.002" />\n  <!-- keep mjcf option area -->\n  <worldbody>',
  );
  const nextRobot = {
    ...robot,
    name: 'demo_updated',
  };

  const result = resolveSourcePreservingExportContent({
    format: 'mjcf',
    currentRobot: nextRobot,
    sourceFile: {
      name: 'robots/demo.xml',
      format: 'mjcf',
      content: source,
    },
    generatedContent: generateMujocoXML(nextRobot, { includeSceneHelpers: false }),
  });

  assert.equal(result.strategy, 'source-preserved');
  assert.match(result.content, /<mujoco model="demo_updated">/);
  assert.match(result.content, /<option timestep="0\.002" \/>/);
  assert.match(result.content, /keep mjcf option area/);
  assert.equal(parseMJCF(result.content)?.name, 'demo_updated');
});

test('resolveSourcePreservingExportContent patches SDF model inside an authored world and keeps world plugins', () => {
  const robot = parseURDF(URDF_SOURCE);
  const source = generateSDF(robot).replace(
    '<sdf version="1.7">\n  <model name="demo">',
    '<sdf version="1.7">\n  <world name="default">\n    <plugin name="keep_me" filename="libkeep.so" />\n    <model name="demo">',
  ).replace('</model>\n</sdf>', '</model>\n  </world>\n</sdf>');
  const nextRobot = {
    ...robot,
    name: 'demo_sdf_updated',
  };

  const result = resolveSourcePreservingExportContent({
    format: 'sdf',
    currentRobot: nextRobot,
    sourceFile: {
      name: 'robots/model.sdf',
      format: 'sdf',
      content: source,
    },
    generatedContent: generateSDF(nextRobot),
  });

  assert.equal(result.strategy, 'source-preserved');
  assert.match(result.content, /<world name="default">/);
  assert.match(result.content, /<plugin name="keep_me" filename="libkeep\.so" \/>/);
  assert.match(result.content, /<model name="demo_sdf_updated">/);
  assert.equal(parseSDF(result.content, { sourcePath: 'robots/model.sdf' })?.name, 'demo_sdf_updated');
});

test('resolveSourcePreservingExportContent patches concrete Xacro elements and keeps Xacro declarations', () => {
  const source = URDF_SOURCE.replace(
    '<robot name="demo">',
    '<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo">\n  <xacro:property name="prefix" value="" />',
  );
  const robot = parseXacro(source, {}, { 'robots/demo.urdf.xacro': source }, 'robots');
  assert.ok(robot);
  robot.joints.tool_joint.limit = {
    ...robot.joints.tool_joint.limit,
    upper: 4,
  };

  const result = resolveSourcePreservingExportContent({
    format: 'xacro',
    currentRobot: robot,
    sourceFile: {
      name: 'robots/demo.urdf.xacro',
      format: 'xacro',
      content: source,
    },
    availableFiles: [],
    allFileContents: { 'robots/demo.urdf.xacro': source },
    generatedContent: injectGazeboTags(
      generateURDF(robot, { preserveMeshPaths: true }),
      robot,
      'ros2',
      'effort',
    ),
  });

  assert.equal(result.strategy, 'source-preserved');
  assert.match(result.content, /<xacro:property name="prefix" value="" \/>/);
  assert.match(result.content, /<limit lower="-1" upper="4" effort="2" velocity="3" \/>/);
  assert.equal(
    parseXacro(result.content, {}, { 'robots/demo.urdf.xacro': result.content }, 'robots')
      ?.joints.tool_joint.limit?.upper,
    4,
  );
});

test('resolveSourcePreservingExportContent fails instead of regenerating when Xacro macros own model structure', () => {
  const source = `<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="macro_demo">
  <xacro:macro name="make_link" params="name">
    <link name="\${name}" />
  </xacro:macro>
  <xacro:make_link name="base_link" />
</robot>`;
  const robot = parseXacro(source, {}, { 'robots/macro.urdf.xacro': source }, 'robots');
  assert.ok(robot);
  robot.links.base_link.visual = {
    ...robot.links.base_link.visual,
    type: GeometryType.BOX,
    dimensions: { x: 0.2, y: 0.2, z: 0.2 },
  };

  assert.throws(
    () =>
      resolveSourcePreservingExportContent({
        format: 'xacro',
        currentRobot: robot,
        sourceFile: {
          name: 'robots/macro.urdf.xacro',
          format: 'xacro',
          content: source,
        },
        availableFiles: [],
        allFileContents: { 'robots/macro.urdf.xacro': source },
        generatedContent: generateURDF(robot, { preserveMeshPaths: true }),
      }),
    /Cannot preserve Xacro text structure/,
  );
});
