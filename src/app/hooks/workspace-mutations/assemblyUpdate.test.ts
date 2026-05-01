import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  type AssemblyState,
  type RobotData,
  type UrdfJoint,
} from '@/types';
import { applyAssemblyUpdate } from './assemblyUpdate';

function createAssemblyState(): AssemblyState {
  const links = {
    base: { ...DEFAULT_LINK, id: 'base', name: 'base' },
    tip: { ...DEFAULT_LINK, id: 'tip', name: 'tip' },
  };
  const joints: Record<string, UrdfJoint> = {
    elbow: {
      ...DEFAULT_JOINT,
      id: 'elbow',
      name: 'elbow',
      parentLinkId: 'base',
      childLinkId: 'tip',
      limit: {
        lower: -1,
        upper: 1,
        effort: 10,
        velocity: 5,
      },
    },
  };
  const robot: RobotData = {
    name: 'component_robot',
    links,
    joints,
    rootLinkId: 'base',
  };

  return {
    name: 'assembly',
    components: {
      component_1: {
        id: 'component_1',
        name: 'component',
        sourceFile: 'component.urdf',
        robot,
      },
    },
    bridges: {},
  };
}

test('applyAssemblyUpdate does not sync joint limits for unrelated partial joint updates', () => {
  const limitPatchCalls: unknown[] = [];
  const renamePatchCalls: unknown[] = [];
  const updatedRobots: Partial<RobotData>[] = [];

  const handled = applyAssemblyUpdate({
    type: 'joint',
    id: 'elbow',
    data: {
      origin: {
        xyz: { x: 1, y: 2, z: 3 },
        rpy: { r: 0.1, p: 0.2, y: 0.3 },
      },
    } as UrdfJoint,
    options: { commitMode: 'manual' },
    latestAssemblyState: createAssemblyState(),
    commitPendingAssemblyHistory: () => {},
    ensurePendingAssemblyHistory: () => {},
    schedulePendingAssemblyHistoryCommit: () => {},
    updateComponentRobot: (_componentId, partialRobot) => {
      updatedRobots.push(partialRobot);
    },
    updateComponentName: () => {},
    patchEditableSourceUpdateJointLimit: (args) => {
      limitPatchCalls.push(args);
    },
    patchEditableSourceRenameEntities: (args) => {
      renamePatchCalls.push(args);
    },
  });

  assert.equal(handled, true);
  assert.equal(limitPatchCalls.length, 0);
  assert.equal(renamePatchCalls.length, 0);
  assert.equal(updatedRobots.length, 1);
  assert.deepEqual(updatedRobots[0].joints?.elbow.limit, {
    lower: -1,
    upper: 1,
    effort: 10,
    velocity: 5,
  });
});

test('applyAssemblyUpdate syncs joint limits only when the partial joint patch includes limits', () => {
  const limitPatchCalls: Array<{
    sourceFileName?: string | null;
    jointName: string;
    jointType: UrdfJoint['type'];
    limit: NonNullable<UrdfJoint['limit']>;
  }> = [];
  const renamePatchCalls: unknown[] = [];
  const updatedRobots: Partial<RobotData>[] = [];

  const handled = applyAssemblyUpdate({
    type: 'joint',
    id: 'elbow',
    data: {
      limit: {
        lower: -2,
      },
    } as UrdfJoint,
    options: { commitMode: 'manual' },
    latestAssemblyState: createAssemblyState(),
    commitPendingAssemblyHistory: () => {},
    ensurePendingAssemblyHistory: () => {},
    schedulePendingAssemblyHistoryCommit: () => {},
    updateComponentRobot: (_componentId, partialRobot) => {
      updatedRobots.push(partialRobot);
    },
    updateComponentName: () => {},
    patchEditableSourceUpdateJointLimit: (args) => {
      limitPatchCalls.push(args);
    },
    patchEditableSourceRenameEntities: (args) => {
      renamePatchCalls.push(args);
    },
  });

  assert.equal(handled, true);
  assert.equal(renamePatchCalls.length, 0);
  assert.equal(updatedRobots.length, 1);
  assert.deepEqual(updatedRobots[0].joints?.elbow.limit, {
    lower: -2,
    upper: 1,
    effort: 10,
    velocity: 5,
  });
  assert.deepEqual(limitPatchCalls, [
    {
      sourceFileName: 'component.urdf',
      jointName: 'elbow',
      jointType: 'revolute',
      limit: {
        lower: -2,
        upper: 1,
        effort: 10,
        velocity: 5,
      },
    },
  ]);
});
