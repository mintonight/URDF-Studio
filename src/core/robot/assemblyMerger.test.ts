import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type AssemblyState,
  type RobotData,
} from '@/types';
import { mergeAssembly } from './assemblyMerger.ts';
import { computeLinkWorldMatrices, createOriginMatrix } from './kinematics.ts';

function createAssemblyState(): AssemblyState {
  return {
    name: 'merge-test',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      comp_left: {
        id: 'comp_left',
        name: 'left',
        sourceFile: 'robots/left.urdf',
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        visible: true,
        robot: {
          name: 'left_robot',
          rootLinkId: 'comp_left_base_link',
          links: {
            comp_left_base_link: {
              ...DEFAULT_LINK,
              id: 'comp_left_base_link',
              name: 'left_base_link',
            },
            comp_left_child_link: {
              ...DEFAULT_LINK,
              id: 'comp_left_child_link',
              name: 'left_child_link',
            },
          },
          joints: {
            comp_left_joint: {
              ...DEFAULT_JOINT,
              id: 'comp_left_joint',
              name: 'comp_left_joint',
              type: JointType.FIXED,
              parentLinkId: 'comp_left_base_link',
              childLinkId: 'comp_left_child_link',
            },
          },
        },
      },
      comp_right: {
        id: 'comp_right',
        name: 'right',
        sourceFile: 'robots/right.urdf',
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        visible: true,
        robot: {
          name: 'right_robot',
          rootLinkId: 'comp_right_base_link',
          links: {
            comp_right_base_link: {
              ...DEFAULT_LINK,
              id: 'comp_right_base_link',
              name: 'right_base_link',
            },
          },
          joints: {},
        },
      },
    },
    bridges: {
      bridge_join: {
        id: 'bridge_join',
        name: 'bridge_join',
        parentComponentId: 'comp_left',
        parentLinkId: 'comp_left_base_link',
        childComponentId: 'comp_right',
        childLinkId: 'comp_right_base_link',
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_join',
          name: 'bridge_join',
          type: JointType.FIXED,
          parentLinkId: 'comp_left_base_link',
          childLinkId: 'comp_right_base_link',
        },
      },
    },
  };
}

function createSingleLinkComponent(componentId: string, name: string) {
  const rootLinkId = `${componentId}_base_link`;

  return {
    id: componentId,
    name,
    sourceFile: `robots/${name}.urdf`,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
    robot: {
      name: `${name}_robot`,
      rootLinkId,
      links: {
        [rootLinkId]: {
          ...DEFAULT_LINK,
          id: rootLinkId,
          name: `${name}_base_link`,
        },
      },
      joints: {},
    },
  };
}

function createDynamicChainComponent(componentId: string, name: string) {
  const baseLinkId = `${componentId}_base_link`;
  const elbowLinkId = `${componentId}_elbow_link`;
  const toolLinkId = `${componentId}_tool_link`;
  const sensorLinkId = `${componentId}_sensor_link`;
  const shoulderJointId = `${componentId}_shoulder_joint`;
  const wristSlideJointId = `${componentId}_wrist_slide_joint`;
  const sensorMountJointId = `${componentId}_sensor_mount_joint`;

  return {
    id: componentId,
    name,
    sourceFile: `robots/${name}.urdf`,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
    robot: {
      name: `${name}_robot`,
      rootLinkId: baseLinkId,
      links: {
        [baseLinkId]: {
          ...DEFAULT_LINK,
          id: baseLinkId,
          name: `${name}_base_link`,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.BOX,
            dimensions: { x: 0.4, y: 0.2, z: 0.1 },
            origin: {
              xyz: { x: 0.15, y: -0.05, z: 0.02 },
              rpy: { r: 0.1, p: 0, y: -0.15 },
            },
          },
        },
        [elbowLinkId]: {
          ...DEFAULT_LINK,
          id: elbowLinkId,
          name: `${name}_elbow_link`,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.CYLINDER,
            dimensions: { x: 0.08, y: 0.35, z: 0.08 },
            origin: {
              xyz: { x: -0.08, y: 0.12, z: 0.04 },
              rpy: { r: 0, p: 0.2, y: 0.05 },
            },
          },
        },
        [toolLinkId]: {
          ...DEFAULT_LINK,
          id: toolLinkId,
          name: `${name}_tool_link`,
        },
        [sensorLinkId]: {
          ...DEFAULT_LINK,
          id: sensorLinkId,
          name: `${name}_sensor_link`,
        },
      },
      joints: {
        [shoulderJointId]: {
          ...DEFAULT_JOINT,
          id: shoulderJointId,
          name: shoulderJointId,
          type: JointType.REVOLUTE,
          parentLinkId: baseLinkId,
          childLinkId: elbowLinkId,
          origin: {
            xyz: { x: 0.75, y: -0.5, z: 0.25 },
            rpy: { r: 0.1, p: -0.2, y: 0.3 },
          },
          axis: { x: 0, y: 0, z: 1 },
          limit: { lower: -1.2, upper: 1.6, effort: 20, velocity: 4 },
          safetyController: {
            softLowerLimit: -0.8,
            softUpperLimit: 1.1,
            kPosition: 12,
            kVelocity: 3.5,
          },
          angle: 0.4,
        },
        [wristSlideJointId]: {
          ...DEFAULT_JOINT,
          id: wristSlideJointId,
          name: wristSlideJointId,
          type: JointType.PRISMATIC,
          parentLinkId: elbowLinkId,
          childLinkId: toolLinkId,
          origin: {
            xyz: { x: 0.1, y: 0.2, z: 0.3 },
            rpy: { r: -0.15, p: 0.25, y: -0.35 },
          },
          axis: { x: 1, y: 0, z: 0 },
          limit: { lower: -0.1, upper: 0.5, effort: 12, velocity: 2 },
          safetyController: {
            softLowerLimit: -0.04,
            softUpperLimit: 0.2,
            kPosition: 5,
            kVelocity: 1.5,
          },
          angle: 0.2,
        },
        [sensorMountJointId]: {
          ...DEFAULT_JOINT,
          id: sensorMountJointId,
          name: sensorMountJointId,
          type: JointType.FIXED,
          parentLinkId: baseLinkId,
          childLinkId: sensorLinkId,
          origin: {
            xyz: { x: -0.2, y: 0.4, z: 0.1 },
            rpy: { r: 0.05, p: 0.1, y: -0.2 },
          },
        },
      },
    },
  };
}

function createUnsupportedDynamicComponent(componentId: string, name: string) {
  const baseLinkId = `${componentId}_base_link`;
  const toolLinkId = `${componentId}_tool_link`;
  const jointId = `${componentId}_ball_joint`;

  return {
    id: componentId,
    name,
    sourceFile: `robots/${name}.urdf`,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
    robot: {
      name: `${name}_robot`,
      rootLinkId: baseLinkId,
      links: {
        [baseLinkId]: {
          ...DEFAULT_LINK,
          id: baseLinkId,
          name: `${name}_base_link`,
        },
        [toolLinkId]: {
          ...DEFAULT_LINK,
          id: toolLinkId,
          name: `${name}_tool_link`,
        },
      },
      joints: {
        [jointId]: {
          ...DEFAULT_JOINT,
          id: jointId,
          name: jointId,
          type: JointType.BALL,
          parentLinkId: baseLinkId,
          childLinkId: toolLinkId,
          origin: {
            xyz: { x: 0.4, y: 0, z: 0 },
            rpy: { r: 0, p: 0.2, y: 0 },
          },
        },
      },
    },
  };
}

function getRelativeLinkMatrix(
  robot: RobotData,
  referenceLinkId: string,
  linkId: string,
): THREE.Matrix4 {
  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const referenceMatrix = linkWorldMatrices[referenceLinkId];
  const linkMatrix = linkWorldMatrices[linkId];
  assert.ok(referenceMatrix, `expected reference matrix for ${referenceLinkId}`);
  assert.ok(linkMatrix, `expected link matrix for ${linkId}`);

  return referenceMatrix.clone().invert().multiply(linkMatrix);
}

function getRelativeVisualMatrix(
  robot: RobotData,
  referenceLinkId: string,
  linkId: string,
): THREE.Matrix4 {
  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const referenceMatrix = linkWorldMatrices[referenceLinkId];
  const linkMatrix = linkWorldMatrices[linkId];
  const visualOrigin = robot.links[linkId]?.visual.origin;
  assert.ok(referenceMatrix, `expected reference matrix for ${referenceLinkId}`);
  assert.ok(linkMatrix, `expected link matrix for ${linkId}`);
  assert.ok(visualOrigin, `expected visual origin for ${linkId}`);

  return referenceMatrix
    .clone()
    .invert()
    .multiply(linkMatrix)
    .multiply(createOriginMatrix(visualOrigin));
}

function assertMatrixClose(
  actualMatrix: THREE.Matrix4,
  expectedMatrix: THREE.Matrix4,
  message: string,
) {
  const maxDelta = actualMatrix.elements.reduce((delta, value, index) => {
    return Math.max(delta, Math.abs(value - expectedMatrix.elements[index]!));
  }, 0);

  assert.ok(maxDelta < 1e-6, `${message}; max delta was ${maxDelta}`);
}

test('mergeAssembly reuses component links and joints while synthesizing bridge joints', () => {
  const assemblyState = createAssemblyState();

  const merged = mergeAssembly(assemblyState);

  assert.equal(
    merged.links.comp_left_base_link,
    assemblyState.components.comp_left.robot.links.comp_left_base_link,
  );
  assert.equal(
    merged.joints.comp_left_joint,
    assemblyState.components.comp_left.robot.joints.comp_left_joint,
  );
  assert.notEqual(merged.joints.bridge_join, assemblyState.bridges.bridge_join.joint);
  assert.equal(merged.joints.bridge_join.parentLinkId, 'comp_left_base_link');
  assert.equal(merged.joints.bridge_join.childLinkId, 'comp_right_base_link');
});

test('mergeAssembly reroots a dynamic child subtree when a bridge targets a non-root child link', () => {
  const parentComponent = createSingleLinkComponent('comp_parent', 'parent');
  const childComponent = createDynamicChainComponent('comp_child', 'child');
  const originalChildRobot = structuredClone(childComponent.robot);

  const assemblyState: AssemblyState = {
    name: 'reroot-fixed-merge',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      [parentComponent.id]: parentComponent,
      [childComponent.id]: childComponent,
    },
    bridges: {
      bridge_attach_tool: {
        id: 'bridge_attach_tool',
        name: 'bridge_attach_tool',
        parentComponentId: parentComponent.id,
        parentLinkId: `${parentComponent.id}_base_link`,
        childComponentId: childComponent.id,
        childLinkId: `${childComponent.id}_tool_link`,
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_attach_tool',
          name: 'bridge_attach_tool',
          type: JointType.FIXED,
          parentLinkId: `${parentComponent.id}_base_link`,
          childLinkId: `${childComponent.id}_tool_link`,
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
  };

  const merged = mergeAssembly(assemblyState);
  const incomingToolJoints = Object.values(merged.joints).filter(
    (joint) => joint.childLinkId === 'comp_child_tool_link',
  );

  assert.equal(incomingToolJoints.length, 1);
  assert.equal(incomingToolJoints[0]?.id, 'bridge_attach_tool');
  assert.equal(merged.rootLinkId, 'comp_parent_base_link');
  assert.deepEqual(merged.joints.comp_child_shoulder_joint.axis, { x: 0, y: 0, z: -1 });
  assert.deepEqual(merged.joints.comp_child_wrist_slide_joint.axis, { x: -1, y: 0, z: 0 });
  assert.deepEqual(merged.joints.comp_child_shoulder_joint.limit, {
    lower: -1.6,
    upper: 1.2,
    effort: originalChildRobot.joints.comp_child_shoulder_joint.limit?.effort ?? 0,
    velocity: originalChildRobot.joints.comp_child_shoulder_joint.limit?.velocity ?? 0,
  });
  assert.deepEqual(merged.joints.comp_child_wrist_slide_joint.limit, {
    lower: -0.5,
    upper: 0.1,
    effort: originalChildRobot.joints.comp_child_wrist_slide_joint.limit?.effort ?? 0,
    velocity: originalChildRobot.joints.comp_child_wrist_slide_joint.limit?.velocity ?? 0,
  });
  assert.deepEqual(merged.joints.comp_child_shoulder_joint.safetyController, {
    softLowerLimit: -1.1,
    softUpperLimit: 0.8,
    kPosition: originalChildRobot.joints.comp_child_shoulder_joint.safetyController?.kPosition,
    kVelocity: originalChildRobot.joints.comp_child_shoulder_joint.safetyController?.kVelocity,
  });
  assert.deepEqual(merged.joints.comp_child_wrist_slide_joint.safetyController, {
    softLowerLimit: -0.2,
    softUpperLimit: 0.04,
    kPosition: originalChildRobot.joints.comp_child_wrist_slide_joint.safetyController?.kPosition,
    kVelocity: originalChildRobot.joints.comp_child_wrist_slide_joint.safetyController?.kVelocity,
  });

  assert.equal(merged.joints.comp_child_wrist_slide_joint.parentLinkId, 'comp_child_tool_link');
  assert.equal(merged.joints.comp_child_wrist_slide_joint.childLinkId, 'comp_child_elbow_link');
  assert.equal(merged.joints.comp_child_shoulder_joint.parentLinkId, 'comp_child_elbow_link');
  assert.equal(merged.joints.comp_child_shoulder_joint.childLinkId, 'comp_child_base_link');

  assertMatrixClose(
    getRelativeLinkMatrix(merged, 'comp_child_tool_link', 'comp_child_tool_link'),
    getRelativeLinkMatrix(originalChildRobot, 'comp_child_tool_link', 'comp_child_tool_link'),
    'tool link should stay at the reroot origin',
  );
  assertMatrixClose(
    getRelativeLinkMatrix(merged, 'comp_child_tool_link', 'comp_child_sensor_link'),
    getRelativeLinkMatrix(originalChildRobot, 'comp_child_tool_link', 'comp_child_sensor_link'),
    'off-path branch links should stay attached at the same physical pose',
  );
  assertMatrixClose(
    getRelativeVisualMatrix(merged, 'comp_child_tool_link', 'comp_child_base_link'),
    getRelativeVisualMatrix(originalChildRobot, 'comp_child_tool_link', 'comp_child_base_link'),
    'path link visuals should keep their physical placement after frame rewrites',
  );
  assertMatrixClose(
    getRelativeVisualMatrix(merged, 'comp_child_tool_link', 'comp_child_elbow_link'),
    getRelativeVisualMatrix(originalChildRobot, 'comp_child_tool_link', 'comp_child_elbow_link'),
    'intermediate link visuals should keep their physical placement after frame rewrites',
  );

  assert.equal(childComponent.robot.rootLinkId, originalChildRobot.rootLinkId);
  assert.equal(
    childComponent.robot.joints.comp_child_shoulder_joint.parentLinkId,
    originalChildRobot.joints.comp_child_shoulder_joint.parentLinkId,
  );
  assert.equal(
    childComponent.robot.joints.comp_child_shoulder_joint.childLinkId,
    originalChildRobot.joints.comp_child_shoulder_joint.childLinkId,
  );
});

test('mergeAssembly fails fast when rerooting would need to reverse an unsupported joint type', () => {
  const parentComponent = createSingleLinkComponent('comp_parent', 'parent');
  const childComponent = createUnsupportedDynamicComponent('comp_child', 'child');

  const assemblyState: AssemblyState = {
    name: 'reroot-dynamic-merge',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      [parentComponent.id]: parentComponent,
      [childComponent.id]: childComponent,
    },
    bridges: {
      bridge_attach_tool: {
        id: 'bridge_attach_tool',
        name: 'bridge_attach_tool',
        parentComponentId: parentComponent.id,
        parentLinkId: `${parentComponent.id}_base_link`,
        childComponentId: childComponent.id,
        childLinkId: `${childComponent.id}_tool_link`,
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_attach_tool',
          name: 'bridge_attach_tool',
          type: JointType.FIXED,
          parentLinkId: `${parentComponent.id}_base_link`,
          childLinkId: `${childComponent.id}_tool_link`,
        },
      },
    },
  };

  assert.throws(
    () => mergeAssembly(assemblyState),
    /Cannot reroot assembly component "comp_child" through unsupported joint "comp_child_ball_joint" of type "ball"/,
  );
});

test('mergeAssembly fails fast when a visible bridge references a missing link', () => {
  const parentComponent = createSingleLinkComponent('comp_parent', 'parent');
  const childComponent = createSingleLinkComponent('comp_child', 'child');

  const assemblyState: AssemblyState = {
    name: 'missing-bridge-link',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      [parentComponent.id]: parentComponent,
      [childComponent.id]: childComponent,
    },
    bridges: {
      bridge_attach_missing: {
        id: 'bridge_attach_missing',
        name: 'bridge_attach_missing',
        parentComponentId: parentComponent.id,
        parentLinkId: `${parentComponent.id}_base_link`,
        childComponentId: childComponent.id,
        childLinkId: 'missing_link',
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_attach_missing',
          name: 'bridge_attach_missing',
          type: JointType.FIXED,
          parentLinkId: `${parentComponent.id}_base_link`,
          childLinkId: 'missing_link',
        },
      },
    },
  };

  assert.throws(
    () => mergeAssembly(assemblyState),
    /Cannot merge assembly "missing-bridge-link" because bridge "bridge_attach_missing" references missing child link "missing_link" on component "comp_child"/,
  );
});

test('mergeAssembly fails fast when a link would end up with multiple parent joints', () => {
  const leftParentComponent = createSingleLinkComponent('comp_left', 'left');
  const rightParentComponent = createSingleLinkComponent('comp_right', 'right');
  const childComponent = createSingleLinkComponent('comp_child', 'child');

  const assemblyState: AssemblyState = {
    name: 'duplicate-parent-merge',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      [leftParentComponent.id]: leftParentComponent,
      [rightParentComponent.id]: rightParentComponent,
      [childComponent.id]: childComponent,
    },
    bridges: {
      bridge_left_child: {
        id: 'bridge_left_child',
        name: 'bridge_left_child',
        parentComponentId: leftParentComponent.id,
        parentLinkId: `${leftParentComponent.id}_base_link`,
        childComponentId: childComponent.id,
        childLinkId: `${childComponent.id}_base_link`,
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_left_child',
          name: 'bridge_left_child',
          type: JointType.FIXED,
          parentLinkId: `${leftParentComponent.id}_base_link`,
          childLinkId: `${childComponent.id}_base_link`,
        },
      },
      bridge_right_child: {
        id: 'bridge_right_child',
        name: 'bridge_right_child',
        parentComponentId: rightParentComponent.id,
        parentLinkId: `${rightParentComponent.id}_base_link`,
        childComponentId: childComponent.id,
        childLinkId: `${childComponent.id}_base_link`,
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_right_child',
          name: 'bridge_right_child',
          type: JointType.FIXED,
          parentLinkId: `${rightParentComponent.id}_base_link`,
          childLinkId: `${childComponent.id}_base_link`,
        },
      },
    },
  };

  assert.throws(
    () => mergeAssembly(assemblyState),
    /Cannot merge assembly "duplicate-parent-merge" because component "comp_child" would have multiple parent bridges: comp_left -> comp_child, comp_right -> comp_child/,
  );
});

test('mergeAssembly converts a cyclic bridge into a closed-loop constraint while preserving a rooted tree', () => {
  const leftComponent = createSingleLinkComponent('comp_left', 'left');
  const rightComponent = createSingleLinkComponent('comp_right', 'right');

  const assemblyState: AssemblyState = {
    name: 'cyclic-assembly-merge',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      [leftComponent.id]: leftComponent,
      [rightComponent.id]: rightComponent,
    },
    bridges: {
      bridge_left_right: {
        id: 'bridge_left_right',
        name: 'bridge_left_right',
        parentComponentId: leftComponent.id,
        parentLinkId: `${leftComponent.id}_base_link`,
        childComponentId: rightComponent.id,
        childLinkId: `${rightComponent.id}_base_link`,
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_left_right',
          name: 'bridge_left_right',
          type: JointType.FIXED,
          parentLinkId: `${leftComponent.id}_base_link`,
          childLinkId: `${rightComponent.id}_base_link`,
          origin: {
            xyz: { x: 1, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
      bridge_right_left: {
        id: 'bridge_right_left',
        name: 'bridge_right_left',
        parentComponentId: rightComponent.id,
        parentLinkId: `${rightComponent.id}_base_link`,
        childComponentId: leftComponent.id,
        childLinkId: `${leftComponent.id}_base_link`,
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_right_left',
          name: 'bridge_right_left',
          type: JointType.FIXED,
          parentLinkId: `${rightComponent.id}_base_link`,
          childLinkId: `${leftComponent.id}_base_link`,
          origin: {
            xyz: { x: -1, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
  };

  const merged = mergeAssembly(assemblyState);

  assert.equal(merged.rootLinkId, 'comp_left_base_link');
  assert.ok(merged.joints.bridge_left_right);
  assert.equal(merged.joints.bridge_right_left, undefined);
  assert.ok(merged.closedLoopConstraints);
  assert.equal(merged.closedLoopConstraints?.length, 1);
  assert.deepEqual(merged.closedLoopConstraints?.[0], {
    id: 'bridge_right_left',
    type: 'connect',
    linkAId: 'comp_right_base_link',
    linkBId: 'comp_left_base_link',
    anchorLocalA: { x: -1, y: 0, z: 0 },
    anchorLocalB: { x: 0, y: 0, z: 0 },
    anchorWorld: { x: 0, y: 0, z: 0 },
    source: undefined,
  });
});

test('mergeAssembly rejects a non-fixed bridge that would close a component cycle', () => {
  const leftComponent = createSingleLinkComponent('comp_left', 'left');
  const rightComponent = createSingleLinkComponent('comp_right', 'right');

  const assemblyState: AssemblyState = {
    name: 'unsupported-cyclic-motion-bridge',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      [leftComponent.id]: leftComponent,
      [rightComponent.id]: rightComponent,
    },
    bridges: {
      bridge_left_right: {
        id: 'bridge_left_right',
        name: 'bridge_left_right',
        parentComponentId: leftComponent.id,
        parentLinkId: `${leftComponent.id}_base_link`,
        childComponentId: rightComponent.id,
        childLinkId: `${rightComponent.id}_base_link`,
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_left_right',
          name: 'bridge_left_right',
          type: JointType.FIXED,
          parentLinkId: `${leftComponent.id}_base_link`,
          childLinkId: `${rightComponent.id}_base_link`,
        },
      },
      bridge_right_left: {
        id: 'bridge_right_left',
        name: 'bridge_right_left',
        parentComponentId: rightComponent.id,
        parentLinkId: `${rightComponent.id}_base_link`,
        childComponentId: leftComponent.id,
        childLinkId: `${leftComponent.id}_base_link`,
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_right_left',
          name: 'bridge_right_left',
          type: JointType.REVOLUTE,
          parentLinkId: `${rightComponent.id}_base_link`,
          childLinkId: `${leftComponent.id}_base_link`,
        },
      },
    },
  };

  assert.throws(
    () => mergeAssembly(assemblyState),
    /Cannot merge assembly "unsupported-cyclic-motion-bridge" because bridge "bridge_right_left" would close a cycle with joint type "revolute". Only fixed cyclic bridges can be converted into closed-loop constraints\./,
  );
});
