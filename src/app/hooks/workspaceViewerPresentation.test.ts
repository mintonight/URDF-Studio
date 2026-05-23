import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LINK, type RobotData } from '@/types';
import {
  resolveWorkspaceViewerFallbackRobot,
  resolveWorkspaceViewerRobot,
  shouldPersistStableWorkspaceViewerRobot,
  shouldAnimateWorkspaceViewerRobot,
} from './workspaceViewerPresentation.ts';

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
  const liveRobot = createRobotData('live-robot');

  const viewerRobot = resolveWorkspaceViewerRobot({
    shouldRenderAssembly: true,
    liveRobot,
    workspaceViewerRobotData: null,
    animatedWorkspaceViewerRobotData: null,
  });

  assert.equal(viewerRobot, liveRobot);
});

test('resolveWorkspaceViewerFallbackRobot keeps the last stable scene during the first workspace handoff', () => {
  const liveRobot = createRobotData('source-live');
  const lastStableViewerRobot = createRobotData('last-stable');

  const fallbackRobot = resolveWorkspaceViewerFallbackRobot({
    shouldRenderAssembly: true,
    hasWorkspaceDisplayRobot: false,
    liveRobot,
    lastStableViewerRobot,
  });

  assert.equal(fallbackRobot, lastStableViewerRobot);
});

test('resolveWorkspaceViewerFallbackRobot skips the last stable scene after a workspace render failure', () => {
  const liveRobot = createRobotData('workspace-error');
  const lastStableViewerRobot = createRobotData('last-stable');

  const fallbackRobot = resolveWorkspaceViewerFallbackRobot({
    shouldRenderAssembly: true,
    hasWorkspaceDisplayRobot: false,
    hasWorkspaceRenderFailure: true,
    liveRobot,
    lastStableViewerRobot,
  });

  assert.equal(fallbackRobot, liveRobot);
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

test('resolveWorkspaceViewerRobot prefers animated workspace data over static data', () => {
  const liveRobot = createRobotData('live-robot');
  const animatedRobot = createRobotData('workspace-display', '__workspace_world__');

  const viewerRobot = resolveWorkspaceViewerRobot({
    shouldRenderAssembly: true,
    liveRobot,
    workspaceViewerRobotData: createRobotData('workspace-static', '__workspace_world__'),
    animatedWorkspaceViewerRobotData: animatedRobot,
  });

  assert.equal(viewerRobot, animatedRobot);
});

test('resolveWorkspaceViewerRobot reference stays stable across selection-only changes', () => {
  // Regression: selection used to be folded into the viewer robot, which made
  // its reference change on every empty click and cascaded into a viewer-wide
  // re-sync (visibility/color/highlight all re-run, models flashing off for a
  // frame). The viewer robot must now be selection-independent so the cascade
  // is gated only on real geometry/topology changes.
  const liveRobot = createRobotData('live-robot');
  const animatedRobot = createRobotData('workspace-display', '__workspace_world__');

  const first = resolveWorkspaceViewerRobot({
    shouldRenderAssembly: true,
    liveRobot,
    workspaceViewerRobotData: null,
    animatedWorkspaceViewerRobotData: animatedRobot,
  });
  const second = resolveWorkspaceViewerRobot({
    shouldRenderAssembly: true,
    liveRobot,
    workspaceViewerRobotData: null,
    animatedWorkspaceViewerRobotData: animatedRobot,
  });

  assert.equal(first, second);
});
