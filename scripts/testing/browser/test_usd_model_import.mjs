#!/usr/bin/env node

/**
 * USD/USDA Model Import browser regression test.
 *
 * Verifies seed-and-load import for USD and USDA model fixtures
 * using the regression debug API.
 */

import {
  createSession, createTestSuite, assert, assertGreaterThan,
  waitForReady, getTopology, getRuntimeTransforms,
  importModel as importUsdModel, importUnitreeModel, writeReport, printSummary,
} from './helpers/usd-helpers.mjs';

import path from 'node:path';

const MODELS = [
  { key: 'Go2', label: 'Go2 USD' },
];

const USDA_FIXTURES = [
  {
    label: 'g1_29dof_with_hand USDA',
    sourceRoot: path.resolve('test/unitree_ros_usda/g1_description'),
    exposedRoot: 'unitree_ros_usda/g1_description',
    loadFileName: 'unitree_ros_usda/g1_description/g1_29dof_with_hand.usda',
  },
];

async function main() {
  const suite = createTestSuite('USD/USDA Model Import');
  const session = await createSession();
  const results = [];

  try {
    // ── USD models via importUnitreeModel ──
    for (const { key, label } of MODELS) {
      console.log(`\n── ${label} ──`);
      try {
        await importUnitreeModel(session.page, key);
        await waitForReady(session.page);
        const topo = await getTopology(session.page);

        assertGreaterThan(suite, topo.linkCount, 0, `${label}: links > 0 (${topo.linkCount})`);
        assertGreaterThan(suite, topo.jointCount, 0, `${label}: joints > 0 (${topo.jointCount})`);

        const rt = await getRuntimeTransforms(session.page);
        assertGreaterThan(suite, rt.length, 0, `${label}: runtime transforms present`);

        results.push({ model: label, status: 'ok', linkCount: topo.linkCount, jointCount: topo.jointCount });
      } catch (err) {
        assert(suite, false, `${label}: import succeeded — ${err.message}`);
        results.push({ model: label, status: 'error', error: err.message });
      }
    }

    // ── USDA fixtures via direct importModel ──
    for (const fixture of USDA_FIXTURES) {
      console.log(`\n── ${fixture.label} ──`);
      try {
        // Navigate to fresh page for new seed
        await session.page.reload({ waitUntil: 'domcontentloaded' });
        await session.page.waitForFunction(
          () => Boolean(window.__URDF_STUDIO_DEBUG__),
          { timeout: 30_000 },
        );
        await session.page.evaluate(() => window.__URDF_STUDIO_DEBUG__?.setBeforeUnloadPromptEnabled?.(false));

        await importUsdModel(session.page, fixture);
        await waitForReady(session.page, 120_000);
        const topo = await getTopology(session.page);

        assertGreaterThan(suite, topo.linkCount, 0, `${fixture.label}: links > 0 (${topo.linkCount})`);
        assertGreaterThan(suite, topo.jointCount, 0, `${fixture.label}: joints > 0 (${topo.jointCount})`);

        results.push({ model: fixture.label, status: 'ok', linkCount: topo.linkCount, jointCount: topo.jointCount });
      } catch (err) {
        assert(suite, false, `${fixture.label}: import succeeded — ${err.message}`);
        results.push({ model: fixture.label, status: 'error', error: err.message });
      }
    }

    const errs = session.errors();
    assert(suite, errs.page.length === 0, `no page errors (${errs.page.length})`);
  } finally {
    await session.cleanup();
  }

  await writeReport('usd_model_import', { results });
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
