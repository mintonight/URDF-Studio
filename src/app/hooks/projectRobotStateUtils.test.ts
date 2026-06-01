import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LINK } from '@/types/constants';
import { GeometryType, JointType, type RobotClosedLoopConstraint, type RobotData, type UrdfJoint } from '@/types';
import {
  buildCurrentRobotExportData,
  buildCurrentRobotExportState,
  buildImportedRobotStoreState,
} from './projectRobotStateUtils';

function createJoint(): UrdfJoint {
  return {
    id: 'joint_1',
    name: 'joint_1',
    type: JointType.REVOLUTE,
    parentLinkId: 'base_link',
    childLinkId: 'tool_link',
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    axis: { x: 0, y: 0, z: 1 },
    limit: { lower: -1, upper: 1, effort: 10, velocity: 5 },
    dynamics: { damping: 0, friction: 0 },
    hardware: {
      armature: 0,
      motorType: 'None',
      motorId: '',
      motorDirection: 1,
    },
  };
}

function createClosedLoopConstraints(): RobotClosedLoopConstraint[] {
  return [
    {
      id: 'loop-1',
      type: 'connect',
      linkAId: 'base_link',
      linkBId: 'tool_link',
      anchorWorld: { x: 0, y: 0, z: 0 },
      anchorLocalA: { x: 0, y: 0, z: 0 },
      anchorLocalB: { x: 0, y: 0, z: 0 },
      source: {
        format: 'mjcf',
        body1Name: 'base_link',
        body2Name: 'tool_link',
      },
    },
  ];
}

function createRobotData(): RobotData {
  return {
    name: 'demo_robot',
    rootLinkId: 'base_link',
    materials: {
      blue: { color: '#0088ff' },
    },
    closedLoopConstraints: createClosedLoopConstraints(),
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      tool_link: {
        ...DEFAULT_LINK,
        id: 'tool_link',
        name: 'tool_link',
      },
    },
    joints: {
      joint_1: createJoint(),
    },
  };
}

test('buildCurrentRobotExportData preserves materials and closed-loop constraints', () => {
  const robotData = createRobotData();

  assert.deepEqual(
    buildCurrentRobotExportData({
      robotName: robotData.name,
      robotLinks: robotData.links,
      robotJoints: robotData.joints,
      rootLinkId: robotData.rootLinkId,
      robotMaterials: robotData.materials,
      closedLoopConstraints: robotData.closedLoopConstraints,
    }),
    robotData,
  );
});

test('buildCurrentRobotExportState resets selection while preserving exportable fields', () => {
  const robotData = createRobotData();
  const state = buildCurrentRobotExportState({
    robotName: robotData.name,
    robotLinks: robotData.links,
    robotJoints: robotData.joints,
    rootLinkId: robotData.rootLinkId,
    robotMaterials: robotData.materials,
    closedLoopConstraints: robotData.closedLoopConstraints,
  });

  assert.equal(state.selection.type, null);
  assert.equal(state.selection.id, null);
  assert.deepEqual(state.materials, robotData.materials);
  assert.deepEqual(state.closedLoopConstraints, robotData.closedLoopConstraints);
});

test('buildImportedRobotStoreState restores closed-loop constraints into robot store shape', () => {
  const robotData = createRobotData();
  const robotHistory = { past: [robotData], future: [] };
  const robotActivity = [{ id: '1', timestamp: '2026-03-20T00:00:00.000Z', label: 'Import' }];

  const patch = buildImportedRobotStoreState(robotData, robotHistory, robotActivity);

  assert.deepEqual(patch.closedLoopConstraints, robotData.closedLoopConstraints);
  assert.deepEqual(patch.materials, robotData.materials);
  assert.deepEqual(patch._history, robotHistory);
  assert.deepEqual(patch._activity, robotActivity);
});

test('buildImportedRobotStoreState syncs imported material colors onto link visuals', () => {
  const robotData = createRobotData();
  robotData.links.base_link = {
    ...robotData.links.base_link,
    visual: {
      ...robotData.links.base_link.visual,
      type: GeometryType.BOX,
      color: '#808080',
      dimensions: { x: 0.2, y: 0.3, z: 0.4 },
    },
  };
  robotData.materials = {
    base_link: { color: '#12ab34' },
  };

  const patch = buildImportedRobotStoreState(robotData, { past: [], future: [] }, []);

  assert.ok(patch.links);
  assert.equal(patch.links.base_link.visual.color, '#12ab34');
  assert.equal(patch.materials?.base_link?.color, '#12ab34');
});

test('buildImportedRobotStoreState keeps history-only restores working', () => {
  const robotHistory = { past: [], future: [] };
  const robotActivity = [{ id: '1', timestamp: '2026-03-20T00:00:00.000Z', label: 'Import' }];

  const patch = buildImportedRobotStoreState(null, robotHistory, robotActivity);

  assert.deepEqual(patch, {
    _history: robotHistory,
    _activity: robotActivity,
  });
});
