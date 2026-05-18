import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

import {
  LINK_IK_COMMIT_EPSILON,
  LINK_IK_PREVIEW_COORDINATE_PAIR_MAX_DISTANCE,
  LINK_IK_PREVIEW_MAX_ANGLE_STEP,
  LINK_IK_PREVIEW_MAX_QUATERNION_STEP_RADIANS,
  LINK_IK_PREVIEW_MAX_ITERATIONS,
  LINK_IK_PREVIEW_COMMIT_EPSILON,
  LINK_IK_PREVIEW_POSITION_TOLERANCE,
  LINK_IK_PREVIEW_STALL_TOLERANCE,
  cloneLinkIkDragKinematicState,
  createEmptyLinkIkDragKinematicState,
  diffLinkIkDragKinematicState,
  hasMeaningfulLinkIkTargetDelta,
  hasLinkIkKinematicStateChanges,
  limitLinkIkPreviewKinematicStateStep,
  resolveLinkIkCommittedStateEpsilon,
  resolveLinkIkSolveRequestOptions,
  shouldAcceptLinkIkSolveState,
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
    coordinatePairMaxDistance: LINK_IK_PREVIEW_COORDINATE_PAIR_MAX_DISTANCE,
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

test('limitLinkIkPreviewKinematicStateStep caps abrupt preview jumps', () => {
  const nextQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.4);
  const limitedState = limitLinkIkPreviewKinematicStateStep(
    {
      angles: { joint1: 0 },
      quaternions: { joint2: { x: 0, y: 0, z: 0, w: 1 } },
    },
    {
      angles: { joint1: 0.4 },
      quaternions: {
        joint2: {
          x: nextQuaternion.x,
          y: nextQuaternion.y,
          z: nextQuaternion.z,
          w: nextQuaternion.w,
        },
      },
    },
  );

  assert.ok(Math.abs(limitedState.angles.joint1 - LINK_IK_PREVIEW_MAX_ANGLE_STEP) < 1e-9);

  const limitedQuaternion = new THREE.Quaternion(
    limitedState.quaternions.joint2.x,
    limitedState.quaternions.joint2.y,
    limitedState.quaternions.joint2.z,
    limitedState.quaternions.joint2.w,
  );
  const limitedAngle = 2 * Math.acos(Math.min(1, Math.abs(limitedQuaternion.w)));
  assert.ok(
    Math.abs(limitedAngle - LINK_IK_PREVIEW_MAX_QUATERNION_STEP_RADIANS) < 1e-6,
    `expected quaternion step to be capped at ${LINK_IK_PREVIEW_MAX_QUATERNION_STEP_RADIANS}, got ${limitedAngle}`,
  );
});

test('limitLinkIkPreviewKinematicStateStep lets passive closed-loop compensation snap closed', () => {
  const activeQuaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    0.4,
  );
  const passiveQuaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    0.4,
  );

  const limitedState = limitLinkIkPreviewKinematicStateStep(
    {
      angles: { active_joint: 0, passive_joint: 0 },
      quaternions: {
        active_ball: { x: 0, y: 0, z: 0, w: 1 },
        passive_ball: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
    {
      angles: { active_joint: 0.4, passive_joint: -0.4 },
      quaternions: {
        active_ball: {
          x: activeQuaternion.x,
          y: activeQuaternion.y,
          z: activeQuaternion.z,
          w: activeQuaternion.w,
        },
        passive_ball: {
          x: passiveQuaternion.x,
          y: passiveQuaternion.y,
          z: passiveQuaternion.z,
          w: passiveQuaternion.w,
        },
      },
    },
    {
      limitedJointIds: new Set(['active_joint', 'active_ball']),
    },
  );

  assert.ok(Math.abs(limitedState.angles.active_joint - LINK_IK_PREVIEW_MAX_ANGLE_STEP) < 1e-9);
  assert.equal(limitedState.angles.passive_joint, -0.4);

  const activeLimitedQuaternion = new THREE.Quaternion(
    limitedState.quaternions.active_ball.x,
    limitedState.quaternions.active_ball.y,
    limitedState.quaternions.active_ball.z,
    limitedState.quaternions.active_ball.w,
  );
  const activeLimitedAngle = 2 * Math.acos(Math.min(1, Math.abs(activeLimitedQuaternion.w)));
  assert.ok(
    Math.abs(activeLimitedAngle - LINK_IK_PREVIEW_MAX_QUATERNION_STEP_RADIANS) < 1e-6,
  );
  assert.deepEqual(limitedState.quaternions.passive_ball, {
    x: passiveQuaternion.x,
    y: passiveQuaternion.y,
    z: passiveQuaternion.z,
    w: passiveQuaternion.w,
  });
});

test('limitLinkIkPreviewKinematicStateStep treats opposite-sign quaternions as the same orientation', () => {
  const limitedState = limitLinkIkPreviewKinematicStateStep(
    {
      quaternions: { joint1: { x: 0, y: 0, z: 0, w: 1 } },
    },
    {
      quaternions: { joint1: { x: 0, y: 0, z: 0, w: -1 } },
    },
  );

  assert.ok(Math.abs(limitedState.quaternions.joint1.x) < 1e-12);
  assert.ok(Math.abs(limitedState.quaternions.joint1.y) < 1e-12);
  assert.ok(Math.abs(limitedState.quaternions.joint1.z) < 1e-12);
  assert.equal(limitedState.quaternions.joint1.w, 1);
});

test('shouldAcceptLinkIkSolveState rejects stalled seed echoes but keeps stalled progress', () => {
  const emptyState = createEmptyLinkIkDragKinematicState();
  const seededState = cloneLinkIkDragKinematicState({
    angles: { joint1: 0.12, joint2: -0.04 },
  });

  assert.equal(
    shouldAcceptLinkIkSolveState({
      seedState: emptyState,
      nextState: emptyState,
      preview: true,
      converged: false,
      failureReason: 'stalled',
    }),
    false,
  );

  assert.equal(
    shouldAcceptLinkIkSolveState({
      seedState: seededState,
      nextState: cloneLinkIkDragKinematicState(seededState),
      preview: true,
      converged: false,
      failureReason: 'stalled',
    }),
    false,
  );

  assert.equal(
    shouldAcceptLinkIkSolveState({
      seedState: seededState,
      nextState: cloneLinkIkDragKinematicState({
        angles: { joint1: 0.17, joint2: -0.04 },
      }),
      preview: true,
      converged: false,
      failureReason: 'stalled',
    }),
    true,
  );
});
