#!/usr/bin/env node

/**
 * MuJoCo/MJCF Property Editor browser regression test.
 *
 * Covers editable joint origin/axis/limit/dynamics/type fields, joint angle
 * control, viewer display flags, and tool mode switching on a real MJCF model.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession, createTestSuite, assert, assertEqual,
  importModel, waitForReady, getTopology,
  store, writeReport, printSummary,
} from './helpers/mjcf-helpers.mjs';

const MODEL = { dir: 'franka_emika_panda', file: 'panda.xml' };
const EPSILON = 1e-9;

function closeTo(actual, expected, epsilon = EPSILON) {
  return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon;
}

function assertClose(suite, actual, expected, message) {
  return assert(suite, closeTo(actual, expected), `${message} (expected ${expected}, got ${actual})`);
}

function vectorFrom(value, fallback) {
  if (Array.isArray(value) && value.length >= 3) return value;
  return fallback;
}

function pickEditableJoint(topo) {
  const movableTypes = new Set(['revolute', 'continuous', 'prismatic']);
  return (
    topo.joints.find((joint) => movableTypes.has(joint.type) && Array.isArray(joint.axis)) ??
    topo.joints.find((joint) => movableTypes.has(joint.type)) ??
    topo.joints.find((joint) => joint.type !== 'fixed') ??
    topo.joints[0]
  );
}

async function readViewer(page) {
  return page.evaluate(() => window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.()?.viewer ?? null);
}

async function readRawJoint(page, jointId) {
  return page.evaluate((id) => {
    const state = window.__URDF_STUDIO_DEBUG__?.__store__?.getState?.();
    const joint = state?.joints?.[id] ?? null;
    return joint
      ? {
          id: joint.id,
          name: joint.name,
          type: joint.type,
          angle: joint.angle,
        }
      : null;
  }, jointId);
}

async function main() {
  const suite = createTestSuite('MuJoCo MJCF Property Editor');
  const session = await createSession();
  const { page } = session;
  const report = {};

  try {
    await importModel(page, MODEL.dir, MODEL.file);
    await waitForReady(page);
    const base = await getTopology(page);
    report.baseline = { linkCount: base.linkCount, jointCount: base.jointCount, name: base.name };
    console.log(`  Baseline: ${base.linkCount}L ${base.jointCount}J`);

    const joint = pickEditableJoint(base);
    assert(suite, !!joint, 'editable joint selected from topology');
    assert(suite, Boolean(joint?.name), 'selected joint has a name');
    assert(suite, Boolean(joint?.id), 'selected joint has an id');

    const originalType = joint.type;
    const originalOriginXyz = vectorFrom(joint.originXyz, [0, 0, 0]);
    const originalOriginRpy = vectorFrom(joint.originRpy, [0, 0, 0]);
    const originalAxis = vectorFrom(joint.axis, [0, 0, 1]);

    // 1. Joint origin editing.
    await store.updateJoint(page, joint.id, {
      origin: { xyz: { x: 0.11, y: -0.22, z: 0.33 }, rpy: { r: 0.04, p: -0.05, y: 0.06 } },
    });
    await delay(200);
    const afterOrigin = await getTopology(page);
    const originJoint = afterOrigin.joints.find((candidate) => candidate.id === joint.id);
    assertClose(suite, originJoint?.originXyz?.[0], 0.11, 'joint origin xyz[0] updated');
    assertClose(suite, originJoint?.originXyz?.[1], -0.22, 'joint origin xyz[1] updated');
    assertClose(suite, originJoint?.originRpy?.[2], 0.06, 'joint origin rpy[2] updated');

    await store.updateJoint(page, joint.id, {
      origin: {
        xyz: { x: originalOriginXyz[0], y: originalOriginXyz[1], z: originalOriginXyz[2] },
        rpy: { r: originalOriginRpy[0], p: originalOriginRpy[1], y: originalOriginRpy[2] },
      },
    });
    await delay(200);

    // 2. Joint axis editing.
    await store.updateJoint(page, joint.id, { axis: { x: 0, y: 0, z: 1 } });
    await delay(200);
    const afterAxis = await getTopology(page);
    const axisJoint = afterAxis.joints.find((candidate) => candidate.id === joint.id);
    assertClose(suite, axisJoint?.axis?.[0], 0, 'joint axis x updated');
    assertClose(suite, axisJoint?.axis?.[1], 0, 'joint axis y updated');
    assertClose(suite, axisJoint?.axis?.[2], 1, 'joint axis z updated');

    await store.updateJoint(page, joint.id, {
      axis: { x: originalAxis[0], y: originalAxis[1], z: originalAxis[2] },
    });
    await delay(200);

    // 3. Joint limit editing.
    await store.updateJoint(page, joint.id, {
      limit: { lower: -0.45, upper: 0.45, effort: 30, velocity: 9 },
    });
    await delay(200);
    const afterLimit = await getTopology(page);
    const limitJoint = afterLimit.joints.find((candidate) => candidate.id === joint.id);
    assertClose(suite, limitJoint?.limit?.lower, -0.45, 'joint limit lower updated');
    assertClose(suite, limitJoint?.limit?.upper, 0.45, 'joint limit upper updated');
    assertClose(suite, limitJoint?.limit?.effort, 30, 'joint limit effort updated');
    assertClose(suite, limitJoint?.limit?.velocity, 9, 'joint limit velocity updated');

    // 4. Joint dynamics editing.
    await store.updateJoint(page, joint.id, {
      dynamics: { damping: 4.5, friction: 0.25 },
    });
    await delay(200);
    const afterDynamics = await getTopology(page);
    const dynamicsJoint = afterDynamics.joints.find((candidate) => candidate.id === joint.id);
    assertClose(suite, dynamicsJoint?.damping, 4.5, 'joint dynamics damping updated');
    assertClose(suite, dynamicsJoint?.friction, 0.25, 'joint dynamics friction updated');

    // 5. Joint type editing and undo restore.
    const nextType = originalType === 'continuous' ? 'revolute' : 'continuous';
    await store.updateJoint(page, joint.id, { type: nextType });
    await delay(200);
    const afterType = await getTopology(page);
    assertEqual(suite, afterType.joints.find((candidate) => candidate.id === joint.id)?.type,
      nextType, 'joint type updated');

    await store.undo(page);
    await delay(200);
    const afterTypeUndo = await getTopology(page);
    assertEqual(suite, afterTypeUndo.joints.find((candidate) => candidate.id === joint.id)?.type,
      originalType, 'joint type undo restores original type');

    // 6. Joint angle control through store and viewer debug path.
    const angleResult = await store.setJointAngle(page, joint.name, 0.25);
    await delay(200);
    assert(suite, angleResult?.ok, 'setJointAngle returns ok');
    const afterAngle = await readRawJoint(page, joint.id);
    assertClose(suite, afterAngle?.angle, 0.25, 'joint angle persisted in robot store');

    const viewerAngleResult = await store.setJointAngles(page, { [joint.name]: -0.2 });
    await delay(200);
    assert(suite, viewerAngleResult?.ok, 'setViewerJointAngles returns ok');
    const viewerAfterAngle = await readViewer(page);
    assert(suite, closeTo(viewerAfterAngle?.jointAngles?.[joint.name], -0.2) ||
      closeTo(viewerAfterAngle?.jointAngles?.[joint.id], -0.2),
      'viewer joint angle updated');

    // 7. Viewer flags.
    const flagsOn = await store.setViewerFlags(page, {
      showCollision: true,
      showJointAxes: true,
      showOrigins: true,
      showCenterOfMass: true,
      modelOpacity: 0.65,
    });
    await delay(200);
    assert(suite, flagsOn?.ok, 'setViewerFlags on returns ok');
    const viewerFlagsOn = await readViewer(page);
    assert(suite, viewerFlagsOn?.flags?.showCollision === true, 'viewer showCollision enabled');
    assert(suite, viewerFlagsOn?.flags?.showJointAxes === true, 'viewer showJointAxes enabled');
    assert(suite, viewerFlagsOn?.flags?.showOrigins === true, 'viewer showOrigins enabled');
    assert(suite, viewerFlagsOn?.flags?.showCenterOfMass === true, 'viewer showCenterOfMass enabled');
    assertClose(suite, viewerFlagsOn?.flags?.modelOpacity, 0.65, 'viewer modelOpacity updated');

    const flagsOff = await store.setViewerFlags(page, {
      showCollision: false,
      showJointAxes: false,
      showOrigins: false,
      showCenterOfMass: false,
      modelOpacity: 1,
    });
    await delay(200);
    assert(suite, flagsOff?.ok, 'setViewerFlags off returns ok');
    const viewerFlagsOff = await readViewer(page);
    assert(suite, viewerFlagsOff?.flags?.showCollision === false, 'viewer showCollision disabled');
    assert(suite, viewerFlagsOff?.flags?.showJointAxes === false, 'viewer showJointAxes disabled');
    assertClose(suite, viewerFlagsOff?.flags?.modelOpacity, 1, 'viewer modelOpacity restored');

    // 8. Tool mode switching.
    const translateMode = await store.setViewerToolMode(page, 'translate');
    await delay(200);
    assert(suite, translateMode?.ok, 'tool mode translate returns ok');
    assertEqual(suite, translateMode?.activeMode, 'translate', 'tool mode translate resolves active mode');

    const selectMode = await store.setViewerToolMode(page, 'select');
    await delay(200);
    assert(suite, selectMode?.ok, 'tool mode select returns ok');
    assertEqual(suite, selectMode?.activeMode, 'select', 'tool mode select resolves active mode');

    const finalTopo = await getTopology(page);
    report.selectedJoint = { id: joint.id, name: joint.name, originalType };
    report.final = { linkCount: finalTopo.linkCount, jointCount: finalTopo.jointCount };
    assertEqual(suite, finalTopo.linkCount, base.linkCount, 'topology link count unchanged');
    assertEqual(suite, finalTopo.jointCount, base.jointCount, 'topology joint count unchanged');

    const errs = session.errors();
    assert(suite, errs.page.length === 0, `no page errors (${errs.page.length})`);
  } finally {
    await session.cleanup();
  }

  await writeReport('mujoco_property_editor', report);
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
