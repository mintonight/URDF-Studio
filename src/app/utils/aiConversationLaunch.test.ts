import assert from 'node:assert/strict';
import test from 'node:test';

import type { RobotState } from '@/types';

import {
  createConversationLaunchContext,
  resolveConversationSelectedEntity,
} from './aiConversationLaunch.ts';

function createRobotSnapshot(selection: RobotState['selection']): RobotState {
  return {
    name: 'Test robot',
    links: {},
    joints: {},
    rootLinkId: 'base_link',
    materials: {},
    closedLoopConstraints: [],
    selection,
  };
}

test('resolveConversationSelectedEntity only exposes link and joint selections', () => {
  assert.deepEqual(
    resolveConversationSelectedEntity(createRobotSnapshot({ type: 'link', id: 'base_link' })),
    { type: 'link', id: 'base_link' },
  );
  assert.deepEqual(
    resolveConversationSelectedEntity(createRobotSnapshot({ type: 'joint', id: 'shoulder' })),
    { type: 'joint', id: 'shoulder' },
  );
  assert.equal(
    resolveConversationSelectedEntity(createRobotSnapshot({ type: 'tendon', id: 'tendon_a' })),
    null,
  );
  assert.equal(
    resolveConversationSelectedEntity(createRobotSnapshot({ type: null, id: null })),
    null,
  );
});

test('createConversationLaunchContext clones launch payloads and derives selected entity', () => {
  const robotSnapshot = createRobotSnapshot({ type: 'joint', id: 'elbow' });
  const inspectionReportSnapshot = {
    summary: 'Needs review',
    overallScore: 72,
    issues: [
      {
        type: 'warning' as const,
        title: 'Joint range',
        description: 'Joint range may be narrow.',
        profileId: 'base.kinematics',
        itemId: 'joint_range',
      },
    ],
  };

  const launchContext = createConversationLaunchContext({
    sessionId: 4,
    mode: 'inspection-followup',
    robotSnapshot,
    inspectionReportSnapshot,
    focusedIssue: inspectionReportSnapshot.issues[0],
  });

  robotSnapshot.selection.id = 'mutated';
  inspectionReportSnapshot.issues[0].title = 'Mutated issue';

  assert.equal(launchContext.sessionId, 4);
  assert.equal(launchContext.mode, 'inspection-followup');
  assert.deepEqual(launchContext.selectedEntity, { type: 'joint', id: 'elbow' });
  assert.equal(launchContext.robotSnapshot.selection.id, 'elbow');
  assert.equal(launchContext.inspectionReportSnapshot?.issues[0]?.title, 'Joint range');
  assert.equal(launchContext.focusedIssue?.title, 'Joint range');
});

test('createConversationLaunchContext preserves an explicit selected entity override', () => {
  const launchContext = createConversationLaunchContext({
    sessionId: 7,
    mode: 'general',
    robotSnapshot: createRobotSnapshot({ type: 'joint', id: 'elbow' }),
    selectedEntity: { type: 'link', id: 'base_link' },
  });

  assert.deepEqual(launchContext.selectedEntity, { type: 'link', id: 'base_link' });
});
