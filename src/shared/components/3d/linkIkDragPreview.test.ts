import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

import {
  LINK_IK_COMMIT_EPSILON,
  LINK_IK_PREVIEW_MAX_ITERATIONS,
  LINK_IK_PREVIEW_COMMIT_EPSILON,
  LINK_IK_PREVIEW_POSITION_TOLERANCE,
  LINK_IK_PREVIEW_STALL_TOLERANCE,
  cloneLinkIkDragKinematicState,
  createEmptyLinkIkDragKinematicState,
  diffLinkIkDragKinematicState,
  hasMeaningfulLinkIkTargetDelta,
  hasLinkIkKinematicStateChanges,
  resolveLinkIkCommittedStateEpsilon,
  resolveLinkIkSolveRequestOptions,
  shouldScheduleLinkIkPreviewSolve,
} from './linkIkDragPreview.ts';

test('hasMeaningfulLinkIkTargetDelta ignores tiny proxy jitter', () => {
  const previous = new THREE.Vector3(0.2, -0.1, 0.3);
  const tinyJitter = new THREE.Vector3(0.20001, -0.10001, 0.30001);
  const movedTarget = new THREE.Vector3(0.205, -0.1, 0.3);

  assert.equal(hasMeaningfulLinkIkTargetDelta(previous, tinyJitter), false);
  assert.equal(hasMeaningfulLinkIkTargetDelta(previous, movedTarget), true);
  assert.equal(hasMeaningfulLinkIkTargetDelta(null, movedTarget), true);
});

test('shouldScheduleLinkIkPreviewSolve ignores click-only onChange before any real drag motion', () => {
  const dragStart = new THREE.Vector3(0.2, -0.1, 0.3);

  assert.equal(
    shouldScheduleLinkIkPreviewSolve({
      pendingTargetWorldPosition: null,
      lastSolvedTargetWorldPosition: null,
      nextTargetWorldPosition: dragStart.clone(),
      hasMeaningfulDragMotion: false,
    }),
    false,
  );

  assert.equal(
    shouldScheduleLinkIkPreviewSolve({
      pendingTargetWorldPosition: null,
      lastSolvedTargetWorldPosition: null,
      nextTargetWorldPosition: dragStart.clone().add(new THREE.Vector3(0.02, 0, 0)),
      hasMeaningfulDragMotion: true,
    }),
    true,
  );
});

test('shouldScheduleLinkIkPreviewSolve only queues genuinely new moved targets once dragging is active', () => {
  const solvedTarget = new THREE.Vector3(0.25, -0.1, 0.3);
  const pendingTarget = new THREE.Vector3(0.28, -0.1, 0.3);

  assert.equal(
    shouldScheduleLinkIkPreviewSolve({
      pendingTargetWorldPosition: pendingTarget,
      lastSolvedTargetWorldPosition: solvedTarget,
      nextTargetWorldPosition: pendingTarget.clone(),
      hasMeaningfulDragMotion: true,
    }),
    false,
  );

  assert.equal(
    shouldScheduleLinkIkPreviewSolve({
      pendingTargetWorldPosition: null,
      lastSolvedTargetWorldPosition: solvedTarget,
      nextTargetWorldPosition: solvedTarget.clone(),
      hasMeaningfulDragMotion: true,
    }),
    false,
  );

  assert.equal(
    shouldScheduleLinkIkPreviewSolve({
      pendingTargetWorldPosition: null,
      lastSolvedTargetWorldPosition: solvedTarget,
      nextTargetWorldPosition: solvedTarget.clone().add(new THREE.Vector3(0, -0.02, 0)),
      hasMeaningfulDragMotion: true,
    }),
    true,
  );
});

test('resolveLinkIkSolveRequestOptions lowers preview solve budget only during drag preview', () => {
  assert.deepEqual(resolveLinkIkSolveRequestOptions(true), {
    maxIterations: LINK_IK_PREVIEW_MAX_ITERATIONS,
    positionTolerance: LINK_IK_PREVIEW_POSITION_TOLERANCE,
    stallTolerance: LINK_IK_PREVIEW_STALL_TOLERANCE,
  });
  assert.equal(resolveLinkIkSolveRequestOptions(false), undefined);
});

test('diffLinkIkDragKinematicState only returns meaningful deltas for store commits', () => {
  const previousState = {
    angles: { joint1: 0.4 },
    quaternions: { joint2: { x: 0, y: 0, z: 0, w: 1 } },
  };
  const nextState = {
    angles: {
      joint1: 0.4 + LINK_IK_PREVIEW_COMMIT_EPSILON / 2,
      joint3: -0.25,
    },
    quaternions: {
      joint2: { x: 0, y: 0, z: LINK_IK_PREVIEW_COMMIT_EPSILON / 2, w: 1 },
      joint4: { x: 0, y: 0.2, z: 0, w: 0.98 },
    },
  };

  assert.deepEqual(
    diffLinkIkDragKinematicState(previousState, nextState, LINK_IK_PREVIEW_COMMIT_EPSILON),
    {
      angles: { joint3: -0.25 },
      quaternions: { joint4: { x: 0, y: 0.2, z: 0, w: 0.98 } },
    },
  );
});

test('drag preview state helpers clone and report state changes safely', () => {
  const emptyState = createEmptyLinkIkDragKinematicState();
  assert.equal(hasLinkIkKinematicStateChanges(emptyState), false);
  assert.equal(resolveLinkIkCommittedStateEpsilon(true), LINK_IK_PREVIEW_COMMIT_EPSILON);
  assert.equal(resolveLinkIkCommittedStateEpsilon(false), LINK_IK_COMMIT_EPSILON);

  const clonedState = cloneLinkIkDragKinematicState({
    angles: { joint1: 0.1 },
    quaternions: { joint2: { x: 0, y: 0, z: 0, w: 1 } },
  });
  clonedState.angles.joint1 = 0.25;

  assert.equal(hasLinkIkKinematicStateChanges(clonedState), true);
  assert.equal(clonedState.angles.joint1, 0.25);
});
