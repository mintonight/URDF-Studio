import test from 'node:test';
import assert from 'node:assert/strict';

import type { RobotFile } from '@/types';
import { buildSourceCodeDocuments } from './sourceCodeDocuments.ts';

test('buildSourceCodeDocuments adds xacro include tabs for related source files', () => {
  const activeSourceFile: RobotFile = {
    name: 'robots/demo_pkg/xacro/robot.xacro',
    format: 'xacro',
    content: `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo">
  <xacro:include filename="parts/link.xacro" />
</robot>`,
  };

  const documents = buildSourceCodeDocuments({
    activeSourceFile,
    sourceCodeContent: activeSourceFile.content,
    sourceCodeDocumentFlavor: 'xacro',
    availableFiles: [activeSourceFile],
    allFileContents: {
      'robots/demo_pkg/xacro/parts/link.xacro': `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="parts">
  <xacro:include filename="../urdf/demo.gazebo" />
</robot>`,
      'robots/demo_pkg/urdf/demo.gazebo': `<gazebo reference="base_link">
  <material>Gazebo/Orange</material>
</gazebo>`,
    },
  });

  assert.deepEqual(
    documents.map((document) => ({
      id: document.id,
      fileName: document.fileName,
      tabLabel: document.tabLabel,
      filePath: document.filePath,
      documentFlavor: document.documentFlavor,
      validationEnabled: document.validationEnabled,
      changeTarget: document.changeTarget,
    })),
    [
      {
        id: 'source:robots/demo_pkg/xacro/robot.xacro',
        fileName: 'robot.xacro',
        tabLabel: 'robot.xacro',
        filePath: 'robots/demo_pkg/xacro/robot.xacro',
        documentFlavor: 'xacro',
        validationEnabled: undefined,
        changeTarget: {
          name: 'robots/demo_pkg/xacro/robot.xacro',
          format: 'xacro',
        },
      },
      {
        id: 'source:robots/demo_pkg/xacro/parts/link.xacro',
        fileName: 'link.xacro',
        tabLabel: 'link.xacro',
        filePath: 'robots/demo_pkg/xacro/parts/link.xacro',
        documentFlavor: 'xacro',
        validationEnabled: true,
        changeTarget: {
          name: 'robots/demo_pkg/xacro/parts/link.xacro',
          format: 'xacro',
        },
      },
      {
        id: 'source:robots/demo_pkg/urdf/demo.gazebo',
        fileName: 'demo.gazebo',
        tabLabel: 'demo.gazebo',
        filePath: 'robots/demo_pkg/urdf/demo.gazebo',
        documentFlavor: 'xacro',
        validationEnabled: false,
        changeTarget: {
          name: 'robots/demo_pkg/urdf/demo.gazebo',
          format: null,
        },
      },
    ],
  );
});

test('buildSourceCodeDocuments adds mjcf include tabs only while the source stays include-driven', () => {
  const activeSourceFile: RobotFile = {
    name: 'robots/demo/scene.xml',
    format: 'mjcf',
    content: `<mujoco model="demo">
  <include file="parts/body.xml" />
</mujoco>`,
  };

  const documents = buildSourceCodeDocuments({
    activeSourceFile,
    sourceCodeContent: activeSourceFile.content,
    sourceCodeDocumentFlavor: 'mjcf',
    availableFiles: [
      activeSourceFile,
      {
        name: 'robots/demo/parts/body.xml',
        format: 'mjcf',
        content: '<mujoco model="body"><worldbody /></mujoco>',
      },
    ],
    allFileContents: {},
  });

  assert.deepEqual(
    documents.map((document) => document.filePath),
    ['robots/demo/scene.xml', 'robots/demo/parts/body.xml'],
  );

  const generatedDocuments = buildSourceCodeDocuments({
    activeSourceFile,
    sourceCodeContent: '<mujoco model="generated"><worldbody /></mujoco>',
    sourceCodeDocumentFlavor: 'mjcf',
    availableFiles: [
      activeSourceFile,
      {
        name: 'robots/demo/parts/body.xml',
        format: 'mjcf',
        content: '<mujoco model="body"><worldbody /></mujoco>',
      },
    ],
    allFileContents: {},
  });

  assert.deepEqual(
    generatedDocuments.map((document) => document.filePath),
    ['robots/demo/scene.xml'],
  );
});

test('buildSourceCodeDocuments keeps every tab read-only during preview sessions', () => {
  const activeSourceFile: RobotFile = {
    name: 'robots/demo_pkg/xacro/robot.xacro',
    format: 'xacro',
    content: `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo">
  <xacro:include filename="parts/link.xacro" />
</robot>`,
  };

  const documents = buildSourceCodeDocuments({
    activeSourceFile,
    sourceCodeContent: activeSourceFile.content,
    sourceCodeDocumentFlavor: 'xacro',
    availableFiles: [activeSourceFile],
    allFileContents: {
      'robots/demo_pkg/xacro/parts/link.xacro': '<robot name="parts" />',
    },
    forceReadOnly: true,
  });

  assert.equal(documents.length, 2);
  assert.equal(
    documents.every((document) => document.readOnly),
    true,
  );
});

test('buildSourceCodeDocuments exposes an in-memory apply target for generated editable URDF', () => {
  const documents = buildSourceCodeDocuments({
    activeSourceFile: null,
    sourceCodeContent: '<robot name="generated_robot"><link name="base_link" /></robot>',
    sourceCodeDocumentFlavor: 'urdf',
    availableFiles: [],
    allFileContents: {},
  });

  assert.deepEqual(documents, [
    {
      id: 'source:robot',
      fileName: 'robot.urdf',
      tabLabel: 'robot.urdf',
      filePath: null,
      content: '<robot name="generated_robot"><link name="base_link" /></robot>',
      documentFlavor: 'urdf',
      readOnly: false,
      changeTarget: {
        name: 'robot.urdf',
        format: 'urdf',
        content: '<robot name="generated_robot"><link name="base_link" /></robot>',
        persistContent: false,
      },
    },
  ]);
});
