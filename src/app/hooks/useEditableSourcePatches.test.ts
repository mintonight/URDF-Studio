import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { JointType } from '@/types';
import type { RobotFile } from '@/types';

import {
  buildEditableSourcePatchState,
  resolveEditablePatchTarget,
} from './editableSourcePatchState.ts';
import { useEditableSourcePatches } from './useEditableSourcePatches.ts';

function createRobotFile(
  name: string,
  content: string,
  format: RobotFile['format'] = 'mjcf',
): RobotFile {
  return {
    name,
    content,
    format,
  };
}

test('resolveEditablePatchTarget prefers selected file when names match', () => {
  const selectedFile = createRobotFile('robot.xml', '<robot />');
  const availableFiles = [selectedFile, createRobotFile('other.xml', '<other />')];

  const result = resolveEditablePatchTarget({
    selectedFile,
    availableFiles,
    sourceFileName: 'robot.xml',
  });

  assert.equal(result.targetFileName, 'robot.xml');
  assert.equal(result.targetFile, selectedFile);
});

test('buildEditableSourcePatchState updates selected, available, and text cache consistently', () => {
  const selectedFile = createRobotFile('robot.xml', '<before />');
  const otherFile = createRobotFile('other.xml', '<other />');
  const availableFiles = [selectedFile, otherFile];
  const allFileContents = {
    'robot.xml': '<before />',
    'other.xml': '<other />',
  };

  const result = buildEditableSourcePatchState({
    selectedFile,
    availableFiles,
    allFileContents,
    targetFile: selectedFile,
    nextContent: '<after />',
  });

  assert.equal(result.didChange, true);
  assert.equal(result.nextSelectedFile?.content, '<after />');
  assert.equal(result.nextAvailableFiles[0]?.content, '<after />');
  assert.equal(result.nextAvailableFiles[1]?.content, '<other />');
  assert.equal(result.nextAllFileContents['robot.xml'], '<after />');
});

test('buildEditableSourcePatchState is a no-op when content is unchanged', () => {
  const selectedFile = createRobotFile('robot.xml', '<same />');
  const availableFiles = [selectedFile];
  const allFileContents = { 'robot.xml': '<same />' };

  const result = buildEditableSourcePatchState({
    selectedFile,
    availableFiles,
    allFileContents,
    targetFile: selectedFile,
    nextContent: '<same />',
  });

  assert.equal(result.didChange, false);
  assert.equal(result.nextSelectedFile, selectedFile);
  assert.equal(result.nextAvailableFiles, availableFiles);
  assert.equal(result.nextAllFileContents, allFileContents);
});

function renderEditableSourcePatchesHook(
  params: Parameters<typeof useEditableSourcePatches>[0],
): ReturnType<typeof useEditableSourcePatches> {
  let hookValue: ReturnType<typeof useEditableSourcePatches> | null =
    null as ReturnType<typeof useEditableSourcePatches> | null;

  function Probe() {
    hookValue = useEditableSourcePatches(params);
    return null;
  }

  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(hookValue, 'hook should render');
  return hookValue as ReturnType<typeof useEditableSourcePatches>;
}

test('patchEditableSourceUpdateJointLimit skips USD sources because limits live in robot state', () => {
  const selectedFile: RobotFile = {
    name: 'unitree_model/B2/usd/b2.usd',
    content: '',
    format: 'usd',
  };
  const physicsFile: RobotFile = {
    name: 'unitree_model/B2/usd/configuration/b2_description_physics.usd',
    content: `#usda 1.0
	def Xform "b2"
	{
	    over "joints"
	    {
        def PhysicsRevoluteJoint "FL_hip_joint"
        {
            float physics:lowerLimit = -60
            float physics:upperLimit = 60
        }
    }
	}
	`,
    format: 'usd',
  };
  const availableFiles = [selectedFile, physicsFile];
  const selectedUpdates: RobotFile[] = [];
  const availableUpdates: RobotFile[][] = [];
  const contentUpdates: Array<Record<string, string>> = [];
  const toastMessages: string[] = [];

  const hook = renderEditableSourcePatchesHook({
    selectedFile,
    availableFiles,
    allFileContents: Object.fromEntries(availableFiles.map((file) => [file.name, file.content])),
    setSelectedFile: (file) => selectedUpdates.push(file),
    setAvailableFiles: (files) => availableUpdates.push(files),
    setAllFileContents: (contents) => contentUpdates.push(contents),
    showToast: (message) => toastMessages.push(message),
  });

  hook.patchEditableSourceUpdateJointLimit({
    jointName: 'FL_hip_joint',
    jointType: JointType.REVOLUTE,
    limit: {
      lower: -0.5,
      upper: 0.8,
      effort: 25,
      velocity: 10,
    },
  });

  assert.deepEqual(selectedUpdates, []);
  assert.deepEqual(availableUpdates, []);
  assert.deepEqual(contentUpdates, []);
  assert.deepEqual(toastMessages, []);
});

test('patchEditableSourceRobotName updates an MJCF root model name without generating the file', () => {
  const selectedFile = createRobotFile(
    'robot.xml',
    `<mujoco model="go2">
  <option impratio="100"/>
  <worldbody/>
</mujoco>`,
  );
  const availableFiles = [selectedFile];
  const selectedUpdates: RobotFile[] = [];
  const availableUpdates: RobotFile[][] = [];
  const contentUpdates: Array<Record<string, string>> = [];

  const hook = renderEditableSourcePatchesHook({
    selectedFile,
    availableFiles,
    allFileContents: { [selectedFile.name]: selectedFile.content },
    setSelectedFile: (file) => selectedUpdates.push(file),
    setAvailableFiles: (files) => availableUpdates.push(files),
    setAllFileContents: (contents) => contentUpdates.push(contents),
    showToast: () => {},
  });

  hook.patchEditableSourceRobotName({
    name: 'go2_renamed',
  });

  assert.equal(selectedUpdates.length, 1);
  assert.match(selectedUpdates[0]?.content ?? '', /<mujoco model="go2_renamed">/);
  assert.match(selectedUpdates[0]?.content ?? '', /<option impratio="100"\/>/);
  assert.match(availableUpdates[0]?.[0]?.content ?? '', /<mujoco model="go2_renamed">/);
  assert.match(contentUpdates[0]?.[selectedFile.name] ?? '', /<mujoco model="go2_renamed">/);
});

test('patchEditableSourceUpdateJointLimit updates MJCF joint range in the selected source file', () => {
  const selectedFile = createRobotFile(
    'robot.xml',
    `<mujoco model="go2">
  <compiler angle="radian"/>
  <worldbody>
    <body name="base_link">
      <joint name="hip_joint" type="hinge" axis="0 0 1" range="-1 1"/>
    </body>
  </worldbody>
</mujoco>`,
  );
  const availableFiles = [selectedFile];
  const selectedUpdates: RobotFile[] = [];
  const availableUpdates: RobotFile[][] = [];
  const contentUpdates: Array<Record<string, string>> = [];

  const hook = renderEditableSourcePatchesHook({
    selectedFile,
    availableFiles,
    allFileContents: { [selectedFile.name]: selectedFile.content },
    setSelectedFile: (file) => selectedUpdates.push(file),
    setAvailableFiles: (files) => availableUpdates.push(files),
    setAllFileContents: (contents) => contentUpdates.push(contents),
    showToast: () => {},
  });

  hook.patchEditableSourceUpdateJointLimit({
    jointName: 'hip_joint',
    jointType: JointType.REVOLUTE,
    limit: {
      lower: -0.5,
      upper: 0.8,
      effort: 25,
      velocity: 10,
    },
  });

  const nextContent = selectedUpdates[0]?.content ?? '';
  assert.match(nextContent, /<joint name="hip_joint"[^>]*range="-0\.5 0\.8"/);
  assert.match(nextContent, /<joint name="hip_joint"[^>]*limited="true"/);
  assert.match(availableUpdates[0]?.[0]?.content ?? '', /range="-0\.5 0\.8"/);
  assert.match(contentUpdates[0]?.[selectedFile.name] ?? '', /range="-0\.5 0\.8"/);
});

test('patchEditableSourceRobotName updates Xacro robot roots without generating source', () => {
  const selectedFile = createRobotFile(
    'robot.urdf.xacro',
    `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo">
  <xacro:property name="prefix" value="demo" />
</robot>`,
    'xacro',
  );
  const availableFiles = [selectedFile];
  const selectedUpdates: RobotFile[] = [];
  const availableUpdates: RobotFile[][] = [];
  const contentUpdates: Array<Record<string, string>> = [];

  const hook = renderEditableSourcePatchesHook({
    selectedFile,
    availableFiles,
    allFileContents: { [selectedFile.name]: selectedFile.content },
    setSelectedFile: (file) => selectedUpdates.push(file),
    setAvailableFiles: (files) => availableUpdates.push(files),
    setAllFileContents: (contents) => contentUpdates.push(contents),
    showToast: () => {},
  });

  hook.patchEditableSourceRobotName({
    name: 'demo_renamed',
  });

  const nextContent = selectedUpdates[0]?.content ?? '';
  assert.match(nextContent, /<robot xmlns:xacro="http:\/\/www\.ros\.org\/wiki\/xacro" name="demo_renamed">/);
  assert.match(nextContent, /<xacro:property name="prefix" value="demo" \/>/);
  assert.match(availableUpdates[0]?.[0]?.content ?? '', /name="demo_renamed"/);
  assert.match(contentUpdates[0]?.[selectedFile.name] ?? '', /name="demo_renamed"/);
});

test('patchEditableSourceUpdateJointLimit updates literal Xacro joint limits', () => {
  const selectedFile = createRobotFile(
    'robot.urdf.xacro',
    `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo">
  <xacro:property name="hip_lower" value="-1.0472" />
  <joint name="hip_joint" type="revolute">
    <limit lower="${'${hip_lower}'}" upper="1.0472" effort="23.7" velocity="30.1" />
  </joint>
</robot>`,
    'xacro',
  );
  const availableFiles = [selectedFile];
  const selectedUpdates: RobotFile[] = [];
  const availableUpdates: RobotFile[][] = [];
  const contentUpdates: Array<Record<string, string>> = [];

  const hook = renderEditableSourcePatchesHook({
    selectedFile,
    availableFiles,
    allFileContents: { [selectedFile.name]: selectedFile.content },
    setSelectedFile: (file) => selectedUpdates.push(file),
    setAvailableFiles: (files) => availableUpdates.push(files),
    setAllFileContents: (contents) => contentUpdates.push(contents),
    showToast: () => {},
  });

  hook.patchEditableSourceUpdateJointLimit({
    jointName: 'hip_joint',
    jointType: JointType.REVOLUTE,
    limit: {
      lower: -0.5,
      upper: 0.8,
      effort: 25,
      velocity: 12,
    },
  });

  const nextContent = selectedUpdates[0]?.content ?? '';
  assert.match(nextContent, /<xacro:property name="hip_lower" value="-1\.0472" \/>/);
  assert.match(nextContent, /<limit lower="-0\.5" upper="0\.8" effort="25" velocity="12" \/>/);
  assert.match(availableUpdates[0]?.[0]?.content ?? '', /lower="-0\.5"/);
  assert.match(contentUpdates[0]?.[selectedFile.name] ?? '', /lower="-0\.5"/);
});

test('patchEditableSourceRobotName updates an SDF model name without generating source', () => {
  const selectedFile = createRobotFile(
    'model.sdf',
    `<sdf version="1.7">
  <world name="default">
    <plugin name="keep_me" filename="libkeep.so" />
    <model name="demo">
      <link name="base_link" />
    </model>
  </world>
</sdf>`,
    'sdf',
  );
  const availableFiles = [selectedFile];
  const selectedUpdates: RobotFile[] = [];
  const availableUpdates: RobotFile[][] = [];
  const contentUpdates: Array<Record<string, string>> = [];

  const hook = renderEditableSourcePatchesHook({
    selectedFile,
    availableFiles,
    allFileContents: { [selectedFile.name]: selectedFile.content },
    setSelectedFile: (file) => selectedUpdates.push(file),
    setAvailableFiles: (files) => availableUpdates.push(files),
    setAllFileContents: (contents) => contentUpdates.push(contents),
    showToast: () => {},
  });

  hook.patchEditableSourceRobotName({
    name: 'demo_renamed',
  });

  const nextContent = selectedUpdates[0]?.content ?? '';
  assert.match(nextContent, /<model name="demo_renamed">/);
  assert.match(nextContent, /<plugin name="keep_me" filename="libkeep\.so" \/>/);
  assert.match(availableUpdates[0]?.[0]?.content ?? '', /<model name="demo_renamed">/);
  assert.match(contentUpdates[0]?.[selectedFile.name] ?? '', /<model name="demo_renamed">/);
});

test('patchEditableSourceUpdateJointLimit updates SDF joint axis limits', () => {
  const selectedFile = createRobotFile(
    'model.sdf',
    `<sdf version="1.7">
  <model name="demo">
    <joint name="slider_joint" type="prismatic">
      <axis>
        <xyz>1 0 0</xyz>
        <limit>
          <lower>0</lower>
          <upper>0.1</upper>
          <effort>10</effort>
          <velocity>1</velocity>
          <stiffness>1000</stiffness>
          <dissipation>3</dissipation>
        </limit>
      </axis>
    </joint>
  </model>
</sdf>`,
    'sdf',
  );
  const availableFiles = [selectedFile];
  const selectedUpdates: RobotFile[] = [];
  const availableUpdates: RobotFile[][] = [];
  const contentUpdates: Array<Record<string, string>> = [];

  const hook = renderEditableSourcePatchesHook({
    selectedFile,
    availableFiles,
    allFileContents: { [selectedFile.name]: selectedFile.content },
    setSelectedFile: (file) => selectedUpdates.push(file),
    setAvailableFiles: (files) => availableUpdates.push(files),
    setAllFileContents: (contents) => contentUpdates.push(contents),
    showToast: () => {},
  });

  hook.patchEditableSourceUpdateJointLimit({
    jointName: 'slider_joint',
    jointType: JointType.PRISMATIC,
    limit: {
      lower: -0.1,
      upper: 0.2,
      effort: 30,
      velocity: 2,
    },
  });

  const nextContent = selectedUpdates[0]?.content ?? '';
  assert.match(nextContent, /<lower>-0\.1<\/lower>/);
  assert.match(nextContent, /<upper>0\.2<\/upper>/);
  assert.match(nextContent, /<effort>30<\/effort>/);
  assert.match(nextContent, /<velocity>2<\/velocity>/);
  assert.match(nextContent, /<stiffness>1000<\/stiffness>/);
  assert.match(nextContent, /<dissipation>3<\/dissipation>/);
  assert.match(nextContent, /<xyz>1 0 0<\/xyz>/);
  assert.match(availableUpdates[0]?.[0]?.content ?? '', /<lower>-0\.1<\/lower>/);
  assert.match(contentUpdates[0]?.[selectedFile.name] ?? '', /<lower>-0\.1<\/lower>/);
});
