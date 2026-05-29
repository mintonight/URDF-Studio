#!/usr/bin/env node

/**
 * SDF Model Import browser regression test.
 *
 * Verifies import and basic topology for SDF model fixtures
 * from test/gazebo_models/.
 */

import {
  createSession, createTestSuite, assert, assertGreaterThan,
  importModel, waitForReady, getTopology,
  writeReport, printSummary,
} from './helpers/sdf-helpers.mjs';

const MODELS = [
  { dir: 'demo_joint_friction', file: 'model.sdf' },
  { dir: 'r2_description', file: 'model.sdf' },
];

async function main() {
  const suite = createTestSuite('SDF Model Import');
  const session = await createSession();
  const results = [];

  try {
    for (const { dir, file } of MODELS) {
      console.log(`\n── ${dir}/${file} ──`);

      try {
        const loadedName = await importModel(session.page, dir, file);
        await waitForReady(session.page);
        const topo = await getTopology(session.page);

        assertGreaterThan(suite, topo.linkCount, 0, `${dir}: links > 0 (${topo.linkCount})`);
        assertGreaterThan(suite, topo.jointCount, 0, `${dir}: joints > 0 (${topo.jointCount})`);

        const loadState = await session.page.evaluate(() =>
          window.__URDF_STUDIO_DEBUG__?.getDocumentLoadState?.());
        assert(suite, loadState?.fileName === loadedName, `${dir}: document state tracks loaded file`);

        results.push({ model: dir, status: 'ok', linkCount: topo.linkCount, jointCount: topo.jointCount });
      } catch (err) {
        assert(suite, false, `${dir}: import succeeded — ${err.message}`);
        results.push({ model: dir, status: 'error', error: err.message });
      }
    }

    const errs = session.errors();
    assert(suite, errs.page.length === 0, `no page errors (${errs.page.length})`);
  } finally {
    await session.cleanup();
  }

  await writeReport('sdf_model_import', { results });
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
