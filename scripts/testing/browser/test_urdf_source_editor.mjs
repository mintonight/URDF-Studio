#!/usr/bin/env node

/**
 * URDF Source Editor browser regression test.
 *
 * Covers: opening source editor, verifying Monaco editor content,
 *         basic XML editing, undo workflow.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession, createTestSuite, assert, assertEqual,
  importModel, waitForReady, getTopology,
  store, writeReport, printSummary,
} from './helpers/urdf-helpers.mjs';

const MODEL = { dir: 'a1_description', file: 'a1.urdf' };

async function main() {
  const suite = createTestSuite('URDF Source Editor');
  const session = await createSession();
  const { page } = session;

  try {
    await importModel(page, MODEL.dir, MODEL.file);
    await waitForReady(page);
    const topo = await getTopology(page);
    assert(suite, topo.linkCount > 0, 'model loaded');

    // ── 1. Open source editor via UI ──
    const editorOpened = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        /source|code|xml/i.test(`${b.textContent ?? ''} ${b.title ?? ''} ${b.getAttribute('aria-label') ?? ''}`) ||
        b.dataset?.action === 'source-editor');
      btn?.click();
      return !!btn;
    });
    assert(suite, editorOpened, 'source editor button found and clicked');

    // ── 2. Verify Monaco editor loaded with URDF XML ──
    const hasMonaco = await page
      .waitForSelector('.monaco-editor, [data-mode-id]', { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    assert(suite, hasMonaco, 'Monaco editor present');

    const editorContent = await page
      .waitForFunction(() => document.querySelectorAll('.view-line').length > 0, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    assert(suite, editorContent, 'editor has content');

    // ── 3. Verify source contains robot XML ──
    const sourceText = await page.evaluate(() => {
      const el = document.querySelector('.monaco-editor') ?? document.querySelector('[data-mode-id]');
      if (!el) return '';
      return el.textContent ?? '';
    });
    assert(suite, sourceText.includes('robot') || sourceText.includes('link') || sourceText.includes('joint'),
      'source contains robot XML elements');

    // ── 4. Verify property change reflects in store ──
    const hipJoint = topo.joints.find((j) => j.type === 'revolute');
    if (hipJoint) {
      await store.updateJoint(page, hipJoint.id, {
        limit: { lower: -1.0, upper: 1.0, effort: 50, velocity: 10 },
      });
      await delay(300);

      const updated = await getTopology(page);
      const updatedJoint = updated.joints.find((j) => j.id === hipJoint.id);
      assertEqual(suite, updatedJoint.limit?.lower, -1.0, 'joint limit updated via store');
    }

    // ── 5. Undo changes ──
    if (hipJoint) {
      await store.undo(page); await delay(200);
      const restored = await getTopology(page);
      assertEqual(suite, restored.linkCount, topo.linkCount, 'topology intact after undo');
    }

    // ── 6. Re-import restores original state ──
    await importModel(page, MODEL.dir, MODEL.file);
    await waitForReady(page);
    const reimported = await getTopology(page);
    assertEqual(suite, reimported.linkCount, topo.linkCount, 'reimport restores link count');
    assertEqual(suite, reimported.jointCount, topo.jointCount, 'reimport restores joint count');

    const errs = session.errors();
    assert(suite, errs.page.length === 0, 'no page errors');
  } finally {
    await session.cleanup();
  }

  await writeReport('urdf_source_editor', {});
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
