#!/usr/bin/env node

/**
 * Deep assembly browser regression.
 *
 * Covers: three-component branching assembly, bridge creation with multiple
 * joint types, repeated component transform updates with frame sampling,
 * merged topology/material preservation, undo/redo.
 */

import { setTimeout as delay } from 'node:timers/promises';

import {
  createSession, createTestSuite, assert, assertEqual, assertGreaterThan,
  importModel, waitForReady, getTopology, getAssemblyState, getSemanticSnapshot,
  getMaterialSnapshot, findAvailableFile, measureInteractionFrames,
  store, writeReport, printSummary, assertNoBrowserErrors,
} from './helpers/urdf-helpers.mjs';

const ROBOT_A = { dir: 'a1_description', file: 'a1.urdf' };
const ROBOT_B = { dir: 'go1_description', file: 'go1.urdf' };

function componentById(state, id) {
  return state.components.find((component) => component.id === id);
}

async function main() {
  const suite = createTestSuite('Editor Deep Assembly');
  const session = await createSession();
  const { page } = session;
  const report = {};

  try {
    await importModel(page, ROBOT_A.dir, ROBOT_A.file);
    await waitForReady(page);
    const topoA = await getTopology(page);
    assertGreaterThan(suite, topoA.linkCount, 0, 'robot A loads');

    await importModel(page, ROBOT_B.dir, ROBOT_B.file);
    await waitForReady(page);
    const baseMaterials = await getMaterialSnapshot(page);

    await store.initAssembly(page, 'editor_deep_parallel_assembly');
    await delay(300);
    assert(suite, (await getAssemblyState(page)).exists, 'assembly initialized');

    const fileA = await findAvailableFile(page, ROBOT_A.file);
    const fileB = await findAvailableFile(page, ROBOT_B.file);
    assert(suite, Boolean(fileA?.content), 'robot A source available for assembly');
    assert(suite, Boolean(fileB?.content), 'robot B source available for assembly');

    const compA = await store.addComponent(page, fileA);
    const compB = await store.addComponent(page, fileB);
    const compC = await store.addComponent(page, fileB);
    await delay(900);

    const withComponents = await getAssemblyState(page);
    assertEqual(suite, withComponents.componentCount, 3, 'three assembly components added');

    const parent = componentById(withComponents, compA.id);
    const childB = componentById(withComponents, compB.id);
    const childC = componentById(withComponents, compC.id);
    assert(suite, Boolean(parent?.rootLinkId && childB?.rootLinkId && childC?.rootLinkId), 'component roots resolved');

    const bridgeB = await store.addBridge(page, {
      name: 'deep_fixed_branch',
      parentComponentId: compA.id,
      parentLinkId: parent.rootLinkId,
      childComponentId: compB.id,
      childLinkId: childB.rootLinkId,
      joint: {
        name: 'deep_fixed_branch',
        type: 'fixed',
        origin: { xyz: [0.55, 0, 0.05], rpy: [0, 0, 0] },
      },
    });
    const bridgeC = await store.addBridge(page, {
      name: 'deep_prismatic_branch',
      parentComponentId: compA.id,
      parentLinkId: parent.rootLinkId,
      childComponentId: compC.id,
      childLinkId: childC.rootLinkId,
      joint: {
        name: 'deep_prismatic_branch',
        type: 'prismatic',
        axis: [0, 1, 0],
        limit: { lower: -0.2, upper: 0.2, effort: 5, velocity: 1 },
        origin: { xyz: [0, 0.55, 0.05], rpy: [0, 0, 0] },
      },
    });
    await delay(700);
    assert(suite, bridgeB.ok && bridgeC.ok, 'parallel bridge branches created');

    const bridgedState = await getAssemblyState(page);
    assertEqual(suite, bridgedState.bridgeCount, 2, 'two bridge joints present');
    assertGreaterThan(suite, (await getTopology(page)).linkCount, topoA.linkCount, 'merged topology exceeds single robot');

    const frameRun = await measureInteractionFrames(page, async () => {
      for (let index = 0; index < 12; index += 1) {
        await store.updateComponentTransform(page, compC.id, {
          position: { x: 0.12 + index * 0.015, y: 0.18, z: 0.25 + index * 0.003 },
          rotation: { r: 0.01 * index, p: -0.005 * index, y: 0.02 * index },
        });
        await delay(20);
      }
    }, { durationMs: 1200 });
    assertGreaterThan(suite, frameRun.metrics.frameCount, 15, 'parallel component transform samples frames');
    assert(
      suite,
      frameRun.metrics.longFrameCount <= 4,
      `parallel transform avoids excessive long frames (${frameRun.metrics.longFrameCount})`,
    );
    report.transformMetrics = frameRun.metrics;

    const afterTransform = await getSemanticSnapshot(page);
    const transformedCompC = afterTransform.assembly.components.find((component) => component.id === compC.id);
    assert(
      suite,
      Number(transformedCompC?.transform?.position?.x ?? 0) > 0.25,
      'component transform settles at expected edited position',
    );

    const afterMaterials = await getMaterialSnapshot(page);
    assert(
      suite,
      afterMaterials.runtimeVisualMeshCount >= baseMaterials.runtimeVisualMeshCount,
      'assembly edits do not drop visual meshes',
    );
    assert(
      suite,
      afterMaterials.runtimeMaterialCount >= baseMaterials.runtimeMaterialCount,
      'assembly edits do not drop runtime materials',
    );

    await store.undo(page);
    await delay(300);
    const undoSemantic = await getSemanticSnapshot(page);
    const undoCompC = undoSemantic.assembly.components.find((component) => component.id === compC.id);
    assert(
      suite,
      Number(undoCompC?.transform?.position?.x ?? 0) < Number(transformedCompC?.transform?.position?.x ?? 0),
      'undo moves component away from final transform',
    );

    await store.redo(page);
    await delay(300);
    const redoSemantic = await getSemanticSnapshot(page);
    const redoCompC = redoSemantic.assembly.components.find((component) => component.id === compC.id);
    assertEqual(
      suite,
      Number(redoCompC?.transform?.position?.x ?? 0).toFixed(3),
      Number(transformedCompC?.transform?.position?.x ?? 0).toFixed(3),
      'redo restores final component transform',
    );

    assertNoBrowserErrors(suite, session, 'deep assembly flow');
    report.assembly = await getAssemblyState(page);
    report.materials = await getMaterialSnapshot(page);
  } finally {
    await session.cleanup();
  }

  await writeReport('editor_deep_assembly', report);
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
