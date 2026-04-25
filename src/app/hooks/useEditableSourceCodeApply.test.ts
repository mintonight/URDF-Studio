import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  type RobotData,
  type RobotFile,
  type RobotState,
} from '@/types';

import { commitEditableSourceApply } from './useEditableSourceCodeApply';

function createSourceFile(format: RobotFile['format']): Pick<RobotFile, 'format' | 'name'> {
  return {
    format,
    name: `robot.${format === 'xacro' ? 'xacro' : format}`,
  };
}

function createRobotState(): RobotState {
  return {
    name: 'demo_robot',
    version: '1.2.3',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
    },
    joints: {},
    materials: {
      demo: {
        color: '#ff0000',
      },
    },
    closedLoopConstraints: [
      {
        id: 'constraint_1',
        type: 'connect',
        linkAId: 'base_link',
        linkBId: 'base_link',
        anchorWorld: { x: 0, y: 0, z: 0 },
        anchorLocalA: { x: 0, y: 0, z: 0 },
        anchorLocalB: { x: 0, y: 0, z: 0 },
        source: {
          format: 'mjcf',
          body1Name: 'body_a',
          body2Name: 'body_b',
        },
      },
    ],
    inspectionContext: {
      sourceFormat: 'mjcf',
      mjcf: {
        siteCount: 1,
        tendonCount: 0,
        tendonActuatorCount: 0,
        bodiesWithSites: [],
        tendons: [],
      },
    },
    selection: { type: null, id: null },
  };
}

test('commitEditableSourceApply commits parsed source data without forcing a viewer reload', () => {
  const events: string[] = [];
  let syncedFileName: string | null = null;
  let syncedContent: string | null = null;
  let committedRobot: RobotData | null = null;

  commitEditableSourceApply({
    newCode: '<robot name="demo_robot" />',
    sourceFile: createSourceFile('urdf'),
    targetFileName: 'robot.urdf',
    nextState: createRobotState(),
    syncSelectedEditableFileContent: (targetFileName, content) => {
      events.push('sync');
      syncedFileName = targetFileName;
      syncedContent = content;
    },
    setOriginalUrdfContent: () => {
      events.push('original');
    },
    setRobot: (data) => {
      events.push('robot');
      committedRobot = data;
    },
  });

  assert.equal(syncedFileName, 'robot.urdf');
  assert.equal(syncedContent, '<robot name="demo_robot" />');
  assert.deepEqual(events, ['sync', 'robot']);
  const expectedRobot = createRobotState();
  assert.deepEqual(committedRobot, {
    name: expectedRobot.name,
    version: expectedRobot.version,
    links: expectedRobot.links,
    joints: expectedRobot.joints,
    rootLinkId: expectedRobot.rootLinkId,
    materials: expectedRobot.materials,
    closedLoopConstraints: expectedRobot.closedLoopConstraints,
    inspectionContext: expectedRobot.inspectionContext,
  } satisfies RobotData);
});

test('commitEditableSourceApply refreshes the resolved URDF baseline for xacro sources before commit', () => {
  const events: string[] = [];
  let resolvedUrdfContent: string | null = null;

  commitEditableSourceApply({
    newCode: '<xacro:robot name="demo_robot" />',
    sourceFile: createSourceFile('xacro'),
    targetFileName: 'robot.xacro',
    nextState: createRobotState(),
    syncSelectedEditableFileContent: () => {
      events.push('sync');
    },
    setOriginalUrdfContent: (content) => {
      events.push('original');
      resolvedUrdfContent = content;
    },
    setRobot: () => {
      events.push('robot');
    },
  });

  assert.deepEqual(events, ['sync', 'original', 'robot']);
  assert.match(resolvedUrdfContent ?? '', /<robot name="demo_robot"/);
  assert.match(resolvedUrdfContent ?? '', /<link name="base_link">/);
});

test('commitEditableSourceApply skips xacro URDF baseline refresh for unsupported ball joints', () => {
  const events: string[] = [];
  let resolvedUrdfContent: string | null = '__unset__';
  const nextState = createRobotState();
  nextState.links.child_link = {
    ...DEFAULT_LINK,
    id: 'child_link',
    name: 'child_link',
  };
  nextState.joints.ball_joint = {
    ...DEFAULT_JOINT,
    id: 'ball_joint',
    name: 'ball_joint',
    type: JointType.BALL,
    parentLinkId: 'base_link',
    childLinkId: 'child_link',
  };

  commitEditableSourceApply({
    newCode: '<xacro:robot name="demo_robot" />',
    sourceFile: createSourceFile('xacro'),
    targetFileName: 'robot.xacro',
    nextState,
    syncSelectedEditableFileContent: () => {
      events.push('sync');
    },
    setOriginalUrdfContent: (content) => {
      events.push('original');
      resolvedUrdfContent = content;
    },
    setRobot: () => {
      events.push('robot');
    },
  });

  assert.deepEqual(events, ['sync', 'original', 'robot']);
  assert.equal(resolvedUrdfContent, null);
});
