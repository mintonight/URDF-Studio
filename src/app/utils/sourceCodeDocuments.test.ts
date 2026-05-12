import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LINK,
  DEFAULT_JOINT,
  JointType,
  type AssemblyState,
  type RobotFile,
} from '@/types';
import {
  buildSourceCodeDocuments,
  buildWorkspaceAssemblySourceCodeDocuments,
} from './sourceCodeDocuments.ts';

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

test('buildSourceCodeDocuments adds USD composition tabs for referenced source layers', () => {
  const activeSourceFile: RobotFile = {
    name: 'unitree/h1_2_description/h1_2.usda',
    format: 'usd',
    content: `#usda 1.0
def Xform "h1_2"
{
    variantSet "Physics" = {
        "None" (
            prepend references = @configuration/h1_2_base.usda@
        ) {
        }
        "PhysX" (
            prepend payload = @configuration/h1_2_physics.usda@
        ) {
        }
    }
    variantSet "Sensor" = {
        "Sensors" (
            prepend payload = @configuration/h1_2_sensor.usda@
        ) {
        }
    }
    variantSet "Robot" = {
        "Robot" (
            prepend payload = @configuration/h1_2_robot.usda@
        ) {
        }
    }
}`,
  };

  const documents = buildSourceCodeDocuments({
    activeSourceFile,
    sourceCodeContent: activeSourceFile.content,
    sourceCodeDocumentFlavor: 'usd',
    availableFiles: [
      activeSourceFile,
      {
        name: 'unitree/h1_2_description/configuration/h1_2_base.usda',
        format: 'usd',
        content: '#usda 1.0\ndef Scope "visuals" {}',
      },
      {
        name: 'unitree/h1_2_description/configuration/h1_2_physics.usda',
        format: 'usd',
        content: `#usda 1.0
(
    subLayers = [
        @h1_2_base.usda@
    ]
)`,
      },
      {
        name: 'unitree/h1_2_description/configuration/h1_2_sensor.usda',
        format: 'usd',
        content: '#usda 1.0\ndef Scope "sensors" {}',
      },
      {
        name: 'unitree/h1_2_description/configuration/h1_2_robot.usda',
        format: 'usd',
        content: '#usda 1.0\ndef Scope "robot" {}',
      },
    ],
    allFileContents: {},
  });

  assert.deepEqual(
    documents.map((document) => ({
      id: document.id,
      fileName: document.fileName,
      tabLabel: document.tabLabel,
      filePath: document.filePath,
      documentFlavor: document.documentFlavor,
      readOnly: document.readOnly,
      validationEnabled: document.validationEnabled,
      content: document.content,
    })),
    [
      {
        id: 'source:unitree/h1_2_description/h1_2.usda',
        fileName: 'h1_2.usda',
        tabLabel: 'h1_2.usda',
        filePath: 'unitree/h1_2_description/h1_2.usda',
        documentFlavor: 'usd',
        readOnly: true,
        validationEnabled: undefined,
        content: activeSourceFile.content,
      },
      {
        id: 'source:unitree/h1_2_description/configuration/h1_2_base.usda',
        fileName: 'h1_2_base.usda',
        tabLabel: 'h1_2_base.usda',
        filePath: 'unitree/h1_2_description/configuration/h1_2_base.usda',
        documentFlavor: 'usd',
        readOnly: true,
        validationEnabled: true,
        content: '#usda 1.0\ndef Scope "visuals" {}',
      },
      {
        id: 'source:unitree/h1_2_description/configuration/h1_2_physics.usda',
        fileName: 'h1_2_physics.usda',
        tabLabel: 'h1_2_physics.usda',
        filePath: 'unitree/h1_2_description/configuration/h1_2_physics.usda',
        documentFlavor: 'usd',
        readOnly: true,
        validationEnabled: true,
        content: `#usda 1.0
(
    subLayers = [
        @h1_2_base.usda@
    ]
)`,
      },
      {
        id: 'source:unitree/h1_2_description/configuration/h1_2_sensor.usda',
        fileName: 'h1_2_sensor.usda',
        tabLabel: 'h1_2_sensor.usda',
        filePath: 'unitree/h1_2_description/configuration/h1_2_sensor.usda',
        documentFlavor: 'usd',
        readOnly: true,
        validationEnabled: true,
        content: '#usda 1.0\ndef Scope "sensors" {}',
      },
      {
        id: 'source:unitree/h1_2_description/configuration/h1_2_robot.usda',
        fileName: 'h1_2_robot.usda',
        tabLabel: 'h1_2_robot.usda',
        filePath: 'unitree/h1_2_description/configuration/h1_2_robot.usda',
        documentFlavor: 'usd',
        readOnly: true,
        validationEnabled: true,
        content: '#usda 1.0\ndef Scope "robot" {}',
      },
    ],
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

function createWorkspaceAssemblyState(withBridge: boolean): AssemblyState {
  return {
    name: 't1_piper_workspace',
    components: {
      comp_t1: {
        id: 'comp_t1',
        name: 't1',
        sourceFile: 'robots/t1.xml',
        visible: true,
        robot: {
          name: 't1',
          rootLinkId: 'comp_t1_Trunk',
          links: {
            comp_t1_Trunk: {
              ...DEFAULT_LINK,
              id: 'comp_t1_Trunk',
              name: 'Trunk',
            },
            comp_t1_H2: {
              ...DEFAULT_LINK,
              id: 'comp_t1_H2',
              name: 'H2',
            },
          },
          joints: {
            comp_t1_head: {
              ...DEFAULT_JOINT,
              id: 'comp_t1_head',
              name: 't1_Head_pitch',
              type: JointType.REVOLUTE,
              parentLinkId: 'comp_t1_Trunk',
              childLinkId: 'comp_t1_H2',
            },
          },
        },
      },
      comp_piper: {
        id: 'comp_piper',
        name: 'piper',
        sourceFile: 'robots/piper.xml',
        visible: true,
        robot: {
          name: 'piper',
          rootLinkId: 'comp_piper_base_link',
          links: {
            comp_piper_base_link: {
              ...DEFAULT_LINK,
              id: 'comp_piper_base_link',
              name: 'piper',
            },
            comp_piper_link5: {
              ...DEFAULT_LINK,
              id: 'comp_piper_link5',
              name: 'piper_link5',
            },
          },
          joints: {
            comp_piper_joint5: {
              ...DEFAULT_JOINT,
              id: 'comp_piper_joint5',
              name: 'piper_joint5',
              type: JointType.REVOLUTE,
              parentLinkId: 'comp_piper_base_link',
              childLinkId: 'comp_piper_link5',
            },
          },
        },
      },
    },
    bridges: withBridge
      ? {
          attach_piper_link5_to_t1_head: {
            id: 'attach_piper_link5_to_t1_head',
            name: 'attach_piper_link5_to_t1_head',
            parentComponentId: 'comp_t1',
            parentLinkId: 'comp_t1_H2',
            childComponentId: 'comp_piper',
            childLinkId: 'comp_piper_link5',
            joint: {
              ...DEFAULT_JOINT,
              id: 'attach_piper_link5_to_t1_head',
              name: 'attach_piper_link5_to_t1_head',
              type: JointType.FIXED,
              parentLinkId: 'comp_t1_H2',
              childLinkId: 'comp_piper_link5',
            },
          },
        }
      : {},
  };
}

test('buildWorkspaceAssemblySourceCodeDocuments shows merged URDF for a connected workspace bridge', () => {
  const documents = buildWorkspaceAssemblySourceCodeDocuments({
    assemblyState: createWorkspaceAssemblyState(true),
    generatedMergedFileName: 'generated/t1_piper_workspace.generated.urdf',
    generatedMergedContent:
      '<robot name="t1_piper_workspace"><joint name="attach_piper_link5_to_t1_head" type="fixed" /></robot>',
    availableFiles: [
      { name: 'robots/t1.xml', format: 'mjcf', content: '<mujoco model="t1" />' },
      { name: 'robots/piper.xml', format: 'mjcf', content: '<mujoco model="piper" />' },
    ],
    allFileContents: {},
  });

  assert.deepEqual(documents, [
    {
      id: 'source:workspace-assembly',
      fileName: 't1_piper_workspace.generated.urdf',
      tabLabel: 't1_piper_workspace.generated.urdf',
      filePath: null,
      content:
        '<robot name="t1_piper_workspace"><joint name="attach_piper_link5_to_t1_head" type="fixed" /></robot>',
      documentFlavor: 'urdf',
      readOnly: true,
      validationEnabled: true,
    },
  ]);
});

test('buildWorkspaceAssemblySourceCodeDocuments shows component source tabs before bridges are created', () => {
  const documents = buildWorkspaceAssemblySourceCodeDocuments({
    assemblyState: createWorkspaceAssemblyState(false),
    generatedMergedFileName: 'generated/t1_piper_workspace.generated.urdf',
    generatedMergedContent: '<robot name="unused" />',
    availableFiles: [
      { name: 'robots/t1.xml', format: 'mjcf', content: '<mujoco model="t1" />' },
      { name: 'robots/piper.xml', format: 'mjcf', content: '<mujoco model="piper" />' },
    ],
    allFileContents: {
      'robots/piper.xml': '<mujoco model="piper_synced" />',
    },
  });

  assert.deepEqual(
    documents.map((document) => ({
      fileName: document.fileName,
      filePath: document.filePath,
      content: document.content,
      documentFlavor: document.documentFlavor,
      readOnly: document.readOnly,
    })),
    [
      {
        fileName: 't1.xml',
        filePath: 'robots/t1.xml',
        content: '<mujoco model="t1" />',
        documentFlavor: 'mjcf',
        readOnly: true,
      },
      {
        fileName: 'piper.xml',
        filePath: 'robots/piper.xml',
        content: '<mujoco model="piper_synced" />',
        documentFlavor: 'mjcf',
        readOnly: true,
      },
    ],
  );
});
