#!/usr/bin/env node

/**
 * Xacro Import browser regression test.
 *
 * Verifies xacro file upload and expansion to URDF.
 */

import {
  createSession, createTestSuite, assert, assertGreaterThan,
  importModel, waitForReady, getTopology, getRuntimeTransforms,
  writeReport, printSummary,
} from './helpers/xacro-helpers.mjs';

import path from 'node:path';

const MODELS = [
  { xacroPath: 'a1_description/xacro/robot.xacro', expectedName: 'robot.xacro' },
];

async function main() {
  const suite = createTestSuite('Xacro Import');
  const session = await createSession();
  const results = [];

  try {
    for (const { xacroPath, expectedName } of MODELS) {
      console.log(`\n── ${xacroPath} ──`);

      try {
        await importModel(session.page, xacroPath, expectedName);
        await waitForReady(session.page);
        const topo = await getTopology(session.page);

        assertGreaterThan(suite, topo.linkCount, 0, `${xacroPath}: links > 0 (${topo.linkCount})`);
        assertGreaterThan(suite, topo.jointCount, 0, `${xacroPath}: joints > 0 (${topo.jointCount})`);

        const rt = await getRuntimeTransforms(session.page);
        assertGreaterThan(suite, rt.length, 0, `${xacroPath}: runtime transforms present`);

        results.push({ model: xacroPath, status: 'ok', linkCount: topo.linkCount, jointCount: topo.jointCount });
      } catch (err) {
        assert(suite, false, `${xacroPath}: import succeeded — ${err.message}`);
        results.push({ model: xacroPath, status: 'error', error: err.message });
      }
    }

    const errs = session.errors();
    assert(suite, errs.page.length === 0, `no page errors (${errs.page.length})`);
  } finally {
    await session.cleanup();
  }

  await writeReport('xacro_import', { results });
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
