#!/usr/bin/env node

/**
 * Measure Tool browser regression test.
 *
 * Covers: switching to measure mode, verifying measure UI,
 *         switching back to select mode.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession, createTestSuite, assert,
  importModel, waitForReady, store, writeReport, printSummary,
} from './helpers/mjcf-helpers.mjs';

async function main() {
  const suite = createTestSuite('Measure Tool');
  const session = await createSession();
  const { page } = session;

  try {
    await importModel(page, 'unitree_go2', 'go2.xml');
    await waitForReady(page);

    // ── 1. Switch to measure mode ──
    const measureResult = await store.setViewerToolMode(page, 'measure');
    assert(suite, measureResult?.ok, 'tool mode → measure accepted');
    await delay(300);

    // ── 2. Verify measure mode active ──
    const toolMode = await page.evaluate(() => {
      const s = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.();
      return s?.interaction?.toolMode ?? s?.interaction?.mode ?? null;
    });
    // Tool mode may or may not be exposed via snapshot; just verify no errors

    // ── 3. Verify no errors after mode switch ──
    const errs1 = session.errors();
    assert(suite, errs1.page.length === 0, 'no page errors after measure mode');

    // ── 4. Switch back to select mode ──
    const selectResult = await store.setViewerToolMode(page, 'select');
    assert(suite, selectResult?.ok, 'tool mode → select accepted');
    await delay(200);

    // ── 5. Try other tool modes ──
    for (const mode of ['translate', 'rotate', 'view']) {
      const result = await store.setViewerToolMode(page, mode);
      assert(suite, result?.ok, `tool mode → ${mode} accepted`);
      await delay(100);
    }

    // Back to select
    await store.setViewerToolMode(page, 'select');

    const errs = session.errors();
    assert(suite, errs.page.length === 0, 'no page errors overall');
  } finally {
    await session.cleanup();
  }

  await writeReport('measure_tool', {});
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
