#!/usr/bin/env node

/**
 * URDF Property Editor browser regression test.
 *
 * Covers: joint origin/axis/limit/dynamics editing, joint type change,
 *         joint angle control, display flags, tool mode switching.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession, createTestSuite, assert, assertEqual,
  importModel, waitForReady, getTopology,
  store, writeReport, printSummary,
} from './helpers/urdf-helpers.mjs';

const MODEL = { dir: 'go1_description', file: 'go1.urdf' };

async function main() {
  const suite = createTestSuite('URDF Property Editor');
  const session = await createSession();
  const { page } = session;

  try {
    await importModel(page, MODEL.dir, MODEL.file);
    await waitForReady(page);
    const base = await getTopology(page);
    console.log(`  Baseline: ${base.linkCount}L ${base.jointCount}J`);

    // ── 1. Joint origin editing ──
    const hipJoint = base.joints.find((j) => j.name === 'FL_hip_joint');
    assert(suite, !!hipJoint, 'FL_hip_joint found');

    await store.updateJoint(page, hipJoint.id, {
      origin: { xyz: { x: 0.1, y: 0.2, z: 0.3 }, rpy: { r: 0.1, p: 0.2, y: 0.3 } },
    });
    await delay(200);
    const t1 = await getTopology(page);
    const j1 = t1.joints.find((j) => j.id === hipJoint.id);
    assertEqual(suite, j1.originXyz?.[0], 0.1, 'joint origin xyz[0] updated');

    // Restore
    await store.updateJoint(page, hipJoint.id, {
      origin: {
        xyz: { x: hipJoint.originXyz[0], y: hipJoint.originXyz[1], z: hipJoint.originXyz[2] },
        rpy: { r: hipJoint.originRpy[0], p: hipJoint.originRpy[1], y: hipJoint.originRpy[2] },
      },
    });
    await delay(200);

    // ── 2. Joint axis editing ──
    await store.updateJoint(page, hipJoint.id, { axis: { x: 1, y: 0, z: 0 } });
    await delay(200);
    const t2 = await getTopology(page);
    const j2 = t2.joints.find((j) => j.id === hipJoint.id);
    assertEqual(suite, j2.axis?.[0], 1, 'joint axis updated');

    // Restore
    await store.updateJoint(page, hipJoint.id, {
      axis: { x: hipJoint.axis[0], y: hipJoint.axis[1], z: hipJoint.axis[2] },
    });
    await delay(200);

    // ── 3. Joint limit editing ──
    await store.updateJoint(page, hipJoint.id, {
      limit: { lower: -0.5, upper: 0.5, effort: 20, velocity: 10 },
    });
    await delay(200);
    const t3 = await getTopology(page);
    const j3 = t3.joints.find((j) => j.id === hipJoint.id);
    assertEqual(suite, j3.limit?.lower, -0.5, 'joint limit.lower updated');
    assertEqual(suite, j3.limit?.upper, 0.5, 'joint limit.upper updated');

    // ── 4. Joint dynamics editing ──
    await store.updateJoint(page, hipJoint.id, {
      dynamics: { damping: 5, friction: 0.5 },
    });
    await delay(200);
    const t4 = await getTopology(page);
    const j4 = t4.joints.find((j) => j.id === hipJoint.id);
    assertEqual(suite, j4.damping, 5, 'joint damping updated');
    assertEqual(suite, j4.friction, 0.5, 'joint friction updated');

    // ── 5. Joint type change ──
    await store.updateJoint(page, hipJoint.id, { type: 'continuous' });
    await delay(200);
    const t5 = await getTopology(page);
    assertEqual(suite, t5.joints.find((j) => j.id === hipJoint.id)?.type, 'continuous', 'joint type → continuous');

    // Undo to restore
    await store.undo(page); await delay(200);
    const t5b = await getTopology(page);
    assertEqual(suite, t5b.joints.find((j) => j.id === hipJoint.id)?.type, 'revolute', 'joint type restored');

    // ── 6. Joint angle control ──
    const angleResult = await store.setJointAngle(page, 'FL_hip_joint', 0.5);
    assert(suite, angleResult?.ok, 'setJointAngle ok');
    await delay(200);

    // Batch joint angles
    const batchResult = await store.setJointAngles(page, { 'FL_hip_joint': 0.3, 'FR_hip_joint': -0.3 });
    assert(suite, batchResult?.ok, 'setJointAngles batch ok');
    await delay(200);

    // ── 7. Display flags toggle ──
    const flagResult = await store.setViewerFlags(page, { showCollision: true });
    assert(suite, flagResult?.ok, 'setViewerFlags showCollision ok');
    await delay(200);

    const flagsOff = await store.setViewerFlags(page, { showCollision: false });
    assert(suite, flagsOff?.ok, 'setViewerFlags showCollision off ok');

    // ── 8. Tool mode switching ──
    const translateMode = await store.setViewerToolMode(page, 'translate');
    assert(suite, translateMode?.ok, 'tool mode → translate');
    await delay(200);

    const selectMode = await store.setViewerToolMode(page, 'select');
    assert(suite, selectMode?.ok, 'tool mode → select');

    // ── 9. Undo property changes, verify topology intact ──
    // Undo several times to revert limit/dynamics changes
    for (let i = 0; i < 5; i++) { try { await store.undo(page); await delay(100); } catch {} }
    const tFinal = await getTopology(page);
    assert(suite, tFinal.linkCount === base.linkCount, 'topology intact after undo');
    assert(suite, tFinal.jointCount === base.jointCount, 'joints intact after undo');

    const errs = session.errors();
    assert(suite, errs.page.length === 0, 'no page errors');
  } finally {
    await session.cleanup();
  }

  await writeReport('urdf_property_editor', {});
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
