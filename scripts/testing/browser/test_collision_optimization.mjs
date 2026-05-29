#!/usr/bin/env node

/**
 * Collision Optimization browser regression test.
 *
 * Covers: loading model, showing collision bodies, verifying collision
 *         bodies exist, toggling collision display.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession, createTestSuite, assert, assertGreaterThan,
  importModel, waitForReady, getTopology,
  store, writeReport, printSummary,
} from './helpers/urdf-helpers.mjs';

async function main() {
  const suite = createTestSuite('Collision Optimization');
  const session = await createSession();
  const { page } = session;

  try {
    await importModel(page, 'a1_description', 'a1.urdf');
    await waitForReady(page);
    const topo = await getTopology(page);
    assert(suite, topo.linkCount > 0, 'model loaded');

    // ── 1. Check collision bodies in topology ──
    const linksWithCollision = topo.links.filter((l) => l.collisionCount > 0);
    assertGreaterThan(suite, linksWithCollision.length, 0, 'links with collision bodies');

    // ── 2. Show collision bodies ──
    const showResult = await store.setViewerFlags(page, { showCollision: true });
    assert(suite, showResult?.ok, 'showCollision flag set');
    await delay(300);

    // ── 3. Verify no errors after collision display ──
    const errs1 = session.errors();
    assert(suite, errs1.page.length === 0, 'no errors after collision display');

    // ── 4. Check collision body counts per link ──
    const topoWithCollision = await getTopology(page);
    const stillHasCollision = topoWithCollision.links.filter((l) => l.collisionCount > 0);
    assert(suite, stillHasCollision.length > 0, 'collision bodies still present after toggle');

    // ── 5. Hide collision bodies ──
    const hideResult = await store.setViewerFlags(page, { showCollision: false });
    assert(suite, hideResult?.ok, 'showCollision flag unset');

    const errs = session.errors();
    assert(suite, errs.page.length === 0, 'no page errors overall');
  } finally {
    await session.cleanup();
  }

  await writeReport('collision_optimization', {});
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
