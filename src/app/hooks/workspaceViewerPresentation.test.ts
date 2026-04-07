import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LINK, type RobotData, type RobotState } from '@/types';
import {
  resolveWorkspaceViewerFallbackRobot,
  resolveWorkspaceViewerRobot,
  shouldPersistStableWorkspaceViewerRobot,
  shouldAnimateWorkspaceViewerRobot,
} from './workspaceViewerPresentation.ts';

function createRobotState(name: string, rootLinkId = 'base_link'): RobotState {
  return {
    name,
    rootLinkId,
    links: {
      [rootLinkId]: {
        ...DEFAULT_LINK,
        id: rootLinkId,
        name: rootLinkId,
      },
    },
    joints: {},
    selection: { type: 'link', id: rootLinkId },
  };
}

function createRobotData(name: string, rootLinkId = 'base_link'): RobotData {
  return {
    name,
    rootLinkId,
    links: {
      [rootLinkId]: {
        ...DEFAULT_LINK,
        id: rootLinkId,
        name: rootLinkId,
      },
    },
    joints: {},
  };
}

test('shouldAnimateWorkspaceViewerRobot skips the first workspace render', () => {
  assert.equal(
    shouldAnimateWorkspaceViewerRobot({
      shouldRenderAssembly: true,
      previouslyRenderedAssembly: false,
    }),
    false,
  );

  assert.equal(
    shouldAnimateWorkspaceViewerRobot({
      shouldRenderAssembly: true,
      previouslyRenderedAssembly: true,
    }),
    true,
  );
});

test('shouldAnimateWorkspaceViewerRobot disables transitions while bridge creation preview is active', () => {
  assert.equal(
    shouldAnimateWorkspaceViewerRobot({
      shouldRenderAssembly: true,
      previouslyRenderedAssembly: true,
      isPreviewingAssemblyBridge: true,
    }),
    false,
  );
});

test('resolveWorkspaceViewerRobot keeps the live scene while workspace display data is still settling', () => {
  const liveRobot = createRobotState('live-robot');

  const viewerRobot = resolveWorkspaceViewerRobot({
    shouldRenderAssembly: true,
    liveRobot,
    workspaceViewerRobotData: null,
    animatedWorkspaceViewerRobotData: null,
    selection: { type: null, id: null },
  });

  assert.equal(viewerRobot, liveRobot);
});

test('resolveWorkspaceViewerFallbackRobot keeps the last stable scene during the first workspace handoff', () => {
  const liveRobot = createRobotState('source-live');
  const lastStableViewerRobot = createRobotState('last-stable');

  const fallbackRobot = resolveWorkspaceViewerFallbackRobot({
    shouldRenderAssembly: true,
    hasWorkspaceDisplayRobot: false,
    liveRobot,
    lastStableViewerRobot,
    selection: { type: 'joint', id: 'joint_a' },
  });

  assert.equal(fallbackRobot.name, lastStableViewerRobot.name);
  assert.deepEqual(fallbackRobot.selection, { type: 'joint', id: 'joint_a' });
});

test('shouldPersistStableWorkspaceViewerRobot only updates the cache when the visible scene is stable', () => {
  assert.equal(
    shouldPersistStableWorkspaceViewerRobot({
      shouldRenderAssembly: false,
      hasWorkspaceDisplayRobot: false,
    }),
    true,
  );

  assert.equal(
    shouldPersistStableWorkspaceViewerRobot({
      shouldRenderAssembly: true,
      hasWorkspaceDisplayRobot: false,
    }),
    false,
  );

  assert.equal(
    shouldPersistStableWorkspaceViewerRobot({
      shouldRenderAssembly: true,
      hasWorkspaceDisplayRobot: true,
    }),
    true,
  );
});

test('resolveWorkspaceViewerRobot prefers animated workspace data and reapplies selection', () => {
  const liveRobot = createRobotState('live-robot');
  const animatedRobot = createRobotData('workspace-display', '__workspace_world__');

  const viewerRobot = resolveWorkspaceViewerRobot({
    shouldRenderAssembly: true,
    liveRobot,
    workspaceViewerRobotData: createRobotData('workspace-static', '__workspace_world__'),
    animatedWorkspaceViewerRobotData: animatedRobot,
    selection: { type: 'joint', id: 'joint_a' },
  });

  assert.equal(viewerRobot.name, animatedRobot.name);
  assert.equal(viewerRobot.rootLinkId, animatedRobot.rootLinkId);
  assert.deepEqual(viewerRobot.selection, { type: 'joint', id: 'joint_a' });
});
