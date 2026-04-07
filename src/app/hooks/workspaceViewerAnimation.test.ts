import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LINK, JointType, type RobotData, type UrdfJoint } from '@/types';
import type { AssemblyState } from '@/types';
import {
  buildWorkspaceAssemblyViewerState,
  buildWorkspaceAssemblyViewerDisplayRobotData,
  getWorkspaceAssemblyViewerRobotData,
} from './workspaceSourceSyncUtils.ts';
import { mergeAssembly } from '@/core/robot/assemblyMerger.ts';
import {
  WORKSPACE_VIEWER_COMPONENT_ROOT_JOINT_PREFIX,
  WORKSPACE_VIEWER_WORLD_ROOT_ID,
} from './workspaceSourceSyncUtils.ts';
import {
  buildWorkspaceViewerRobotTransitionFrame,
  canAnimateWorkspaceViewerRobotTransition,
} from './workspaceViewerAnimation.ts';

function createSyntheticRootJoint(
  componentId: string,
  origin: Pick<UrdfJoint['origin'], 'xyz' | 'rpy'>,
): UrdfJoint {
  const jointId = `${WORKSPACE_VIEWER_COMPONENT_ROOT_JOINT_PREFIX}${componentId}`;
  return {
    id: jointId,
    name: jointId,
    type: JointType.FIXED,
    parentLinkId: WORKSPACE_VIEWER_WORLD_ROOT_ID,
    childLinkId: `${componentId}_base_link`,
    origin,
    dynamics: { damping: 0, friction: 0 },
    hardware: {
      armature: 0,
      motorType: 'None',
      motorId: '',
      motorDirection: 1,
    },
  };
}

function createWorkspaceViewerRobot(
  syntheticJointOrigin: Pick<UrdfJoint['origin'], 'xyz' | 'rpy'>,
): RobotData {
  const componentJointId = `${WORKSPACE_VIEWER_COMPONENT_ROOT_JOINT_PREFIX}comp_a`;

  return {
    name: 'workspace',
    rootLinkId: WORKSPACE_VIEWER_WORLD_ROOT_ID,
    links: {
      [WORKSPACE_VIEWER_WORLD_ROOT_ID]: {
        ...DEFAULT_LINK,
        id: WORKSPACE_VIEWER_WORLD_ROOT_ID,
        name: 'world',
        visible: false,
      },
      comp_a_base_link: {
        ...DEFAULT_LINK,
        id: 'comp_a_base_link',
        name: 'comp_a_base_link',
      },
      comp_a_tool_link: {
        ...DEFAULT_LINK,
        id: 'comp_a_tool_link',
        name: 'comp_a_tool_link',
      },
    },
    joints: {
      [componentJointId]: createSyntheticRootJoint('comp_a', syntheticJointOrigin),
      comp_a_joint: {
        id: 'comp_a_joint',
        name: 'comp_a_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'comp_a_base_link',
        childLinkId: 'comp_a_tool_link',
        origin: {
          xyz: { x: 0, y: 0, z: 0.25 },
          rpy: { r: 0.1, p: -0.2, y: 0.3 },
        },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -1, upper: 1, effort: 10, velocity: 5 },
        dynamics: { damping: 0, friction: 0 },
        hardware: {
          armature: 0,
          motorType: 'None',
          motorId: '',
          motorDirection: 1,
        },
      },
    },
  };
}

test('canAnimateWorkspaceViewerRobotTransition only allows stable workspace viewer transitions', () => {
  const fromRobot = createWorkspaceViewerRobot({
    xyz: { x: 0, y: 0, z: 0 },
    rpy: { r: 0, p: 0, y: 0 },
  });
  const toRobot = createWorkspaceViewerRobot({
    xyz: { x: 0.6, y: -0.2, z: 0.1 },
    rpy: { r: 0, p: 0, y: Math.PI / 2 },
  });

  assert.equal(canAnimateWorkspaceViewerRobotTransition(fromRobot, toRobot), true);

  const invalidRootRobot: RobotData = {
    ...toRobot,
    rootLinkId: 'base_link',
  };
  assert.equal(canAnimateWorkspaceViewerRobotTransition(fromRobot, invalidRootRobot), false);
});

test('buildWorkspaceViewerRobotTransitionFrame interpolates only workspace synthetic root joints', () => {
  const fromRobot = createWorkspaceViewerRobot({
    xyz: { x: 0, y: 0, z: 0 },
    rpy: { r: 0, p: 0, y: 0 },
  });
  const toRobot = createWorkspaceViewerRobot({
    xyz: { x: 0.8, y: -0.4, z: 0.2 },
    rpy: { r: 0, p: 0, y: Math.PI / 2 },
  });

  const midRobot = buildWorkspaceViewerRobotTransitionFrame({
    fromRobot,
    toRobot,
    alpha: 0.5,
  });
  const syntheticJointId = `${WORKSPACE_VIEWER_COMPONENT_ROOT_JOINT_PREFIX}comp_a`;

  assert.ok(midRobot);
  assert.equal(midRobot.joints[syntheticJointId]?.origin.xyz.x, 0.4);
  assert.equal(midRobot.joints[syntheticJointId]?.origin.xyz.y, -0.2);
  assert.equal(midRobot.joints[syntheticJointId]?.origin.xyz.z, 0.1);
  assert.ok(Math.abs((midRobot.joints[syntheticJointId]?.origin.rpy.y ?? 0) - Math.PI / 4) < 1e-6);

  assert.deepEqual(midRobot.joints.comp_a_joint?.origin, toRobot.joints.comp_a_joint?.origin);
});

test('buildWorkspaceViewerRobotTransitionFrame falls back to the target robot when transition is not animatable', () => {
  const fromRobot = createWorkspaceViewerRobot({
    xyz: { x: 0, y: 0, z: 0 },
    rpy: { r: 0, p: 0, y: 0 },
  });
  const toRobot = createWorkspaceViewerRobot({
    xyz: { x: 0.8, y: -0.4, z: 0.2 },
    rpy: { r: 0, p: 0, y: Math.PI / 2 },
  });

  delete fromRobot.joints[`${WORKSPACE_VIEWER_COMPONENT_ROOT_JOINT_PREFIX}comp_a`];

  const frameRobot = buildWorkspaceViewerRobotTransitionFrame({
    fromRobot,
    toRobot,
    alpha: 0.5,
  });

  assert.equal(frameRobot, toRobot);
});

test('workspace bridge preview transitions remain animatable so the child component can glide into place', () => {
  const assemblyState: AssemblyState = {
    name: 'assembly',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
    components: {
      comp_parent: {
        id: 'comp_parent',
        name: 'Parent',
        sourceFile: 'parent.urdf',
        visible: true,
        robot: {
          name: 'parent',
          rootLinkId: 'comp_parent_base_link',
          links: {
            comp_parent_base_link: {
              ...DEFAULT_LINK,
              id: 'comp_parent_base_link',
              name: 'base_link',
            },
          },
          joints: {},
          materials: {},
          closedLoopConstraints: [],
        },
        transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
      },
      comp_child: {
        id: 'comp_child',
        name: 'Child',
        sourceFile: 'child.urdf',
        visible: true,
        robot: {
          name: 'child',
          rootLinkId: 'comp_child_base_link',
          links: {
            comp_child_base_link: {
              ...DEFAULT_LINK,
              id: 'comp_child_base_link',
              name: 'base_link',
            },
            comp_child_tool_link: {
              ...DEFAULT_LINK,
              id: 'comp_child_tool_link',
              name: 'tool_link',
            },
          },
          joints: {
            comp_child_mount: {
              id: 'comp_child_mount',
              name: 'comp_child_mount',
              type: JointType.FIXED,
              parentLinkId: 'comp_child_base_link',
              childLinkId: 'comp_child_tool_link',
              origin: {
                xyz: { x: 1.2, y: 0, z: 0 },
                rpy: { r: 0, p: 0, y: 0 },
              },
              dynamics: { damping: 0, friction: 0 },
              hardware: {
                armature: 0,
                motorType: 'None',
                motorId: '',
                motorDirection: 1,
              },
            },
          },
          materials: {},
          closedLoopConstraints: [],
        },
        transform: {
          position: { x: 3.5, y: 0.4, z: -0.2 },
          rotation: { r: 0, p: 0, y: 0 },
        },
      },
    },
    bridges: {},
  };

  const mergedRobot = mergeAssembly(assemblyState);
  const fromViewerRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState,
    mergedRobotData: mergedRobot,
  });
  const previewBridge = {
    id: '__bridge_preview__',
    name: '__bridge_preview__',
    parentComponentId: 'comp_parent',
    parentLinkId: 'comp_parent_base_link',
    childComponentId: 'comp_child',
    childLinkId: 'comp_child_tool_link',
    joint: {
      id: '__bridge_preview__',
      name: '__bridge_preview__',
      type: JointType.FIXED,
      parentLinkId: 'comp_parent_base_link',
      childLinkId: 'comp_child_tool_link',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      dynamics: { damping: 0, friction: 0 },
      hardware: {
        armature: 0,
        motorType: 'None',
        motorId: '',
        motorDirection: 1,
      },
    },
  } as const;
  const previewAssemblyState = buildWorkspaceAssemblyViewerState({
    assemblyState,
    bridgePreview: previewBridge,
  });
  const previewMergedRobot = getWorkspaceAssemblyViewerRobotData({
    assemblyState,
    fallbackMergedRobotData: mergedRobot,
    bridgePreview: previewBridge,
  });
  const toViewerRobot = buildWorkspaceAssemblyViewerDisplayRobotData({
    assemblyState: previewAssemblyState,
    mergedRobotData: previewMergedRobot,
  });

  assert.ok(fromViewerRobot);
  assert.ok(toViewerRobot);
  assert.equal(canAnimateWorkspaceViewerRobotTransition(fromViewerRobot, toViewerRobot), true);

  const childRootJointId = `${WORKSPACE_VIEWER_COMPONENT_ROOT_JOINT_PREFIX}comp_child`;
  assert.notDeepEqual(
    fromViewerRobot.joints[childRootJointId]?.origin.xyz,
    toViewerRobot.joints[childRootJointId]?.origin.xyz,
    'preview alignment should move the child component root joint',
  );
});
