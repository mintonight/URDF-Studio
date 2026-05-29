#!/usr/bin/env node

/**
 * Paint Mode browser regression test.
 *
 * Covers: switching to paint mode, verifying mode accepted,
 *         switching back to select mode.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession, createTestSuite, assert,
  importModel, waitForReady, store, writeReport, printSummary,
} from './helpers/mjcf-helpers.mjs';

async function main() {
  const suite = createTestSuite('Paint Mode');
  const session = await createSession();
  const { page } = session;

  try {
    await importModel(page, 'unitree_go2', 'go2.xml');
    await waitForReady(page);

    // ── 1. Switch to paint mode ──
    const paintResult = await store.setViewerToolMode(page, 'paint');
    assert(suite, paintResult?.ok, 'tool mode → paint accepted');
    await delay(300);

    // ── 2. Verify no errors in paint mode ──
    const errs1 = session.errors();
    assert(suite, errs1.page.length === 0, 'no errors in paint mode');

    // ── 3. Switch to face mode ──
    const faceResult = await store.setViewerToolMode(page, 'face');
    assert(suite, faceResult?.ok, 'tool mode → face accepted');
    await delay(200);

    // ── 4. Switch back to select mode ──
    const selectResult = await store.setViewerToolMode(page, 'select');
    assert(suite, selectResult?.ok, 'tool mode → select accepted');

    const errs = session.errors();
    assert(suite, errs.page.length === 0, 'no page errors overall');
  } finally {
    await session.cleanup();
  }

  await writeReport('paint_mode', {});
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
